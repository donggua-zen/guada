# 长期记忆（MEMORY.md 索引）

长期记忆是**一个 Markdown 索引 + 按需读取的明细文件**，全部落在会话记忆目录下，由 AI 用
**普通文件工具**维护——没有专用记忆工具。压缩侧（触发时机、裁剪/摘要档位）见
[design/compression-pipeline.md](design/compression-pipeline.md)。

## 形态与位置

```
<workspace>/.guada/memory/          ← 记忆目录（= 影子轮次的路径牢笼根）
├── MEMORY.md                       ← 索引：唯一注入上下文的记忆文件（前 200 行）
├── feedback/feedback_testing.md    ← 明细：分类目录由 AI 自定
└── arch/workspace_panel.md
```

| 会话 | 记忆目录 |
|------|----------|
| 主会话（web / bot） | `<workspace>/.guada/memory/` |
| 子智能体 | `<workspace>/.guada/subagents/<sessionId>/memory/`（**完全隔离**，父级读不到） |

路径解析的单一真相是 `common/utils/memory-path.util.ts`（插件注入与影子轮次牢笼根必须逐字相同）。
索引条目格式：

```
[测试禁 mock](feedback/feedback_testing.md) — 集成测试打真库
```

## 注入

`MemoryPlugin`（prompt-only 插件，`category: core`）注册一个 `frequency: "VOLATILE"` 的提示词：

- 读 `MEMORY.md`，**只注入前 `MEMORY_INDEX_MAX_LINES = 200` 行**；超限时在注入块末尾追加一行
  "共 N 行，仅前 200 行可见"，提示模型瘦身。超出部分不进上下文（不是截断警告，是硬预算）。
- 紧随其后注入常驻的维护指南（格式、按重要性排序、200 行预算、分类目录惯例、不要把任务进度写进记忆）。
- **无插件侧缓存**：每次构建 system 提示词都直读文件。`JsonlSessionContext.systemText` 每个回合
  只构建一次，因此记忆改动**下一回合**可见（同一回合内的写入不会回流到本轮 system 提示词）。
- 工具包 `id` 仍为 `memory`：智能体层 `toolkits_deny: ["memory"]` 等既有配置零迁移继续生效，
  禁用该包时索引与维护指南一并消失。

## 维护

索引与明细的**写入全部由 AI 用文件工具完成**（`read` / `write` / `edit` / `glob` / `grep`）。
代码**不校验索引格式、不自动追加条目**——顺序、去重、瘦身都靠注入的维护指南约束。
这是刻意的取舍：格式一致性换提示词简单性，代价是一次错误的 `write` 可以整体覆盖索引。

旧布局（`memory/factual.md` + `memos/*.md`）在索引不存在时**懒迁移一次**：旧内容**复制**进
`memory/notes/legacy_factual.md` 与 `memory/memos/*.md`，生成无摘要索引行留给 AI 补写；
原文件不删除，迁移失败只记日志。

## 压缩前影子轮次

`MemorySyncService` 订阅 `compaction.before`，在 `summaryMode === 'memory_sync'` 时（`conservative` /
`aggressive` 两档的默认值）于二级摘要**之前**静默跑一轮记忆维护：

- **子智能体会话跳过**：子代理的定位是短任务，一次 run 的记忆产出无人再读（隔离目录在 run 结束后
  成为孤儿），强制整理只烧 token 没有收益。隔离本身不解除——子代理的索引注入与文件工具仍指向
  它自己的 `.guada/subagents/<id>/memory/`，只是不再有那次强制整理；
- 锁定 `setToolScope("file")` + `setPathJail(memoryDir)`，退出时 `finally` 原样恢复；
- 最多 5 轮 LLM 调用，单次不重试，不入库、不发 SSE，失败 fail-open（不阻断压缩）；
- 指令要求 AI 用文件工具维护索引与明细，并**用绝对路径**（相对路径按工作目录解析，落在牢笼外）；
- 请求前缀（system + tools + 完整 surface）与主请求逐字节一致，只追加 novel 后缀——复用 provider
  的 warm prefix cache。**收窄只在执行期做**（工具范围 + 牢笼），不得改为过滤工具定义或改写 system，
  否则前缀失配、缓存失效（见 [design/summary-prefix-cache-plan.md](design/summary-prefix-cache-plan.md) §3）；
