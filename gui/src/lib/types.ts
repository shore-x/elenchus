// Elenchus GUI - Shared Type Definitions
// Mirrors core types from the sidecar API for frontend consumption.

export type ToolLevel = "L0" | "L1" | "L2";
export type AgentId = "agent-a" | "agent-b";
export type UnitState = "idle" | "turn-a" | "turn-b" | "executing" | "terminated";
export type ProposalStatus = "pending" | "approved" | "rejected" | "superseded";
export type UpwardDeliveryMode = "report" | "yield";

export interface AgentTreeNode {
  unitId: string;
  level: ToolLevel;
  path: number[];
  state: UnitState;
  children: AgentTreeNode[];
}

export interface FsTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FsTreeNode[];
}

export interface ConversationMessageBase {
  id: string;
  turnAuthored: number;
  visibleFromTurn: number;
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

export interface SessionInfo {
  unitId: string;
  state: UnitState;
  level: ToolLevel;
  tree: AgentTreeNode;
}

export interface UnitInfo {
  unitId: string;
  level: ToolLevel;
  path: number[];
  state: UnitState;
  turnCounter: number;
  childCount: number;
  commitLog: { toolName: string; proposedStep: string; proposedBy: AgentId; committedAt: number }[];
}

export interface FileContent {
  path: string;
  content: string;
  extension: string;
}

export interface ProviderInfo {
  id: string;
  name: string;
}

export interface ModelInfo {
  id: string;
  name: string;
}

// SystemEvent types (from core)
export type SystemEvent =
  | { type: "turn-start"; scope: { level: ToolLevel; path: number[] }; turn: number; agent: AgentId; state: UnitState; contextSize: number; newMessages: number }
  | { type: "agent-message"; scope: { level: ToolLevel; path: number[] }; turn: number; agent: AgentId; content: string }
  | { type: "proposal"; scope: { level: ToolLevel; path: number[] }; agent: AgentId; toolName: string; args: Record<string, unknown> }
  | { type: "vote"; scope: { level: ToolLevel; path: number[] }; voter: AgentId; proposer: AgentId; toolName: string; approve: boolean; reason: string }
  | { type: "upward-message"; scope: { level: ToolLevel; path: number[] }; deliveryMode: UpwardDeliveryMode; content: string }
  | { type: "state-transition"; scope: { level: ToolLevel; path: number[] }; from: UnitState; to: UnitState }
  | { type: "tool-executing"; scope: { level: ToolLevel; path: number[] }; toolName: string; args: Record<string, unknown> }
  | { type: "tool-result"; scope: { level: ToolLevel; path: number[] }; toolName: string; success: boolean; output: string; durationMs: number }
  | { type: "child-spawned"; scope: { level: ToolLevel; path: number[] }; task: string }
  | { type: "child-message-sent"; scope: { level: ToolLevel; path: number[] }; message: string }
  | { type: "warning"; scope: { level: ToolLevel; path: number[] }; message: string }
  | { type: "error"; scope: { level: ToolLevel; path: number[] }; message: string };

export interface UnitTreeChangeEvent {
  type: "unit-tree-change";
}

export type ServerEvent = SystemEvent | UnitTreeChangeEvent;
