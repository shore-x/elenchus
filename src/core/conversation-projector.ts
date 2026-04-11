import type { AgentId, ChildCommitView, ConversationMessage, PendingProposal, ProposalCall } from "./types.js";
import type { LlmMessage } from "./ports.js";

const DISPLAY_NAMES: Record<string, string> = {
  "agent-a": "Agent A",
  "agent-b": "Agent B",
  parent: "Parent",
  system: "System",
};

function getDisplayName(author: string): string {
  return DISPLAY_NAMES[author] ?? author;
}

function renderProposalDetail(proposal: ProposalCall): string {
  switch (proposal.toolName) {
    case "yield":
      return `The proposed content is:\n\n---\n${proposal.args.content}\n---`;
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

function renderConversationMessage(message: ConversationMessage, selfId: AgentId): LlmMessage | null {
  if (message.kind === "agent_message" && message.authoredBy === selfId) {
    return null;
  }

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
        `Framework recorded the result of ${message.toolName} for proposal ${message.proposalId}.\n` +
        `Success: ${message.success ? "true" : "false"}\n` +
        `Duration: ${message.durationMs}ms\n` +
        `Output:\n${message.output}`,
      timestamp: message.timestamp,
    };
  }

  if (message.kind === "child_report_message") {
    return {
      role: "user",
      content:
        `[Public Fact][Child Report]\n` +
        `Framework received a report from ${message.childId}.\n` +
        `Content:\n${message.content}`,
      timestamp: message.timestamp,
    };
  }

  if (message.kind === "system_message") {
    return {
      role: "user",
      content: `[Public Fact][Framework]\n${message.content}`,
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

export class ConversationProjector {
  projectNewMessages(messages: readonly ConversationMessage[], selfId: AgentId): LlmMessage[] {
    return messages
      .map((message) => renderConversationMessage(message, selfId))
      .filter((message): message is LlmMessage => message !== null);
  }

  buildProposalNotification(proposal: PendingProposal, proposerName: string, voterName: string): LlmMessage {
    return {
      role: "user",
      content:
        `[Directive]\n` +
        `${voterName} must now vote on ${proposerName}'s pending ${proposal.toolName} proposal.\n` +
        `Allowed action: call the **vote** tool with APPROVE or REJECT and a reason.`,
      timestamp: Date.now(),
    };
  }

  buildChildCommitViewMessage(childCommitViews: readonly ChildCommitView[]): LlmMessage | null {
    if (childCommitViews.length === 0) {
      return null;
    }

    const lines = [
      "[Context Snapshot]: Child unit commit log snapshot (accepted steps only; not real-time activity):",
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
