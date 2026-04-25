// Elenchus - IPC: File System Watcher
// Watches the workspace root directory for file changes and emits batched
// fs-change events via a callback. Adapted from the sidecar's FsWatcher
// to work within the Electron main process.

import { watch, type FSWatcher, existsSync } from "node:fs";
import { join } from "node:path";

export interface FsChange {
  path: string;
  kind: "create" | "update" | "delete";
}

export type FsChangeCallback = (changes: FsChange[]) => void;

export interface FsWatcherHandle {
  start(): void;
  close(): void;
  updateRoot(root: string): void;
}

const DEBOUNCE_MS = 100;

export function createFsWatcher(root: string, callback: FsChangeCallback): FsWatcherHandle {
  let watcher: FSWatcher | null = null;
  let pending = new Map<string, FsChange>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let currentRoot = root;

  function start(): void {
    close();
    try {
      watcher = watch(currentRoot, { recursive: true, persistent: false }, (eventType, filename) => {
        if (!filename) return;

        const fullPath = join(currentRoot, filename);

        // Skip internal state directory
        if (filename.startsWith(".elenchus-state") || filename.includes(".elenchus-state/")) return;

        const kind = classifyChange(eventType, fullPath);
        pending.set(fullPath, { path: fullPath, kind });
        scheduleFlush();
      });
    } catch (err) {
      process.stderr.write(`[fs-watcher] Failed to start: ${err}\n`);
    }
  }

  function close(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (watcher) {
      watcher.close();
      watcher = null;
    }
    pending.clear();
  }

  function updateRoot(newRoot: string): void {
    currentRoot = newRoot;
    if (watcher) start(); // Restart watcher with new root
  }

  function classifyChange(eventType: string, fullPath: string): FsChange["kind"] {
    if (eventType === "change") return "update";
    return existsSync(fullPath) ? "create" : "delete";
  }

  function scheduleFlush(): void {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, DEBOUNCE_MS);
  }

  function flush(): void {
    if (pending.size === 0) return;
    const changes = Array.from(pending.values());
    pending.clear();
    callback(changes);
  }

  return { start, close, updateRoot };
}
