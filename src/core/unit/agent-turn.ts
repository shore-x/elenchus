// Elenchus - AgentTurn
// Executes a single LLM turn for one agent using the abstract LlmClient port.
// Each agent maintains an independent message history.
// The other agent's replies and system events are injected as user messages with prefixes.
// Tool list is built per-turn based on layer (§4.3) and state (pending proposal, children).

import type { LlmContext, LlmMessage, LlmToolDefinition, LlmClient } from "../ports.js";
import { ConversationProjector } from "../conversation-projector.js";
import { type AgentId, type ChildCommitView, type ConversationMessage, type FrameworkBroadcast, type PendingProposal, type ProposalCall, type ToolLevel, type TurnAction, type TurnResult, type VoteCall } from "../types.js";
import { buildToolList, type ElenchusTool } from "../tools.js";

const DISPLAY_NAMES: Record<AgentId, string> = {
  "agent-a": "Agent A",
  "agent-b": "Agent B",
};

function toProviderTools(tools: ElenchusTool[]): LlmToolDefinition[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

function getDisplayName(agentId: AgentId): string {
  return DISPLAY_NAMES[agentId] ?? agentId;
}

export class AgentTurn {
  private selfId: AgentId;
  private systemPrompt: string;
  private llmClient: LlmClient;
  private level: ToolLevel;
  private projector: ConversationProjector;
  private messages: LlmMessage[] = [];

  constructor(selfId: AgentId, systemPrompt: string, llmClient: LlmClient, level: ToolLevel = "L0") {
    this.selfId = selfId;
    this.systemPrompt = systemPrompt;
    this.llmClient = llmClient;
    this.level = level;
    this.projector = new ConversationProjector();
  }

  async execute(
    newConversationMessages: ConversationMessage[],
    pendingProposal: PendingProposal | null,
    hasChildren: boolean = false,
    childCommitViews: readonly ChildCommitView[] = [],
  ): Promise<TurnResult> {
    const injected = this.projector.projectNewMessages(newConversationMessages, this.selfId);
    this.messages.push(...injected);

    if (pendingProposal && pendingProposal.proposer !== this.selfId) {
      const proposerName = DISPLAY_NAMES[pendingProposal.proposer] ?? pendingProposal.proposer;
      const voterName = DISPLAY_NAMES[this.selfId] ?? this.selfId;
      this.messages.push(this.projector.buildProposalNotification(pendingProposal, proposerName, voterName));
    }

    const hasPendingFromOther = pendingProposal !== null && pendingProposal.proposer !== this.selfId;
    const tools = buildToolList(hasPendingFromOther, this.level, hasChildren);
    const childCommitViewMessage = this.projector.buildChildCommitViewMessage(childCommitViews);

    const context: LlmContext = {
      systemPrompt: this.systemPrompt,
      messages: childCommitViewMessage ? [...this.messages, childCommitViewMessage] : this.messages,
      tools: toProviderTools(tools),
    };

    const response = await this.llmClient.complete(context, { maxTokens: 8192 });
    const sanitizedResponse = this.sanitizeAssistantResponse(response);
    if (sanitizedResponse) {
      this.messages.push(sanitizedResponse);
    }

    return this.parseTurnResult(response, tools);
  }

  getContextSize(): number {
    return this.messages.length;
  }

  private sanitizeAssistantResponse(response: Awaited<ReturnType<LlmClient["complete"]>>): LlmMessage | null {
    const textBlocks = response.content.filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text");
    if (textBlocks.length === 0) {
      return null;
    }

    return {
      ...response,
      content: textBlocks,
    };
  }

  private parseTurnResult(response: Awaited<ReturnType<LlmClient["complete"]>>, tools: readonly ElenchusTool[]): TurnResult {
    const result: TurnResult = {
      reply: response.content
        .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
        .map((block) => block.text)
        .join(""),
      stopReason: response.stopReason,
    };

    const toolCalls = response.content.filter((block): block is Extract<typeof block, { type: "toolCall" }> => block.type === "toolCall");
    if (toolCalls.length === 0) {
      return result;
    }

    const agentName = getDisplayName(this.selfId);
    if (toolCalls.length > 1) {
      result.frameworkBroadcasts = [
        this.createFrameworkBroadcast(
          "malformed_multiple_tool_calls",
          `Framework rejected ${agentName}'s tool invocation because the response contained multiple tool calls. No proposal or vote was recorded.`,
        ),
      ];
      return result;
    }

    const [toolCall] = toolCalls;
    const validToolNames = new Set(tools.map((tool) => tool.name));
    if (!validToolNames.has(toolCall.name)) {
      result.frameworkBroadcasts = [
        this.createFrameworkBroadcast(
          "tool_not_available",
          `Framework rejected ${agentName}'s tool invocation because tool "${toolCall.name}" was not available in the current turn. No proposal or vote was recorded.`,
        ),
      ];
      return result;
    }

    if (toolCall.name === "vote") {
      const vote = this.parseVoteCall(toolCall.arguments);
      if (!vote) {
        result.frameworkBroadcasts = [
          this.createFrameworkBroadcast(
            "vote_arguments_invalid",
            `Framework rejected ${agentName}'s vote invocation because the vote arguments were invalid. No vote was recorded.`,
          ),
        ];
        return result;
      }

      result.action = { kind: "vote", vote };
      return result;
    }

    const proposal = this.parseProposalCall(toolCall.name, toolCall.arguments);
    if (!proposal) {
      result.frameworkBroadcasts = [
        this.createFrameworkBroadcast(
          "proposal_missing_proposed_step",
          `Framework rejected ${agentName}'s ${toolCall.name} proposal because proposedStep was missing or empty. No proposal was recorded.`,
        ),
      ];
      return result;
    }

    result.action = { kind: "proposal", proposal };
    return result;
  }

  private parseVoteCall(rawArgs: Record<string, unknown>): VoteCall | null {
    const reason = typeof rawArgs.reason === "string" ? rawArgs.reason.trim() : "";
    if (typeof rawArgs.approve !== "boolean" || !reason) {
      return null;
    }

    return {
      approve: rawArgs.approve,
      reason,
    };
  }

  private parseProposalCall(toolName: string, rawArgs: Record<string, unknown>): ProposalCall | null {
    const proposedStep = typeof rawArgs.proposedStep === "string" ? rawArgs.proposedStep.trim() : "";
    if (!proposedStep) {
      return null;
    }

    const { proposedStep: _proposedStep, ...toolArgs } = rawArgs;
    return {
      toolName,
      args: toolArgs,
      proposedStep,
    };
  }

  private createFrameworkBroadcast(code: FrameworkBroadcast["code"], content: string): FrameworkBroadcast {
    return { code, content };
  }
}
