---
title: "Elenchus Framework Design - State Machine and Tools"
date: 2026-04-12
version: 3.2
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

A unit's reachable state space still depends on its tool set. For example, L0 never reaches `Executing`.

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

Additional notes:

- approved non-blocking proposals continue along normal turn rotation rather than entering `Executing`
- `yield` and `sleep` both trigger T8 but have different side effects
- `report` never triggers T8
- `yield` should be read as an upward handoff plus pause, not only as a completion signal
- `report` should be read as routine upward coordination at key moments, not as a minor exception path

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
- `unmountChild`
- `sleep`

### 5.3 Environment Tools

- `bash`
- `readFile`
- `writeFile`

## 6. Tool Availability by Layer

| 工具 | L0 | L1 | L2 |
| :------ | :---- | :---- | :----- |
| Vote | ✓（条件） | ✓（条件） | ✓（条件） |
| Yield | ✓ | ✓ | ✓ |
| Report | ✓ | ✓ | ✓ |
| CompressContext | ✓ | ✓ | ✓ |
| SpawnChild | ✓ | ✓ | ✗ |
| SendToChild | ✓（条件） | ✓（条件） | ✗ |
| UnmountChild | ✓（条件） | ✓（条件） | ✗ |
| Sleep | ✓ | ✓ | ✗ |
| Bash | ✗ | ✓ | ✓ |
| ReadFile | ✗ | ✓ | ✓ |
| WriteFile | ✗ | ✓ | ✓ |

Rules in summary:

- child-management tools belong to non-leaf layers
- environment tools belong to non-pure-coordination layers
- protocol tools belong to all layers
- some tools, such as `vote`, `sendToChild`, and `unmountChild`, are conditionally visible based on current state

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

### 7.4 `unmountChild`

- proposal-producing
- non-blocking
- available only when the parent currently has visible child units
- valid only for an `idle` child at runtime
- removes that child from the parent agent's visible context without terminating it or removing the program's parent-child affiliation
- if that child later emits a new `upward-message`, it automatically remounts into the parent's visible child set; the parent receives the new child report together with a light runtime broadcast noting the remount

## 8. Related Detailed Documents

- Communication and projection foundations: [conversation-model.md](./conversation-model.md)
- Compression model: [context-compression.md](./context-compression.md)
- Runtime action semantics: [protocol-and-runtime.md](./protocol-and-runtime.md)
- Layering and delegation semantics: [hierarchy-and-layers.md](./hierarchy-and-layers.md)

---

## Change Log

- **v3.2 (2026-04-12)**: Added `unmountChild` to the child-management tool surface. Documented it as a non-blocking visibility-management tool: it removes an `idle` child from the parent agent's visible context while preserving affiliation, and a later child `upward-message` automatically remounts the child with a light runtime broadcast.
- **v3.1 (2026-04-12)**: Updated tool-surface notes to reflect the semantic rewrite of `report` and `yield`. `yield` is now documented as a general upward handoff-and-pause move, including requests for more information, while `report` is documented as routine upward coordination at key moments rather than a special-case escalation path.
- **v3.0 (2026-04-12)**: Extracted from `framework-design.md` during the overview/module split. This file now holds the detailed FSM and tool-surface semantics while the overview remains the canonical entry point and index.
