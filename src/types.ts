// Elenchus - Shared Type Definitions
// Three-layer architecture (v1.5): L0 (coordination) / L1 (planning+execution) / L2 (execution).
// All layers share the same FSM and protocol (P9). Differences are only in injected tool sets:
//   - Child management tools (SpawnChild, SendToChild, Sleep) → non-leaf (L0, L1)
//   - Environment tools (Bash, ReadFile, WriteFile) → non-coordination (L1, L2)
//   - Framework tools (Yield, Vote) → all layers
// User messages are async — they can arrive at any time and are processed at the next turn boundary (P4).

export * from "./core/types.js";
