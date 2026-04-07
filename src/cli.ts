// Elenchus MVP - CLI Entry Point
// Async user input: user can type at any time. Messages are written to the MessageBus
// and processed at the next turn boundary (P4). The deliberation loop runs concurrently
// with user input — stdin is never blocked by agent processing.

import * as readline from "node:readline";
import { getModel } from "@mariozechner/pi-ai";
import { DeliberationUnit } from "./deliberation-unit.js";
import type { AgentId } from "./types.js";

const AGENT_COLORS: Record<AgentId, string> = {
  "agent-a": "\x1b[36m", // cyan for Generator
  "agent-b": "\x1b[33m", // yellow for Verifier
};
const SYSTEM_COLOR = "\x1b[90m"; // gray
const REPORT_COLOR = "\x1b[32m"; // green
const RESET = "\x1b[0m";

function printBanner(): void {
  console.log(`${SYSTEM_COLOR}
╔══════════════════════════════════════════════════╗
║  Elenchus - Dual-Agent Deliberation Framework    ║
║  L0 MVP: Pure Deliberation Mode                  ║
╚══════════════════════════════════════════════════╝
${RESET}`);
  console.log(`${SYSTEM_COLOR}Type your question to start a deliberation.`);
  console.log(`You can send new messages at any time — they will be`);
  console.log(`processed at the next turn boundary.`);
  console.log(`Type "exit" to quit.${RESET}\n`);
}

async function main(): Promise<void> {
  // Parse CLI args for provider/model override
  const provider = process.env.ELENCHUS_PROVIDER ?? "anthropic";
  const modelName = process.env.ELENCHUS_MODEL ?? "claude-sonnet-4-20250514";

  const model = getModel(provider as any, modelName as any);
  if (!model) {
    console.error(`Failed to get model: ${provider}/${modelName}`);
    console.error("Set ELENCHUS_PROVIDER and ELENCHUS_MODEL env vars, or ensure API keys are configured.");
    process.exit(1);
  }

  // Allow overriding the base URL (e.g. for proxies or custom endpoints)
  const baseUrl = process.env.ELENCHUS_BASE_URL ?? process.env.ANTHROPIC_BASE_URL;
  if (baseUrl) {
    model.baseUrl = baseUrl;
  }

  printBanner();
  const baseUrlInfo = baseUrl ? ` (base: ${baseUrl})` : "";
  console.log(`${SYSTEM_COLOR}[System] Using model: ${provider}/${modelName}${baseUrlInfo}${RESET}\n`);

  const unit = new DeliberationUnit({
    model,
    onTextDelta: (agent: AgentId, delta: string) => {
      const color = AGENT_COLORS[agent];
      // Print text content with agent color, preserving newlines
      process.stdout.write(`${color}${delta}${RESET}`);
    },
    onSystemEvent: (message: string) => {
      if (message.startsWith("\n[Report]")) {
        process.stdout.write(`\n${REPORT_COLOR}${message.trim()}${RESET}\n`);
      } else if (message.startsWith("\n[")) {
        process.stdout.write(`\n${SYSTEM_COLOR}${message.trim()}${RESET}\n`);
      } else {
        process.stdout.write(`${SYSTEM_COLOR}${message}${RESET}`);
      }
    },
  });

  // Set up readline for async user input
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "",
  });

  // Use raw line events so user input is non-blocking relative to agent output
  rl.on("line", (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    if (trimmed.toLowerCase() === "exit") {
      console.log(`\n${SYSTEM_COLOR}[System] Terminating...${RESET}`);
      unit.terminate();
      rl.close();
      return;
    }

    // Inject user message into the bus — will be processed at next turn boundary
    console.log(`${SYSTEM_COLOR}[User message queued]${RESET}`);
    unit.injectUserMessage(trimmed);
  });

  rl.on("close", () => {
    process.exit(0);
  });

  // Keep the process alive
  process.stdin.resume();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
