// Elenchus GUI - App Root Component
//
// ## Keep-Alive Tab Architecture
// Preview tabs use a Keep-Alive model: all opened tabs remain mounted simultaneously,
// only the active tab is visible (CSS visibility), and tabs are only unmounted on close.
// This eliminates mount/unmount overhead and makes tab switching instant.
//
// ## Data Model
// - previewTabs: PreviewTab[] — descriptor list (key, title, type), append-only until close
// - activeTabKey: string — which tab is currently visible (keyed by file path)
// - tabContents: Map<string, TabContent> — content for all mounted tabs, loaded on open
//
// ## Key Design Decisions
// - Content is loaded when a tab is OPENED, not when it's SWITCHED to.
//   The Map IS the cache — no separate caching layer needed.
// - fs-change events update all mounted tabs in-place via Map.set().
// - Closing a tab removes its entry from the Map, triggering React unmount.
//
// ## Pitfalls (DO NOT reintroduce these)
// 1. NEVER pass inline arrow functions as props to memoized components
//    (e.g. onToggleRender={() => ...}) — they break React.memo on every render.
//    Use useCallback or pass stable references instead.
// 2. NEVER compute new arrays/objects in JSX (e.g. previewTabs.map(...))
//    — they create new references every render, breaking parent memo.
//    Use useMemo or remove the prop if unused.
// 3. NEVER pass isActive to tab content components — visibility is controlled
//    by the wrapper div in PreviewPanel. Content components must not re-render
//    on tab switch.
// 4. NEVER use display:none for hiding tabs — it causes full re-layout on show.
//    Use visibility:hidden + pointer-events:none instead (zero layout cost).

import { useState, useEffect, useCallback, useRef } from "react";
import { useEvents } from "./hooks/useEvents";
import { useIpc } from "./hooks/useIpc";
import { ThreeColumnLayout } from "./components/layout/ThreeColumnLayout";
import { AgentTree } from "./components/agent/AgentTree";
import { WorkspaceDir } from "./components/workspace/WorkspaceDir";
import { ChatPanel } from "./components/chat/ChatPanel";
import { PreviewPanel } from "./components/preview/PreviewPanel";
import { OnboardingPage } from "./components/onboarding/OnboardingPage";
import { inferTabType } from "./components/preview/tab-registry";
import type { PreviewTab, TabContent } from "./components/preview/tab-types";
import type { FsTreeNode, ConversationMessage, SessionInfo, FileReference } from "./lib/types";
import { markTabSwitchStart, markTabSwitchPhase, useRenderTime } from "./lib/debug-perf";

const pendingSwitchId = { current: "" };

