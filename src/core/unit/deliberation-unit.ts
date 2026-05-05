// Elenchus - DeliberationUnit
// The core FSM (5-state: idle/turn-a/turn-b/executing/terminated) that drives dual-agent turn alternation.
// This core unit now depends on abstract ports for LLM completion and tool execution,
// allowing CLI and future UI layers to share the same runtime without inheriting Node-specific details.
// Unit-level context compression is managed here via a separate CompressionTaskManager,
// while agent-visible context remains a turn-scoped projection from ConversationLedger.
// Parent-visible child context includes all children (fixed slot pool model).
// Children are always visible; there is no unmount/remount mechanism.
// The unit also owns durable snapshot export and cold-start restoration of its recoverable child graph.

import { AgentTurn } from "./agent-turn.js";
import { getBuiltInToolRegistry } from "../tools.js";
import { assembleTurnContext, type TurnContextPlan } from "../context/context-assembler.js";
import { createTurnContextBudgetPlan, tightenTurnContextBudgetPlan, type TurnContextBudgetPlan } from "../context/context-budget-controller.js";
import { type ActiveCompressionTask, CompressionTaskManager } from "./compression-task-manager.js";
import { ConversationLedger, type MessagePersistenceSink } from "../conversation-ledger.js";
import { ConversationProjector } from "../conversation-projector.js";
import { buildCompressionSystemPrompt, readRootAgentMd } from "../prompts.js";
import type { LlmClient, LlmMessage, ToolExecutor } from "../ports.js";
import { type AgentId, type ChildCommitView, type CommittedStep, type ContextRecipeData, type ConversationMessage, type DeliberationUnitSnapshot, type LedgerMessageMeta, type OnSystemEvent, type PendingProposal, type PersistedChildSnapshot, type SequencedConversationMessage, type SystemEvent, type ToolLevel, type UnitScope, type UnitState, type UpwardDeliveryMode } from "../types.js";

const AGENT_NAMES: Record<AgentId, string> = {
  "agent-a": "Agent A",
  "agent-b": "Agent B",
};

interface PersistedContextTextRefs {
  memorySnapshotRowid: number | null;
  agentMdRowid: number | null;
  workspaceKnowledge: string | null;
}

export interface ContextPersistenceSink {
  saveContextTextHistory(unitId: string, category: string, content: string, metadata: string): number;
  getLatestContextTextHistory(unitId: string, category: string): { rowid: number; content: string; metadata: string } | null;
  createRecipe(recipe: ContextRecipeData): number;
  updateRecipeOutputMessageId(recipeId: number, outputMessageId: string): void;
  getRecipeByOutputMessageId(messageId: string): ContextRecipeData | null;
  getContextTextHistoryByRowid(rowid: number): { content: string; metadata: string } | null;
  getLedgerMessagesBySeqRange(unitId: string, startSeq: number, endSeq: number): SequencedConversationMessage[];
}

export interface DeliberationUnitOptions {
  llmClient: LlmClient;
  toolExecutor: ToolExecutor;
  workspaceRoot: string;
  projectRoot: string;
  level?: ToolLevel;
  path?: number[];
  unitId?: string;
  onSystemEvent?: OnSystemEvent;
  onDurableStateChange?: () => void;
  messagePersistenceSink?: MessagePersistenceSink;
  contextPersistenceSink?: ContextPersistenceSink;
}

export class DeliberationUnit {
  private state: UnitState = "idle";
  private unitId: string;
  private ledger: ConversationLedger;
  private projector: ConversationProjector;
  private compressionManager: CompressionTaskManager;
  private agentA: AgentTurn;
  private agentB: AgentTurn;
  private loopRunning = false;
  private level: ToolLevel;
  private llmClient: LlmClient;
  private toolExecutor: ToolExecutor;
  private turnCounter = 0;
  private onSystemEvent: OnSystemEvent;
  private scope: UnitScope;
  private executingFromState: "turn-a" | "turn-b" | null = null;
  private children = new Map<string, DeliberationUnit>();
  private childCounter = 0;
  static readonly MAX_CHILDREN = 9;
  private sleepTimer: ReturnType<typeof setTimeout> | null = null;
  private sleepDeadlineMs: number | null = null;
  private consecutiveEmptyTurns = 0;
  private commitLog: CommittedStep[] = [];
  private onDurableStateChange: () => void;
  private suppressDurableStateChangeNotifications = false;
  private readonly messagePersistenceSink: MessagePersistenceSink | undefined;
  private readonly contextPersistenceSink: ContextPersistenceSink | undefined;
  private workspaceRoot: string;
  private activeRecipeId: number | null = null;
  private projectRoot: string;
  private static readonly MAX_EMPTY_TURNS = 4;
  private static readonly CHILD_COMMIT_VIEW_LIMIT = 3;
  private static readonly COMPRESSION_MAX_TOKENS = 4096;


