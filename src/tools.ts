// Elenchus - Tool Definitions
// L0: Yield + SpawnChild + SendToChild (non-blocking child management) + Vote (conditional).
// L1: Yield + Bash + ReadFile + WriteFile (blocking environment tools) + Vote (conditional).
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
    "Propose to create a new L1 child agent unit to execute a specific task. This is a PROPOSAL — the other agent must vote APPROVE. " +
    "The child agent unit has environment tools (bash, file read/write) and will work on the task independently. " +
    "Results will be delivered asynchronously as a [System] message when the child completes its report. " +
    "Use this when the discussion requires real-world data: web searches, file operations, running programs, etc.",
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

const L0_TOOLS: ElenchusTool[] = [spawnChildTool, sendToChildTool];
const L1_TOOLS: ElenchusTool[] = [bashTool, readFileTool, writeFileTool];

// Check if a tool is a blocking environment tool (L1)
export function isBlockingTool(toolName: string): boolean {
  return L1_TOOLS.some((t) => t.name === toolName);
}

// Check if a tool is a non-blocking child management tool (L0)
export function isNonBlockingTool(toolName: string): boolean {
  return L0_TOOLS.some((t) => t.name === toolName);
}

// Build the tool list for a given turn.
// Vote is only available when there is a pending proposal from the other agent.
// L0 adds non-blocking child management tools. L1 adds blocking environment tools.
export function buildToolList(hasPendingProposal: boolean, level: ToolLevel = "L0"): ElenchusTool[] {
  const tools: ElenchusTool[] = [yieldTool];
  if (level === "L0") {
    tools.push(...L0_TOOLS);
  } else if (level === "L1") {
    tools.push(...L1_TOOLS);
  }
  if (hasPendingProposal) {
    tools.push(voteTool);
  }
  return tools;
}
