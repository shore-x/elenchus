// Elenchus - Shared Type Definitions
// Three-layer architecture (v1.5): L0 (coordination) / L1 (planning+execution) / L2 (execution).
// All layers share the same FSM and protocol (P9). Differences are only in injected tool sets:
//   - Child management tools (SpawnChild, SendToChild, UnmountChild, Sleep) → non-leaf (L0, L1)
//   - Environment tools (Bash, ReadFile, WriteFile) → non-coordination (L1, L2)
//   - Protocol tools (Yield, Vote) → all layers
// User messages are async — they can arrive at any time and are processed at the next turn boundary (P4).
// Agent-visible context is reconstructed per turn from ConversationLedger, not cached inside AgentTurn.
// Unit-level context compression is projected as Memory Snapshot + Recent Raw Window,
// while compression task lifecycle is managed separately from ConversationLedger history.

export type AgentId = "agent-a" | "agent-b";
export type MessageSource = "user" | AgentId | "system";
export type ConversationAuthor = AgentId | "incoming" | "system" | "unit";
export type ProposalStatus = "pending" | "approved" | "rejected" | "superseded";
export type UpwardDeliveryMode = "report" | "yield";

export interface ProposalCall {
  toolName: string;
  args: Record<string, unknown>;
  proposedStep: string;
}

export interface VoteCall {
  approve: boolean;
  reason: string;
}

export type UnitRuntimeBroadcastCode =
  | "malformed_multiple_tool_calls"
  | "tool_not_available"
  | "proposal_missing_proposed_step"
  | "vote_arguments_invalid";

export interface UnitRuntimeBroadcast {
  code: UnitRuntimeBroadcastCode;
  content: string;
}

export type TurnAction =
  | { kind: "proposal"; proposal: ProposalCall }
  | { kind: "vote"; vote: VoteCall };

export interface LedgerMessageMeta {
  turnAuthored: number;
  visibleFromTurn: number;
}

export interface ConversationMessageBase extends LedgerMessageMeta {
  id: string;
  kind:
    | "incoming_message"
    | "agent_message"
    | "system_message"
    | "upward_message"
    | "proposal_message"
    | "vote_message"
    | "tool_result_message"
    | "child_report_message";
  authoredBy: ConversationAuthor;
  timestamp: number;
}

export interface IncomingMessage extends ConversationMessageBase {
  kind: "incoming_message";
  authoredBy: "incoming";
  content: string;
}

export interface AgentMessage extends ConversationMessageBase {
  kind: "agent_message";
  authoredBy: AgentId;
  content: string;
}

export interface SystemMessage extends ConversationMessageBase {
  kind: "system_message";
  authoredBy: "system";
  content: string;
}

export interface UpwardMessage extends ConversationMessageBase {
  kind: "upward_message";
  authoredBy: "unit";
  deliveryMode: UpwardDeliveryMode;
  content: string;
}

export interface ProposalMessage extends ConversationMessageBase {
  kind: "proposal_message";
  authoredBy: AgentId;
  toolName: string;
  args: Record<string, unknown>;
  proposedStep: string;
  status: ProposalStatus;
}

export interface VoteMessage extends ConversationMessageBase {
  kind: "vote_message";
  authoredBy: AgentId;
  proposalId: string;
  approve: boolean;
  reason: string;
}

export interface ToolResultMessage extends ConversationMessageBase {
  kind: "tool_result_message";
  authoredBy: "system";
  proposalId: string;
  toolName: string;
  success: boolean;
  output: string;
  durationMs: number;
}

export interface ChildReportMessage extends ConversationMessageBase {
  kind: "child_report_message";
  authoredBy: "system";
  childId: string;
  deliveryMode: UpwardDeliveryMode;
  content: string;
}

export type ConversationMessage =
  | IncomingMessage
  | AgentMessage
  | SystemMessage
  | UpwardMessage
  | ProposalMessage
  | VoteMessage
  | ToolResultMessage
  | ChildReportMessage;

export interface ConversationLedgerSnapshot {
  sequenceStart: number;
  totalMessages: number;
  messages: ConversationMessage[];
  cursors: Record<AgentId, number>;
}

export interface AgentVisibleSnapshot {
  visibleMessages: ConversationMessage[];
  newlyVisibleMessages: ConversationMessage[];
}

export interface MemorySnapshot {
  content: string;
  sourceMessageCount: number;
  requirements: string;
  createdAt: number;
}

export interface ActiveCompressionTaskSnapshot {
  id: string;
  requirements: string;
  sourceMessageCount: number;
  attemptNumber: number;
  maxAttempts: number;
  startedAt: number;
}

export interface CompressionManagerSnapshot {
  activeTask: ActiveCompressionTaskSnapshot | null;
  memorySnapshot: MemorySnapshot | null;
  recentRawStartIndex: number;
  reminderThresholdChars: number;
  recentRawTargetChars: number;
  maxRetries: number;
}

export interface CommittedStep {
  toolName: string;
  proposedStep: string;
  proposedBy: AgentId;
  committedAt: number;
}

export interface PersistedChildSnapshot {
  childId: string;
  mounted: boolean;
  snapshot: DeliberationUnitSnapshot;
}

export interface DeliberationUnitSnapshot {
  unitId: string;
  level: ToolLevel;
  path: number[];
  state: UnitState;
  turnCounter: number;
  childCounter: number;
  ledger: ConversationLedgerSnapshot;
  compression: CompressionManagerSnapshot;
  commitLog: CommittedStep[];
  children: PersistedChildSnapshot[];
  sleepDeadlineMs: number | null;
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

export type BusMessage = ConversationMessage;

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
  action?: TurnAction;
  unitRuntimeBroadcasts?: UnitRuntimeBroadcast[];
}

// Structured event system — replaces untyped string callbacks.
// Each event carries specific data; the rendering layer (CLI/GUI) decides how to display.
export type SystemEvent =
  | { type: "turn-start"; scope: UnitScope; turn: number; agent: AgentId; state: UnitState; contextSize: number; newMessages: number }
  | { type: "agent-message"; scope: UnitScope; turn: number; agent: AgentId; content: string }
  | { type: "proposal"; scope: UnitScope; agent: AgentId; toolName: string; args: Record<string, unknown> }
  | { type: "vote"; scope: UnitScope; voter: AgentId; proposer: AgentId; toolName: string; approve: boolean; reason: string }
  | { type: "upward-message"; scope: UnitScope; deliveryMode: UpwardDeliveryMode; content: string }
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
