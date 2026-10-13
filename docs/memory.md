# 长期记忆（MEMORY.md 索引）

长期记忆是**一个 Markdown 索引 + 按需读取的明细文件**，全部落在会话记忆目录下，由 AI 用
**普通文件工具**维护——没有专用记忆工具。压缩侧（触发时机、裁剪/摘要档位）见
[design/compression-pipeline.md](design/compression-pipeline.md)。

## 形态与位置

```
<workspace>/.guada/memory/          ← 记忆目录（= 路径牢笼根，影子轮次启用时生效）
├── MEMORY.md                       ← 索引：唯一注入上下文的记忆文件（前 200 行）
├── feedback/feedback_testing.md    ← 明细：分类目录由 AI 自定
└── arch/workspace_panel.md
```

| 会话 | 记忆目录 |
|------|----------|
| 主会话（web / bot） | `<workspace>/.guada/memory/` |
| 子智能体 | `<workspace>/.guada/subagents/<sessionId>/memory/`（**完全隔离**，父级读不到） |

路径解析的单一真相是 `common/utils/memory-path.util.ts`（插件注入、牢笼根与写入守卫目标必须逐字相同）。

索引按四类分组（`## user` / `## feedback` / `## project` / `## reference`），条目格式：

```
## feedback
- [测试禁 mock](feedback/feedback_testing.md) — 集成测试打真库
```

- `user` = 用户是谁（身份、角色、专长、关于他的持久偏好）；`feedback` = 可复用的纠正与工作方式
  （"怎么工作"，跨任务有效）；`project` = 我们在做什么（目标/决策/约束/阻塞/下一步，绝对日期）；
  `reference` = 外部资源指针（URL、看板、工单、日志路径）。
- `feedback` 与 `project` 的**明细文件体**要求 `Why:` 与 `How to apply:` 两行（提示词级要求，代码不校验）。
- 易混澄清（写在指南里）：`feedback` 是"怎么工作"，`project` 是"我们在做什么"——
  "用中文回答" 是 feedback，"接着修那个被阻塞的序列化测试" 是 project。

## 注入

`MemoryPlugin`（prompt-only 插件，`category: core`）注册一个 `frequency: "VOLATILE"` 的提示词：

- 读 `MEMORY.md`，**只注入前 `MEMORY_INDEX_MAX_LINES = 200` 行**；超限时在注入块末尾追加一行
  "共 N 行，仅前 200 行可见"，提示模型瘦身。超出部分不进上下文（不是截断警告，是硬预算）。
- 超过**软上限**（150 行 / 20KB）但未超硬上限时，追加一行"接近上限、建议整理"，不截断。
- 行数口径是 `countIndexLines()`（**忽略末尾单个换行**），注入截断与写入守卫共用——否则
  "正好 200 行 + 文件末尾换行"会被算成 201 行而误报/误拒。
- 紧随其后注入常驻的维护指南：索引格式与四分类、软/硬上限、**何时写**（用户要求或学到持久事实 /
  任务结束跑一次策展检查点 / 换线程前同步一次）、**不要写什么**（仓库或 git 已记录的内容、会腐坏的
  当前状态如版本与 tip commit、多条并行的 project 笔记、任务进度与 TODO、密钥值）、分类目录惯例。
- **无插件侧缓存**：每次构建 system 提示词都直读文件。`JsonlSessionContext.systemText` 每个回合
  只构建一次，因此记忆改动**下一回合**可见（同一回合内的写入不会回流到本轮 system 提示词）。
- 工具包 `id` 仍为 `memory`：智能体层 `toolkits_deny: ["memory"]` 等既有迁移零改动继续生效，
  禁用该包时索引与维护指南一并消失。

## 维护

索引与明细的**写入全部由 AI 用文件工具完成**（`read` / `write` / `edit` / `glob` / `grep`）。
代码**不校验索引格式、不自动追加条目**——排序、去重、分类、瘦身都靠注入的维护指南约束
（格式一致性换提示词简单性；代价是一次错误的 `write` 可以整体覆盖索引）。

**但体积是确定性强制的**：`FilePlugin.evaluateMemoryIndexCap` 在 `write` / `edit` 的本地分支内
（`withFileLock` 内、落盘之前）判定，规则与 engramory 的 cap hook 同构：

- 只对**会话自己的索引路径**生效（不是任何名为 `MEMORY.md` 的文件；明细文件不限体积）；
- 只有"结果超硬上限（200 行 / 25KB，先到者）**且**比当前文件更长"才拒绝 → 缩小/持平永远放行，
  可以 210 → 205 → 198 逐次瘦身；索引不存在视为空，首次就写超限会被拒；
