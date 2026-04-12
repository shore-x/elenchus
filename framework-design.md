---
title: "Elenchus Framework Design: Dual-Agent Deliberation Unit"
date: 2026-04-12
version: 3.1
---

# Elenchus Framework Design: Dual-Agent Deliberation Unit

> Elenchus（苏格拉底诘问法）——通过对话与质疑逼近真理。本框架将这一哲学方法形式化为
> 一个可计算的双Agent协作协议。

本文档现作为 **总纲 + 索引** 使用：提供全局设计摘要、原则索引、术语基线与专题导航。
详细模块设计已拆分至 `framework-design/` 目录下的专题文档。

> **Synchronization note**
> - 本文档是拆分后的**总入口**。若修改这里的高层摘要、原则索引、术语表或模块边界，需检查对应专题文档是否需要同步修改。
> - 若修改 `framework-design/` 下任一专题文档中的详细语义，也需回看本文档中的摘要、原则索引、术语表与导航是否仍然准确。
> - 对 AI 辅助 coding 而言，应先用本文档建立全局坐标，再进入对应专题文档处理局部细节。

## 文档地图

| 文档 | 角色 | 主要内容 |
| :------ | :------ | :------ |
| `framework-design.md` | 总纲 / 索引 | 全局摘要、原则索引、术语基线、专题导航 |
| [`framework-design/conversation-model.md`](./framework-design/conversation-model.md) | 会话模型专题 | `ConversationLedger`、`ConversationProjector`、公共事实与 overlay、方向命名 |
| [`framework-design/context-compression.md`](./framework-design/context-compression.md) | 压缩专题 | `Memory Snapshot + Recent Raw Window`、压缩提醒、`compressContext`、`CompressionTaskManager` |
| [`framework-design/protocol-and-runtime.md`](./framework-design/protocol-and-runtime.md) | 协议与运行时专题 | proposal-vote、阻塞/非阻塞、副作用落账、向上通信、控制平面 |
| [`framework-design/hierarchy-and-layers.md`](./framework-design/hierarchy-and-layers.md) | 层级与委派专题 | L0/L1/L2、prompt同构、无状态Agent、父子协调、`commitLog` |
| [`framework-design/state-machine-and-tools.md`](./framework-design/state-machine-and-tools.md) | FSM与工具面专题 | 五状态FSM、转移规则、轮次内部协议、工具分类与层级可用性 |

## 第一章 问题定义：我们在构建什么？

### 1.1 出发点

Elenchus 的核心思路是：通过两个具有互补认知策略的对称 Agent 进行结构化对话，把原本隐含在 LLM 内部的自我校验过程外部化，并将其组织为一个可运行的协作协议。

### 1.2 核心工程挑战

框架要解决五类问题：

- **通信**：消息如何表达、记录、投影、跨轮可见。
- **决策**：行动如何从单方意图变成双Agent共识。
- **环境交互**：外部操作何时阻塞、何时异步。
- **任务分解**：复杂任务如何通过子单元分层展开。
- **状态管理**：单元在任意时刻处于何种状态，以及如何转换。

### 1.3 设计目标

- **协议简洁性**：用尽量少的核心概念覆盖尽量多的场景。
- **行为确定性**：turn 边界与消息可见性应可复现。
- **Agent自治**：框架给出协议边界，但不替 Agent 做任务判断。
- **可扩展性**：从 L0 到多层子单元的扩展不应要求重写核心协议。

---
## 第二章 通信模型与上下文构造

本章仅保留高层摘要；完整细节已迁移至：

- [`framework-design/conversation-model.md`](./framework-design/conversation-model.md)
- [`framework-design/context-compression.md`](./framework-design/context-compression.md)

### 2.1 总体结论

Elenchus 将“消息内容”与“消息记录”分开处理：

- **消息载荷**保持自然语言，以保留表达力。
- **消息封套**保持结构化，以支持身份、语义类型、轮次可见性和生命周期回写。

所有对某个 Agent Unit 有持续推理价值的共享事实，统一进入 `ConversationLedger`；agent 每一轮看到的上下文，则由 `ConversationProjector` 在 turn 边界基于 ledger 快照重新投影得到。

### 2.2 核心边界

- **事实层 vs 视图层**：ledger 保存完整事实；projector 负责 agent-visible 视图。
- **公共事实 vs 控制 overlay**：共享历史写入 ledger；当前轮动作约束只作为私有 overlay 注入。
- **轮次可见性边界**：消息在异步写入后，仅从 `visibleFromTurn` 起被后续轮次看到。
- **方向命名显式化**：收到的消息使用 `incoming`，向上发送的消息使用 `upward`。

