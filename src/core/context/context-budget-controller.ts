import type { ConversationMessage, ContextTruncationReason } from "../types.js";

export const CHARS_PER_TOKEN = 3.5;

export function tokensToChars(tokens: number): number {
  return Math.ceil(tokens * CHARS_PER_TOKEN);
}

export function charsToTokens(chars: number): number {
  return Math.floor(chars / CHARS_PER_TOKEN);
}

export interface TurnContextBudgetPlan {
  recentRawStartSeq: number;
  visibleEndSeq: number;
  newlyVisibleSeq: number | null;
  compressionReminderShown: boolean;
  compressionReminderChars: number | null;
  compressionReminderThresholdChars: number | null;
  truncationApplied: boolean;
  truncationReason: ContextTruncationReason;
  truncationLevel: number;
}

export interface CreateTurnContextBudgetPlanInput {
  visibleMessages: readonly ConversationMessage[];
  newlyVisibleMessages: readonly ConversationMessage[];
  currentSequenceStart: number;
  baseRecentRawStartSeq: number;
  compressionReminderShown: boolean;
  compressionReminderChars: number | null;
  compressionReminderThresholdChars: number | null;
  capacityGuardCharLimit: number;
}

export interface TightenTurnContextBudgetPlanInput {
  visibleMessages: readonly ConversationMessage[];
  currentSequenceStart: number;
  currentPlan: TurnContextBudgetPlan;
  targetRecentRawChars: number;
}

function estimateMessageChars(message: ConversationMessage): number {
  switch (message.kind) {
    case "incoming_message":
    case "agent_message":
    case "system_message":
      return message.content.length + 32;
    case "upward_message":
      return message.content.length + 48;
    case "proposal_message":
      return message.toolName.length + message.proposedStep.length + JSON.stringify(message.args).length + 64;
    case "vote_message":
      return message.reason.length + 48;
    case "tool_result_message":
      return message.toolName.length + message.output.length + 64;
    case "child_report_message":
      return message.childId.length + message.content.length + 64;
    case "child_commit_view_message":
      return message.content.length + 64;
  }
}

function estimateMessagesChars(messages: readonly ConversationMessage[]): number {
  return messages.reduce((total, message) => total + estimateMessageChars(message), 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function findTailStartIndexWithinChars(messages: readonly ConversationMessage[], targetChars: number): number {
  if (messages.length === 0) {
    return 0;
  }

  let chars = 0;
  let start = messages.length - 1;
  for (let index = messages.length - 1; index >= 0; index--) {
    const estimated = estimateMessageChars(messages[index]);
    if (index < messages.length - 1 && chars + estimated > targetChars) {
      break;
    }
    chars += estimated;
    start = index;
  }

  return start;
}

export function createTurnContextBudgetPlan(input: CreateTurnContextBudgetPlanInput): TurnContextBudgetPlan {
  const baseRecentRawStartIndex = clamp(
    input.baseRecentRawStartSeq - input.currentSequenceStart,
    0,
    input.visibleMessages.length,
  );
  const baseRecentRawMessages = input.visibleMessages.slice(baseRecentRawStartIndex);
  const estimatedRecentRawChars = estimateMessagesChars(baseRecentRawMessages);
  const shouldTruncate = estimatedRecentRawChars > input.capacityGuardCharLimit;
  const relativeStartIndex = shouldTruncate
    ? findTailStartIndexWithinChars(baseRecentRawMessages, input.capacityGuardCharLimit)
    : 0;
  const recentRawStartSeq = input.baseRecentRawStartSeq + relativeStartIndex;

  return {
    recentRawStartSeq,
    visibleEndSeq: input.currentSequenceStart + input.visibleMessages.length,
    newlyVisibleSeq: input.newlyVisibleMessages.length > 0
      ? input.currentSequenceStart + (input.visibleMessages.length - input.newlyVisibleMessages.length)
      : null,
    compressionReminderShown: input.compressionReminderShown,
    compressionReminderChars: input.compressionReminderChars,
    compressionReminderThresholdChars: input.compressionReminderThresholdChars,
    truncationApplied: shouldTruncate,
    truncationReason: shouldTruncate ? "capacity_guard" : "none",
    truncationLevel: shouldTruncate ? 1 : 0,
  };
}

export function tightenTurnContextBudgetPlan(input: TightenTurnContextBudgetPlanInput): TurnContextBudgetPlan | null {
  const currentRecentRawStartIndex = clamp(
    input.currentPlan.recentRawStartSeq - input.currentSequenceStart,
    0,
    input.visibleMessages.length,
  );
  const currentRecentRawMessages = input.visibleMessages.slice(currentRecentRawStartIndex);
  if (currentRecentRawMessages.length <= 1) {
    return null;
  }

  const relativeStartIndex = findTailStartIndexWithinChars(currentRecentRawMessages, input.targetRecentRawChars);
  const nextRecentRawStartSeq = input.currentPlan.recentRawStartSeq + relativeStartIndex;
  if (nextRecentRawStartSeq <= input.currentPlan.recentRawStartSeq) {
    return null;
  }

  return {
    ...input.currentPlan,
    recentRawStartSeq: nextRecentRawStartSeq,
    truncationApplied: true,
    truncationReason: "provider_reject",
    truncationLevel: input.currentPlan.truncationLevel + 1,
  };
}
