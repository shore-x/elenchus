# 跨文档引用关系检测：第一性原理分析

> 研究对象：Karpathy LLM Wiki 的 lint 机制、Obsidian 的 wikilink/backlink 系统
> 目的：为 Elenchus 的 agent 文档维护功能提供设计参考
> 日期：2026-04-26

---

## 一、问题本源：为什么需要跨文档引用检测？

从第一性原理出发，跨文档引用检测要解决的核心问题是 **知识的一致性与连通性**：

1. **一致性**：当文档 A 声明 X，文档 B 声明 ¬X 时，系统需要发现这个矛盾——否则知识库在自我欺骗
2. **连通性**：孤立的知识节点（orphan）意味着该知识没有被编织进网络——它存在但不被引用，等同于不存在
3. **完整性**：被引用但不存在的目标（broken link）意味着知识网络有断裂——读者/agent 的追踪链条中断
4. **时效性**：旧声明被新信息取代后仍残留（stale claim）——知识库在传播过时信息

这四个问题本质上都是 **知识图谱的拓扑健康问题**。无论是 LLM Wiki 的 lint 还是 Obsidian 的 backlink，都在试图以不同方式检测和修复这些拓扑缺陷。

---

## 二、Karpathy LLM Wiki 的 Lint 机制

### 2.1 原始设计（Karpathy Gist）

Karpathy 的原始设计是一个 **概念性框架**，而非具体实现。三个核心操作：

- **Ingest**：新源进入 → LLM 提取关键信息 → 更新 wiki 页面（一个源可能触及 10-15 个页面）
- **Query**：提问 → LLM 搜索相关页面 → 综合回答并引用 → 好的回答可以回存为新的 wiki 页面
- **Lint**：定期健康检查，检测：
  - 页面间矛盾（contradictions）
  - 过时声明（stale claims superseded by newer sources）
  - 孤立页面（orphan pages with no inbound links）
  - 缺失页面（important concepts mentioned but lacking their own page）
  - 缺失交叉引用（missing cross-references）
  - 数据空白（data gaps that could be filled with a web search）

**关键洞察**：Lint 在原始设计中是 **LLM 驱动的语义检测**，不是语法层面的正则匹配。它依赖 LLM 理解页面内容来发现矛盾和缺失，这和传统 linter 有本质区别。

三层架构：
```
Raw sources  → 不可变源文档，LLM 只读
Wiki         → LLM 生成/维护的 markdown 页面集合，LLM 拥有写权限
Schema       → 约定文档（如 CLAUDE.md / AGENTS.md），告诉 LLM 如何组织 wiki
```

两个辅助文件：
- `index.md`：内容目录，每个页面一行摘要，按类别组织。LLM 回答问题时先查 index 定位相关页面
- `log.md`：追加式时间线日志，记录 ingest/query/lint 操作历史

### 2.2 LLM Wiki v2 的扩展（rohitg00）

v2 在原始基础上增加了几个关键维度：

**记忆生命周期**：
- 置信度评分（confidence scoring）：每个事实携带来源数量、最近确认时间、是否存在矛盾
- 取代关系（supersession）：新信息显式取代旧信息，保留旧版本但标记为 stale
- 遗忘曲线（forgetting curve）：未被访问或强化的事实逐渐降权
- 分层巩固（consolidation tiers）：Working → Episodic → Semantic → Procedural

**知识图谱层**：
- 实体提取：从源中提取结构化实体（人、项目、概念），赋予类型和属性
- 类型化关系：`uses`、`depends_on`、`contradicts`、`caused`、`supersedes` 等语义边
- 图遍历查询：从节点出发沿关系边向外遍历，发现关键词搜索遗漏的连接

**自愈式 Lint**：
- Lint 不再只是建议，而是自动修复能修的：孤立页面被链接或标记、过时声明被标记、断裂引用被修复
- 质量评分：每段 LLM 生成内容都有质量分数，低于阈值的被标记重写
- 矛盾解决：LLM 基于来源时效性、权威性、支持数量提出更可能正确的声明

### 2.3 karpathy-llm-wiki（Astro-Han）—— Agent Skills 实现

将 Karpathy 的理念打包为可安装的 Agent Skill：

```
your-project/
├── raw/           ← 不可变源材料
├── wiki/          ← LLM 维护的编译知识页面
│   ├── topic/
│   ├── index.md   ← 全局目录
│   └── log.md     ← 追加式操作日志
```

