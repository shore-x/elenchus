// Elenchus - Session Persistence Port
// Stable application-layer boundary for saving and restoring the root deliberation graph,
// while allowing the storage backend to manage its own lifecycle.
// Append-only message persistence: new messages are appended (version=1),
// updated messages are appended with incremented version (e.g. proposal status changes).

import type { ConversationMessage, DeliberationUnitSnapshot } from "../core/types.js";

export interface SessionPersistenceAdapter {
  loadSnapshot(): DeliberationUnitSnapshot | null;
  saveSnapshot(snapshot: DeliberationUnitSnapshot): void;
  appendMessage(unitId: string, seq: number, message: ConversationMessage): void;
  updateMessage(unitId: string, message: ConversationMessage): void;
  close?(): void;
}
