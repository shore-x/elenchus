---
title: "Elenchus Framework Design - State Machine and Tools"
date: 2026-04-13
version: 7.0
---

# State Machine and Tools

> **Synchronization note**
> - This document expands the FSM and tool-surface summary in [../framework-design.md](../framework-design.md).
> - If states, transitions, turn parsing constraints, or tool availability change here, also review the overview summary, principle index, glossary, and tool summary in `framework-design.md`.
> - If `framework-design.md` changes the high-level execution model, confirm whether this file must also be updated.

## Scope

This document specifies:

- the minimal state distinctions
- the five-state FSM
- transition rules
- turn-internal output protocol
- tool availability by category and layer

It complements the runtime semantics in [protocol-and-runtime.md](./protocol-and-runtime.md).

## Relevant Overview Sections

- `framework-design.md` / Chapter 5 summary
- `framework-design.md` / Principles index: P5

---

## 1. Minimal State Distinction

The framework should only distinguish states when their behavior is genuinely different.

> **原则 P5（最小状态区分）**：状态仅在行为存在本质差异时才区分。行为相同的场景合并，行为不同的场景必须拆分。

This leads to the current five-state model.

## 2. Five-State FSM

| 状态 | 含义 |
| :------ | :------ |
| **Idle** | Waiting for a trigger message; persisted context can later wake the unit |
| **TurnA** | Agent A's turn |
| **TurnB** | Agent B's turn |
| **Executing** | Blocking wait for a blocking environment action |
| **Terminated** | Irrecoverable terminal state after forced parent termination |

A unit's reachable state space depends on its tool usage. L0 can now reach `Executing` when using environment tools for permitted purposes (information acquisition and knowledge space maintenance).

## 3. Transition Rules

| # | 源状态 | 条件 | 目标状态 |
| :--- | :-------- | :------ | :---------- |
| T1 | Idle | Trigger message arrives | TurnA |
| T2 | TurnA | A finishes turn without approving a blocking proposal | TurnB |
| T3 | TurnA | A approves B's blocking proposal | Executing |
| T4 | TurnB | B finishes turn without approving a blocking proposal | TurnA |
| T5 | TurnB | B approves A's blocking proposal | Executing |
| T6 | Executing | Result returns after entering from TurnA | TurnB |
| T7 | Executing | Result returns after entering from TurnB | TurnA |
| T8 | TurnA/TurnB | Approved `yield` or `sleep` | Idle |
| T9 | non-Terminated | Parent forces termination | Terminated |
| T10 | TurnA/TurnB/Executing | LLM call or blocking tool execution times out | Idle |

Additional notes:

- approved non-blocking proposals continue along normal turn rotation rather than entering `Executing`
- `yield` and `sleep` both trigger T8 but have different side effects
- `report` never triggers T8
- `yield` should be read as an upward handoff plus pause, not only as a completion signal
- `report` should be read as routine upward coordination at key moments, not as a minor exception path
- T10 is a system-initiated safety transition: the runtime aborts the pending operation and yields upward on behalf of the unit, so the parent can decide whether to re-trigger

## 4. Turn-Internal Output Protocol

Each agent turn is parsed into up to three conceptual parts:

1. **Reply**: required text reply
2. **Vote**: conditional, only when a partner proposal is pending and the vote tool is available
3. **New proposal**: optional, at most one non-vote tool call

Key constraints:

- at most one pending proposal at a time
- a new proposal supersedes that agent's earlier unvoted proposal
- `vote` is conditionally injected and is the only non-proposal tool call
- rejected proposals become invalid; they must be re-proposed later if still desired

## 5. Tool Categories

The tool surface is intentionally simple.

### 5.1 Protocol Tools

- `vote`
- `yield`
- `report`
- `compressContext`

### 5.2 Child-Management Tools

- `spawnChild`
- `sendToChild`
- `sleep`

### 5.3 Environment Tools

- `bash`
- `readFile` (auto-approved, P30)
- `writeFile`

(`installSkill` was removed in v1.2 of the knowledge-view redesign; skill installation is no longer a separate tool.)

## 6. Tool Availability by Layer

| 工具 | L0 | L1 | L2 |
| :------ | :---- | :---- | :----- |
| Vote | ✓（条件） | ✓（条件） | ✓（条件） |
| Yield | ✓ | ✓ | ✓ |
| Report | ✓ | ✓ | ✓ |
| CompressContext | ✓ | ✓ | ✓ |
| SpawnChild | ✓ | ✓ | ✗ |
| SendToChild | ✓（条件） | ✓（条件） | ✗ |
| Sleep | ✓ | ✓ | ✗ |
| Bash | ✓（角色策略约束） | ✓ | ✓ |
| ReadFile | ✓（角色策略约束, auto-approved） | ✓（auto-approved） | ✓（auto-approved） |
| WriteFile | ✓（角色策略约束） | ✓ | ✓ |

Rules in summary:

- child-management tools belong to non-leaf layers
- environment tools belong to **all layers** (L0 usage constrained by role policy P28 to information acquisition and knowledge space maintenance)
- protocol tools belong to all layers
- some tools, such as `vote` and `sendToChild`, are conditionally visible based on current state
- L0's environment tool usage is further constrained by the **layer role policy** (P28): the partner agent (Verifier) is guided in the prompt to reject tool uses that exceed L0's role scope

## 7. Tool-Surface Notes

### 7.1 `yield`

- proposal-producing
- writes `upward_message(deliveryMode = "yield")`
- emits `upward-message`
- pauses the unit into `Idle`
- appropriate whenever the unit should hand initiative upward and wait, including stage completion, information gaps, and requests for upper-layer judgment