  constructor(options: DeliberationUnitOptions) {
    this.level = options.level ?? "L0";
    this.llmClient = options.llmClient;
    this.toolExecutor = options.toolExecutor;
    this.workspaceRoot = options.workspaceRoot;
    this.projectRoot = options.projectRoot;
    this.unitId = options.unitId ?? DeliberationUnit.buildUnitId(this.level, options.path ?? []);
    this.ledger = new ConversationLedger(options.messagePersistenceSink);
    this.projector = new ConversationProjector();
    this.compressionManager = new CompressionTaskManager();
    this.agentA = new AgentTurn("agent-a", this.llmClient);
    this.agentB = new AgentTurn("agent-b", this.llmClient);
    this.onSystemEvent = options.onSystemEvent ?? (() => {});
    this.onDurableStateChange = options.onDurableStateChange ?? (() => {});
    this.messagePersistenceSink = options.messagePersistenceSink;
    this.contextPersistenceSink = options.contextPersistenceSink;
    this.scope = {
      level: this.level,
      path: options.path ?? [],
    };
  }

  injectUserMessage(content: string): void {
    this.clearSleepState();
    this.ledger.appendIncomingMessage(content, this.buildDeferredVisibilityMeta());
    this.notifyDurableStateChange();
    this.emit({ type: "incoming-message", scope: this.scope, content });

    console.log(`[DU:${this.unitId}] injectUserMessage: state=${this.state}, loopRunning=${this.loopRunning}`);
    if (this.state === "idle" && !this.loopRunning) {
      this.transition(this.state, "turn-a");
      this.loopRunning = true;
      console.log(`[DU:${this.unitId}] Starting runLoop from idle → turn-a`);
      this.runLoop()
        .catch((err) => {
          console.error(`[DU:${this.unitId}] runLoop crashed:`, err);
          this.emit({ type: "error", scope: this.scope, message: `Deliberation loop crashed: ${err}` });
        })
        .finally(() => {
          console.log(`[DU:${this.unitId}] runLoop finished, state=${this.state}`);
          this.loopRunning = false;
        });
    }
  }

  getState(): UnitState {
    return this.state;
  }

  getUnitId(): string {
    return this.unitId;
  }

  getLevel(): ToolLevel {
    return this.level;
  }

  getOnSystemEvent(): OnSystemEvent {
    return this.onSystemEvent;
  }

  setOnSystemEvent(handler: OnSystemEvent): void {
    this.onSystemEvent = handler;
  }

  findUnitById(unitId: string): DeliberationUnit | null {
    if (this.unitId === unitId) {
      return this;
    }
    for (const child of this.children.values()) {
      const found = child.findUnitById(unitId);
      if (found) {
        return found;
      }
    }
    return null;
  }

  appendSystemNotice(content: string): void {
    this.ledger.appendSystemMessage(content, this.buildDeferredVisibilityMeta());
    this.notifyDurableStateChange();
  }

  getCommittedSteps(limit: number = DeliberationUnit.CHILD_COMMIT_VIEW_LIMIT): readonly CommittedStep[] {
    if (limit <= 0) {
      return [];
    }
    return this.commitLog.slice(-limit);
  }

  close(): void {
    if (this.sleepTimer) {
      clearTimeout(this.sleepTimer);
      this.sleepTimer = null;
    }

    for (const child of this.children.values()) {
      child.close();
    }
  }

  exportSnapshot(): DeliberationUnitSnapshot {
    const children: PersistedChildSnapshot[] = [...this.children.entries()].map(([childId, child]) => ({
      childId,
      snapshot: child.exportSnapshot(),
    }));

    return {
      unitId: this.unitId,
      level: this.level,
      path: [...this.scope.path],
      workspaceRoot: this.workspaceRoot,
      projectRoot: this.projectRoot,
      state: this.state,
      turnCounter: this.turnCounter,
      childCounter: this.childCounter,
      ledger: this.ledger.exportSnapshot(),
      compression: this.compressionManager.exportSnapshot(),
      commitLog: this.commitLog.map((step) => ({ ...step })),
      children,
      sleepDeadlineMs: this.sleepDeadlineMs,
    };
  }

