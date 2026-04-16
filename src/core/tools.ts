// Elenchus - Tool Definitions
// Three-layer tool allocation (§4.3):
//   - Child management (SpawnChild, SendToChild, UnmountChild, Sleep) → non-leaf (L0, L1)
//   - Environment tools (Bash, ReadFile, WriteFile) → all layers (L0 constrained by role policy P28)
//   - Protocol tools (Yield, Report, Vote, CompressContext) → all layers
// Yield and Report form the same upward-communication family: both send a shared upward message,
// while their difference is whether the unit pauses afterward.
// All non-Vote tool calls are proposals (framework-design §2.4) — require the other agent's vote.

import { Type } from "@sinclair/typebox";
import type { ToolLevel } from "./types.js";

export type ToolCategory = "protocol" | "environment" | "child-management";
export type ToolBehavior = "vote" | "blocking" | "nonblocking" | "pause";

export interface ElenchusTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  category: ToolCategory;
  behavior: ToolBehavior;
  appliesToLevels: readonly ToolLevel[];
  requiresChildren?: boolean;
  requiresPendingProposal?: boolean;
}

const NON_LEAF_LEVELS: readonly ToolLevel[] = ["L0", "L1"];
const L0_LEVEL: readonly ToolLevel[] = ["L0"];
const EXECUTION_LEVELS: readonly ToolLevel[] = ["L1", "L2"]; // L0 uses its own bashL0/writeFileL0 variants
const ALL_LEVELS: readonly ToolLevel[] = ["L0", "L1", "L2"];

const proposedStepSchema = Type.String({
  description:
    "A short statement of how this action advances the task. Describe the task-advancing meaning of this step, not a restatement of the tool arguments.",
});

export const yieldTool: ElenchusTool = {
  name: "yield",
  description:
    "Propose to send an upward communication message and pause the deliberation. " +
    "This is a PROPOSAL — the other agent must vote APPROVE before it takes effect. " +
    "After approval, the unit returns to Idle and can be woken by new messages. " +
    "Use this when the unit should hand initiative upward and wait, including stage completion, requests for upper-layer judgment, or cases where the unit lacks enough information to continue effectively.",
  parameters: Type.Object({
    content: Type.String({
      description: "The upward handoff content: a clear summary, judgment, question, request for more information, or recommended next step that the upper layer should receive before this unit pauses.",
    }),
    proposedStep: proposedStepSchema,
  }),
  category: "protocol",
  behavior: "pause",
  appliesToLevels: ALL_LEVELS,
};

export const reportTool: ElenchusTool = {
  name: "report",
  description:
    "Propose to send an upward coordination message without pausing the deliberation. " +
    "This is a PROPOSAL — the other agent must vote APPROVE before it takes effect. " +
    "After approval, the unit continues into later turns rather than returning to Idle. " +
    "Use this at key decision points, material findings, risks, or other coordination moments when upper-layer visibility would improve coordination but the unit should keep working.",
  parameters: Type.Object({
    content: Type.String({
      description: "The upward coordination message: a key finding, decision point, risk, partial conclusion, or request for additional information that the upper layer should know now.",
    }),
    proposedStep: proposedStepSchema,
  }),
  category: "protocol",
  behavior: "nonblocking",
  appliesToLevels: ALL_LEVELS,
};

export const compressContextTool: ElenchusTool = {
  name: "compressContext",
  description:
    "Propose to start a background asynchronous context compression task that refreshes the unit's memory snapshot. " +
    "This is a PROPOSAL — the other agent must vote APPROVE before it starts. " +
    "After approval, compression runs in the background and does not block the current agent unit's workflow, so the unit should continue normal deliberation rather than sleeping merely to wait for completion. " +
    "Use this primarily when a [Context Reminder] indicates recent raw context pressure, or when the unit has a strong reason to refresh its memory snapshot. " +
    "Provide preservation requirements describing what this compression should especially retain. " +
    "If a compression task is already active, a duplicate approved call will fail at runtime.",
  parameters: Type.Object({
    requirements: Type.String({
      description: "What this background compression task should especially preserve: unresolved issues, disagreements, constraints, tentative judgments, or anything else that should not be flattened away. This is a preservation-priority declaration, not an inline summary and not a request to pause for compression.",
    }),
    proposedStep: proposedStepSchema,
  }),
  category: "protocol",
  behavior: "nonblocking",
  appliesToLevels: ALL_LEVELS,
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
  behavior: "vote",
  appliesToLevels: ALL_LEVELS,
  requiresPendingProposal: true,
};

