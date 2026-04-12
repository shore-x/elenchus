// Elenchus - Session Persistence Port
// Stable application-layer boundary for saving and restoring the root deliberation graph.

import type { DeliberationUnitSnapshot } from "../core/types.js";

export interface SessionPersistenceAdapter {
  loadSnapshot(): DeliberationUnitSnapshot | null;
  saveSnapshot(snapshot: DeliberationUnitSnapshot): void;
}
