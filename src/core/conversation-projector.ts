// Elenchus - ConversationProjector
// Projects a turn-scoped visible snapshot from ConversationLedger into LLM-facing messages.
// Derived context views can include Memory Snapshot + Recent Raw Window without mutating ledger history.
// Private overlays remain third-person and explicitly name Agent A or Agent B.

import type { AgentId, ChildCommitView, ConversationMessage, MemorySnapshot, PendingProposal, ProposalCall } from "./types.js";
import type { LlmMessage } from "./ports.js";
import { charsToTokens } from "./context/context-budget-controller.js";

const DISPLAY_NAMES: Record<string, string> = {
  "agent-a": "Agent A",
  "agent-b": "Agent B",
  incoming: "External",
  system: "System",
};

function getDisplayName(author: string): string {
  return DISPLAY_NAMES[author] ?? author;
}

function renderProposalDetail(proposal: ProposalCall): string {
  switch (proposal.toolName) {
    case "yield":
      return `The proposed upward handoff content is:\n\n---\n${proposal.args.content}\n---`;
    case "report":
      return `The proposed upward coordination message is:\n\n---\n${proposal.args.content}\n---`;
    case "compressContext":
      return `Preservation requirements:\n---\n${String(proposal.args.requirements)}\n---`;
    case "bash":
      return `Command: \`${proposal.args.command}\``;
    case "readFile": {
      const offset = proposal.args.offset as number | undefined;
      const limit = proposal.args.limit as number | undefined;
      const hasRange = offset !== undefined || limit !== undefined;
      const start = offset ?? 1;
      const end = limit !== undefined ? start + limit - 1 : "end";
      const rangeInfo = hasRange ? ` (lines ${start}-${end})` : "";
      return `File path: \`${proposal.args.path}\`${rangeInfo}`;
    }
    case "writeFile":
      return `File path: \`${proposal.args.path}\`\nContent:\n---\n${String(proposal.args.content)}\n---`;
    case "sleep":
      return `Timeout: ${proposal.args.timeoutSeconds}s`;
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
      `<proposal author="${authorName}" id="${message.id}" tool="${message.toolName}" status="${message.status}">\n` +
      `Proposed step: ${message.proposedStep}\n` +
      `${renderProposalDetail(message)}\n` +
      `</proposal>`,
    timestamp: message.timestamp,
  };
}

