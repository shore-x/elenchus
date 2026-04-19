---
title: "Elenchus Framework Design: Dual-Agent Deliberation Unit"
date: 2026-04-13
version: 8.0
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
| [`framework-design/knowledge-view.md`](./framework-design/knowledge-view.md) | 知识视图专题 | 文件系统认知底座、AGENT.md 局部知识入口页、单目的地知识空间、逻辑领地模型、无状态Agent知识模型、软结构约定、跨目录引用、skill 重吸收、治理机制暂不纳入 |

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
- **持久化与恢复**：运行状态、记忆、聊天历史与子单元图如何落盘，并在冷启动后按需恢复。
- **知识共享**：Agent之间如何通过持久化知识产物（.md 文件）进行跨单元、跨轮次的知识传递与协作。

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
当存在已持久化的 `Memory Snapshot` 时，冷启动恢复不必急于加载完整聊天历史，而应优先用 `Memory Snapshot + Recent Raw Window` 重建继续 deliberation 所需的最小工作集。

### 2.4 知识视图（已收敛方向）

Elenchus 已将 installable skills 与长期记忆统一到同一个 **knowledge view** 中。知识视图不是独立知识库，而是文件系统上的可导航认知视图。

- 文件系统是 agent 的统一工作底座；知识不是另一套存储，而是底座上的认知组织层。
- 在值得长期语义化的目录下放置 **`AGENT.md`** 作为局部知识入口页，帮助 agent 以低成本理解该目录。
- `AGENT.md` 不采用强制固定结构，常见分层写法（目录介绍 + 局部索引）只是软约定；不同目录下的 `AGENT.md` 可以互相引用。
- `AGENT.md` 的职责是帮助理解目录，而不是约束 agent 行为；它不是目录级 manifest 或 system prompt。
- 传统 `skill` 不再作为独立存储本体存在，而是被重新吸收为可行动知识区域的一种组织结果。
- 知识膨胀、漂移、腐烂、冲突整理与过时知识清理等问题，后续将以 **knowledge anti-entropy** 专题继续设计。
- **Agent 不持有文件系统领地**：Agent 是纯运行时线程（P10），上下文在内存 + SQLite 中，对文件系统只有读写操作。知识存在于共享的文件系统中，不属于任何 agent。
- **单目的地知识空间**：知识只有一个目的地——工作所在的位置。Agent 不需要做"全局还是项目"的范围判断，知识写在工作自然归属的位置。发现通过消息通道（report + 绝对路径）和导航（AGENT.md），不通过存储分区。
- **逻辑领地模型**：Elenchus agent 集体 = 用户的合作者，拥有统一的工作空间（workspaceRoot）。项目边界是 agent 分工的结果，不是系统结构的前提。L0 可同时协调多个项目，每个 child 的 cwd 是其任务所属项目的根（从 task brief 自动推断）。
- **workspaceRoot**（用户可配置，默认 `~/Elenchus/`）：工作空间根目录，L0 的 bash cwd，存放 AGENT.md 导航页和框架状态（`.elenchus-state/state.db`）。不是 agent 的写入目的地——agent 写在工作所在的项目位置。
- 详细设计见 [`framework-design/knowledge-view.md`](./framework-design/knowledge-view.md) 和 [`workspace-ownership-analysis.md`](./workspace-ownership-analysis.md) §8-9。

#### 2.4.1 双通道通信：消息 + 知识文件

Agent 之间的协作依赖两个本质不同的通信通道：

| | 消息通道 | 知识通道（.md 文件） |
|---|---|---|
| **带宽** | 窄 — 受上下文窗口硬约束 | 宽 — 按需读取，不读不占上下文 |
| **时态** | 即时 — 发送即触发消费 | 持久 — 写一次，任意时刻可读 |
| **消费模式** | 推送式 — 到达即处理 | 拉取式 — 按需、选择性读取 |
| **生命周期** | 轮次级 — 属于对话历史 | 跨轮次 — 独立于任何单次对话 |
| **核心职能** | 信号 / 触发 / 协调 | 知识传递 / 工作产物 / 长期记忆 |

