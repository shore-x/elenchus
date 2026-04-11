// Elenchus - AgentTurn
// Executes a single LLM turn for one agent: inject new messages → call pi-ai → parse response.
// Each agent maintains an independent pi-ai Context (messages array).
// The other agent's replies and system events are injected as user messages with prefixes.
// Tool list is built per-turn based on layer (§4.3) and state (pending proposal, children).

import { complete, type Context, type Message, type Model, type StopReason, type Tool } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { type AgentId, type BusMessage, type ToolLevel, type TurnResult } from "./types.js";
import { buildToolList, type ElenchusTool } from "./tools.js";

// Display name mapping for message prefixes
const DISPLAY_NAMES: Record<string, string> = {
  "agent-a": "Agent A",
  "agent-b": "Agent B",
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
// Supports any tool type (Yield, Bash, ReadFile, WriteFile, etc.)
function buildProposalNotification(
  proposal: { toolName: string; args: Record<string, unknown> },
  proposerName: string,
): Message {
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
      `[System]: ${proposerName} has proposed to use the **${proposal.toolName}** tool.\n${detail}\n\n` +
      `Please evaluate this proposal and call the **vote** tool to APPROVE or REJECT it.`,
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
  private level: ToolLevel;
  // This agent's independent pi-ai message history
  private messages: Message[] = [];

  constructor(selfId: AgentId, systemPrompt: string, model: Model<any>, level: ToolLevel = "L0") {
    this.selfId = selfId;
    this.systemPrompt = systemPrompt;
    this.model = model;
    this.level = level;
  }

  // Execute one turn: inject new bus messages → call LLM → parse result.
  // Returns a TurnResult describing the agent's reply, any proposal, and any vote.
  async execute(
    newBusMessages: BusMessage[],
    pendingProposal: { toolName: string; args: Record<string, unknown>; proposer: AgentId } | null,
    hasChildren: boolean = false,
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
    const tools = buildToolList(hasPendingFromOther, this.level, hasChildren);

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
    const validToolNames = new Set(tools.map((t) => t.name));
    const result: TurnResult = { reply: "", stopReason: response.stopReason };

    for (const block of response.content) {
      if (block.type === "text") {
        result.reply += block.text;
      } else if (block.type === "toolCall") {
        if (!validToolNames.has(block.name)) {
          // LLM hallucinated a tool that doesn't exist — reject it
          (result.unknownToolCalls ??= []).push({
            name: block.name,
            args: block.arguments as Record<string, unknown>,
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
          // Vote is the only tool that is NOT a proposal
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
          // All other valid tool calls (yield, bash, readFile, writeFile) are proposals
          result.proposal = {
            toolName: block.name,
            args: block.arguments as Record<string, unknown>,
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

  // Return the number of messages in this agent's context (for debug display).
  getContextSize(): number {
    return this.messages.length;
  }

  // Build an acknowledgement message for a tool call.
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
