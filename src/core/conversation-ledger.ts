import { type AgentId, type AgentVisibleSnapshot, type ChildCommitViewMessage, type ChildReportMessage, type ConversationLedgerSnapshot, type ConversationMessage, type LedgerMessageMeta, type PendingProposal, type ProposalMessage, type ProposalStatus, type ToolResultMessage, type UpwardMessage, type VoteMessage } from "./types.js";

export interface MessagePersistenceSink {
  onMessageCreated(message: ConversationMessage, seq: number): void;
  onMessageUpdated(message: ConversationMessage): void;
}

let nextConversationMessageId = 0;

function generateConversationMessageId(): string {
  return `msg-${++nextConversationMessageId}-${Date.now()}`;
}

export class ConversationLedger {
  private messages: ConversationMessage[] = [];
  private sequenceStart = 1;
  private totalMessages = 0;
  get currentSequenceStart(): number { return this.sequenceStart; }
  get currentMessageCount(): number { return this.messages.length; }
  private cursors: Record<AgentId, number> = {
    "agent-a": 0,
    "agent-b": 0,
  };
  private readonly sink: MessagePersistenceSink;
  private suppressPersistence = false;

  constructor(sink?: MessagePersistenceSink) {
    this.sink = sink ?? {
      onMessageCreated() {},
      onMessageUpdated() {},
    };
  }

  private appendMessage(message: ConversationMessage): void {
    const seq = this.sequenceStart + this.messages.length;
    this.messages.push(message);
    this.totalMessages += 1;
    if (!this.suppressPersistence) {
      this.sink.onMessageCreated(message, seq);
    }
  }

  appendIncomingMessage(content: string, meta: LedgerMessageMeta): ConversationMessage {
    const message: ConversationMessage = {
      id: generateConversationMessageId(),
      kind: "incoming_message",
      authoredBy: "incoming",
      content,
      timestamp: Date.now(),
      turnAuthored: meta.turnAuthored,
      visibleFromTurn: meta.visibleFromTurn,
    };
    this.appendMessage(message);
    return message;
  }

  appendUpwardMessage(message: Omit<UpwardMessage, "id" | "kind" | "timestamp" | "authoredBy">): UpwardMessage {
    const entry: UpwardMessage = {
      id: generateConversationMessageId(),
      kind: "upward_message",
      authoredBy: "unit",
      deliveryMode: message.deliveryMode,
      content: message.content,
      timestamp: Date.now(),
      turnAuthored: message.turnAuthored,
      visibleFromTurn: message.visibleFromTurn,
    };
    this.appendMessage(entry);
    return entry;
  }

  appendAgentMessage(agent: AgentId, content: string, meta: LedgerMessageMeta): ConversationMessage {
    const message: ConversationMessage = {
      id: generateConversationMessageId(),
      kind: "agent_message",
      authoredBy: agent,
      content,
      timestamp: Date.now(),
      turnAuthored: meta.turnAuthored,
      visibleFromTurn: meta.visibleFromTurn,
    };
    this.appendMessage(message);
    return message;
  }

  appendProposalMessage(proposal: Omit<ProposalMessage, "id" | "kind" | "timestamp" | "status">): ProposalMessage {
    const existingPendingProposal = this.getPendingProposal();
    if (existingPendingProposal) {
      throw new Error(`Cannot append proposal ${proposal.toolName}; proposal ${existingPendingProposal.id} is still pending`);
    }

    const message: ProposalMessage = {
      id: generateConversationMessageId(),
      kind: "proposal_message",
      authoredBy: proposal.authoredBy,
      toolName: proposal.toolName,
      args: proposal.args,
      proposedStep: proposal.proposedStep,
      timestamp: Date.now(),
      turnAuthored: proposal.turnAuthored,
      visibleFromTurn: proposal.visibleFromTurn,
      status: "pending",
    };
    this.appendMessage(message);
    return message;
  }

  appendVoteMessage(vote: Omit<VoteMessage, "id" | "kind" | "timestamp" | "authoredBy"> & { voter: AgentId }): VoteMessage {
    const message: VoteMessage = {
      id: generateConversationMessageId(),
      kind: "vote_message",
      authoredBy: vote.voter,
      proposalId: vote.proposalId,
      approve: vote.approve,
      reason: vote.reason,
      timestamp: Date.now(),
      turnAuthored: vote.turnAuthored,
      visibleFromTurn: vote.visibleFromTurn,
    };
    this.appendMessage(message);
    return message;
  }

  appendToolResultMessage(result: Omit<ToolResultMessage, "id" | "kind" | "timestamp" | "authoredBy">): ToolResultMessage {
    const message: ToolResultMessage = {
      id: generateConversationMessageId(),
      kind: "tool_result_message",
      authoredBy: "system",
      proposalId: result.proposalId,
      toolName: result.toolName,
      success: result.success,
      output: result.output,
      durationMs: result.durationMs,
      timestamp: Date.now(),
      turnAuthored: result.turnAuthored,
      visibleFromTurn: result.visibleFromTurn,
    };
    this.appendMessage(message);
    return message;
  }

  appendChildReportMessage(report: Omit<ChildReportMessage, "id" | "kind" | "timestamp" | "authoredBy">): ChildReportMessage {
    const message: ChildReportMessage = {
      id: generateConversationMessageId(),
      kind: "child_report_message",
      authoredBy: "system",
      childId: report.childId,
      deliveryMode: report.deliveryMode,
      content: report.content,
      timestamp: Date.now(),
      turnAuthored: report.turnAuthored,
      visibleFromTurn: report.visibleFromTurn,
    };
    this.appendMessage(message);
    return message;
  }