- **消息通道**用于 agent 之间的即时沟通与工作触发。消息到达即触发接收方开始工作，承载信号、协调意图和轻量摘要。
- **知识通道**通过文件系统中的 `.md` 文件实现跨单元、跨轮次的持久化知识共享。Agent 将工作记录、经验总结等保存为 `.md` 文件，在向上回报中提供文件路径以便其他 agent 按需读取。知识文件存放在项目中有意义的位置，不属于任何特定 agent。
- 消息通道不应承载详细工作成果；知识通道不应承担即时触发职责。两者互补，不互相替代。
- 消息通道中的载荷应保持自然对话语言风格，而非文档式 Markdown。结构化结论、详细分析、步骤化产出等应写入 .md 文件并通过知识通道共享；消息中仅引用文件路径。这遵循 **P29（消息通道对话风格）** 原则。
- Agent 读取其他 agent 产出的知识文件时，应以引用 + 按需读取为主，避免大规模数据冗余（复制）。若需要整合知识，应产出自己的理解/摘要，而非镜像原始文件。

此设计遵循 **P27（双通道通信）** 与 **P29（消息通道对话风格）** 原则。详细设计见 [`framework-design/knowledge-view.md`](./framework-design/knowledge-view.md) §11-12 与 [`framework-design/hierarchy-and-layers.md`](./framework-design/hierarchy-and-layers.md) §5.1。

### 2.5 本章相关核心原则

- **P1**：统一消息模型
- **P4**：轮次可见性边界
- **P7**：通信载荷非结构化，记录封套结构化
- **P11**：公共事实完整性优先于当前压缩
- **P12**：公共事实广播与控制指令分离
- **P14**：每轮统一投影视图
- **P15**：新消息边界显式化
- **P16**：受众显式性
- **P17-P20 / P22-P23 / P26**：压缩视图与方向命名相关原则
- **P29**：消息通道对话风格

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

当前实现还引入了面向冷启动的恢复边界：运行目录下的 `.elenchus/state.db` 保存可恢复的 session 持久化状态。SQLite 中保留全量 durable history，而冷启动恢复只重建继续 deliberation 所需的工作集。当前 schema 明确不依赖数据库外键维护 unit graph 完整性；关系一致性由应用层持久化逻辑与“先保存 unit、后保存 relation”的写入顺序保证。当前 schema 通过 `schema_meta` 中的显式版本号管理；在快速演进阶段，如版本不匹配则直接重建本地数据库，而不承诺旧库兼容迁移。重启时不会尝试恢复半个 turn 或半个执行过程；若持久化状态是 `TurnA`、`TurnB` 或 `Executing`，则统一归一化到 `Idle`，并补写恢复事实供后续轮次理解中断背景。

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

- **L0**：协调层，负责理解、拆分与汇总。L0 拥有环境工具能力，但通过 prompt 策略约束其用途为信息获取与知识空间维护，不直接执行任务。
- **L1**：主力规划+执行层，既能管理子单元，也能使用环境工具执行任务。
- **L2**：叶子执行层，只做环境操作，不再继续派生子单元。

### 4.2 层级对称与层级同构

顶层人类操作者在概念上可视为 `L-1` 父层，因此顶层与父子层之间不需要两套不同协议。所有层级共享相同 FSM、相同 proposal-vote 协议与相同 prompt 结构。

层级同构原则（P9）已从"工具集差异 = 行为差异"演变为"完整能力 + 角色策略差异 = 行为差异"。所有层级现在拥有相同的工具集；行为差异由 prompt 中的角色策略定义，而非由工具可用性决定。这更接近真实组织中的分工方式——角色定义行为，而非能力限制行为。详细讨论见 [`framework-design/hierarchy-and-layers.md`](./framework-design/hierarchy-and-layers.md) §3。

### 4.3 Prompt 同构与知识模型

框架不依赖“不同层级不同 prompt 规则”来塑造行为，而是依赖：

- 共享协作协议
- Agent A / Agent B 的认知风格差异
- 当前可用工具列表（所有层级现在拥有相同工具集）
- **层级角色策略**：通过 prompt 注入层级角色定义，约束工具使用范围（如 L0 仅用于信息获取与知识维护）
- 知识视图（Knowledge View）：通过 system prompt 注入全局根目录路径、项目根目录路径、AGENT.md 导航机制和知识空间边界约束

