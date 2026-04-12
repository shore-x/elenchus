// Elenchus - CompressionTaskManager
// Manages unit-level context compression lifecycle without mutating ConversationLedger history.
// Owns the active compression task slot, reminder threshold checks, recent-raw window boundary,
// and limited retry handling for asynchronous Memory Snapshot refreshes.

import type { ConversationMessage, MemorySnapshot } from "../types.js";

const DEFAULT_REMINDER_THRESHOLD_CHARS = 120_000;
const DEFAULT_RECENT_RAW_TARGET_CHARS = 24_000;
const DEFAULT_MAX_RETRIES = 1;

let nextCompressionTaskId = 0;

function generateCompressionTaskId(): string {
  nextCompressionTaskId += 1;
  return `compression-${nextCompressionTaskId}`;
}

function estimateMessageChars(message: ConversationMessage): number {
  switch (message.kind) {
    case "parent_message":
    case "agent_message":
    case "system_message":
      return message.content.length + 32;
    case "proposal_message":
      return message.toolName.length + message.proposedStep.length + JSON.stringify(message.args).length + 64;
    case "vote_message":
      return message.reason.length + 48;
    case "tool_result_message":
      return message.toolName.length + message.output.length + 64;
    case "child_report_message":
      return message.childId.length + message.content.length + 48;
  }
}

function estimateMessagesChars(messages: readonly ConversationMessage[]): number {
  return messages.reduce((total, message) => total + estimateMessageChars(message), 0);
}

function findRecentRawStartIndex(messages: readonly ConversationMessage[], targetChars: number): number {
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

export interface ActiveCompressionTask {
  id: string;
  requirements: string;
  sourceMessages: readonly ConversationMessage[];
  attemptNumber: number;
  maxAttempts: number;
  startedAt: number;
}

export class CompressionTaskManager {
  private activeTask: ActiveCompressionTask | null = null;
  private memorySnapshot: MemorySnapshot | null = null;
  private recentRawStartIndex = 0;
  private reminderThresholdChars: number;
  private recentRawTargetChars: number;
  private maxRetries: number;

  constructor(options?: {
    reminderThresholdChars?: number;
    recentRawTargetChars?: number;
    maxRetries?: number;
  }) {
    this.reminderThresholdChars = options?.reminderThresholdChars ?? DEFAULT_REMINDER_THRESHOLD_CHARS;
    this.recentRawTargetChars = options?.recentRawTargetChars ?? DEFAULT_RECENT_RAW_TARGET_CHARS;
    this.maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  getMemorySnapshot(): MemorySnapshot | null {
    return this.memorySnapshot ? { ...this.memorySnapshot } : null;
  }

  hasActiveTask(): boolean {
    return this.activeTask !== null;
  }

  getReminderThresholdChars(): number {
    return this.reminderThresholdChars;
  }

  getRecentRawMessages(visibleMessages: readonly ConversationMessage[]): readonly ConversationMessage[] {
    const safeStart = Math.min(this.recentRawStartIndex, visibleMessages.length);
    return visibleMessages.slice(safeStart);
  }

  estimateRecentRawChars(visibleMessages: readonly ConversationMessage[]): number {
    return estimateMessagesChars(this.getRecentRawMessages(visibleMessages));
  }

  shouldShowReminder(visibleMessages: readonly ConversationMessage[]): boolean {
    return !this.hasActiveTask()
      && this.estimateRecentRawChars(visibleMessages) >= this.reminderThresholdChars;
  }

  startTask(requirements: string, sourceMessages: readonly ConversationMessage[]):
    | { ok: true; task: ActiveCompressionTask }
    | { ok: false; error: string } {
    if (this.activeTask) {
      return {
        ok: false,
        error: `A context compression task is already active (${this.activeTask.id}). Duplicate launches are not allowed.`,
      };
    }

    const task: ActiveCompressionTask = {
      id: generateCompressionTaskId(),
      requirements: requirements.trim(),
      sourceMessages: sourceMessages.map((message) => ({ ...message })),
      attemptNumber: 1,
      maxAttempts: this.maxRetries + 1,
      startedAt: Date.now(),
    };

    this.activeTask = task;
    return { ok: true, task: { ...task, sourceMessages: task.sourceMessages.map((message) => ({ ...message })) } };
  }

  registerSuccess(content: string): MemorySnapshot {
    if (!this.activeTask) {
      throw new Error("Cannot register compression success without an active task");
    }

    const snapshot: MemorySnapshot = {
      content: content.trim(),
      sourceMessageCount: this.activeTask.sourceMessages.length,
      requirements: this.activeTask.requirements,
      createdAt: Date.now(),
    };

    this.memorySnapshot = snapshot;
    this.recentRawStartIndex = findRecentRawStartIndex(this.activeTask.sourceMessages, this.recentRawTargetChars);
    this.activeTask = null;
    return { ...snapshot };
  }

  registerFailure():
    | { shouldRetry: true; task: ActiveCompressionTask }
    | { shouldRetry: false } {
    if (!this.activeTask) {
      throw new Error("Cannot register compression failure without an active task");
    }

    if (this.activeTask.attemptNumber < this.activeTask.maxAttempts) {
      this.activeTask = {
        ...this.activeTask,
        attemptNumber: this.activeTask.attemptNumber + 1,
      };
      return {
        shouldRetry: true,
        task: {
          ...this.activeTask,
          sourceMessages: this.activeTask.sourceMessages.map((message) => ({ ...message })),
        },
      };
    }

    this.activeTask = null;
    return { shouldRetry: false };
  }
}