export const bashL0Tool: ElenchusTool = {
  name: "bash",
  description:
    "Propose to execute a shell command. This is a PROPOSAL — the other agent must vote APPROVE before it runs. " +
    "As the top-level coordinator, your bash access serves your coordination role: surveying the project landscape (ls, find, tree), " +
    "inspecting content (cat, head, grep, wc), and understanding the current state of work across the knowledge space. " +
    "You also use bash to maintain your knowledge space — checking what child units have produced, verifying file structures, " +
    "and ensuring your workspace is well-organized for coordination. " +
    "When you discover work that needs doing, your strength is in delegating it to a child unit — bash helps you see what needs doing, " +
    "not do it yourself. " +
    "**Hard constraint**: at L0, only information-gathering commands are permitted (ls, find, tree, cat, head, tail, grep, wc, " +
    "du, file, stat, pwd, which, echo, diff, sort, uniq, type, less, more, printenv, env, date, uname, hostname, whoami, id). " +
    "Task-execution commands (build, install, run, edit, delete, etc.) will be rejected at runtime — delegate those to a child unit instead. " +
    "Commands execute with your working directory as the current working directory (cwd). " +
    "You must provide proposedStep to describe how this command advances the task, not just restate the command.",
  parameters: Type.Object({
    command: Type.String({
      description: "The shell command to execute. Runs with your working directory as cwd.",
    }),
    proposedStep: proposedStepSchema,
  }),
  category: "environment",
  behavior: "blocking",
  appliesToLevels: L0_LEVEL,
};

export const bashTool: ElenchusTool = {
  name: "bash",
  description:
    "Propose to execute a shell command. This is a PROPOSAL — the other agent must vote APPROVE before it runs. " +
    "Use this for running programs, network requests (curl/wget), data processing, etc. " +
    "Commands execute with your working directory as the current working directory (cwd). " +
    "You must provide proposedStep to describe how this command advances the task, not just restate the command.",
  parameters: Type.Object({
    command: Type.String({
      description: "The shell command to execute. Runs with your working directory as cwd.",
    }),
    proposedStep: proposedStepSchema,
  }),
  category: "environment",
  behavior: "blocking",
  appliesToLevels: EXECUTION_LEVELS,
};

export const readFileTool: ElenchusTool = {
  name: "readFile",
  description:
    "Propose to read the contents of a file. This is a PROPOSAL — the other agent must vote APPROVE before it executes. " +
    "You must provide proposedStep to describe what reading this file will help establish for the task. " +
    "Always use absolute paths to avoid ambiguity and to make file references shareable across agents.",
  parameters: Type.Object({
    path: Type.String({
      description: "Absolute path to the file to read. Use absolute paths so that file references can be shared with other agents.",
    }),
    proposedStep: proposedStepSchema,
  }),
  category: "environment",
  behavior: "blocking",
  appliesToLevels: EXECUTION_LEVELS,
};