### 2.3 压缩视图摘要

当原始上下文过长时，projector 可派生出两层 agent-visible 上下文：

- **Memory Snapshot**：弱结构化自然语言任务状态快照。
- **Recent Raw Window**：最近原始上下文窗口。

压缩属于投影层派生视图，不能回写或污染 `ConversationLedger`。详细约束见 [`context-compression.md`](./framework-design/context-compression.md)。

### 2.4 本章相关核心原则

- **P1**：统一消息模型
- **P4**：轮次可见性边界
- **P7**：通信载荷非结构化，记录封套结构化
- **P11**：公共事实完整性优先于当前压缩
- **P12**：公共事实广播与控制指令分离
- **P14**：每轮统一投影视图
- **P15**：新消息边界显式化
- **P16**：受众显式性
- **P17-P20 / P22-P23 / P26**：压缩视图与方向命名相关原则

## 第三章 行动协议与运行时语义

本章仅保留高层摘要；完整细节已迁移至：

- [`framework-design/protocol-and-runtime.md`](./framework-design/protocol-and-runtime.md)
- [`framework-design/context-compression.md`](./framework-design/context-compression.md)

### 3.1 总体结论

框架采用 **proposal-vote** 作为统一行动协议：除 `vote` 外，所有工具调用都先形成 proposal，必须经另一侧 `APPROVE` 才能生效。

工具的阻塞性由操作对象决定：

- **环境操作**：阻塞式，进入 `Executing`
- **自治体/后台任务操作**：非阻塞式，副作用异步落账，状态机正常轮转

### 3.2 向上通信与暂停语义

框架将“向上沟通”与“是否暂停”拆成两个可组合的协调维度：

- **Yield** = 向上沟通 + 交还当前阶段主动权 + 暂停
- **Report** = 向上沟通 + 保留本地主动推进
- **Sleep** = 不向上沟通，仅暂停

其中 `yield` 与 `report` 构成同一个 upward communication family，都会在本地 ledger 中写入 `upward_message`；两者差别不在于“轻重”或“是否异常”，而在于消息发出后当前 unit 是否保留本地主动推进， 而不是成功/失败等业务结论。

### 3.3 异步运行时事实

只要某个 Unit Runtime 事件会影响后续双Agent协作推理，它就应写入 `ConversationLedger` 并作为公共事实广播，而不是只做私有 ACK。

### 3.4 控制平面边界

父层对失控子单元的强制终止属于**控制平面**操作，而非一条普通聊天消息。这一点保证“协作消息”和“强制控制”在语义上不混杂。

### 3.5 本章相关核心原则

- **P2**：Agent自治
- **P6**：控制与通信分离
- **P8**：阻塞性由操作对象决定
- **P13**：异步Unit Runtime事件也属于公共事实
- **P21 / P24 / P25**：压缩任务工具与其生命周期管理原则

## 第四章 层级结构与任务分解

本章仅保留高层摘要；完整细节已迁移至：

- [`framework-design/hierarchy-and-layers.md`](./framework-design/hierarchy-and-layers.md)

### 4.1 总体结论

Elenchus 使用固定三层架构：`L0 | L1 | L2`。

- **L0**：协调层，只做理解、拆分与汇总，不直接操作环境。
- **L1**：主力规划+执行层，既能管理子单元，也能使用环境工具。
- **L2**：叶子执行层，只做环境操作，不再继续派生子单元。

### 4.2 层级对称与层级同构

顶层人类操作者在概念上可视为 `L-1` 父层，因此顶层与父子层之间不需要两套不同协议。所有层级共享相同 FSM、相同 proposal-vote 协议与相同 prompt 结构；差异只来自工具集注入。

### 4.3 Prompt 同构与知识模型

框架不依赖“不同层级不同 prompt 规则”来塑造行为，而是依赖：

- 共享协作协议
- Agent A / Agent B 的认知风格差异
- 当前可用工具列表

同时，框架采用 **无状态Agent + 外部化知识** 模型：知识不应沉淀为某个实例不可替代的隐藏积累，而应通过父层注入与外部资源传递。
`spawnChild` 提供的是子任务的初始 brief，而不是“完整上下文已经一次性传完”的保证；后续上下文应通过 `report`、`yield` 与 `sendToChild` 在父子之间持续流动。

