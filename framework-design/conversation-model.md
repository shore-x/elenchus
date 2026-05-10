---
title: "Elenchus Framework Design - Conversation Model"
date: 2026-05-05
version: 3.5
---

# Conversation Model

> **Synchronization note**
> - This document expands the communication and projection summary in [../framework-design.md](../framework-design.md).
> - If message semantics, naming, visibility rules, or projection boundaries change here, also review the overview summary, principle index, and glossary in `framework-design.md`.
> - If `framework-design.md` changes the high-level description of communication or context construction, verify whether this file must be updated for consistency.

## Scope

This document is the detailed design for the framework's conversation model. It focuses on:

- Message payload vs. message envelope
- Unit-level structured history in `ConversationLedger`
- Turn visibility boundaries
- `ConversationProjector` and `ContextAssembler` as the agent-visible view layer
- Public fact broadcasts vs. private directive overlays
- Direction naming (`incoming` / `upward`)

It intentionally does **not** define context compression details. Compression is specified in [context-compression.md](./context-compression.md).

## Relevant Overview Sections

- `framework-design.md` / Chapter 2 summary
- `framework-design.md` / Principles index: P1, P4, P7, P11, P12, P14, P15, P16, P26, P29
- `framework-design.md` / Glossary entries for `ConversationLedger`, `ConversationProjector`, `Incoming Message`, `Upward Message`

---

## 1. Communication Payload vs. Structured Record

Agent-to-agent communication should preserve the expressive power of natural language, but the runtime cannot store history as a loose list of raw strings.

The framework therefore separates:

- **Payload**: the natural-language content carried by a message
- **Envelope**: the structured record that gives that content identity, role, lifecycle, and turn visibility semantics

This yields the core communication boundary:

> **原则 P7（通信载荷非结构化，记录封套结构化）**：Agent间传递的内容载荷保持非结构化文本；框架在unit级记录层必须使用结构化消息封套保存对话事实，以支持轮次控制、状态更新、投影与后续压缩。

The important consequence is that the framework should not force agent meaning into rigid schemas too early, but it must still preserve enough structure to support runtime correctness.

### 1.1 Message Channel Conversational Style (P29)

P7 states that message payloads remain unstructured text, but this does not mean the *style* of that text is unconstrained. The dual-channel architecture (P27) assigns fundamentally different roles to the message channel and the knowledge channel:

- **Message channel**: coordination, reasoning, alignment — ephemeral, push-based, context-budget-constrained.
- **Knowledge channel** (.md files): structured conclusions, detailed analysis, step-by-step procedures — persistent, pull-based, on-demand.

When agents write document-style Markdown in messages (headings, numbered lists, code blocks, tables, horizontal rules), they effectively use the narrow message channel to carry content that belongs in the knowledge channel. This wastes context budget on formatting tokens, creates a false sense of durable structure in an ephemeral medium, and blurs the boundary between the two channels.

The correct separation is:

- Messages should use **natural conversational language** — plain sentences, as in spoken dialogue between collaborators.
- Lightweight inline formatting that aids precision is acceptable: backticks for file paths, command names, and code identifiers; occasional bold for emphasis.
- Structured or detailed output should be written to a `.md` file and referenced by path in the message, so that consumers can read it on demand via the knowledge channel.

> **原则 P29（消息通道对话风格）**：消息通道载荷应保持自然对话语言风格，而非文档式 Markdown。结构化结论、详细分析、步骤化产出等应写入 .md 文件并通过知识通道共享；消息中仅引用文件路径。这确保消息通道专注于协调与推理，不越界承载知识通道的职责。

P29 is a refinement of P7 (payload unstructured) in the specific dimension of *writing style*, and a direct consequence of P27 (dual-channel communication). It does not contradict P7 — the payload remains unstructured text, but that text should be conversational rather than document-formatted.

## 2. Unified Message Model

An Agent Unit receives information from multiple origins:

- upper-layer input
- partner dialogue
- tool execution results
- child upward reports
- runtime broadcasts

These should not become unrelated channels from the agent's perspective. Internally, they are all facts recorded in one unit-level structure.

> **原则 P1（统一消息模型）**：所有对Agent Unit可见的事实在内部都是同一类对象（Message），统一写入ConversationLedger。每轮开始时，应基于ConversationLedger为当前agent重新投影该turn的完整可见快照；其中本轮newly visible的部分由overlay显式标出。

This also means that top-layer human input is not a privileged special mechanism. For L0, human input is conceptually just input from `L-1`.

## 3. ConversationLedger: Unit-Level Fact Ledger

`ConversationLedger` is not merely a delivery bus. It is the unit's structured fact ledger.

It must support at least the following responsibilities:

- **Fact recording**: preserve the structured shared history of the unit
- **Turn-based delivery**: support next-turn visibility semantics without reducing itself to a queue abstraction
- **Controlled updates**: allow lifecycle-sensitive records, especially proposals, to change state under domain rules
- **Persistence readiness**: keep a model that can later be serialized, reloaded, or rebuilt

The ledger stores **facts**, not the final agent-visible rendering. Rendering belongs to the projection layer.

In the current implementation, ledger-backed session recovery is rooted in the run-directory-local SQLite database `.elenchus/state.db`. Cold-start recovery may rebuild the next working context from persisted `Memory Snapshot + Recent Raw Window` without eagerly rehydrating every historical ledger record into active runtime memory, but the ledger remains the durable fact authority underneath that working set and the database retains the full durable history. The current SQLite schema does not rely on database foreign keys to preserve the unit graph; instead, the application-layer persistence logic preserves graph integrity through explicit save ordering and recovery semantics.

## 4. Minimum Semantic Requirements for Messages

Because the ledger stores facts rather than raw transcript fragments, messages must remain structured objects.

At minimum, a message should provide:

- a stable identity
- a semantic kind
- authorship / runtime provenance
- turn visibility metadata
- lifecycle update support where needed

Additional boundaries are important:

- `proposal_message` must retain full proposal detail, including at least `toolName`, `proposedStep`, and full `args`
- `proposal`, `vote`, `tool_result`, and `child_report` should not be flattened into a generic `system_message`
- `system_message` is a fallback container for shared runtime facts that do not yet deserve a dedicated structured type

This leads directly to another rule:

> **原则 P11（公共事实完整性优先于当前压缩）**：在系统尚未具备动态历史加载与压缩补偿机制之前，proposal的共享历史必须保留完整详情。上下文压缩是后续独立设计，不应提前污染当前协议。

## 5. Fractal Input: Top-Level User as `L-1`

To preserve layer symmetry, the framework should not introduce a dedicated top-layer-only user protocol. The same semantic model should apply at every layer.

So for any Agent Unit:

- there is an upper layer
- input from that upper layer is just one kind of structured message
- for L0, that upper layer happens to be a human operator

This keeps the framework fully recursive instead of special-casing the root.

## 6. Direction Naming: `incoming` and `upward`

Once the framework supports both messages arriving from above and messages being sent upward, ambiguous direction words become dangerous.

The framework should therefore reserve:

- **`incoming_message`** for messages entering the current unit from outside or above
- **`upward_message`** for messages emitted by the current unit toward its upper layer and also recorded locally as public fact

And it should explicitly avoid `upstream_message` as a structured message type name, because that word is directionally ambiguous.

> **原则 P26（方向命名显式化）**：相对于当前Agent Unit，收到的消息统一使用`incoming`命名，向上发出的消息统一使用`upward`命名；不得使用方向歧义的`upstream_message`作为结构化消息类型。

## 7. Turn Visibility Boundary

The ledger is written asynchronously, but agent turns must remain deterministic.

If a model could see newly arriving messages mid-generation, behavior would depend on incidental arrival timing. That would weaken reproducibility and coherence.

The framework therefore defines a turn-local read boundary:

- each message records `turnAuthored`
- each message records `visibleFromTurn`
- a turn reads the complete visible snapshot at its starting boundary
- messages arriving during a turn become visible only in later turns

> **原则 P4（轮次可见性边界）**：消息异步写入ConversationLedger并持久化。每轮开始时，应根据`visibleFromTurn`为当前agent构造该turn时点的完整可见快照；轮次中到达的消息只能被下一轮处理。本轮新近可见消息的边界由overlay显式标出。

## 8. ConversationProjector: Fact Layer vs. View Layer

Agents do not consume raw ledger records directly. They consume a turn-scoped projected view.

`ConversationProjector` is responsible for:

- rendering structured facts into a shared third-person conversation view
- providing reusable overlay renderers and fact-to-message projection primitives

`ContextAssembler` is responsible for:

- taking the turn-start visible snapshot plus runtime state (memory snapshot, pending proposal, recipe-aligned recent-raw boundary)
- assembling the final `LlmContext.messages` for the current turn
- ensuring runtime projection and later reconstruction follow the same turn-scoped projection rules

A key design boundary is that `AgentTurn` should not keep a persistent cross-turn message cache. Each execution should derive the visible context from the ledger snapshot for that turn.

> **原则 P14（每轮统一投影视图）**：在当前阶段，每次Agent执行都必须基于ConversationLedger在该turn时点的完整可见快照重新投影上下文；AgentTurn不得依赖跨轮持久化的本地消息缓存。

## 9. Message Classification: Facts, Turn-Local Overlays, and Directive Overlays

The projected context contains two qualitatively different layers:

### 9.1 Public Fact Broadcast

These are shared facts that enter `ConversationLedger` and remain part of the unit's persistent shared history. They are projected into agent-visible context in every subsequent turn.

Typical examples include:

- `incoming_message`
- `agent_message`
- `upward_message`
- `proposal_message`
- `vote_message`
- `tool_result_message`
- `child_report_message`
- some runtime-generated broadcasts

### 9.2 Turn-Local Overlay (stored in ledger, filtered from projection)

These are messages written to `ConversationLedger` for observability, but **filtered from normal projection** and injected as a single overlay per turn. They represent periodic state snapshots where the new version supersedes the old — accumulating all historical entries in the agent-visible context would waste budget with no information gain.

Typical examples include:

- `child_commit_view_message` — only the latest snapshot is injected as a turn-local overlay; historical entries remain in the ledger for observability/debugging but are excluded from projection

### 9.3 Private Directive Overlay

These are turn-local control hints injected only for the currently executing agent. They exist to express current-turn constraints, not long-lived shared facts. They are not persisted in the ledger.

Typical examples include:

- which pending proposal must be voted on
- the boundary of newly visible messages in this turn

This gives the core separation rule:

> **原则 P12（公共事实广播与控制指令分离）**：所有对后续双agent协作推理有持续意义的共享信息都必须作为公共事实广播进入ConversationLedger；只有当前轮的动作约束才允许作为私有overlay存在。

## 10. Newly Visible Boundary as an Explicit Overlay

The framework should not rely on the model to infer which messages are newly visible in a turn by itself. That boundary matters for coordination and attention.

So the projector should explicitly mark it.

> **原则 P15（新消息边界显式化）**：ConversationProjector应通过turn-local overlay明确标记本轮新近可见的消息边界，提示当前执行的`Agent A`或`Agent B`优先关注这些新信息。

## 11. Audience Explicitness and Third-Person Rendering

Shared broadcasts are not private whispers to the currently acting agent. They are messages projected into a common dual-agent context.

Therefore both:

- public fact broadcasts
- private directive overlays

should remain third-person and explicitly name `Agent A` or `Agent B` when relevant. Second-person wording introduces audience ambiguity.

> **原则 P16（受众显式性）**：无论是公共事实广播还是私有overlay，只要进入双agent推理上下文，其措辞都必须使用第三人称并显式标注`Agent A`或`Agent B`，避免第二人称导致的受众歧义。

## 12. Related Detailed Documents

- Context compression is specified in [context-compression.md](./context-compression.md).
- Runtime execution semantics are specified in [protocol-and-runtime.md](./protocol-and-runtime.md).
- Layering and parent/child coordination are specified in [hierarchy-and-layers.md](./hierarchy-and-layers.md).
- FSM and tool availability are specified in [state-machine-and-tools.md](./state-machine-and-tools.md).

---

## Change Log

- **v3.6 (2026-05-07)**: Reclassified `child_commit_view_message` from public fact broadcast (§9.1) to new turn-local overlay category (§9.2). These messages are stored in ledger for observability but filtered from normal projection; only the latest snapshot is injected as a single overlay per turn to prevent token accumulation. Added §9.2, renumbered §9.2 → §9.3.
- **v3.5 (2026-05-05)**: Clarified that `ConversationProjector` now serves as a reusable rendering primitive while final turn-scoped context assembly belongs to `ContextAssembler`. Documented `child_commit_view_message` as a current-turn-visible public fact that is written before the turn snapshot is read, so recipe boundaries and runtime-visible context stay aligned.
- **v3.4 (2026-04-19)**: Added §1.1 Message Channel Conversational Style (P29). P29 refines P7 in the writing-style dimension and derives from P27: message payloads should use natural conversational language rather than document-style Markdown; structured output belongs in .md files via the knowledge channel.
- **v3.3 (2026-04-12)**: Added the implementation boundary for SQLite-backed persistence. The durable store remains authoritative, but unit-graph integrity is maintained by the application-layer persistence logic rather than DB-level foreign keys.
- **v3.2 (2026-04-12)**: Updated the persistence note to reflect the SQLite-backed durable store in `.elenchus/state.db`. The ledger remains the durable fact authority, while cold-start reconstructs only the next working context rather than eagerly loading the full durable history into runtime memory.
- **v3.1 (2026-04-12)**: Clarified the persistence relationship between `ConversationLedger` and startup working-set reconstruction. The ledger remains the durable fact authority, while cold-start may reconstruct the next working context from persisted `Memory Snapshot + Recent Raw Window` without eagerly loading all historical runtime state.
- **v3.0 (2026-04-12)**: Extracted from `framework-design.md` during the overview/module split. This file now holds the detailed communication and projection semantics while the overview remains the canonical entry point and index.
