// Elenchus - Session Persistence Port
// Stable application-layer boundary for saving and restoring the root deliberation graph,
// while allowing the storage backend to manage its own lifecycle.

import type { SkillBindingRecord } from "../core/skills.js";
import type { DeliberationUnitSnapshot } from "../core/types.js";

export interface SessionPersistenceAdapter {
  loadSnapshot(): DeliberationUnitSnapshot | null;
  saveSnapshot(snapshot: DeliberationUnitSnapshot): void;
  loadSkillBindings?(): SkillBindingRecord[] | null;
  saveSkillBindings?(bindings: readonly SkillBindingRecord[]): void;
  close?(): void;
}
