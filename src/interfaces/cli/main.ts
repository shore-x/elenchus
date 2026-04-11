// Elenchus - CLI Main
// CLI is now a presentation adapter over the application session API.

import * as readline from "node:readline";
import { createSession } from "../../application/runtime.js";
import { createPiAiLlmClient } from "../../adapters/llm/pi-ai-client.js";
import { LocalNodeToolExecutor } from "../../adapters/tools/local-node-tool-executor.js";
import type { SystemEvent } from "../../core/types.js";
import { readCliConfig } from "./env.js";
import { printBanner, printInterrupted, printQueuedUserMessage, printStartupInfo, printTerminating, renderEvent } from "./renderer.js";

export async function main(): Promise<void> {
  const config = readCliConfig();
  const llmClient = createPiAiLlmClient({
    provider: config.provider,
    modelName: config.modelName,
    baseUrl: config.baseUrl,
  });

  if (!llmClient) {
    console.error(`Failed to get model: ${config.provider}/${config.modelName}`);
    console.error("Set ELENCHUS_PROVIDER and ELENCHUS_MODEL env vars, or ensure API keys are configured.");
    process.exit(1);
  }

  printBanner(config.level, config.verbose);
  printStartupInfo(config.provider, config.modelName, config.baseUrl, config.level);

  const session = createSession({
    llmClient,
    toolExecutor: new LocalNodeToolExecutor(),
    level: config.level,
    onSystemEvent: (event: SystemEvent) => {
      renderEvent(event, config.verbose);
    },
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "",
  });

  rl.on("line", (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    if (trimmed.toLowerCase() === "exit") {
      printTerminating();
      session.terminate();
      rl.close();
      return;
    }

    printQueuedUserMessage();
    session.sendUserMessage(trimmed);
  });

  rl.on("close", () => {
    process.exit(0);
  });

  process.on("SIGINT", () => {
    printInterrupted();
    session.terminate();
    process.exit(0);
  });

  process.stdin.resume();
}
