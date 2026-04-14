// Elenchus - DeliberationUnit
// The core FSM (5-state: idle/turn-a/turn-b/executing/terminated) that drives dual-agent turn alternation.
// This core unit now depends on abstract ports for LLM completion and tool execution,
// allowing CLI and future UI layers to share the same runtime without inheriting Node-specific details.
// Unit-level context compression is managed here via a separate CompressionTaskManager,
// while agent-visible context remains a turn-scoped projection from ConversationLedger.
// Parent-visible child context is restricted to the currently mounted child set; idle
// children can be unmounted from that visible set and later remounted by new upward activity.
// The unit also owns durable snapshot export and cold-start restoration of its recoverable child graph.

import { AgentTurn } from "./agent-turn.js";
import { getBuiltInToolRegistry } from "../tools.js";
import { type ActiveCompressionTask, CompressionTaskManager } from "./compression-task-manager.js";
import { ConversationLedger } from "../conversation-ledger.js";
import { ConversationProjector } from "../conversation-projector.js";
import { buildCompressionSystemPrompt } from "../prompts.js";
import type { LlmClient, LlmMessage, ToolExecutor } from "../ports.js";
import { type AgentId, type ChildCommitView, type CommittedStep, type ConversationMessage, type DeliberationUnitSnapshot, type LedgerMessageMeta, type OnSystemEvent, type PendingProposal, type PersistedChildSnapshot, type SystemEvent, type ToolLevel, type UnitScope, type UnitState, type UpwardDeliveryMode } from "../types.js";

const AGENT_NAMES: Record<AgentId, string> = {
  "agent-a": "Agent A",
  "agent-b": "Agent B",
};

export interface DeliberationUnitOptions {
  llmClient: LlmClient;
  toolExecutor: ToolExecutor;
  runDirectory: string;
  level?: ToolLevel;
  path?: number[];
  unitId?: string;
  onSystemEvent?: OnSystemEvent;
  onDurableStateChange?: () => void;
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
  private dormantChildren = new Map<string, PersistedChildSnapshot>();
  private mountedChildren = new Set<string>();
  private childCounter = 0;
  private sleepTimer: ReturnType<typeof setTimeout> | null = null;
  private sleepDeadlineMs: number | null = null;
  private consecutiveEmptyTurns = 0;
  private commitLog: CommittedStep[] = [];
  private onDurableStateChange: () => void;
  private suppressDurableStateChangeNotifications = false;
  private runDirectory: string;
  private static readonly MAX_EMPTY_TURNS = 4;
  private static readonly CHILD_COMMIT_VIEW_LIMIT = 3;
  private static readonly COMPRESSION_MAX_TOKENS = 4096;

  constructor(options: DeliberationUnitOptions) {
    this.level = options.level ?? "L0";
    this.llmClient = options.llmClient;
    this.toolExecutor = options.toolExecutor;
    this.runDirectory = options.runDirectory;
    this.unitId = options.unitId ?? DeliberationUnit.buildDefaultUnitId(options.path ?? []);
    this.ledger = new ConversationLedger();
    this.projector = new ConversationProjector();
    this.compressionManager = new CompressionTaskManager();
    this.agentA = new AgentTurn("agent-a", this.llmClient, this.level, this.runDirectory);
    this.agentB = new AgentTurn("agent-b", this.llmClient, this.level, this.runDirectory);
    this.onSystemEvent = options.onSystemEvent ?? (() => {});
    this.onDurableStateChange = options.onDurableStateChange ?? (() => {});
    this.scope = {
      level: this.level,
      path: options.path ?? [],
    };
  }

  injectUserMessage(content: string): void {
    this.clearSleepState();
    this.ledger.appendIncomingMessage(content, this.buildDeferredVisibilityMeta());
    this.notifyDurableStateChange();

    if (this.state === "idle" && !this.loopRunning) {
      this.transition(this.state, "turn-a");
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

  getState(): UnitState {
    return this.state;
  }

  getUnitId(): string {
    return this.unitId;
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
      mounted: this.mountedChildren.has(childId),
      snapshot: child.exportSnapshot(),
    }));
    for (const [childId, childSnapshot] of this.dormantChildren.entries()) {
      if (!this.children.has(childId)) {
        children.push({
          childId: childSnapshot.childId,
          mounted: childSnapshot.mounted,
          snapshot: childSnapshot.snapshot,
        });
      }
    }