知识视图将外部先验知识统一为文件系统上的可导航认知视图，采用**单目的地 + 逻辑领地**架构：**workspaceRoot**（用户可配置，默认 `~/Elenchus/`）是工作空间根目录和 L0 的 bash cwd。每个 child 的 projectRoot 从 task brief 自动推断。仅 workspaceRoot AGENT.md 注入 system prompt；child 的项目 AGENT.md 通过 readFile 按需读取。详细设计见 [`knowledge-view.md`](./framework-design/knowledge-view.md)。

同时，框架采用 **无状态Agent + 外部化知识** 模型（P10）：Agent 是纯运行时线程，不持有文件系统领地。知识存在于共享的文件系统中，不属于任何 agent。Agent 的运行时上下文（ConversationLedger、CompressionSnapshot、FSM state）保存在内存与 SQLite 中；文件系统中的知识产物是共享世界的组成部分，任何 agent 都可以读写。
`spawnChild` 提供的是子任务的初始 brief，而不是“完整上下文已经一次性传完”的保证；后续上下文通过两个通道持续流动：**消息通道**（`report`、`yield`、`sendToChild`）负责即时协调与工作触发，**知识通道**（.md 文件）负责持久化工作成果与经验传递。

对于复杂任务，父层可在多个 turn 中逐步形成多个 delegated workstream，而不必把所有子问题强行压进单一 child workflow。新消息到来时，应判断它更适合通过 `sendToChild` 并入既有 child 的工作流，还是更适合作为新的独立工作流生成新的 child。

### 4.3.1 子 Agent 生命周期：固定 Slot 池

父 agent 拥有固定数量的协调 slot（N），每个 child 占用一个 slot，无论其处于何种状态（active/idle/sleeping）。所有 child 始终对父 agent 可见——不存在隐藏/dormant 状态。

当所有 N 个 slot 已满时，父 agent 无法创建新 child，需通过**协作式调度**回收 slot：
1. 父 agent 通过 `sendToChild` 请求某个 child 收尾当前工作并 yield
2. child 保存工作产物到文件系统，yield 进入 idle
3. 父 agent 通过 `sendToChild` 向该 idle child 分配新任务

框架不提供强制重置子 agent 上下文的机制。当 child 从旧任务过渡到新任务时，三层自调节机制确保过渡自然：
- **任务亲和性**：父 agent 倾向于将相关任务分配给有相关上下文的 child
- **压缩自调节**：旧上下文与新任务无关时，context 压力触发 `compressContext`，child 自然聚焦新任务
- **知识外化**：旧任务的工作产物已在文件系统中，child 不需要"记住"旧任务

此设计取代了之前的 unmount/remount 模型。详细推理见 [`framework-design/workspace-ownership-analysis.md`](./framework-design/workspace-ownership-analysis.md) 第七节。

### 4.4 `commitLog` 可见性边界

父层当前观察的是子单元的 **已提交推进步骤**，而不是子单元全部实时活动流。

- `proposedStep`：提议动作对任务推进的意义
- `committedStep`：proposal 获批后固化的已提交步骤
- `commitLog`：子单元已提交步骤的历史序列

`commitLog` 记录的是 **accepted steps**，不是 success history；`APPROVE` 是提交边界。

### 4.5 本章相关核心原则

- **P3**：层级对称
- **P9**：层级同构（已演变为完整能力 + 角色策略差异）
- **P10**：无状态Agent
- **P27**：双通道通信
- **P28**：L0 角色策略约束
- **P29**：消息通道对话风格

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

可用性规则已随 L0 工具扩展而简化：

- 子Agent管理工具仅非叶子层可用
- 环境工具所有层级都可用（L0 通过 prompt 策略约束为信息获取与知识维护用途）
- 协议工具所有层级都可用（其中部分工具按状态条件注入）

L0 现在可以进入 `Executing` 状态（当执行 `readFile`/`writeFile`/`bash` 等阻塞式环境工具时），但其 prompt 策略约束使得 L0 的环境工具使用范围与 L1/L2 有本质差异。

