// Elenchus MVP - AgentTurn
// Executes a single LLM turn for one agent: inject new messages → call pi-ai → parse response.
// Each agent maintains an independent pi-ai Context (messages array).
// The other agent's replies and system events are injected as user messages with prefixes.

import { complete, type Context, type Message, type Model, type StopReason, type Tool } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { type AgentId, type BusMessage, type TurnResult } from "./types.js";
import { buildToolList, type ElenchusTool } from "./tools.js";

// Display name mapping for message prefixes
const DISPLAY_NAMES: Record<string, string> = {
  "agent-a": "Generator",
  "agent-b": "Verifier",
  user: "User",
  system: "System",
};

// Convert BusMessages into pi-ai user messages for injection into an agent's context.
// The agent's own previous replies are already in its context as assistant messages.
function convertBusMessagesToInjection(messages: BusMessage[], selfId: AgentId): Message[] {
  const result: Message[] = [];

  for (const msg of messages) {
    // Skip own messages — they are already in context as assistant messages
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

// Build a pending-proposal notification message for injection.
function buildProposalNotification(proposal: { toolName: string; args: { content: string } }, proposerName: string): Message {
  return {
    role: "user",
    content:
      `[System]: ${proposerName} has proposed a Report. The proposed content is:\n\n` +
      `---\n${proposal.args.content}\n---\n\n` +
      `Please evaluate this proposal carefully and call the **vote** tool to APPROVE or REJECT it.`,
    timestamp: Date.now(),
  };
}

// Convert ElenchusTool[] to pi-ai Tool[] format
function toProviderTools(tools: ElenchusTool[]): Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

export class AgentTurn {
  private selfId: AgentId;
  private systemPrompt: string;
  private model: Model<any>;
  // This agent's independent pi-ai message history
  private messages: Message[] = [];

  constructor(selfId: AgentId, systemPrompt: string, model: Model<any>) {
    this.selfId = selfId;
    this.systemPrompt = systemPrompt;
    this.model = model;
  }

  // Execute one turn: inject new bus messages → call LLM → parse result.
  // Returns a TurnResult describing the agent's reply, any proposal, and any vote.
  async execute(
    newBusMessages: BusMessage[],
    pendingProposal: { toolName: string; args: { content: string }; proposer: AgentId } | null,
  ): Promise<TurnResult> {
    // 1. Inject new messages from the bus into this agent's context
    const injected = convertBusMessagesToInjection(newBusMessages, this.selfId);
    this.messages.push(...injected);

    // 2. If there is a pending proposal from the other agent, inject a notification
    if (pendingProposal && pendingProposal.proposer !== this.selfId) {
      const proposerName = DISPLAY_NAMES[pendingProposal.proposer] ?? pendingProposal.proposer;
      this.messages.push(buildProposalNotification(pendingProposal, proposerName));
    }

    // 3. Build tool list (Vote only available when there's a pending proposal from the other agent)
    const hasPendingFromOther = pendingProposal !== null && pendingProposal.proposer !== this.selfId;
    const tools = buildToolList(hasPendingFromOther);

    // 4. Call LLM with explicit maxTokens to prevent proxy/API truncation
    const context: Context = {
      systemPrompt: this.systemPrompt,
      messages: this.messages,
      tools: toProviderTools(tools),
    };

    const response = await complete(this.model, context, { maxTokens: 8192 });

    // 5. Add assistant response to this agent's context
    this.messages.push(response);

    // 6. Parse response into TurnResult
    const result: TurnResult = { reply: "", stopReason: response.stopReason };

    for (const block of response.content) {
      if (block.type === "text") {
        result.reply += block.text;
      } else if (block.type === "toolCall") {
        if (block.name === "report") {
          result.proposal = {
            toolName: "report",
            args: block.arguments as { content: string },
          };
        } else if (block.name === "vote") {
          const args = block.arguments as { approve: boolean; reason: string };
          result.vote = {
            approve: args.approve,
            reason: args.reason,
          };
        }

        // Add a synthetic tool result so the context stays valid for future turns.
        // The framework "acknowledges" the tool call without actually executing it.
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

    return result;
  }

  // Build an acknowledgement message for a tool call.
  private buildToolAck(toolName: string, result: TurnResult): string {
    if (toolName === "report") {
      return "Your report proposal has been recorded. Waiting for the other agent's vote.";
    }
    if (toolName === "vote" && result.vote) {
      return result.vote.approve
        ? "Your APPROVE vote has been recorded."
        : "Your REJECT vote has been recorded.";
    }
    return "Tool call acknowledged.";
  }
}
