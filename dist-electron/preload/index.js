"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("electronAPI", {
  // --- Session lifecycle ---
  startSession: (config) => electron.ipcRenderer.invoke("start-session", config),
  terminateSession: () => electron.ipcRenderer.invoke("terminate-session"),
  getSessionInfo: () => electron.ipcRenderer.invoke("get-session-info"),
  // --- Data queries ---
  getUnitInfo: (unitId) => electron.ipcRenderer.invoke("get-unit-info", unitId),
  getUnitMessages: (unitId, opts) => electron.ipcRenderer.invoke("get-unit-messages", unitId, opts),
  sendMessage: (content) => electron.ipcRenderer.invoke("send-message", content),
  // --- File system ---
  getFsTree: (mode) => electron.ipcRenderer.invoke("get-fs-tree", mode),
  readFile: (path) => electron.ipcRenderer.invoke("read-file", path),
  showItemInFolder: (path) => electron.ipcRenderer.invoke("show-item-in-folder", path),
  // --- Context reconstruction ---
  reconstructContext: (messageId) => electron.ipcRenderer.invoke("reconstruct-context", messageId),
  // --- Config ---
  getProviders: () => electron.ipcRenderer.invoke("get-providers"),
  getModels: (provider) => electron.ipcRenderer.invoke("get-models", provider),
  validateConfig: (config) => electron.ipcRenderer.invoke("validate-config", config),
  loadPersistedConfig: () => electron.ipcRenderer.invoke("load-persisted-config"),
  savePersistedConfig: (config) => electron.ipcRenderer.invoke("save-persisted-config"),
  checkWorkspaceStatus: () => electron.ipcRenderer.invoke("check-workspace-status"),
  // --- Event streams ---
  onSystemEvent: (callback) => {
    const handler = (_event, data) => callback(data);
    electron.ipcRenderer.on("system-event", handler);
    return () => electron.ipcRenderer.removeListener("system-event", handler);
  },
  onFsChange: (callback) => {
    const handler = (_event, data) => callback(data);
    electron.ipcRenderer.on("fs-change", handler);
    return () => electron.ipcRenderer.removeListener("fs-change", handler);
  }
});