知识视图的正式设计见 [`framework-design/knowledge-view.md`](./framework-design/knowledge-view.md)。

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
| P10 | 无状态Agent（不持有文件系统领地；上下文可保留但可压缩，知识在文件系统中） | Hierarchy and Layers / Knowledge View |
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
| P27 | 双通道通信 | Knowledge View / Hierarchy and Layers |
| P28 | L0 角色策略约束 | Hierarchy and Layers |
| P29 | 消息通道对话风格 | Conversation Model |

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
| Knowledge View | 文件系统上的可导航认知视图。skill、memory、脚本、中间结果等统一属于同一外部资源空间，不再按存储本体分裂为独立子系统；AGENT.md 是局部知识入口页 |
| 知识通道（Knowledge Channel） | Agent 之间通过文件系统中的 .md 文件进行持久化知识共享的通信通道；与消息通道互补，承载工作产物、长期记忆与跨轮次知识传递 |
| 消息通道（Message Channel） | Agent 之间通过 ConversationLedger 进行即时沟通与工作触发的通信通道；承载信号、协调意图与轻量摘要 |
| 单目的地知识空间（Single-Destination Knowledge Space） | 知识只有一个目的地——工作所在的位置。Agent 不做"全局还是项目"的范围判断，知识写在工作自然归属的位置。发现通过消息通道和导航，不通过存储分区 |
| 层级角色策略（Layer Role Policy） | 通过 prompt 注入的层级角色定义，约束各层级对共享工具集的使用范围；如 L0 的环境工具仅用于信息获取与知识维护，不用于直接任务执行 |
| 逻辑领地（Logical Territory） | 项目留在文件系统原位，框架适应用户的目录布局。workspaceRoot 是逻辑概念上的领地根，不要求物理上包含所有项目 |
| 合作者模型（Collaborator Model） | Elenchus agent 集体被视为与用户平等的合作者，拥有统一工作空间，可同时协调多个项目。跨项目可见性是协调前提而非噪声 |
| AGENT.md | 目录级局部知识入口页 / 语义着陆页。帮助 agent 以低成本理解目录：用途、边界、入口、关联。不采用强制固定结构，不充当目录级 manifest 或行为约束文件；不同目录下的 AGENT.md 可以互相引用 |
| workspaceRoot | 工作空间根目录（用户可配置，默认 `~/Elenchus/`）。L0 的 bash cwd，存放 AGENT.md 导航页和框架状态（`.elenchus-state/state.db`）。不是 agent 的写入目的地 |
| Schema Version | SQLite 持久化 schema 的显式版本号，当前由 `schema_meta` 管理，用于判断本地数据库是否需要重建 |
| 开发期重建（Development-time Rebuild） | 当前 SQLite schema 在快速演进阶段采取的版本升级策略：schema 不匹配时直接重建本地数据库，而不是执行兼容迁移 |
| CompressionTaskManager | 管理 unit 级压缩任务生命周期的运行时组件，负责活动任务状态、重复抑制与有限重试 |
| 提议（Proposal） | Agent 通过工具调用提出的、需要另一侧表决的动作请求 |
| 表决（Vote） | 对待决 proposal 的 APPROVE 或 REJECT 判定 |
| 协调 Slot（Coordination Slot） | 父 agent 用于管理子单元的固定位置。每个 child 占用一个 slot，无论其状态。Slot 满时需通过协作式调度（sendToChild → yield → reassign）回收 |
| 协作式调度（Cooperative Scheduling） | 当所有 slot 已满时，父 agent 通过 sendToChild 请求 child 收尾并 yield，然后分配新任务的 slot 回收方式。不提供强制重置子 agent 上下文的机制 |
| proposedStep | proposal-producing tool call 上的短语义字段，表达“该动作对任务推进的意义” |
| committedStep | proposal 获批后固化的已提交步骤 |
| commitLog | 归属于 Agent Unit 的已提交步骤的历史序列，表示该单元正式接受过哪些任务推进步骤，而非成功历史 |

## 版本历史

