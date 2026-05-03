---
title: "Elenchus Framework Design - Reference Lint"
date: 2026-04-26
version: 1.0
---

# Reference Lint: 语法层跨文档引用检测

> **Synchronization note**
> - Changes here may require reviewing `knowledge-view.md` §5, §8.2, §11.
> - Changes in `knowledge-view.md` may require reviewing this file.

## Scope

- Wikilink 引用语法约定（`[[relative-path]]`）
- 被动扫描器：提取引用、构建索引、检测拓扑健康问题
- 检测项定义与严重度分级
- 与现有知识视图的关系
- 模块边界与接口设计

Complements: [knowledge-view.md](./knowledge-view.md), [state-machine-and-tools.md](./state-machine-and-tools.md).

Relevant overview: `framework-design.md` §2.4, §4.3; Principles P10, P27.

---

## 0. Motivation

当前 Elenchus 的知识视图允许 AGENT.md 文件互相引用（knowledge-view.md §5.1），但引用格式是松散的——prompt 只说"include the absolute path as part of your normal expression"（prompts.ts §File Paths in Communication）。这意味着：

- 代码无法区分"一个路径是引用意图"还是"一个路径只是举例说明"
- 无法自动检测断裂链接、孤立页面、缺失页面等拓扑健康问题
- Agent 无法感知引用网络的存在，无法评估修改某文件的影响范围

本设计引入一种 **可被代码可靠解析的引用语法**，并实现被动扫描器来检测引用网络的拓扑健康。

---

## 1. Wikilink 引用语法约定

### 1.1 语法规则

在 `.md` 文件中，使用 `[[relative-path]]` 表示对工作区内其他文件的引用：

```
[[src/core/AGENT.md]]          → workspaceRoot/src/core/AGENT.md
[[framework-design/knowledge-view.md]]  → workspaceRoot/framework-design/knowledge-view.md
[[skills/AGENT.md]]            → workspaceRoot/skills/AGENT.md
```

**解析规则**：

- 路径相对于 **workspaceRoot**（与 Obsidian vault root 语义一致）
- 自动补 `.md` 后缀：`[[src/core/AGENT]]` 等价于 `[[src/core/AGENT.md]]`
- 如果路径已包含 `.md` 后缀，不重复追加
- 路径中的空格和特殊字符不编码（与 URL 编码不同）

### 1.2 为什么是 wikilink

| 考量 | 分析 |
|------|------|
| **可解析性** | `\[\[[^\]]+\]\]` 一行正则即可提取，零歧义 |
| **噪声** | 任何 `[[...]]` 都是显式引用意图，不存在"只是举例"的解读空间 |
| **生态兼容** | Obsidian 原生支持，用户可直接在 Obsidian 中看到 backlink 和 graph view |
| **LLM 熟悉度** | 训练数据中大量 Obsidian/Docusaurus 内容，LLM 对 `[[wikilink]]` 语法高度熟悉 |
| **与现有约定** | 当前 prompt 说"no special format"，wikilink 是增量添加而非替换 |

### 1.3 Markdown link 作为补充

标准 Markdown 链接 `[text](path)` 也应被扫描，但需过滤外部 URL：

- 包含 `http://`、`https://`、`mailto:` 的链接 → 忽略
- 其余视为内部引用，路径相对于 **source 文件所在目录** 解析

Markdown link 的噪声高于 wikilink（可能是外部链接、脚注等），因此 wikilink 是主要引用格式，Markdown link 是辅助扫描对象。

### 1.4 不改变的领域

- **通信层**：agent 在对话、report、yield、sendToChild 中仍可使用绝对路径。Wikilink 是 **文档间** 的结构化引用约定，不是通信格式。
- **非 .md 文件**：引用语法只在 `.md` 文件中生效。代码文件中的引用不在检测范围内。
- **强制程度**：不使用 wikilink 不会导致系统错误——只是该引用不会被检测到。这是可被观察的约定，不是必须遵守的协议。