三个操作：ingest、query、lint。Lint 检查断裂链接、缺失索引条目、过时交叉引用。

### 2.4 obsidian-llm-wiki-local（kytmanov）—— 最完整的实现

这是目前最完整的 LLM Wiki 实现，提供了精细化的 lint 和维护命令：

**Lint 检测项**（`olw lint`，不需要 LLM）：
- 孤立页面（orphans）
- 断裂链接（broken links）
- 过时文章（stale articles）

**维护修复**（`olw maintain --fix`）：
- 通过 alias map 修复断裂的 wikilink
- 为真正缺失的目标创建 stub 文章
- 将 `[[Alias]]` 链接规范化为 `[[Canonical|Alias]]`

**引用关系的关键实现**：
- 概念文章使用 `[[wikilinks]]` 互相链接
- 每个概念文章链接回其源笔记（source traceability）
- 可选的行内引用标记 `[S1](#Sources)`
- `index.md` 作为路由层，支持 `olw query` 查找
- `state.db`（SQLite）存储笔记、概念、文章、知识条目的元数据
- 概念别名（aliases）写入 frontmatter，用于查询解析和断裂链接修复

**选择性重编译**：文件保存后，只重编译与该源关联的概念——不是整个 wiki。这是基于引用关系的增量更新。

---

## 三、Obsidian 的引用系统

### 3.1 链接格式

Obsidian 支持两种内部链接格式，解析和追踪行为完全一致：

| 格式 | 示例 | 特点 |
|------|------|------|
| Wikilink | `[[Three laws of motion]]` | 紧凑，自动补全，Obsidian 默认 |
| Markdown | `[text](path%20with%20spaces.md)` | 标准兼容，需 URL 编码 |

引用粒度：
- **文件级**：`[[Meeting Notes]]`
- **标题级**：`[[Research#Methods]]`
- **块级**：`[[Notes#^ab123c]]`（需显式定义 `^block-id`）
- **自身标题**：`[[#Conclusion]]`
- **别名显示**：`[[AI|Artificial Intelligence]]`

### 3.2 MetadataCache——引用关系的核心引擎

Obsidian 的引用检测不是通过 lint 命令实现的，而是通过 **持续运行的元数据缓存** 实时维护：

**CachedMetadata 结构**：
- `links`：所有出站链接（LinkCache）
- `embeds`：所有嵌入引用（EmbedCache，`![[...]]`）
- `headings`：所有标题（HeadingCache）
- `tags`：所有标签（TagCache）
- `blocks`：所有块引用 ID（BlockCache）
- `frontmatter`：YAML frontmatter
- `frontmatterLinks`：frontmatter 中的链接

**两个关键数据结构**：
```
resolvedLinks: Map<source_path, Map<target_path, count>>
  // 源文件 → 已解析的目标文件 → 出现次数
  // 例: resolvedLinks["folder/source.md"]["folder/Note.md"] = 1

unresolvedLinks: Map<source_path, Map<link_key, count>>
  // 源文件 → 未解析的链接键 → 出现次数
```

**这意味着**：
- `resolvedLinks` 直接给出 **出站有向边**（谁引用了谁）
- 对 `resolvedLinks` 做反向索引就得到 **入站边**（backlinks）
- `unresolvedLinks` 直接给出 **断裂链接**（引用了不存在的目标）
- 孤立页面 = 在所有 `resolvedLinks` 的 value 中从未作为 target 出现的文件

### 3.3 Backlink 系统

Backlinks 插件维护两个结果集：

1. **Linked Mentions**：包含指向当前笔记的显式内部链接的文件
2. **Unlinked Mentions**：出现当前笔记名称或别名但尚未链接的文本——**潜在连接发现**

Unlinked Mentions 是 Obsidian 的一个独特功能：它不仅追踪显式链接，还能发现 **应该链接但还没链接** 的文本提及。这本质上是一种 **隐式引用检测**。

### 3.4 链接维护

- **自动更新**：文件重命名/移动时，Obsidian 自动更新所有指向该文件的链接（包括标题链接和块引用）
- **元数据缓存重建**：链接更新后，受影响的缓存条目重建，触发 Backlinks 和 Outgoing Links 显示刷新
- **排除机制**：匹配 Settings → Files and Links → Excluded files 的文件不出现在 Unlinked Mentions 中

### 3.5 Graph View

