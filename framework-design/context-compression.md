---
title: "Elenchus Framework Design - Context Compression"
date: 2026-05-05
version: 3.2
---

# Context Compression

> **Synchronization note**
> - This document expands the compression summary in [../framework-design.md](../framework-design.md).
> - If the compression view, reminder semantics, task contract, or manager lifecycle changes here, also review the corresponding overview summary, principle index, and glossary in `framework-design.md`.
> - If `framework-design.md` changes the high-level description of compression, verify whether this file must also be updated.

## Scope

This document defines the framework's unit-level context compression model, including:

- `Memory Snapshot + Recent Raw Window`
- the injection contract for compressed context
- context-pressure reminder overlays
- the semantic boundary of `compressContext`
- `CompressionTaskManager`

It assumes the fact/view split defined in [conversation-model.md](./conversation-model.md).

## Relevant Overview Sections

- `framework-design.md` / Chapter 2 summary
- `framework-design.md` / Chapter 3 summary
- `framework-design.md` / Principles index: P17, P18, P19, P20, P21, P22, P23, P24, P25

---

## 1. Compression Belongs to the Projection Layer

Compression should not mutate or degrade the unit's canonical shared history.

The framework preserves `ConversationLedger` as the fact layer and performs compression only as a derived agent-facing view.

> **原则 P17（压缩属于投影层派生视图）**：上下文压缩只能生成ConversationLedger之上的派生视图，不能改写、截断或污染ConversationLedger中的公共事实历史。

This preserves two invariants:

- the shared historical record stays lossless at the fact layer
- compression can evolve without redefining historical truth

## 2. Dual-Layer Context View

When raw visible history grows too large, the projected context should be split into two complementary parts:

- **Memory Snapshot**
- **Recent Raw Window**

> **原则 P18（双层上下文视图）**：当启用unit级聊天上下文压缩时，agent的上下文应由Memory Snapshot与Recent Raw Window共同构成；前者提供高层任务状态，后者提供近期原始连续性。

The two layers may overlap in coverage. This is intentional.

The goal is not to produce mutually exclusive slices of history. The goal is to combine:

- high-level task-state continuity
- recent local evidence and wording fidelity

## 3. Memory Snapshot: Weakly Structured Natural Language State

`Memory Snapshot` should remain a natural-language task-state description, not a rigid schema.

It should primarily capture:

- the current task state
- stable judgments or emerging conclusions
- unresolved issues and disagreements
- constraints and open risks
- uncertainty and confidence levels

> **原则 P19（弱结构化自然语言快照）**：Memory Snapshot必须保持自然语言文本形态，可呈现弱结构化关注面，但不得被要求满足严格schema；其内容应以任务状态为主轴、议题与分歧为辅轴，并显式保留不确定性与置信程度。

A snapshot is therefore **not**:

- a verbatim transcript
- a rigid object with mandatory fields
- a definitive resolution of all disagreements

It is a working task-state memory written for future continuation.

## 4. Recent Raw Window

`Recent Raw Window` preserves local continuity and recency.

It is used to keep:

- recent updates
- exact wording where nuance matters
- local evidence that should remain uncompressed for the next turns

This raw window may repeat material that also influenced the snapshot. Such overlap is acceptable and often desirable.

## 5. Injection Contract: Informational, Not Procedural

The framework should explain the relationship between `Memory Snapshot` and `Recent Raw Window`, but it should avoid over-specifying how the model must mechanically resolve every tension.

The injection contract should communicate:

- the snapshot is a compressed reference view derived from earlier history
- the recent raw window preserves the latest uncompressed context
- overlap between the two is expected rather than erroneous

It should not turn into a rigid conflict-resolution algorithm.

> **原则 P20（注入契约的信息性优先）**：关于Memory Snapshot与Recent Raw Window的prompt契约应主要说明其来源、性质与互补关系，而不应把agent对两者的解释过程过度程序化。

## 6. Context Reminder Overlay

Compression should not be triggered only when the agent subjectively feels overloaded. The runtime should expose a soft reminder when recent raw context has grown large enough that refreshing the snapshot becomes worth considering.

The reminder must remain:

- **soft** rather than mandatory
- **persistent while pressure remains high**
- **hidden while a compression task is already active**

> **原则 P22（压缩提醒是柔性的状态提示）**：当Recent Raw Window的粗略长度超过预警阈值时，投影层应向两个agent提供一条柔性压缩提醒 overlay；该提醒表示上下文压力已升高并值得考虑压缩，但不构成必须立即行动的命令。

> **原则 P23（压缩提醒受活动任务抑制）**：压缩提醒 overlay 是一种派生状态提示，而不是一次性事件通知；只要上下文仍超阈值且没有活动中的压缩任务，它就应持续可见。若已有压缩任务正在运行，则该提醒应暂时隐藏。

The reminder therefore behaves more like a derived state indicator than a one-off event.

## 6.1 Budget-Driven Recent-Raw Truncation