### 7.2 `report`

- proposal-producing
- writes `upward_message(deliveryMode = "report")`
- emits `upward-message`
- continues the turn loop
- appropriate for key decision points, material findings, risks, and other coordination moments when upper-layer visibility matters but local progress can still continue

### 7.3 `sleep`

- proposal-producing
- pauses without upward messaging
- requires explicit `timeoutMs`
- reserved for pure waiting rather than upward coordination

### 7.4 L0 Environment Tool Role Policy

L0 now has access to `bash`, `readFile`, and `writeFile`, but with a **role policy constraint** (P28):

- **Permitted uses**: information acquisition (reading files, listing directories, searching content) and knowledge space maintenance (writing/updating .md files in its own workspace)
- **Prohibited uses**: directly executing tasks that should be delegated to child units
- **Self-awareness prompt**: if L0 finds itself using tools to directly solve a problem rather than delegating it, it should stop and create a child agent instead
- **Partner enforcement**: the Verifier agent is guided in the prompt to reject tool uses that exceed L0's role scope (note: `readFile` is auto-approved per P30, so partner enforcement for readFile relies on prompt guidance rather than vote rejection)
- This is a **soft constraint** enforced through prompt policy and proposal-vote, not a hard code-level restriction

### 7.5 readFile Auto-Approval (P30)

`readFile` is marked `autoApprove` on the `ElenchusTool` definition. When an agent proposes a `readFile` call:

1. The proposal is recorded in `ConversationLedger` as usual
2. Runtime immediately marks it approved and writes a system message
3. The tool executes as a normal blocking tool (enters `Executing`)
4. The result is written back as a public fact
5. Turn alternation continues normally

No partner vote is required. The partner sees the full execution chain in the next turn.

`readFile` also supports line-range reading via optional `offset` (1-indexed start line) and `limit` (max line count) parameters. This allows agents to read only the relevant section of large files, reducing context consumption.

### 7.6 Turn-Level Timeout Guard (T10)

The runtime guards each asynchronous wait point in the turn loop with a configurable timeout. If the operation does not complete within the timeout, the runtime:

1. **Aborts** the pending operation via `AbortSignal`
2. **Writes a system message** to the ledger describing the timeout
3. **Emits a system-initiated yield** (`upward_message(deliveryMode = "yield")`) with a timeout report, so the parent unit receives the same signal as an agent-initiated yield
4. **Transitions to Idle** via T10

The parent unit then decides whether to re-trigger the child (e.g., by sending a new message) or to ignore it.

Two timeout thresholds exist:

| Wait point | Default | Rationale |
| :--- | :--- | :--- |
| LLM call | 180 s | Normal responses arrive in 5–60 s; 180 s covers extended thinking |
| Blocking tool execution | 300 s | Bash and similar tools may legitimately run long |

Both values are configurable via `DeliberationUnitOptions` and default to the static constants on `DeliberationUnit`.

The `LlmClient.complete` port accepts an optional `AbortSignal` so the underlying HTTP request can be cancelled on timeout.

## 8. Related Detailed Documents

- Communication and projection foundations: [conversation-model.md](./conversation-model.md)
- Compression model: [context-compression.md](./context-compression.md)
- Runtime action semantics: [protocol-and-runtime.md](./protocol-and-runtime.md)
- Layering and delegation semantics: [hierarchy-and-layers.md](./hierarchy-and-layers.md)

---

## Change Log

- **v7.0 (2026-05-06)**: Add T10 (turn-level timeout guard). When an LLM call or blocking tool execution exceeds its timeout threshold, the runtime aborts the operation, writes a system message, emits a system-initiated yield, and transitions to Idle. `LlmClient.complete` now accepts an optional `AbortSignal`. Two configurable timeout thresholds: LLM call (180 s default) and blocking tool (300 s default). Added §7.6.
- **v6.0 (2026-04-19)**: Add P30 (pure read operations may bypass voting). `readFile` is now auto-approved and marked in §5.3, §6 table, and §7.5. L0 role policy (§7.4) updated to note that readFile enforcement relies on prompt guidance rather than vote rejection. `readFile` gains `offset`/`limit` parameters for line-range reading.
- **v5.0 (2026-04-18)**: Remove `unmountChild` from child-management tools. Child lifecycle now uses fixed slot pool model — all children always visible, no unmount/remount. Updated §5.2, §6 availability table, §7 tool-surface notes, changelog.
- **v4.0 (2026-04-16)**: L0 gains environment tools (bash, readFile, writeFile) with role policy constraint (P28). Tool availability table updated: L0 environment tools marked with role policy constraint. L0 can now reach `Executing` state. Removed `installSkill` from tool list (already removed in code, doc now catches up). Added §7.5 L0 Environment Tool Role Policy. Updated rules summary to reflect all-layer environment tool availability.
- **v3.3 (2026-04-13)**: Added the built-in blocking environment tool `installSkill` to the detailed tool surface. Documented it as an L1/L2-only hot-install mechanism for valid local skill-package directories, with next-turn capability visibility after successful installation.
- **v3.2 (2026-04-12)**: Added `unmountChild` to the child-management tool surface. [Superseded by v5.0]
- **v3.1 (2026-04-12)**: Updated tool-surface notes to reflect the semantic rewrite of `report` and `yield`. `yield` is now documented as a general upward handoff-and-pause move, including requests for more information, while `report` is documented as routine upward coordination at key moments rather than a special-case escalation path.
- **v3.0 (2026-04-12)**: Extracted from `framework-design.md` during the overview/module split. This file now holds the detailed FSM and tool-surface semantics while the overview remains the canonical entry point and index.