- 超软未超硬 → 放行，并在工具结果里附带整理提醒；
- 拒绝信息报出行数/字节数、说明超出部分永不注入、给出瘦身动作，且明确"缩小的写入总是放行"。

旧布局（`memory/factual.md` + `memos/*.md`）在索引不存在时**懒迁移一次**：旧内容**复制**进
`memory/notes/legacy_factual.md` 与 `memory/memos/*.md`，生成无摘要索引行留给 AI 补写；
原文件不删除，迁移失败只记日志。

## 压缩前影子轮次（**当前禁用**）

> **当前状态：禁用。** 档位预设（`compression-tiers.ts`）两档的 `summaryMode` 已指向 `FAST`
> （`SummaryMode.DEFAULT` 亦重指 `FAST`），因此 `MemorySyncService` 不会被触发——压缩照常摘要，
> 但不再有压缩前的强制记忆整理。禁用的理由是它会在摘要前串行插入最多 5 轮 LLM 调用（拉长压缩耗时），
> 且交互不入库、不发 SSE，只能靠 `compression.jsonl` 审计。
>
> 本节描述的实现**全部保留在仓中休眠**（服务、工具范围锁、路径牢笼、日志、spec 均未删除）。
> **重新启用 = 把 `compression-tiers.ts` 两档改回 `SummaryMode.MEMORY_SYNC`**（并同步更新
> 用户可见文案与本文档的"当前禁用"标注）。子代理跳过逻辑（见下）在启用时依然生效。

`MemorySyncService` 订阅 `compaction.before`，在 `summaryMode === 'memory_sync'` 时（启用后由
`conservative` / `aggressive` 两档产生）于二级摘要**之前**静默跑一轮记忆维护：

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

瞬态、不入库，与工具范围锁定正交。**当前无生产调用者**（唯一调用方是已禁用的影子轮次），
机制与测试保留休眠；启用影子轮次后即生效。语义：

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
| 智能体 | `settings.memory.compressionTier` | `off` → 不压缩；`conservative` / `aggressive` → 压缩并摘要（**两档当前都不跑影子轮次**，见上） |
| 会话 | `settings.memory` | **不生效**：`filterAndMergeSessionSettings` 恒被智能体值覆盖（DTO 仅声明契约） |

硬限制（200 行 / 25KB 硬、150 行 / 20KB 软、影子轮 5 轮）无配置项，改 `memory-path.util.ts` 常量。

## 已知边界

- **无删除工具**：`FilePlugin` 的 `delete` 是注释掉的，AI 只能从索引摘条目，明细文件留在盘上。
- **200 行是提示词成本**：比旧版 3000 字符上限大约 2–3 倍，纯增量注入，无检索参与。
- **上限守卫不是安全边界**：只拦**文件工具的 `write`/`edit` 本地分支**。shell 重定向与脚本、
  远端工作目录 provider、文件上传 API 等其它写通道绕过它——这是纪律栏杆（与 engramory 的
  cap hook 同样的诚实边界），不是沙箱。
- **格式仍然无人校验**：四分类标题、`Why:` / `How to apply:`、条目格式都只是提示词要求，
  没有校验器也没有自动追加；写坏索引不会被系统发现（仅体积受强制）。
- **守卫按会话判定**：子智能体上下文里，主会话索引不算"它的索引"（守卫只保护各自会话的索引路径）。
- **并发**：同一工作区的多会话各自维护同一份 `MEMORY.md`；文件锁只保证单次写入不撕裂，
  "读索引 → 思考 → 改索引"跨调用不原子，存在后写覆盖窗口（守卫的比较也在锁内，仍不解决此窗口）。
- **子智能体：隔离 + 不自动维护**。影子轮次跳过子代理（短任务假设）；在影子轮次本身已禁用的当前状态下，
  主会话与子代理都不自动维护记忆，子代理的隔离目录通常没有任何文件——只有它自己在普通回合里主动写入
  才会产生内容，且 run 结束后无人再读。
- **子代理仍在付注入成本**：子代理的 system 提示词里仍有索引块与维护指南（现在约 2K 字符），内容恒为
  `(no memory index yet)`。若判定子代理不应有记忆系统，下一步是连注入一起去掉（插件按 `sessionType`
  返回空串即可），再往后才是删掉工具包。
- **兜底只剩提示词时机**（禁用影子轮次的直接后果）：指南现在给了"何时写"（任务结束检查点、换线程前同步），
  但仍是模型自觉；若它把信息拖到压缩之后才想保存，该信息已不在上下文里（JSONL 仍在，模型看不到了）。
  这是为换取压缩耗时与可审计性而接受的取舍。
- **智能体禁用 file 工具包时**（仅影子轮次启用状态下适用）：影子轮次的工具调用全部被作用域拒绝 →
  记忆维护静默空转（fail-open）。
