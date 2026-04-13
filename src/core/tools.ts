// Elenchus - Tool Definitions
// Three-layer tool allocation (§4.3):
//   - Child management (SpawnChild, SendToChild, UnmountChild, Sleep) → non-leaf (L0, L1)
//   - Environment tools (Bash, ReadFile, WriteFile) → non-coordination (L1, L2)
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
const EXECUTION_LEVELS: readonly ToolLevel[] = ["L1", "L2"];
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
  behavior: "blocking",
  appliesToLevels: EXECUTION_LEVELS,
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
  behavior: "blocking",
  appliesToLevels: EXECUTION_LEVELS,
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
  behavior: "blocking",
  appliesToLevels: EXECUTION_LEVELS,
};

export const installSkillTool: ElenchusTool = {
  name: "installSkill",
  description:
    "Propose to hot-install a local skill package directory into the runtime-managed skills set. This is a PROPOSAL — the other agent must vote APPROVE before it executes. " +
    "The source directory must already contain a valid skill package with skill.json and SKILL.md. " +
    "Installation is atomic and the new skill becomes available from the next turn rather than retroactively changing the current turn.",
  parameters: Type.Object({
    sourcePath: Type.String({
      description: "Absolute or relative path to a local directory containing a valid skill package to install.",
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
      description: "The ID of the child agent unit to send the message to (e.g. 'child-1').",
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
      description: "The ID of the currently visible child agent unit to unmount (e.g. 'child-1').",
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
    "You must specify an explicit timeout. If no child agent reports before the timeout, " +
    "a [Public Fact][Unit Runtime] timeout broadcast is recorded and the unit can resume deliberation. " +
    "Use this when waiting is itself the best next commitment, not merely because child work exists in parallel. " +
    "You must provide proposedStep to describe why this wait advances the task.",
  parameters: Type.Object({
    timeoutMs: Type.Number({
      description: "Timeout in milliseconds. The unit will be woken after this duration if no other event wakes it first. You must specify this explicitly every time.",
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
  bashTool,
  readFileTool,
  writeFileTool,
  installSkillTool,
  spawnChildTool,
  sendToChildTool,
  unmountChildTool,
  sleepTool,
];

export function getBuiltInToolRegistry(): ReadonlyMap<string, ElenchusTool> {
  return new Map(BUILT_IN_TOOLS.map((tool) => [tool.name, tool]));
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

export function isBlockingTool(toolName: string): boolean {
  return getBuiltInToolRegistry().get(toolName)?.behavior === "blocking";
}

export function isNonBlockingTool(toolName: string): boolean {
  return getBuiltInToolRegistry().get(toolName)?.behavior === "nonblocking";
}

export function isT8Tool(toolName: string): boolean {
  return getBuiltInToolRegistry().get(toolName)?.behavior === "pause";
}

export function buildToolList(hasPendingProposal: boolean, level: ToolLevel, hasChildren: boolean = false): ElenchusTool[] {
  return getBuiltInToolList(hasPendingProposal, level, hasChildren);
}
