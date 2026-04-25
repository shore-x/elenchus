// Elenchus - Electron Main Process
// Manages the application lifecycle, BrowserWindow, and the DeliberationSession.
// Agent core logic runs directly in the main process — no sidecar, no pkg, no child_process issues.

import { app, BrowserWindow, dialog } from "electron";
import { join } from "node:path";
import { homedir } from "node:os";
import { registerSessionIpc } from "./ipc/session.js";
import { registerDataIpc } from "./ipc/data.js";
import { registerConfigIpc } from "./ipc/config.js";
import { createFsWatcher, type FsChange } from "./ipc/fs-watcher.js";

// Prevent silent crashes — log and show errors instead
process.on("uncaughtException", (error) => {
  console.error("[main] Uncaught Exception:", error);
  dialog.showErrorBox("Elenchus - Main Process Error", error.message + "\n\n" + error.stack);
});
process.on("unhandledRejection", (reason) => {
  console.error("[main] Unhandled Rejection:", reason);
});

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "Elenchus",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Development: load from dev server
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Open DevTools in development
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(() => {
  createWindow();

  // Register all IPC handlers
  const sendToRenderer = (channel: string, data: unknown) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data);
    }
  };

  const fsWatcher = createFsWatcher(
    join(homedir(), "Elenchus"),
    (changes: FsChange[]) => sendToRenderer("fs-change", { type: "fs-change", changes }),
  );

  registerSessionIpc(sendToRenderer, fsWatcher);
  registerDataIpc();
  registerConfigIpc();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