function renderVoteMessage(message: Extract<ConversationMessage, { kind: "vote_message" }>): LlmMessage {
  const voterName = getDisplayName(message.authoredBy);

  return {
    role: "user",
    content:
      `<vote voter="${voterName}" proposal="${message.proposalId}" decision="${message.approve ? "APPROVE" : "REJECT"}">\n` +
      `Reason: ${message.reason}\n` +
      `</vote>`,
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
        `<tool-result tool="${message.toolName}" proposal="${message.proposalId}" success="${message.success ? "true" : "false"}" duration="${message.durationMs}ms">\n` +
        `${message.output}\n` +
        `</tool-result>`,
      timestamp: message.timestamp,
    };
  }

  if (message.kind === "upward_message") {
    return {
      role: "user",
      content:
        `<upward-message mode="${message.deliveryMode}${message.deliveryMode === "yield" ? " (handoff and pause)" : " (coordination and continue)"}">\n` +
        `${message.content}\n` +
        `</upward-message>`,
      timestamp: message.timestamp,
    };
  }

  if (message.kind === "child_report_message") {
    return {
      role: "user",
      content:
        `<child-report child="${message.childId}" mode="${message.deliveryMode}">\n` +
        `${message.content}\n` +
        `</child-report>`,
      timestamp: message.timestamp,
    };
  }

  if (message.kind === "system_message") {
    return {
      role: "user",
      content: `<runtime-broadcast>\n${message.content}\n</runtime-broadcast>`,
      timestamp: message.timestamp,
    };
  }

  if (message.kind === "child_commit_view_message") {
    return {
      role: "user",
      content: message.content,
      timestamp: message.timestamp,
    };
  }

  if (message.kind === "incoming_message") {
    return {
      role: "user",
      content: `<input-message>${message.content}</input-message>`,
      timestamp: message.timestamp,
    };
  }

  if (message.kind === "agent_message") {
    const authorName = getDisplayName(message.authoredBy);
    return {
      role: "user",
      content: `<message author="${authorName}">${message.content}</message>`,
      timestamp: message.timestamp,
    };
  }

  // Exhaustive check — all ConversationMessage kinds are handled above
  const _exhaustive: never = message;
  return _exhaustive;
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
        `<context-snapshot type="memory">\n` +
        `The following Memory Snapshot was compressed from earlier conversation history. ` +
        `Treat it as reference context rather than verbatim transcript. Some recent raw messages may overlap with it.\n\n` +
        `${snapshot.content}\n` +
        `</context-snapshot>`,
      timestamp: snapshot.createdAt,
    };
  }

  buildNewlyVisibleBoundaryOverlay(agentId: AgentId, count: number): LlmMessage {
    const agentName = getDisplayName(agentId);
    const lines = [
      `<context-boundary count="${count}">`,
      count === 1
        ? `The message below this marker became newly visible in this turn for ${agentName}.`
        : `${count} messages below this marker became newly visible in this turn for ${agentName}.`,
      count === 1
        ? `${agentName} should prioritize interpreting this newest item in light of the earlier shared history above.`
        : `${agentName} should prioritize interpreting these newest items in light of the earlier shared history above.`,
      `</context-boundary>`,
    ];

    return {
      role: "user",
      content: lines.join("\n"),
      timestamp: Date.now(),
    };
  }

  buildCompressionReminderOverlay(agentId: AgentId, estimatedChars: number, thresholdChars: number, contextWindowTokens?: number): LlmMessage {
    const agentName = getDisplayName(agentId);
    const estimatedTokens = charsToTokens(estimatedChars);
    const pct = contextWindowTokens
      ? ` (approximately ${Math.round(estimatedTokens / contextWindowTokens * 100)}% of model context capacity)`
      : "";
    return {
      role: "user",
      content:
        `<context-reminder>\n` +
        `The recent raw context visible to ${agentName} is estimated at about ${estimatedTokens} tokens${pct}, above the compression reminder threshold. ` +
        `Context compression is worth considering, but this is a reminder rather than an instruction to compress immediately.\n` +
        `</context-reminder>`,
      timestamp: Date.now(),
    };
  }

  buildProposalNotification(proposal: PendingProposal, proposerName: string, voterName: string): LlmMessage {
    return {
      role: "user",
      content:
        `<directive>\n` +
        `${voterName} must now vote on ${proposerName}'s pending ${proposal.toolName} proposal.\n` +
        `${voterName} may only call the **vote** tool with APPROVE or REJECT and a reason in this turn.\n` +
        `If you do not vote this turn, the proposal will be automatically superseded.\n` +
        `</directive>`,
      timestamp: Date.now(),
    };
  }

  buildProposerWaitNotification(proposerName: string, voterName: string, toolName: string): LlmMessage {
    return {
      role: "user",
      content:
        `<directive>\n` +
        `${proposerName}, your ${toolName} proposal is pending and awaiting ${voterName}'s vote.\n` +
        `You cannot vote on your own proposal. Do not call the vote tool. Wait for ${voterName} to decide.\n` +
        `If ${voterName} does not vote this turn, the proposal will be automatically superseded and you may propose again.\n` +
        `</directive>`,
      timestamp: Date.now(),
    };
  }

  buildChildCommitViewMessage(agentId: AgentId, childCommitViews: readonly ChildCommitView[]): LlmMessage | null {
    if (childCommitViews.length === 0) {
      return null;
    }

    const agentName = getDisplayName(agentId);
    const lines = [
      `<context-snapshot type="child-commits">`,
      `The following currently visible child unit commit log snapshot is visible to ${agentName} (accepted steps only; not real-time activity):`,
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

    lines.push(`</context-snapshot>`);

    return {
      role: "user",
      content: lines.join("\n"),
      timestamp: Date.now(),
    };
  }
}