---

## 2. 扫描器设计

### 2.1 核心原则：被动扫描

扫描器是 **被动的**——它不主动触发，不注册为工具，不注入 prompt。它是一个纯计算模块，由上层按需调用：

- 当前阶段：作为内部模块存在，供未来工具或 prompt 注入使用
- 未来可扩展为 `lintReferences` 工具或 prompt 中的 backlink 信息

### 2.2 扫描流程

```
输入: workspaceRoot 路径
  │
  ├── 1. 遍历 workspaceRoot 下所有 .md 文件
  │     （排除 .elenchus-state/ 等框架内部目录）
  │
  ├── 2. 对每个 .md 文件：
  │     ├── 读取文件内容
  │     ├── 正则提取 [[wikilinks]]
  │     ├── 正则提取 [text](local-path)（排除外部 URL）
  │     └── 输出: RawReference[] { source, rawTarget, type, lineNumber }
  │
  ├── 3. 路径解析：
  │     ├── wikilink: workspaceRoot + rawTarget (+ .md 补全)
  │     ├── markdown-link: source 文件所在目录 + rawTarget
  │     └── 规范化为相对于 workspaceRoot 的路径
  │
  └── 4. 构建引用索引
        ├── 验证 target 文件是否存在 → resolved: boolean
        └── 输出: ReferenceIndex
```

### 2.3 正则模式

```typescript
// Wikilink: [[path]] 或 [[path|display text]]
const WIKILINK_PATTERN = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

// Markdown link: [text](path) — 排除外部 URL
const MDLINK_PATTERN = /\[([^\]]*)\]\((?!https?:\/\/|mailto:)([^)]+)\)/g;
```

Wikilink 支持别名语法 `[[path|display text]]`，与 Obsidian 一致。管道符后的部分是显示文本，不参与路径解析。

### 2.4 排除目录

以下目录的 .md 文件不参与扫描：

- `.elenchus-state/` — 框架内部状态
- `.git/` — 版本控制元数据
- `node_modules/` — 依赖包
- 其他以 `.` 开头的隐藏目录（除了项目根目录的 `.md` 文件）

排除规则应可配置，但当前硬编码上述列表即可。

---

## 3. 数据结构

### 3.1 引用边

```typescript
interface ReferenceEdge {
  /** 引用来源文件，相对于 workspaceRoot */
  source: string;
  /** 解析后的目标文件路径，相对于 workspaceRoot */
  target: string;
  /** 引用类型 */
  type: "wikilink" | "markdown-link";
  /** 在 source 文件中的行号（1-indexed） */
  lineNumber: number;
  /** 原始链接文本（未解析） */
  rawTarget: string;
  /** 目标文件是否存在 */
  resolved: boolean;
}
```

### 3.2 引用索引

```typescript
interface ReferenceIndex {
  /** 所有扫描到的引用边 */
  edges: ReferenceEdge[];
  /** 所有参与扫描的 .md 文件路径集合 */
  files: Set<string>;

  // --- 衍生查询 ---

  /** 某文件的出站引用 */
  outLinks(file: string): ReferenceEdge[];
  /** 某文件的入站引用（backlink） */
  inLinks(file: string): ReferenceEdge[];
  /** 所有断裂链接（目标不存在） */
  brokenLinks(): ReferenceEdge[];
  /** 所有孤立页面（无入站引用的 .md 文件） */
  orphans(): string[];
  /** 所有缺失页面（被引用但目标不存在，去重） */
  missingPages(): string[];
  /** 引用网络中的枢纽（入度 ≥ threshold） */
  hubs(threshold?: number): string[];
}
```

`ReferenceIndex` 是纯计算结果——每次调用扫描器时从文件系统实时计算，不持久化。对于 Elenchus 典型的 workspace 规模（< 200 个 .md 文件），扫描耗时可忽略。

---

## 4. 检测项定义

