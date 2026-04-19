import { useState, useEffect, useCallback } from "react";
import { useWebSocket } from "./hooks/useWebSocket";
import { useApi } from "./hooks/useApi";
import { ThreeColumnLayout } from "./components/layout/ThreeColumnLayout";
import { AgentTree } from "./components/agent/AgentTree";
import { WorkspaceDir } from "./components/workspace/WorkspaceDir";
import { ChatPanel } from "./components/chat/ChatPanel";
import { PreviewPanel } from "./components/preview/PreviewPanel";
import { OnboardingPage } from "./components/onboarding/OnboardingPage";
import type { FsTreeNode, ConversationMessage, SessionInfo, FileContent, FileReference } from "./lib/types";

export default function App() {
  const [sidecarPort, setSidecarPort] = useState<number | null>(null);
  const [isConfigured, setIsConfigured] = useState(false);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [fsTree, setFsTree] = useState<FsTreeNode[]>([]);
  const [fsMode, setFsMode] = useState<"docs" | "all">("docs");
  const [previewTabs, setPreviewTabs] = useState<{ path: string; name: string }[]>([]);
  const [activePreviewTab, setActivePreviewTab] = useState<number>(-1);
  const [previewContent, setPreviewContent] = useState<{ content: string; extension: string; renderAsMarkdown: boolean } | null>(null);
  const [scrollToLine, setScrollToLine] = useState<number | undefined>(undefined);
  const [fileRefs, setFileRefs] = useState<FileReference[]>([]);
  const [workspaceConfig, setWorkspaceConfig] = useState<{ provider: string; modelName: string; baseUrl?: string; projectRoot: string } | null>(null);

  const api = useApi(sidecarPort);
  const ws = useWebSocket(sidecarPort);

  // Discover sidecar port or recover persisted config on mount
  useEffect(() => {
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");

        // 1. Try to get already-running sidecar port
        try {
          const port = await invoke("get_sidecar_port") as number;
          setSidecarPort(port);
          setIsConfigured(true);
          return;
        } catch {}

        // 2. Check workspace for existing session data
        const status = await invoke("check_workspace_status") as {
          has_session: boolean;
          config: { provider: string; model_name: string; base_url?: string; project_root: string } | null;
        };

        if (status.has_session && status.config) {
          // Workspace has session data — recover config and auto-start sidecar
          // API key is not stored in workspace config, try Tauri store
          let apiKey = "";
          try {
            const saved = await invoke("load_persisted_config") as {
              provider: string; model_name: string; api_key: string;
            } | null;
            if (saved) apiKey = saved.api_key;
          } catch {}

          if (!apiKey) {
            // Need API key from user — show onboarding with pre-filled fields
            setWorkspaceConfig({
              provider: status.config.provider,
              modelName: status.config.model_name,
              baseUrl: status.config.base_url ?? undefined,
              projectRoot: status.config.project_root,
            });
            return;
          }

          const port = await invoke("start_sidecar", {
            config: {
              provider: status.config.provider,
              modelName: status.config.model_name,
              apiKey,
              baseUrl: status.config.base_url,
              projectRoot: status.config.project_root,
            }
          }) as number;
          setSidecarPort(port);
          setIsConfigured(true);
          return;
        }

        // 3. No workspace session — try Tauri store config
        const config = await invoke("load_persisted_config") as {
          provider: string;
          model_name: string;
          api_key: string;
          base_url?: string;
          project_root: string;
        } | null;
        if (config) {
          const port = await invoke("start_sidecar", {
            config: {
              provider: config.provider,
              modelName: config.model_name,
              apiKey: config.api_key,
              baseUrl: config.base_url,
              projectRoot: config.project_root,
            }
          }) as number;
          setSidecarPort(port);
          setIsConfigured(true);
        }
        // else: show OnboardingPage
      } catch {
        // Browser-only dev mode: try env var or localStorage
        const envPort = parseInt((import.meta as any).env?.VITE_SIDECAR_PORT ?? "0", 10);
        if (envPort > 0) {
          setSidecarPort(envPort);
          setIsConfigured(true);
        } else {
          // Try recovering config from localStorage
          const saved = localStorage.getItem("elenchus_config");
          if (saved) {
            try {
              JSON.parse(saved);
              const portStr = window.prompt("Enter sidecar port (or cancel to reconfigure)", "3000");
              if (portStr) {
                const port = parseInt(portStr, 10);
                if (port > 0) {
                  setSidecarPort(port);
                  setIsConfigured(true);
                }
              }
            } catch {}
          }
        }
      }
    })();
  }, []);

  // Check if configured on mount
  useEffect(() => {
    if (!sidecarPort) return;
    api.getSessionInfo().then((info: SessionInfo | null) => {
      if (info) {
        setIsConfigured(true);
        setSessionInfo(info);
        setSelectedUnitId(info.unitId);
      }
    }).catch(() => {
      // Not configured yet
      setIsConfigured(false);
    });
  }, [sidecarPort]);

  // Load session info and FS tree when configured
  useEffect(() => {
    if (!isConfigured || !sidecarPort) return;
    api.getSessionInfo().then((info: SessionInfo | null) => { if (info) setSessionInfo(info); });
    api.getFsTree(fsMode).then((tree: FsTreeNode[]) => setFsTree(tree));
  }, [isConfigured, sidecarPort, fsMode]);

  // Load messages when selected unit changes
  useEffect(() => {
    if (!selectedUnitId || !sidecarPort) return;
    api.getUnitMessages(selectedUnitId).then((msgs: ConversationMessage[]) => setMessages(msgs));
  }, [selectedUnitId, sidecarPort]);

  // Handle WebSocket events
  useEffect(() => {
    if (!ws.lastEvent) return;
    const event = ws.lastEvent;

    if (event.type === "agent-message" || event.type === "proposal" || event.type === "vote" ||
        event.type === "tool-result" || event.type === "upward-message" ||
        event.type === "state-transition" || event.type === "turn-start") {
      // Reload messages for current unit
      if (selectedUnitId) {
        api.getUnitMessages(selectedUnitId).then((msgs: ConversationMessage[]) => setMessages(msgs));
      }
    }

    if (event.type === "unit-tree-change" || event.type === "child-spawned" || event.type === "state-transition") {
      api.getSessionInfo().then((info: SessionInfo | null) => { if (info) setSessionInfo(info); });
    }
  }, [ws.lastEvent]);

  // Load preview file content
  useEffect(() => {
    if (activePreviewTab < 0 || !previewTabs[activePreviewTab]) {
      setPreviewContent(null);
      return;
    }
    const tab = previewTabs[activePreviewTab];
    api.readFile(tab.path).then((result: FileContent | null) => {
      if (result) {
        setPreviewContent({
          content: result.content,
          extension: result.extension,
          renderAsMarkdown: result.extension === ".md",
        });
      }
    });
  }, [activePreviewTab, previewTabs]);

  const handleSendMessage = useCallback(async (content: string) => {
    await api.sendMessage(content);
    setFileRefs([]);
  }, [api]);

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

    // Try Tauri mode first
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const port = await invoke("start_sidecar", { config }) as number;
      setSidecarPort(port);
      setIsConfigured(true);
      return;
    } catch (err: any) {
      // Tauri invoke failed — show the error
      const msg = err?.toString?.() ?? String(err);
      console.error("[start_sidecar]", msg);
      setConfigError(`Failed to start sidecar: ${msg}`);
      return;
    }
  }, []);

  // Show onboarding if not configured
  if (!isConfigured) {
    return <OnboardingPage onComplete={handleConfigComplete} initialConfig={workspaceConfig ?? undefined} error={configError} />;
  }

  return (
    <ThreeColumnLayout>
      {/* Left Panel */}
      <div className="flex flex-col h-full">
        <div className="flex-1 min-h-0 overflow-y-auto border-b border-gray-200">
          <AgentTree
            tree={sessionInfo?.tree ?? null}
            selectedUnitId={selectedUnitId}
            onSelectUnit={setSelectedUnitId}
          />
        </div>
        <div className="h-[40%] min-h-[120px] overflow-y-auto">
          <WorkspaceDir
            tree={fsTree}
            mode={fsMode}
            onModeChange={setFsMode}
            onOpenFile={handleOpenFile}
            openFilePaths={previewTabs.map(t => t.path)}
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
        onAddReference={handleAddReference}
      />
    </ThreeColumnLayout>
  );
}
