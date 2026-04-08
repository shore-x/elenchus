// Elenchus - CLI Entry Point
// Async user input: user can type at any time. Messages are written to the MessageBus
// and processed at the next turn boundary (P4). The deliberation loop runs concurrently
// with user input — stdin is never blocked by agent processing.
// Supports L0/L1 via ELENCHUS_LEVEL, verbosity via ELENCHUS_VERBOSE (0/1/2).

import * as readline from "node:readline";
import { getModel } from "@mariozechner/pi-ai";
import { DeliberationUnit } from "./deliberation-unit.js";
import type { AgentId, SystemEvent, ToolLevel } from "./types.js";

// === Colors ===
const C = {
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  gray: "\x1b[90m",
  green: "\x1b[32m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
};

const AGENT_COLORS: Record<AgentId, string> = {
  "agent-a": C.cyan,
  "agent-b": C.yellow,
};

const AGENT_NAMES: Record<AgentId, string> = {
  "agent-a": "Generator",
  "agent-b": "Verifier",
};

function printBanner(level: ToolLevel, verbose: number): void {
  const modeDesc = level === "L1" ? "L1: Deliberation + Environment Tools" : "L0: Pure Deliberation Mode";
  console.log(`${C.gray}
╔══════════════════════════════════════════════════╗
║  Elenchus - Dual-Agent Deliberation Framework    ║
║  ${modeDesc.padEnd(47)} ║
╚══════════════════════════════════════════════════╝
${C.reset}`);
  console.log(`${C.gray}Type your question to start a deliberation.`);
  console.log(`You can send new messages at any time — they will be`);
  console.log(`processed at the next turn boundary.`);
  console.log(`Type "exit" to quit.${C.reset}\n`);
  if (verbose > 0) {
    console.log(`${C.dim}Verbose level: ${verbose}${C.reset}\n`);
  }
}

// Format tool arguments for display
function formatToolArgs(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case "bash":
      return String(args.command);
    case "readFile":
      return String(args.path);
    case "writeFile":
      return `${args.path} (${String(args.content).length} chars)`;
    case "yield":
      return String(args.content);
    case "spawnChild": {
      const task = String(args.task);
      return task.length > 100 ? task.slice(0, 100) + "..." : task;
    }
    case "sendToChild":
      return `${args.childId}: ${String(args.message).slice(0, 80)}${String(args.message).length > 80 ? "..." : ""}`;
    default:
      return JSON.stringify(args);
  }
}

// Categorize tools for CLI rendering.
const L0_CHILD_TOOLS = new Set(["spawnChild", "sendToChild"]);
function isL1Tool(toolName: string): boolean {
  return toolName !== "yield" && !L0_CHILD_TOOLS.has(toolName);
}
function isChildTool(toolName: string): boolean {
  return L0_CHILD_TOOLS.has(toolName);
}

