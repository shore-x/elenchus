import { buildSystemPrompt } from "../prompts.js";
import { ConversationProjector } from "../conversation-projector.js";
import { getBuiltInToolList, type ElenchusTool } from "../tools.js";
import type { LlmContext, LlmMessage } from "../ports.js";
import type { AgentId, ChildCommitView, ConversationMessage, MemorySnapshot, PendingProposal, ToolLevel } from "../types.js";
import type { TurnContextBudgetPlan } from "./context-budget-controller.js";

const AGENT_NAMES: Record<AgentId, string> = {
  "agent-a": "Agent A",
  "agent-b": "Agent B",
};

export interface TurnContextPlan {
  unitId: string;
  agentId: AgentId;
  level: ToolLevel;
  visibleEndSeq: number;
  recentRawStartSeq: number;
  newlyVisibleSeq: number | null;
  memorySnapshotRowid: number | null;
  agentMdRowid: number | null;
  hasPendingFromOther: boolean;
  hasChildren: boolean;
  canSpawnChild: boolean;
  compressionReminderShown: boolean;
  compressionReminderChars: number | null;
  compressionReminderThresholdChars: number | null;
  truncationApplied: boolean;
  truncationReason: TurnContextBudgetPlan["truncationReason"];
  truncationLevel: number;
  effectiveTurn: number;
}

export interface AssembleTurnContextInput {
  unitId: string;
  agentId: AgentId;
  level: ToolLevel;
  workspaceRoot: string;
  workspaceKnowledge: string | null;
  agentMdRowid: number | null;
  visibleMessages: readonly ConversationMessage[];
  newlyVisibleMessages: readonly ConversationMessage[];
  pendingProposal: PendingProposal | null;
  childCommitViews: readonly ChildCommitView[];
  hasChildren: boolean;
  canSpawnChild: boolean;
  memorySnapshot: MemorySnapshot | null;
  memorySnapshotRowid: number | null;
  budgetPlan: TurnContextBudgetPlan;
  contextWindowTokens?: number;
  effectiveTurn: number;
}

