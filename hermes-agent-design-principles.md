
# Hermes Agent 设计原理

## 一、项目概述

Hermes Agent是由Nous Research开发的自主改进型AI代理，具有内置的学习循环、多平台支持和强大的技能系统。它是一个开源项目，具有高度的灵活性和可扩展性。

**核心特征：**
- 唯一具有内置学习循环的AI代理
- 从经验中创建技能并在使用过程中持续改进
- 支持多种模型和平台，无锁定限制
- 可在低成本硬件或服务器less架构上运行
- 支持多平台通信和任务自动化

## 二、架构设计

### 系统架构概览

Hermes Agent的架构分为以下几个主要层次：

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Entry Points                                  │
│                                                                      │
│  CLI (cli.py)    Gateway (gateway/run.py)    ACP (acp_adapter/)     │
│  Batch Runner    API Server                  Python Library          │
└──────────┬──────────────┬───────────────────────┬────────────────────┘
           │              │                       │
           ▼              ▼                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     AIAgent (run_agent.py)                           │
│                                                                      │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                │
│  │ Prompt        │ │ Provider     │ │ Tool         │                │
│  │ Builder       │ │ Resolution   │ │ Dispatch     │                │
│  │ (prompt_      │ │ (runtime_    │ │ (model_      │                │
│  │  builder.py)  │ │  provider.py)│ │  tools.py)   │                │
│  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘                │
│         │                │                │                          │
│  ┌──────┴───────┐ ┌──────┴───────┐ ┌──────┴───────┐                │
│  │ Compression  │ │ 3 API Modes  │ │ Tool Registry│                │
│  │ & Caching    │ │ chat_compl.  │ │ (registry.py)│                │
│  │              │ │ codex_resp.  │ │ 48 tools     │                │
│  │              │ │ anthropic    │ │ 40 toolsets   │                │
│  └──────────────┘ └──────────────┘ └──────────────┘                │
└─────────────────────────────────────────────────────────────────────┘
           │                                    │
           ▼                                    ▼
┌───────────────────┐              ┌──────────────────────┐
│ Session Storage   │              │ Tool Backends         │
│ (SQLite + FTS5)   │              │ Terminal (6 backends) │
│ hermes_state.py   │              │ Browser (5 backends)  │
│ gateway/session.py│              │ Web (4 backends)      │
└───────────────────┘              │ MCP (dynamic)         │
                                   │ File, Vision, etc.    │
                                   └──────────────────────┘
```

### 主要子系统

1. **AIAgent（核心会话循环）**
   - 文件：`run_agent.py` (约9200行)
   - 功能：处理提供者选择、提示构造、工具执行、重试、回退、回调、压缩和持久化
   - 支持三种API模式：chat_completions、codex_responses和anthropic_messages

2. **命令行界面（CLI）**
   - 文件：`cli.py` (约8500行)
   - 功能：交互式终端UI，支持多线编辑、命令自动完成、会话历史记录和流式工具输出

3. **网关系统**
   - 文件：`gateway/run.py` (约7500行)
   - 功能：处理消息分发、会话管理、用户授权和跨平台通信
   - 支持14种平台适配器：Telegram、Discord、Slack、WhatsApp、Signal等

4. **提示系统**
   - 文件：`agent/prompt_builder.py`
   - 功能：从多个源组装系统提示，包括个性文件(SOUL.md)、内存(MEMORY.md, USER.md)、技能和上下文文件

5. **工具系统**
   - 文件：`model_tools.py`、`tools/registry.py`
   - 功能：工具发现、模式收集和调度
   - 包含47个注册工具，分为20个工具集
   - 支持6种终端后端：本地、Docker、SSH、Daytona、Modal和Singularity

6. **会话存储**
   - 文件：`hermes_state.py`
   - 功能：SQLite数据库，用于持久化会话历史和上下文
   - 支持FTS5全文搜索和会话谱系跟踪

7. **技能系统**
   - 功能：程序化内存系统，允许代理从经验中创建和改进技能
   - 兼容agentskills.io开放标准

## 三、核心机制

### 1. 代理循环（Agent Loop）

Hermes Agent的核心运行机制是同步编排引擎，位于`run_agent.py`中的`AIAgent`类：

```
用户输入 → HermesCLI.process_input()
  → AIAgent.run_conversation()
    → prompt_builder.build_system_prompt()
    → runtime_provider.resolve_runtime_provider()
    → API调用 (chat_completions / codex_responses / anthropic)
    → 工具调用？→ model_tools.handle_function_call() → 循环
    → 最终响应 → 显示 → 保存到SessionDB
