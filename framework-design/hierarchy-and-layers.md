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
  - **child output review**: reading child-produced work artifacts (reports, analysis documents, deliverables) to evaluate their quality, completeness, and alignment with the assigned task
  - must **not** use environment tools to directly execute tasks; task execution should be delegated to child units
- `readFile` is **auto-approved** (P30): proposals execute immediately without partner vote, but L0's role policy still constrains what files it should read (knowledge artifacts and child work products only, not source code for substantive understanding)
- can enter `Executing` state when using environment tools for permitted purposes

L0 has **three responsibilities**:
1. **coordinating work across child units** — task decomposition, delegation, and scheduling
2. **maintaining the knowledge space** — keeping the workspace navigable and well-organized for all agents
3. **reviewing child output quality** — scrutinizing child-produced work products, identifying gaps and deficiencies, and providing corrective feedback via `sendToChild`

The third responsibility is what distinguishes L0 from a mere task dispatcher. The dual-agent deliberation mechanism inside the parent unit is the natural vehicle for quality review: when a child reports or yields with work products, the two L0 agents should discuss the output's quality before accepting it or sending feedback. This extends the framework's core principle — that structured dialogue surfaces weaknesses — from intra-unit deliberation to cross-unit quality assurance.

> **原则 P28（L0 角色策略约束）**：L0 拥有完整的环境工具能力，但通过 prompt 注入的角色策略约束其用途为信息获取、知识空间维护与子产出审视。L0 不应使用环境工具直接执行任务；任务执行应通过子单元委派。若 L0 发现自己在用工具直接解决问题而不是分配问题，应停下来创建子 agent。

The dual-agent proposal-vote mechanism serves as a second line of defense: the partner agent (Verifier) is explicitly guided in the prompt to reject tool uses that exceed L0's role scope. However, this is a soft constraint, not a hard enforcement — both agents may agree to bypass it under efficiency pressure. Note that `readFile` is auto-approved (P30) and does not go through the vote step; L0's readFile role compliance therefore relies entirely on prompt guidance rather than partner vote rejection.

### 4.1.1 Child Output Review (P31)

When a child unit sends a `report` or `yield` that references work products (documents, analysis, code changes), L0 should treat these as **work products to be reviewed**, not merely as coordination signals to be acknowledged.

The expected review pattern is:
1. **Read**: use `readFile` to examine the child's actual work product (not just the summary in the report message)
2. **Deliberate**: discuss the product's quality within the dual-agent unit — identify gaps, inaccuracies, incomplete coverage, or misalignment with the assigned task
3. **Respond**: either accept the output (and update the knowledge space accordingly) or send corrective feedback via `sendToChild` specifying what needs improvement

This pattern extends the framework's deliberation advantage from intra-unit to cross-unit quality assurance. Without it, child reports are accepted at face value and the parent becomes a passive task dispatcher rather than an active quality gate.

> **原则 P31（子产出审议）**：父单元收到子单元的工作汇报后，应将子产出视为待审视的工作产品而非仅需确认的协调信号。父单元的双 agent 应在内部讨论子产出的质量与不足，再决定接受或通过 sendToChild 反馈修正要求。这是框架"通过讨论发现弱点"原则从 unit 内部向跨 unit 质量保证的自然延伸。

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

## 5. Deliberation Scrutiny (P32)

The framework's core value proposition is that structured dialogue between two agents surfaces weaknesses that a single agent would miss. However, this advantage is only realized when both agents actively scrutinize rather than default to agreement.

> **原则 P32（审议审视优先）**：在双 agent 审议中，有根据的质疑与保留比顺畅的同意对 unit 更有价值。APPROVE 应是审视后的结论，而非默认状态。Agent 不应出于效率压力或配合倾向而跳过质疑步骤。

This principle applies at two levels:

**Intra-unit scrutiny**: within a dual-agent unit, both agents should treat their partner's claims, proposals, and conclusions as candidates for challenge rather than automatic acceptance. Agent B in particular should not silently approve after internal verification — it should surface its concerns in dialogue first, so the unit's shared reasoning benefits from the scrutiny.

**Cross-unit scrutiny (P31 child output review)**: when a parent unit receives child work products, the same scrutiny discipline applies. The parent should not accept child reports at face value; instead, the two parent agents should discuss the output's quality before accepting or providing feedback.

Prompt-level guidance for this principle includes:
- Making explicit that well-grounded dissent is more valuable than smooth agreement
- Requiring that concerns be expressed in dialogue before a vote, not just internally noted
- Framing child reports as work products to review, not signals to acknowledge
- Discouraging the pattern of quickly agreeing to maintain conversational flow

## 6. Parent/Child Coordination Semantics

Parent and child interact through **two complementary channels**:

### 6.1 Dual-Channel Communication

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

### 6.2 Iterative Coordination

Multiple children may exist concurrently. Because child spawning is non-blocking, upward child reports can arrive asynchronously at the parent ledger.

