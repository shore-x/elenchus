// Elenchus - Tool Definitions
// Three-layer tool allocation (§4.3):
//   - Child management (SpawnChild, SendToChild, Sleep) → non-leaf (L0, L1)
//   - Environment tools (Bash, ReadFile, WriteFile) → non-coordination (L1, L2)
//   - Framework tools (Yield, Vote) → all layers
// All non-Vote tool calls are proposals (framework-design §2.4) — require the other agent's vote.

import { Type, type TObject } from "@sinclair/typebox";
import type { ToolLevel } from "./types.js";

// pi-ai Tool interface (subset we need)
export interface ElenchusTool {
  name: string;
  description: string;
  parameters: TObject;
  category: "framework" | "blocking" | "nonblocking"; // framework = Vote/Report, blocking = L1 env tools, nonblocking = L0 child mgmt
}

// Yield: agent proposes to deliver current conclusions and return to Idle.
// Constitutes a proposal — requires the other agent's APPROVE vote.
export const yieldTool: ElenchusTool = {
  name: "yield",
  description:
    "Propose to deliver current conclusions and pause the deliberation. " +
    "This is a PROPOSAL — the other agent must vote APPROVE before it takes effect. " +
    "The unit returns to Idle and can be woken by new messages. " +
    "Use this when the discussion has converged or when waiting for async results (e.g. child agent reports).",
  parameters: Type.Object({
    content: Type.String({
      description: "Current conclusions: a clear summary of what has been established so far.",
    }),
  }),
  category: "framework",
};

// Vote: conditionally injected by the framework when there is a pending proposal.
// This is the ONLY tool that does not constitute a new proposal.
export const voteTool: ElenchusTool = {
  name: "vote",
  description:
    "Vote on the other agent's pending proposal. You MUST call this tool when a pending proposal is presented to you. " +
    "APPROVE if the proposal is accurate and complete. REJECT if it has significant issues.",
  parameters: Type.Object({
    approve: Type.Boolean({
      description: "true = APPROVE the proposal, false = REJECT it",
    }),
    reason: Type.String({
      description: "Reason for your vote. If rejecting, explain what needs to change.",
    }),
  }),
  category: "framework",
};

// === L1 Blocking Environment Tools ===
// All are proposals — require the other agent's APPROVE vote before execution.

export const bashTool: ElenchusTool = {
  name: "bash",
  description:
    "Propose to execute a shell command. This is a PROPOSAL — the other agent must vote APPROVE before it runs. " +
    "Use this for running programs, network requests (curl/wget), data processing, etc.",
  parameters: Type.Object({
    command: Type.String({
      description: "The shell command to execute.",
    }),
  }),
  category: "blocking",
};

export const readFileTool: ElenchusTool = {
  name: "readFile",
  description:
    "Propose to read the contents of a file. This is a PROPOSAL — the other agent must vote APPROVE before it executes.",
  parameters: Type.Object({
    path: Type.String({
      description: "Absolute or relative path to the file to read.",
    }),
  }),
  category: "blocking",
};

export const writeFileTool: ElenchusTool = {
  name: "writeFile",
  description:
    "Propose to write content to a file. This is a PROPOSAL — the other agent must vote APPROVE before it executes. " +
    "Creates the file if it does not exist. Overwrites if it does.",
  parameters: Type.Object({
    path: Type.String({
      description: "Absolute or relative path to the file to write.",
    }),
    content: Type.String({
      description: "The content to write to the file.",
    }),
  }),
  category: "blocking",
};

// === L0 Non-blocking Child Management Tools ===
// All are proposals — require the other agent's APPROVE vote.
// Non-blocking: after APPROVE, tool starts in background, ACK written to bus, FSM continues (T2/T4).

export const spawnChildTool: ElenchusTool = {
  name: "spawnChild",
  description:
    "Propose to create a new child agent unit to execute a specific task. This is a PROPOSAL — the other agent must vote APPROVE. " +
    "The child unit works independently; results arrive asynchronously as a [System] message when it yields. " +
    "The framework automatically determines the child's capabilities based on the current layer.",
  parameters: Type.Object({
    task: Type.String({
      description: "A clear, specific description of the task for the child agent unit to accomplish. Include all necessary context.",
    }),
  }),
  category: "nonblocking",
};

export const sendToChildTool: ElenchusTool = {
  name: "sendToChild",
  description:
    "Propose to send a follow-up message to an existing child agent unit that has stopped (reported). This is a PROPOSAL — the other agent must vote APPROVE. " +
    "The child will resume with the new message and can perform additional work. " +
    "Use this when a child's report is incomplete or you need it to do more work.",
  parameters: Type.Object({
    childId: Type.String({
      description: "The ID of the child agent unit to send the message to (e.g. 'child-1').",
    }),
    message: Type.String({
      description: "The message to send to the child agent unit.",
    }),
  }),
  category: "nonblocking",
};

// Sleep: pause without reporting to parent, with explicit timeout (§4.4)
export const sleepTool: ElenchusTool = {
  name: "sleep",
  description:
    "Propose to pause the deliberation and enter Idle without reporting to the parent. This is a PROPOSAL — the other agent must vote APPROVE. " +
    "You must specify an explicit timeout. If no child agent reports before the timeout, " +
    "the framework writes a timeout system message and wakes the unit. " +
    "Use this when waiting for child agent results.",
  parameters: Type.Object({
    timeoutMs: Type.Number({
      description: "Timeout in milliseconds. The unit will be woken after this duration if no other event wakes it first. You must specify this explicitly every time.",
    }),
  }),
  category: "framework",
};

// Tool sets by capability category (§4.3)
const CHILD_MGMT_TOOLS: ElenchusTool[] = [spawnChildTool, sendToChildTool, sleepTool];
const ENV_TOOLS: ElenchusTool[] = [bashTool, readFileTool, writeFileTool];

// Check if a tool is a blocking environment tool
export function isBlockingTool(toolName: string): boolean {
  return ENV_TOOLS.some((t) => t.name === toolName);
}

// Check if a tool is a non-blocking child management tool
export function isNonBlockingTool(toolName: string): boolean {
  return toolName === "spawnChild" || toolName === "sendToChild";
}

// Check if a tool triggers T8 (Yield or Sleep → Idle)
export function isT8Tool(toolName: string): boolean {
  return toolName === "yield" || toolName === "sleep";
}

// Build the tool list for a given turn.
// Vote is only available when there is a pending proposal from the other agent.
// Tool allocation follows §4.3 rules:
//   - Child management tools → non-leaf (L0, L1)
//   - Environment tools → non-coordination (L1, L2)
//   - SendToChild: conditionally visible only when children exist
export function buildToolList(hasPendingProposal: boolean, level: ToolLevel, hasChildren: boolean = false): ElenchusTool[] {
  const tools: ElenchusTool[] = [yieldTool];

  // Child management tools → non-leaf layers (L0, L1)
  if (level !== "L2") {
    tools.push(spawnChildTool, sleepTool);
    if (hasChildren) {
      tools.push(sendToChildTool);
    }
  }

  // Environment tools → non-coordination layers (L1, L2)
  if (level !== "L0") {
    tools.push(...ENV_TOOLS);
  }

  if (hasPendingProposal) {
    tools.push(voteTool);
  }
  return tools;
}
