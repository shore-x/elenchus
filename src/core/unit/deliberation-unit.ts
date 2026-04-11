// Elenchus - DeliberationUnit
// The core FSM (5-state: idle/turn-a/turn-b/executing/terminated) that drives dual-agent turn alternation.
// This core unit now depends on abstract ports for LLM completion and tool execution,
// allowing CLI and future UI layers to share the same runtime without inheriting Node-specific details.

import { AgentTurn } from "./agent-turn.js";
import { MessageBus } from "../message-bus.js";
import { buildSystemPrompt } from "../prompts.js";
import type { LlmClient, ToolExecutor } from "../ports.js";
import { type AgentId, type ChildCommitView, type CommittedStep, type OnSystemEvent, type PendingProposal, type SystemEvent, type ToolLevel, type UnitScope, type UnitState } from "../types.js";
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
  private bus: MessageBus;
  private agentA: AgentTurn;
  private agentB: AgentTurn;
  private pendingProposal: PendingProposal | null = null;
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
    this.bus = new MessageBus();
    this.agentA = new AgentTurn("agent-a", buildSystemPrompt("agent-a", this.level), this.llmClient, this.level);
    this.agentB = new AgentTurn("agent-b", buildSystemPrompt("agent-b", this.level), this.llmClient, this.level);
    this.onSystemEvent = options.onSystemEvent ?? (() => {});
    this.scope = {
      level: this.level,
      path: options.path ?? [],
    };
  }

  injectUserMessage(content: string): void {
    this.bus.write("user", content);

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

  private sameScope(left: UnitScope, right: UnitScope): boolean {
    return left.level === right.level
      && left.path.length === right.path.length
      && left.path.every((segment, index) => segment === right.path[index]);
  }

  private async runLoop(): Promise<void> {
    while (this.state === "turn-a" || this.state === "turn-b") {
      const currentAgent: AgentId = this.state === "turn-a" ? "agent-a" : "agent-b";
      const agentName = AGENT_NAMES[currentAgent];
      const agentTurn = currentAgent === "agent-a" ? this.agentA : this.agentB;

      const newMessages = this.bus.readNewForAgent(currentAgent);
      this.turnCounter++;

      this.emit({
        type: "turn-start",
        scope: this.scope,
        turn: this.turnCounter,
        agent: currentAgent,
        state: this.state,
        contextSize: agentTurn.getContextSize(),
        newMessages: newMessages.length,
      });

      const hasChildren = this.children.size > 0;
      const childCommitViews = hasChildren ? this.buildChildCommitViews() : [];
      let result;
      try {
        result = await agentTurn.execute(
          newMessages,
          this.pendingProposal,
          hasChildren,
          childCommitViews,
        );
      } catch (err) {
        this.emit({ type: "error", scope: this.scope, message: `LLM call failed for ${agentName}: ${err}. Check API key, base URL, and network connectivity.` });
        this.transition(this.state, "idle");
        return;
      }

      const isEmpty = !result.reply?.trim() && !result.proposal && !result.vote;
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
        this.emit({ type: "agent-message", scope: this.scope, turn: this.turnCounter, agent: currentAgent, content: result.reply });
      }

      if (result.unknownToolCalls?.length) {
        for (const tc of result.unknownToolCalls) {
          this.emit({ type: "warning", scope: this.scope, message: `${agentName} called unknown tool "${tc.name}" — ignored. LLM may be hallucinating tools.` });
        }
      }

      if (result.stopReason === "length") {
        this.emit({ type: "warning", scope: this.scope, message: `${agentName}'s response was truncated (stopReason: length). Consider increasing maxTokens.` });
      }

      if (result.vote && this.pendingProposal) {
        const proposerName = AGENT_NAMES[this.pendingProposal.proposer];
        const toolName = this.pendingProposal.toolName;

        if (result.vote.approve) {
          const approvedProposal = this.pendingProposal;
          this.emit({ type: "vote", scope: this.scope, voter: currentAgent, proposer: this.pendingProposal.proposer, toolName, approve: true, reason: result.vote.reason });
          this.bus.write("system", `${agentName} voted APPROVE on ${proposerName}'s ${toolName}: ${result.vote.reason}`);
          this.recordCommittedStep(approvedProposal);

          if (toolName === "yield") {
            const yieldContent = approvedProposal.args.content as string;
            this.emit({ type: "report", scope: this.scope, content: yieldContent });
            this.pendingProposal = null;
            this.transition(this.state, "idle");
            return;
          }

          if (toolName === "sleep") {
            const timeoutMs = approvedProposal.args.timeoutMs as number;
            this.pendingProposal = null;
            this.transition(this.state, "idle");
            this.sleepTimer = setTimeout(() => {
              this.sleepTimer = null;
              this.bus.write("system", `[System] Sleep timeout after ${timeoutMs}ms. No child agent has reported.`);
              this.wakeIfIdle();
            }, timeoutMs);
            return;
          }

          if (isBlockingTool(toolName)) {
            this.pendingProposal = null;
            this.executingFromState = this.state as "turn-a" | "turn-b";
            this.transition(this.state, "executing");
            this.emit({ type: "tool-executing", scope: this.scope, toolName: approvedProposal.toolName, args: approvedProposal.args });
            const execResult = await this.toolExecutor.execute(approvedProposal.toolName, approvedProposal.args);
            const statusTag = execResult.success ? "✓" : "✗";
            this.bus.write("system", `[Tool Result] ${statusTag} ${toolName}:\n${execResult.output}`);
            this.emit({ type: "tool-result", scope: this.scope, toolName, success: execResult.success, output: execResult.output, durationMs: execResult.durationMs });
            const nextState: UnitState = this.executingFromState === "turn-a" ? "turn-b" : "turn-a";
            this.executingFromState = null;
            this.transition("executing", nextState);
            continue;
          }

          if (isNonBlockingTool(toolName)) {
            this.pendingProposal = null;
            this.executeNonBlockingTool(approvedProposal);
          }
        } else {
          this.emit({ type: "vote", scope: this.scope, voter: currentAgent, proposer: this.pendingProposal.proposer, toolName, approve: false, reason: result.vote.reason });
          this.bus.write("system", `${agentName} voted REJECT on ${proposerName}'s ${toolName}: ${result.vote.reason}`);
          this.pendingProposal = null;
        }
      }

      if (result.proposal) {
        this.pendingProposal = {
          proposer: currentAgent,
          toolName: result.proposal.toolName,
          args: result.proposal.args,
          proposedStep: result.proposal.proposedStep,
          messageId: "",
        };
        this.emit({ type: "proposal", scope: this.scope, agent: currentAgent, toolName: result.proposal.toolName, args: result.proposal.args });
      }

      this.bus.write(currentAgent, result.reply, result.proposal);
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
            this.bus.write("system", `[Child ${childId} Report]\n${event.content}`);
            this.wakeIfIdle();
          }
          this.emit(event);
        },
      });

      this.children.set(childId, child);

      const taskPreview = task.length > 100 ? task.slice(0, 100) + "..." : task;
      this.bus.write("system", `[System] Child unit ${childId} started with task: ${taskPreview}`);
      this.emit({ type: "child-spawned", scope: childScope, task });
      child.injectUserMessage(task);
    } else if (toolName === "sendToChild") {
      const childId = args.childId as string;
      const message = args.message as string;
      const child = this.children.get(childId);

      if (!child) {
        this.bus.write("system", `[System] Error: Child ${childId} not found. Available: ${[...this.children.keys()].join(", ") || "none"}`);
        this.emit({ type: "warning", scope: this.scope, message: `sendToChild failed: child ${childId} not found` });
        return;
      }

      if (child.getState() !== "idle") {
        this.bus.write("system", `[System] Warning: Child ${childId} is in state "${child.getState()}", not idle. Message queued anyway.`);
      }

      child.injectUserMessage(message);
      this.bus.write("system", `[System] Message sent to child ${childId}: ${message.length > 100 ? message.slice(0, 100) + "..." : message}`);
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
