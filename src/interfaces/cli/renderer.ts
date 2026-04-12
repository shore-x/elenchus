// Elenchus - CLI Renderer
// Renders structured system events to the terminal.

import type { AgentId, SystemEvent, ToolLevel, UnitScope } from "../../core/types.js";

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
  "agent-a": "Agent A",
  "agent-b": "Agent B",
};

const CHILD_TOOLS = new Set(["spawnChild", "sendToChild"]);
const FRAMEWORK_TOOLS = new Set(["yield", "sleep", "vote", "compressContext"]);

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
    case "compressContext":
      return String(args.requirements);
    case "sleep":
      return `timeout: ${args.timeoutMs}ms`;
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

function isEnvTool(toolName: string): boolean {
  return !FRAMEWORK_TOOLS.has(toolName) && !CHILD_TOOLS.has(toolName);
}

function isChildTool(toolName: string): boolean {
  return CHILD_TOOLS.has(toolName);
}

function formatScopeLabel(scope: UnitScope): string {
  return scope.path.length === 0
    ? `${scope.level}:`
    : `${scope.level}: ${scope.path.join("-")}`;
}

function formatScopedAgentLabel(scope: UnitScope, agent: AgentId, turn: number): string {
  return `${formatScopeLabel(scope)} ${AGENT_NAMES[agent]} [T${turn}]`;
}

function indentMultiline(text: string, indent: string): string {
  return text.replace(/\n/g, `\n${indent}`);
}

export function printBanner(level: ToolLevel, verbose: number): void {
  const modeDescs: Record<ToolLevel, string> = {
    L0: "L0: Coordination (child management only)",
    L1: "L1: Planning + Execution (full capabilities)",
    L2: "L2: Execution (environment tools only)",
  };
  const modeDesc = modeDescs[level];
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

export function printStartupInfo(provider: string, modelName: string, baseUrl: string | undefined, level: ToolLevel): void {
  const baseUrlInfo = baseUrl ? ` (base: ${baseUrl})` : "";
  console.log(`${C.gray}[System] Using model: ${provider}/${modelName}${baseUrlInfo}${C.reset}`);
  const levelInfo = level === "L0" ? "" : level === "L1" ? " (child mgmt + env tools)" : " (env tools only)";
  console.log(`${C.gray}[System] Level: ${level}${levelInfo}${C.reset}\n`);
}

export function printQueuedUserMessage(): void {
  console.log(`${C.gray}[User message queued]${C.reset}`);
}

export function printTerminating(): void {
  console.log(`\n${C.gray}[System] Terminating...${C.reset}`);
}

export function printInterrupted(): void {
  console.log(`\n${C.gray}[System] Interrupted (SIGINT). Terminating...${C.reset}`);
}

export function renderEvent(event: SystemEvent, verbose: number): void {
  switch (event.type) {
    case "turn-start": {
      if (verbose >= 2) {
        const meta = `${formatScopedAgentLabel(event.scope, event.agent, event.turn)} | ctx: ${event.contextSize} msgs, +${event.newMessages} new`;
        process.stdout.write(`${C.dim}[Turn Start] ${meta}${C.reset}\n`);
      }
      break;
    }
    case "agent-message": {
      const color = AGENT_COLORS[event.agent];
      const label = formatScopedAgentLabel(event.scope, event.agent, event.turn);
      const content = indentMultiline(event.content.trim(), "  ");
      process.stdout.write(`${color}${label}:${C.reset} ${content}\n`);
      break;
    }
    case "proposal": {
      const label = formatScopeLabel(event.scope);
      const detail = formatToolArgs(event.toolName, event.args);
      if (isChildTool(event.toolName)) {
        process.stdout.write(`${C.blue}[Child Proposal] ${label} ${AGENT_NAMES[event.agent]} → ${event.toolName}: ${detail}${C.reset}\n`);
      } else if (isEnvTool(event.toolName)) {
        process.stdout.write(`${C.magenta}[Env Proposal] ${label} ${AGENT_NAMES[event.agent]} → ${event.toolName}: ${detail}${C.reset}\n`);
      } else {
        process.stdout.write(`${C.gray}[Proposal] ${label} ${AGENT_NAMES[event.agent]} → ${event.toolName}: ${detail}${C.reset}\n`);
      }
      break;
    }
    case "vote": {
      const label = formatScopeLabel(event.scope);
      const voterName = AGENT_NAMES[event.voter];
      const tag = event.approve ? "APPROVE" : "REJECT";
      if (isChildTool(event.toolName)) {
        process.stdout.write(`${C.blue}[Child Vote] ${label} ${voterName} → ${event.toolName} ${tag}: ${event.reason}${C.reset}\n`);
      } else if (isEnvTool(event.toolName)) {
        process.stdout.write(`${C.magenta}[Env Vote] ${label} ${voterName} → ${event.toolName} ${tag}: ${event.reason}${C.reset}\n`);
      } else {
        process.stdout.write(`${C.gray}[Vote] ${label} ${voterName} → ${tag}: ${event.reason}${C.reset}\n`);
      }
      break;
    }
    case "report":
      process.stdout.write(`\n${C.green}[Report] ${formatScopeLabel(event.scope)} ${event.content}${C.reset}\n`);
      break;
    case "state-transition":
      if (verbose >= 2) {
        process.stdout.write(`${C.dim}[FSM] ${formatScopeLabel(event.scope)} ${event.from} → ${event.to}${C.reset}\n`);
      }
      break;
    case "tool-executing": {
      const label = formatScopeLabel(event.scope);
      const detail = formatToolArgs(event.toolName, event.args);
      process.stdout.write(`${C.magenta}[Env Executing] ${label} ${event.toolName}: ${detail}${C.reset}\n`);
      break;
    }
    case "tool-result": {
      const label = formatScopeLabel(event.scope);
      const tag = event.success ? "✓" : "✗";
      const duration = verbose >= 1 ? ` (${(event.durationMs / 1000).toFixed(1)}s)` : "";
      const preview = event.output.length > 200 ? event.output.slice(0, 200) + "..." : event.output;
      process.stdout.write(`${C.magenta}[Env Result ${tag}] ${label}${duration} ${preview}${C.reset}\n`);
      break;
    }
    case "child-spawned":
      process.stdout.write(`${C.blue}[Child Spawned] ${formatScopeLabel(event.scope)}: ${event.task.length > 100 ? event.task.slice(0, 100) + "..." : event.task}${C.reset}\n`);
      break;
    case "child-message-sent":
      process.stdout.write(`${C.blue}[Child Message] → ${formatScopeLabel(event.scope)}: ${event.message.length > 100 ? event.message.slice(0, 100) + "..." : event.message}${C.reset}\n`);
      break;
    case "warning":
      process.stdout.write(`${C.yellow}[Warning] ${formatScopeLabel(event.scope)} ${event.message}${C.reset}\n`);
      break;
    case "error":
      process.stdout.write(`${C.red}[Error] ${formatScopeLabel(event.scope)} ${event.message}${C.reset}\n`);
      break;
  }
}
