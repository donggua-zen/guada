# DSH 记忆/压缩类插件原理分析（billion-context · mnemon · dsh-memory）

> 调研日期：2026-10-12
> 方法：从 GitHub 拉取 4 个仓库（`tmp_dsh_plugins/`）读源码 + README/设计文档。
> 材料来源为各自仓库真实文件；标注「事实」=有源码/文档佐证，「推测」=基于材料的推断。

---

## 0. 目标与结论速览

用户要求分析三个 DSH 生态热门插件：`dsh-memory`、`mnemon`、`billion-context`。调研中发现 **`dsh-memory` 有两个同名但完全不同的项目**，故实际分析 4 个仓库：

| 名称 | 仓库 | 语言 | ★ | 定位 |
|---|---|---:|---:|---|
| **billion-context** | `ranxianglei/billion-context` | TypeScript | 1043 | 上下文**压缩**（模块级/代理级） |
| **mnemon** | `mnemon-dev/mnemon` | Go | 620 | **LLM 监督**的持久记忆（图库 + 单二进制） |
| **dsh-memory（灵枢）** | `FuRongJun-1999/dsh-memory` | Python | 374 | **Markdown 认知图** + MCP 白箱记忆 |
| **dsh-memory（git-memory）** | `seriousz158/dsh-memory` | TypeScript | 180 | **本地 Git 支撑**的 Markdown 记忆 |

**一句话区分**：billion-context 管「上下文怎么压」，mnemon/灵枢/git-memory 管「记忆怎么存与取」；且三者的记忆路线分别是 **图数据库（mnemon）、Markdown 认知图+MCP（灵枢）、Git+Markdown（git-memory）**。

---

## 1. billion-context —— 模型驱动的增量分层压缩

### 1.1 定位（事实）
一段话（README）：billion-context 是**上下文压缩插件**——小窗口（100K 够用）、省 5× token、单会话可跑数月（几十亿 token）、压缩质量高。它位于「任意 agent」与「模型 API」之间，改写 Anthropic/OpenAI 流。

支持 20+ 客户端（Claude Code / Codex / OpenCode / pi / Kimi / Gemini CLI / **deepseek-harness(dsh)** 等），**DSH 走 `dsh plugin --profile <name> add billion-context`**。

### 1.2 核心思想：模型写摘要，内核只编排（事实）
`kernel/DESIGN.md §1` 讲得非常直白——**acp-kernel 不像 zip**：
- zip：自己算压缩输出（`bytes → bytes`）。
- acp-kernel：**摘要文本由外部（LLM）产生并作为参数传入**；内核只决定 *何时压、压哪段、状态跟踪、应用决策、剪枝、支持解压/检索*，**它从不调用模型**。

也正因唯一外部依赖被缩减为一个「字符串输入」，内核才能是**纯库**：**无状态、无 I/O**，状态（`CompressionState`）每次调用显式进出，由宿主决定怎么持久化（DESIGN §2，zip 模型）。

### 1.3 每回合节点管线（事实）
`processTurn` 每回合按固定顺序跑：
```
assign-refs → sync-blocks → merge-blocks → prune → ccr-store → filter
→ hide-compress-calls → nudge-inject → emergency-truncate → render-refs
```
（kernel/src/pipeline.ts、DESIGN §4）

### 1.4 三级分层压缩 + 代数（事实）
`CompressionBlock` 带 `tier: 1|2|3`、`generation: young|old`、`survivedCount`：
- **Tier 1**：原始对话 → 摘要（模型调用 `compress`）。
- **Tier 2（蒸馏）**：已有摘要 → 精炼（`TIER2_DISTILL_RULES`）。
- **Tier 3（超浓缩）**：蒸馏摘要 → 极简事实索引（`TIER3_CONDENSE_RULES`）。

默认阈值（kernel/src/config.ts）：`tier2Trigger: 1000`、`tier3Trigger: 2000` tokens，`promotionThreshold: 5`（young→old 晋升，驱动 merge-blocks）。**明确注明：没有 GC——不做按龄停用、不做摘要截断**（DESIGN §3 NOTE）。

### 1.5 压缩哲学（事实，重点）
`kernel/src/compression-rules.ts` 的 `COMPRESS_PHILOSOPHY`：

> - 一切压缩服务于主任务，但要**节俭**。
> - 上下文容量宝贵：靠**压缩已消费的输出**省上下文，而不是回避使用工具。
> - **按需压缩，而不是按百分比压缩。**
> - 从摘要工作，而不是原始工具输出……

