// Elenchus MVP - DeliberationUnit
// The core FSM that drives dual-agent turn alternation.
// Implements the state machine from framework-design.md §5 (L0 subset: no Executing state).
// User messages arrive asynchronously via MessageBus and are processed at the next turn boundary (P4).

import { type Model } from "@mariozechner/pi-ai";
import { AgentTurn } from "./agent-turn.js";
import { MessageBus } from "./message-bus.js";
import { GENERATOR_SYSTEM_PROMPT, VERIFIER_SYSTEM_PROMPT } from "./prompts.js";
import { type AgentId, type OnSystemEvent, type OnTextDelta, type PendingProposal, type UnitState } from "./types.js";

const AGENT_NAMES: Record<AgentId, string> = {
  "agent-a": "Generator",
  "agent-b": "Verifier",
};

const OTHER_AGENT: Record<AgentId, AgentId> = {
  "agent-a": "agent-b",
  "agent-b": "agent-a",
};

export interface DeliberationUnitOptions {
  model: Model<any>;
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
  private onTextDelta: OnTextDelta;
  private onSystemEvent: OnSystemEvent;

  constructor(options: DeliberationUnitOptions) {
    this.bus = new MessageBus();
    this.agentA = new AgentTurn("agent-a", GENERATOR_SYSTEM_PROMPT, options.model);
    this.agentB = new AgentTurn("agent-b", VERIFIER_SYSTEM_PROMPT, options.model);
    this.onTextDelta = options.onTextDelta ?? (() => {});
    this.onSystemEvent = options.onSystemEvent ?? (() => {});
  }

  // Inject a user message into the bus. Can be called at any time (async-safe).
  // If the unit is idle or stopped, this triggers the deliberation loop.
  // If already running, the message is buffered and processed at the next turn boundary (P4).
  injectUserMessage(content: string): void {
    this.bus.write("user", content);

    if ((this.state === "idle" || this.state === "stopped") && !this.loopRunning) {
      // T1 (idle → turn-a) or T9 (stopped → turn-a): trigger message received
      this.transition(this.state, "turn-a");
      this.loopRunning = true;
      this.runLoop()
        .catch((err) => {
          this.onSystemEvent(`\n[Error] Deliberation loop crashed: ${err}`);
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
  terminate(): void {
    if (this.state !== "terminated") {
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

      // Execute the turn
      this.onSystemEvent(`\n[${agentName}]`);

      const result = await agentTurn.execute(
        newMessages,
        this.pendingProposal,
      );

      // Display the reply
      if (result.reply) {
        this.onTextDelta(currentAgent, result.reply);
      }

      // Warn if response was truncated due to token limit
      if (result.stopReason === "length") {
        this.onSystemEvent(`\n[System] ⚠ ${agentName}'s response was truncated (stopReason: length). Consider increasing maxTokens.`);
      }

      // Handle vote on pending proposal
      if (result.vote && this.pendingProposal) {
        const proposerName = AGENT_NAMES[this.pendingProposal.proposer];
        if (result.vote.approve) {
          // T8: Report approved → Stopped
          this.onSystemEvent(`\n[System] ${agentName} voted APPROVE: ${result.vote.reason}`);
          this.bus.write("system", `${agentName} voted APPROVE on ${proposerName}'s Report: ${result.vote.reason}`);

          // Deliver the report
          const reportContent = this.pendingProposal.args.content;
          this.onSystemEvent(`\n[Report] ${reportContent}`);

          this.pendingProposal = null;
          this.transition(this.state, "stopped");
          return;
        } else {
          // Proposal rejected — clear it, continue deliberation
          this.onSystemEvent(`\n[System] ${agentName} voted REJECT: ${result.vote.reason}`);
          this.bus.write("system", `${agentName} voted REJECT on ${proposerName}'s Report: ${result.vote.reason}`);
          this.pendingProposal = null;
        }
      }

      // Handle new proposal from current agent
      if (result.proposal) {
        this.pendingProposal = {
          proposer: currentAgent,
          toolName: result.proposal.toolName,
          args: result.proposal.args,
          messageId: "", // not critical for L0
        };
        this.onSystemEvent(`\n[System] ${agentName} proposed Report. Waiting for ${AGENT_NAMES[OTHER_AGENT[currentAgent]]}'s vote.`);
      }

      // Write agent's reply to the bus so the other agent can see it
      this.bus.write(currentAgent, result.reply, result.proposal);

      // State transition: T2 (turn-a → turn-b) or T4 (turn-b → turn-a)
      const nextState: UnitState = this.state === "turn-a" ? "turn-b" : "turn-a";
      this.transition(this.state, nextState);
    }
  }

  private transition(from: UnitState, to: UnitState): void {
    this.state = to;
  }
}