| 检测项 | 定义 | 严重度 | 说明 |
|--------|------|--------|------|
| **Broken link** | `resolved: false` 的边 | 🔴 高 | 引用了不存在的文件，追踪链条中断 |
| **Missing page** | 被多个 wikilink 引用但目标不存在 | 🟡 中 | 应考虑创建该页面 |
| **Orphan page** | 入度为 0 的 .md 文件 | 🟡 中 | 无任何文件引用它，可能是孤立知识 |
| **Isolated cluster** | 与主连通分量不连通的子图 | 🟡 中 | 知识碎片化信号 |
| **Hub** | 入度 ≥ threshold 的文件 | ℹ️ 信息 | 知识网络关键枢纽，修改影响范围大 |

**关于 orphan 的语义注意**：并非所有入度为 0 的 .md 文件都是问题——新创建的文件、独立的分析文档、临时笔记都可能暂时没有入站引用。Orphan 是信号而非错误，需要 agent 语义判断。

**关于 missing page**：如果多个不同文件都引用了同一个不存在的目标，说明该目标确实应该存在。单个引用可能是笔误，多个引用则是强信号。

---

## 5. 与知识视图设计的关系

### 5.1 对 knowledge-view.md §5.2 的调和

knowledge-view.md §5.2 说：

> *"Cross-directory references should not become a formal graph-database mechanism requiring central registration, unified indexing, or strong-consistency validation."*

本设计与此原则一致：

1. **检测 ≠ 注册**：扫描器只是观察已有的 `[[wikilink]]` 语法，不要求 agent 注册引用关系
2. **无强制一致性**：agent 不使用 wikilink 不会导致系统错误——只是该引用不会被检测到
3. **观察性而非监管性**：检测结果用于帮助 agent 发现问题，不是合规审计
4. **无中心索引**：当前阶段纯计算，不持久化，不维护全局索引

### 5.2 对 knowledge-view.md §11 的扩展

knowledge-view.md §11 将以下列为 "Deliberately Excluded from Current Scope"：

> - Drift detection, staleness detection, and auto-repair
> - Unified validators or schema verification

本设计实现的引用拓扑检测是 **语法层** 的，不涉及语义层的 drift/staleness 检测。但它为未来扩展提供了基础设施：

- **Broken link 检测** 是最基础的 drift 信号——文件被删除或移动后，引用它的文档就产生了 drift
- **Orphan 检测** 是 staleness 的间接信号——长期无入站引用的 AGENT.md 可能已过时
- 未来的语义层 lint 可以在本设计的引用索引之上叠加

### 5.3 Prompt 侧变更（已实施）

对 `KNOWLEDGE_VIEW_GUIDELINE_TEMPLATE` 做了两处修改：

**修改 1：File Paths in Communication 段落末句**

将 *"There is no special format for file references; just include the absolute path as part of your normal expression."* 替换为明确区分通信层与文档层的表述：

> *"In communication, absolute paths are the norm — structured wikilink references belong inside .md documents, not in transient messages."*

**修改 2：新增 Cross-Document References 段落**

在 "File Paths in Communication" 和 "Intermediate and Scratch Files" 之间插入新段落，引导 agent 在 .md 文件中使用 `[[relative-path]]` wikilink 语法。示例使用知识空间路径而非代码路径：

- `[[framework-design/knowledge-view.md]]` — 知识视图设计文档
- `[[skills/AGENT.md]]` — skills 区域入口页
- `[[framework-design/knowledge-view.md|Knowledge View Design]]` — 带显示文本的别名语法

段落还明确：wikilink 是文档层约定，通信层仍用绝对路径；不要机械地为每个路径添加 wikilink，只在读者会受益于可追踪引用时添加。

---

## 6. 模块边界