`HOW_TO_COMPRESS_RULES` 规定 KEEP VERBATIM / DROP / PRIORITY 三类：
- **KEEP VERBATIM**：带行号的完整路径（`lib/hooks.ts:347`，不许缩成裸文件名）、函数/类/类型签名、错误串与堆栈、决策+理由（“because” 是承重的）、约束、精确值（版本/阈值/魔法数）、**用户意图（引用须带 message ref**，否则只能转述）、**Open objectives 逐级携带**、目标及其演变、每个动作的目的、未解问题、关键锚点 ref。
- **DROP**：冗长日志（保留错误行）、重复文件读、已消费探索、死胡同（**保留一行教训** "tried X, failed because Y"）、已被最终结论取代的往复讨论、重复状态检查；每个被丢弃的大项补**一行内容描述**（不是位置）。
- **PRIORITY**：① 目标/演变/硬约束 ② 决策+理由 ③ 精确技术产物 ④ 结论 ⑤ 教训。

这些规则被标注为 **“load-bearing（承重）”**，tuned over months of production use；覆盖它们必须显式 `{ acknowledgeRisk: true }`（prompts.ts）。含多次事故驱动的修订（如 2026-09-06 写侧引文保真、2026-09-26 open-objectives 携带）。

### 1.6 可逆 + 前缀缓存友好（事实）
- 4 个上下文管理工具：`compress` / `decompress` / `search_context` / `acp_status`（+ 可选 `absorb` / `acp_rule`）。摘要存 block state，可 `search_context` 检索、`decompress` 恢复。
- README：健康会话保持 **95–97% prefix-cache 命中**，压缩本身开销 ≤2%。
- nudge（软/强提示）阈值：`minContextLimitPct 0.45`（软提示）→ `emergencyThresholdPct 0.95`（强告警），`truncate.threshold 0.95`（最后安全阀，应急截断工具输出）。

### 1.7 与 DSH 的接入（事实）
`dsh.bundle.patch.yml` 做两件事：
1. `insert: bili-native`（挂载 `billion-context` 插件）；
2. **`id: compaction-basic → auto: false`**——**关掉 DSH 自带的自动压缩**（避免双压缩）；并给 `llm-deepseek` 的 retryPolicy 补 `MALFORMED_RESPONSE`。

### 1.8 规模与战绩（事实）
论文标题即方法论：*Model-Driven Incremental Hierarchical Compression: Training-Free Multi-Generational Context Management for Long-Lived Coding Agents*。生产规模纵向研究：**4.5 个月 / 3 台主机 / 174,327 次模型调用 / 18.76B 累计输入 token（全主机 ~24.7B）/ 204,800-token 模型上零窗口违规 / 单会话最长 8,584–12,049 次调用**。

---

## 2. mnemon —— LLM 监督 + 四图知识库 + 单二进制

### 2.1 定位（事实）
`mnemon-dev/mnemon`：**为 AI agent 提供持久、跨会话记忆**——四图知识库 + 意图感知召回 + 重要性衰减 + 自动去重。形态是**一个本地 Go 二进制**（`docs/DESIGN.md`：one Go binary + SQLite，无外部 API）。跨 harness：DeepSeek Harness / Claude Code / Codex / pi / OpenClaw。

### 2.2 关键范式：LLM-Supervised（事实，区别于同类）
README 明列四种范式：
| 范式 | LLM 角色 | 代表 |
|---|---|---|
| LLM-Embedded | 管线内执行者 | Mem0, Letta |
| File Injection | 无（会话开始读文件） | Claude Code Memory |
| MCP Server | 工具提供者 | claude-mem |
| **LLM-Supervised** | **独立二进制的「外部监督者」** | **Mnemon** |

> 二进制做**确定性计算**（存储/图索引/检索/衰减）；**宿主 LLM 做判断**（记什么、怎么连、何时忘）。**无需额外推理成本、无中间商**。

### 2.3 数据模型：四图 + 三原语（事实）
- **四图**：temporal（时间）、entity（实体）、causal（因果）、semantic（语义）边，组织为知识结构。
- **三原语**：`remember` / `link` / `recall`——把 DB 操作映射到 LLM 的认知词汇（remember 而非 INSERT，recall 而非 SELECT）；输出结构化 JSON 带信号透明度。

