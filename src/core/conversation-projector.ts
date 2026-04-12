// Elenchus - ConversationProjector
// Projects a turn-scoped visible snapshot from ConversationLedger into LLM-facing messages.
// Derived context views can include Memory Snapshot + Recent Raw Window without mutating ledger history.
// Private overlays remain third-person and explicitly name Agent A or Agent B.

import type { AgentId, ChildCommitView, ConversationMessage, MemorySnapshot, PendingProposal, ProposalCall } from "./types.js";
import type { LlmMessage } from "./ports.js";

const DISPLAY_NAMES: Record<string, string> = {
  "agent-a": "Agent A",
  "agent-b": "Agent B",
  incoming: "Incoming Message",
  system: "System",
};

function getDisplayName(author: string): string {
  return DISPLAY_NAMES[author] ?? author;
}

function truncatePreview(content: string, maxLength: number = 120): string {
  const trimmed = content.replace(/\s+/g, " ").trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 3)}...`;
}

function renderProposalDetail(proposal: ProposalCall): string {
  switch (proposal.toolName) {
    case "yield":
      return `The proposed content is:\n\n---\n${proposal.args.content}\n---`;
    case "report":
      return `The proposed upward message is:\n\n---\n${proposal.args.content}\n---`;
    case "compressContext":
      return `Preservation requirements:\n---\n${String(proposal.args.requirements)}\n---`;
    case "bash":
      return `Command: \`${proposal.args.command}\``;
    case "readFile":
      return `File path: \`${proposal.args.path}\``;
    case "writeFile":
      return `File path: \`${proposal.args.path}\`\nContent:\n---\n${String(proposal.args.content)}\n---`;
    case "sleep":
      return `Timeout: ${proposal.args.timeoutMs}ms`;
    case "spawnChild": {
      return `Task:\n---\n${String(proposal.args.task)}\n---`;
    }
    case "sendToChild":
      return `Child: ${proposal.args.childId}\nMessage:\n---\n${String(proposal.args.message)}\n---`;
    default:
      return `Arguments:\n${JSON.stringify(proposal.args, null, 2) ?? "{}"}`;
  }
}

function renderProposalMessage(message: Extract<ConversationMessage, { kind: "proposal_message" }>): LlmMessage {
  const authorName = getDisplayName(message.authoredBy);

  return {
    role: "user",
    content:
      `[Public Fact][Proposal]\n` +
      `Author: ${authorName}\n` +
      `Proposal ID: ${message.id}\n` +
      `Tool: ${message.toolName}\n` +
      `Status: ${message.status}\n` +
      `Proposed step: ${message.proposedStep}\n` +
      `${renderProposalDetail(message)}`,
    timestamp: message.timestamp,
  };
}

function renderVoteMessage(message: Extract<ConversationMessage, { kind: "vote_message" }>): LlmMessage {
  const voterName = getDisplayName(message.authoredBy);

  return {
    role: "user",
    content:
      `[Public Fact][Vote]\n` +
      `Voter: ${voterName}\n` +
      `Proposal ID: ${message.proposalId}\n` +
      `Decision: ${message.approve ? "APPROVE" : "REJECT"}\n` +
      `Reason: ${message.reason}`,
    timestamp: message.timestamp,
  };
}

function renderConversationMessage(message: ConversationMessage): LlmMessage {
  if (message.kind === "proposal_message") {
    return renderProposalMessage(message);
  }

  if (message.kind === "vote_message") {
    return renderVoteMessage(message);
  }

  if (message.kind === "tool_result_message") {
    return {
      role: "user",
      content:
        `[Public Fact][Tool Result]\n` +
        `Tool result for ${message.toolName} on proposal ${message.proposalId}:\n` +
        `Success: ${message.success ? "true" : "false"}\n` +
        `Duration: ${message.durationMs}ms\n` +
        `Output:\n${message.output}`,
      timestamp: message.timestamp,
    };
  }

  if (message.kind === "upward_message") {
    return {
      role: "user",
      content:
        `[Public Fact][Upward Message]\n` +
        `Delivery mode: ${message.deliveryMode}\n` +
        `Content:\n${message.content}`,
      timestamp: message.timestamp,
    };
  }

  if (message.kind === "child_report_message") {
    return {
      role: "user",
      content:
        `[Public Fact][Child Report]\n` +
        `Child: ${message.childId}\n` +
        `Delivery mode: ${message.deliveryMode}\n` +
        `Content:\n${message.content}`,
      timestamp: message.timestamp,
    };
  }

  if (message.kind === "system_message") {
    return {
      role: "user",
      content: `[Public Fact][Unit Runtime]\n${message.content}`,
      timestamp: message.timestamp,
    };
  }

  const prefix = getDisplayName(message.authoredBy);
  const content = "content" in message ? message.content : "";

  return {
    role: "user",
    content: `[${prefix}]: ${content}`,
    timestamp: message.timestamp,
  };
}