```

### 2. 提示构造系统

系统提示通过以下组件动态组装：
- 个性文件(SOUL.md)：定义代理的基本身份和行为
- 内存文件(MEMORY.md, USER.md)：存储用户偏好和上下文信息
- 技能：按需加载的知识文档
- 上下文文件(.hermes.md, AGENTS.md, CLAUDE.md等)：项目特定的行为规则
- 工具使用指南：工具功能描述和使用说明
- 模型特定指令：针对不同LLM的优化提示

### 3. 内存管理

Hermes Agent具有三种主要的内存机制：
- **短期记忆**：当前会话的上下文
- **中期记忆**：使用FTS5搜索引擎的会话存储
- **长期记忆**：通过周期性提示和用户建模持久化的知识

### 4. 技能系统

技能系统是Hermes Agent的核心创新：
- 代理在完成复杂任务后会自动创建技能
- 技能在使用过程中会自我改进
- 技能遵循渐进式披露模式，以最小化令牌使用
- 兼容agentskills.io开放标准

### 5. 工具执行

工具执行系统支持多种环境：
- 本地执行
- Docker容器化执行
- SSH远程执行
- Daytona和Modal等serverless平台
- Singularity容器

## 四、关键特性

### 1. 多平台支持

Hermes Agent支持以下通信方式：
- 终端界面(CLI)
- Telegram
- Discord
- Slack
- WhatsApp
- Signal
- 电子邮件
- Home Assistant
- Webhook

### 2. 学习循环

Hermes Agent具有独特的学习循环：
- 自动从经验中创建技能
- 技能在使用过程中持续改进
- 定期提示机制促进知识持久化
- 会话搜索和总结支持跨会话回忆

### 3. 调度自动化

内置的cron调度器支持：
- 自然语言任务调度
- 跨平台任务交付
- 任务管理(暂停、恢复、编辑)
- 每日报告、备份和审计

### 4. 子代理委托

支持创建独立的子代理：
- 用于并行工作流
- 具有隔离的上下文和工具集
- 允许将复杂任务分解为更小的部分

### 5. 代码执行

- 沙盒化代码执行
- 支持Python脚本调用工具
- 多步骤工作流可以折叠为单个LLM轮次

## 五、设计原则

### 1. 提示稳定性

系统提示在会话期间保持不变，确保对话上下文的一致性。只有在明确用户操作（如`/model`命令）时才会更改。

### 2. 可观察性

每个工具调用对用户都是可见的，通过回调机制提供进度更新。CLI提供实时流输出，而网关支持消息通知。

### 3. 无锁定架构

支持多种LLM提供者和平台，允许用户根据需要切换，而无需修改代码。

### 4. 渐进式复杂度

系统设计支持从简单的聊天到复杂的自动化任务，用户可以根据需要添加功能。

### 5. 可扩展性

- 插件系统允许添加新功能
- 工具系统支持扩展和定制
- 内存提供者可以替换为外部系统

## 六、技术实现细节

### 1. 主要依赖库

- **Prompt Engineering**：使用Jinja2和Markdown处理
- **API集成**：支持OpenAI、Anthropic、OpenRouter等20+提供者
- **数据库**：SQLite3用于会话存储
- **搜索**：FTS5全文搜索
- **Web自动化**：Playwright和BeautifulSoup
- **调度**：APScheduler
- **加密**：Fernet加密用于API密钥存储

### 2. 文件结构

```
hermes-agent/
├── run_agent.py              # 核心代理循环
├── cli.py                    # 命令行界面
├── model_tools.py            # 工具发现和调度
├── agent/                    # 代理内部模块
├── hermes_cli/               # CLI子命令和设置
├── tools/                    # 工具实现
├── gateway/                  # 消息平台网关
├── acp_adapter/              # IDE集成
├── cron/                     # 调度器
├── plugins/                  # 插件系统
├── skills/                   # 捆绑技能
└── tests/                    # 测试套件
```

## 七、设计目标

### 1. 自主改进

使代理能够从经验中学习并自我改进，减少对持续人工干预的需求。

### 2. 多平台可用性

让用户能够通过他们喜欢的通信方式与代理交互，而不受设备限制。

### 3. 资源效率

设计为可以在低成本硬件上运行，同时也支持高性能计算环境。

### 4. 灵活性

允许用户根据需要定制代理的行为，包括更换模型、添加工具和调整内存系统。

### 5. 可访问性

提供简单的安装过程和直观的界面，使广泛的用户群体能够使用。

## 八、使用场景

Hermes Agent适用于多种场景：
- 个人助理：管理任务、提醒和信息检索
- 开发辅助：代码生成、调试和项目管理
- 自动化：定期报告、备份和系统维护
- 研究：数据收集、分析和报告生成
- 创意工作：内容创建、编辑和研究

---

## 总结

Hermes Agent是一个创新的AI代理系统，具有独特的学习循环和高度的可扩展性。其架构设计强调灵活性、可观察性和无锁定原则，使其成为一个强大的工具，可以适应各种用户需求和使用场景。通过支持多种模型和平台，以及内置的技能创建和改进机制，Hermes Agent为AI代理的未来发展树立了新的标准。