  restoreFromSnapshot(
    snapshot: DeliberationUnitSnapshot,
    options?: {
      coldStart?: boolean;
    },
  ): void {
    const coldStart = options?.coldStart ?? false;
    const normalizedState = coldStart ? this.normalizeStateForColdStart(snapshot.state) : snapshot.state;
    const compressionSnapshot = coldStart && snapshot.compression.activeTask
      ? { ...snapshot.compression, activeTask: null }
      : snapshot.compression;
    const recoveryMessages: string[] = [];

    if (coldStart && normalizedState !== snapshot.state) {
      recoveryMessages.push(`This unit was restored after an interrupted session. Its previous active state was reset so it can resume from a clean starting point.`);
    }

    if (coldStart && snapshot.compression.activeTask) {
      recoveryMessages.push(`A context compression task (${snapshot.compression.activeTask.id}) was still active when the session was interrupted. It was cleared during recovery rather than resumed mid-flight.`);
    }

    this.suppressDurableStateChangeNotifications = true;
    try {
      this.unitId = snapshot.unitId;
      this.level = snapshot.level;
      this.workspaceRoot = snapshot.workspaceRoot;
      this.projectRoot = snapshot.projectRoot;
      this.scope = {
        level: snapshot.level,
        path: [...snapshot.path],
      };
      this.state = normalizedState;
      this.turnCounter = snapshot.turnCounter;
      this.childCounter = snapshot.childCounter;
      this.executingFromState = null;
      this.loopRunning = false;
      this.consecutiveEmptyTurns = 0;
      this.ledger.loadSnapshot(snapshot.ledger);
      if (coldStart) {
        const supersededCount = this.ledger.supersedeAllPendingProposals();
        if (supersededCount > 0) {
          recoveryMessages.push(`${supersededCount} pending proposal(s) were superseded during cold-start recovery. They can no longer be voted on; new proposals may be submitted instead.`);
        }
      }
      this.compressionManager.loadSnapshot(compressionSnapshot);
      this.commitLog = snapshot.commitLog.map((step) => ({ ...step }));
      this.children = new Map<string, DeliberationUnit>();
      this.clearSleepState();

      for (const childEntry of snapshot.children) {

        const child = this.createChildUnit(
          childEntry.childId,
          childEntry.snapshot.level,
          childEntry.snapshot.path,
          childEntry.snapshot.unitId,
        );
        child.restoreFromSnapshot(childEntry.snapshot, options);
        this.children.set(childEntry.childId, child);
      }

      if (snapshot.sleepDeadlineMs !== null) {
        const remainingMs = snapshot.sleepDeadlineMs - Date.now();
        if (remainingMs > 0) {
          this.scheduleSleepTimer(remainingMs, snapshot.sleepDeadlineMs);
        } else if (coldStart) {
          recoveryMessages.push(`A sleep timeout elapsed while the session was offline. The unit is now eligible to resume deliberation.`);
        }
      }

      if (coldStart) {
        const recoveryMeta = this.buildDeferredVisibilityMeta();
        for (const message of recoveryMessages) {
          this.ledger.appendSystemMessage(message, recoveryMeta);
        }
      }
    } finally {
      this.suppressDurableStateChangeNotifications = false;
      this.ledger.flushPendingUpdates();
    }

    this.notifyDurableStateChange();
  }

  terminate(): void {
    if (this.state !== "terminated") {
      for (const child of this.children.values()) {
        child.terminate();
      }
      this.transition(this.state, "terminated");
    }
  }

  private buildChildCommitViews(limit: number = DeliberationUnit.CHILD_COMMIT_VIEW_LIMIT): ChildCommitView[] {
    return [...this.children.keys()]
      .map((childId) => {
        const child = this.children.get(childId);
        if (!child) {
          return null;
        }

        return {
          childId,
          state: child.getState(),
          committedSteps: child.getCommittedSteps(limit),
        } satisfies ChildCommitView;
      })
      .filter((view): view is ChildCommitView => view !== null);
  }

  private hasChildren(): boolean {
    return this.children.size > 0;
  }

  private recordCommittedStep(proposal: PendingProposal): void {
    this.commitLog.push({
      toolName: proposal.toolName,
      proposedStep: proposal.proposedStep,
      proposedBy: proposal.proposer,
      committedAt: Date.now(),
    });
  }

  private buildDeferredVisibilityMeta(): LedgerMessageMeta {
    return {
      turnAuthored: this.turnCounter,
      visibleFromTurn: this.turnCounter + 1,
    };
  }

  private getPendingProposal(): PendingProposal | null {
    return this.ledger.getPendingProposalView();
  }

  private static buildUnitId(level: ToolLevel, path: number[]): string {
    if (path.length === 0) return "unit-root";
    const padded = path.map((s) => String(s).padStart(2, "0"));
    return `${level}-${padded.join("-")}`;
  }

  private static findNextChildSlot(parentLevel: ToolLevel, parentPath: number[], existingChildIds: Set<string>): number[] {
    const childLevel = parentLevel === "L0" ? "L1" as const : "L2" as const;

    for (let i = 1; i <= DeliberationUnit.MAX_CHILDREN; i++) {
      const childPath = [...parentPath, i];
      const padded = childPath.map((s) => String(s).padStart(2, "0"));
      const candidateId = `${childLevel}-${padded.join("-")}`;
      if (!existingChildIds.has(candidateId)) {
        return childPath;
      }
    }
    throw new Error("Could not find available child slot");
  }

  private normalizeStateForColdStart(state: UnitState): UnitState {
    if (state === "turn-a" || state === "turn-b" || state === "executing") {
      return "idle";
    }

    return state;
  }

  private notifyDurableStateChange(): void {
    if (this.suppressDurableStateChangeNotifications) {
      return;
    }

    this.onDurableStateChange();
  }

  private clearSleepState(): void {
    if (this.sleepTimer) {
      clearTimeout(this.sleepTimer);
      this.sleepTimer = null;
    }

    this.sleepDeadlineMs = null;
  }

  private scheduleSleepTimer(timeoutMs: number, deadlineMs: number): void {
    this.clearSleepState();
    this.sleepDeadlineMs = deadlineMs;
    this.sleepTimer = setTimeout(() => {
      this.sleepTimer = null;
      this.sleepDeadlineMs = null;
      this.ledger.appendSystemMessage(`The sleep timeout elapsed without any child unit reporting. The unit became eligible to resume deliberation.`, this.buildDeferredVisibilityMeta());
      this.notifyDurableStateChange();
      this.wakeIfIdle();
    }, timeoutMs);
    this.notifyDurableStateChange();
  }

