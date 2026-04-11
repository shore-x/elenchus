// Elenchus - Shared Type Definitions
// Three-layer architecture (v1.5): L0 (coordination) / L1 (planning+execution) / L2 (execution).
// All layers share the same FSM and protocol (P9). Differences are only in injected tool sets:
//   - Child management tools (SpawnChild, SendToChild, Sleep) → non-leaf (L0, L1)
//   - Environment tools (Bash, ReadFile, WriteFile) → non-coordination (L1, L2)
//   - Framework tools (Yield, Vote) → all layers
// User messages are async — they can arrive at any time and are processed at the next turn boundary (P4).

export type AgentId = "agent-a" | "agent-b";
export type MessageSource = "user" | AgentId | "system";

export interface ProposalCall {
  toolName: string;
  args: Record<string, unknown>;
  proposedStep: string;
}

export interface CommittedStep {
  toolName: string;
  proposedStep: string;
  proposedBy: AgentId;
  committedAt: number;
}

export interface ChildCommitView {
  childId: string;
  state: UnitState;
  committedSteps: readonly CommittedStep[];
}

export interface UnitScope {
  level: ToolLevel;
  path: number[];
}

// A message on the MessageBus (P1: all external inputs are uniform Messages)
export interface BusMessage {
  id: string;
  source: MessageSource;
  content: string;
  timestamp: number;
  // If this message carries a proposal (Yield, Bash, ReadFile, WriteFile, etc.)
  proposal?: ProposalCall;
}

// A pending proposal awaiting the other agent's vote
export interface PendingProposal {
  proposer: AgentId;
  toolName: string;
  args: Record<string, unknown>;
  proposedStep: string;
  messageId: string;
}

// FSM states (5-state: v1.1 merged stopped into idle)
// L0: executing is never entered (no blocking tools)
// L1: executing is entered when a blocking tool proposal is approved
export type UnitState = "idle" | "turn-a" | "turn-b" | "executing" | "terminated";

// Result of a single agent turn
export interface TurnResult {
  reply: string;
  stopReason: string;
  proposal?: ProposalCall;
  vote?: {
    approve: boolean;
    reason: string;
  };
  unknownToolCalls?: { name: string; args: Record<string, unknown> }[];
}

// Structured event system — replaces untyped string callbacks.
// Each event carries specific data; the rendering layer (CLI/GUI) decides how to display.
export type SystemEvent =
  | { type: "turn-start"; scope: UnitScope; turn: number; agent: AgentId; state: UnitState; contextSize: number; newMessages: number }
  | { type: "agent-message"; scope: UnitScope; turn: number; agent: AgentId; content: string }
  | { type: "proposal"; scope: UnitScope; agent: AgentId; toolName: string; args: Record<string, unknown> }
  | { type: "vote"; scope: UnitScope; voter: AgentId; proposer: AgentId; toolName: string; approve: boolean; reason: string }
  | { type: "report"; scope: UnitScope; content: string }
  | { type: "state-transition"; scope: UnitScope; from: UnitState; to: UnitState }
  | { type: "tool-executing"; scope: UnitScope; toolName: string; args: Record<string, unknown> }
  | { type: "tool-result"; scope: UnitScope; toolName: string; success: boolean; output: string; durationMs: number }
  | { type: "child-spawned"; scope: UnitScope; task: string }
  | { type: "child-message-sent"; scope: UnitScope; message: string }
  | { type: "warning"; scope: UnitScope; message: string }
  | { type: "error"; scope: UnitScope; message: string };

export type OnSystemEvent = (event: SystemEvent) => void;

// Tool level configuration — three fixed layers (§4.3)
export type ToolLevel = "L0" | "L1" | "L2";