Obsidian 的图谱视图是引用关系的可视化呈现：
- 节点 = 文件
- 边 = wikilink 引用关系
- Hub 节点 = 被大量引用的页面
- Orphan 节点 = 无入站链接的页面

---

## 四、第一性原理对比分析

### 4.1 根本范式差异

| 维度 | LLM Wiki Lint | Obsidian MetadataCache |
|------|---------------|----------------------|
| **检测时机** | 按需（手动/定时触发） | 实时（文件变更即时更新） |
| **检测深度** | 语义层（矛盾、过时、缺失概念） | 语法层（链接存在性、解析状态） |
| **检测方式** | LLM 理解内容后判断 | 正则/AST 解析 markdown 语法 |
| **修复能力** | LLM 自动重写/更新内容 | 自动更新链接路径，不修改内容 |
| **隐式引用** | 无（只检测显式 wikilink） | 有（Unlinked Mentions） |
| **运行成本** | 高（每次 lint 需要 LLM 调用） | 低（本地解析，无 API 调用） |

### 4.2 引用关系的抽象模型

从第一性原理出发，文档间的引用关系可以抽象为：

```
Document Graph = (V, E)
V = 文档节点集合
E = 引用边集合，每条边 e = (source, target, type, granularity, status)
```

其中：
- **type**：`explicit`（显式链接 `[[...]]`）或 `implicit`（文本提及但未链接）
- **granularity**：`file` / `heading` / `block`
- **status**：`resolved`（目标存在）或 `unresolved`（目标不存在）

**拓扑健康指标**：
- **Orphan**：入度为 0 的节点（无入站边）
- **Broken link**：status = unresolved 的边
- **Hub**：入度高的节点
- **Disconnected component**：无法从主连通分量到达的节点子集
- **Contradiction**：同一概念在不同节点中被声明为互斥的值（需要语义理解）

### 4.3 两种范式的互补性

Obsidian 的语法层检测和 LLM Wiki 的语义层检测解决的是 **不同层次的问题**：

- **语法层**（Obsidian）：链接是否存在？目标是否存在？谁引用了谁？——这是 **拓扑结构** 问题，可以精确计算
- **语义层**（LLM Wiki）：引用的内容是否一致？是否有应该引用但没引用的概念？信息是否过时？——这是 **知识一致性** 问题，需要理解能力

理想的系统应该 **两层都做**：先用低成本的语法层检测保证拓扑健康，再用 LLM 驱动的语义层检测保证知识一致性。

### 4.4 关键设计决策

从这两个系统的实践中，可以提炼出几个关键的设计决策点：

**1. 引用语法：显式 vs 隐式**

Obsidian 证明了两种都有价值：
- 显式链接（`[[...]]`）是确定性的，解析成本低，但依赖人工/agent 主动添加
- 隐式提及（Unlinked Mentions）可以发现遗漏的连接，但噪声高，需要确认

**2. 检测粒度：文件 vs 标题 vs 块**

- 文件级最简单，覆盖大多数场景
- 标题级允许更精确的引用（"这个文档的这个小节"）
- 块级最精确但维护成本高（需要显式定义 block-id）

**3. 缓存策略：实时 vs 按需**

- Obsidian 的实时缓存保证了引用信息始终最新，但需要持续的文件监听
- LLM Wiki 的按需 lint 更轻量，但可能错过中间状态的退化
- 对于 agent 系统，按需检测可能更合适——agent 在需要时主动检查

**4. 修复策略：自动 vs 建议**

- Obsidian 对链接路径变更自动修复（确定性操作）
- LLM Wiki v2 的自愈 lint 也尝试自动修复（但涉及内容修改，风险更高）
- obsidian-llm-wiki-local 的 `--fix` 标志让用户选择是否自动修复

**5. 元数据存储：文件内 vs 外部数据库**

- Obsidian：元数据在内存缓存中，持久化到 `.obsidian` 目录
- obsidian-llm-wiki-local：`state.db`（SQLite）存储概念、别名、质量分数等
- LLM Wiki 原始：`index.md` + `log.md`（纯文件）

---

## 五、对 Elenchus 的启示

### 5.1 当前 Elenchus 的知识视图现状

Elenchus 已有的知识视图机制：
- `AGENT.md` 文件作为目录级知识入口
- 不同目录的 `AGENT.md` 可以互相引用
- 知识视图是软约定（prompt-guided convention），不是强制格式
- Agent 通过 `readFile` 工具读取文件内容

### 5.2 需要补充的能力

