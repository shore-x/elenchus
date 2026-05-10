// Elenchus - Session Persistence Port
// Stable application-layer boundary for saving and restoring the root deliberation graph,
// while allowing the storage backend to manage its own lifecycle.
// Append-only message persistence: new messages are appended (version=1),
// updated messages are appended with incremented version (e.g. proposal status changes).
// Context observability: context_text_history stores immutable text snapshots (dedup by hash),
// context_recipe records the exact facts needed to reconstruct any LLM call's input.

import type { ContextRecipeData, ConversationMessage, DeliberationUnitSnapshot, SequencedConversationMessage } from "../core/types.js";

export interface SessionPersistenceAdapter {
  loadSnapshot(): DeliberationUnitSnapshot | null;
  saveSnapshot(snapshot: DeliberationUnitSnapshot): void;
  appendMessage(unitId: string, seq: number, message: ConversationMessage): void;
  updateMessage(unitId: string, message: ConversationMessage): void;
  close?(): void;

  // Context observability — context_text_history
  saveContextTextHistory(unitId: string, category: string, content: string, metadata: string): number;
  getLatestContextTextHistory(unitId: string, category: string): { rowid: number; content: string; metadata: string } | null;

  // Context observability — context_recipe
  createRecipe(recipe: ContextRecipeData): number;
  updateRecipeOutputMessageId(recipeId: number, outputMessageId: string): void;

  // Context observability — reconstruction queries
  getRecipeByOutputMessageId(messageId: string): ContextRecipeData | null;
  getContextTextHistoryByRowid(rowid: number): { content: string; metadata: string } | null;
  getLedgerMessagesBySeqRange(unitId: string, startSeq: number, endSeq: number): SequencedConversationMessage[];
  getLatestChildCommitViewMessage(unitId: string, beforeSeq: number): { content: string } | null;
}
