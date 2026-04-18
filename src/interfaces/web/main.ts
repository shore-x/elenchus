// Elenchus - Sidecar Entry Point
// Dual-mode entry: --cli runs the traditional CLI, --serve starts the HTTP/WS sidecar
// for the Tauri GUI frontend. The sidecar writes its port to stdout on startup
// so the Tauri shell can discover it.

import { cwd } from "node:process";
import { homedir } from "node:os";
import { join } from "node:path";
import { createSession } from "../../application/runtime.js";
import { createPiAiLlmClient } from "../../adapters/llm/pi-ai-client.js";
import { SqliteSessionPersistence } from "../../adapters/storage/sqlite/sqlite-session-persistence.js";
import { LocalNodeToolExecutor } from "../../adapters/tools/local-node-tool-executor.js";
import { SidecarServer } from "./server.js";
import type { SystemEvent } from "../../core/types.js";

export interface SidecarConfig {
  provider: string;
  modelName: string;
  apiKey?: string;
  baseUrl?: string;
  level?: string;
  workspaceRoot?: string;
  projectRoot?: string;
}

function parseArgs(args: string[]): { mode: "cli" | "serve"; config: SidecarConfig } {
  const mode = args.includes("--serve") ? "serve" : "cli";
  const config: SidecarConfig = {
    provider: "anthropic",
    modelName: "claude-sonnet-4-20250514",
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--provider":
        config.provider = args[++i];
        break;
      case "--model":
        config.modelName = args[++i];
        break;
      case "--api-key":
        config.apiKey = args[++i];
        break;
      case "--base-url":
        config.baseUrl = args[++i];
        break;
      case "--level":
        config.level = args[++i];
        break;
      case "--workspace-root":
        config.workspaceRoot = args[++i];
        break;
      case "--project-root":
        config.projectRoot = args[++i];
        break;
    }
  }

  return { mode, config };
}

function apiKeyEnvFor(provider: string): string {
  const map: Record<string, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    google: "GOOGLE_API_KEY",
    xai: "XAI_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
  };
  return map[provider] ?? "";
}

function scopeLabel(scope: { level: string; path: number[] }): string {
  return `${scope.level}:${scope.path.join(".")}`;
}

function logEvent(event: SystemEvent): void {
  const ts = new Date().toISOString().slice(11, 19);
  const s = scopeLabel(event.scope);
  switch (event.type) {
    case "state-transition":
      process.stderr.write(`[${ts}] [${s}] ${event.from} → ${event.to}\n`);
      break;
    case "agent-message":
      process.stderr.write(`[${ts}] [${s}] ${event.agent}: ${event.content.slice(0, 120)}${event.content.length > 120 ? "..." : ""}\n`);
      break;
    case "proposal":
      process.stderr.write(`[${ts}] [${s}] ${event.agent} propose: ${event.toolName}\n`);
      break;
    case "vote":
      process.stderr.write(`[${ts}] [${s}] ${event.voter} ${event.approve ? "approve" : "reject"} ${event.toolName}\n`);
      break;
    case "tool-executing":
      process.stderr.write(`[${ts}] [${s}] executing: ${event.toolName}\n`);
      break;
    case "tool-result":
      process.stderr.write(`[${ts}] [${s}] ${event.toolName} ${event.success ? "ok" : "FAIL"} (${(event.durationMs / 1000).toFixed(1)}s)\n`);
      break;
    case "error":
      process.stderr.write(`[${ts}] [${s}] ERROR: ${event.message}\n`);
      break;
    case "warning":
      process.stderr.write(`[${ts}] [${s}] WARN: ${event.message}\n`);
      break;
    case "turn-start":
      process.stderr.write(`[${ts}] [${s}] turn #${event.turn} ${event.agent} (${event.contextSize} ctx)\n`);
      break;
    case "upward-message":
      process.stderr.write(`[${ts}] [${s}] ↑ ${event.deliveryMode}: ${event.content.slice(0, 80)}\n`);
      break;
    case "child-spawned":
      process.stderr.write(`[${ts}] [${s}] child spawned: ${event.task.slice(0, 80)}\n`);
      break;
    case "child-message-sent":
      process.stderr.write(`[${ts}] [${s}] → child: ${event.message.slice(0, 80)}\n`);
      break;
  }
}

async function runServe(config: SidecarConfig): Promise<void> {
  const workspaceRoot = config.workspaceRoot ?? join(homedir(), "Elenchus");
  const projectRoot = config.projectRoot ?? cwd();

  // Set provider-specific API key env var so pi-ai can pick it up
  if (config.apiKey) {
    const envVarMap: Record<string, string> = {
      anthropic: "ANTHROPIC_API_KEY",
      openai: "OPENAI_API_KEY",
      google: "GOOGLE_API_KEY",
      xai: "XAI_API_KEY",
      deepseek: "DEEPSEEK_API_KEY",
    };
    const envVar = envVarMap[config.provider];
    if (envVar) {
      process.env[envVar] = config.apiKey;
    }
  }

  const llmClient = createPiAiLlmClient({
    provider: config.provider,
    modelName: config.modelName,
    baseUrl: config.baseUrl,
  });

  if (!llmClient) {
    process.stderr.write(`ERROR: Failed to create LLM client for ${config.provider}/${config.modelName}\n`);
    process.exit(1);
  }

  const session = createSession({
    llmClient,
    toolExecutor: new LocalNodeToolExecutor(),
    workspaceRoot,
    projectRoot,
    level: (config.level as any) ?? undefined,
    persistence: new SqliteSessionPersistence({ workspaceRoot, projectRoot }),
  });

  const server = new SidecarServer({ session, workspaceRoot });

  // Wire session events to WebSocket broadcaster + terminal logging
  const originalHandler = session.getRootUnit().getOnSystemEvent();
  const serverHandler = server.getSystemEventHandler();
  session.getRootUnit().setOnSystemEvent((event: SystemEvent) => {
    originalHandler?.(event);
    serverHandler(event);
    logEvent(event);
  });

  const port = await server.start();

  // Write port to stdout so Tauri can read it
  process.stdout.write(`ELENCHUS_PORT=${port}\n`);
  process.stderr.write(`[sidecar] Listening on 127.0.0.1:${port}\n`);
  process.stderr.write(`[sidecar] Provider: ${config.provider} / ${config.modelName}\n`);
  process.stderr.write(`[sidecar] Workspace: ${workspaceRoot}\n`);
  process.stderr.write(`[sidecar] Project: ${projectRoot}\n`);
  const hasApiKey = config.apiKey || process.env[apiKeyEnvFor(config.provider)];
  process.stderr.write(`[sidecar] API key: ${hasApiKey ? "✓ configured" : "✗ NOT SET — LLM calls will fail"}\n`);

  // Handle graceful shutdown
  const shutdown = () => {
    session.close();
    server.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

export async function main(): Promise<void> {
  const { mode, config } = parseArgs(process.argv.slice(2));

  if (mode === "serve") {
    await runServe(config);
  } else {
    // Delegate to CLI main
    const { main: cliMain } = await import("../cli/main.js");
    await cliMain();
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err}\n`);
  process.exit(1);
});
