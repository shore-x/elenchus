// Elenchus - AgentTurn
// Executes a single LLM turn for one agent using the abstract LlmClient port.
// AgentTurn is intentionally stateless with respect to conversation history.
// The full agent-visible context is projected per turn from ConversationLedger upstream.
// Tool list is built per-turn based on layer (§4.3) and state (pending proposal, children).

import { buildSystemPrompt, readRootAgentMd } from "../prompts.js";
import type { LlmContext, LlmMessage, LlmToolDefinition, LlmClient } from "../ports.js";
import { type AgentId, type ProposalCall, type ToolLevel, type TurnAction, type TurnResult, type UnitRuntimeBroadcast, type VoteCall } from "../types.js";
import { getBuiltInToolList, type ElenchusTool } from "../tools.js";

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
  private llmClient: LlmClient;
  private level: ToolLevel;
  private workspaceRoot: string;
  private workDirectory: string;

  constructor(selfId: AgentId, llmClient: LlmClient, level: ToolLevel = "L0", workspaceRoot: string, workDirectory: string) {
    this.selfId = selfId;
    this.llmClient = llmClient;
    this.level = level;
    this.workspaceRoot = workspaceRoot;
    this.workDirectory = workDirectory;
  }

  async execute(
    messages: LlmMessage[],
    hasPendingFromOther: boolean,
    hasChildren: boolean = false,
  ): Promise<TurnResult> {
    const tools = getBuiltInToolList(hasPendingFromOther, this.level, hasChildren);

    const workspaceKnowledge = readRootAgentMd(this.workspaceRoot);

    const context: LlmContext = {
      systemPrompt: buildSystemPrompt(this.selfId, this.level, this.workspaceRoot, this.workDirectory, workspaceKnowledge),
      messages,
      tools: toProviderTools(tools),
    };

    const response = await this.llmClient.complete(context, { maxTokens: 8192 });
    return this.parseTurnResult(response, tools);
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
      result.unitRuntimeBroadcasts = [
        this.createUnitRuntimeBroadcast(
          "malformed_multiple_tool_calls",
          `${agentName}'s tool invocation was rejected because the response contained multiple tool calls. No proposal or vote was recorded.`,
        ),
      ];
      return result;
    }

    const [toolCall] = toolCalls;
    const validToolNames = new Set(tools.map((tool) => tool.name));
    if (!validToolNames.has(toolCall.name)) {
      result.unitRuntimeBroadcasts = [
        this.createUnitRuntimeBroadcast(
          "tool_not_available",
          `${agentName}'s tool invocation was rejected because tool "${toolCall.name}" was not available in the current turn. No proposal or vote was recorded.`,
        ),
      ];
      return result;
    }

    if (toolCall.name === "vote") {
      const vote = this.parseVoteCall(toolCall.arguments);
      if (!vote) {
        result.unitRuntimeBroadcasts = [
          this.createUnitRuntimeBroadcast(
            "vote_arguments_invalid",
            `${agentName}'s vote invocation was rejected because the vote arguments were invalid. No vote was recorded.`,
          ),
        ];
        return result;
      }

      result.action = { kind: "vote", vote };
      return result;
    }

    const proposal = this.parseProposalCall(toolCall.name, toolCall.arguments);
    if (!proposal) {
      result.unitRuntimeBroadcasts = [
        this.createUnitRuntimeBroadcast(
          "proposal_missing_proposed_step",
          `${agentName}'s ${toolCall.name} proposal was rejected because proposedStep was missing or empty. No proposal was recorded.`,
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

  private createUnitRuntimeBroadcast(code: UnitRuntimeBroadcast["code"], content: string): UnitRuntimeBroadcast {
    return { code, content };
  }
}