  appendSystemMessage(content: string, meta: LedgerMessageMeta): ConversationMessage {
    const message: ConversationMessage = {
      id: generateConversationMessageId(),
      kind: "system_message",
      authoredBy: "system",
      content,
      timestamp: Date.now(),
      turnAuthored: meta.turnAuthored,
      visibleFromTurn: meta.visibleFromTurn,
    };
    this.appendMessage(message);
    return message;
  }

  appendChildCommitViewMessage(content: string, meta: LedgerMessageMeta): ChildCommitViewMessage {
    const message: ChildCommitViewMessage = {
      id: generateConversationMessageId(),
      kind: "child_commit_view_message",
      authoredBy: "system",
      content,
      timestamp: Date.now(),
      turnAuthored: meta.turnAuthored,
      visibleFromTurn: meta.visibleFromTurn,
    };
    this.appendMessage(message);
    return message;
  }

  readVisibleSnapshotForAgent(agent: AgentId, turn: number): AgentVisibleSnapshot {
    const visibleEnd = this.findVisibleEndIndex(turn);
    const start = this.cursors[agent];
    const snapshot: AgentVisibleSnapshot = {
      visibleMessages: this.messages.slice(0, visibleEnd),
      newlyVisibleMessages: this.messages.slice(start, visibleEnd),
    };
    this.cursors[agent] = visibleEnd;
    return snapshot;
  }

  readNewForAgent(agent: AgentId, turn: number): ConversationMessage[] {
    return this.readVisibleSnapshotForAgent(agent, turn).newlyVisibleMessages;
  }

  peekNewForAgent(agent: AgentId, turn: number): ConversationMessage[] {
    const start = this.cursors[agent];
    const end = this.findVisibleEndIndex(turn);

    return this.messages.slice(start, end);
  }

  hasNewMessages(agent: AgentId, turn: number): boolean {
    const start = this.cursors[agent];
    return start < this.findVisibleEndIndex(turn);
  }

  getProposalById(proposalId: string): ProposalMessage | undefined {
    const message = this.messages.find((entry): entry is ProposalMessage => entry.kind === "proposal_message" && entry.id === proposalId);
    return message;
  }

  getPendingProposal(): ProposalMessage | null {
    let pendingProposal: ProposalMessage | null = null;

    for (const message of this.messages) {
      if (message.kind !== "proposal_message" || message.status !== "pending") {
        continue;
      }

      if (pendingProposal) {
        throw new Error(`Multiple pending proposals detected: ${pendingProposal.id} and ${message.id}`);
      }

      pendingProposal = message;
    }

    return pendingProposal;
  }

  getPendingProposalView(): PendingProposal | null {
    const proposal = this.getPendingProposal();
    if (!proposal) {
      return null;
    }

    return {
      proposer: proposal.authoredBy,
      toolName: proposal.toolName,
      args: proposal.args,
      proposedStep: proposal.proposedStep,
      messageId: proposal.id,
    };
  }

  hasPendingProposal(): boolean {
    return this.getPendingProposal() !== null;
  }

  markProposalApproved(proposalId: string): ProposalMessage {
    return this.updateProposalStatus(proposalId, "approved");
  }

  markProposalRejected(proposalId: string): ProposalMessage {
    return this.updateProposalStatus(proposalId, "rejected");
  }

  markProposalSuperseded(proposalId: string): ProposalMessage {
    return this.updateProposalStatus(proposalId, "superseded");
  }

  supersedeAllPendingProposals(): number {
    let count = 0;
    for (const message of this.messages) {
      if (message.kind === "proposal_message" && message.status === "pending") {
        message.status = "superseded";
        count++;
        if (!this.suppressPersistence) {
          this.sink.onMessageUpdated(message);
        }
      }
    }
    return count;
  }

  readAll(): readonly ConversationMessage[] {
    return this.messages;
  }

  exportSnapshot(): ConversationLedgerSnapshot {
    return {
      sequenceStart: this.sequenceStart,
      totalMessages: this.totalMessages,
      messages: this.messages.map((message) => ({ ...message })),
      cursors: { ...this.cursors },
    };
  }

  loadSnapshot(snapshot: ConversationLedgerSnapshot): void {
    this.suppressPersistence = true;
    try {
      this.sequenceStart = snapshot.sequenceStart;
      this.totalMessages = snapshot.totalMessages;
      this.messages = snapshot.messages.map((message) => ({ ...message }));
      this.cursors = { ...snapshot.cursors };
    } finally {
      this.suppressPersistence = false;
    }
  }

  flushPendingUpdates(): void {
    for (const message of this.messages) {
      if (message.kind === "proposal_message" && message.status !== "pending") {
        this.sink.onMessageUpdated(message);
      }
    }
  }

  toPendingProposal(proposalId: string): PendingProposal | null {
    const proposal = this.getProposalById(proposalId);
    if (!proposal || proposal.status !== "pending") {
      return null;
    }

    return {
      proposer: proposal.authoredBy,
      toolName: proposal.toolName,
      args: proposal.args,
      proposedStep: proposal.proposedStep,
      messageId: proposal.id,
    };
  }

  private updateProposalStatus(proposalId: string, status: ProposalStatus): ProposalMessage {
    const proposal = this.getProposalById(proposalId);
    if (!proposal) {
      throw new Error(`Proposal ${proposalId} not found`);
    }

    if (proposal.status !== "pending") {
      throw new Error(`Proposal ${proposalId} is ${proposal.status}; cannot transition to ${status}`);
    }

    proposal.status = status;
    if (!this.suppressPersistence) {
      this.sink.onMessageUpdated(proposal);
    }
    return proposal;
  }

  private findVisibleEndIndex(turn: number): number {
    let end = 0;
    while (end < this.messages.length && this.messages[end].visibleFromTurn <= turn) {
      end++;
    }
    return end;
  }
}
