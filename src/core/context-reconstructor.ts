// Elenchus - Context Reconstructor
// Reconstructs the LLM input context for a specific agent message from immutable
// persisted facts (context_recipe, ledger_messages, context_text_history).
// This is a pure function module — it does not depend on DeliberationUnit runtime state.
// Used by the "View Context" feature to generate a human-readable Markdown file
// showing exactly what context the LLM received when producing a given message.

import { ConversationProjector } from "./conversation-projector.js";
import { buildSystemPrompt, readRootAgentMd } from "./prompts.js";
import { getBuiltInToolList } from "./tools.js";
import type { ContextRecipeData, ContextTruncationReason } from "./types.js";
import type { LlmMessage } from "./ports.js";
import type { ContextPersistenceSink } from "./unit/deliberation-unit.js";

function normalizeTruncationReason(reason: string): ContextTruncationReason {
  if (reason === "budget_precheck") return "capacity_guard";
  return reason as ContextTruncationReason;
}

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
  const rawRecipe = persistence.getRecipeByOutputMessageId(messageId);
  if (!rawRecipe) return null;
  const recipe: ContextRecipeData = {
    ...rawRecipe,
    truncationReason: normalizeTruncationReason(rawRecipe.truncationReason),
  };

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
  // child_commit_view_message is stored in ledger but projected as turn-local overlay,
  // not accumulated — filter it out and inject the latest one separately.
  const filteredSequenced = sequencedMessages.filter(
    (entry) => entry.message.kind !== "child_commit_view_message",
  );
  const allMessages = filteredSequenced.map((entry) => entry.message);

  const projector = new ConversationProjector();

  let oldMessages = allMessages;
  let newMessages: typeof allMessages = [];

  if (recipe.newlyVisibleSeq !== null) {
    const splitIndex = filteredSequenced.findIndex(
      (entry) => entry.seq >= recipe.newlyVisibleSeq!,
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

  // Inject latest child commit view as turn-local overlay (matches runtime behavior)
  const latestChildCommitView = persistence.getLatestChildCommitViewMessage(recipe.unitId, recipe.visibleEndSeq);
  if (latestChildCommitView) {
    messages.push({
      role: "user",
      content: latestChildCommitView.content,
      timestamp: 0,
    });
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
 * Format a ReconstructedContext into a self-contained HTML string.
 * Includes embedded CSS with color-coded message types and collapsible sections.
 */
export function formatContextAsHtml(ctx: ReconstructedContext, messageId: string): string {
  const { systemPrompt, messages, toolNames, recipe } = ctx;
  const agentName = recipe.agentId === "agent-a" ? "Agent A" : "Agent B";
  const timestamp = new Date().toISOString();

  const html: string[] = [];

  html.push(`<!DOCTYPE html>`);
  html.push(`<html lang="en"><head><meta charset="utf-8">`);
  html.push(`<title>Context Dump — ${agentName} Turn ${recipe.effectiveTurn}</title>`);
  html.push(`<style>${CONTEXT_CSS}</style>`);
  html.push(`</head><body>`);

  // Header
  html.push(`<header class="ctx-header">`);
  html.push(`<h1>Context Reconstruction</h1>`);
  html.push(`<table class="ctx-meta">`);
  html.push(`<tr><th>Unit</th><td>${esc(recipe.unitId)}</td></tr>`);
  html.push(`<tr><th>Agent</th><td>${esc(agentName)}</td></tr>`);
  html.push(`<tr><th>Turn</th><td>${recipe.effectiveTurn}</td></tr>`);
  html.push(`<tr><th>Level</th><td>${esc(recipe.level)}</td></tr>`);
  html.push(`<tr><th>Source message</th><td><code>${esc(messageId)}</code></td></tr>`);
  html.push(`<tr><th>Reconstructed at</th><td>${esc(timestamp)}</td></tr>`);
  html.push(`</table>`);
  html.push(`</header>`);

  // System Prompt — collapsed by default
  html.push(`<section class="ctx-section">`);
  html.push(`<details>`);
  html.push(`<summary class="ctx-section-title ctx-section-system">System Prompt</summary>`);
  html.push(`<pre class="ctx-pre">${esc(systemPrompt)}</pre>`);
  html.push(`</details>`);
  html.push(`</section>`);

  // Messages
  html.push(`<section class="ctx-section">`);
  html.push(`<h2 class="ctx-section-title">Messages <span class="ctx-count">${messages.length}</span></h2>`);
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content, null, 2);
    const kind = classifyMessage(content);
    const author = extractAuthor(content);
    const isLong = content.length > 600;

    html.push(`<div class="ctx-msg ctx-msg-${kind}${author ? ` ctx-author-${author}-msg` : ""}">`);
    html.push(`<div class="ctx-msg-header">`);
    html.push(`<span class="ctx-msg-index">#${i + 1}</span>`);
    if (author) {
      const authorLabel = author === "agent-a" ? "Agent A" : author === "agent-b" ? "Agent B" : "User";
      html.push(`<span class="ctx-msg-author ctx-author-${author}">${esc(authorLabel)}</span>`);
    }
    html.push(`<span class="ctx-msg-kind ctx-kind-${kind}">${esc(kind)}</span>`);
    html.push(`</div>`);

    if (isLong) {
      html.push(`<details>`);
      html.push(`<summary class="ctx-msg-summary">${esc(truncate(content, 200))}</summary>`);
      html.push(`<pre class="ctx-pre">${esc(content)}</pre>`);
      html.push(`</details>`);
    } else {
      html.push(`<pre class="ctx-pre">${esc(content)}</pre>`);
    }

    html.push(`</div>`);
  }
  html.push(`</section>`);

  // Available Tools
  html.push(`<section class="ctx-section">`);
  html.push(`<h2 class="ctx-section-title">Available Tools <span class="ctx-count">${toolNames.length}</span></h2>`);
  html.push(`<div class="ctx-tools">`);
  for (const name of toolNames) {
    html.push(`<span class="ctx-tool-badge">${esc(name)}</span>`);
  }
  html.push(`</div>`);
  html.push(`</section>`);

  html.push(`</body></html>`);
  return html.join("\n");
}

// --- HTML helpers ---

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + "…";
}

