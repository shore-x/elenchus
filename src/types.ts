// Elenchus - Shared Type Definitions
// L0: deliberation + non-blocking child management (SpawnChild, SendToChild).
// L1: execution layer with blocking environment tools (Bash, ReadFile, WriteFile).
// User messages are async — they can arrive at any time and are processed at the next turn boundary (P4).

export type AgentId = "agent-a" | "agent-b";
export type MessageSource = "user" | AgentId | "system";

// A message on the MessageBus (P1: all external inputs are uniform Messages)
export interface BusMessage {
  id: string;
  source: MessageSource;
  content: string;
  timestamp: number;
  // If this message carries a proposal (Yield, Bash, ReadFile, WriteFile, etc.)
  proposal?: {
    toolName: string;
    args: Record<string, unknown>;
  };
}

// A pending proposal awaiting the other agent's vote
export interface PendingProposal {
  proposer: AgentId;
  toolName: string;              // "yield" | "bash" | "readFile" | "writeFile" | ...
  args: Record<string, unknown>; // Tool-specific arguments
  messageId: string;             // BusMessage id that created this proposal
}

// FSM states (5-state: v1.1 merged stopped into idle)
// L0: executing is never entered (no blocking tools)
// L1: executing is entered when a blocking tool proposal is approved
export type UnitState = "idle" | "turn-a" | "turn-b" | "executing" | "terminated";

// Result of a single agent turn
export interface TurnResult {
  reply: string;
  stopReason: string;
  proposal?: {
    toolName: string;
    args: Record<string, unknown>;
  };
  vote?: {
    approve: boolean;
    reason: string;
  };
  unknownToolCalls?: { name: string; args: Record<string, unknown> }[];
}

// Callback for streaming text output
export type OnTextDelta = (agent: AgentId, delta: string) => void;

// Structured event system — replaces untyped string callbacks.
// Each event carries specific data; the rendering layer (CLI/GUI) decides how to display.
export type SystemEvent =
  | { type: "turn-start"; turn: number; agent: AgentId; state: UnitState; contextSize: number; newMessages: number }
  | { type: "proposal"; agent: AgentId; toolName: string; args: Record<string, unknown> }
  | { type: "vote"; voter: AgentId; proposer: AgentId; toolName: string; approve: boolean; reason: string }
  | { type: "report"; content: string }
  | { type: "state-transition"; from: UnitState; to: UnitState }
  | { type: "tool-executing"; toolName: string; args: Record<string, unknown> }
  | { type: "tool-result"; toolName: string; success: boolean; output: string; durationMs: number }
  | { type: "child-spawned"; childId: string; task: string }
  | { type: "child-progress"; childId: string; turn: number; agent: AgentId }
  | { type: "child-turn-content"; childId: string; turn: number; agent: AgentId; content: string }
  | { type: "child-reported"; childId: string; content: string }
  | { type: "child-message-sent"; childId: string; message: string }
  | { type: "warning"; message: string }
  | { type: "error"; message: string };

export type OnSystemEvent = (event: SystemEvent) => void;

// Tool level configuration
export type ToolLevel = "L0" | "L1";
