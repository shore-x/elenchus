---
title: "Elenchus MVP Design: L0 Pure Deliberation"
date: 2026-04-08
version: 0.1
status: draft - pending approval
---

# Elenchus MVP Design: L0 Pure Deliberation

## 确认的决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 范围 | L0：纯双Agent对话，无环境工具 | 最快验证核心协议正确性 |
| UI | CLI终端输出 | 最简单直接 |
| Context模型 | 独立Context + 消息注入 | 贴合 Elenchus 消息总线设计 |
| LLM层 | `pi-ai`（`stream`/`complete`） | 多Provider、streaming、Tool定义 |
| Agent循环 | 自建，不用 `pi-agent-core` | 其自动tool执行循环与提议-表决机制冲突 |

## L0 MVP 验证目标

通过一个可运行的最小系统验证：
1. 双Agent轮转对话是否能产生比单Agent更可靠的输出
2. 提议-表决机制（Report）能否让两个Agent自主达成共识
3. 不同system prompt是否能有效激活互补推理策略

## 系统行为概述

1. 用户通过CLI输入问题
2. Agent A（Generator，宽松评估+整体论）生成初始回答
3. Agent B（Verifier，严格评估+原子论）对回答进行验证和质疑
4. 两者交替对话，逐步收敛
5. 任一Agent可提议Report（汇报结论），对方Vote通过后系统输出最终结果
6. 用户可继续提问（唤醒Stopped单元）

## 核心数据模型

```typescript
// === 消息总线上的消息 ===
interface BusMessage {
  id: string;
  source: "user" | "agent-a" | "agent-b" | "system";
  content: string;
  timestamp: number;
  // 如果此消息包含提议
  proposal?: {
    toolName: "report";
    args: { content: string };
  };
}

// === 待决提议 ===
interface PendingProposal {
  proposer: "agent-a" | "agent-b";
  toolName: "report";
  args: { content: string };
  messageId: string;
}

// === 状态机状态 ===
// L0 MVP 中 Executing 永远不会进入（没有阻塞式工具）
type UnitState = "idle" | "turn-a" | "turn-b" | "stopped" | "terminated";
```

## 组件设计

### 1. MessageBus

职责：存储消息，管理轮次可见性边界（P4）。

```typescript
class MessageBus {
  private messages: BusMessage[] = [];
  private lastSeenByA: number = 0;  // Agent A 上次读取的位置
  private lastSeenByB: number = 0;  // Agent B 上次读取的位置

  // 写入消息（任何时刻都可写入）
  write(msg: BusMessage): void;

  // 读取新消息（轮次开始时调用，推进可见性边界）
  readNewForAgent(agent: "agent-a" | "agent-b"): BusMessage[];

  // 读取全部历史
  readAll(): BusMessage[];
}
```

### 2. DeliberationUnit（状态机）

职责：管理状态转换，驱动Agent轮转。

```typescript
class DeliberationUnit {
  private state: UnitState = "idle";
  private bus: MessageBus;
  private pendingProposal: PendingProposal | null = null;
  private agentA: AgentTurn;  // Generator
  private agentB: AgentTurn;  // Verifier

  // 用户触发
  async trigger(userMessage: string): Promise<void>;

  // 核心循环：驱动 TurnA → TurnB → TurnA → ... 直到 Stopped
  private async runLoop(): Promise<void>;

  // 单轮执行
  private async executeTurn(agent: "agent-a" | "agent-b"): Promise<TurnResult>;

  // 状态转换
  private transition(from: UnitState, to: UnitState): void;
}
```

状态转换规则（L0简化版）：

| 转换 | 源 | 条件 | 目标 |
|------|---|------|------|
| T1 | idle | 收到用户消息 | turn-a |
| T2 | turn-a | A完成回复 | turn-b |
| T4 | turn-b | B完成回复 | turn-a |
| T8 | turn-a/turn-b | Report被APPROVE | stopped |
| T9 | stopped | 收到用户消息 | turn-a |

### 3. AgentTurn（单轮执行器）

职责：为一个Agent执行一次LLM调用。

```typescript
class AgentTurn {
  private systemPrompt: string;
  private model: Model;
  private context: Message[];  // pi-ai Context 中的 messages

  // 执行一轮：注入新消息 → 调LLM → 解析结果
  async execute(
    newMessages: BusMessage[],
    pendingProposal: PendingProposal | null,
    signal: AbortSignal,
    onTextDelta: (delta: string) => void,
  ): Promise<TurnResult>;
}

interface TurnResult {
  reply: string;                     // 文本回复
  proposal?: PendingProposal;        // 新提议（调用了Report）
  vote?: { approve: boolean; reason: string };  // 对待决提议的表决
}
```

**消息注入策略（独立Context模型）**：

每个Agent维护自己的 `pi-ai` Message 数组。轮次开始时，将 MessageBus 中的新消息转换后注入：

- 对方Agent的回复 → 注入为 `user` 消息，前缀 `[Agent X]:`
- 系统消息（Vote结果等）→ 注入为 `user` 消息，前缀 `[System]:`
- 用户消息 → 注入为 `user` 消息，前缀 `[User]:`
- 自己之前的回复已经在 context 中作为 `assistant`，无需重复注入

### 4. Tools（pi-ai Tool 定义）

L0 只有两个工具：

```typescript
// Report 工具 - 在当前Agent的可用工具中始终存在
const reportTool: Tool = {
  name: "report",
  description: "向上层汇报最终结论并结束对话。需要对方Agent投票通过。",
  parameters: Type.Object({
    content: Type.String({ description: "汇报内容：最终结论的非结构化文本" }),
  }),
};

// Vote 工具 - 仅当存在待决提议时，由框架注入到当前Agent的工具列表
const voteTool: Tool = {
  name: "vote",
  description: "对对方Agent的待决提议进行表决。",
  parameters: Type.Object({
    approve: Type.Boolean({ description: "true = APPROVE, false = REJECT" }),
    reason: Type.String({ description: "表决理由" }),
  }),
};
```