export interface AssembledTurnContext {
  plan: TurnContextPlan;
  llmContext: LlmContext;
  tools: readonly ElenchusTool[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function assembleTurnContext(input: AssembleTurnContextInput): AssembledTurnContext {
  const projector = new ConversationProjector();
  const tools = getBuiltInToolList(
    input.pendingProposal !== null && input.pendingProposal.proposer !== input.agentId,
    input.level,
    input.hasChildren,
    input.canSpawnChild,
  );

  // child_commit_view_message is stored in ledger for observability but excluded from
  // normal projection — it is injected as a single turn-local overlay from childCommitViews.
  const filteredVisible = input.visibleMessages.filter(m => m.kind !== "child_commit_view_message");
  // Filter newly visible: exclude child_commit_view_message and the current agent's own
  // agent_message. Own agent_messages have deferred visibility but are semantically
  // self-authored — the agent already knows what it said, so marking them "newly visible"
  // would be misleading and cause the context-boundary to be placed incorrectly.
  const filteredNewlyVisible = input.newlyVisibleMessages.filter(m =>
    m.kind !== "child_commit_view_message" &&
    !(m.kind === "agent_message" && m.authoredBy === input.agentId),
  );

  // seq-to-index offset uses the original (unfiltered) array since seq is a ledger-level concept.
  // Then we find the corresponding position in the filtered array.
  const originalRecentRawStartIndex = clamp(
    input.budgetPlan.recentRawStartSeq - (input.budgetPlan.visibleEndSeq - input.visibleMessages.length),
    0,
    input.visibleMessages.length,
  );
  const startMessage = input.visibleMessages[originalRecentRawStartIndex];
  const recentRawStartIndex = startMessage
    ? Math.max(0, filteredVisible.findIndex(m => m.id === startMessage.id))
    : 0;
  const recentRawMessages = filteredVisible.slice(recentRawStartIndex);
  const recentNewMessageIds = new Set(filteredNewlyVisible.map((message) => message.id));
  const firstRecentNewIndex = recentRawMessages.findIndex((message) => recentNewMessageIds.has(message.id));
  const oldRecentRawMessages = firstRecentNewIndex === -1
    ? recentRawMessages
    : recentRawMessages.slice(0, firstRecentNewIndex);
  const newRecentRawMessages = firstRecentNewIndex === -1
    ? []
    : recentRawMessages.slice(firstRecentNewIndex);

  const messages: LlmMessage[] = [];
  if (input.memorySnapshot) {
    messages.push(projector.buildMemorySnapshotMessage(input.memorySnapshot));
  }

  // Inject child commit view as turn-local overlay (single message, not accumulated)
  const childCommitOverlay = projector.buildChildCommitViewMessage(input.agentId, input.childCommitViews);
  if (childCommitOverlay) {
    messages.push(childCommitOverlay);
  }

  messages.push(...projector.projectVisibleMessages(oldRecentRawMessages));

  if (newRecentRawMessages.length > 0) {
    messages.push(projector.buildNewlyVisibleBoundaryOverlay(input.agentId, newRecentRawMessages.length));
    messages.push(...projector.projectVisibleMessages(newRecentRawMessages));
  }

  if (
    input.budgetPlan.compressionReminderShown
    && input.budgetPlan.compressionReminderChars !== null
    && input.budgetPlan.compressionReminderThresholdChars !== null
  ) {
    messages.push(projector.buildCompressionReminderOverlay(
      input.agentId,
      input.budgetPlan.compressionReminderChars,
      input.budgetPlan.compressionReminderThresholdChars,
      input.contextWindowTokens,
    ));
  }

  if (input.pendingProposal && input.pendingProposal.proposer !== input.agentId) {
    const proposerName = AGENT_NAMES[input.pendingProposal.proposer] ?? input.pendingProposal.proposer;
    const voterName = AGENT_NAMES[input.agentId] ?? input.agentId;
    messages.push(projector.buildProposalNotification(input.pendingProposal, proposerName, voterName));
  } else if (input.pendingProposal && input.pendingProposal.proposer === input.agentId) {
    const proposerName = AGENT_NAMES[input.agentId] ?? input.agentId;
    const voterName = AGENT_NAMES[input.pendingProposal.proposer === "agent-a" ? "agent-b" : "agent-a"];
    messages.push(projector.buildProposerWaitNotification(proposerName, voterName, input.pendingProposal.toolName));
  }

  return {
    plan: {
      unitId: input.unitId,
      agentId: input.agentId,
      level: input.level,
      visibleEndSeq: input.budgetPlan.visibleEndSeq,
      recentRawStartSeq: input.budgetPlan.recentRawStartSeq,
      newlyVisibleSeq: input.budgetPlan.newlyVisibleSeq,
      memorySnapshotRowid: input.memorySnapshotRowid,
      agentMdRowid: input.agentMdRowid,
      hasPendingFromOther: input.pendingProposal !== null && input.pendingProposal.proposer !== input.agentId,
      hasChildren: input.hasChildren,
      canSpawnChild: input.canSpawnChild,
      compressionReminderShown: input.budgetPlan.compressionReminderShown,
      compressionReminderChars: input.budgetPlan.compressionReminderChars,
      compressionReminderThresholdChars: input.budgetPlan.compressionReminderThresholdChars,
      truncationApplied: input.budgetPlan.truncationApplied,
      truncationReason: input.budgetPlan.truncationReason,
      truncationLevel: input.budgetPlan.truncationLevel,
      effectiveTurn: input.effectiveTurn,
    },
    llmContext: {
      systemPrompt: buildSystemPrompt(input.agentId, input.level, input.workspaceRoot, input.workspaceKnowledge),
      messages,
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      })),
    },
    tools,
  };
}