### 2.4 写管线 `remember`（事实，docs/design/05）
```
validate → 生成 embedding（可选，Ollama nomic-embed-text 768d；不可用降级 token overlap）
→ 内置 diff（byte-identical → skipped；否则 added，附相似度建议）
→ 原子事务 BEGIN:
     ① INSERT insight  ② UPDATE embedding
     ③ Graph Engine: CreateTemporalEdge / CreateEntityEdges / CreateCausalEdges / CreateSemanticEdges(cos≥0.80)
     ④ RefreshEffectiveImportance  ⑤ AutoPrune(soft-delete 最低 EI)
   COMMIT
→ 候选输出：语义候选 cos∈[0.40,0.80) + 因果候选(2-hop BFS)
```
LLM 收到候选后，自行用 `mnemon link` 建立它认为合适的边。

### 2.5 读管线 Smart Recall（事实）
意图检测（WHY/WHEN/ENTITY/GENERAL，多语言词表）→ 多信号锚点选择（RRF fusion）→ **Beam Search 图遍历** → 多因子重排（KW + Entity + Similarity + Graph）。`--basic` 回退为 SQL LIKE。

### 2.6 生命周期 EI 衰减（事实）
```
EI = base_weight(importance) × access_factor × decay_factor × edge_factor
base_weight:  imp 5→1.0 / 4→0.8 / 3→0.5 / 2→0.3 / 1→0.15
access_factor: max(1.0, log(1 + access_count))
decay_factor:  0.5 ^ (days_since_access / 30)      // 半衰期 30 天
edge_factor:   1.0 + 0.1 × min(edge_count, 5)      // 最多 +0.5
```
- **免疫**：`importance ≥ 4` 或 `access_count ≥ 3` 不清除。
- **自动剪枝**：活跃 insight > **1000** 时，剔除免疫项后按 EI 升序 soft-delete（每批 ≤10，级联删边）。

### 2.7 DSH 接入（事实）
npm `@mnemon-dev/dsh-mnemon`（bundle，`dsh.bundle.patch` → 依赖 `dsh-mnemon`）。集成靠 **runtime-native SKILL.md + hooks/翻页**，由 agent 自行决定记忆动作。

---

## 3. dsh-memory（灵枢 LINGSHU，FuRongJun-1999）

### 3.1 定位（事实）
v0.8.1，中文文档：「让 AI Agent 拥有不可遗忘的记忆」——**高性能、无幻觉、多智能体适用的长期记忆系统**。形态：**跨 harness 的记忆基础设施——大脑（`md_cg/`）即标准 stdio MCP server**，任何支持 MCP 的 Agent 可接入（DSH / Claude Code / Codex CLI / CodeBuddy / ZCode …）。

### 3.2 核心思想：白箱 + 原文即真源（事实）
> 「对话自动沉淀为**纯文本 md 认知图**；**规则化检索引擎**决定记什么、取什么；**全过程可审计、结果可复现**。」
> 「检索索引只是派生物、随时可重建，**原文即真源**。」

### 3.3 五环理念（事实，README 表）
| 环 | 承诺 | 实现 |
|---|---|---|
| 存在 | 落盘不消失 | 写入过**三道闸门 + `committed` 字段确认**（绝不假装成功）；遗忘只能显式 `cg(op=forget)`，**不做静默淘汰**；索引可重建，原文即真源 |
| 记忆 | 人类可读认知图 | **CCG 六要素记忆卡**（功能名/生效条件/子功能/执行/验证方式/不适用条件）+ 纯 md |
| 验证 | 可裁决可复现 | **确定性规则裁决（零 LLM 黑箱）** + 四层证据防火墙 + 守卫测试 + 双实例互验 |
| 反思 | 观测并修正自身 | 元认知层按生效条件路由，**不确定即标 BLINDSPOT 而非猜测** |
| 连接 | 连所有智能体 | 标准 stdio MCP server，多智能体可 `--serve` 共享同一契约 |

### 3.4 接入方式（事实）
- `npx @furongjun1999/dsh-memory init` 生成各 harness 的 `mcp.json` 片段；DSH 走 `dsh plugin --profile web add .` + `dsh/cordis.yml` 启用。
- 大脑直接挂载：`python -m md_cg.mcp_server`（stdio MCP）。
- 记忆默认根 `~/.dsh/.dsh-memory/data/mdcg`（更新插件不丢）。

### 3.5 规模（事实）
`md_cg/` 上百个 Python 模块 + 上百个测试文件，并自带大量检索/记忆评测 benchmark（BEIR / LoCoMo / LongMemEval / MemBench / 自研「秤」评测规范）。仓库还含 `docs/`（大量中文设计白皮书：白箱化纲领、存算一体架构、记忆系统即白箱化智能等）、`skills/`、`swarm/`、`hive/`——**本质是一个研究型项目**。