  private createChildUnit(
    childId: string,
    childLevel: ToolLevel,
    childPath: number[],
    unitId?: string,
  ): DeliberationUnit {
    const child = new DeliberationUnit({
      llmClient: this.llmClient,
      toolExecutor: this.toolExecutor,
      workspaceRoot: this.workspaceRoot,
      projectRoot: this.projectRoot,
      level: childLevel,
      path: childPath,
      unitId,
      messagePersistenceSink: this.messagePersistenceSink,
      contextPersistenceSink: this.contextPersistenceSink,
      onSystemEvent: (event: SystemEvent) => {
        if (event.type === "upward-message" && this.sameScope(event.scope, child.scope)) {
          const broadcastMeta = this.buildDeferredVisibilityMeta();
          this.ledger.appendChildReportMessage({
            childId,
            deliveryMode: event.deliveryMode,
            content: event.content,
            ...broadcastMeta,
          });
          this.notifyDurableStateChange();
          this.wakeIfIdle();
        }
        this.emit(event);
      },
      onDurableStateChange: () => {
        this.notifyDurableStateChange();
      },
    });

    return child;
  }

  private sameScope(left: UnitScope, right: UnitScope): boolean {
    return left.level === right.level
      && left.path.length === right.path.length
      && left.path.every((segment, index) => segment === right.path[index]);
  }

  private buildImmediateVisibilityMeta(): LedgerMessageMeta {
    return {
      turnAuthored: this.turnCounter,
      visibleFromTurn: this.turnCounter,
    };
  }

  private appendChildCommitViewSnapshot(agentId: AgentId, childCommitViews: readonly ChildCommitView[]): void {
    if (childCommitViews.length === 0) {
      return;
    }

    const rendered = this.projector.buildChildCommitViewMessage(agentId, childCommitViews);
    if (rendered && rendered.role === "user") {
      this.ledger.appendChildCommitViewMessage(rendered.content as string, this.buildImmediateVisibilityMeta());
      this.notifyDurableStateChange();
    }
  }

  private persistContextTextRefs(): PersistedContextTextRefs {
    const memorySnapshot = this.compressionManager.getMemorySnapshot();
    const workspaceKnowledge = readRootAgentMd(this.workspaceRoot);
    if (!this.contextPersistenceSink) {
      return {
        memorySnapshotRowid: null,
        agentMdRowid: null,
        workspaceKnowledge,
      };
    }

    let memorySnapshotRowid: number | null = null;
    if (memorySnapshot) {
      const metadata = JSON.stringify({
        sourceMessageCount: memorySnapshot.sourceMessageCount,
        requirements: memorySnapshot.requirements,
      });
      memorySnapshotRowid = this.contextPersistenceSink.saveContextTextHistory(
        this.unitId,
        "memory_snapshot",
        memorySnapshot.content,
        metadata,
      );
    }

    const agentMdRowid = workspaceKnowledge !== null
      ? this.contextPersistenceSink.saveContextTextHistory(
        this.unitId,
        "agent_md",
        workspaceKnowledge,
        JSON.stringify({ path: `${this.workspaceRoot}/AGENT.md` }),
      )
      : null;

    return {
      memorySnapshotRowid,
      agentMdRowid,
      workspaceKnowledge,
    };
  }

  private createContextRecipeFromPlan(plan: TurnContextPlan): void {
    if (!this.contextPersistenceSink) return;

    const recipe: ContextRecipeData = {
      unitId: this.unitId,
      agentId: plan.agentId,
      recentRawStartSeq: plan.recentRawStartSeq,
      visibleEndSeq: plan.visibleEndSeq,
      newlyVisibleSeq: plan.newlyVisibleSeq,
      memorySnapshotRowid: plan.memorySnapshotRowid,
      agentMdRowid: plan.agentMdRowid,
      level: plan.level,
      hasPendingFromOther: plan.hasPendingFromOther,
      hasChildren: plan.hasChildren,
      canSpawnChild: plan.canSpawnChild,
      compressionReminderShown: plan.compressionReminderShown,
      compressionReminderChars: plan.compressionReminderChars,
      compressionReminderThresholdChars: plan.compressionReminderThresholdChars,
      truncationApplied: plan.truncationApplied,
      truncationReason: plan.truncationReason,
      truncationLevel: plan.truncationLevel,
      effectiveTurn: plan.effectiveTurn,
    };

    this.activeRecipeId = this.contextPersistenceSink.createRecipe(recipe);
  }

  private buildCompressionTaskStartMessage(task: ActiveCompressionTask): string {
    const requirementsPreview = task.requirements.length > 160
      ? `${task.requirements.slice(0, 160)}...`
      : task.requirements;

    return `A background context compression task (${task.id}) started to refresh the unit's memory snapshot. The unit continues normal deliberation while this task runs, and no sleep is required merely to wait for compression completion. Preservation priorities: ${requirementsPreview || "none specified"}`;
  }

  private buildCompressionTaskFailureMessage(task: ActiveCompressionTask, error: unknown): string {
    const detail = error instanceof Error ? error.message : String(error);
    return `The context compression task (${task.id}) failed: ${detail}. The unit returned to a state with no active compression task so the agents can handle the failure and, if appropriate, propose another compression task.`;
  }

  private buildCompressionTaskSuccessMessage(task: ActiveCompressionTask): string {
    return `The background context compression task (${task.id}) completed and refreshed the unit's memory snapshot. Future turns can use the updated snapshot without pausing the unit's workflow.`;
  }

