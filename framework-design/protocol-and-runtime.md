---
title: "Elenchus Framework Design - Protocol and Runtime"
date: 2026-04-12
version: 3.0
---

# Protocol and Runtime

> **Synchronization note**
> - This document expands the proposal/vote and runtime execution summary in [../framework-design.md](../framework-design.md).
> - If proposal semantics, blocking behavior, runtime broadcast rules, or upward communication behavior change here, also review the overview summary, principle index, glossary, and tool summary in `framework-design.md`.
> - If `framework-design.md` changes the high-level action model, confirm whether this file must be updated.

## Scope

This document defines the framework's action protocol and runtime execution behavior, including:

- proposal-vote as the action commitment protocol
- blocking vs. non-blocking actions
- runtime treatment of approved proposals
- public runtime broadcasts
- upward communication semantics
- control-plane termination semantics

It does not define layer assignment or tool availability tables in detail; those live in [hierarchy-and-layers.md](./hierarchy-and-layers.md) and [state-machine-and-tools.md](./state-machine-and-tools.md).

## Relevant Overview Sections

- `framework-design.md` / Chapter 3 summary
- `framework-design.md` / Principles index: P2, P6, P8, P13, P21, P24, P25

---

## 1. Proposal-Vote as the Action Protocol

The framework's core action model is simple: an agent should not be able to unilaterally commit the unit to a consequential action.

Therefore, tool invocation is not immediate execution. For every proposal-producing tool:

- one agent proposes
- the other agent votes `APPROVE` or `REJECT`
- approval becomes the commitment boundary
- runtime then performs the corresponding effect according to the tool category

This preserves the dual-agent value of cross-checking before commitment.

## 2. Agent Autonomy

The framework should not micro-manage substantive judgment. It defines protocol boundaries, not substantive reasoning outcomes.

That global autonomy principle still applies inside the proposal-vote structure:

> **原则 P2（Agent自治）**：Agent应自主做出判断，包括是否需要继续讨论、是否需要行动、如何分解任务，以及在分歧出现时如何推进。框架只提供协作协议与状态边界，不替Agent裁决任务内容。

## 3. Blocking vs. Non-Blocking by Operation Target

The key distinction is not whether a tool feels important. The distinction is whether the action targets:

- the external environment
- another autonomous agent unit or asynchronous runtime process

Environmental actions should block while their atomic result is produced. Agent-to-agent or background task actions should remain non-blocking.

> **原则 P8（阻塞性由操作对象决定）**：对环境的操作是阻塞的，对其他自治体的操作是非阻塞的。

## 4. Blocking Tool Execution

Blocking tools such as `bash`, `readFile`, and `writeFile` follow this pattern:

1. proposal is recorded in `ConversationLedger` with full detail
2. partner votes `APPROVE`
3. unit enters `Executing`
4. tool runs synchronously
5. structured `tool_result_message` is written back as public fact
6. unit returns to the opposite agent's turn

During `Executing`, no agent is active.

## 5. Non-Blocking Tool Execution

Non-blocking tools such as `spawnChild`, `sendToChild`, `report`, and `compressContext` follow a different path:

1. proposal is approved
2. runtime effect begins immediately or is scheduled asynchronously
3. unit does **not** enter `Executing`
4. the unit continues normal turn alternation
5. runtime writes relevant shared facts into `ConversationLedger`

This model treats non-blocking side effects as shared facts rather than private confirmations.

> **原则 P13（异步Unit Runtime事件也属于公共事实）**：只要某个Unit Runtime事件会影响后续双agent协作推理，它就应被写入ConversationLedger并以第三人称公共广播形式呈现，而不是作为面向单个agent的私有提示。

## 6. Runtime Broadcasts as Shared Facts

Runtime-originated events with downstream coordination value should be rendered as shared public facts.

Examples include:

- task started
- task failed
- child spawned
- child message queued or delivered
- timeout fired
- compression task failure or completion

These should be visible through the same shared context model rather than private hidden acknowledgements.

## 7. Upward Communication Semantics

The framework distinguishes three coordination moves that might otherwise be conflated:

- **yield** = send upward and pause
- **report** = send upward and continue
- **sleep** = pause without sending upward

This decomposition matters because upward communication and pausing are independent coordination dimensions.

### 7.1 Yield

`yield` means:

- write a local `upward_message` with `deliveryMode: "yield"`
- emit an `upward-message` runtime event to the upper layer
- enter `Idle`

### 7.2 Report

`report` means:

- write a local `upward_message` with `deliveryMode: "report"`
- emit an `upward-message` runtime event to the upper layer
- continue normal turn progression rather than pausing

### 7.3 Sleep

`sleep` means:

- do not create `upward_message`
- pause the unit into `Idle`
- rely on wake-up triggers such as timeout or new incoming facts

A key benefit of locally recording both `yield` and `report` as `upward_message` is that later turns can still see what has already been sent upward.

## 8. Compression as a Non-Blocking Runtime Action

`compressContext` is also non-blocking, but it has a very specific contract.

The dual-agent unit approves:

- what the compression should especially preserve
- optionally why it is worth doing now

The runtime/compressor then performs the actual background snapshot refresh.

Detailed compression-specific rules are defined in [context-compression.md](./context-compression.md).

## 9. Control Plane vs. Communication Plane

Termination should not be expressed as just another discussion message.

If a parent must forcibly stop a child, that is a control-plane action below the level of negotiated dialogue.

> **原则 P6（控制与通信分离）**：强制终止是控制平面的操作，通过状态机代码逻辑直接实现，而非通过ConversationLedger写入一条"终止消息"来间接表达。

This preserves a clean separation between:

- **communication**: shared reasoning facts
- **control**: authoritative runtime operations such as forced termination

## 10. Related Detailed Documents

- Communication and projection foundations: [conversation-model.md](./conversation-model.md)
- Compression model: [context-compression.md](./context-compression.md)
- Layering and delegation semantics: [hierarchy-and-layers.md](./hierarchy-and-layers.md)
- FSM and tool availability: [state-machine-and-tools.md](./state-machine-and-tools.md)

---

## Change Log

- **v3.0 (2026-04-12)**: Extracted from `framework-design.md` during the overview/module split. This file now holds the detailed action protocol and runtime semantics while the overview remains the canonical entry point and index.
