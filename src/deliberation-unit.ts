// Elenchus - DeliberationUnit
// The core FSM (5-state: idle/turn-a/turn-b/executing/terminated) that drives dual-agent turn alternation.
// Three-layer architecture (P9): all layers share this same FSM. Tool sets differ by layer (§4.3):
//   L0: child management only → never enters Executing
//   L1: child management + environment tools → full FSM
//   L2: environment tools only (leaf node) → no child spawning
// Yield and Sleep both trigger T8 (→ Idle). Sleep adds a timeout timer (§4.4).
// User messages arrive asynchronously via MessageBus and are processed at the next turn boundary (P4).

import { type Model } from "@mariozechner/pi-ai";
import { AgentTurn } from "./agent-turn.js";
import { MessageBus } from "./message-bus.js";
import { buildSystemPrompt } from "./prompts.js";
import { type AgentId, type OnSystemEvent, type OnTextDelta, type PendingProposal, type SystemEvent, type ToolLevel, type UnitState } from "./types.js";
import { isBlockingTool, isNonBlockingTool, isT8Tool } from "./tools.js";
import { executeBlockingTool } from "./tool-executor.js";

const AGENT_NAMES: Record<AgentId, string> = {
  "agent-a": "Agent A",
  "agent-b": "Agent B",
};

const OTHER_AGENT: Record<AgentId, AgentId> = {
  "agent-a": "agent-b",
  "agent-b": "agent-a",
};

export interface DeliberationUnitOptions {
  model: Model<any>;
  level?: ToolLevel;
  onTextDelta?: OnTextDelta;
  onSystemEvent?: OnSystemEvent;
}

export class DeliberationUnit {
  private state: UnitState = "idle";
  private bus: MessageBus;
  private agentA: AgentTurn;
  private agentB: AgentTurn;
  private pendingProposal: PendingProposal | null = null;
  private loopRunning = false; // Re-entrancy guard
  private level: ToolLevel;
  private model: Model<any>;
  private turnCounter = 0;
  private onTextDelta: OnTextDelta;
  private onSystemEvent: OnSystemEvent;
  // Track which turn state we entered Executing from (for T6/T7 transitions)
  private executingFromState: "turn-a" | "turn-b" | null = null;
  // Child management: non-blocking child agent units (L0 and L1)
  private children = new Map<string, DeliberationUnit>();
  private childCounter = 0;
  // Sleep timeout timer (§4.4): cleared when woken by child report or any trigger
  private sleepTimer: ReturnType<typeof setTimeout> | null = null;
  // Safety: consecutive empty responses counter (no text, no proposal, no vote)
  private consecutiveEmptyTurns = 0;
  private static readonly MAX_EMPTY_TURNS = 4;

  constructor(options: DeliberationUnitOptions) {
    this.level = options.level ?? "L0";
    this.model = options.model;
    this.bus = new MessageBus();
    this.agentA = new AgentTurn("agent-a", buildSystemPrompt("agent-a", this.level), options.model, this.level);
    this.agentB = new AgentTurn("agent-b", buildSystemPrompt("agent-b", this.level), options.model, this.level);
    this.onTextDelta = options.onTextDelta ?? (() => {});
    this.onSystemEvent = options.onSystemEvent ?? (() => {});
  }

  // Inject a user message into the bus. Can be called at any time (async-safe).
  // If the unit is idle, this triggers the deliberation loop (T1: idle → turn-a).
  // If already running, the message is buffered and processed at the next turn boundary (P4).
  injectUserMessage(content: string): void {
    this.bus.write("user", content);

    if (this.state === "idle" && !this.loopRunning) {
      // T1: idle → turn-a (trigger message received)
      this.transition(this.state, "turn-a");
      this.loopRunning = true;
      this.runLoop()
        .catch((err) => {
          this.emit({ type: "error", message: `Deliberation loop crashed: ${err}` });
        })
        .finally(() => {
          this.loopRunning = false;
        });
    }
    // If already in turn-a or turn-b, the message is buffered on the bus.
    // It will be picked up at the next turn boundary via readNewForAgent().
  }

  // Get current state (for CLI display)
  getState(): UnitState {
    return this.state;
  }

  // Force terminate (P6: control plane operation, not via message bus)
  // Cascades to all child units.
  terminate(): void {
    if (this.state !== "terminated") {
      for (const child of this.children.values()) {
        child.terminate();
      }
      this.transition(this.state, "terminated");
    }
  }