### 5. CLI

```typescript
// 入口：读取用户输入 → 触发 DeliberationUnit → 流式打印对话
async function main() {
  const unit = new DeliberationUnit({
    model: getModel("anthropic", "claude-sonnet-4-20250514"),
  });

  const rl = readline.createInterface({ input: stdin, output: stdout });

  while (true) {
    const question = await rl.question("> ");
    if (question === "exit") break;

    await unit.trigger(question);
    // 对话过程通过回调实时打印到终端
  }
}
```

**终端输出格式**：

```
> 量子纠缠是否允许超光速通信？

[Generator] 从整体视角来看，量子纠缠确实展现了...
            [可能] 纠缠态的坍缩在某种意义上...

[Verifier]  让我逐个检验这些主张：
            主张1: "纠缠态坍缩是瞬时的" → ✓ 可靠（Bell实验证实）
            主张2: "这意味着信息传递" → ✗ 可疑（无信号定理）
            ...

[Generator] 接受你对主张2的质疑。修正如下...
            📋 [提议 Report] 最终结论：...

[Verifier]  ✅ APPROVE: 结论准确反映了当前物理学共识。

[Report] 最终结论：量子纠缠不允许超光速通信。虽然...
```

## 项目结构

```
elenchus/
  src/
    message-bus.ts         # MessageBus 实现
    deliberation-unit.ts   # 状态机 + 核心循环
    agent-turn.ts          # 单轮LLM执行器
    tools.ts               # Vote/Report 工具定义
    prompts.ts             # Agent A/B 的 system prompt
    cli.ts                 # CLI 入口
    types.ts               # 共享类型定义
  package.json
  tsconfig.json
```

## 依赖

```json
{
  "dependencies": {
    "@mariozechner/pi-ai": "latest",
    "@sinclair/typebox": "latest"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "tsx": "latest"
  }
}
```

## System Prompt 设计要点

**Agent A (Generator)** 的核心指令：
- 你是生成者。从整体视角出发，构建连贯解释
- 宽松评估：允许基于部分证据形成暂定结论
- 整体论组织：先把握全貌，再填充细节
- 标记主张的模态类型：[必然]/[可能]/[实然]
- 当你认为讨论已充分收敛，调用 `report` 工具汇报结论

**Agent B (Verifier)** 的核心指令：
- 你是验证者。逐个检验对方的主张
- 严格评估：每个主张需要明确证据支持
- 原子论组织：分解后逐个验证
- 对每个主张标记：✓可靠 / ◐不确定 / ✗可疑
- 如果对方提议了Report，仔细评估结论是否准确，然后通过 `vote` 工具表决

**两者共享的元指令**：
- 你们的共同目标是获得最可靠、最准确的理解
- 对话格式：直接输出文本回复，工具调用会被框架自动处理
- 不要假装执行工具，直接调用即可

## 不确定性和后续扩展

**当前MVP不包含**：
- 最大轮次限制（可能导致无限对话）→ 后续加入硬性轮次上限
- Executing 状态（无阻塞式工具）
- L1 层级和 SpawnChild/SendToChild
- Session 持久化
- 流式输出（MVP可先用 `complete` 非流式，后续加 `stream`）

**已知风险**：
- 两个Agent可能陷入无意义的客套循环（"我同意你的观点"×N）→ 需要在prompt中明确要求实质性推进
- Agent可能不正确使用Vote/Report工具 → 需要清晰的tool description和prompt引导
- 独立Context模型的消息注入格式可能影响LLM理解 → 需要实验调优前缀格式

## 补充决策：异步用户输入

CLI 必须支持用户随时输入消息，消息被异步写入 MessageBus，在下一轮次开始时处理（P4）。
实现方式：readline 监听 stdin line 事件，每条用户输入调用 `unit.injectUserMessage()`。
如果 deliberation loop 正在运行，消息仅写入 bus 缓冲；如果 unit 处于 idle/stopped，
则触发新的 loop。通过 `loopRunning` 标志防止重入。

## 最终实现结构

```
src/
  types.ts               # BusMessage, PendingProposal, UnitState, TurnResult, ToolLevel
  message-bus.ts          # MessageBus: 消息存储 + per-agent 读取游标（P1, P4）
  tools.ts                # Vote/Report + L1工具定义(Bash/ReadFile/WriteFile) + buildToolList()
  tool-executor.ts        # 阻塞式工具执行器：Bash(child_process), ReadFile, WriteFile
  prompts.ts              # Generator/Verifier system prompts + L1 addendum
  agent-turn.ts           # AgentTurn: 独立Context + 消息注入 + 单轮LLM调用
  deliberation-unit.ts    # DeliberationUnit: FSM + 核心轮转循环 + Executing状态
  cli.ts                  # CLI入口：异步readline + 彩色终端输出 + L1模式
```

**依赖**：`@mariozechner/pi-ai`（LLM调用）、`@sinclair/typebox`（Tool schema）。
**不依赖**：`pi-agent-core`（其自动tool执行循环与提议-表决机制不兼容）。

**运行**：
- L0（纯对话）：`ANTHROPIC_API_KEY=... npm start`
- L1（带环境工具）：`ANTHROPIC_API_KEY=... ELENCHUS_LEVEL=L1 npm start`

---

**版本历史**：
- v0.2 (2026-04-08)：L1实现——新增Bash/ReadFile/WriteFile阻塞式工具，Executing状态机，提议-表决泛化。
- v0.1 (2026-04-08)：初始MVP设计，L0纯对话验证。异步用户输入。
