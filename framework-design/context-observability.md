# Context Observability & Reconstruction Design

> **Status**: Draft — core model and decisions established; some decision points remain open.
> **Related**: context-compression.md, conversation-model.md, state-machine-and-tools.md

---

## 1. Design Principles

- **Immutability**: All records in `ledger_messages` and `context_text_history` are append-only. Reconstruction reads them as facts, never mutates them.
- **Recipe-based reconstruction**: A recipe directly references immutable fact records by ID or seq boundary. Reconstruction is independent of any upper-layer concept (turn, FSM state, etc.).
- **Dual-table model**: Context is reconstructed from exactly two append-only fact tables:
  - **`ledger_messages`** — continuous event stream; referenced by **seq range** (start → end)
  - **`context_text_history`** — discrete snapshots; referenced by **rowid** (individual records)
  - Both tables allow multiple versions of the same fact; reconstruction resolves to the latest version within the referenced scope.
- **Content deduplication**: Identical text content under the same `(unit_id, category)` is stored only once, keyed by content hash.
- **Single source of truth**: `context_text_history` replaces `unit_memory_state` as the sole storage for memory snapshots, AGENT.md content, and future text categories. No dual-write.
- **Debug fields are optional metadata**: Fields like `effective_turn` exist for human debugging only and must never participate in reconstruction logic.

---

## 2. Agent Context Anatomy

An agent's LLM input (`LlmContext`) consists of three parts: **system prompt**, **messages**, and **tool list**. Each part is assembled from raw data at a specific moment. The table below traces every context element back to its data source, write timing, and projection mechanism.

### 2.1 System Prompt

`buildSystemPrompt(agentId, level, workspaceRoot, workspaceKnowledge)` assembles:

| Component | Source | Write timing | Persistence | Projection |
|---|---|---|---|---|
| Shared Guideline | Static code | Compile time | Code version control | Direct inclusion |
| Layer Orientation | Static code + `level` param | Compile time + per-turn | Recipe records `level` | Direct inclusion |
| Knowledge View Guideline | Static template + `workspaceRoot` | Compile time + per-turn | Recipe records `workspaceRoot` implicitly via `agent_md_rowid` | Template substitution |
| Workspace Knowledge (AGENT.md) | Filesystem `AGENT.md` | Per-turn read | `context_text_history` (category: `agent_md`) | File read → dedup write → rowid reference |
| Cognitive Style | Static code + `agentId` param | Compile time + per-turn | Recipe records `agent_id` | Direct inclusion |

**Key insight**: The system prompt is mostly static code. The only dynamic element that needs historical persistence is AGENT.md content. The rest can be re-derived from recipe parameters (`agent_id`, `level`) and the current codebase. If the codebase changes between recording and reconstruction, the static parts will differ — this is an inherent limitation of code-as-data.

### 2.2 Messages

`buildTurnMessages(agentId, visibleMessages, newlyVisibleMessages, pendingProposal, childCommitViews)` assembles:

| Component | Source | Write timing | Fact table | Reference mode |
|---|---|---|---|---|
| Memory Snapshot | `CompressionTaskManager` | Compression task succeeds (async, between turns) | `context_text_history` | rowid (discrete) |
| Old recent-raw messages | `ConversationLedger` visible messages | Various (see §2.4) | `ledger_messages` | seq range |
| Newly-visible boundary overlay | Derived from `newlyVisibleMessages` | Per-turn, not persisted | — | Re-derived from `newly_visible_seq` in recipe |
| New recent-raw messages | `ConversationLedger` visible messages | Various (see §2.4) | `ledger_messages` | seq range |
| Compression reminder overlay | Derived from `shouldShowReminder()` | Per-turn, not persisted | — | Re-derived from recipe params + ledger state |
| Child commit view | Child units' `committedSteps` | Per-turn, **written to ledger** | `ledger_messages` | seq range |
| Proposal notification | Derived from `PendingProposal` | Per-turn, not persisted | — | Re-derived from `has_pending_from_other` + ledger |

**Message classification** (DECIDED):

- **Fact events** — describe world state the agent perceived. Persisted in `ledger_messages`. Includes: all conversation message kinds + child commit view (new).
- **Rendering directives** — describe how to interpret messages. Not persisted; re-derived during reconstruction from recipe parameters + projector logic. Includes: boundary overlay, compression reminder, proposal notification.

### 2.3 Tool List

`getBuiltInToolList(hasPendingFromOther, level, hasChildren, canSpawnChild)` assembles:

| Parameter | Source | Write timing | Persistence |
|---|---|---|---|
| `level` | Unit configuration | Unit creation | Recipe |
| `hasPendingFromOther` | `ConversationLedger.getPendingProposalView()` | Per-turn | Recipe |
| `hasChildren` | `DeliberationUnit.children` | Per-turn | Recipe |
| `canSpawnChild` | `children.size < MAX_CHILDREN` | Per-turn | Recipe |