  // Core deliberation loop: alternates between Agent A and Agent B.
  private async runLoop(): Promise<void> {
    while (this.state === "turn-a" || this.state === "turn-b") {
      const currentAgent: AgentId = this.state === "turn-a" ? "agent-a" : "agent-b";
      const agentName = AGENT_NAMES[currentAgent];
      const agentTurn = currentAgent === "agent-a" ? this.agentA : this.agentB;

      // Read new messages from bus (P4: visibility boundary at turn start)
      const newMessages = this.bus.readNewForAgent(currentAgent);
      this.turnCounter++;

      // Emit turn-start event
      this.emit({
        type: "turn-start",
        turn: this.turnCounter,
        agent: currentAgent,
        state: this.state,
        contextSize: agentTurn.getContextSize(),
        newMessages: newMessages.length,
      });

      const hasChildren = this.children.size > 0;
      let result;
      try {
        result = await agentTurn.execute(
          newMessages,
          this.pendingProposal,
          hasChildren,
        );
      } catch (err) {
        this.emit({ type: "error", message: `LLM call failed for ${agentName}: ${err}. Check API key, base URL, and network connectivity.` });
        this.transition(this.state, "idle");
        return;
      }

      // Safety: detect consecutive empty responses (likely misconfigured API)
      const isEmpty = !result.reply?.trim() && !result.proposal && !result.vote;
      if (isEmpty) {
        this.consecutiveEmptyTurns++;
        if (this.consecutiveEmptyTurns >= DeliberationUnit.MAX_EMPTY_TURNS) {
          this.emit({ type: "error", message: `${DeliberationUnit.MAX_EMPTY_TURNS} consecutive empty responses detected. Halting — likely API misconfiguration (wrong key, URL, or model).` });
          this.transition(this.state, "idle");
          return;
        }
      } else {
        this.consecutiveEmptyTurns = 0;
      }

      // Display the reply
      if (result.reply) {
        this.onTextDelta(currentAgent, result.reply);
      }

      // Warn about hallucinated tool calls
      if (result.unknownToolCalls?.length) {
        for (const tc of result.unknownToolCalls) {
          this.emit({ type: "warning", message: `${agentName} called unknown tool "${tc.name}" — ignored. LLM may be hallucinating tools.` });
        }
      }

      // Warn if response was truncated due to token limit
      if (result.stopReason === "length") {
        this.emit({ type: "warning", message: `${agentName}'s response was truncated (stopReason: length). Consider increasing maxTokens.` });
      }

      // Handle vote on pending proposal
      if (result.vote && this.pendingProposal) {
        const proposerName = AGENT_NAMES[this.pendingProposal.proposer];
        const toolName = this.pendingProposal.toolName;

        if (result.vote.approve) {
          this.emit({ type: "vote", voter: currentAgent, proposer: this.pendingProposal.proposer, toolName, approve: true, reason: result.vote.reason });
          this.bus.write("system", `${agentName} voted APPROVE on ${proposerName}'s ${toolName}: ${result.vote.reason}`);

          if (toolName === "yield") {
            // T8: Yield approved → Idle (with report to parent)
            const yieldContent = this.pendingProposal.args.content as string;
            this.emit({ type: "report", content: yieldContent });
            this.pendingProposal = null;
            this.transition(this.state, "idle");
            return;
          }

          if (toolName === "sleep") {
            // T8: Sleep approved → Idle (no report to parent, start timeout timer §4.4)
            const timeoutMs = this.pendingProposal.args.timeoutMs as number;
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
            // T3/T5: Blocking tool approved → Executing
            const approvedProposal = this.pendingProposal;
            this.pendingProposal = null;

            // Remember where we came from for T6/T7
            this.executingFromState = this.state as "turn-a" | "turn-b";
            this.transition(this.state, "executing");

            // Execute the tool
            this.emit({ type: "tool-executing", toolName: approvedProposal.toolName, args: approvedProposal.args });
            const execResult = await executeBlockingTool(approvedProposal.toolName, approvedProposal.args);

            // Write result to bus
            const statusTag = execResult.success ? "✓" : "✗";
            this.bus.write("system", `[Tool Result] ${statusTag} ${toolName}:\n${execResult.output}`);
            this.emit({ type: "tool-result", toolName, success: execResult.success, output: execResult.output, durationMs: execResult.durationMs });

            // T6/T7: Executing → next turn
            const nextState: UnitState = this.executingFromState === "turn-a" ? "turn-b" : "turn-a";
            this.executingFromState = null;
            this.transition("executing", nextState);
            continue;
          }

          if (isNonBlockingTool(toolName)) {
            // Non-blocking tool approved → execute in background, ACK to bus, FSM continues (T2/T4)
            const approvedProposal = this.pendingProposal;
            this.pendingProposal = null;
            this.executeNonBlockingTool(approvedProposal);
            // Fall through to normal T2/T4 transition below
          }
        } else {
          // Proposal rejected
          this.emit({ type: "vote", voter: currentAgent, proposer: this.pendingProposal.proposer, toolName, approve: false, reason: result.vote.reason });
          this.bus.write("system", `${agentName} voted REJECT on ${proposerName}'s ${toolName}: ${result.vote.reason}`);
          this.pendingProposal = null;
        }
      }

      // Handle new proposal from current agent
      if (result.proposal) {
        this.pendingProposal = {
          proposer: currentAgent,
          toolName: result.proposal.toolName,
          args: result.proposal.args,
          messageId: "",
        };
        this.emit({ type: "proposal", agent: currentAgent, toolName: result.proposal.toolName, args: result.proposal.args });
      }

      // Write agent's reply to the bus so the other agent can see it
      this.bus.write(currentAgent, result.reply, result.proposal);

      // State transition: T2 (turn-a → turn-b) or T4 (turn-b → turn-a)
      const nextState: UnitState = this.state === "turn-a" ? "turn-b" : "turn-a";
      this.transition(this.state, nextState);
    }
  }