基于上述分析，Elenchus 要实现有效的跨文档引用检测，需要以下能力层次：

**第一层：语法层引用检测（低成本，高确定性）**

这是 Obsidian 模式的移植——不需要 LLM 参与：

- **引用解析**：扫描 markdown 文件中的 `[[wikilink]]` 和 `[text](path)` 链接
- **出站链接索引**：构建 `文件 → [引用目标]` 的映射
- **入站链接索引**（backlink）：反向索引，`文件 → [被谁引用]`
- **断裂链接检测**：引用目标不存在的边
- **孤立页面检测**：无入站链接的文件
- **别名映射**：维护 `别名 → 规范名` 的映射，支持链接修复

**第二层：语义层引用检测（高成本，需要 LLM）**

这是 LLM Wiki lint 模式的移植：

- **矛盾检测**：不同文档对同一概念的声明不一致
- **缺失概念检测**：被提及但没有独立页面的重要概念
- **过时声明检测**：被新信息取代但未更新的旧声明
- **隐式引用发现**：文本提及了某概念但未建立链接（类似 Unlinked Mentions）

**第三层：主动维护（agent 自治）**

- **增量更新**：当源文件变更时，只重编译受影响的概念页面
- **链接修复**：自动修复断裂链接（通过别名映射或创建 stub）
- **知识巩固**：将高频访问的工作记忆提升为长期语义记忆

### 5.3 实现路径建议

考虑到 Elenchus 的架构特点（agent 自治、proposal-vote 机制、已有 SQLite 持久化），建议的实现路径：

**Phase 1：引用索引基础设施**
- 在 SQLite 中增加引用关系表（source_path, target_path, link_type, granularity, resolved）
- 实现一个引用扫描器，在文件变更时增量更新索引
- 暴露查询接口：getBacklinks(path)、getOutlinks(path)、getOrphans()、getBrokenLinks()

**Phase 2：Agent 可感知的引用信息**
- 在知识视图注入中增加当前文档的引用上下文（谁引用了我、我引用了谁）
- 在 agent 的系统提示中说明引用关系的存在和含义
- 让 agent 在读写文件时能感知引用网络的影响

**Phase 3：Lint 工具**
- 实现 `lintWiki` 工具（non-blocking），返回拓扑健康报告
- 实现 `fixLinks` 工具（blocking，需要 proposal-vote），自动修复可修复的引用问题
- 语义层 lint 可以作为 `compressContext` 的扩展——在压缩时顺便检测矛盾

**Phase 4：隐式引用发现**
- 利用 LLM 的理解能力，在 ingest/query 操作中发现应该建立但未建立的引用
- 类似 Obsidian 的 Unlinked Mentions，但由 LLM 驱动而非文本匹配

### 5.4 与现有架构的契合点

- **SQLite 持久化**：引用索引天然适合关系型存储，与已有的 SQLite 层无缝集成
- **Knowledge View**：`AGENT.md` 的互相引用关系可以作为引用网络的起点
- **Proposal-Vote**：引用修复涉及文件修改，应走 proposal-vote 流程
- **ConversationLedger**：lint 结果可以作为 system_message 写入 ledger，让 agent 感知
- **Context Compression**：压缩时的知识快照可以包含引用拓扑摘要

---

## 六、总结

| 系统 | 核心机制 | 优势 | 局限 |
|------|---------|------|------|
| Karpathy LLM Wiki (原始) | LLM 驱动的语义 lint | 发现深层矛盾和缺失概念 | 成本高，按需触发，可能遗漏 |
| LLM Wiki v2 | 语义 lint + 知识图谱 + 生命周期 | 最完整的知识健康管理 | 复杂度高，实现难度大 |
| obsidian-llm-wiki-local | 语法 lint + LLM 编译 + alias 修复 | 语法检测无需 LLM，选择性重编译 | 语义检测仍依赖 LLM |
| Obsidian MetadataCache | 实时语法解析 + 双向索引 | 零成本实时检测，Unlinked Mentions | 只做语法层，不理解语义 |

**核心洞察**：跨文档引用检测的本质是 **知识图谱的拓扑健康管理**。语法层检测（链接存在性、解析状态）是基础且低成本的，语义层检测（矛盾、过时、缺失概念）是高价值但高成本的。理想系统应先建立语法层基础设施，再在其上叠加语义层能力。对于 Elenchus 这样的 agent 系统，关键是让 agent **感知**引用网络的存在，并拥有 **主动维护**引用健康的工具。
