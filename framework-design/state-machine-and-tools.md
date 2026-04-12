---
title: "Elenchus Framework Design - State Machine and Tools"
date: 2026-04-12
version: 3.0
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
| Sleep | ✓ | ✓ | ✗ |
| Bash | ✗ | ✓ | ✓ |
| ReadFile | ✗ | ✓ | ✓ |
| WriteFile | ✗ | ✓ | ✓ |

Rules in summary:

- child-management tools belong to non-leaf layers
- environment tools belong to non-pure-coordination layers
- protocol tools belong to all layers
- some tools, such as `vote` and `sendToChild`, are conditionally visible based on current state

## 7. Tool-Surface Notes

### 7.1 `yield`

- proposal-producing
- writes `upward_message(deliveryMode = "yield")`
- emits `upward-message`
- pauses the unit into `Idle`

### 7.2 `report`

- proposal-producing
- writes `upward_message(deliveryMode = "report")`
- emits `upward-message`
- continues the turn loop

### 7.3 `sleep`

- proposal-producing
- pauses without upward messaging
- requires explicit `timeoutMs`

### 7.4 `compressContext`

- proposal-producing
- starts an asynchronous compression task
- carries preservation requirements rather than a finished summary

## 8. Related Detailed Documents

- Communication and projection foundations: [conversation-model.md](./conversation-model.md)
- Compression model: [context-compression.md](./context-compression.md)
- Runtime action semantics: [protocol-and-runtime.md](./protocol-and-runtime.md)
- Layering and delegation semantics: [hierarchy-and-layers.md](./hierarchy-and-layers.md)

---

## Change Log

- **v3.0 (2026-04-12)**: Extracted from `framework-design.md` during the overview/module split. This file now holds the detailed FSM and tool-surface semantics while the overview remains the canonical entry point and index.