```
src/core/
  reference-scanner.ts    ← 纯函数：从文件内容提取引用边
  reference-index.ts      ← ReferenceEdge + ReferenceIndex 接口 + 查询方法

src/adapters/
  fs-reference-scanner.ts ← 适配器：遍历文件系统，调用 core 扫描逻辑

src/core/prompts.ts       ← 更新 KNOWLEDGE_VIEW_GUIDELINE_TEMPLATE
```

### 6.1 Core 层：reference-scanner.ts

纯函数模块，不依赖文件系统：

```typescript
// 输入：文件路径 + 文件内容字符串
// 输出：RawReferenceEdge[]
export function scanReferences(
  sourcePath: string,
  content: string
): RawReferenceEdge[];

// 路径解析：rawTarget → 规范化相对路径
export function resolveReference(
  rawTarget: string,
  sourcePath: string,
  type: "wikilink" | "markdown-link"
): string;
```

可独立单元测试，无需 mock 文件系统。

### 6.2 Core 层：reference-index.ts

数据结构定义 + 纯计算查询方法：

```typescript
export interface ReferenceEdge { ... }
export interface ReferenceIndex { ... }

// 从 ReferenceEdge[] 构建 ReferenceIndex
export function buildIndex(edges: ReferenceEdge[], files: Set<string>): ReferenceIndex;
```

### 6.3 Adapter 层：fs-reference-scanner.ts

文件系统适配器，负责目录遍历和文件读取：

```typescript
export function scanWorkspace(workspaceRoot: string): ReferenceIndex;
```

内部调用 `reference-scanner.scanReferences()` 处理每个文件，调用 `reference-index.buildIndex()` 构建最终索引。

### 6.4 依赖方向

```
fs-reference-scanner (adapter)
  ├── reference-scanner (core, pure)
  └── reference-index (core, pure)

prompts.ts (core)
  └── 消费引用约定文本，不依赖扫描器模块
```

扫描器模块不依赖 prompts.ts，prompts.ts 不依赖扫描器模块。两者通过 wikilink 语法约定间接耦合。

---

## 7. 未来扩展方向（当前不实现）

以下方向记录于此，作为设计前瞻，但 **不在当前实现范围内**：

- **lintReferences 工具**：non-blocking 工具，让 agent 主动触发扫描并获取拓扑健康报告
- **Prompt 注入 backlink**：在 agent 读写某文件时，附带该文件的入站引用信息
- **SQLite 持久化**：在 `state.db` 中新增 `document_references` 表，增量更新
- **FsWatcher 集成**：利用已有 Electron FsWatcher 触发增量扫描
- **Alias 映射**：维护 `别名 → 规范名` 映射，支持链接修复（类似 obsidian-llm-wiki-local 的 `olw maintain --fix`）
- **语义层 lint**：在引用索引之上叠加 LLM 驱动的矛盾检测、过时声明检测

---

## 8. Design Principles

1. **Observable convention principle**: Wikilink 是可被代码观察的约定，不是必须遵守的协议。不使用 wikilink 不会导致系统错误，只是该引用不会被检测到。
2. **Passive scan principle**: 扫描器是被动的纯计算模块，不主动触发，不注册为工具，不注入 prompt。
3. **Pure computation principle**: 当前阶段不持久化，每次扫描从文件系统实时计算。workspace 规模下成本可忽略。
4. **Syntax-only principle**: 只做语法层检测（链接存在性、解析状态），不做语义层检测（矛盾、过时、缺失概念）。
5. **Soft enforcement principle**: 检测结果是信号而非错误。Orphan 和 missing page 需要语义判断，不应被当作必须修复的缺陷。
6. **Workspace-root-relative principle**: Wikilink 内路径相对于 workspaceRoot，与 Obsidian vault root 语义一致。
7. **Core-adapter separation principle**: 扫描逻辑是纯函数（core），文件系统访问是适配器（adapter）。Core 层可独立单元测试。

---

## Change Log

- **v1.0 (2026-04-26)**: Initial design. Wikilink syntax, passive scanner, pure computation, no persistence.
