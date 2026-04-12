// Elenchus - DeliberationUnit
// The core FSM (5-state: idle/turn-a/turn-b/executing/terminated) that drives dual-agent turn alternation.
// This core unit now depends on abstract ports for LLM completion and tool execution,
// allowing CLI and future UI layers to share the same runtime without inheriting Node-specific details.

import { AgentTurn } from "./agent-turn.js";
import { ConversationLedger } from "../conversation-ledger.js";
import { ConversationProjector } from "../conversation-projector.js";
import { buildSystemPrompt } from "../prompts.js";
import type { LlmClient, LlmMessage, ToolExecutor } from "../ports.js";
import { type AgentId, type ChildCommitView, type CommittedStep, type ConversationMessage, type LedgerMessageMeta, type OnSystemEvent, type PendingProposal, type SystemEvent, type ToolLevel, type UnitScope, type UnitState } from "../types.js";
import { isBlockingTool, isNonBlockingTool } from "../tools.js";

const AGENT_NAMES: Record<AgentId, string> = {
  "agent-a": "Agent A",
  "agent-b": "Agent B",
};

export interface DeliberationUnitOptions {
  llmClient: LlmClient;
  toolExecutor: ToolExecutor;
  level?: ToolLevel;
  path?: number[];
  onSystemEvent?: OnSystemEvent;
}

export class DeliberationUnit {
  private state: UnitState = "idle";
  private ledger: ConversationLedger;
  private projector: ConversationProjector;
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
  private sleepTimer: ReturnType<typeof setTimeout> | null = null;
  private consecutiveEmptyTurns = 0;
  private commitLog: CommittedStep[] = [];
  private static readonly MAX_EMPTY_TURNS = 4;
  private static readonly CHILD_COMMIT_VIEW_LIMIT = 3;

  constructor(options: DeliberationUnitOptions) {
    this.level = options.level ?? "L0";
    this.llmClient = options.llmClient;
    this.toolExecutor = options.toolExecutor;
    this.ledger = new ConversationLedger();
    this.projector = new ConversationProjector();
    this.agentA = new AgentTurn("agent-a", buildSystemPrompt("agent-a", this.level), this.llmClient, this.level);
    this.agentB = new AgentTurn("agent-b", buildSystemPrompt("agent-b", this.level), this.llmClient, this.level);
    this.onSystemEvent = options.onSystemEvent ?? (() => {});
    this.scope = {
      level: this.level,
      path: options.path ?? [],
    };
  }

