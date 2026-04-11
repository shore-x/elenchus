// Elenchus - AgentTurn
// Executes a single LLM turn for one agent using the abstract LlmClient port.
// Each agent maintains an independent message history.
// The other agent's replies and system events are injected as user messages with prefixes.
// Tool list is built per-turn based on layer (§4.3) and state (pending proposal, children).

import type { LlmContext, LlmMessage, LlmToolDefinition, LlmClient } from "../ports.js";
import { type AgentId, type BusMessage, type ChildCommitView, type PendingProposal, type ProposalCall, type ToolLevel, type TurnResult } from "../types.js";
import { buildToolList, type ElenchusTool } from "../tools.js";

const DISPLAY_NAMES: Record<string, string> = {
  "agent-a": "Agent A",
  "agent-b": "Agent B",
  user: "User",
  system: "System",
};

function convertBusMessagesToInjection(messages: BusMessage[], selfId: AgentId): LlmMessage[] {
  const result: LlmMessage[] = [];

  for (const msg of messages) {
    if (msg.source === selfId) continue;

    const prefix = DISPLAY_NAMES[msg.source] ?? msg.source;
    const text = `[${prefix}]: ${msg.content}`;

    result.push({
      role: "user",
      content: text,
      timestamp: msg.timestamp,
    });
  }

  return result;
}

function buildProposalNotification(proposal: ProposalCall, proposerName: string): LlmMessage {
  let detail: string;
  switch (proposal.toolName) {
    case "yield":
      detail = `The proposed content is:\n\n---\n${proposal.args.content}\n---`;
      break;
    case "bash":
      detail = `Command: \`${proposal.args.command}\``;
      break;
    case "readFile":
      detail = `File path: \`${proposal.args.path}\``;
      break;
    case "writeFile":
      detail = `File path: \`${proposal.args.path}\`\nContent (${String(proposal.args.content).length} chars):\n---\n${String(proposal.args.content).slice(0, 500)}${String(proposal.args.content).length > 500 ? "\n[truncated]" : ""}\n---`;
      break;
    case "sleep":
      detail = `Timeout: ${proposal.args.timeoutMs}ms`;
      break;
    case "spawnChild": {
      const task = String(proposal.args.task);
      detail = `Task: ${task.length > 200 ? task.slice(0, 200) + "..." : task}`;
      break;
    }
    case "sendToChild":
      detail = `Child: ${proposal.args.childId}, Message: ${String(proposal.args.message).slice(0, 100)}${String(proposal.args.message).length > 100 ? "..." : ""}`;
      break;
    default:
      detail = `Arguments: ${JSON.stringify(proposal.args)}`;
  }

  return {
    role: "user",
    content:
      `[System]: ${proposerName} has proposed to use the **${proposal.toolName}** tool.\n` +
      `Proposed step: ${proposal.proposedStep}\n${detail}\n\n` +
      `Please evaluate this proposal and call the **vote** tool to APPROVE or REJECT it.`,
    timestamp: Date.now(),
  };
}

function buildChildCommitViewMessage(childCommitViews: readonly ChildCommitView[]): LlmMessage | null {
  if (childCommitViews.length === 0) {
    return null;
  }

  const lines = [
    "[System]: Child unit commit log snapshot (accepted steps only; not real-time activity):",
  ];

  for (const view of childCommitViews) {
    lines.push(`- ${view.childId} [state: ${view.state}]`);
    if (view.committedSteps.length === 0) {
      lines.push("  - no committed steps yet");
      continue;
    }

    for (const step of view.committedSteps) {
      const proposerName = DISPLAY_NAMES[step.proposedBy] ?? step.proposedBy;
      lines.push(`  - ${proposerName} via ${step.toolName}: ${step.proposedStep}`);
    }
  }

  return {
    role: "user",
    content: lines.join("\n"),
    timestamp: Date.now(),
  };
}