> ⚠️ 规模与「研究性」意味着它远超一个普通插件；上手门槛和复杂度显著高于其余三者。

---

## 4. dsh-memory（git-memory，seriousz158）

### 4.1 定位（事实）
v0.10.0，`dsh-git-memory`：**本地 Git 支撑**的长期记忆插件。仓库根即 DSH bundle（host 插件 + settings 客户端）。**不发布 npm，走 GitHub 源码安装**：`dsh plugin --profile web add github:seriousz158/dsh-memory`。

### 4.2 存储与结构（事实）
- 记忆存**本地 Git 仓库**（非云、非托管服务）。
- `summary.md` = 短导航快照；细节在 `handbook/`、`rollouts/`、`archive/`。
- Markdown 记录支持 front matter、命名空间 id、provenance、过期投影、确定性冲突处理、旧版兼容。

### 4.3 读路径（事实）
- 启用时，一段**有界且显式「不可信」的 `summary.md` 快照**（上限 **12 KiB**）注入模型。
- `memory.search()` / `memory.context()`：本地有界检索，**带源引用**、usage-aware 确定性排序。**混合检索** = 派生 SQLite 索引（FTS5 trigram + CJK bigram/词）+ 词法打分 + 精确子串优先融合；索引缺失/陈旧/损坏时回退**纯扫描**。（索引位于 `.sync/search-index.sqlite`，严格权限）

### 4.4 同步/安全/恢复（事实）
- 可选 idle-session 同步器：headless、默认 `workspace-write`、只转发白名单环境；运行在**私有 per-run 工作区**，模型只能改隔离副本，宿主校验后写回真实 Git 仓库。
- dry-run/preview/apply、操作锁、健康检查、有界批、重试退避、去重诊断、元数据-only 日志。
- 恢复/回滚、备份导入导出、旧版迁移（可审计、可逆）。拒符号链接逃逸、非仓库根、路径竞争。

---

## 5. 四向对照

| 维度 | billion-context | mnemon | 灵枢 dsh-memory | git-memory dsh-memory |
|---|---|---|---|---|
| 解决的问题 | **上下文压缩** | 持久记忆 | 持久记忆 | 持久记忆 |
| 语言/形态 | TS；纯内核 + 代理/插件 | **Go 单二进制** + SQLite | **Python MCP server** + Node 包装 | TS；DSH bundle |
| 存储介质 | block 状态（宿主持久化） | SQLite(WAL) 四图 | **纯 Markdown 认知图**（原文即真源） | **本地 Git** + Markdown |
| 谁来「判断」 | **模型**写摘要 | **宿主 LLM 监督** | **确定性规则**（零 LLM 白箱） | 宿主模型（受控） |
| 写入时机 | 模型主动调 `compress` | hooks + agent 调 `remember` | MCP 工具调用 | 可选 idle-session 同步器 |
| 检索 | refs + `search_context` | RRF 锚点 + Beam 图遍历 + 多因子重排 | BM25/RRF 等（大量 benchmark 验证） | FTS5 + 词法 + 精确子串融合 |
| 注入 | 摘要替换折叠区 | 召回结果 JSON | MCP 工具返回 | `summary.md` ≤12 KiB |
| 生命周期 | **三级分层** + tier2/3 合并（无 GC） | **EI 衰减** + 免疫 + 自动剪枝 | 显式 forget，无静默淘汰 | 版本化 + 回滚 |
| 与压缩关系 | **就是压缩本身** | 独立层（与压缩解耦） | 独立层 | 独立层 |
| 可逆性 | ✅ decompress | ✅（soft-delete/保留） | ✅ 可回滚/迁移 | ✅ Git 回滚 |
| 对外协议 | 代理/原生插件 | CLI + skill/hooks | **标准 MCP** | DSH 插件 + settings UI |
| 上手门槛 | 低（装插件即用） | 低（一条命令） | **高**（研究型、体量大） | 中（Git 依赖、macOS 主目标） |

---

## 6. 与 GuaDa 的对照

