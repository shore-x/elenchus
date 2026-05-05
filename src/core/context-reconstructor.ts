// Elenchus - Context Reconstructor
// Reconstructs the LLM input context for a specific agent message from immutable
// persisted facts (context_recipe, ledger_messages, context_text_history).
// This is a pure function module — it does not depend on DeliberationUnit runtime state.
// Used by the "View Context" feature to generate a human-readable Markdown file
// showing exactly what context the LLM received when producing a given message.

import { ConversationProjector } from "./conversation-projector.js";
import { buildSystemPrompt, readRootAgentMd } from "./prompts.js";
import { getBuiltInToolList } from "./tools.js";
import type { ContextRecipeData } from "./types.js";
import type { LlmMessage } from "./ports.js";
import type { ContextPersistenceSink } from "./unit/deliberation-unit.js";

export interface ReconstructedContext {
  systemPrompt: string;
  messages: LlmMessage[];
  toolNames: string[];
  recipe: ContextRecipeData;
}

export interface ReconstructDeps {
  persistence: ContextPersistenceSink;
  workspaceRoot: string;
}

/**
 * Reconstruct the full LLM context that produced a given output message.
 * Returns null if no recipe exists for the message (e.g. pre-recipe era).
 */
export function reconstructContext(
  deps: ReconstructDeps,
  messageId: string,
): ReconstructedContext | null {
  const { persistence, workspaceRoot } = deps;

  // 1. Look up recipe by output_message_id
  const recipe = persistence.getRecipeByOutputMessageId(messageId);
  if (!recipe) return null;

  // 2. Reconstruct system prompt
  let workspaceKnowledge: string | null = null;
  if (recipe.agentMdRowid !== null) {
    const entry = persistence.getContextTextHistoryByRowid(recipe.agentMdRowid);
    workspaceKnowledge = entry?.content ?? null;
  }
  // Fallback: read current filesystem version if no rowid was recorded
  if (workspaceKnowledge === null) {
    workspaceKnowledge = readRootAgentMd(workspaceRoot);
  }
  const systemPrompt = buildSystemPrompt(
    recipe.agentId,
    recipe.level,
    workspaceRoot,
    workspaceKnowledge,
  );

  // 3. Reconstruct messages from ledger_messages by seq range
  const sequencedMessages = persistence.getLedgerMessagesBySeqRange(
    recipe.unitId,
    recipe.recentRawStartSeq,
    recipe.visibleEndSeq,
  );
  const allMessages = sequencedMessages.map((entry) => entry.message);

  const projector = new ConversationProjector();

  let oldMessages = allMessages;
  let newMessages: typeof allMessages = [];

  if (recipe.newlyVisibleSeq !== null) {
    const splitIndex = allMessages.findIndex(
      (_message, index) => sequencedMessages[index].seq >= recipe.newlyVisibleSeq!,
    );
    if (splitIndex >= 0) {
      oldMessages = allMessages.slice(0, splitIndex);
      newMessages = allMessages.slice(splitIndex);
    }
  }

  const messages: LlmMessage[] = [];

  if (recipe.memorySnapshotRowid !== null) {
    const entry = persistence.getContextTextHistoryByRowid(recipe.memorySnapshotRowid);
    if (entry) {
      const meta = entry.metadata ? JSON.parse(entry.metadata) as { sourceMessageCount?: number; requirements?: string } : {};
      messages.push(projector.buildMemorySnapshotMessage({
        content: entry.content,
        sourceMessageCount: meta.sourceMessageCount ?? 0,
        requirements: meta.requirements ?? "",
        createdAt: 0,
      }));
    }
  }

  messages.push(...projector.projectVisibleMessages(oldMessages));

  if (newMessages.length > 0) {
    messages.push(projector.buildNewlyVisibleBoundaryOverlay(recipe.agentId, newMessages.length));
    messages.push(...projector.projectVisibleMessages(newMessages));
  }

  if (
    recipe.compressionReminderShown
    && recipe.compressionReminderChars !== null
    && recipe.compressionReminderThresholdChars !== null
  ) {
    messages.push(projector.buildCompressionReminderOverlay(
      recipe.agentId,
      recipe.compressionReminderChars,
      recipe.compressionReminderThresholdChars,
    ));
  }

  const tools = getBuiltInToolList(
    recipe.hasPendingFromOther,
    recipe.level,
    recipe.hasChildren,
    recipe.canSpawnChild,
  );
  const toolNames = tools.map((t) => t.name);

  return { systemPrompt, messages, toolNames, recipe };
}

/**
 * Format a ReconstructedContext into a human-readable Markdown string.
 */
export function formatContextAsMarkdown(ctx: ReconstructedContext, messageId: string): string {
  const { systemPrompt, messages, toolNames, recipe } = ctx;
  const agentName = recipe.agentId === "agent-a" ? "Agent A" : "Agent B";
  const timestamp = new Date().toISOString();

  const sections: string[] = [];

  // Header
  sections.push(`# Context Reconstruction`);
  sections.push(``);
  sections.push(`> **Unit**: ${recipe.unitId} | **Agent**: ${agentName} | **Turn**: ${recipe.effectiveTurn} | **Level**: ${recipe.level}`);
  sections.push(`> **Reconstructed at**: ${timestamp}`);
  sections.push(`> **Source message**: \`${messageId}\``);
  sections.push(``);
  sections.push(`---`);
  sections.push(``);

  // System Prompt
  sections.push(`## System Prompt`);
  sections.push(``);
  sections.push(systemPrompt);
  sections.push(``);
  sections.push(`---`);
  sections.push(``);

  // Messages
  sections.push(`## Messages`);
  sections.push(``);
  for (const msg of messages) {
    const role = msg.role === "user" ? "user" : "assistant";
    sections.push(`### [${role}]`);
    sections.push(``);
    sections.push(msg.content as string);
    sections.push(``);
  }
  sections.push(`---`);
  sections.push(``);

  // Tool List
  sections.push(`## Available Tools`);
  sections.push(``);
  for (const name of toolNames) {
    sections.push(`- \`${name}\``);
  }
  sections.push(``);

  return sections.join("\n");
}