export default function App() {
  useRenderTime("App");
  const [isConfigured, setIsConfigured] = useState(false);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [fsTree, setFsTree] = useState<FsTreeNode[]>([]);
  const [fsMode, setFsMode] = useState<"docs" | "all">("docs");
  const [previewTabs, setPreviewTabs] = useState<PreviewTab[]>([]);
  const [activeTabKey, setActiveTabKey] = useState<string>("");
  const [tabContents, setTabContents] = useState<Map<string, TabContent>>(new Map());
  const [scrollToLine, setScrollToLine] = useState<number | undefined>(undefined);
  const [fileRefs, setFileRefs] = useState<FileReference[]>([]);
  const [workspaceConfig, setWorkspaceConfig] = useState<{ provider: string; modelName: string; baseUrl?: string; projectRoot: string } | null>(null);

  const ipc = useIpc();
  const events = useEvents();

  // On mount: try to recover existing session or persisted config
  useEffect(() => {
    (async () => {
      // 1. Try to get an already-running session
      const info = await ipc.getSessionInfo();
      if (info) {
        setSessionInfo(info);
        setSelectedUnitId(info.unitId);
        setIsConfigured(true);
        return;
      }

      // 2. Check workspace for existing session data
      const status = await ipc.checkWorkspaceStatus();
      if (status.has_session && status.config) {
        const persisted = await ipc.loadPersistedConfig();
        if (persisted && persisted.api_key) {
          const result = await ipc.startSession({
            provider: status.config.provider,
            modelName: status.config.model_name,
            apiKey: persisted.api_key,
            baseUrl: status.config.base_url,
            projectRoot: status.config.project_root,
          });
          if (result && "unitId" in result) {
            setSessionInfo(result as SessionInfo);
            setSelectedUnitId((result as SessionInfo).unitId);
            setIsConfigured(true);
            return;
          }
        }

        // Need API key from user — show onboarding with pre-filled fields
        setWorkspaceConfig({
          provider: status.config.provider,
          modelName: status.config.model_name,
          baseUrl: status.config.base_url ?? undefined,
          projectRoot: status.config.project_root ?? "",
        });
        return;
      }

      // 3. No workspace session — try persisted config
      const persisted = await ipc.loadPersistedConfig();
      if (persisted && persisted.provider && persisted.api_key) {
        const result = await ipc.startSession({
          provider: persisted.provider,
          modelName: persisted.model_name ?? persisted.modelName ?? "",
          apiKey: persisted.api_key,
          baseUrl: persisted.base_url ?? persisted.baseUrl,
          projectRoot: persisted.project_root ?? persisted.projectRoot,
        });
        if (result && "unitId" in result) {
          setSessionInfo(result as SessionInfo);
          setSelectedUnitId((result as SessionInfo).unitId);
          setIsConfigured(true);
        }
      }
      // else: show OnboardingPage
    })();
  }, []);

  // Load session info and FS tree when configured
  useEffect(() => {
    if (!isConfigured) return;
    ipc.getSessionInfo().then((info) => { if (info) setSessionInfo(info); });
    ipc.getFsTree(fsMode).then((tree) => setFsTree(tree));
  }, [isConfigured, fsMode]);

  // Load messages when selected unit changes
  useEffect(() => {
    if (!selectedUnitId) return;
    ipc.getUnitMessages(selectedUnitId).then((msgs) => setMessages(msgs));
  }, [selectedUnitId]);

  // Handle pushed events from main process
  useEffect(() => {
    if (!events.lastEvent) return;
    const event = events.lastEvent;

    if (event.type === "agent-message" || event.type === "proposal" || event.type === "vote" ||
        event.type === "tool-result" || event.type === "upward-message" ||
        event.type === "state-transition" || event.type === "turn-start" ||
        event.type === "incoming-message") {
      if (selectedUnitId) {
        ipc.getUnitMessages(selectedUnitId).then((msgs) => setMessages(msgs));
      }
    }

    if (event.type === "unit-tree-change" || event.type === "child-spawned" || event.type === "state-transition") {
      ipc.getSessionInfo().then((info) => { if (info) setSessionInfo(info); });
    }

    if (event.type === "fs-change") {
      ipc.getFsTree(fsMode).then((tree) => setFsTree(tree));

      const changes = (event as any).changes as Array<{ path: string; kind: "create" | "update" | "delete" }> | undefined;
      if (changes) {
        const deletedPaths = new Set(changes.filter(c => c.kind === "delete").map(c => c.path));
        const updatedPaths = new Set(changes.filter(c => c.kind === "update").map(c => c.path));

        // Update all mounted tabs affected by fs-change
        setTabContents(prev => {
          const next = new Map(prev);
          let changed = false;

          for (const path of deletedPaths) {
            const existing = next.get(path);
            if (existing && !existing.fileDeleted) {
              next.set(path, { ...existing, fileDeleted: true });
              changed = true;
            }
          }

          for (const path of updatedPaths) {
            const existing = next.get(path);
            if (existing) {
              // Re-read updated file in background, preserve renderAsMarkdown
              ipc.readFile(path).then((result) => {
                if (result) {
                  setTabContents(prev2 => {
                    const next2 = new Map(prev2);
                    next2.set(path, {
                      content: result.content,
                      extension: result.extension,
                      renderAsMarkdown: existing.renderAsMarkdown,
                    });
                    return next2;
                  });
                }
              });
            }
          }

          return changed ? next : prev;
        });
      }
    }
  }, [events.lastEvent]);

  // Load file content for a tab key (called on tab open, not on switch)
  const loadTabContent = useCallback((path: string) => {
    ipc.readFile(path).then((result) => {
      if (result) {
        setTabContents(prev => {
          const next = new Map(prev);
          const existing = prev.get(path);
          next.set(path, {
            content: result.content,
            extension: result.extension,
            renderAsMarkdown: existing?.renderAsMarkdown ?? result.extension === ".md",
          });
          return next;
        });
      } else {
        setTabContents(prev => {
          const next = new Map(prev);
          const existing = prev.get(path);
          if (existing) {
            next.set(path, { ...existing, fileDeleted: true });
          }
          return next;
        });
      }
    });
  }, []);

  const handleSendMessage = useCallback(async (content: string) => {
    await ipc.sendMessage(content);
    setFileRefs([]);
  }, []);

  const handleAddReference = useCallback((ref: FileReference) => {
    setFileRefs((prev) => {
      const exists = prev.some((r) => r.path === ref.path && r.startLine === ref.startLine && r.endLine === ref.endLine);
      if (exists) return prev;
      return [...prev, ref];
    });
  }, []);

  const handleRemoveRef = useCallback((index: number) => {
    setFileRefs((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleOpenFile = useCallback((path: string, name: string, startLine?: number) => {
    setPreviewTabs(prev => {
      const existing = prev.find(t => t.key === path);
      if (existing) {
        // Tab already open — just activate it
        setActiveTabKey(path);
        return prev;
      }
      // New tab — add and load content
      const newTab: PreviewTab = { key: path, title: name, type: inferTabType(path.slice(path.lastIndexOf("."))) };
      setActiveTabKey(path);
      loadTabContent(path);
      return [...prev, newTab];
    });
    if (startLine !== undefined) {
      setScrollToLine(startLine);
      setTimeout(() => setScrollToLine(undefined), 100);
    }
  }, []);

  const handleViewContext = useCallback(async (messageId: string) => {
    const result = await ipc.reconstructContext(messageId);
    if (result.ok && result.path && result.name) {
      handleOpenFile(result.path, result.name);
    } else {
      console.error("[ViewContext] Failed:", result.error);
    }
  }, []);

  const activeTabKeyRef = useRef(activeTabKey);
  activeTabKeyRef.current = activeTabKey;

  const handleCloseTab = useCallback((key: string) => {
    setPreviewTabs(prev => {
      const newTabs = prev.filter(t => t.key !== key);
      // If closing the active tab, activate the last remaining tab
      if (key === activeTabKeyRef.current) {
        const last = newTabs[newTabs.length - 1];
        setActiveTabKey(last?.key ?? "");
      }
      return newTabs;
    });
    // Remove content for closed tab (triggers React unmount)
    setTabContents(prev => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const [configError, setConfigError] = useState<string | null>(null);

  const handleConfigComplete = useCallback(async (config: {
    provider: string;
    modelName: string;
    apiKey: string;
    baseUrl?: string;
    projectRoot: string;
  }) => {
    setConfigError(null);

    const result = await ipc.startSession(config);
    if (result && "error" in result) {
      setConfigError(result.error);
      return;
    }
    if (result && "unitId" in result) {
      setSessionInfo(result as SessionInfo);
      setSelectedUnitId((result as SessionInfo).unitId);
      setIsConfigured(true);
    }
  }, []);

  // Show onboarding if not configured
  if (!isConfigured) {
    return <OnboardingPage onComplete={handleConfigComplete} initialConfig={workspaceConfig ?? undefined} error={configError} />;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="titlebar-drag" />
      <div className="flex-1 min-h-0">
        <ThreeColumnLayout>
      {/* Left Panel */}
      <div className="flex flex-col h-full">
        <div className="h-1/2 min-h-0 overflow-y-auto border-b border-[var(--color-border)]">
          <AgentTree
            tree={sessionInfo?.tree ?? null}
            selectedUnitId={selectedUnitId}
            onSelectUnit={setSelectedUnitId}
          />
        </div>
        <div className="h-1/2 min-h-0 overflow-y-auto">
          <WorkspaceDir
            tree={fsTree}
            mode={fsMode}
            onModeChange={setFsMode}
            onOpenFile={handleOpenFile}
            activeFilePath={activeTabKey}
          />
        </div>
      </div>

      {/* Center Panel */}
      <ChatPanel
        unitId={selectedUnitId}
        sessionInfo={sessionInfo}
        messages={messages}
        onSendMessage={handleSendMessage}
        onSelectUnit={setSelectedUnitId}
        onOpenFile={handleOpenFile}
        onViewContext={handleViewContext}
        refs={fileRefs}
        onRemoveRef={handleRemoveRef}
      />

      {/* Right Panel */}
      <PreviewPanel
        tabs={previewTabs}
        activeKey={activeTabKey}
        onSelectTab={(key: string) => {
          const id = markTabSwitchStart(key);
          pendingSwitchId.current = id;
          setActiveTabKey(key);
          markTabSwitchPhase(id, "setActiveTabKey-done");
        }}
        onCloseTab={handleCloseTab}
        tabContents={tabContents}
        scrollToLine={scrollToLine}
        onAddRef={handleAddReference}
      />
    </ThreeColumnLayout>
      </div>
    </div>
  );
}
