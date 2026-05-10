// Elenchus - Electron Preload Script
// Exposes a safe IPC API to the renderer process via contextBridge.

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  // --- Session lifecycle ---
  startSession: (config: Record<string, unknown>) =>
    ipcRenderer.invoke("start-session", config),
  terminateSession: () =>
    ipcRenderer.invoke("terminate-session"),
  getSessionInfo: () =>
    ipcRenderer.invoke("get-session-info"),

  // --- Data queries ---
  getUnitInfo: (unitId: string) =>
    ipcRenderer.invoke("get-unit-info", unitId),
  getUnitMessages: (unitId: string, opts?: { before?: number; limit?: number }) =>
    ipcRenderer.invoke("get-unit-messages", unitId, opts),
  sendMessage: (content: string) =>
    ipcRenderer.invoke("send-message", content),

  // --- File system ---
  getFsTree: (mode: "docs" | "all") =>
    ipcRenderer.invoke("get-fs-tree", mode),
  readFile: (path: string) =>
    ipcRenderer.invoke("read-file", path),
  showItemInFolder: (path: string) =>
    ipcRenderer.invoke("show-item-in-folder", path),

  // --- Context reconstruction ---
  reconstructContext: (messageId: string) =>
    ipcRenderer.invoke("reconstruct-context", messageId),

  // --- Config ---
  getProviders: () =>
    ipcRenderer.invoke("get-providers"),
  getModels: (provider: string) =>
    ipcRenderer.invoke("get-models", provider),
  validateConfig: (config: { provider: string; modelName: string; baseUrl?: string }) =>
    ipcRenderer.invoke("validate-config", config),
  loadPersistedConfig: () =>
    ipcRenderer.invoke("load-persisted-config"),
  savePersistedConfig: (config: Record<string, unknown>) =>
    ipcRenderer.invoke("save-persisted-config"),
  checkWorkspaceStatus: () =>
    ipcRenderer.invoke("check-workspace-status"),

  // --- Event streams ---
  onSystemEvent: (callback: (event: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on("system-event", handler);
    return () => ipcRenderer.removeListener("system-event", handler);
  },
  onFsChange: (callback: (changes: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on("fs-change", handler);
    return () => ipcRenderer.removeListener("fs-change", handler);
  },
});
