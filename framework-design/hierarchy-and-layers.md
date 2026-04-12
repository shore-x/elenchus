---
title: "Elenchus Framework Design - Hierarchy and Layers"
date: 2026-04-12
version: 3.2
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
- prompt isomorphism
- stateless-agent knowledge model
- parent/child coordination boundaries
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

> **原则 P9（层级同构）**：所有层级的Agent单元共享相同的FSM和协议。层级间的差异仅体现在注入的工具集和被调用方式上。

So the framework does **not** define separate protocols for L0, L1, and L2. The differences are mainly:

- which tools are available
- what kinds of tasks are usually appropriate there
- which layer can create which child layer

## 4. Fixed Three-Layer Architecture

The current architecture uses three fixed levels:

### 4.1 L0

- coordination and task framing
- receives input from `L-1`
- can manage children
- cannot directly use environment tools
- therefore never enters `Executing`

### 4.2 L1

- main planning and execution layer
- can both manage children and use environment tools
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

Parent and child interact through the same core concepts already used elsewhere in the framework:

- parent creates child via `spawnChild`, which provides an initial task brief rather than a guarantee that all relevant context has already been transferred
- parent sends follow-up context, clarifications, constraints, and redirection via `sendToChild`
- child sends upward coordination through `report` or `yield`
- parent may forcibly terminate a child through the control plane

Multiple children may exist concurrently. Because child spawning is non-blocking, upward child reports can arrive asynchronously at the parent ledger.

Parent-child collaboration should therefore be understood as iterative rather than one-shot. A child should use `report` routinely at key decision points, material findings, risks, and coordination moments when the parent may benefit from early visibility. A child should also use `yield` when it lacks enough information to continue effectively and wants the parent to provide more context before work resumes.

For complex work, the parent may gradually form multiple delegated workstreams across turns rather than forcing every subproblem into a single child unit. When new information arrives, the parent should judge whether it belongs inside an existing child workflow and should be sent through `sendToChild`, or whether it opens a distinct enough line of work that a new child unit would provide clearer separation and better coordination.

## 6. No Special Lifecycle Policy for Children

The framework should not hardcode whether a child is one-shot, reusable, or long-lived.

That is an autonomy decision for the parent unit, not a baked-in lifecycle restriction.

This preserves flexibility for:

- recurring delegated collaborators
- one-off atomic subtask workers
- temporarily sleeping child units

## 7. Prompt Isomorphism

Different layers do not need different prompt logic families.

The system prompt should remain structurally the same across layers, with behavioral differences emerging from tool availability and protocol dynamics.

The stable structure is:

- shared collaboration guideline
- cognitive style for Agent A / Agent B
- current tool list

This avoids overfitting layer behavior into prompt wording when the tool surface already conveys the actionable constraints.

## 8. Stateless Agent, Externalized Knowledge

The framework deliberately prefers an AI-native model over a human-style expert-routing model.

> **原则 P10（无状态Agent）**：Agent实例是无状态的计算单元。知识独立于实例存在，通过注入而非累积获得。任何新实例 + 正确的知识 = 等价的执行能力。

That means:

- long-lived expertise should not depend on one specific running agent instance
- knowledge should be injected or externalized rather than accumulated as irreplaceable hidden history
- the parent naturally acts as a knowledge curator when spawning children

At the current stage, `spawnChild(task)` is the minimal knowledge injection mechanism. It should be treated as an initial brief, not as proof that the child already has all necessary context. The framework therefore relies on continued natural-language exchange through `report`, `yield`, and `sendToChild` whenever context needs to keep flowing across the layer boundary.

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

- **v3.2 (2026-04-12)**: Added explicit parent-child routing guidance: parent units may gradually build multiple child workstreams across turns, and should decide whether new information belongs in an existing child workflow via `sendToChild` or should instead motivate a new child unit when the line of work is sufficiently separate.
- **v3.1 (2026-04-12)**: Clarified that `spawnChild` provides an initial brief rather than a one-shot full-context transfer. Parent-child collaboration is now explicitly described as iterative: children should use `report` at key coordination points and may use `yield` to request more information when local context is insufficient.
- **v3.0 (2026-04-12)**: Extracted from `framework-design.md` during the overview/module split. This file now holds the detailed layer, delegation, knowledge-model, and commit-log semantics while the overview remains the canonical entry point and index.