function describeNewlyVisibleMessage(message: ConversationMessage): string {
  if (message.kind === "incoming_message") {
    return `Incoming message newly visible in this turn: ${truncatePreview(message.content)}`;
  }

  if (message.kind === "agent_message") {
    return `Message from ${getDisplayName(message.authoredBy)} newly visible in this turn: ${truncatePreview(message.content)}`;
  }

  if (message.kind === "proposal_message") {
    return `Proposal from ${getDisplayName(message.authoredBy)} newly visible in this turn via ${message.toolName}: ${message.proposedStep}`;
  }

  if (message.kind === "vote_message") {
    return `Vote from ${getDisplayName(message.authoredBy)} newly visible in this turn on proposal ${message.proposalId}: ${message.approve ? "APPROVE" : "REJECT"}`;
  }

  if (message.kind === "tool_result_message") {
    return `Tool result newly visible in this turn for ${message.toolName} on proposal ${message.proposalId}: success=${message.success ? "true" : "false"}`;
  }

  if (message.kind === "upward_message") {
    return `Upward message newly visible in this turn via ${message.deliveryMode}: ${truncatePreview(message.content)}`;
  }

  if (message.kind === "child_report_message") {
    return `Child report newly visible in this turn from ${message.childId} via ${message.deliveryMode}: ${truncatePreview(message.content)}`;
  }

  return `Unit runtime broadcast newly visible in this turn: ${truncatePreview(message.content)}`;
}

export class ConversationProjector {
  projectVisibleMessages(messages: readonly ConversationMessage[]): LlmMessage[] {
    return messages
      .map((message) => renderConversationMessage(message));
  }

  buildMemorySnapshotMessage(snapshot: MemorySnapshot): LlmMessage {
    return {
      role: "user",
      content:
        `[Context Snapshot][Memory Snapshot]\n` +
        `The following Memory Snapshot was compressed from earlier conversation history. ` +
        `Treat it as reference context rather than verbatim transcript. Some recent raw messages may overlap with it.\n\n` +
        `${snapshot.content}`,
      timestamp: snapshot.createdAt,
    };
  }

  buildNewlyVisibleMessageOverlay(agentId: AgentId, messages: readonly ConversationMessage[]): LlmMessage {
    const agentName = getDisplayName(agentId);
    const count = messages.length;
    const lines = [
      "[Directive]",
      `${agentName} has ${count} newly visible message${count === 1 ? "" : "s"} in this turn. ${agentName} should interpret and respond to these new items in the context of the existing shared conversation history.`,
    ];

    if (count === 0) {
      lines.push(`${agentName} has no newly visible messages in this turn.`);
      lines.push(`The absence of newly visible messages does not by itself mean the task is complete, blocked, or ready to pause.`);
    } else {
      for (const message of messages) {
        lines.push(`- ${describeNewlyVisibleMessage(message)}`);
      }
    }

    return {
      role: "user",
      content: lines.join("\n"),
      timestamp: Date.now(),
    };
  }

  buildCompressionReminderOverlay(agentId: AgentId, estimatedChars: number, thresholdChars: number): LlmMessage {
    const agentName = getDisplayName(agentId);
    return {
      role: "user",
      content:
        `[Context Reminder]\n` +
        `The recent raw context visible to ${agentName} is estimated at about ${estimatedChars} characters, above the reminder threshold of about ${thresholdChars} characters. ` +
        `Context compression is worth considering, but this is a reminder rather than an instruction to compress immediately.`,
      timestamp: Date.now(),
    };
  }

  buildProposalNotification(proposal: PendingProposal, proposerName: string, voterName: string): LlmMessage {
    return {
      role: "user",
      content:
        `[Directive]\n` +
        `${voterName} must now vote on ${proposerName}'s pending ${proposal.toolName} proposal.\n` +
        `${voterName} may only call the **vote** tool with APPROVE or REJECT and a reason in this turn.`,
      timestamp: Date.now(),
    };
  }

  buildChildCommitViewMessage(agentId: AgentId, childCommitViews: readonly ChildCommitView[]): LlmMessage | null {
    if (childCommitViews.length === 0) {
      return null;
    }

    const agentName = getDisplayName(agentId);
    const lines = [
      "[Context Snapshot]",
      `The following child unit commit log snapshot is visible to ${agentName} (accepted steps only; not real-time activity):`,
    ];

    for (const view of childCommitViews) {
      lines.push(`- ${view.childId} [state: ${view.state}]`);
      if (view.committedSteps.length === 0) {
        lines.push("  - no committed steps yet");
        continue;
      }

      for (const step of view.committedSteps) {
        const proposerName = getDisplayName(step.proposedBy);
        lines.push(`  - ${proposerName} via ${step.toolName}: ${step.proposedStep}`);
      }
    }

    return {
      role: "user",
      content: lines.join("\n"),
      timestamp: Date.now(),
    };
  }
}
