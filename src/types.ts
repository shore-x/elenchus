// Elenchus MVP - Shared Type Definitions
// L0 pure deliberation: dual-agent turn-based dialogue with Vote/Report tools only.
// User messages are async — they can arrive at any time and are processed at the next turn boundary (P4).

export type AgentId = "agent-a" | "agent-b";
export type MessageSource = "user" | AgentId | "system";

// A message on the MessageBus (P1: all external inputs are uniform Messages)
export interface BusMessage {
  id: string;
  source: MessageSource;
  content: string;
  timestamp: number;
  // If this message carries a Report proposal
  proposal?: {
    toolName: "report";
    args: { content: string };
  };
}

// A pending proposal awaiting the other agent's vote
export interface PendingProposal {
  proposer: AgentId;
  toolName: "report";
  args: { content: string };
  messageId: string; // BusMessage id that created this proposal
}

// FSM states (L0: Executing is never entered — no blocking tools)
export type UnitState = "idle" | "turn-a" | "turn-b" | "stopped" | "terminated";

// Result of a single agent turn
export interface TurnResult {
  reply: string;
  stopReason: string;
  proposal?: {
    toolName: "report";
    args: { content: string };
  };
  vote?: {
    approve: boolean;
    reason: string;
  };
}

// Callback for streaming text output
export type OnTextDelta = (agent: AgentId, delta: string) => void;

// Callback for system events displayed in CLI
export type OnSystemEvent = (message: string) => void;
