// Elenchus - File System Watcher
// Watches the workspace root directory for file changes and emits batched
// fs-change events via a callback. Uses Node.js built-in fs.watch with
// recursive mode (macOS/Windows). Debounces rapid events into batches.

import { watch, type FSWatcher } from "node:fs";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface FsChange {
  path: string;
  kind: "create" | "update" | "delete";
}

export type FsChangeCallback = (changes: FsChange[]) => void;

const DEBOUNCE_MS = 100;

export class FsWatcher {
  private watcher: FSWatcher | null = null;
  private pending = new Map<string, FsChange>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly callback: FsChangeCallback;
  private readonly root: string;

  constructor(root: string, callback: FsChangeCallback) {
    this.root = root;
    this.callback = callback;
  }

  start(): void {
    try {
      this.watcher = watch(this.root, { recursive: true, persistent: false }, (eventType, filename) => {
        if (!filename) return;

        const fullPath = join(this.root, filename);

        // Skip sidecar's own state directory
        if (filename.startsWith(".elenchus-state") || filename.includes(".elenchus-state/")) return;

        const kind = this.classifyChange(eventType, fullPath);
        this.pending.set(fullPath, { path: fullPath, kind });
        this.scheduleFlush();
      });
    } catch (err) {
      process.stderr.write(`[fs-watcher] Failed to start: ${err}\n`);
    }
  }

  close(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    this.pending.clear();
  }

  private classifyChange(eventType: string, fullPath: string): FsChange["kind"] {
    if (eventType === "change") return "update";
    // "rename" covers both create and delete — disambiguate by existence check
    return existsSync(fullPath) ? "create" : "delete";
  }

  private scheduleFlush(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, DEBOUNCE_MS);
  }

  private flush(): void {
    if (this.pending.size === 0) return;
    const changes = Array.from(this.pending.values());
    this.pending.clear();
    this.callback(changes);
  }
}