// Render a structured SystemEvent to the terminal based on verbosity level.
// L0 (deliberation) events: gray.  L1 (tool) events: magenta with "L1" prefix and indent.
function renderEvent(event: SystemEvent, verbose: number): void {
  switch (event.type) {
    case "turn-start": {
      const name = AGENT_NAMES[event.agent];
      const color = AGENT_COLORS[event.agent];
      if (verbose >= 1) {
        const meta = `ctx: ${event.contextSize} msgs, +${event.newMessages} new`;
        process.stdout.write(`\n${C.dim}── Turn ${event.turn} ── ${color}${name}${C.reset}${C.dim} ── ${meta} ──${C.reset}\n`);
      } else {
        process.stdout.write(`\n${C.gray}[${name}]${C.reset}\n`);
      }
      break;
    }
    case "proposal": {
      const name = AGENT_NAMES[event.agent];
      const detail = formatToolArgs(event.toolName, event.args);
      if (isChildTool(event.toolName)) {
        // L0 child tool proposal — blue
        process.stdout.write(`${C.blue}[Child Proposal] ${name} → ${event.toolName}: ${detail}${C.reset}\n`);
      } else if (isL1Tool(event.toolName)) {
        // L1 env tool proposal — magenta, indented
        process.stdout.write(`${C.magenta}  [L1 Proposal] ${name} → ${event.toolName}: ${detail}${C.reset}\n`);
      } else {
        // L0 yield proposal — always show full content
        process.stdout.write(`${C.gray}[Proposal] ${name} \u2192 yield: ${detail}${C.reset}\n`);
      }
      break;
    }
    case "vote": {
      const voterName = AGENT_NAMES[event.voter];
      const tag = event.approve ? "APPROVE" : "REJECT";
      if (isChildTool(event.toolName)) {
        process.stdout.write(`${C.blue}[Child Vote] ${voterName} → ${event.toolName} ${tag}: ${event.reason}${C.reset}\n`);
      } else if (isL1Tool(event.toolName)) {
        process.stdout.write(`${C.magenta}  [L1 Vote] ${voterName} → ${event.toolName} ${tag}: ${event.reason}${C.reset}\n`);
      } else {
        process.stdout.write(`${C.gray}[Vote] ${voterName} → ${tag}: ${event.reason}${C.reset}\n`);
      }
      break;
    }
    case "report":
      process.stdout.write(`\n${C.green}[Report] ${event.content}${C.reset}\n`);
      break;
    case "state-transition":
      if (verbose >= 2) {
        process.stdout.write(`${C.dim}  [FSM] ${event.from} → ${event.to}${C.reset}\n`);
      }
      break;
    case "tool-executing": {
      const detail = formatToolArgs(event.toolName, event.args);
      process.stdout.write(`${C.magenta}  [L1 Executing] ${event.toolName}: ${detail}${C.reset}\n`);
      break;
    }
    case "tool-result": {
      const tag = event.success ? "✓" : "✗";
      const duration = verbose >= 1 ? ` (${(event.durationMs / 1000).toFixed(1)}s)` : "";
      const preview = event.output.length > 200 ? event.output.slice(0, 200) + "..." : event.output;
      process.stdout.write(`${C.magenta}  [L1 Result ${tag}]${duration} ${preview}${C.reset}\n`);
      break;
    }
    case "child-spawned":
      process.stdout.write(`${C.blue}[Child Spawned] ${event.childId}: ${event.task.length > 100 ? event.task.slice(0, 100) + "..." : event.task}${C.reset}\n`);
      break;
    case "child-progress": {
      const childAgent = AGENT_NAMES[event.agent];
      if (verbose >= 1) {
        process.stdout.write(`${C.dim}  [${event.childId}] Turn ${event.turn} → ${childAgent}${C.reset}\n`);
      }
      break;
    }
    case "child-turn-content": {
      const childAgent = AGENT_NAMES[event.agent];
      const text = event.content.trim();
      let preview: string;
      if (text.length <= 200) {
        preview = text;
      } else {
        preview = text.slice(0, 80) + " … " + text.slice(-80);
      }
      // Replace newlines with ↵ for single-line display
      preview = preview.replace(/\n/g, " ↵ ");
      process.stdout.write(`${C.dim}  [${event.childId}] ${childAgent}: ${preview}${C.reset}\n`);
      break;
    }
    case "child-reported": {
      const preview = event.content.length > 200 ? event.content.slice(0, 200) + "..." : event.content;
      process.stdout.write(`${C.blue}[Child Report] ${event.childId}: ${preview}${C.reset}\n`);
      break;
    }
    case "child-message-sent":
      process.stdout.write(`${C.blue}[Child Message] → ${event.childId}: ${event.message.length > 100 ? event.message.slice(0, 100) + "..." : event.message}${C.reset}\n`);
      break;
    case "warning":
      process.stdout.write(`${C.yellow}[Warning] ${event.message}${C.reset}\n`);
      break;
    case "error":
      process.stdout.write(`${C.red}[Error] ${event.message}${C.reset}\n`);
      break;
  }
}

async function main(): Promise<void> {
  // Parse CLI args for provider/model override
  const provider = process.env.ELENCHUS_PROVIDER ?? "anthropic";
  const modelName = process.env.ELENCHUS_MODEL ?? "claude-sonnet-4-20250514";

  const level = (process.env.ELENCHUS_LEVEL ?? "L0").toUpperCase() as ToolLevel;
  if (level !== "L0" && level !== "L1") {
    console.error(`Invalid ELENCHUS_LEVEL: ${level}. Must be L0 or L1.`);
    process.exit(1);
  }

  const verbose = Math.min(2, Math.max(0, parseInt(process.env.ELENCHUS_VERBOSE ?? "1", 10) || 0));

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

  printBanner(level, verbose);
  const baseUrlInfo = baseUrl ? ` (base: ${baseUrl})` : "";
  console.log(`${C.gray}[System] Using model: ${provider}/${modelName}${baseUrlInfo}${C.reset}`);
  console.log(`${C.gray}[System] Level: ${level}${level === "L1" ? " (Bash, ReadFile, WriteFile enabled)" : ""}${C.reset}\n`);

  const unit = new DeliberationUnit({
    model,
    level,
    onTextDelta: (agent: AgentId, delta: string) => {
      const color = AGENT_COLORS[agent];
      process.stdout.write(`${color}${delta}${C.reset}`);
    },
    onSystemEvent: (event: SystemEvent) => {
      renderEvent(event, verbose);
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
      console.log(`\n${C.gray}[System] Terminating...${C.reset}`);
      unit.terminate();
      rl.close();
      return;
    }

    // Inject user message into the bus — will be processed at next turn boundary
    console.log(`${C.gray}[User message queued]${C.reset}`);
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