  private buildCompressionRequestMessage(task: ActiveCompressionTask): LlmMessage {
    const existingSnapshot = task.existingMemorySnapshot?.content.trim() || "No prior Memory Snapshot is available.";
    const renderedHistory = this.projector
      .projectVisibleMessages(task.sourceMessages)
      .map((message) => message.content)
      .join("\n\n");

    return {
      role: "user",
      content:
        `[Compression Task]\n` +
        `Preservation requirements:\n---\n${task.requirements || "No extra preservation requirements were provided."}\n---\n\n` +
        `Earlier Memory Snapshot reference:\n---\n${existingSnapshot}\n---\n\n` +
        `Recent Raw Window:\n\n${renderedHistory || "No recent raw conversation history is available."}\n\n` +
        `Write a refreshed Memory Snapshot that integrates the earlier snapshot reference with the recent raw window. Overlap between them is expected rather than erroneous.`,
      timestamp: Date.now(),
    };
  }

  private linkRecipeOutputMessage(outputMessageId: string): void {
    if (this.activeRecipeId !== null && this.contextPersistenceSink) {
      this.contextPersistenceSink.updateRecipeOutputMessageId(this.activeRecipeId, outputMessageId);
      this.activeRecipeId = null;
    }
  }

  private emitUpwardMessage(deliveryMode: UpwardDeliveryMode, content: string): void {
    this.ledger.appendUpwardMessage({
      deliveryMode,
      content,
      ...this.buildDeferredVisibilityMeta(),
    });
    this.notifyDurableStateChange();
    this.emit({ type: "upward-message", scope: this.scope, deliveryMode, content });
  }

  private async executeCompressionTask(task: ActiveCompressionTask): Promise<void> {
    try {
      const response = await this.llmClient.complete({
        systemPrompt: buildCompressionSystemPrompt(),
        messages: [this.buildCompressionRequestMessage(task)],
        tools: [],
      }, { maxTokens: DeliberationUnit.COMPRESSION_MAX_TOKENS });

      const content = response.content
        .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
        .map((block) => block.text)
        .join("")
        .trim();

      if (!content) {
        throw new Error("The compression LLM returned an empty memory snapshot.");
      }

      this.compressionManager.registerSuccess(content, this.ledger.readAll());
      this.ledger.appendSystemMessage(this.buildCompressionTaskSuccessMessage(task), this.buildDeferredVisibilityMeta());
      this.notifyDurableStateChange();
    } catch (error) {
      const failure = this.compressionManager.registerFailure();
      this.notifyDurableStateChange();
      if (failure.shouldRetry) {
        this.emit({
          type: "warning",
          scope: this.scope,
          message: `Context compression task ${failure.task.id} failed on attempt ${failure.task.attemptNumber - 1}. Retrying automatically once more.`,
        });
        void this.executeCompressionTask(failure.task);
        return;
      }

      const failureMessage = this.buildCompressionTaskFailureMessage(task, error);
      this.ledger.appendSystemMessage(failureMessage, this.buildDeferredVisibilityMeta());
      this.notifyDurableStateChange();
      this.emit({ type: "warning", scope: this.scope, message: failureMessage });
      this.wakeIfIdle();
    }
  }