export const writeFileL0Tool: ElenchusTool = {
  name: "writeFile",
  description:
    "Propose to write content to a file. This is a PROPOSAL — the other agent must vote APPROVE before it executes. " +
    "As the top-level coordinator, your writeFile access serves your coordination role: maintaining AGENT.md files, " +
    "writing knowledge summaries and integration notes, and organizing your workspace so that both you and your child units " +
    "can navigate the project's knowledge effectively. " +
    "Always use absolute paths so that other agents can locate and read the file. " +
    "Creates the file if it does not exist. Overwrites if it does. " +
    "You must provide proposedStep to describe how this write advances the task.",
  parameters: Type.Object({
    path: Type.String({
      description: "Absolute path to the file to write. Use absolute paths so that other agents can locate and read the file.",
    }),
    content: Type.String({
      description: "The content to write to the file.",
    }),
    proposedStep: proposedStepSchema,
  }),
  category: "environment",
  behavior: "blocking",
  appliesToLevels: L0_LEVEL,
};

export const writeFileTool: ElenchusTool = {
  name: "writeFile",
  description:
    "Propose to write content to a file. This is a PROPOSAL — the other agent must vote APPROVE before it executes. " +
    "Creates the file if it does not exist. Overwrites if it does. " +
    "You must provide proposedStep to describe how this write advances the task. " +
    "Always use absolute paths so that other agents can locate and read the file.",
  parameters: Type.Object({
    path: Type.String({
      description: "Absolute path to the file to write. Use absolute paths so that other agents can locate and read the file.",
    }),
    content: Type.String({
      description: "The content to write to the file.",
    }),
    proposedStep: proposedStepSchema,
  }),
  category: "environment",
  behavior: "blocking",
  appliesToLevels: EXECUTION_LEVELS,
};

export const spawnChildTool: ElenchusTool = {
  name: "spawnChild",
  description:
    "Create a child agent unit for a delegated task. " +
    "The child works independently, and upward messages from that child arrive asynchronously as [Public Fact][Child Report] broadcasts. " +
    "Child creation follows the fixed layer hierarchy: from L0, spawnChild creates an L1 child; from L1, it creates an L2 child. " +
    "A child may have direct capabilities that are not available in the current layer. " +
    "Use this when a delegated unit would be a better way to make progress on part of the task. SpawnChild provides an initial brief rather than a guarantee that all relevant context has already been transferred; follow-up context can continue through sendToChild, report, and yield. " +
    "You must provide proposedStep to describe how delegating this work advances the unit's task.",
  parameters: Type.Object({
    task: Type.String({
      description: "A clear, specific initial brief for the child agent unit to accomplish. Include the context already known to be important, but this does not imply that later clarification or additional context will be unnecessary.",
    }),
    proposedStep: proposedStepSchema,
  }),
  category: "child-management",
  behavior: "nonblocking",
  appliesToLevels: NON_LEAF_LEVELS,
};

export const sendToChildTool: ElenchusTool = {
  name: "sendToChild",
  description:
    "Propose to send a follow-up message to an existing child agent unit. This is a PROPOSAL — the other agent must vote APPROVE. " +
    "If the child unit is idle, it can resume with the new message; if it is still active, the message will be queued and become available to that child as it continues work. " +
    "Use this when delegated work should receive additional context, constraints, corrections, clarifications, redirection, or a response to the child's earlier report or yield. " +
    "You must provide proposedStep to describe how this follow-up advances the task.",
  parameters: Type.Object({
    childId: Type.String({
      description: "The ID of the child agent unit to send the message to (e.g. 'L1-01', 'L2-01-02').",
    }),
    message: Type.String({
      description: "The message to send to the child agent unit.",
    }),
    proposedStep: proposedStepSchema,
  }),
  category: "child-management",
  behavior: "nonblocking",
  appliesToLevels: NON_LEAF_LEVELS,
  requiresChildren: true,
};

export const unmountChildTool: ElenchusTool = {
  name: "unmountChild",
  description:
    "Propose to unmount an existing idle child agent unit from the parent unit's current visible context. This is a PROPOSAL — the other agent must vote APPROVE. " +
    "Unmounting removes that child from the parent agent's current visible child set and context budget, but it does not terminate the child or remove the underlying parent-child affiliation in the program. " +
    "Only an idle child can be unmounted. If that child later sends a new upward communication message, it will automatically remount into the parent unit's visible child set. " +
    "You must provide proposedStep to describe how removing this child from the current working set advances the task.",
  parameters: Type.Object({
    childId: Type.String({
      description: "The ID of the currently visible child agent unit to unmount (e.g. 'L1-01', 'L2-01-02').",
    }),
    proposedStep: proposedStepSchema,
  }),
  category: "child-management",
  behavior: "nonblocking",
  appliesToLevels: NON_LEAF_LEVELS,
  requiresChildren: true,
};