- **v8.1 (2026-04-19)**：新增 P29（消息通道对话风格）原则：消息通道载荷应保持自然对话语言，结构化产出写入 .md 文件并通过知识通道共享。同步更新 §2.4.1、§2.5、原则索引、术语表；同步更新 `conversation-model.md`。
- **v8.0 (2026-04-18)**：知识空间从双根模型迁移到单目的地 + 逻辑领地模型。消除"全局 vs 项目"的范围判断——知识只写在工作所在的位置。workspaceRoot（用户可配置，默认 `~/Elenchus/`）取代 `~/.elenchus/` 作为工作空间根目录。L0 bash cwd = workspaceRoot；child projectRoot 从 task brief 自动推断。仅 workspaceRoot AGENT.md 注入 prompt。SQLite state.db 移至 workspaceRoot 下。移除 `~/.elenchus/knowledge/` 作为 agent 写入目的地。引入合作者模型：agent 集体 = 用户的合作者，跨项目可见性是协调前提。术语表更新：双层知识空间 → 单目的地知识空间，全局根目录 → workspaceRoot。同步更新 `workspace-ownership-analysis.md` §8-9、`knowledge-view.md`。
- **v7.0 (2026-04-18)**：子 Agent 生命周期从 unmount/remount 模型迁移到固定 Slot 池模型。移除 `unmountChild` 工具、mounted/dormant 可见性维度。父 agent 拥有固定数量协调 slot，所有 child 始终可见。Slot 回收通过协作式调度（sendToChild → yield → reassign）。不提供强制上下文重置，依赖任务亲和性 + 压缩自调节 + 知识外化三层机制。更新 §4.3.1、§5.2、§5.3、术语表、原则索引（P10 扩展）。同步更新 `workspace-ownership-analysis.md` 第七节。
- **v6.0 (2026-04-17)**：引入双层根目录架构：globalRoot（`~/.elenchus/`）+ projectRoot（cwd/git root）。全局根存储跨项目知识（`knowledge/`）、按项目运行时状态（`projects/<hash>/state.db`）、全局 AGENT.md；项目根是 bash cwd 与项目知识产物位置。Prompt 注入改为全局 + 项目双 AGENT.md。Session 持久化从 `<projectRoot>/.elenchus/state.db` 迁移到 `~/.elenchus/projects/<hash>/state.db`。术语表更新：共享知识空间 → 双层知识空间，`.elenchus` 运行目录 → `~/.elenchus/` 全局根目录。同步更新 §2.4、§4.3、文档地图、术语表。
- **v5.0 (2026-04-17)**：移除 per-agent workspace 概念，Agent 不再持有文件系统领地。从 P10 第一性原理推导：Agent = 纯运行时线程，知识存在于共享文件系统中。所有 agent 的 bash cwd 统一为 workspaceRoot。知识产物存放在项目中有意义的位置而非 per-agent 目录。冲突管理依赖 L0 协调 + proposal-vote + git，而非结构隔离。新增 `workspace-ownership-analysis.md` 推理链文档记录设计推导过程。同步更新总纲中 §2.4、§4.3、原则索引（P10 扩展）、术语表（Agent 工作空间 → 共享知识空间）。[Superseded by v6.0]
- **v4.0 (2026-04-16)**：引入双通道通信架构（消息通道 + 知识通道），新增 P27（双通道通信）与 P28（L0 角色策略约束）原则。L0 获得完整环境工具能力，通过 prompt 策略约束用途为信息获取与知识空间维护；层级同构原则（P9）从“工具集差异 = 行为差异”演变为“完整能力 + 角色策略差异 = 行为差异”。新增 agent 工作空间概念，每个 agent unit 管理自己的目录，知识通过 .md 文件跨单元共享。同步更新总纲中 §1.2、§2.4、§4.1-4.3、§5.3、原则索引、术语表。
- **v3.9 (2026-04-14)**：将知识空间方向从"探索中"收敛为正式设计。新增专题文档 `knowledge-view.md` 替代旧 `skill-system.md`；知识视图定义为文件系统上的可导航认知视图，AGENT.md 作为局部知识入口页替代旧 skill manifest；传统 skill 被重新吸收为可行动知识区域的组织结果。同步更新总纲中文档地图、§2.4、§5.3、术语表。
- **v3.8 (2026-04-13)**：在总纲中记录统一 knowledge space 的方向：开始探索将 installable skills 与长期记忆收敛到同一外部知识底座中，并引入 `Resident Knowledge` 作为常驻知识入口术语。明确当前仍未决定 `Resident Knowledge` 是统一集合还是分散节点摘要视图，也未决定 knowledge space 是否完全由文件系统独占实现；同时预留后续 knowledge anti-entropy 专题用于处理知识膨胀、漂移、腐烂与清理问题。
- **v3.7 (2026-04-13)**：将 skill 运行时从启动期静态 bundle 升级为 turn-boundary capability provider。新增内建 blocking tool `installSkill`，当前支持从本地合法 skill package 目录执行热安装；安装成功后刷新 capability snapshot，并从下一次 turn 开始注入新的 skill prompt appendix 与 skill tools。同步更新总纲中的第四章、第五章摘要以反映热安装语义。
- **v3.6 (2026-04-12)**：补充 SQLite 持久化的实现边界：当前 schema 不依赖数据库外键维护 unit graph，而由应用层持久化逻辑与保存顺序保证关系一致性；同时记录 `schema_meta` 版本号与开发期“版本不匹配即重建本地数据库”的策略。
- **v3.5 (2026-04-12)**：将持久化实现从文件系统整份快照收敛为嵌入式 SQLite。当前默认数据库文件为 `.elenchus/state.db`；数据库保留全量 durable history，而冷启动恢复只按需重建 working set。既有冷启动归一化与“unmounted child 保留但默认不恢复”语义保持不变。
- **v3.4 (2026-04-12)**：在总纲中加入文件系统持久化与冷启动恢复高层摘要。明确当前实现将可恢复 session 状态保存在运行目录下的 `.elenchus/` 中；`Memory Snapshot + Recent Raw Window` 同时承担启动工作集角色；冷启动时 `TurnA` / `TurnB` / `Executing` 统一归一化到 `Idle`；已解除挂载的 child 仍保留于磁盘，但默认不恢复进 active runtime graph。
- **v3.3 (2026-04-12)**：在总纲中补充 child **解除挂载 / 自动重新挂载** 语义：父层可对 `idle` child 执行解除挂载，使其从父 agent 可见上下文中消失但保留程序中的父子从属关系；重新挂载仅由新的 `upward-message` 触发，并以轻量 runtime 广播提示可见性恢复。同步将 `unmountChild` 纳入 child-management 工具摘要与术语表。
- **v3.2 (2026-04-12)**：在层级结构高层摘要中补充多 child 渐进式拆解与“新消息路由”原则：复杂任务可跨 turn 逐步形成多个 delegated workstream；新信息若与既有 child workflow 实质相关，可考虑通过 `sendToChild` 纳入原工作流，否则可考虑生成新的 child。
- **v3.1 (2026-04-12)**：重写 `report` / `yield` 高层语义：两者统一视为常态 upward communication family，而非异常升级路径。`report` 表示向上沟通且保留本地主动推进，`yield` 表示向上沟通并交还当前阶段主动权后暂停；明确 `yield` 可在信息不足时主动请求补充信息。同步澄清 `spawnChild` 只提供初始 brief，父子上下文应通过 `report` / `yield` / `sendToChild` 持续流动。
- **v3.0 (2026-04-12)**：将 `framework-design.md` 重构为总纲 + 索引，并拆分出 5 份专题文档：`conversation-model.md`、`context-compression.md`、`protocol-and-runtime.md`、`hierarchy-and-layers.md`、`state-machine-and-tools.md`。在总文档与专题文档中加入双向同步提醒，用于提示 AI 与人类在修改一侧时检查另一侧是否需要同步更新。
- **v2.2 (2026-04-12)**：引入 Yield / Report / Sleep 三分语义：向上交付 + 暂停、向上协调 + 继续、仅暂停。新增方向命名规则——使用 `incoming` 表示收到的消息，使用 `upward` 表示发往上层的消息，并明确弃用方向歧义的 `upstream_message`。
- **v2.1 (2026-04-12)**：统一术语分层，将运行时产生的共享广播与条件注入语义统一收敛为 `Unit Runtime`，并统一工具类别命名。
- **v1.9 (2026-04-11)**：通信模型重构——以 `ConversationLedger` 取代 `MessageBus` 作为 unit 级结构化聊天事实账本；新增 `turnAuthored` / `visibleFromTurn` 轮次语义与 `ConversationProjector` 投影层。
- **v1.8 (2026-04-11)**：将子单元可见性收敛为 `commitLog` 方案，引入 `proposedStep`、`committedStep`、`commitLog` 三层命名与 `APPROVE` 作为 commit 边界。
- **v1.6-v1.0**：建立对称双Agent、层级同构、无状态Agent、prompt同构等核心方向，并逐步收敛协议语义。
