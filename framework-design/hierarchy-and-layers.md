---
title: "Elenchus Framework Design - Hierarchy and Layers"
date: 2026-04-13
version: 4.0
---

# Hierarchy and Layers

> **Synchronization note**
> - This document expands the layer architecture and delegation summary in [../framework-design.md](../framework-design.md).
> - If layer responsibilities, child semantics, prompt isomorphism, knowledge injection, or commit-log visibility change here, also review the overview summary, principle index, glossary, and version notes in `framework-design.md`.
> - If `framework-design.md` changes the system-level architecture description, confirm whether this file must also be updated.

## Scope

This document specifies:

- why the framework is hierarchical
- layer symmetry and layer isomorphism
- the fixed L0/L1/L2 architecture
- prompt isomorphism and layer role policy
- stateless-agent knowledge model
- parent/child coordination boundaries
- agent workspace and dual-channel communication
- commit-log visibility semantics

It does not define the low-level FSM table; that lives in [state-machine-and-tools.md](./state-machine-and-tools.md).

## Relevant Overview Sections

- `framework-design.md` / Chapter 4 summary
- `framework-design.md` / Principles index: P3, P9, P10

---

## 1. Why Hierarchy Exists

A single dual-agent dialogue has limited context capacity. As tasks become more complex, the framework needs a way to decompose work into independent units that can be validated with the same protocol.

That leads naturally to hierarchy:

- parent units delegate
- child units deliberate and act
- upward communication flows back through the same protocol family

## 2. Layer Symmetry

The system should not use one protocol for human-to-root interaction and a different protocol for parent-to-child interaction.

> **原则 P3（层级对称）**：顶层的人类操作者是`L-1`父层。每层父子关系遵循完全相同的协议。

This makes the framework recursive rather than special-cased.

## 3. Layer Isomorphism

All layers share the same fundamental collaboration structure.

> **原则 P9（层级同构）**：所有层级的Agent单元共享相同的FSM、协议和工具集。层级间的差异仅体现在 prompt 注入的角色策略定义上。

P9 has evolved from "tool-set difference = behavior difference" to "complete capability + role policy difference = behavior difference". All layers now share the same tool set; behavioral differences emerge from the layer role policy injected via prompt, not from tool availability.

This is a deliberate design maturation: when all layers have complete capabilities, behavioral differences are defined by role (like a manager vs. engineer having the same tools but different responsibilities), not by capability restriction. This better reflects how real organizations divide work.

So the framework does **not** define separate protocols for L0, L1, and L2. The differences are mainly:

- which **role policy** constrains tool usage at each layer
- what kinds of tasks are usually appropriate there
- which layer can create which child layer

## 4. Fixed Three-Layer Architecture

The current architecture uses three fixed levels:

### 4.1 L0

- coordination and task framing
- receives input from `L-1`
- can manage children
- **has environment tools** (bash, readFile, writeFile), but constrained by **layer role policy** (P28) to use them only for:
  - **information acquisition**: reading files, listing directories, searching content to understand the current state of work
  - **knowledge space maintenance**: writing/updating .md files in its own workspace, organizing knowledge structure
  - must **not** use environment tools to directly execute tasks; task execution should be delegated to child units
- can enter `Executing` state when using environment tools for permitted purposes

> **原则 P28（L0 角色策略约束）**：L0 拥有完整的环境工具能力，但通过 prompt 注入的角色策略约束其用途为信息获取与知识空间维护。L0 不应使用环境工具直接执行任务；任务执行应通过子单元委派。若 L0 发现自己在用工具直接解决问题而不是分配问题，应停下来创建子 agent。

The dual-agent proposal-vote mechanism serves as a second line of defense: the partner agent (Verifier) is explicitly guided in the prompt to reject tool uses that exceed L0's role scope. However, this is a soft constraint, not a hard enforcement — both agents may agree to bypass it under efficiency pressure.

### 4.2 L1

- main planning and execution layer
- can both manage children and use environment tools for task execution
- can decompose complex work to L2

### 4.3 L2

- leaf execution layer
- can use environment tools
- cannot spawn children

Together these layers cover the full chain:

- intent understanding
- planning and validation
- atomic execution

## 5. Parent/Child Coordination Semantics

Parent and child interact through **two complementary channels**:

### 5.1 Dual-Channel Communication

> **原则 P27（双通道通信）**：Agent 之间的协作依赖两个本质不同的通信通道——消息通道与知识通道——两者互补，不互相替代。