    return {
      unitId: this.unitId,
      level: this.level,
      path: [...this.scope.path],
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
      includeUnmountedChildren?: boolean;
      coldStart?: boolean;
    },
  ): void {
    const includeUnmountedChildren = options?.includeUnmountedChildren ?? true;
    const coldStart = options?.coldStart ?? false;
    const normalizedState = coldStart ? this.normalizeStateForColdStart(snapshot.state) : snapshot.state;
    const compressionSnapshot = coldStart && snapshot.compression.activeTask
      ? { ...snapshot.compression, activeTask: null }
      : snapshot.compression;
    const recoveryMessages: string[] = [];

    if (coldStart && normalizedState !== snapshot.state) {
      recoveryMessages.push(`This unit was restored from persisted state after an interrupted runtime. Its persisted state \"${snapshot.state}\" was normalized to \"idle\" on cold start.`);
    }

    if (coldStart && snapshot.compression.activeTask) {
      recoveryMessages.push(`A context compression task (${snapshot.compression.activeTask.id}) was still marked active when the runtime shut down. It was cleared during cold-start recovery rather than resumed mid-flight.`);
    }

    this.suppressDurableStateChangeNotifications = true;
    try {
      this.unitId = snapshot.unitId;
      this.level = snapshot.level;
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
      this.compressionManager.loadSnapshot(compressionSnapshot);
      this.commitLog = snapshot.commitLog.map((step) => ({ ...step }));
      this.children = new Map<string, DeliberationUnit>();
      this.dormantChildren = new Map<string, PersistedChildSnapshot>();
      this.mountedChildren = new Set<string>();
      this.clearSleepState();

      for (const childEntry of snapshot.children) {
        if (!includeUnmountedChildren && !childEntry.mounted) {
          this.dormantChildren.set(childEntry.childId, {
            childId: childEntry.childId,
            mounted: false,
            snapshot: childEntry.snapshot,
          });
          continue;
        }

        const child = this.createChildUnit(
          childEntry.childId,
          childEntry.snapshot.level,
          childEntry.snapshot.path,
          childEntry.snapshot.unitId,
        );
        child.restoreFromSnapshot(childEntry.snapshot, options);
        this.children.set(childEntry.childId, child);
        if (childEntry.mounted) {
          this.mountedChildren.add(childEntry.childId);
        }
      }

      if (snapshot.sleepDeadlineMs !== null) {
        const remainingMs = snapshot.sleepDeadlineMs - Date.now();
        if (remainingMs > 0) {
          this.scheduleSleepTimer(remainingMs, snapshot.sleepDeadlineMs);
        } else if (coldStart) {
          recoveryMessages.push(`A persisted sleep timeout elapsed while the runtime was offline. The unit was restored in \"idle\" and became eligible to resume deliberation.`);
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
    return [...this.mountedChildren]
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

  private hasMountedChildren(): boolean {
    return this.mountedChildren.size > 0;
  }

  private isChildMounted(childId: string): boolean {
    return this.mountedChildren.has(childId);
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

  private static buildDefaultUnitId(path: number[]): string {
    return path.length === 0 ? "unit-root" : `unit-${path.join("-")}`;
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
      this.ledger.appendSystemMessage(`The sleep timeout of ${timeoutMs}ms elapsed before any child unit reported. The unit became eligible to resume deliberation.`, this.buildDeferredVisibilityMeta());
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
      runDirectory: this.runDirectory,
      level: childLevel,
      path: childPath,
      unitId,
      onSystemEvent: (event: SystemEvent) => {
        if (event.type === "upward-message" && this.sameScope(event.scope, child.scope)) {
          const broadcastMeta = this.buildDeferredVisibilityMeta();
          const wasMounted = this.isChildMounted(childId);
          if (!wasMounted) {
            this.mountedChildren.add(childId);
          }
          this.ledger.appendChildReportMessage({
            childId,
            deliveryMode: event.deliveryMode,
            content: event.content,
            ...broadcastMeta,
          });
          if (!wasMounted) {
            this.ledger.appendSystemMessage(`Child unit ${childId} was remounted after new upward activity.`, broadcastMeta);
          }
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

  private buildTurnMessages(
    agentId: AgentId,
    visibleMessages: readonly ConversationMessage[],
    newlyVisibleMessages: readonly ConversationMessage[],
    pendingProposal: PendingProposal | null,
    childCommitViews: readonly ChildCommitView[],
  ): LlmMessage[] {
    const messages: LlmMessage[] = [];
    const memorySnapshot = this.compressionManager.getMemorySnapshot();
    const recentRawMessages = this.compressionManager.getRecentRawMessages(visibleMessages);
    const recentNewMessageIds = new Set(newlyVisibleMessages.map((message) => message.id));
    const firstRecentNewIndex = recentRawMessages.findIndex((message) => recentNewMessageIds.has(message.id));
    const oldRecentRawMessages = firstRecentNewIndex === -1
      ? recentRawMessages
      : recentRawMessages.slice(0, firstRecentNewIndex);
    const newRecentRawMessages = firstRecentNewIndex === -1
      ? []
      : recentRawMessages.slice(firstRecentNewIndex);

    if (memorySnapshot) {
      messages.push(this.projector.buildMemorySnapshotMessage(memorySnapshot));
    }

    messages.push(...this.projector.projectVisibleMessages(oldRecentRawMessages));

    if (newRecentRawMessages.length > 0) {
      messages.push(this.projector.buildNewlyVisibleBoundaryOverlay(agentId, newRecentRawMessages.length));
      messages.push(...this.projector.projectVisibleMessages(newRecentRawMessages));
    }

    if (this.compressionManager.shouldShowReminder(visibleMessages)) {
      messages.push(this.projector.buildCompressionReminderOverlay(
        agentId,
        this.compressionManager.estimateRecentRawChars(visibleMessages),
        this.compressionManager.getReminderThresholdChars(),
      ));
    }

    const childCommitViewMessage = this.projector.buildChildCommitViewMessage(agentId, childCommitViews);
    if (childCommitViewMessage) {
      messages.push(childCommitViewMessage);
    }

    if (pendingProposal && pendingProposal.proposer !== agentId) {
      const proposerName = AGENT_NAMES[pendingProposal.proposer] ?? pendingProposal.proposer;
      const voterName = AGENT_NAMES[agentId] ?? agentId;
      messages.push(this.projector.buildProposalNotification(pendingProposal, proposerName, voterName));
    }

    return messages;
  }

  private buildCompressionTaskStartMessage(task: ActiveCompressionTask): string {
    const requirementsPreview = task.requirements.length > 160
      ? `${task.requirements.slice(0, 160)}...`
      : task.requirements;

    return `A background context compression task (${task.id}) started to refresh the unit's memory snapshot. The unit continues normal deliberation while this task runs, and no sleep is required merely to wait for compression completion. Preservation priorities: ${requirementsPreview || "none specified"}`;
  }

  private buildCompressionTaskFailureMessage(task: ActiveCompressionTask, error: unknown): string {
    const detail = error instanceof Error ? error.message : String(error);
    return `The context compression task (${task.id}) failed after ${task.attemptNumber} attempt(s): ${detail}. The unit returned to a state with no active compression task so the agents can handle the failure and, if appropriate, propose another compression task.`;
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

      this.compressionManager.registerSuccess(content);
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

  private async runLoop(): Promise<void> {
    while (this.state === "turn-a" || this.state === "turn-b") {
      const currentAgent: AgentId = this.state === "turn-a" ? "agent-a" : "agent-b";
      const agentName = AGENT_NAMES[currentAgent];
      const agentTurn = currentAgent === "agent-a" ? this.agentA : this.agentB;

      this.turnCounter++;
      this.notifyDurableStateChange();
      const visibleSnapshot = this.ledger.readVisibleSnapshotForAgent(currentAgent, this.turnCounter);

      const hasChildren = this.hasMountedChildren();
      const childCommitViews = hasChildren ? this.buildChildCommitViews() : [];
      const pendingProposal = this.getPendingProposal();
      const hasPendingFromOther = pendingProposal !== null && pendingProposal.proposer !== currentAgent;
      const turnMessages = this.buildTurnMessages(
        currentAgent,
        visibleSnapshot.visibleMessages,
        visibleSnapshot.newlyVisibleMessages,
        pendingProposal,
        childCommitViews,
      );

      this.emit({
        type: "turn-start",
        scope: this.scope,
        turn: this.turnCounter,
        agent: currentAgent,
        state: this.state,
        contextSize: turnMessages.length,
        newMessages: visibleSnapshot.newlyVisibleMessages.length,
      });

      let result;
      try {
        result = await agentTurn.execute(
          turnMessages,
          hasPendingFromOther,
          hasChildren,
        );
      } catch (err) {
        this.emit({ type: "error", scope: this.scope, message: `LLM call failed for ${agentName}: ${err}. Check API key, base URL, and network connectivity.` });
        this.transition(this.state, "idle");
        return;
      }

      const isEmpty = !result.reply?.trim() && !result.action && !(result.unitRuntimeBroadcasts?.length);
      if (isEmpty) {
        this.consecutiveEmptyTurns++;
        if (this.consecutiveEmptyTurns >= DeliberationUnit.MAX_EMPTY_TURNS) {
          this.emit({ type: "error", scope: this.scope, message: `${DeliberationUnit.MAX_EMPTY_TURNS} consecutive empty responses detected. Halting — likely API misconfiguration (wrong key, URL, or model).` });
          this.transition(this.state, "idle");
          return;
        }
      } else {
        this.consecutiveEmptyTurns = 0;
      }

      if (result.reply) {
        this.ledger.appendAgentMessage(currentAgent, result.reply, this.buildDeferredVisibilityMeta());
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
          this.ledger.appendVoteMessage({
            voter: currentAgent,
            proposalId: approvedProposal.messageId,
            approve: true,
            reason: vote.reason,
            ...voteMeta,
          });
          this.ledger.markProposalApproved(approvedProposal.messageId);
          this.recordCommittedStep(approvedProposal);
          this.notifyDurableStateChange();

          const resolvedTool = getBuiltInToolRegistry().get(toolName);

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
            const execResult = await this.toolExecutor.execute(approvedProposal.toolName, approvedProposal.args);
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
          this.ledger.appendVoteMessage({
            voter: currentAgent,
            proposalId: pendingProposal.messageId,
            approve: false,
            reason: vote.reason,
            ...voteMeta,
          });
          this.ledger.markProposalRejected(pendingProposal.messageId);
          this.notifyDurableStateChange();
        }
      }

      if (result.action?.kind === "proposal") {
        const proposal = result.action.proposal;
        this.ledger.appendProposalMessage({
          authoredBy: currentAgent,
          toolName: proposal.toolName,
          args: proposal.args,
          proposedStep: proposal.proposedStep,
          ...this.buildDeferredVisibilityMeta(),
        });
        this.notifyDurableStateChange();
        this.emit({ type: "proposal", scope: this.scope, agent: currentAgent, toolName: proposal.toolName, args: proposal.args });
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
      const started = this.compressionManager.startTask(
        requirements,
        this.ledger.readAll(),
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
      const task = args.task as string;
      this.childCounter++;
      const childId = `child-${this.childCounter}`;

      const childLevel = this.level === "L0" ? "L1" as const : "L2" as const;
      const childPath = [...this.scope.path, this.childCounter];
      const child = this.createChildUnit(childId, childLevel, childPath);

      this.children.set(childId, child);
      this.mountedChildren.add(childId);

      const taskPreview = task.length > 100 ? task.slice(0, 100) + "..." : task;
      this.ledger.appendSystemMessage(`Child unit ${childId} started with the following task: ${taskPreview}`, this.buildDeferredVisibilityMeta());
      this.notifyDurableStateChange();
      this.emit({ type: "child-spawned", scope: child.scope, task });
      child.injectUserMessage(task);
    } else if (toolName === "sendToChild") {
      const childId = args.childId as string;
      const message = args.message as string;
      const child = this.children.get(childId);

      if (!child || !this.isChildMounted(childId)) {
        const visibleChildren = [...this.mountedChildren].join(", ") || "none";
        this.ledger.appendSystemMessage(`The message could not be delivered to child unit ${childId} because no such currently visible child unit exists. Currently visible child units: ${visibleChildren}`, this.buildDeferredVisibilityMeta());
        this.notifyDurableStateChange();
        this.emit({ type: "warning", scope: this.scope, message: `sendToChild failed: child ${childId} not currently visible` });
        return;
      }

      if (child.getState() !== "idle") {
        this.ledger.appendSystemMessage(`Child unit ${childId} was in state "${child.getState()}" rather than idle. The message was queued for that child unit.`, this.buildDeferredVisibilityMeta());
        this.notifyDurableStateChange();
      }

      child.injectUserMessage(message);
      this.ledger.appendSystemMessage(`The following message was sent to child unit ${childId}: ${message.length > 100 ? message.slice(0, 100) + "..." : message}`, this.buildDeferredVisibilityMeta());
      this.notifyDurableStateChange();
      this.emit({ type: "child-message-sent", scope: child.scope, message });
    } else if (toolName === "unmountChild") {
      const childId = args.childId as string;
      const child = this.children.get(childId);

      if (!child || !this.isChildMounted(childId)) {
        const visibleChildren = [...this.mountedChildren].join(", ") || "none";
        this.ledger.appendSystemMessage(`Child unit ${childId} could not be unmounted because it is not in the current visible child set. Currently visible child units: ${visibleChildren}`, this.buildDeferredVisibilityMeta());
        this.notifyDurableStateChange();
        this.emit({ type: "warning", scope: this.scope, message: `unmountChild failed: child ${childId} not currently visible` });
        return;
      }

      if (child.getState() !== "idle") {
        this.ledger.appendSystemMessage(`Child unit ${childId} could not be unmounted because it was in state "${child.getState()}" rather than idle.`, this.buildDeferredVisibilityMeta());
        this.notifyDurableStateChange();
        this.emit({ type: "warning", scope: this.scope, message: `unmountChild failed: child ${childId} not idle` });
        return;
      }

      this.mountedChildren.delete(childId);
      this.notifyDurableStateChange();
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
