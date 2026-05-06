// Elenchus - AgentTurn
// Executes a single LLM turn for one agent using the abstract LlmClient port.
// AgentTurn is intentionally stateless with respect to conversation history.
// The full agent-visible context is projected per turn from ConversationLedger upstream.
// Tool list is built per-turn based on layer (§4.3) and state (pending proposal, children).

import type { LlmContext, LlmToolDefinition, LlmClient } from "../ports.js";
import { type AgentId, type ProposalCall, type TurnAction, type TurnResult, type UnitRuntimeBroadcast, type VoteCall } from "../types.js";
import { type ElenchusTool } from "../tools.js";

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

  constructor(selfId: AgentId, llmClient: LlmClient) {
    this.selfId = selfId;
    this.llmClient = llmClient;
  }

  async execute(
    context: LlmContext,
    tools: readonly ElenchusTool[],
    signal?: AbortSignal,
  ): Promise<TurnResult> {
    const providerContext: LlmContext = {
      ...context,
      tools: toProviderTools([...tools]),
    };

    const response = await this.llmClient.complete(providerContext, { maxTokens: 8192, signal });
    const rawBlocks = (response as any).content ?? response.content;
    console.log(`[AgentTurn:${this.selfId}] LLM response: stopReason=${response.stopReason}, contentBlocks=${response.content.length}, types=[${response.content.map((b: any) => b.type).join(",")}]`);
    if (response.stopReason === "error") {
      const errMsg = response.errorMessage ?? (rawBlocks as any).errorMessage ?? "Unknown API error (no errorMessage provided)";
      console.error(`[AgentTurn:${this.selfId}] LLM returned stopReason=error: ${errMsg}`);
      throw new Error(`LLM API error: ${errMsg}`);
    }
    if (rawBlocks.length > 0) {
      for (let i = 0; i < rawBlocks.length; i++) {
        const block = rawBlocks[i] as any;
        if (block.type === "text") {
          console.log(`[AgentTurn:${this.selfId}]   block[${i}] text: ${JSON.stringify((block.text as string).slice(0, 200))}`);
        } else if (block.type === "toolCall") {
          console.log(`[AgentTurn:${this.selfId}]   block[${i}] toolCall: name=${block.name}, args=${JSON.stringify(block.arguments).slice(0, 200)}`);
        } else if (block.type === "thinking") {
          console.log(`[AgentTurn:${this.selfId}]   block[${i}] thinking: len=${(block.thinking as string).length}`);
        } else {
          console.log(`[AgentTurn:${this.selfId}]   block[${i}] unknown type: ${block.type}`);
        }
      }
    }
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