**Message channel** (via ConversationLedger):
- parent creates child via `spawnChild`, which provides an initial task brief
- parent sends follow-up context, clarifications, constraints, and redirection via `sendToChild`
- child sends upward coordination through `report` or `yield`
- parent may forcibly terminate a child through the control plane
- **role**: signal, trigger, coordination, lightweight summaries
- **consumption**: push-based — arrival triggers processing

**Knowledge channel** (via .md files in agent workspaces):
- child saves detailed work records, findings, and experience summaries as .md files in its workspace directory
- child includes file paths in `report`/`yield` messages so the parent can read on demand
- parent reads child workspace .md files when deeper understanding is needed
- parent may integrate/transform child knowledge into its own .md files (producing its own understanding, not mirroring)
- **role**: work artifacts, long-term memory, cross-turn knowledge transfer
- **consumption**: pull-based — read on demand, not read = no context cost

The message channel should not carry detailed work results; the knowledge channel should not carry immediate triggering responsibility. When a child completes a task phase, the recommended pattern is:
1. Save detailed work record to a .md file in the child's workspace
2. Send `report` or `yield` with a lightweight summary + the .md file path
3. Parent reads the .md file only when it needs the detail

### 5.2 Iterative Coordination

Multiple children may exist concurrently. Because child spawning is non-blocking, upward child reports can arrive asynchronously at the parent ledger.

Parent-child collaboration should therefore be understood as iterative rather than one-shot. A child should use `report` routinely at key decision points, material findings, risks, and coordination moments when the parent may benefit from early visibility. A child should also use `yield` when it lacks enough information to continue effectively and wants the parent to provide more context before work resumes.

For complex work, the parent may gradually form multiple delegated workstreams across turns rather than forcing every subproblem into a single child unit. When new information arrives, the parent should judge whether it belongs inside an existing child workflow and should be sent through `sendToChild`, or whether it opens a distinct enough line of work that a new child unit would provide clearer separation and better coordination.

### 5.3 Unmount and Remount

The parent may also choose to **unmount** an `idle` child unit. Unmounting means that the child disappears from the parent agent's current visible context and no longer consumes parent context budget, while the program still preserves the parent-child affiliation. If that child later emits a new `upward-message`, it should automatically remount into the parent's visible child set.

Cold-start recovery intentionally uses a narrower rule than runtime visibility management: unmounted children remain preserved in durable storage, but they are not restored into the active runtime graph on startup. Recovery only rematerializes the mounted child subtree that should continue active coordination after restart.

## 6. No Special Lifecycle Policy for Children

The framework should not hardcode whether a child is one-shot, reusable, or long-lived.

That is an autonomy decision for the parent unit, not a baked-in lifecycle restriction.

This preserves flexibility for:

- recurring delegated collaborators
- one-off atomic subtask workers
- temporarily sleeping child units

At the current stage, child reuse should remain lightweight. Unmounting is not completion, archival deletion, or forced termination. It is a parent-side visibility decision: an `idle` child can be removed from the parent's current working set, and later re-enter that working set only if new upward coordination from that child makes it relevant again.

## 7. Prompt Isomorphism and Layer Role Policy

Different layers do not need different prompt logic families.

The system prompt should remain structurally the same across layers, with behavioral differences emerging from the **layer role policy** and protocol dynamics.

The stable structure is:

- shared collaboration guideline
- layer orientation (L0/L1/L2) with role policy
- cognitive style for Agent A / Agent B
- current tool list

Since all layers now share the same tool set, the layer orientation section carries the **role policy** that constrains how each layer should use its tools. For L0, this policy restricts environment tool usage to information acquisition and knowledge space maintenance. For L1 and L2, the policy allows full task execution use of environment tools.

This avoids overfitting layer behavior into prompt wording when the role policy already conveys the actionable constraints.

## 8. Stateless Agent, Externalized Knowledge

The framework deliberately prefers an AI-native model over a human-style expert-routing model.

> **原则 P10（无状态Agent）**：Agent实例是无状态的计算单元。知识独立于实例存在，通过注入而非累积获得。任何新实例 + 正确的知识 = 等价的执行能力。

That means:

- long-lived expertise should not depend on one specific running agent instance
- knowledge should be injected or externalized rather than accumulated as irreplaceable hidden history
- the parent naturally acts as a knowledge curator when spawning children

The knowledge externalization direction has now been concretized through the **agent workspace** model and **dual-channel communication** (P27):

