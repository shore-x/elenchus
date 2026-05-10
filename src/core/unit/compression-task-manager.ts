// Elenchus - CompressionTaskManager
// Manages unit-level context compression lifecycle without mutating ConversationLedger history.
// Owns the active compression task slot, reminder threshold checks, recent-raw window boundary,
// and limited retry handling for asynchronous Memory Snapshot refreshes.
// registerSuccess receives the current ledger messages so that recentRawStartIndex is computed
// against the live ledger state at completion time, not the frozen snapshot from task start.

import type { ActiveCompressionTaskSnapshot, CompressionManagerSnapshot, ConversationMessage, MemorySnapshot } from "../types.js";
import type { LlmModelInfo } from "../ports.js";
import { tokensToChars } from "../context/context-budget-controller.js";

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
  return messages.reduce((total, message) => {
    if (message.kind === "child_commit_view_message") return total;
    return total + estimateMessageChars(message);
  }, 0);
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

function cloneMemorySnapshot(snapshot: MemorySnapshot | null): MemorySnapshot | null {
  return snapshot ? { ...snapshot } : null;
}

export interface ActiveCompressionTask {
  id: string;
  requirements: string;
  existingMemorySnapshot: MemorySnapshot | null;
  sourceMessages: readonly ConversationMessage[];
  attemptNumber: number;
  maxAttempts: number;
  startedAt: number;
}

function cloneActiveCompressionTask(task: ActiveCompressionTask): ActiveCompressionTask {
  return {
    ...task,
    existingMemorySnapshot: cloneMemorySnapshot(task.existingMemorySnapshot),
    sourceMessages: task.sourceMessages.map((message) => ({ ...message })),
  };
}

function toActiveCompressionTaskSnapshot(task: ActiveCompressionTask | null): ActiveCompressionTaskSnapshot | null {
  if (!task) {
    return null;
  }

  return {
    id: task.id,
    requirements: task.requirements,
    sourceMessageCount: task.sourceMessages.length,
    attemptNumber: task.attemptNumber,
    maxAttempts: task.maxAttempts,
    startedAt: task.startedAt,
  };
}

export class CompressionTaskManager {
  private activeTask: ActiveCompressionTask | null = null;
  private memorySnapshot: MemorySnapshot | null = null;
  private recentRawStartIndex = 0;
  private reminderThresholdChars: number;
  private recentRawTargetChars: number;
  private maxRetries: number;
  private modelInfo: LlmModelInfo | null;

  constructor(options?: {
    modelInfo?: LlmModelInfo;
    reminderThresholdChars?: number;
    recentRawTargetChars?: number;
    maxRetries?: number;
  }) {
    this.modelInfo = options?.modelInfo ?? null;
    const defaultReminderThreshold = this.modelInfo
      ? tokensToChars(Math.floor(this.modelInfo.contextWindowTokens * 0.75))
      : DEFAULT_REMINDER_THRESHOLD_CHARS;
    const defaultRecentRawTarget = this.modelInfo
      ? tokensToChars(Math.floor(this.modelInfo.contextWindowTokens * 0.5))
      : DEFAULT_RECENT_RAW_TARGET_CHARS;
    this.reminderThresholdChars = options?.reminderThresholdChars ?? defaultReminderThreshold;
    this.recentRawTargetChars = options?.recentRawTargetChars ?? defaultRecentRawTarget;
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

  getRecentRawTargetChars(): number {
    return this.recentRawTargetChars;
  }

  getRecentRawStartIndex(): number {
    return this.recentRawStartIndex;
  }

  getModelInfo(): LlmModelInfo | null {
    return this.modelInfo;
  }

  getCapacityGuardCharLimit(): number {
    if (!this.modelInfo) return this.recentRawTargetChars;
    return tokensToChars(Math.floor(this.modelInfo.contextWindowTokens * 0.9));
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

  exportSnapshot(): CompressionManagerSnapshot {
    return {
      activeTask: toActiveCompressionTaskSnapshot(this.activeTask),
      memorySnapshot: this.memorySnapshot ? { ...this.memorySnapshot } : null,
      recentRawStartIndex: this.recentRawStartIndex,
      reminderThresholdChars: this.reminderThresholdChars,
      recentRawTargetChars: this.recentRawTargetChars,
      maxRetries: this.maxRetries,
    };
  }

  loadSnapshot(snapshot: CompressionManagerSnapshot): void {
    this.memorySnapshot = snapshot.memorySnapshot ? { ...snapshot.memorySnapshot } : null;
    this.recentRawStartIndex = snapshot.recentRawStartIndex;
    this.reminderThresholdChars = snapshot.reminderThresholdChars;
    this.recentRawTargetChars = snapshot.recentRawTargetChars;
    this.maxRetries = snapshot.maxRetries;
    this.activeTask = snapshot.activeTask
      ? {
        id: snapshot.activeTask.id,
        requirements: snapshot.activeTask.requirements,
        existingMemorySnapshot: null,
        sourceMessages: [],
        attemptNumber: snapshot.activeTask.attemptNumber,
        maxAttempts: snapshot.activeTask.maxAttempts,
        startedAt: snapshot.activeTask.startedAt,
      }
      : null;
  }

  startTask(requirements: string, sourceMessages: readonly ConversationMessage[], existingMemorySnapshot: MemorySnapshot | null):
    | { ok: true; task: ActiveCompressionTask }
    | { ok: false; error: string } {
    if (this.activeTask) {
      return {
        ok: false,
        error: `A context compression task is already active (${this.activeTask.id}). Duplicate launches are not allowed.`,
      };
    }

    const clonedSourceMessages = sourceMessages.map((message) => ({ ...message }));
    const clonedExistingMemorySnapshot = cloneMemorySnapshot(existingMemorySnapshot);
    if (clonedSourceMessages.length === 0 && !clonedExistingMemorySnapshot?.content.trim()) {
      return {
        ok: false,
        error: "No context is currently available to compress. Start a compression task only when the unit has an existing Memory Snapshot or recent raw conversation history.",
      };
    }

    const task: ActiveCompressionTask = {
      id: generateCompressionTaskId(),
      requirements: requirements.trim(),
      existingMemorySnapshot: clonedExistingMemorySnapshot,
      sourceMessages: clonedSourceMessages,
      attemptNumber: 1,
      maxAttempts: this.maxRetries + 1,
      startedAt: Date.now(),
    };

    this.activeTask = task;
    return { ok: true, task: cloneActiveCompressionTask(task) };
  }

  registerSuccess(content: string, currentMessages: readonly ConversationMessage[]): MemorySnapshot {
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
    // Compute recentRawStartIndex against the current ledger, not the frozen snapshot,
    // so the index remains valid after async compression adds new messages.
    this.recentRawStartIndex = findRecentRawStartIndex(currentMessages, this.recentRawTargetChars);
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
        task: cloneActiveCompressionTask(this.activeTask),
      };
    }

    this.activeTask = null;
    return { shouldRetry: false };
  }
}
