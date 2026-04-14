# Elenchus

Elenchus is a dual-agent deliberation framework. Two symmetric agents with complementary cognitive strategies collaborate through structured dialogue, externalizing the self-verification process that normally stays implicit inside a single LLM.

Updated: 2026-04-15

## Project Structure

- `src/` — TypeScript source code implementing the framework runtime
- `src/core/` — Core deliberation engine: FSM, conversation ledger, projector, prompts, tools, skills
- `src/core/unit/` — Agent turn execution and deliberation unit (the central FSM)
- `src/application/` — Application-layer session API and persistence ports
- `src/adapters/` — Concrete adapter implementations (LLM clients, tool executors, storage backends)
- `src/interfaces/cli/` — CLI presentation layer
- `framework-design/` — Architecture design documents (detailed module-level specifications)
- `framework-design.md` — Design overview and index for all architecture documents
- `skills/` — Knowledge regions for reusable, actionable task guidance. See `skills/AGENT.md` for conventions.

## Key Design Documents

- `framework-design.md` — Start here for the full architecture overview
- `framework-design/knowledge-view.md` — Knowledge view design: how AGENT.md files organize workspace knowledge
- `framework-design/conversation-model.md` — Conversation ledger and projector design
- `framework-design/hierarchy-and-layers.md` — L0/L1/L2 layer model and parent-child coordination
- `framework-design/protocol-and-runtime.md` — Proposal-vote protocol and execution semantics
- `framework-design/state-machine-and-tools.md` — FSM states, transitions, and tool surface
- `framework-design/context-compression.md` — Memory snapshot and context compression

## Runtime

- Language: TypeScript
- LLM integration: pi-ai
- Tool schemas: @sinclair/typebox
- Persistence: embedded SQLite (`.elenchus/state.db`)
- Run: `ANTHROPIC_API_KEY=... npm start` (L0) or `ELENCHUS_LEVEL=L1 npm start` (L1)