function toProviderTools(tools: ElenchusTool[]): LlmToolDefinition[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

export class AgentTurn {
  private selfId: AgentId;
  private systemPrompt: string;
  private llmClient: LlmClient;
  private level: ToolLevel;
  private messages: LlmMessage[] = [];

  constructor(selfId: AgentId, systemPrompt: string, llmClient: LlmClient, level: ToolLevel = "L0") {
    this.selfId = selfId;
    this.systemPrompt = systemPrompt;
    this.llmClient = llmClient;
    this.level = level;
  }

  async execute(
    newBusMessages: BusMessage[],
    pendingProposal: PendingProposal | null,
    hasChildren: boolean = false,
    childCommitViews: readonly ChildCommitView[] = [],
  ): Promise<TurnResult> {
    const injected = convertBusMessagesToInjection(newBusMessages, this.selfId);
    this.messages.push(...injected);

    if (pendingProposal && pendingProposal.proposer !== this.selfId) {
      const proposerName = DISPLAY_NAMES[pendingProposal.proposer] ?? pendingProposal.proposer;
      this.messages.push(buildProposalNotification(pendingProposal, proposerName));
    }

    const hasPendingFromOther = pendingProposal !== null && pendingProposal.proposer !== this.selfId;
    const tools = buildToolList(hasPendingFromOther, this.level, hasChildren);
    const childCommitViewMessage = buildChildCommitViewMessage(childCommitViews);

    const context: LlmContext = {
      systemPrompt: this.systemPrompt,
      messages: childCommitViewMessage ? [...this.messages, childCommitViewMessage] : this.messages,
      tools: toProviderTools(tools),
    };

    const response = await this.llmClient.complete(context, { maxTokens: 8192 });
    this.messages.push(response);

    const validToolNames = new Set(tools.map((t) => t.name));
    const result: TurnResult = { reply: "", stopReason: response.stopReason };

    for (const block of response.content) {
      if (block.type === "text") {
        result.reply += block.text;
      } else if (block.type === "toolCall") {
        if (!validToolNames.has(block.name)) {
          (result.unknownToolCalls ??= []).push({
            name: block.name,
            args: block.arguments,
          });
          this.messages.push({
            role: "toolResult",
            toolCallId: block.id,
            toolName: block.name,
            content: [{ type: "text", text: `Error: tool "${block.name}" does not exist. Only use tools explicitly provided by the framework: ${[...validToolNames].join(", ")}.` }],
            isError: true,
            timestamp: Date.now(),
          });
        } else if (block.name === "vote") {
          const args = block.arguments as { approve: boolean; reason: string };
          result.vote = {
            approve: args.approve,
            reason: args.reason,
          };
          this.messages.push({
            role: "toolResult",
            toolCallId: block.id,
            toolName: block.name,
            content: [{ type: "text", text: this.buildToolAck(block.name, result) }],
            isError: false,
            timestamp: Date.now(),
          });
        } else {
          const rawArgs = block.arguments;
          const proposedStep = typeof rawArgs.proposedStep === "string" ? rawArgs.proposedStep.trim() : "";

          if (!proposedStep) {
            this.messages.push({
              role: "toolResult",
              toolCallId: block.id,
              toolName: block.name,
              content: [{ type: "text", text: "Error: proposal tools must include a non-empty proposedStep that explains how the action advances the task." }],
              isError: true,
              timestamp: Date.now(),
            });
            continue;
          }

          const { proposedStep: _proposedStep, ...toolArgs } = rawArgs;
          result.proposal = {
            toolName: block.name,
            args: toolArgs,
            proposedStep,
          };
          this.messages.push({
            role: "toolResult",
            toolCallId: block.id,
            toolName: block.name,
            content: [{ type: "text", text: this.buildToolAck(block.name, result) }],
            isError: false,
            timestamp: Date.now(),
          });
        }
      }
    }

    return result;
  }

  getContextSize(): number {
    return this.messages.length;
  }

  private buildToolAck(toolName: string, result: TurnResult): string {
    if (toolName === "vote" && result.vote) {
      return result.vote.approve
        ? "Your APPROVE vote has been recorded."
        : "Your REJECT vote has been recorded.";
    }
    if (toolName === "yield") {
      return "Your yield proposal has been recorded. Waiting for the other agent's vote.";
    }
    if (toolName === "sleep") {
      return "Your sleep proposal has been recorded. Waiting for the other agent's vote.";
    }
    return `Your ${toolName} proposal has been recorded. Waiting for the other agent's vote.`;
  }
}
