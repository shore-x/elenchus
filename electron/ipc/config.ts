// Elenchus - IPC: Config Management
// Provides provider/model introspection, config validation, and persisted config access.
// Replaces the REST API config endpoints and Tauri store commands.

import { ipcMain } from "electron";

export function registerConfigIpc(): void {

  // --- Provider/model introspection ---
  ipcMain.handle("get-providers", async () => {
    try {
      const { getProviders } = await import("@mariozechner/pi-ai");
      const providers = getProviders();
      return providers.map((id: string) => ({ id, name: id }));
    } catch {
      return [];
    }
  });

  ipcMain.handle("get-models", async (_event, provider: string) => {
    try {
      const { getModels } = await import("@mariozechner/pi-ai");
      const models = getModels(provider as any);
      return models.map((m: any) => ({ id: m.id, name: m.name }));
    } catch {
      return [];
    }
  });

  // --- Validate config (test LLM connection) ---
  ipcMain.handle("validate-config", async (_event, config: { provider: string; modelName: string; baseUrl?: string }) => {
    try {
      const { createPiAiLlmClient } = await import("../../src/adapters/llm/pi-ai-client.js");
      const client = createPiAiLlmClient(config);
      if (!client) {
        return { valid: false, error: `Could not create model: ${config.provider}/${config.modelName}` };
      }
      return { valid: true };
    } catch (err: any) {
      return { valid: false, error: err.message };
    }
  });
}
