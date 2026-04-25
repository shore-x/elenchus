// Elenchus - IPC: Session Lifecycle
// Manages DeliberationSession creation, termination, and event forwarding.
// Replaces the Tauri start_sidecar / get_sidecar_port / check_workspace_status commands.

import { ipcMain } from "electron";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import ElectronStore from "electron-store";
import { createSession } from "../../src/application/runtime.js";
import { createPiAiLlmClient } from "../../src/adapters/llm/pi-ai-client.js";
import { LocalNodeToolExecutor } from "../../src/adapters/tools/local-node-tool-executor.js";
import { SqliteSessionPersistence } from "../../src/adapters/storage/sqlite/sqlite-session-persistence.js";
import type { DeliberationSession } from "../../src/application/session.js";
import type { SystemEvent } from "../../src/core/types.js";

interface FsWatcher { start(): void; close(): void; updateRoot(root: string): void; }

const store = new ElectronStore({
  name: "elenchus-config",
  defaults: {},
});

let session: DeliberationSession | null = null;

export function getSession(): DeliberationSession | null {
  return session;
}

function buildAgentTree(snapshot: any): any {
  return {
    unitId: snapshot.unitId,
    level: snapshot.level,
    path: snapshot.path,
    state: snapshot.state,
    children: snapshot.children.map((child: any) => buildAgentTree(child.snapshot)),
  };
}

export function registerSessionIpc(
  sendToRenderer: (channel: string, data: unknown) => void,
  fsWatcher: FsWatcher,
): void {

  // --- Start session ---
  ipcMain.handle("start-session", async (_event, config: {
    provider: string;
    modelName: string;
    apiKey: string;
    baseUrl?: string;
    projectRoot?: string;
    level?: string;
  }) => {
    if (session) {
      session.close();
      session = null;
    }

    // Set API key env var so pi-ai can pick it up
    const envVarMap: Record<string, string> = {
      anthropic: "ANTHROPIC_API_KEY",
      openai: "OPENAI_API_KEY",
      google: "GOOGLE_API_KEY",
      xai: "XAI_API_KEY",
      deepseek: "DEEPSEEK_API_KEY",
    };
    const envVar = envVarMap[config.provider];
    if (envVar && config.apiKey) {
      process.env[envVar] = config.apiKey;
    }

    const llmClient = createPiAiLlmClient({
      provider: config.provider,
      modelName: config.modelName,
      baseUrl: config.baseUrl,
    });

    if (!llmClient) {
      return { error: `Failed to create LLM client for ${config.provider}/${config.modelName}` };
    }

    const workspaceRoot = join(homedir(), "Elenchus");
    const projectRoot = config.projectRoot ?? process.cwd();

    try {
      session = createSession({
        llmClient,
        toolExecutor: new LocalNodeToolExecutor(),
        workspaceRoot,
        projectRoot,
        level: config.level as any ?? undefined,
        persistence: new SqliteSessionPersistence({ workspaceRoot, projectRoot }),
        onSystemEvent: (event: SystemEvent) => {
          sendToRenderer("system-event", event);

          // Auto-broadcast unit-tree-change for tree-modifying events
          if (
            event.type === "child-spawned" ||
            event.type === "state-transition" ||
            event.type === "upward-message"
          ) {
            sendToRenderer("system-event", { type: "unit-tree-change" });
          }
        },
      });

      // Persist config for next startup
      store.set("provider", config.provider);
      store.set("modelName", config.modelName);
      store.set("apiKey", config.apiKey);
      if (config.baseUrl) store.set("baseUrl", config.baseUrl);
      if (config.projectRoot) store.set("projectRoot", config.projectRoot);

      // Update fs watcher root
      fsWatcher.updateRoot(workspaceRoot);

      const snapshot = session.exportSnapshot();
      return {
        unitId: snapshot.unitId,
        state: snapshot.state,
        level: snapshot.level,
        tree: buildAgentTree(snapshot),
      };
    } catch (err: any) {
      return { error: err.message ?? "Failed to start session" };
    }
  });

  // --- Terminate session ---
  ipcMain.handle("terminate-session", async () => {
    if (session) {
      session.terminate();
      session.close();
      session = null;
      return { ok: true };
    }
    return { ok: false, error: "No active session" };
  });

  // --- Get session info ---
  ipcMain.handle("get-session-info", async () => {
    if (!session) return null;
    const snapshot = session.exportSnapshot();
    return {
      unitId: snapshot.unitId,
      state: snapshot.state,
      level: snapshot.level,
      tree: buildAgentTree(snapshot),
    };
  });

  // --- Load persisted config ---
  ipcMain.handle("load-persisted-config", async () => {
    const provider = store.get("provider") as string | undefined;
    const modelName = store.get("modelName") as string | undefined;
    const apiKey = store.get("apiKey") as string | undefined;
    const baseUrl = store.get("baseUrl") as string | undefined;
    const projectRoot = store.get("projectRoot") as string | undefined;

    if (!provider || !modelName) return null;
    return { provider, modelName, apiKey, baseUrl, projectRoot };
  });

  // --- Save persisted config ---
  ipcMain.handle("save-persisted-config", async (_event, config: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(config)) {
      if (value !== undefined) {
        store.set(key, value);
      }
    }
    return { ok: true };
  });

  // --- Check workspace status ---
  ipcMain.handle("check-workspace-status", async () => {
    const workspaceRoot = join(homedir(), "Elenchus");
    const hasSession = existsSync(join(workspaceRoot, "elenchus.db"));
    const provider = store.get("provider") as string | undefined;
    const modelName = store.get("modelName") as string | undefined;
    const baseUrl = store.get("baseUrl") as string | undefined;
    const projectRoot = store.get("projectRoot") as string | undefined;

    return {
      has_session: hasSession,
      config: (provider && modelName) ? { provider, model_name: modelName, base_url: baseUrl, project_root: projectRoot } : null,
    };
  });

  // --- Cleanup on app quit ---
  ipcMain.handle("close-session", async () => {
    if (session) {
      session.close();
      session = null;
    }
  });
}
