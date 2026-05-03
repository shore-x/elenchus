import { useState, useEffect, useCallback } from "react";
import { useEvents } from "./hooks/useEvents";
import { useIpc } from "./hooks/useIpc";
import { ThreeColumnLayout } from "./components/layout/ThreeColumnLayout";
import { AgentTree } from "./components/agent/AgentTree";
import { WorkspaceDir } from "./components/workspace/WorkspaceDir";
import { ChatPanel } from "./components/chat/ChatPanel";
import { PreviewPanel } from "./components/preview/PreviewPanel";
import { OnboardingPage } from "./components/onboarding/OnboardingPage";
import type { FsTreeNode, ConversationMessage, SessionInfo, FileReference } from "./lib/types";

export default function App() {
  const [isConfigured, setIsConfigured] = useState(false);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [fsTree, setFsTree] = useState<FsTreeNode[]>([]);
  const [fsMode, setFsMode] = useState<"docs" | "all">("docs");
  const [previewTabs, setPreviewTabs] = useState<{ path: string; name: string }[]>([]);
  const [activePreviewTab, setActivePreviewTab] = useState<number>(-1);
  const [previewContent, setPreviewContent] = useState<{ content: string; extension: string; renderAsMarkdown: boolean; fileDeleted?: boolean } | null>(null);
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

        const currentTab = previewTabs[activePreviewTab];
        if (currentTab) {
          if (deletedPaths.has(currentTab.path)) {
            setPreviewContent(prev => prev ? { ...prev, fileDeleted: true } : null);
          } else if (updatedPaths.has(currentTab.path)) {
            ipc.readFile(currentTab.path).then((result) => {
              if (result) {
                setPreviewContent({
                  content: result.content,
                  extension: result.extension,
                  renderAsMarkdown: result.extension === ".md",
                });
              }
            });
          }
        }
      }
    }
  }, [events.lastEvent]);

  // Load preview file content
  useEffect(() => {
    if (activePreviewTab < 0 || !previewTabs[activePreviewTab]) {
      setPreviewContent(null);
      return;
    }
    const tab = previewTabs[activePreviewTab];
    ipc.readFile(tab.path).then((result) => {
      if (result) {
        setPreviewContent({
          content: result.content,
          extension: result.extension,
          renderAsMarkdown: result.extension === ".md",
        });
      } else {
        setPreviewContent(prev => prev ? { ...prev, fileDeleted: true } : null);
      }
    });
  }, [activePreviewTab, previewTabs]);

  const handleSendMessage = useCallback(async (content: string) => {
    await ipc.sendMessage(content);
    setFileRefs([]);
  }, [ipc]);

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
    const existingIndex = previewTabs.findIndex(t => t.path === path);
    if (existingIndex >= 0) {
      setActivePreviewTab(existingIndex);
    } else {
      const newTabs = [...previewTabs, { path, name }];
      setPreviewTabs(newTabs);
      setActivePreviewTab(newTabs.length - 1);
    }
    if (startLine !== undefined) {
      setScrollToLine(startLine);
      // Reset after a tick so future clicks to same line still trigger scroll
      setTimeout(() => setScrollToLine(undefined), 100);
    }
  }, [previewTabs]);

  const handleViewContext = useCallback(async (messageId: string) => {
    const result = await ipc.reconstructContext(messageId);
    if (result.ok && result.path && result.name) {
      handleOpenFile(result.path, result.name);
    } else {
      console.error("[ViewContext] Failed:", result.error);
    }
  }, [ipc, handleOpenFile]);

  const handleCloseTab = useCallback((index: number) => {
    const newTabs = previewTabs.filter((_, i) => i !== index);
    setPreviewTabs(newTabs);
    if (activePreviewTab >= newTabs.length) {
      setActivePreviewTab(Math.max(0, newTabs.length - 1));
    } else if (activePreviewTab === index) {
      setActivePreviewTab(Math.min(index, newTabs.length - 1));
    }
  }, [previewTabs, activePreviewTab]);

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
  }, [ipc]);

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
            openFilePaths={previewTabs.map(t => t.path)}
            activeFilePath={previewTabs[activePreviewTab]?.path}
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
        activeTab={activePreviewTab}
        onSelectTab={setActivePreviewTab}
        onCloseTab={handleCloseTab}
        content={previewContent}
        onToggleRender={() => {
          if (previewContent) {
            setPreviewContent({ ...previewContent, renderAsMarkdown: !previewContent.renderAsMarkdown });
          }
        }}
        scrollToLine={scrollToLine}
        onAddRef={handleAddReference}
      />
    </ThreeColumnLayout>
      </div>
    </div>
  );
}
