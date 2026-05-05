// Elenchus - IPC: Data Queries
// Provides read-only access to session state, unit info, messages, and file system.
// Replaces the REST API endpoints that were served by the sidecar HTTP server.

import { ipcMain } from "electron";
import { readdir, readFile as fsReadFile, stat, mkdir } from "node:fs/promises";
import { writeFile as fsWriteFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, extname, basename } from "node:path";
import { getSession, getPersistence, getWorkspaceRoot } from "./session.js";
import { reconstructContext, formatContextAsMarkdown } from "../../src/core/context-reconstructor.js";
import type { ConversationMessage } from "../../src/core/types.js";

export function registerDataIpc(): void {

  // --- Unit info ---
  ipcMain.handle("get-unit-info", async (_event, unitId: string) => {
    const s = getSession();
    if (!s) return null;
    const unit = s.getRootUnit().findUnitById(unitId);
    if (!unit) return null;
    const snapshot = unit.exportSnapshot();
    return {
      unitId: snapshot.unitId,
      level: snapshot.level,
      path: snapshot.path,
      state: snapshot.state,
      turnCounter: snapshot.turnCounter,
      childCount: snapshot.children.length,
      commitLog: snapshot.commitLog,
    };
  });

  // --- Unit messages (paginated) ---
  ipcMain.handle("get-unit-messages", async (_event, unitId: string, opts?: { before?: number; limit?: number }) => {
    const s = getSession();
    if (!s) return [];
    const unit = s.getRootUnit().findUnitById(unitId);
    if (!unit) return [];

    const snapshot = unit.exportSnapshot();
    let messages = snapshot.ledger.messages as ConversationMessage[];

    if (opts?.before !== undefined && opts.before >= 0) {
      messages = messages.filter((_m, i) => {
        const seq = snapshot.ledger.sequenceStart + i;
        return seq < opts.before!;
      });
    }

    const limit = opts?.limit ?? 50;
    const hasMore = messages.length > limit;
    const result = hasMore ? messages.slice(-limit) : messages;

    return result;
  });

  // --- Send user message ---
  ipcMain.handle("send-message", async (_event, content: string) => {
    const s = getSession();
    if (!s) return { ok: false, error: "No active session" };
    console.log(`[IPC] send-message: "${content.slice(0, 100)}", unitState=${s.getState()}`);
    s.sendUserMessage(content);
    return { ok: true };
  });

  // --- File system tree ---
  ipcMain.handle("get-fs-tree", async (_event, mode: "docs" | "all") => {
    const root = join(homedir(), "Elenchus");
    return buildFsTree(root, mode === "docs", 3);
  });

  // --- Read file content ---
  ipcMain.handle("read-file", async (_event, filePath: string) => {
    try {
      const content = await fsReadFile(filePath, "utf-8");
      const ext = extname(filePath).toLowerCase();
      return { path: filePath, content, extension: ext };
    } catch {
      return null;
    }
  });

  // --- Reconstruct message context ---
  ipcMain.handle("reconstruct-context", async (_event, messageId: string) => {
    const persistence = getPersistence();
    if (!persistence) {
      return { ok: false, error: "No active session persistence" };
    }

    const wsRoot = getWorkspaceRoot();
    const ctx = reconstructContext({ persistence, workspaceRoot: wsRoot }, messageId);
    if (!ctx) {
      return { ok: false, error: "No context recipe found for this message. Early messages may not have recipe records." };
    }

    const markdown = formatContextAsMarkdown(ctx, messageId);

    // Write to ~/Elenchus/context-dumps/
    const dumpDir = join(wsRoot, "context-dumps");
    await mkdir(dumpDir, { recursive: true });
    const fileName = `context-${ctx.recipe.unitId}-${ctx.recipe.agentId}-turn${ctx.recipe.effectiveTurn}.md`;
    const filePath = join(dumpDir, fileName);
    await fsWriteFile(filePath, markdown, "utf-8");

    return { ok: true, path: filePath, name: fileName };
  });
}

// --- Helper: build file system tree ---

interface FsTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FsTreeNode[];
}

async function buildFsTree(dirPath: string, docsOnly: boolean, maxDepth: number): Promise<FsTreeNode[]> {
  if (maxDepth <= 0) return [];

  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const nodes: FsTreeNode[] = [];
  for (const entry of entries) {
    const name = entry.name;
    if (name.startsWith(".")) continue;

    const fullPath = join(dirPath, name);

    if (entry.isDirectory()) {
      const children = await buildFsTree(fullPath, docsOnly, maxDepth - 1);
      if (docsOnly && children.length === 0) continue;
      nodes.push({ name, path: fullPath, isDirectory: true, children });
    } else if (entry.isFile()) {
      if (docsOnly && extname(name).toLowerCase() !== ".md") continue;
      nodes.push({ name, path: fullPath, isDirectory: false });
    }
  }

  return nodes;
}