- each agent unit manages its own workspace directory on the file system
- knowledge artifacts (.md files) in the workspace persist across turns and survive context compression
- the message channel carries signals and triggers; the knowledge channel carries durable work products
- `spawnChild(task)` provides an initial brief, while ongoing context flows through both channels
- the framework relies on continued exchange through `report`/`yield`/`sendToChild` (message channel) and .md file sharing (knowledge channel) whenever context needs to keep flowing across the layer boundary

The longer-term direction is to externalize not only ad hoc task context, but a broader **knowledge space** shared by skill-like guidance and long-term memory.

- a small amount of **`Resident Knowledge`** may eventually become part of the default agent-visible knowledge surface
- deeper knowledge should remain expandable by reference rather than preloaded in full
- the framework currently does **not** assume that `Resident Knowledge` must be stored as one canonical file or one explicit set; it may instead emerge from distributed knowledge nodes and a separately assembled resident view
- the framework also does **not** yet commit to the file system as the only possible implementation substrate, even though the current direction remains file-system-friendly and text-centric

## 9. Commit Log as Parent-Visible Progress Boundary

The framework deliberately limits what a parent sees from child work.

The parent should currently observe:

- committed task-advancing steps accepted by the child unit

The parent should **not** currently observe:

- unapproved proposals
- all internal debate
- raw real-time internal activity streams

This yields the `commitLog` boundary.

### 9.1 Terminology

- **`proposedStep`**: the task-advancing meaning of a proposal-producing tool call
- **`committedStep`**: the step after partner approval solidifies it as an accepted commitment
- **`commitLog`**: the unit-level sequence of committed steps

### 9.2 Semantic Rule

`proposedStep` should describe what the step contributes to task progress, not merely restate tool arguments.

### 9.3 Commit Boundary

Approval is the commitment boundary. If a proposal is approved, its `proposedStep` enters `commitLog` even if later execution fails.

So `commitLog` is:

- accepted-step history
- not success history

### 9.4 Ownership

`commitLog` belongs to the **Agent Unit**, not to one individual agent.

This matters because what becomes committed is no longer private intent; it is a jointly accepted step of the dual-agent unit.

## 10. Related Detailed Documents

- Communication and projection foundations: [conversation-model.md](./conversation-model.md)
- Compression model: [context-compression.md](./context-compression.md)
- Runtime action semantics: [protocol-and-runtime.md](./protocol-and-runtime.md)
- FSM and tool availability: [state-machine-and-tools.md](./state-machine-and-tools.md)

---

## Change Log

- **v4.0 (2026-04-16)**: L0 gains environment tools with role policy constraint (P28). Layer isomorphism (P9) evolves from tool-set difference to role-policy difference. Add dual-channel communication (P27): message channel + knowledge channel via .md files. Add agent workspace model: each unit manages its own directory, knowledge shared through .md files. Restructure §5 into §5.1 (dual-channel), §5.2 (iterative coordination), §5.3 (unmount/remount). Update §7 prompt isomorphism to include layer role policy. Update §8 to reflect concrete knowledge externalization through workspace model.
- **v3.5 (2026-04-13)**: Extended the externalized-knowledge discussion toward a unified knowledge-space direction. Introduced `Resident Knowledge` as the current term for the small default resident knowledge surface, while explicitly recording that its assembly model and the ultimate storage substrate both remain undecided.
- **v3.4 (2026-04-12)**: Added restart-time child recovery semantics. Unmounted children remain on disk as durable history, but cold-start recovery rebuilds only the mounted active child subtree rather than reviving every historically affiliated child.
- **v3.3 (2026-04-12)**: Added child unmount/remount semantics. A parent may unmount an `idle` child so it disappears from the parent agent's current visible context while parent-child affiliation remains in the program. New upward communication from that child automatically remounts it into the parent's visible child set.
- **v3.2 (2026-04-12)**: Added explicit parent-child routing guidance: parent units may gradually build multiple child workstreams across turns, and should decide whether new information belongs in an existing child workflow via `sendToChild` or should instead motivate a new child unit when the line of work is sufficiently separate.
- **v3.1 (2026-04-12)**: Clarified that `spawnChild` provides an initial brief rather than a one-shot full-context transfer. Parent-child collaboration is now explicitly described as iterative: children should use `report` at key coordination points and may use `yield` to request more information when local context is insufficient.
- **v3.0 (2026-04-12)**: Extracted from `framework-design.md` during the overview/module split. This file now holds the detailed layer, delegation, knowledge-model, and commit-log semantics while the overview remains the canonical entry point and index.