Parent-child collaboration should therefore be understood as iterative rather than one-shot. A child should use `report` routinely at key decision points, material findings, risks, and coordination moments when the parent may benefit from early visibility. A child should also use `yield` when it lacks enough information to continue effectively and wants the parent to provide more context before work resumes.

For complex work, the parent may gradually form multiple delegated workstreams across turns rather than forcing every subproblem into a single child unit. When new information arrives, the parent should judge whether it belongs inside an existing child workflow and should be sent through `sendToChild`, or whether it opens a distinct enough line of work that a new child unit would provide clearer separation and better coordination.

### 6.3 Fixed Slot Pool and Cooperative Scheduling

The parent has a fixed number of coordination slots (N). Each child occupies one slot regardless of its state (active, idle, sleeping). All children are always visible to the parent — there is no hidden/dormant state.

When all N slots are occupied, the parent cannot create new children. Instead, it uses **cooperative scheduling** to recover slots:
1. The parent sends a message to an existing child via `sendToChild`, requesting it to wrap up its current work and yield.
2. The child saves its work products to the file system, then yields and enters idle state.
3. The parent assigns a new task to this idle child via `sendToChild` with a new brief.

The framework does not provide a forced context-reset mechanism. When a child transitions from an old task to a new one, three self-regulating mechanisms ensure the transition is natural:
- **Task affinity**: the parent naturally tends to assign related tasks to children with relevant context.
- **Compression self-regulation**: when old context is irrelevant to the new task, context pressure triggers `compressContext`, and the child naturally focuses on the new task.
- **Knowledge externalization**: old task work products are already in the file system; the child does not need to "remember" them.

This design replaces the previous unmount/remount model. The reasoning is documented in [workspace-ownership-analysis.md](./workspace-ownership-analysis.md) §7.

## 7. Child Lifecycle: Fixed Slot Pool

The framework defines a fixed upper bound on the number of children a parent may have. This replaces the previous unmount/remount visibility model with a simpler cognitive model for the parent agent: "I have N children, each is either busy or idle."

Key properties:
- **Fixed slot count**: the parent has N coordination slots; each child occupies one slot regardless of state.
- **Always visible**: all children are always visible to the parent. No hidden/dormant state, no remount edge cases.
- **Cooperative slot recovery**: when all slots are full, the parent requests a child to yield via `sendToChild`, then reassigns the slot with a new task brief.
- **No forced context reset**: the child retains its context between tasks. Self-regulation through task affinity, compression, and knowledge externalization makes forced reset unnecessary.
- **Autonomy preserved**: the framework does not hardcode whether a child is one-shot, reusable, or long-lived. That remains the parent's decision.

This preserves flexibility for:
- recurring delegated collaborators (child yields, gets new related task)
- one-off atomic subtask workers (child yields, gets unrelated task; old context compresses naturally)
- temporarily sleeping child units (sleep still available)

## 8. Prompt Isomorphism and Layer Role Policy

Different layers do not need different prompt logic families.

The system prompt should remain structurally the same across layers, with behavioral differences emerging from the **layer role policy** and protocol dynamics.

The stable structure is:

- shared collaboration guideline
- layer orientation (L0/L1/L2) with role policy
- cognitive style for Agent A / Agent B
- current tool list

Since all layers now share the same tool set, the layer orientation section carries the **role policy** that constrains how each layer should use its tools. For L0, this policy restricts environment tool usage to information acquisition and knowledge space maintenance. For L1 and L2, the policy allows full task execution use of environment tools.

This avoids overfitting layer behavior into prompt wording when the role policy already conveys the actionable constraints.

## 9. Stateless Agent, Externalized Knowledge

The framework deliberately prefers an AI-native model over a human-style expert-routing model.

> **原则 P10（无状态Agent）**：Agent实例是无状态的计算单元。知识独立于实例存在，通过注入而非累积获得。任何新实例 + 正确的知识 = 等价的执行能力。

That means:

- long-lived expertise should not depend on one specific running agent instance
- knowledge should be injected or externalized rather than accumulated as irreplaceable hidden history
- the parent naturally acts as a knowledge curator when spawning children

The knowledge externalization direction has now been concretized through the **single-destination knowledge space** and **dual-channel communication** (P27):

- agents do not own file system territory; they operate on a shared file system with a single destination — knowledge is written where the work naturally belongs
- the workspaceRoot (user-configurable, default `~/Elenchus/`) is L0's bash cwd and the navigation hub for the agent's entire working world
- each child's projectRoot is inferred from its task brief; children operate on their project's actual file structure
- knowledge artifacts (.md files) persist across turns and survive context compression
- the message channel carries signals and triggers; the knowledge channel carries durable work products
- `spawnChild(task)` provides an initial brief, while ongoing context flows through both channels
- the framework relies on continued exchange through `report`/`yield`/`sendToChild` (message channel) and .md file sharing (knowledge channel) whenever context needs to keep flowing across the layer boundary

The longer-term direction is to externalize not only ad hoc task context, but a broader **knowledge space** shared by skill-like guidance and long-term memory.