对于复杂任务，父层可在多个 turn 中逐步形成多个 delegated workstream，而不必把所有子问题强行压进单一 child workflow。新消息到来时，应判断它更适合通过 `sendToChild` 并入既有 child 的工作流，还是更适合作为新的独立工作流生成新的 child。

### 4.4 `commitLog` 可见性边界

父层当前观察的是子单元的 **已提交推进步骤**，而不是子单元全部实时活动流。

- `proposedStep`：提议动作对任务推进的意义
- `committedStep`：proposal 获批后固化的已提交步骤
- `commitLog`：子单元已提交步骤的历史序列

`commitLog` 记录的是 **accepted steps**，不是 success history；`APPROVE` 是提交边界。

### 4.5 本章相关核心原则

- **P3**：层级对称
- **P9**：层级同构
- **P10**：无状态Agent

---
## 第五章 状态模型与工具面

本章仅保留高层摘要；完整细节已迁移至：

- [`framework-design/state-machine-and-tools.md`](./framework-design/state-machine-and-tools.md)

### 5.1 最小状态区分

框架采用五状态有限状态机：

- **Idle**
- **TurnA**
- **TurnB**
- **Executing**
- **Terminated**

其设计依据是：只有在行为存在本质差异时才拆分状态。

### 5.2 状态转移摘要

- `Idle -> TurnA`：收到触发消息
- `TurnA/TurnB -> Executing`：批准阻塞式提议
- `Executing -> 对侧Turn`：工具结果返回
- `TurnA/TurnB -> Idle`：批准 `yield` 或 `sleep`
- `* -> Terminated`：父层强制终止

对 `report`、`spawnChild`、`sendToChild`、`compressContext` 等非阻塞式提议，状态机正常轮转，不进入 `Executing`。

### 5.3 工具面摘要

当前工具面可分为三类：

- **Protocol**：`vote`、`yield`、`report`、`compressContext`
- **Child management**：`spawnChild`、`sendToChild`、`sleep`
- **Environment**：`bash`、`readFile`、`writeFile`

可用性规则保持简单：

- 子Agent管理工具仅非叶子层可用
- 环境工具仅非纯协调层可用
- 协议工具所有层级都可用（其中部分工具按状态条件注入）

### 5.4 本章相关核心原则

- **P5**：最小状态区分

---
## 附录A 设计原则索引

本文档保留全局原则索引，作为所有专题文档的共同上位约束。当某个边界情况在专题文档中未被直接覆盖时，应先回溯这些原则，再决定是否同步修改专题文档与本总纲。

| 编号 | 名称 | 主要归属专题 |
| :------ | :------ | :---------- |
| P1 | 统一消息模型 | Conversation Model |
| P2 | Agent自治 | Protocol and Runtime |
| P3 | 层级对称 | Hierarchy and Layers |
| P4 | 轮次可见性边界 | Conversation Model |
| P5 | 最小状态区分 | State Machine and Tools |
| P6 | 控制与通信分离 | Protocol and Runtime |
| P7 | 通信载荷非结构化，记录封套结构化 | Conversation Model |
| P8 | 阻塞性由操作对象决定 | Protocol and Runtime |
| P9 | 层级同构 | Hierarchy and Layers |
| P10 | 无状态Agent | Hierarchy and Layers |
| P11 | 公共事实完整性优先于当前压缩 | Conversation Model |
| P12 | 公共事实广播与控制指令分离 | Conversation Model |
| P13 | 异步Unit Runtime事件也属于公共事实 | Protocol and Runtime |
| P14 | 每轮统一投影视图 | Conversation Model |
| P15 | 新消息边界显式化 | Conversation Model |
| P16 | 受众显式性 | Conversation Model |
| P17 | 压缩属于投影层派生视图 | Context Compression |
| P18 | 双层上下文视图 | Context Compression |
| P19 | 弱结构化自然语言快照 | Context Compression |
| P20 | 注入契约的信息性优先 | Context Compression |
| P21 | 压缩任务工具的语义收敛 | Context Compression / Protocol and Runtime |
| P22 | 压缩提醒是柔性的状态提示 | Context Compression |
| P23 | 压缩提醒受活动任务抑制 | Context Compression |
| P24 | 单unit单活动压缩任务 | Context Compression / Protocol and Runtime |
| P25 | 有限重试后回到deliberation | Context Compression / Protocol and Runtime |
| P26 | 方向命名显式化 | Conversation Model |

## 附录B 术语表