Tool list is fully deterministic from recipe parameters. No additional persistence needed.

### 2.4 Ledger Message Write Timing

Every message kind in `ledger_messages` is written at a different moment:

| Message kind | When written | Trigger |
|---|---|---|
| `incoming_message` | External event | User input / parent sendToChild |
| `agent_message` | After LLM response | Agent produces text reply |
| `proposal_message` | After LLM response | Agent proposes a tool call |
| `vote_message` | After LLM response | Agent votes on pending proposal |
| `tool_result_message` | After tool execution | Blocking tool completes |
| `upward_message` | After proposal approval | Agent uses yield/report |
| `child_report_message` | External event | Child unit emits report/yield |
| `system_message` | Various runtime events | Compression start/success/failure, malformed calls, etc. |
| `child_commit_view` (NEW) | Turn start | Building context for current turn |

All are append-only. `proposal_message` and `vote_message` support version increments (same `message_id`, new `version`) for status updates.

---

## 3. Projection: From Raw Data to Context

The projection pipeline transforms raw persisted facts into an `LlmContext`. This is the same pipeline used at runtime and during reconstruction — the design goal is that reconstruction simply replays the pipeline with recipe-scoped inputs.

### 3.1 Runtime Projection (current)

```
DeliberationUnit.runLoop()
  ├─ ledger.readVisibleSnapshotForAgent(agentId, turnCounter)
  │    → visibleMessages[], newlyVisibleMessages[]
  ├─ compressionManager.getMemorySnapshot() → snapshot | null
  ├─ compressionManager.getRecentRawMessages(visible) → recentRaw[]
  ├─ buildChildCommitViews() → childCommitViews[]
  ├─ getPendingProposal() → pendingProposal | null
  │
  ├─ buildTurnMessages(agentId, visible, newlyVisible, pending, childViews)
  │    ├─ IF snapshot: projector.buildMemorySnapshotMessage(snapshot)
  │    ├─ projector.projectVisibleMessages(oldRecentRaw)
  │    ├─ IF newlyVisible: projector.buildNewlyVisibleBoundaryOverlay() + projectVisibleMessages(newRecentRaw)
  │    ├─ IF shouldShowReminder: projector.buildCompressionReminderOverlay()
  │    ├─ IF childViews: projector.buildChildCommitViewMessage()
  │    └─ IF pendingFromOther: projector.buildProposalNotification()
  │
  ├─ agentTurn.execute(messages, hasPending, hasChildren, canSpawn)
  │    ├─ readRootAgentMd(workspaceRoot) → workspaceKnowledge
  │    ├─ buildSystemPrompt(agentId, level, workspaceRoot, workspaceKnowledge)
  │    └─ getBuiltInToolList(hasPending, level, hasChildren, canSpawn)
  └─ LLM call → TurnResult
```

### 3.2 Reconstruction Projection (target)

```
ContextBuilder.reconstruct(recipeId)
  ├─ Load recipe by recipe_id
  ├─ Load ledger_messages by (unit_id, seq range: recent_raw_start_seq → visible_end_seq)
  │    — resolve each message_id to its latest version within range
  ├─ Load context_text_history by rowid (memory_snapshot_rowid, agent_md_rowid)
  │
  ├─ System prompt:
  │    ├─ Re-derive static parts from (agent_id, level, workspaceRoot) + current code
  │    └─ Inject AGENT.md content from context_text_history row
  │
  ├─ Messages:
  │    ├─ IF memory_snapshot_rowid: projector.buildMemorySnapshotMessage(snapshot from row)
  │    ├─ Split ledger messages at newly_visible_seq
  │    ├─ projector.projectVisibleMessages(old portion)
  │    ├─ IF newly_visible_seq: boundary overlay + projector.projectVisibleMessages(new portion)
  │    ├─ Re-derive compression reminder from recipe params + ledger state
  │    └─ (child commit view and proposal notification are already in ledger messages)
  │
  └─ Tool list: getBuiltInToolList(from recipe params)
```

**Key difference from runtime**: Reconstruction does not query live `CompressionTaskManager` or child units. It reads frozen facts from the two tables, scoped by the recipe. Rendering directives are re-derived from recipe parameters rather than live state.

---

## 4. Decisions Made

### 4.1 Overlay classification

See §2.2 — fact events are persisted in ledger; rendering directives are re-derived during reconstruction.

### 4.2 Child commit view → ledger_messages

Child commit view is written into the parent unit's `ledger_messages` as a fact event at turn start. This eliminates cross-unit references in the recipe and makes the seq range sufficient to capture all message content.

### 4.3 Proposal status versioning