Compression is not the only projection-layer response to context pressure. A turn may need a lighter-weight fallback before or after a provider rejects an oversized request.

The framework therefore allows deterministic **recent-raw truncation** as a projection-layer budget control:

- it may tighten the `Recent Raw Window` boundary for the current turn
- it must never mutate or rewrite `ConversationLedger`
- it must preserve the higher-priority context layers first: Memory Snapshot, newly visible messages, and current-turn control overlays
- it should trim the **oldest** portion of recent raw context first

This yields another boundary rule:

> **补充约束**：budget-driven truncation 只允许收紧当前 turn 的 `Recent Raw Window` 起点，不得改写 ledger 历史，也不得把 newly visible 区域误判为可优先裁掉的旧上下文。

## 7. `compressContext` Tool Semantics

The framework should not make the dual-agent unit write summaries directly as proposals. The proposal should stay semantically narrow.

`compressContext` means:

- propose starting an asynchronous compression task
- specify what the new snapshot should especially preserve
- optionally explain why now, if that matters

It does **not** mean:

- write the final summary inline
- fully configure the compression pipeline
- prescribe the compressor's full output structure

> **原则 P21（压缩任务工具的语义收敛）**：上下文压缩任务工具只负责表达“本次压缩应优先保留什么”，而不负责预写摘要内容、配置完整压缩策略或规定输出结构。

This keeps the deliberation unit focused on preservation priorities, while a separate fixed compression prompt defines the stable behavior of the compressor.

## 8. CompressionTaskManager

To support this model safely, each Agent Unit should own a dedicated `CompressionTaskManager`.

Its job is **not** to decide what the snapshot should contain. Its job is lifecycle management.

The manager should:

- track whether a compression task is currently active
- suppress duplicate launches
- provide the reminder visibility condition
- handle limited simple retries
- clear active state on terminal failure and hand control back to deliberation

### 8.1 Single Active Task Rule

At most one active compression task may exist per unit at a time.

> **原则 P24（单unit单活动压缩任务）**：在同一个Agent Unit内，任意时刻至多只允许存在一个活动中的压缩任务；任何重复启动请求都必须在执行层被拦截并视为错误。

### 8.2 Retry Boundary

The manager may perform limited and simple retry logic, but it should not hide repeated failures behind an opaque infinite loop.

If retries still fail:

- emit a public runtime fact into `ConversationLedger`
- clear the active-task state
- let the agents decide what to do next

> **原则 P25（有限重试后回到deliberation）**：压缩任务的简单重试逻辑由CompressionTaskManager拥有；若重试后仍失败，错误必须作为公共事实广播写入ConversationLedger，同时manager回到“无活动压缩任务”状态，让agent重新接管后续处理。

An important consequence follows: once failure clears the active task, the reminder overlay may become visible again if context pressure still exceeds the threshold.

## 9. Relationship to Runtime Events

Compression is initiated through proposal-vote like other proposal-producing tools, but its execution is asynchronous. Runtime events related to start, failure, and completion should still surface as shared facts rather than private acknowledgements.

See [protocol-and-runtime.md](./protocol-and-runtime.md) for the general runtime treatment of non-blocking actions and public fact broadcasts.

## 10. Future Boundary: Knowledge Anti-Entropy

This document remains intentionally narrow. It defines compression of **conversation context projection** for one agent unit, not full lifecycle governance of the broader future knowledge space.

The framework is now separately recognizing a future **knowledge anti-entropy** problem, which may eventually include topics such as:

- knowledge growth and bloat
- drift, decay, and stale knowledge cleanup
- conflict consolidation and correction
- maintenance of the small `Resident Knowledge` surface

Those questions are important, but they are **not** solved by the current `Memory Snapshot + Recent Raw Window` design alone.

At the current stage:

- this document only commits to compression of agent-visible conversation context derived from `ConversationLedger`
- it does **not** define the future anti-entropy workflow for the larger knowledge space
- it does **not** assume that future anti-entropy will necessarily be implemented only through the file system, even if the broader direction remains file-system-friendly

## 11. Related Detailed Documents

- Communication and projection foundations: [conversation-model.md](./conversation-model.md)
- General runtime execution semantics: [protocol-and-runtime.md](./protocol-and-runtime.md)
- Layering and parent/child coordination: [hierarchy-and-layers.md](./hierarchy-and-layers.md)
- FSM and tool availability: [state-machine-and-tools.md](./state-machine-and-tools.md)

---

## Change Log

- **v3.2 (2026-05-05)**: Added budget-driven recent-raw truncation as a projection-layer fallback for token pressure. Clarified that truncation only tightens the current turn's recent-raw boundary and must preserve ledger truth and higher-priority context layers.
- **v3.0 (2026-04-12)**: Extracted from `framework-design.md` during the overview/module split. This file now holds the detailed compression view and task-management semantics while the overview remains the canonical entry point and index.
- **v3.1 (2026-04-13)**: Added a future-boundary section clarifying that broader knowledge anti-entropy work is deferred beyond the current conversation-context compression scope.