- 每轮结束向 `<workspace>/.guada/logs/compression.jsonl` **追加一行 JSON**（真 JSONL；超过 5MB
  轮转一代到 `.1`）。影子轮次不入库、不发 SSE、模型输出在别处丢弃，该文件是它唯一的观测面：
  一行 = `{time, sessionId, records: [抽样上下文消息, 指令, 模型输出, 工具调用与结果]}`。

## 路径牢笼（`ISessionContext.setPathJail`）

瞬态、不入库，与工具范围锁定正交。语义：

- **只收窄，不改变路径语义**：相对路径仍按工作目录解析；牢笼只决定"落点是否被允许"。
- 覆盖全部文件工具（`read` / `glob` / `write` / `edit` / `grep`），收口在 `FilePlugin.resolvePath`——
  读类工具本身没有沙箱约束且接受绝对路径，不能只在写校验上挂。
- **牢笼优先于读安全模式**：牢笼内的写入不受 `read-only` 限制（记忆维护是系统级写入，且原记忆工具
  同样绕过沙箱）；牢笼外一律拒绝。
- **前台同样有只读例外**（无牢笼时）：会话自己的记忆目录在 `read-only` 下也始终可写——记忆是应用状态
  而非项目文件，且压缩前维护本就绕过只读，前后台语义需一致。记忆目录之外照旧拒绝。
- 牢笼内写入不唤起用户审批（后台系统流程自带授权；`sandbox_permissions` 提权参数已于 2026-10
  移除——模型不能自我提权，越界由系统询问用户）。
- 禁用远程工作目录（`workspace` 参数）：牢笼是本地单根约束，远端路径不在包含性判断内。
- `glob` 在牢笼下拒绝绝对 pattern 与含 `..` 的 pattern（fast-glob 的 `cwd` 只约束基准目录），
  且省略 `directory` 时以牢笼根为基准。

## 配置面

| 作用域 | 键 | 效果 |
|--------|-----|------|
| 插件（全局） | `plugins_config.memory` | 记忆能力包总开关（默认开） |
| 智能体 | `settings.plugins.memory.toolkits_deny: ["memory"]` | 关掉索引注入（工具包级） |
| 智能体 | `settings.memory.compressionTier` | `off` → 不压缩、不跑影子轮次；`conservative` / `aggressive` → 跑 |
| 会话 | `settings.memory` | **不生效**：`filterAndMergeSessionSettings` 恒被智能体值覆盖（DTO 仅声明契约） |

硬限制（200 行、5 轮）无配置项，改常量。

## 已知边界

- **无删除工具**：`FilePlugin` 的 `delete` 是注释掉的，AI 只能从索引摘条目，明细文件留在盘上。
- **200 行是提示词成本**：比旧版 3000 字符上限大约 2–3 倍，纯增量注入，无检索参与。
- **并发**：同一工作区的多会话各自维护同一份 `MEMORY.md`；文件锁只保证单次写入不撕裂，
  "读索引 → 思考 → 改索引"跨调用不原子，存在后写覆盖窗口。
- **子智能体：隔离 + 不自动维护**。影子轮次跳过子代理（短任务假设），因此子代理的隔离目录里
  通常没有任何文件；只有子代理自己在普通回合里主动写入时才会产生内容，且 run 结束后无人再读。
- **子代理仍在付注入成本**：跳过只覆盖影子轮次，子代理的 system 提示词里仍有索引块与维护指南
  （约 1.4K 字符），内容恒为 `(no memory index yet)`。若判定子代理不应有记忆系统，下一步是连注入
  一起去掉（插件按 `sessionType` 返回空串即可），再往后才是删掉工具包。
- **智能体禁用 file 工具包时**，影子轮次的工具调用全部被作用域拒绝 → 记忆维护静默空转（fail-open）。