- the workspaceRoot AGENT.md serves as the navigation hub, injected into every agent's system prompt
- deeper knowledge should remain expandable by reference rather than preloaded in full
- the framework currently does **not** assume that knowledge must be stored as one canonical file or one explicit set; it may instead emerge from distributed knowledge nodes and a separately assembled resident view
- the framework also does **not** yet commit to the file system as the only possible implementation substrate, even though the current direction remains file-system-friendly and text-centric

## 10. Commit Log as Parent-Visible Progress Boundary

The framework deliberately limits what a parent sees from child work.

The parent should currently observe:

- committed task-advancing steps accepted by the child unit

The parent should **not** currently observe:

- unapproved proposals
- all internal debate
- raw real-time internal activity streams

This yields the `commitLog` boundary.

### 10.1 Terminology

- **`proposedStep`**: the task-advancing meaning of a proposal-producing tool call
- **`committedStep`**: the step after partner approval solidifies it as an accepted commitment
- **`commitLog`**: the unit-level sequence of committed steps

### 10.2 Semantic Rule

`proposedStep` should describe what the step contributes to task progress, not merely restate tool arguments.

### 10.3 Commit Boundary

Approval is the commitment boundary. If a proposal is approved, its `proposedStep` enters `commitLog` even if later execution fails.

So `commitLog` is:

- accepted-step history
- not success history

### 10.4 Ownership

`commitLog` belongs to the **Agent Unit**, not to one individual agent.

This matters because what becomes committed is no longer private intent; it is a jointly accepted step of the dual-agent unit.

## 11. Related Detailed Documents

- Communication and projection foundations: [conversation-model.md](./conversation-model.md)
- Compression model: [context-compression.md](./context-compression.md)
- Runtime action semantics: [protocol-and-runtime.md](./protocol-and-runtime.md)
- FSM and tool availability: [state-machine-and-tools.md](./state-machine-and-tools.md)

---

## Change Log

- **v6.0 (2026-04-19)**: Add L0 third responsibility: child output quality review (P31). Expand L0 readFile scope to include child work products. Add deliberation scrutiny principle (P32): well-grounded dissent is more valuable than smooth agreement; applies both intra-unit and cross-unit. Renumber §5-§10 to §6-§11.
- **v5.2 (2026-04-19)**: Update L0 environment tool notes for readFile auto-approval (P30). readFile proposals execute immediately without partner vote; L0 role compliance for readFile now relies on prompt guidance rather than vote rejection. Update §4.1, P28 note.
- **v5.1 (2026-04-18)**: Migrate from dual-root to single-destination + logical territory model. Replace globalRoot + projectRoot with workspaceRoot (user-configurable, default `~/Elenchus/`). L0 bash cwd = workspaceRoot; child projectRoot inferred from task brief. Update §8.
- **v5.0 (2026-04-18)**: Replace unmount/remount model with fixed slot pool model. Parent has N coordination slots; all children always visible; slot recovery through cooperative scheduling (sendToChild → yield → reassign). No forced context reset; three self-regulating mechanisms (task affinity, compression, knowledge externalization). Update §5.3, §6, §8, changelog.
- **v4.0 (2026-04-16)**: L0 gains environment tools with role policy constraint (P28). Layer isomorphism (P9) evolves from tool-set difference to role-policy difference. Add dual-channel communication (P27): message channel + knowledge channel via .md files. Add agent workspace model: each unit manages its own directory, knowledge shared through .md files. Restructure §5 into §5.1 (dual-channel), §5.2 (iterative coordination), §5.3 (unmount/remount). Update §7 prompt isomorphism to include layer role policy. Update §8 to reflect concrete knowledge externalization through workspace model. [Superseded by v5.0 for §5.3 and §6]
- **v3.5 (2026-04-13)**: Extended the externalized-knowledge discussion toward a unified knowledge-space direction. Introduced `Resident Knowledge` as the current term for the small default resident knowledge surface, while explicitly recording that its assembly model and the ultimate storage substrate both remain undecided.
- **v3.4 (2026-04-12)**: Added restart-time child recovery semantics. Unmounted children remain on disk as durable history, but cold-start recovery rebuilds only the mounted active child subtree rather than reviving every historically affiliated child. [Superseded by v5.0]
- **v3.3 (2026-04-12)**: Added child unmount/remount semantics. [Superseded by v5.0]
- **v3.2 (2026-04-12)**: Added explicit parent-child routing guidance: parent units may gradually build multiple child workstreams across turns, and should decide whether new information belongs in an existing child workflow via `sendToChild` or should instead motivate a new child unit when the line of work is sufficiently separate.
- **v3.1 (2026-04-12)**: Clarified that `spawnChild` provides an initial brief rather than a one-shot full-context transfer. Parent-child collaboration is now explicitly described as iterative: children should use `report` at key coordination points and may use `yield` to request more information when local context is insufficient.
- **v3.0 (2026-04-12)**: Extracted from `framework-design.md` during the overview/module split. This file now holds the detailed layer, delegation, knowledge-model, and commit-log semantics while the overview remains the canonical entry point and index.