type MessageKind = "dialogue" | "proposal" | "vote" | "tool-result" | "directive" | "context-snapshot" | "context-reminder" | "context-boundary" | "child-report" | "upward-message" | "runtime-broadcast" | "input-message" | "system";

function classifyMessage(content: string): MessageKind {
  // Check for XML-style system tags first
  if (content.startsWith("<proposal")) return "proposal";
  if (content.startsWith("<vote")) return "vote";
  if (content.startsWith("<tool-result")) return "tool-result";
  if (content.startsWith("<directive")) return "directive";
  if (content.startsWith("<context-snapshot")) return "context-snapshot";
  if (content.startsWith("<context-reminder")) return "context-reminder";
  if (content.startsWith("<context-boundary")) return "context-boundary";
  if (content.startsWith("<child-report")) return "child-report";
  if (content.startsWith("<upward-message")) return "upward-message";
  if (content.startsWith("<runtime-broadcast")) return "runtime-broadcast";
  if (content.startsWith("<input-message")) return "input-message";
  if (content.startsWith("<message")) return "dialogue";
  return "dialogue";
}

type AuthorTag = "agent-a" | "agent-b" | "user" | null;

function extractAuthor(content: string): AuthorTag {
  // <message author="Agent A"> or <message author="Agent B">
  const msgMatch = content.match(/^<message\s+author="(Agent [AB])"/);
  if (msgMatch) return msgMatch[1] === "Agent A" ? "agent-a" : "agent-b";

  // <proposal author="Agent A"> or <proposal author="Agent B">
  const propMatch = content.match(/^<proposal\s+author="(Agent [AB])"/);
  if (propMatch) return propMatch[1] === "Agent A" ? "agent-a" : "agent-b";

  // <vote voter="Agent A"> or <vote voter="Agent B">
  const voteMatch = content.match(/^<vote\s+voter="(Agent [AB])"/);
  if (voteMatch) return voteMatch[1] === "Agent A" ? "agent-a" : "agent-b";

  // <input-message> → user
  if (content.startsWith("<input-message")) return "user";

  return null;
}