Within a seq range, reconstruction takes the latest version of each message. `proposedStep`, `args`, `toolName` are immutable across versions. The `status` label may differ from what the agent saw, but the vote message that changed the status is also within the seq range, providing the actual decision context. No time-cutoff mechanism is needed.

### 4.4 AGENT.md dedup

AGENT.md content is read every turn but only written to `context_text_history` when the content hash differs from the latest stored row. If the file is unchanged, the recipe references the existing rowid.

---

## 5. Decision Points (Open)

### 5.1 Recipe creation timing

Recipe is created when `buildTurnMessages` is called (before LLM invocation). If the LLM call fails, the recipe exists but `output_message_id` is null. Is this acceptable, or should recipe creation be deferred until after a successful response?

### 5.2 `output_message_id` update atomicity

The recipe's `output_message_id` is set after the LLM returns — a two-step write (INSERT recipe, then UPDATE output_message_id). Should this be wrapped in a transaction with the message append, or is eventual consistency acceptable?

### 5.3 `unit_compression_state` relationship

`unit_compression_state` stores runtime compression task state (active task, retry counts, thresholds). Its text-related fields are now in `context_text_history`. Should `unit_compression_state` continue to exist independently, or should its non-text fields be folded into another table?

### 5.4 System prompt reconstruction fidelity

The system prompt's static parts (guideline, layer orientation, cognitive style) are derived from code. If the codebase changes between recording and reconstruction, the reconstructed system prompt will differ from the original. Should the complete system prompt text also be stored in `context_text_history` for full fidelity, or is re-derivation from code acceptable?

### 5.5 Compression task LLM context

Compression tasks make a separate LLM call with their own context (compression system prompt + source messages + existing snapshot). Should this also have a recipe for observability, or is it out of scope for the initial design?

---

## 6. Database Schema

### 6.1 `context_text_history` (NEW)

Append-only table for immutable text snapshots. Referenced by **rowid** (discrete point).

```sql
CREATE TABLE context_text_history (
  rowid INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id TEXT NOT NULL,
  category TEXT NOT NULL,              -- 'memory_snapshot' | 'agent_md' | ...
  content_hash TEXT NOT NULL,           -- SHA-256 hex, dedup key
  content TEXT NOT NULL,                -- immutable text content
  metadata TEXT NOT NULL DEFAULT '{}',  -- JSON: per-category structured fields
  effective_turn INTEGER,              -- debug only
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_ctx_text_dedup
  ON context_text_history(unit_id, category, content_hash);

CREATE INDEX idx_ctx_text_unit_category_id
  ON context_text_history(unit_id, category, rowid DESC);
```

**Category metadata**:

| category | metadata fields | Purpose |
|---|---|---|
| `memory_snapshot` | `sourceMessageCount`, `requirements`, `recentRawStartSeq` | `recentRawStartSeq` defines the recent-raw window boundary |
| `agent_md` | `path` | File path for traceability |

### 6.2 `context_recipe` (NEW)

Records the immutable facts needed to reconstruct one LLM call's input. References `ledger_messages` by **seq range** and `context_text_history` by **rowid**.

```sql
CREATE TABLE context_recipe (
  recipe_id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,

  -- Message stream boundary (range reference into ledger_messages)
  recent_raw_start_seq INTEGER NOT NULL,
  visible_end_seq INTEGER NOT NULL,
  newly_visible_seq INTEGER,           -- null = no boundary overlay

  -- Snapshot references (discrete reference into context_text_history)
  memory_snapshot_rowid INTEGER,       -- null = no snapshot
  agent_md_rowid INTEGER,              -- null = no AGENT.md

  -- Tool list parameters (frozen at recipe creation time)
  level TEXT NOT NULL,
  has_pending_from_other INTEGER NOT NULL DEFAULT 0,
  has_children INTEGER NOT NULL DEFAULT 0,
  can_spawn_child INTEGER NOT NULL DEFAULT 0,

  -- Output correlation (set after LLM response)
  output_message_id TEXT,              -- null = call failed

  -- Debug
  effective_turn INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_recipe_output_message
  ON context_recipe(output_message_id)
  WHERE output_message_id IS NOT NULL;
```

### 6.3 `ledger_messages` (EXISTING, behavior change)

Child commit view is now written as a fact event message at turn start. The seq range in the recipe naturally covers it — no cross-unit reference needed.

### 6.4 `unit_memory_state` (REMOVED)

Replaced by `context_text_history`. Current memory state is the latest row with `category = 'memory_snapshot'` for the unit.

### 6.5 `unit_compression_state` (PRESERVED, decision pending)

Stores runtime compression task state. Text-related fields now in `context_text_history`. See §5.3.

### 6.6 Schema version

`CURRENT_SCHEMA_VERSION` → `11` (from `10`).