export const sleepTool: ElenchusTool = {
  name: "sleep",
  description:
    "Propose to pause the deliberation and enter Idle without sending an upward message. This is a PROPOSAL — the other agent must vote APPROVE. " +
    "You must specify an explicit timeout in seconds. If no child agent reports before the timeout, " +
    "a [Public Fact][Unit Runtime] timeout broadcast is recorded and the unit can resume deliberation. " +
    "Use this when waiting is itself the best next commitment, not merely because child work exists in parallel. " +
    "Choose a duration that matches the expected wait: a short wait (e.g. 30–60s) for a prompt child response, " +
    "a moderate wait (e.g. 120–300s) for a multi-step child task, or a longer wait (e.g. 600s+) when the unit has no imminent expectation and is simply parking until something changes. " +
    "Avoid very short timeouts (under 10s) — they rarely accomplish meaningful waiting and mostly waste turns on repeated sleep cycles. " +
    "You must provide proposedStep to describe why this wait advances the task.",
  parameters: Type.Object({
    timeoutSeconds: Type.Number({
      description: "Timeout in seconds. The unit will be woken after this duration if no other event wakes it first. Choose a duration appropriate to what you are waiting for — avoid very short timeouts under 10s.",
    }),
    proposedStep: proposedStepSchema,
  }),
  category: "child-management",
  behavior: "pause",
  appliesToLevels: NON_LEAF_LEVELS,
};

const BUILT_IN_TOOLS: readonly ElenchusTool[] = [
  yieldTool,
  reportTool,
  compressContextTool,
  voteTool,
  bashL0Tool,
  bashTool,
  readFileTool,
  writeFileL0Tool,
  writeFileTool,
  spawnChildTool,
  sendToChildTool,
  unmountChildTool,
  sleepTool,
];

export function getBuiltInToolRegistry(level?: ToolLevel): ReadonlyMap<string, ElenchusTool> {
  const tools = level !== undefined
    ? BUILT_IN_TOOLS.filter((tool) => tool.appliesToLevels.includes(level))
    : BUILT_IN_TOOLS;
  return new Map(tools.map((tool) => [tool.name, tool]));
}

export function getBuiltInTools(): readonly ElenchusTool[] {
  return BUILT_IN_TOOLS;
}

export function getBuiltInToolList(hasPendingProposal: boolean, level: ToolLevel, hasChildren: boolean = false): ElenchusTool[] {
  return BUILT_IN_TOOLS.filter((tool) => {
    if (!tool.appliesToLevels.includes(level)) {
      return false;
    }
    if (tool.requiresChildren && !hasChildren) {
      return false;
    }
    if (tool.requiresPendingProposal && !hasPendingProposal) {
      return false;
    }
    if (tool.behavior === "vote" && !hasPendingProposal) {
      return false;
    }
    return true;
  });
}

export function isBlockingTool(toolName: string, level?: ToolLevel): boolean {
  return getBuiltInToolRegistry(level).get(toolName)?.behavior === "blocking";
}

export function isNonBlockingTool(toolName: string, level?: ToolLevel): boolean {
  return getBuiltInToolRegistry(level).get(toolName)?.behavior === "nonblocking";
}

export function isT8Tool(toolName: string, level?: ToolLevel): boolean {
  return getBuiltInToolRegistry(level).get(toolName)?.behavior === "pause";
}

export function buildToolList(hasPendingProposal: boolean, level: ToolLevel, hasChildren: boolean = false): ElenchusTool[] {
  return getBuiltInToolList(hasPendingProposal, level, hasChildren);
}
