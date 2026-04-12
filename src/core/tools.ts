// Elenchus - Tool Definitions
// Three-layer tool allocation (§4.3):
//   - Child management (SpawnChild, SendToChild, Sleep) → non-leaf (L0, L1)
//   - Environment tools (Bash, ReadFile, WriteFile) → non-coordination (L1, L2)
//   - Protocol tools (Yield, Vote, CompressContext) → all layers
// All non-Vote tool calls are proposals (framework-design §2.4) — require the other agent's vote.

import { Type, type TObject } from "@sinclair/typebox";
import type { ToolLevel } from "./types.js";

export interface ElenchusTool {
  name: string;
  description: string;
  parameters: TObject;
  category: "protocol" | "environment" | "child-management";
}

const proposedStepSchema = Type.String({
  description:
    "A short statement of how this action advances the task. Describe the task-advancing meaning of this step, not a restatement of the tool arguments.",
});

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
    proposedStep: proposedStepSchema,
  }),
  category: "protocol",
};

export const compressContextTool: ElenchusTool = {
  name: "compressContext",
  description:
    "Propose to start an asynchronous context compression task that refreshes the unit's memory snapshot. " +
    "This is a PROPOSAL — the other agent must vote APPROVE before it starts. " +
    "Use this primarily when a [Context Reminder] indicates recent raw context pressure, or when the unit has a strong reason to refresh its memory snapshot. " +
    "Provide preservation requirements describing what this compression should especially retain. " +
    "If a compression task is already active, a duplicate approved call will fail at runtime.",
  parameters: Type.Object({
    requirements: Type.String({
      description: "What this compression task should especially preserve: unresolved issues, disagreements, constraints, tentative judgments, or anything else that should not be flattened away.",
    }),
    proposedStep: proposedStepSchema,
  }),
  category: "protocol",
};

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
  category: "protocol",
};

export const bashTool: ElenchusTool = {
  name: "bash",
  description:
    "Propose to execute a shell command. This is a PROPOSAL — the other agent must vote APPROVE before it runs. " +
    "Use this for running programs, network requests (curl/wget), data processing, etc. " +
    "You must provide proposedStep to describe how this command advances the task, not just restate the command.",
  parameters: Type.Object({
    command: Type.String({
      description: "The shell command to execute.",
    }),
    proposedStep: proposedStepSchema,
  }),
  category: "environment",
};

export const readFileTool: ElenchusTool = {
  name: "readFile",
  description:
    "Propose to read the contents of a file. This is a PROPOSAL — the other agent must vote APPROVE before it executes. " +
    "You must provide proposedStep to describe what reading this file will help establish for the task.",
  parameters: Type.Object({
    path: Type.String({
      description: "Absolute or relative path to the file to read.",
    }),
    proposedStep: proposedStepSchema,
  }),
  category: "environment",
};

export const writeFileTool: ElenchusTool = {
  name: "writeFile",
  description:
    "Propose to write content to a file. This is a PROPOSAL — the other agent must vote APPROVE before it executes. " +
    "Creates the file if it does not exist. Overwrites if it does. " +
    "You must provide proposedStep to describe how this write advances the task.",
  parameters: Type.Object({
    path: Type.String({
      description: "Absolute or relative path to the file to write.",
    }),
    content: Type.String({
      description: "The content to write to the file.",
    }),
    proposedStep: proposedStepSchema,
  }),
  category: "environment",
};

export const spawnChildTool: ElenchusTool = {
  name: "spawnChild",
  description:
    "Propose to create a new child agent unit to execute a specific task. This is a PROPOSAL — the other agent must vote APPROVE. " +
    "The child unit works independently; results arrive asynchronously as a [Public Fact][Child Report] broadcast when it yields. " +
    "The unit runtime automatically determines the child's capabilities based on the current layer. " +
    "You must provide proposedStep to describe how delegating this work advances the parent task.",
  parameters: Type.Object({
    task: Type.String({
      description: "A clear, specific description of the task for the child agent unit to accomplish. Include all necessary context.",
    }),
    proposedStep: proposedStepSchema,
  }),
  category: "child-management",
};

export const sendToChildTool: ElenchusTool = {
  name: "sendToChild",
  description:
    "Propose to send a follow-up message to an existing child agent unit that has stopped (reported). This is a PROPOSAL — the other agent must vote APPROVE. " +
    "The child will resume with the new message and can perform additional work. " +
    "Use this when a child's report is incomplete or you need it to do more work. " +
    "You must provide proposedStep to describe how this follow-up advances the task.",
  parameters: Type.Object({
    childId: Type.String({
      description: "The ID of the child agent unit to send the message to (e.g. 'child-1').",
    }),
    message: Type.String({
      description: "The message to send to the child agent unit.",
    }),
    proposedStep: proposedStepSchema,
  }),
  category: "child-management",
};

export const sleepTool: ElenchusTool = {
  name: "sleep",
  description:
    "Propose to pause the deliberation and enter Idle without reporting to the parent. This is a PROPOSAL — the other agent must vote APPROVE. " +
    "You must specify an explicit timeout. If no child agent reports before the timeout, " +
    "a [Public Fact][Unit Runtime] timeout broadcast is recorded and the unit can resume deliberation. " +
    "Use this when waiting for child agent results. " +
    "You must provide proposedStep to describe why this wait advances the task.",
  parameters: Type.Object({
    timeoutMs: Type.Number({
      description: "Timeout in milliseconds. The unit will be woken after this duration if no other event wakes it first. You must specify this explicitly every time.",
    }),
    proposedStep: proposedStepSchema,
  }),
  category: "child-management",
};

const ENV_TOOLS: ElenchusTool[] = [bashTool, readFileTool, writeFileTool];

export function isBlockingTool(toolName: string): boolean {
  return ENV_TOOLS.some((t) => t.name === toolName);
}

export function isNonBlockingTool(toolName: string): boolean {
  return toolName === "spawnChild" || toolName === "sendToChild" || toolName === "compressContext";
}

export function isT8Tool(toolName: string): boolean {
  return toolName === "yield" || toolName === "sleep";
}

export function buildToolList(hasPendingProposal: boolean, level: ToolLevel, hasChildren: boolean = false): ElenchusTool[] {
  const tools: ElenchusTool[] = [yieldTool, compressContextTool];

  if (level !== "L2") {
    tools.push(spawnChildTool, sleepTool);
    if (hasChildren) {
      tools.push(sendToChildTool);
    }
  }

  if (level !== "L0") {
    tools.push(...ENV_TOOLS);
  }

  if (hasPendingProposal) {
    tools.push(voteTool);
  }
  return tools;
}
