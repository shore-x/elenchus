// Elenchus GUI - Electron API Type Definitions
// Declares the window.electronAPI interface exposed by the preload script.

import type { SessionInfo, UnitInfo, ConversationMessage, FsTreeNode, FileContent, ProviderInfo, ModelInfo, ServerEvent } from "./types";

export interface ElectronAPI {
  // --- Session lifecycle ---
  startSession: (config: Record<string, unknown>) => Promise<SessionInfo | { error: string }>;
  terminateSession: () => Promise<{ ok: boolean; error?: string }>;
  getSessionInfo: () => Promise<SessionInfo | null>;

  // --- Data queries ---
  getUnitInfo: (unitId: string) => Promise<UnitInfo | null>;
  getUnitMessages: (unitId: string, opts?: { before?: number; limit?: number }) => Promise<ConversationMessage[]>;
  sendMessage: (content: string) => Promise<{ ok: boolean; error?: string }>;

  // --- File system ---
  getFsTree: (mode: "docs" | "all") => Promise<FsTreeNode[]>;
  readFile: (path: string) => Promise<FileContent | null>;
  showItemInFolder: (path: string) => Promise<void>;

  // --- Context reconstruction ---
  reconstructContext: (messageId: string) => Promise<{ ok: boolean; path?: string; name?: string; error?: string }>;

  // --- Config ---
  getProviders: () => Promise<ProviderInfo[]>;
  getModels: (provider: string) => Promise<ModelInfo[]>;
  validateConfig: (config: { provider: string; modelName: string; baseUrl?: string }) => Promise<{ valid: boolean; error?: string }>;
  loadPersistedConfig: () => Promise<Record<string, string> | null>;
  savePersistedConfig: (config: Record<string, unknown>) => Promise<{ ok: boolean }>;
  checkWorkspaceStatus: () => Promise<{ has_session: boolean; config: { provider: string; modelName: string; baseUrl?: string; projectRoot?: string } | null }>;

  // --- Event streams ---
  onSystemEvent: (callback: (event: ServerEvent) => void) => () => void;
  onFsChange: (callback: (changes: unknown) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
