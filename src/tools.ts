// Elenchus - Tool Definitions
// Three-layer tool allocation (§4.3):
//   - Child management (SpawnChild, SendToChild, UnmountChild, Sleep) → non-leaf (L0, L1)
//   - Environment tools (Bash, ReadFile, WriteFile) → non-coordination (L1, L2)
//   - Protocol tools (Yield, Vote) → all layers
// All non-Vote tool calls are proposals (framework-design §2.4) — require the other agent's vote.

export * from "./core/tools.js";