  injectUserMessage(content: string): void {
    this.ledger.appendParentMessage(content, this.buildDeferredVisibilityMeta());

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

  getCommittedSteps(limit: number = DeliberationUnit.CHILD_COMMIT_VIEW_LIMIT): readonly CommittedStep[] {
    if (limit <= 0) {
      return [];
    }
    return this.commitLog.slice(-limit);
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
    return [...this.children.entries()].map(([childId, child]) => ({
      childId,
      state: child.getState(),
      committedSteps: child.getCommittedSteps(limit),
    }));
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
    const messages = this.projector.projectVisibleMessages(visibleMessages);
    messages.push(this.projector.buildNewlyVisibleMessageOverlay(agentId, newlyVisibleMessages));

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

  private async runLoop(): Promise<void> {
    while (this.state === "turn-a" || this.state === "turn-b") {
      const currentAgent: AgentId = this.state === "turn-a" ? "agent-a" : "agent-b";
      const agentName = AGENT_NAMES[currentAgent];
      const agentTurn = currentAgent === "agent-a" ? this.agentA : this.agentB;

      this.turnCounter++;
      const visibleSnapshot = this.ledger.readVisibleSnapshotForAgent(currentAgent, this.turnCounter);

      const hasChildren = this.children.size > 0;
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
        this.emit({ type: "agent-message", scope: this.scope, turn: this.turnCounter, agent: currentAgent, content: result.reply });
      }

      if (result.unitRuntimeBroadcasts?.length) {
        const broadcastMeta = this.buildDeferredVisibilityMeta();
        for (const broadcast of result.unitRuntimeBroadcasts) {
          this.ledger.appendSystemMessage(broadcast.content, broadcastMeta);
          this.emit({ type: "warning", scope: this.scope, message: broadcast.content });
        }
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

          if (toolName === "yield") {
            const yieldContent = approvedProposal.args.content as string;
            this.emit({ type: "report", scope: this.scope, content: yieldContent });
            this.transition(this.state, "idle");
            return;
          }

          if (toolName === "sleep") {
            const timeoutMs = approvedProposal.args.timeoutMs as number;
            this.transition(this.state, "idle");
            this.sleepTimer = setTimeout(() => {
              this.sleepTimer = null;
              this.ledger.appendSystemMessage(`The sleep timeout of ${timeoutMs}ms elapsed before any child unit reported. The unit became eligible to resume deliberation.`, this.buildDeferredVisibilityMeta());
              this.wakeIfIdle();
            }, timeoutMs);
            return;
          }

          if (isBlockingTool(toolName)) {
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
            this.emit({ type: "tool-result", scope: this.scope, toolName, success: execResult.success, output: execResult.output, durationMs: execResult.durationMs });
            const nextState: UnitState = this.executingFromState === "turn-a" ? "turn-b" : "turn-a";
            this.executingFromState = null;
            this.transition("executing", nextState);
            continue;
          }

          if (isNonBlockingTool(toolName)) {
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
        this.emit({ type: "proposal", scope: this.scope, agent: currentAgent, toolName: proposal.toolName, args: proposal.args });
      }

      const nextState: UnitState = this.state === "turn-a" ? "turn-b" : "turn-a";
      this.transition(this.state, nextState);
    }
  }

  private executeNonBlockingTool(proposal: PendingProposal): void {
    const { toolName, args } = proposal;

    if (toolName === "spawnChild") {
      const task = args.task as string;
      this.childCounter++;
      const childId = `child-${this.childCounter}`;

      const childLevel = this.level === "L0" ? "L1" as const : "L2" as const;
      const childPath = [...this.scope.path, this.childCounter];
      const childScope: UnitScope = { level: childLevel, path: childPath };
      const child = new DeliberationUnit({
        llmClient: this.llmClient,
        toolExecutor: this.toolExecutor,
        level: childLevel,
        path: childPath,
        onSystemEvent: (event: SystemEvent) => {
          if (event.type === "report" && this.sameScope(event.scope, childScope)) {
            this.ledger.appendChildReportMessage({
              childId,
              content: event.content,
              ...this.buildDeferredVisibilityMeta(),
            });
            this.wakeIfIdle();
          }
          this.emit(event);
        },
      });

      this.children.set(childId, child);

      const taskPreview = task.length > 100 ? task.slice(0, 100) + "..." : task;
      this.ledger.appendSystemMessage(`Child unit ${childId} started with the following task: ${taskPreview}`, this.buildDeferredVisibilityMeta());
      this.emit({ type: "child-spawned", scope: childScope, task });
      child.injectUserMessage(task);
    } else if (toolName === "sendToChild") {
      const childId = args.childId as string;
      const message = args.message as string;
      const child = this.children.get(childId);

      if (!child) {
        this.ledger.appendSystemMessage(`The message could not be delivered to child unit ${childId} because no such child unit exists. Available child units: ${[...this.children.keys()].join(", ") || "none"}`, this.buildDeferredVisibilityMeta());
        this.emit({ type: "warning", scope: this.scope, message: `sendToChild failed: child ${childId} not found` });
        return;
      }

      if (child.getState() !== "idle") {
        this.ledger.appendSystemMessage(`Child unit ${childId} was in state "${child.getState()}" rather than idle. The message was queued for that child unit.`, this.buildDeferredVisibilityMeta());
      }

      child.injectUserMessage(message);
      this.ledger.appendSystemMessage(`The following message was sent to child unit ${childId}: ${message.length > 100 ? message.slice(0, 100) + "..." : message}`, this.buildDeferredVisibilityMeta());
      this.emit({ type: "child-message-sent", scope: child.scope, message });
    }
  }

  private emit(event: SystemEvent): void {
    this.onSystemEvent(event);
  }

  private wakeIfIdle(): void {
    if (this.sleepTimer) {
      clearTimeout(this.sleepTimer);
      this.sleepTimer = null;
    }
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
  }
}