| 术语 | 定义 |
| :------ | :------ |
| Agent单元（Agent Unit） | 由两个Agent组成的最小协作执行单位，也是一个状态机实例 |
| ConversationLedger | 每个Agent单元的结构化聊天事实账本。保存完整消息历史、轮次可见性信息、受控状态更新所需元数据，并为未来持久化预留空间 |
| ConversationProjector | 从ConversationLedger生成agent可见聊天视图的投影层；负责结构化消息到agent可见视图的转换、本轮控制提示与 newly visible 边界的 overlay 注入 |
| 进入消息（Incoming Message） | 相对于当前Agent Unit，从外部或上层进入本 unit 并写入 ConversationLedger 的结构化消息 |
| 向上消息（Upward Message） | 由当前 Agent Unit 向上层发送、同时作为本 unit 内部公共事实被记录的一条结构化消息。`report` 与 `yield` 同属 upward communication family；其 `deliveryMode` 区分的是消息发出后当前 unit 是否保留本地主动推进， 而不是成功/失败等业务结论 |
| 向上消息事件（upward-message event） | Unit Runtime 向上层发出的运行时事件，承载一条经 proposal-vote 批准的向上消息 |
| Public Fact Broadcast | 进入 ConversationLedger 并在后续轮次中作为共享历史参与推理的公共事实 |
| Directive Overlay | 仅在当前轮临时注入给当前 agent 的控制提示，不进入共享历史 |
| Memory Snapshot | 对既有聊天历史进行压缩后得到的弱结构化自然语言任务状态快照 |
| Recent Raw Window | 最近一段未压缩原始上下文窗口，用于保留局部连续性与近期细节 |
| CompressionTaskManager | 管理 unit 级压缩任务生命周期的运行时组件，负责活动任务状态、重复抑制与有限重试 |
| 提议（Proposal） | Agent 通过工具调用提出的、需要另一侧表决的动作请求 |
| 表决（Vote） | 对待决 proposal 的 APPROVE 或 REJECT 判定 |
| proposedStep | proposal-producing tool call 上的短语义字段，表达“该动作对任务推进的意义” |
| committedStep | proposal 获批后固化的已提交步骤 |
| commitLog | 归属于 Agent Unit 的已提交步骤的历史序列，表示该单元正式接受过哪些任务推进步骤，而非成功历史 |

## 版本历史

- **v3.2 (2026-04-12)**：在层级结构高层摘要中补充多 child 渐进式拆解与“新消息路由”原则：复杂任务可跨 turn 逐步形成多个 delegated workstream；新信息若与既有 child workflow 实质相关，可考虑通过 `sendToChild` 纳入原工作流，否则可考虑生成新的 child。
- **v3.1 (2026-04-12)**：重写 `report` / `yield` 高层语义：两者统一视为常态 upward communication family，而非异常升级路径。`report` 表示向上沟通且保留本地主动推进，`yield` 表示向上沟通并交还当前阶段主动权后暂停；明确 `yield` 可在信息不足时主动请求补充信息。同步澄清 `spawnChild` 只提供初始 brief，父子上下文应通过 `report` / `yield` / `sendToChild` 持续流动。
- **v3.0 (2026-04-12)**：将 `framework-design.md` 重构为总纲 + 索引，并拆分出 5 份专题文档：`conversation-model.md`、`context-compression.md`、`protocol-and-runtime.md`、`hierarchy-and-layers.md`、`state-machine-and-tools.md`。在总文档与专题文档中加入双向同步提醒，用于提示 AI 与人类在修改一侧时检查另一侧是否需要同步更新。
- **v2.2 (2026-04-12)**：引入 Yield / Report / Sleep 三分语义：向上交付 + 暂停、向上协调 + 继续、仅暂停。新增方向命名规则——使用 `incoming` 表示收到的消息，使用 `upward` 表示发往上层的消息，并明确弃用方向歧义的 `upstream_message`。
- **v2.1 (2026-04-12)**：统一术语分层，将运行时产生的共享广播与条件注入语义统一收敛为 `Unit Runtime`，并统一工具类别命名。
- **v1.9 (2026-04-11)**：通信模型重构——以 `ConversationLedger` 取代 `MessageBus` 作为 unit 级结构化聊天事实账本；新增 `turnAuthored` / `visibleFromTurn` 轮次语义与 `ConversationProjector` 投影层。
- **v1.8 (2026-04-11)**：将子单元可见性收敛为 `commitLog` 方案，引入 `proposedStep`、`committedStep`、`commitLog` 三层命名与 `APPROVE` 作为 commit 边界。
- **v1.6-v1.0**：建立对称双Agent、层级同构、无状态Agent、prompt同构等核心方向，并逐步收敛协议语义。