  // Execute a non-blocking tool (SpawnChild, SendToChild) after APPROVE.
  // Non-blocking: starts in background, ACK written to bus, FSM does NOT enter Executing (§3.3).
  private executeNonBlockingTool(proposal: PendingProposal): void {
    const { toolName, args } = proposal;

    if (toolName === "spawnChild") {
      const task = args.task as string;
      this.childCounter++;
      const childId = `child-${this.childCounter}`;

      // Buffer child agent text per turn for truncated display
      let childTextBuffer = "";
      let childLastTurn = 0;
      let childLastAgent: AgentId = "agent-a";

      // Create child unit — level is parent+1 (L0→L1, L1→L2)
      const childLevel = this.level === "L0" ? "L1" as const : "L2" as const;
      const child = new DeliberationUnit({
        model: this.model,
        level: childLevel,
        onTextDelta: (_agent: AgentId, delta: string) => {
          childTextBuffer += delta;
        },
        onSystemEvent: (event: SystemEvent) => {
          if (event.type === "turn-start") {
            // Emit previous turn's buffered content (if any)
            if (childTextBuffer && childLastTurn > 0) {
              this.emit({ type: "child-turn-content", childId, turn: childLastTurn, agent: childLastAgent, content: childTextBuffer });
            }
            childTextBuffer = "";
            childLastTurn = event.turn;
            childLastAgent = event.agent;
            this.emit({ type: "child-progress", childId, turn: event.turn, agent: event.agent });
          }
          if (event.type === "report") {
            // Emit last turn's buffered content before report
            if (childTextBuffer && childLastTurn > 0) {
              this.emit({ type: "child-turn-content", childId, turn: childLastTurn, agent: childLastAgent, content: childTextBuffer });
              childTextBuffer = "";
            }
            // Child yielded — inject result into parent's bus and notify
            this.bus.write("system", `[Child ${childId} Report]\n${event.content}`);
            this.emit({ type: "child-reported", childId, content: event.content });
            // Wake parent if idle (T1: trigger message from child)
            this.wakeIfIdle();
          }
          if (event.type === "error") {
            this.emit({ type: "warning", message: `Child ${childId}: ${event.message}` });
          }
        },
      });

      this.children.set(childId, child);

      // ACK to parent bus and emit event
      const taskPreview = task.length > 100 ? task.slice(0, 100) + "..." : task;
      this.bus.write("system", `[System] Child unit ${childId} started with task: ${taskPreview}`);
      this.emit({ type: "child-spawned", childId, task });

      // Inject task as the child's first user message (triggers child's runLoop)
      child.injectUserMessage(task);

    } else if (toolName === "sendToChild") {
      const childId = args.childId as string;
      const message = args.message as string;
      const child = this.children.get(childId);

      if (!child) {
        this.bus.write("system", `[System] Error: Child ${childId} not found. Available: ${[...this.children.keys()].join(", ") || "none"}`);
        this.emit({ type: "warning", message: `sendToChild failed: child ${childId} not found` });
        return;
      }

      if (child.getState() !== "idle") {
        this.bus.write("system", `[System] Warning: Child ${childId} is in state "${child.getState()}", not idle. Message queued anyway.`);
      }

      // Inject message into child — wakes it if idle (T1)
      child.injectUserMessage(message);
      this.bus.write("system", `[System] Message sent to child ${childId}: ${message.length > 100 ? message.slice(0, 100) + "..." : message}`);
      this.emit({ type: "child-message-sent", childId, message });
    }
  }

  // Emit a structured event to the rendering layer.
  private emit(event: SystemEvent): void {
    this.onSystemEvent(event);
  }

  // Wake the unit from idle if a trigger message has been written to the bus.
  // Used by child report handler to restart the deliberation loop.
  private wakeIfIdle(): void {
    // Clear sleep timer if active — we're being woken by an event
    if (this.sleepTimer) {
      clearTimeout(this.sleepTimer);
      this.sleepTimer = null;
    }
    if (this.state === "idle" && !this.loopRunning) {
      this.transition("idle", "turn-a");
      this.loopRunning = true;
      this.runLoop()
        .catch((err) => {
          this.emit({ type: "error", message: `Deliberation loop crashed: ${err}` });
        })
        .finally(() => {
          this.loopRunning = false;
        });
    }
  }

  private transition(from: UnitState, to: UnitState): void {
    this.emit({ type: "state-transition", from, to });
    this.state = to;
  }
}