| 维度 | GuaDa（本项目） | billion-context | mnemon / 灵枢 / git-memory |
|---|---|---|---|
| 压缩层级 | **两级**：微压缩（本地裁剪/思考剥离）+ 二级 LLM 摘要（单次遮蔽） | **三级分层**（T1 摘要 / T2 蒸馏 / T3 超浓缩）+ 可逆 | —（不做压缩） |
| 触发者 | **宿主自动**（阈值 0.8 / 溢出 / 手动） | **模型主动**（按需，`compress` 工具） | — |
| 可逆性 | ❌ 遮蔽后靠摘要（decompress 无） | ✅ `decompress` 恢复原文 | ✅ |
| 前缀缓存 | 明确对齐（摘要复用主请求前缀） | 明确对齐（95–97% 命中） | 不适用 |
| 记忆载体 | **`MEMORY.md` 索引 + 明细文件**（文件即记忆） | — | 图库 / Markdown 认知图 / Git+MD |
| 记忆写入 | **模型在对话中自行维护**（文件工具 + 提示词纪律 + 写入时确定性上限守卫）；压缩前影子轮次曾承担"强制整理"，**已禁用**（档位预设指向 `FAST`） | — | agent 自行判断 / 规则裁决 / idle 同步 |
| 记忆检索 | **无检索**（索引前 200 行纯注入） | — | 图遍历 / BM25-RRF / FTS5 混合 |
| 生命周期 | 无衰减/淘汰（AI 手动瘦身） | — | **EI 衰减 + 免疫 + 自动剪枝** |
| 对外接入 | 锁在 `.guada/memory`（本地单根） | 代理级、跨 20+ agent | **MCP / CLI**，跨 harness 复用 |

**核心差异**：GuaDa 把**记忆绑进压缩管线**（`compaction.before` 触发影子轮，压缩与记忆深度耦合），且**没有记忆检索**（纯索引注入）；而这三个插件把**记忆做成独立层**（图库 / MCP / Git），与压缩解耦，且都有**真检索**。

---

## 7. 对 GuaDa 的可借鉴点（供讨论，非结论）

1. **可逆压缩**：billion-context 的 `decompress` 让遮蔽可恢复。GuaDa 目前遮蔽即丢失（只靠摘要），可考虑「分层 + 可解压」。
2. **压缩分层**：T1→T2→T3 的多代分层（蒸馏/超浓缩）比 GuaDa 的单级摘要更抗长期侵蚀；GuaDa 的二级摘要可扩展为分层。
3. **记忆检索**：GuaDa 记忆目前零检索（200 行硬预算注入）。mnemon 的 RRF+Beam、git-memory 的 FTS5 混合、灵枢的 BM25/RRF 都提供了「按需召回」范式。
4. **记忆生命周期**：mnemon 的 **EI 衰减 + 免疫 + 自动剪枝**可作为 GuaDa `MEMORY.md` 无序增长（现靠 AI 手动瘦身）的机制化补充。
5. **MCP 化记忆**：灵枢/mnemon 把记忆做成标准 MCP server，实现**跨 harness 复用**；GuaDa 记忆锁在 `.guada/memory`，若要跨端共享可参考。
6. **「原文即真源 + 索引可重建」**：与 GuaDa 的 JSONL/MD 文件化理念一致——索引/向量只作派生物，这条双方已共识。
7. **上限守卫与协议纪律（已实施）**：另一个 DSH 记忆方案 `tinqiao-oss/engramory` 提供了两样本仓已采纳的东西：
   ① **写入时确定性上限守卫**（超硬上限且变长即拒绝，缩小永远放行）落在 `FilePlugin.evaluateMemoryIndexCap`；
   ② **协议纪律**（索引四分类、`Why:` / `How to apply:`、任务结束检查点与换线程前同步、不写会腐坏的当前状态）。
   实现细节与诚实边界见 [../memory.md](../memory.md)。

---

## 8. 证据与出处

| 结论 | 证据（相对 `tmp_dsh_plugins/`） |
|---|---|
| 压缩哲学与三级规则 | `billion-context/kernel/src/compression-rules.ts` |
| 内核纯库/无状态/管线 | `billion-context/kernel/DESIGN.md §1-4` |
| 阈值默认值 | `billion-context/kernel/src/config.ts` |
| DSH 接入（关自带压缩） | `billion-context/dsh.bundle.patch.yml` |
| 论文战绩 | `billion-context/README.md`、`paper/` |
| LLM-Supervised 范式 | `mnemon/README.md` |
| 四图/EI/剪枝 | `mnemon/docs/DESIGN.md`、`docs/design/05-pipelines.md`、`06-lifecycle.md` |
| 灵枢五环/形态 | `dsh-memory/README.md`、`dsh-memory/md_cg/` |
| git-memory 读路径/结构 | `dsh-memory-sz158/README.md` |

> 本地源码副本位于工作区 `tmp_dsh_plugins/`（分析用临时目录，可删）。