const CONTEXT_CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
    font-size: 13px; line-height: 1.5;
    color: #111827; background: #ffffff;
    padding: 1.5rem 2rem; max-width: 960px; margin: 0 auto;
  }

  /* Header */
  .ctx-header h1 { font-size: 18px; font-weight: 700; margin-bottom: 0.75rem; }
  .ctx-meta { border-collapse: collapse; margin-bottom: 1rem; }
  .ctx-meta th { text-align: left; font-weight: 600; color: #6b7280; padding: 0.2rem 1rem 0.2rem 0; font-size: 12px; }
  .ctx-meta td { font-size: 12px; color: #4b5563; }
  .ctx-meta code { background: #f2f4f7; padding: 0.1rem 0.3rem; border-radius: 4px; font-size: 11px; }

  /* Sections */
  .ctx-section { margin-bottom: 1.5rem; }
  .ctx-section-title {
    font-size: 14px; font-weight: 700; color: #111827;
    padding: 0.5rem 0; border-bottom: 1px solid #e5e7eb; margin-bottom: 0.75rem;
  }
  .ctx-section-system { cursor: pointer; }
  .ctx-count { font-size: 11px; font-weight: 500; color: #9ca3af; margin-left: 0.5rem; }

  /* Collapsible */
  details { margin-bottom: 0.25rem; }
  summary { cursor: pointer; user-select: none; }
  summary::marker { color: #9ca3af; }
  details[open] > .ctx-msg-summary::after { content: " ▴ collapse"; color: #9ca3af; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif; font-size: 11px; margin-left: 0.5rem; }

  /* Pre blocks */
  .ctx-pre {
    font-family: "SF Mono", "Menlo", "Monaco", "Courier New", monospace;
    font-size: 12px; line-height: 1.55;
    white-space: pre-wrap; word-break: break-word;
    padding: 0.625rem 0.75rem;
    border-radius: 8px;
    background: #fafbfc;
    border: 1px solid #e5e7eb;
    margin: 0.25rem 0;
  }

  /* Message card */
  .ctx-msg {
    border-radius: 10px;
    border: 1px solid #e5e7eb;
    margin-bottom: 0.5rem;
    overflow: hidden;
  }
  .ctx-msg-header {
    display: flex; align-items: center; gap: 0.5rem;
    padding: 0.375rem 0.75rem;
    background: #fafbfc;
    border-bottom: 1px solid #e5e7eb;
    font-size: 12px;
  }
  .ctx-msg-index { color: #9ca3af; font-weight: 600; }
  .ctx-msg-author {
    font-weight: 700; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 11px;
    letter-spacing: 0.02em;
  }
  .ctx-author-agent-a { background: #eef2ff; color: #4338ca; border: 1px solid #c7d2fe; }
  .ctx-author-agent-b { background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
  .ctx-author-user { background: #fff7ed; color: #c2410c; border: 1px solid #fed7aa; }

  .ctx-msg-kind {
    font-weight: 600; padding: 0.1rem 0.4rem; border-radius: 4px; font-size: 11px;
  }
  .ctx-kind-dialogue { background: #f2f4f7; color: #4b5563; }
  .ctx-kind-proposal { background: #dbeafe; color: #1d4ed8; }
  .ctx-kind-vote { background: #dcfce7; color: #15803d; }
  .ctx-kind-tool-result { background: #fef9c3; color: #a16207; }
  .ctx-kind-directive { background: #ffedd5; color: #c2410c; }
  .ctx-kind-context-snapshot { background: #ede9fe; color: #7c3aed; }
  .ctx-kind-context-reminder { background: #fce7f3; color: #be185d; }
  .ctx-kind-context-boundary { background: #e0e7ff; color: #4338ca; }
  .ctx-kind-child-report { background: #ccfbf1; color: #0f766e; }
  .ctx-kind-upward-message { background: #f0f9ff; color: #0369a1; }
  .ctx-kind-runtime-broadcast { background: #fef2f2; color: #dc2626; }
  .ctx-kind-input-message { background: #e0f2fe; color: #0369a1; }
  .ctx-kind-system { background: #f2f4f7; color: #4b5563; }

  /* Message body inside card */
  .ctx-msg .ctx-pre {
    border: none; background: transparent; margin: 0;
    padding: 0.5rem 0.75rem;
  }
  /* Author-aware border accents for dialogue/input-message */
  .ctx-msg-dialogue.ctx-author-agent-a-msg { border-left: 3px solid #4338ca; }
  .ctx-msg-dialogue.ctx-author-agent-b-msg { border-left: 3px solid #047857; }
  .ctx-msg-input-message.ctx-author-user-msg { border-left: 3px solid #c2410c; }
  .ctx-msg-summary {
    padding: 0.375rem 0.75rem;
    font-family: "SF Mono", "Menlo", monospace;
    font-size: 12px; color: #6b7280;
    white-space: pre-wrap; overflow: hidden; text-overflow: ellipsis;
  }

  /* Border accent by kind */
  .ctx-msg-proposal { border-left: 3px solid #2563eb; }
  .ctx-msg-proposal.ctx-author-agent-a-msg { border-left-color: #4338ca; }
  .ctx-msg-proposal.ctx-author-agent-b-msg { border-left-color: #047857; }
  .ctx-msg-vote { border-left: 3px solid #16a34a; }
  .ctx-msg-vote.ctx-author-agent-a-msg { border-left-color: #4338ca; }
  .ctx-msg-vote.ctx-author-agent-b-msg { border-left-color: #047857; }
  .ctx-msg-tool-result { border-left: 3px solid #ca8a04; }
  .ctx-msg-directive { border-left: 3px solid #ea580c; }
  .ctx-msg-context-snapshot { border-left: 3px solid #7c3aed; }
  .ctx-msg-context-reminder { border-left: 3px solid #ec4899; }
  .ctx-msg-context-boundary { border-left: 3px solid #6366f1; }
  .ctx-msg-child-report { border-left: 3px solid #14b8a6; }
  .ctx-msg-upward-message { border-left: 3px solid #0284c7; }
  .ctx-msg-runtime-broadcast { border-left: 3px solid #ef4444; }

  /* Tools */
  .ctx-tools { display: flex; flex-wrap: wrap; gap: 0.375rem; }
  .ctx-tool-badge {
    font-family: "SF Mono", "Menlo", monospace;
    font-size: 11px; font-weight: 500;
    padding: 0.2rem 0.5rem; border-radius: 6px;
    background: #f2f4f7; color: #4b5563;
    border: 1px solid #e5e7eb;
  }
`;