  private static isContextTooLongError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return (
      msg.includes("max message tokens") ||
      msg.includes("context_length_exceeded") ||
      msg.includes("context window") ||
      msg.includes("maximum context") ||
      msg.includes("tokens exceed") ||
      msg.includes("token limit") ||
      (msg.includes("400") && msg.includes("tokens"))
    );
  }

  private async runLoop(): Promise<void> {
    while (this.state === "turn-a" || this.state === "turn-b") {
      const currentAgent: AgentId = this.state === "turn-a" ? "agent-a" : "agent-b";
      const agentName = AGENT_NAMES[currentAgent];
      const agentTurn = currentAgent === "agent-a" ? this.agentA : this.agentB;

      this.turnCounter++;
      this.notifyDurableStateChange();
      const hasChildren = this.hasChildren();
      const childCommitViews = hasChildren ? this.buildChildCommitViews() : [];
      this.appendChildCommitViewSnapshot(currentAgent, childCommitViews);
      const visibleSnapshot = this.ledger.readVisibleSnapshotForAgent(currentAgent, this.turnCounter);
      const canSpawnChild = this.children.size < DeliberationUnit.MAX_CHILDREN;
      const pendingProposal = this.getPendingProposal();
      const persistedContextTextRefs = this.persistContextTextRefs();
      const reminderShown = this.compressionManager.shouldShowReminder(visibleSnapshot.visibleMessages);
      const reminderChars = reminderShown
        ? this.compressionManager.estimateRecentRawChars(visibleSnapshot.visibleMessages)
        : null;
      const reminderThresholdChars = reminderShown
        ? this.compressionManager.getReminderThresholdChars()
        : null;

      let budgetPlan: TurnContextBudgetPlan = createTurnContextBudgetPlan({
        visibleMessages: visibleSnapshot.visibleMessages,
        newlyVisibleMessages: visibleSnapshot.newlyVisibleMessages,
        currentSequenceStart: this.ledger.currentSequenceStart,
        baseRecentRawStartSeq: this.ledger.currentSequenceStart + this.compressionManager.getRecentRawStartIndex(),
        compressionReminderShown: reminderShown,
        compressionReminderChars: reminderChars,
        compressionReminderThresholdChars: reminderThresholdChars,
        hardRecentRawCharLimit: this.compressionManager.getRecentRawTargetChars(),
      });

      const assembleCurrentTurn = (plan: TurnContextBudgetPlan) => assembleTurnContext({
        unitId: this.unitId,
        agentId: currentAgent,
        level: this.level,
        workspaceRoot: this.workspaceRoot,
        workspaceKnowledge: persistedContextTextRefs.workspaceKnowledge,
        agentMdRowid: persistedContextTextRefs.agentMdRowid,
        visibleMessages: visibleSnapshot.visibleMessages,
        newlyVisibleMessages: visibleSnapshot.newlyVisibleMessages,
        pendingProposal,
        childCommitViews,
        hasChildren,
        canSpawnChild,
        memorySnapshot: this.compressionManager.getMemorySnapshot(),
        memorySnapshotRowid: persistedContextTextRefs.memorySnapshotRowid,
        budgetPlan: plan,
        effectiveTurn: this.turnCounter,
      });

      let assembled = assembleCurrentTurn(budgetPlan);

      this.emit({
        type: "turn-start",
        scope: this.scope,
        turn: this.turnCounter,
        agent: currentAgent,
        state: this.state,
        contextSize: assembled.llmContext.messages.length,
        newMessages: visibleSnapshot.newlyVisibleMessages.length,
      });

      let result;
      while (true) {
        this.createContextRecipeFromPlan(assembled.plan);

        if (assembled.plan.truncationApplied) {
          this.emit({
            type: "warning",
            scope: this.scope,
            message: `Context pressure required truncation before calling ${agentName} (reason: ${assembled.plan.truncationReason}, level: ${assembled.plan.truncationLevel}).`,
          });
        }

        console.log(`[DU:${this.unitId}] turn#${this.turnCounter} ${agentName}: calling LLM with ${assembled.llmContext.messages.length} messages, recentRawStartSeq=${assembled.plan.recentRawStartSeq}, visibleEndSeq=${assembled.plan.visibleEndSeq}, truncationLevel=${assembled.plan.truncationLevel}`);

        try {
          result = await agentTurn.execute(assembled.llmContext, assembled.tools);
          break;
        } catch (err) {
          console.error(`[DU:${this.unitId}] LLM call failed (truncation level ${assembled.plan.truncationLevel}):`, err);
          if (!DeliberationUnit.isContextTooLongError(err)) {
            this.emit({ type: "error", scope: this.scope, message: `LLM call failed for ${agentName}: ${err}. Check API key, base URL, and network connectivity.` });
            this.transition(this.state, "idle");
            return;
          }

          const tightenedPlan = tightenTurnContextBudgetPlan({
            visibleMessages: visibleSnapshot.visibleMessages,
            currentSequenceStart: this.ledger.currentSequenceStart,
            currentPlan: budgetPlan,
            targetRecentRawChars: Math.max(Math.floor(this.compressionManager.getRecentRawTargetChars() / 2), 1200),
          });
          if (!tightenedPlan) {
            this.emit({ type: "error", scope: this.scope, message: `Context too long for ${agentName} even after deterministic recent-raw truncation. Please compress the context manually using compressContext.` });
            this.transition(this.state, "idle");
            return;
          }

          budgetPlan = tightenedPlan;
          assembled = assembleCurrentTurn(budgetPlan);
          this.emit({
            type: "warning",
            scope: this.scope,
            message: `Context too long — rebuilding ${agentName}'s turn with a tighter recent-raw window (truncation level ${assembled.plan.truncationLevel}).`,
          });
        }
      }

      console.log(`[DU:${this.unitId}] turn#${this.turnCounter} ${agentName}: reply=${JSON.stringify(result.reply?.slice(0, 100))}, action=${result.action?.kind ?? "none"}, stopReason=${result.stopReason}, broadcasts=${result.unitRuntimeBroadcasts?.length ?? 0}`);

      const isEmpty = !result.reply?.trim() && !result.action && !(result.unitRuntimeBroadcasts?.length);
      if (isEmpty) {
        this.consecutiveEmptyTurns++;
        console.warn(`[DU:${this.unitId}] turn#${this.turnCounter} ${agentName}: EMPTY response (consecutive=${this.consecutiveEmptyTurns}/${DeliberationUnit.MAX_EMPTY_TURNS})`);
        if (this.consecutiveEmptyTurns >= DeliberationUnit.MAX_EMPTY_TURNS) {
          this.emit({ type: "error", scope: this.scope, message: `${DeliberationUnit.MAX_EMPTY_TURNS} consecutive empty responses detected. Halting — likely API misconfiguration (wrong key, URL, or model).` });
          this.transition(this.state, "idle");
          return;
        }
      } else {
        this.consecutiveEmptyTurns = 0;
      }

      if (result.reply) {
        const agentMsg = this.ledger.appendAgentMessage(currentAgent, result.reply, this.buildDeferredVisibilityMeta());
        this.linkRecipeOutputMessage(agentMsg.id);
        this.notifyDurableStateChange();
        this.emit({ type: "agent-message", scope: this.scope, turn: this.turnCounter, agent: currentAgent, content: result.reply });
      }

      if (result.unitRuntimeBroadcasts?.length) {
        const broadcastMeta = this.buildDeferredVisibilityMeta();
        for (const broadcast of result.unitRuntimeBroadcasts) {
          this.ledger.appendSystemMessage(broadcast.content, broadcastMeta);
          this.emit({ type: "warning", scope: this.scope, message: broadcast.content });
        }
        this.notifyDurableStateChange();
      }

      if (result.stopReason === "length") {
        this.emit({ type: "warning", scope: this.scope, message: `${agentName}'s response was truncated (stopReason: length). Consider increasing maxTokens.` });
      }

      if (result.action?.kind === "vote" && pendingProposal) {
        const vote = result.action.vote;
        const toolName = pendingProposal.toolName;
        const voteMeta = this.buildDeferredVisibilityMeta();

        if (vote.approve) {
          const approvedProposal = pendingProposal;
          this.emit({ type: "vote", scope: this.scope, voter: currentAgent, proposer: pendingProposal.proposer, toolName, approve: true, reason: vote.reason });
          const voteMessage = this.ledger.appendVoteMessage({
            voter: currentAgent,
            proposalId: approvedProposal.messageId,
            approve: true,
            reason: vote.reason,
            ...voteMeta,
          });
          this.linkRecipeOutputMessage(voteMessage.id);
          this.ledger.markProposalApproved(approvedProposal.messageId);
          this.recordCommittedStep(approvedProposal);
          this.notifyDurableStateChange();

          const resolvedTool = getBuiltInToolRegistry(this.level).get(toolName);

          if (toolName === "yield") {
            const yieldContent = approvedProposal.args.content as string;
            this.emitUpwardMessage("yield", yieldContent);
            this.transition(this.state, "idle");
            return;
          }

          if (toolName === "sleep") {
            const timeoutMs = (approvedProposal.args.timeoutSeconds as number) * 1000;
            this.transition(this.state, "idle");
            this.scheduleSleepTimer(timeoutMs, Date.now() + timeoutMs);
            return;
          }

          if (resolvedTool?.behavior === "blocking") {
            this.executingFromState = this.state as "turn-a" | "turn-b";
            this.transition(this.state, "executing");
            this.emit({ type: "tool-executing", scope: this.scope, toolName: approvedProposal.toolName, args: approvedProposal.args });
            const execResult = await this.toolExecutor.execute(approvedProposal.toolName, approvedProposal.args, { cwd: this.projectRoot, level: this.level });
            this.ledger.appendToolResultMessage({
              proposalId: approvedProposal.messageId,
              toolName,
              success: execResult.success,
              output: execResult.output,
              durationMs: execResult.durationMs,
              ...this.buildDeferredVisibilityMeta(),
            });
            this.notifyDurableStateChange();
            this.emit({ type: "tool-result", scope: this.scope, toolName, success: execResult.success, output: execResult.output, durationMs: execResult.durationMs });
            const nextState: UnitState = this.executingFromState === "turn-a" ? "turn-b" : "turn-a";
            this.executingFromState = null;
            this.transition("executing", nextState);
            continue;
          }

          if (resolvedTool?.behavior === "nonblocking") {
            this.executeNonBlockingTool(approvedProposal);
          }
        } else {
          this.emit({ type: "vote", scope: this.scope, voter: currentAgent, proposer: pendingProposal.proposer, toolName, approve: false, reason: vote.reason });
          const voteMessage = this.ledger.appendVoteMessage({
            voter: currentAgent,
            proposalId: pendingProposal.messageId,
            approve: false,
            reason: vote.reason,
            ...voteMeta,
          });
          this.linkRecipeOutputMessage(voteMessage.id);
          this.ledger.markProposalRejected(pendingProposal.messageId);
          this.notifyDurableStateChange();
        }
      }

      if (result.action?.kind === "proposal") {
        const proposal = result.action.proposal;
        const proposalMessage = this.ledger.appendProposalMessage({
          authoredBy: currentAgent,
          toolName: proposal.toolName,
          args: proposal.args,
          proposedStep: proposal.proposedStep,
          ...this.buildDeferredVisibilityMeta(),
        });
        this.linkRecipeOutputMessage(proposalMessage.id);
        this.notifyDurableStateChange();
        this.emit({ type: "proposal", scope: this.scope, agent: currentAgent, toolName: proposal.toolName, args: proposal.args });

        // Auto-approve path: read-only tools bypass partner vote
        const resolvedTool = getBuiltInToolRegistry(this.level).get(proposal.toolName);
        if (resolvedTool?.autoApprove) {
          const autoApprovedProposal = this.getPendingProposal();
          if (autoApprovedProposal) {
            this.ledger.markProposalApproved(autoApprovedProposal.messageId);
            this.recordCommittedStep(autoApprovedProposal);
            this.ledger.appendSystemMessage(
              `${proposal.toolName} executed (read-only operations do not require partner vote)`,
              this.buildDeferredVisibilityMeta(),
            );
            this.notifyDurableStateChange();

            // Execute as blocking tool (same path as vote-approved blocking tools)
            this.executingFromState = this.state as "turn-a" | "turn-b";
            this.transition(this.state, "executing");
            this.emit({ type: "tool-executing", scope: this.scope, toolName: autoApprovedProposal.toolName, args: autoApprovedProposal.args });
            const execResult = await this.toolExecutor.execute(autoApprovedProposal.toolName, autoApprovedProposal.args, { cwd: this.projectRoot, level: this.level });
            this.ledger.appendToolResultMessage({
              proposalId: autoApprovedProposal.messageId,
              toolName: proposal.toolName,
              success: execResult.success,
              output: execResult.output,
              durationMs: execResult.durationMs,
              ...this.buildDeferredVisibilityMeta(),
            });
            this.notifyDurableStateChange();
            this.emit({ type: "tool-result", scope: this.scope, toolName: proposal.toolName, success: execResult.success, output: execResult.output, durationMs: execResult.durationMs });
            const autoNextState: UnitState = this.executingFromState === "turn-a" ? "turn-b" : "turn-a";
            this.executingFromState = null;
            this.transition("executing", autoNextState);
            continue;
          }
        }
      }

      const nextState: UnitState = this.state === "turn-a" ? "turn-b" : "turn-a";
      this.transition(this.state, nextState);
    }
  }

  private executeNonBlockingTool(proposal: PendingProposal): void {
    const { toolName, args } = proposal;

    if (toolName === "report") {
      const content = String(args.content ?? "");
      this.emitUpwardMessage("report", content);
      return;
    }

    if (toolName === "compressContext") {
      const requirements = String(args.requirements ?? "");
      const allMessages = this.ledger.readAll();
      const recentRawMessages = this.compressionManager.getRecentRawMessages(allMessages);
      const started = this.compressionManager.startTask(
        requirements,
        recentRawMessages,
        this.compressionManager.getMemorySnapshot(),
      );
      if (!started.ok) {
        this.ledger.appendSystemMessage(started.error, this.buildDeferredVisibilityMeta());
        this.notifyDurableStateChange();
        this.emit({ type: "warning", scope: this.scope, message: started.error });
        return;
      }

      this.ledger.appendSystemMessage(this.buildCompressionTaskStartMessage(started.task), this.buildDeferredVisibilityMeta());
      this.notifyDurableStateChange();
      void this.executeCompressionTask(started.task);
      return;
    }

    if (toolName === "spawnChild") {
      if (this.children.size >= DeliberationUnit.MAX_CHILDREN) {
        this.ledger.appendSystemMessage(
          `Cannot spawn child: maximum child count (${DeliberationUnit.MAX_CHILDREN}) reached. ` +
          `Use sendToChild to send additional context to the most relevant existing child instead.`,
          this.buildDeferredVisibilityMeta(),
        );
        this.notifyDurableStateChange();
        this.emit({ type: "warning", scope: this.scope, message: `spawnChild rejected: child limit (${DeliberationUnit.MAX_CHILDREN}) reached` });
        return;
      }
      const task = args.task as string;
      const childLevel = this.level === "L0" ? "L1" as const : "L2" as const;
      const existingChildIds = new Set(this.children.keys());
      const childPath = DeliberationUnit.findNextChildSlot(this.level, this.scope.path, existingChildIds);
      const childId = DeliberationUnit.buildUnitId(childLevel, childPath);
      this.childCounter = childPath[childPath.length - 1];

      const child = this.createChildUnit(childId, childLevel, childPath);

      this.children.set(childId, child);

      const taskPreview = task.length > 100 ? task.slice(0, 100) + "..." : task;
      this.ledger.appendSystemMessage(`Child unit ${childId} started with the following task: ${taskPreview}`, this.buildDeferredVisibilityMeta());
      this.notifyDurableStateChange();
      this.emit({ type: "child-spawned", scope: child.scope, task });
      child.injectUserMessage(task);
    } else if (toolName === "sendToChild") {
      const childId = args.childId as string;
      const message = args.message as string;
      const child = this.children.get(childId);

      if (!child) {
        const childIds = [...this.children.keys()].join(", ") || "none";
        this.ledger.appendSystemMessage(`The message could not be delivered to child unit ${childId} because no such child unit exists. Current child units: ${childIds}`, this.buildDeferredVisibilityMeta());
        this.notifyDurableStateChange();
        this.emit({ type: "warning", scope: this.scope, message: `sendToChild failed: child ${childId} not found` });
        return;
      }

      if (child.getState() !== "idle") {
        this.ledger.appendSystemMessage(`Child unit ${childId} is currently active — the message was queued and will be available to that child as it continues work.`, this.buildDeferredVisibilityMeta());
        this.notifyDurableStateChange();
      }

      child.injectUserMessage(message);
      this.ledger.appendSystemMessage(`The following message was sent to child unit ${childId}: ${message.length > 100 ? message.slice(0, 100) + "..." : message}`, this.buildDeferredVisibilityMeta());
      this.notifyDurableStateChange();
      this.emit({ type: "child-message-sent", scope: child.scope, message });
    }
  }

  private emit(event: SystemEvent): void {
    this.onSystemEvent(event);
  }

  private wakeIfIdle(): void {
    this.clearSleepState();
    if (this.state === "idle" && !this.loopRunning) {
      this.transition("idle", "turn-a");
      this.loopRunning = true;
      this.runLoop()
        .catch((err) => {
          this.emit({ type: "error", scope: this.scope, message: `Deliberation loop crashed: ${err}` });
        })
        .finally(() => {
          this.loopRunning = false;
        });
    }
  }

  private transition(from: UnitState, to: UnitState): void {
    this.emit({ type: "state-transition", scope: this.scope, from, to });
    this.state = to;
    this.notifyDurableStateChange();
  }
}
