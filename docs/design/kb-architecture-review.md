# 知识库架构现状评审

> 面向优化工作。读完应能回答：现在有什么、边界在哪、哪里是真正的瓶颈、哪些是"看起来能用但没接线"的东西。
> 现有设计文档（[knowledge-base.md](../knowledge-base.md)、[kb-storage.md](kb-storage.md)）描述的是**存储形态的由来**，本文补的是**检索质量与扩展性**这条线，以及两份文档都没覆盖的问题清单。

评审日期：2026-09-24
评审范围：`backend-ts/src/modules/knowledge-base/**`、`kb-ref` 接线、前端 `components/knowledge-base/**`、测试与黄金基线

---

## 1. 一句话概括

**存储与一致性做得相当扎实，检索质量与扩展性还没开始做。**

存储侧（每库一个自包含 SQLite、单事务写分块+向量+FTS、原件副本进库、可重建向量、连接 LRU）已经是一个能长期跑的形态，不变式也写进了文档。但检索侧目前是"能搜到"的水平：**向量检索是全表扫描**、**分块预处理会破坏文档结构**、**BM25 在 20 篇候选上算 IDF**、**Agent 必须自己想起调工具**。优化空间基本都在后半段。

---

## 2. 现状架构

### 2.1 存储分层

```
<KB根>/<kbId>/
  kb.json                  KB 身份与配置（低频写、人可读）
  kb.db                    条目树 + 分块正文 + 向量 + FTS
  raw/<itemId>/<文件名>     原件副本
```

`<KB根>` 解析：`kbStorageRoot` 设置 → `KB_DATA_DIR` → `USERDATA_DIR/data/kb` → `./data/kb`。**进程内只读一次，换根需重启**（刻意的，避免半程状态）。

`kb.db` 三张表（`kb-schema.ts`，schema version 1）：

| 表 | 内容 | 关键点 |
|---|---|---|
| `item` | 条目树（文件 + 文件夹） | 用 `parent_folder_id` + `relative_path` 双表达层级；`raw_name` 指向库内原件 |
| `chunk` | 分块正文 + `embedding BLOB` + `embedding_dimensions` | **无 `knowledge_base_id` 列——库即作用域** |
| `chunk_fts` | FTS5，`content` 存 **jieba 分词后**的文本 | 独立表 + 显式 rowid 同步，**不能用 external-content**（否则中文检索静默失效） |

连接管理（`kb-database.service.ts`）：懒开、LRU 上限 8、打开即迁移、`WAL + busy_timeout=5000 + synchronous=NORMAL`、关闭前 `wal_checkpoint(TRUNCATE)`、版本高于程序则拒绝打开并隔离。

### 2.2 摄入链路

```
上传/Agent 添加
  → 建 item 行（先拿 itemId）
  → 写 raw/<itemId>/<文件>
  → 后台串行处理（静态 Promise 信号量，避免并发 OCR/嵌入压垮机器）
       解析 parseFile → 分块 chunkPages → 嵌入 getEmbeddings
       → replaceChunks（单事务：删旧 chunk + 删旧 FTS + 插新 chunk + 插新 FTS）
       → 标记 completed
```

进度分段：1% 准备 → 2~80% 解析 → 82% 分块完成 → 86% 开始向量化 → 88~93% 向量化 → 95% 保存 → 100%。

支持格式（`file-parser.service.ts`）：37 种文本/代码扩展名（txt/md/py/js/ts/java/go/rs/json/yaml/sql/sh…）+ pdf + docx + xlsx + 图片（png/jpg/jpeg/bmp，走 OCR）。单文件上限 1 GB。

### 2.3 检索链路

`KbSearchService` 三条路：

**语义**：`vec_distance_cosine(embedding, ?)` + `ORDER BY distance ASC LIMIT ?`，`WHERE embedding IS NOT NULL`（缺向量的行被排除）。

**关键词**：`chunk_fts MATCH ?` + `bm25(chunk_fts)`，查询侧把 token 用 `OR` 连接；连字符词（`DV430FBM-N20`）同时保留原词与拆分子词。

**混合**：
```
两路各召回 topK × 4
  → BM25 候选集内重排（仅 keyword 路）
  → 动态权重（keyword 结果的 CV < 0.1 或 mean < 0.001 时，keyword 权重降到 max(0.1, w/3)）
  → RRF 融合（K = 60）
  → min-max 归一化 → score ∈ [0, 1]
```

分词（`kb-tokenizer.ts`）：写入与查询共用同一实例；中文走 jieba（搜索模式 `cut(text, true)`），英文原样交给 FTS5 默认 tokenizer；**BM25 另有一套刻意不同的分词**（不过滤空 token，因为它们计入文档长度，影响 BM25 分母）——黄金基线会抓住任何"顺手统一"。

### 2.4 Agent 接线

```
session 携带 knowledgeBaseIds
  → KnowledgeBaseService.findByIds 展开
  → 注入 KbRefBlock（结构化，前端渲染 chips）
  → LLM 侧由 L1 管线投影为清单文本 [referenced knowledge bases]\n- name: ..., id: ...
  → Agent 自行决定是否调 kb_search
```

工具（`plugins/knowledge-base.plugin.ts`，toolKit `loadMode: "lazy"`，bot session 改 `eager`）：

| 工具 | 作用 | 备注 |
|---|---|---|
| `kb_search` | 混合检索 | 权重硬编码 0.6 / 0.4 |
| `kb_list_files` | 列文件（分页） | |
| `kb_get_chunks` | 读某文件的分块（分页） | 用于"搜到后再看全文" |
| `kb_add_document` | 把本地文件加入库 | 仅 web session，`dangerLevel: "high"` |

另有一个独立工具包 `plugins/document.plugin.ts`（`doc_parse` / `doc_batch_parse`），只解析不入库，与本模块共享 `FileParserService`。

### 2.5 测试

- **黄金基线** `test/knowledge-base/fixtures/kb-search-golden.json`（893 KB）：160 条真实分块（中英混排，源自旧全局向量库抽样）、dim=64 合成向量、多条查询，**逐条断言三条检索路径的 id 序列与分数**。这是本模块最有价值的测试资产——它把"搬运时不许改算法"变成了可执行的约束。
- 另有 chunking / file-parser（含 pdf 路由）/ ocr / kb-database / kb-chunk.repository / kb-file.repository / kb-migration 的 spec。

---

## 3. 问题清单

按"对优化工作的阻塞程度"排序。

### P0 — 向量检索没有索引，且会阻塞事件循环

`kb-search.service.ts:48` 用的是 `vec_distance_cosine(embedding, ?)`，这是 sqlite-vec 提供的**标量函数**，作用在普通 `chunk.embedding` BLOB 列上。它没有索引可用，执行计划必然是**全表扫描 + 逐行算余弦**。

三个后果：

1. **线性增长**。文档说"单库万级分块为数十毫秒量级"是准确的，但那是 10⁴。10⁵ 块约数百毫秒，10⁶ 块就是秒级——而单文件上限 1 GB，攒到百万块并不难。
2. **阻塞整个 Node 事件循环**。`better-sqlite3` 是同步 API，全表扫描期间进程无法处理任何其他请求。这是比"慢"更严重的问题：一次大库检索会卡住所有会话。
3. **扩展名不匹配**。`sqlite-vec` 已经 `load(db)` 了，`vec0` 虚拟表唾手可得；`chunk.embedding_dimensions` 这一列的存在（"维度按库隔离"）恰恰是为 `vec0` 准备的。说明这是**已知未做**，不是没想到。

> **改造结果（2026-09-24 已落地，实测数据见附录 B）**：已接上 `vec0` 索引 + 双写 + 回填。
> 但实测纠正了一个预期错误——**`vec0` 不是 ANN 索引，而是 SIMD 加速的暴力搜索**，
> 复杂度仍是 O(n)。收益是**常数级 ~2 倍**（20k 块：74ms → 31ms），**不是**复杂度的改变。
> 所以本条 P0 只是**缓解**，没有解决：10 万块量级仍会有 150ms 级的主线程阻塞。
> 要真正解决，剩下两个方向：**量化**（sqlite-vec 0.1.9 支持 `int8` / 二值量化 + Hamming 距离，
> 见附录 B.3）与**把检索移出主线程**（worker_threads）。

### P1 — 分块预处理破坏文档结构

`chunking.service.ts:330`：

```js
processed = processed.replace(/\s+/g, " ");   // 所有空白（含换行、制表符）压成单个空格
```

这一步之后：

- Markdown 的标题/列表/引用/代码块围栏**全部塌成一行**；
- 代码缩进丢失（Python 直接不可读，diff 无法辨认）；
- 表格列对齐消失；
- 段落边界消失，只剩句子边界。

而这个 KB 明确支持 37 种文本/代码扩展名（md、py、js、ts、java、go、rs、sql、yaml…）。**"支持这些格式"和"把它们的结构抹平"是自相矛盾的。**

旁证：黄金基线里的语料就是 Android `BoardConfig.mk` 的 diff，能直接看到 `BOARD_MKBOOTIMG_ARGS := $(TARGET_DEVICE_DIR)/dtbo. img` —— `dtbo.img` 被拆出了空格，正是预处理造成的。

配套问题是**切分单元**：`tokenBasedChunking` 只按 `(?<=[。！？.!?])` 切句。对代码和 Markdown 来说句子不是自然的语义单元，标题、函数定义、代码块才是。

> 优化方向：按文件类型分流预处理（代码/结构化文档保留换行与缩进）；切分器按格式选策略（Markdown 按标题层级，代码按函数/类边界，纯文本才按句子）。改这里会**破坏黄金基线**——基线是"复现旧实现"的约束，不是"正确行为"的约束，需要有意识地更新它并说明理由。

### P1 — BM25 的 IDF 建立在 20 篇语料上

`rerankWithBM25(results, queryText)` 的 `results` 是 FTS 召回的 `topK × 4` 条（默认 **20** 条）。于是：

- `N = 20`，`avgDocLen` 是这 20 条的平均；
- 公式切换阈值 `df > N/2` 落在 **df > 10**，也就是"出现在一半以上候选里"就换公式——在一个 20 条的样本上，这个判据几乎没有统计意义。

更微妙的是：SQL 里的 `bm25(chunk_fts)` 已经在**全表统计**下算过一次（`keywordSearch` 的 `ORDER BY score ASC`），然后被这个候选集内的 BM25 **整个覆盖**（`rerankWithBM25` 把 `score` 和 `bm25Score` 都改成自己的值）。两次 BM25 口径不同，第二次的信息量反而更少。

> 优化方向：要么信任 FTS5 的 bm25（全表 IDF，本来就对），要么把候选集放大到有统计意义的规模再重排。二选一，不要既覆盖又只用 20 条。

### P1 — 两个入口的融合权重默认值不一致

| 入口 | semantic | keyword |
|---|---|---|
| `kb-search.controller.ts:63-64`（REST / 前端） | **0.3** | **0.7** |
| `knowledge-base.plugin.ts:101-102`（Agent 工具） | **0.6** | **0.4** |

同一次检索，走 UI 面板和走 Agent 工具会得到**不同的排序**。而 `kb.json` 里根本没有权重字段，所以 [knowledge-base.md](../knowledge-base.md) 里"权重可配置"只在 REST 请求体这一条路上成立。

> 优化方向：权重落到 `kb.json`（每库可配），两个入口都读它；默认值统一。

### P2 — 四个死配置字段

`kb.json` 里存了、迁移器也搬了、但**没有任何代码读**：

| 字段 | 默认 | 实际使用 |
|---|---|---|
| `chunkMinSize` | 50 | 无。分块只用 `chunkMaxSize` / `chunkOverlapSize` |
| `metadataConfig` | null | 无 |
| `isPublic` | false | 无。没有任何访问控制读它（`auth.guard.ts` 里的 `isPublic` 是另一个装饰器） |
| `isActive` | true | 无。没有任何列表/检索过滤它 |

危害不是功能缺失，而是**误导维护者**：改了没反应，或者以为有权限隔离而实际没有。

> 优化方向：要么接线（`chunkMinSize` 至少能当"过短分块合并阈值"），要么从 schema 里删掉并在迁移里注明。留着的成本高于删掉。

### P2 — 重复文档不检测

`uploadFile` 老老实实算了 `contentHash`（md5）并落库（`kb-file.service.ts:332`），但**全项目没有任何地方查它**。同一份文件重复上传 → 重复解析、重复 OCR、重复嵌入、重复占空间、检索结果里出现重复条目。

> 优化方向：上传前按 `contentHash` 查同库已有条目，命中则提示"已存在，是否覆盖/跳过"。`contentHash` 已经在表里，成本很低。

### P2 — 检索结果没有相邻分块扩展，且 `kb_search` 的文本投影丢掉了定位信息

返回的是孤立分块，没有"命中块 ± N 相邻块"的拼接。对照 Qoder 的 QMind：检索接口直接返回服务端拼好的 `promptContext`，客户端零加工。

配套有一个**确凿的小 bug**。`kb_search` 的工具输出长这样（`knowledge-base.plugin.ts:111-118`）：

```js
const chunkIndex = result.metadata?.chunkIndex;
const chunkLabel = chunkIndex !== undefined ? `, chunk: ${chunkIndex}` : "";
parts.push(`--- [${i + 1}] file: ${fileName}${chunkLabel} ---`);
```

但 `metadata.chunkIndex` **永远是 `undefined`**：

- 写入侧 `kb-file.service.ts:636-642` 的 `metadata` 只有 `{ fileId, knowledgeBaseId, fileName, overlapLength, strategy }`——**没有 `chunkIndex`**（`chunkIndex` 只写进了 `chunk.chunk_index` 列）；
- 读取侧 `mergeMetadata` 只合并 `metadata_json` + `item` 表字段（`fileName/fileExtension/fileType/relativePath`），**不会带上行的 `chunk_index`**。

所以 `chunkLabel` 恒为空字符串，那段"显示 chunk 序号"的代码从未生效。

同时 `metadata.fileId` 是**有**的（在 `metadata_json` 里），但工具文本只渲染了 `fileName`，没有渲染 `fileId`。于是 Agent 拿到一次搜索结果后，**既没有文件 id 也没有分块序号**，想深入看上下文只能先 `kb_list_files` 找到 id 再 `kb_get_chunks`——多一跳，且它通常不会主动做。

> 优化方向：① 把 `chunkIndex` 写进 `metadata_json`（或让 `mergeMetadata` 带上 `row.chunk_index`）；② 工具文本补上 `file_id` 与 `chunk_index`；③ 加"± N 相邻块"拼接（同一 `item_id` 内按 `chunk_index` 相邻即可，无需新表）。

### P2 — 跨库查询是 O(库数) 次打开

`findByStatus` / `listItems` 省略 `kbId` 时遍历所有库、逐个 `getDb`。启动期三个动作全走这条路：

```
resumePendingFileTasks  → fileRepo.findByStatus(["pending","processing"])
cleanupOrphanFiles      → fileRepo.listItems(undefined, false)
reportOrphanRawDirs     → fileRepo.listKbIds() + listItemIds(每库)
```

库数超过 LRU 上限 8 时，会**反复 open/close + 每次 close 都做 `wal_checkpoint(TRUNCATE)`**。库多、文件多时启动会明显变慢，而且这段时间 `onModuleInit` 是阻塞的。

> 优化方向：启动期对账不要经过 `getDb` 的连接池，用一次性只读连接；或者把对账改成惰性（首次访问该库时再做）。

### P3 — 删除文件夹不是原子的

`deleteFolderRecursive`：`chunkRepo.deleteMany`（一个事务）之后，是**逐条循环** `fileRepo.delete` + `removeRawDir`（每条各自事务）。崩在中间会留下"条目行还在、分块已经没了"的半程状态，该文件会显示为 completed 但搜不到内容。

> 优化方向：把 `item` 行的删除也纳入同一个事务（`removeRawDir` 是文件系统操作，可以留到最后并接受它失败）。

### P3 — `replaceChunks` 里的 O(n²)

```js
const staleIds = [...];                     // 旧分块 id（可能上千）
for (const row of rows) {
  if (!staleIds.includes(row.id)) staleIds.push(row.id);   // 数组线性查找
}
```

千块文件重处理约 10⁶ 次比较。改成 `Set` 即可。不影响正确性，属于顺手修。

### P3 — 没有重排模型、查询改写、多查询

当前"重排"仅指候选集内的 BM25。没有 cross-encoder / LLM rerank，没有 query rewriting / HyDE / multi-query / 子问题分解。Agent 侧的"自助多轮搜索"（文档里作为卖点）实际上是把改写责任推给了模型——这不算错，但意味着**检索质量的上限完全取决于 Agent 提示词**。

### P3 — `score` 在不同路径下语义不同

| 路径 | `score` 的含义 |
|---|---|
| `semanticSearch` | `1 - distance`，即余弦相似度，∈ [0, 1] |
| `keywordSearch` | `\|bm25\|`，无上界 |
| `hybridSearch` | min-max 归一化后的 RRF 分，∈ [0, 1] |

REST 响应同时给了 `similarity` / `semanticScore` / `keywordScore` / `finalScore`，其中 `similarity` 与 `finalScore` 是同一个值。名字看着像"相似度"，实际在混合路径下是归一化排名分。调用方很容易误用（比如拿它当阈值过滤）。

### P3 — 文档漂移

[knowledge-base.md](../knowledge-base.md) 的模块树写的是：

```
└── tools/
    ├── knowledge-base-tool.provider.ts
    └── document-tool.provider.ts
```

实际已在 `plugins/knowledge-base.plugin.ts` / `plugins/document.plugin.ts`，`tools/` 目录不存在。同一份文档还写着"权重可配置"，与 §3 的 P1 冲突。

---

## 4. 已经做对、不要动的部分

列出来是为了避免优化时误伤：

1. **FTS 存分词文本、不用 external-content**。这条有明确的反直觉理由（external-content 会让 FTS 回读原文，中文检索静默失效、不报错只是搜不到），`kb-schema.ts` 顶部注释写了。**任何"简化"都会踩坑。**
2. **写入与查询分词同源，BM25 另有一套刻意不同的分词**。看着冗余，实际是黄金基线锁定的行为，改动会导致分数漂移。
3. **分块 + 向量 + FTS 单事务写入**（`replaceChunks`）。这消灭了旧实现"向量写成功、正本写失败"的跨存储不一致。
4. **原件副本进库 + 用 itemId 命名目录**。改名/移动只改数据库行；库目录可整体拷走；删库真释放空间。这是"本地优先应用"的正确取舍（对比服务端产品的共享存储 + 键引用）。
5. **向量可重建**（`chunk.embedding` 是派生数据，`pnpm kb:reembed` 从正文重算，不重新解析/OCR）。
6. **库根进程内只读一次 + 换根需重启**。避免了"一部分连接在旧根、新解析指向新根"的半程状态。
7. **删库前先 `close(kbId)`**（Windows 句柄）。有注释、有测试。
8. **`vec_distance_cosine` 用的 BLOB 格式与 sqlite-vec 兼容**（Float32 小端裸 buffer），迁 `vec0` 时不需要转换数据。
9. **黄金基线**。它把"搬运时不许改算法"变成可执行约束。优化检索时它是**双刃剑**——见下节。

---

## 5. 优化时的两个约束

### 5.1 黄金基线是"复现旧行为"的约束，不是"正确行为"的约束

`kb-search-golden.json` 的 note 明确写着：基线是**迁移前旧实现**跑出来的，向量是"由 chunk id 派生的确定性合成值（dim=64）"。

这意味着：

- 改检索算法（P0 的 `vec0`、P1 的 BM25 口径）**必然**让基线失败；
- 失败不等于改错了。需要的是**有意识地重新生成基线**，并在提交信息里写清"为什么这次排序变化是可接受的"。

建议在动检索之前，先给基线加一个**分层**：把"分词/融合算法的确定性"（应该继续锁死）与"召回路径的实现"（允许演进）分开断言，否则每次优化都要跟基线打架。

### 5.2 合成向量让语义检索的回归测试是"结构性"的

`seededQuery(query)` 生成的是确定性合成向量，不是真实嵌入。所以基线能锁住"RRF 融合逻辑没变"，但**锁不住"换嵌入模型后检索质量如何"**。语义质量的评测需要另一套东西（真实查询 + 真实语料 + 人工标注的相关性）。目前没有。

> 如果优化目标是"搜得更准"而不只是"搜得更快"，这块基础设施要先补。

---

## 6. 建议的优化顺序

按依赖关系排，前一步是后一步的前提：

| 阶段 | 内容 | 理由 |
|---|---|---|
| **0. 补齐评测** | 真实语料的检索质量评测集（不只是合成向量的基线） | 没有它，后面所有"优化"都无法判断是否真的变好 |
| **1. 解阻塞** | 检索移出主线程 / 或至少把 `vec0` KNN 接上 | P0 是唯一会让**其他功能一起变慢**的问题 |
| **2. 修分块** | 按格式分流预处理 + 切分策略 | 直接影响检索质量上限；越晚改，已入库数据的迁移成本越高 |
| **3. 统一与清账** | 权重落 `kb.json`、死配置接线或删除、重复文档检测 | 都是低风险、可独立验证的改动 |
| **4. 补上下文** | `kb_search` 返回 `file_id`/`chunk_index` + 相邻块扩展 | 让"搜到"到"读懂"这条路走通 |
| **5. 提质量** | 重排模型 / 查询改写 / 多查询 | 收益最高但依赖前面的评测与召回质量 |

---

## 7. 相关文件索引

| 关注点 | 文件 |
|---|---|
| 表结构与迁移 | `kb-schema.ts`（`LATEST` + 有序 `MIGRATIONS`） |
| 连接注册表 / 根解析 / id 校验 | `kb-database.service.ts` |
| KB 配置（`kb.json`） | `kb-meta.store.ts` |
| 条目仓储（含跨库查询） | `kb-file.repository.ts` |
| 分块仓储（写入 / FTS 同步 / 向量更新） | `kb-chunk.repository.ts` |
| 摄入编排（解析→分块→嵌入→写入） | `kb-file.service.ts` |
| 分块（含预处理） | `chunking.service.ts` |
| 分词（写入/查询/BM25 三套口径） | `kb-tokenizer.ts` |
| **检索与融合（P0/P1 主战场）** | `kb-search.service.ts` |
| 向量化（批量 + 重试 + 降级） | `embedding.service.ts` |
| 格式解析（37 种 + pdf/docx/xlsx/图片 OCR） | `file-parser.service.ts`、`ocr.service.ts` |
| Agent 工具（4 个） | `plugins/knowledge-base.plugin.ts` |
| 文档解析工具（2 个，不入库） | `plugins/document.plugin.ts` |
| 会话接线（KbRefBlock） | `chat/jsonl-session-context.ts`、`common/utils/kb-ref.util.ts` |
| 检索回归基线 | `test/knowledge-base/fixtures/kb-search-golden.json` |
| 向量重建脚本 | `scripts/kb-reembed.ts`（`pnpm kb:reembed`） |
| 前端 | `frontend/src/components/knowledge-base/**`、`stores/knowledgeBase.ts` |

---

## 附录 A：vec0 可行性实测（sqlite-vec 0.1.9）

改造前用 `:memory:` 库对 `sqlite-vec@0.1.9` 做了完整实测。这些是**实测结论，不是文档推断**——npm 包里附带的 `README.md` 是空文件（0 行），没有可依赖的官方文档。

环境：Node v25.2.1 / ABI 141 / better-sqlite3 12.x / SQLite 3.53.2 / sqlite-vec v0.1.9。

### A.1 结论：迁移是**可证明行为等价**的

`distance_metric=cosine` 的 KNN 距离与标量 `vec_distance_cosine` **位级完全相同**。200 条 64 维归一化向量、3 组不同查询、top-50 对比：

```
query 999   | top-50 顺序一致: true | 最大分差: 0 | 位相等: true
query 12345 | top-50 顺序一致: true | 最大分差: 0 | 位相等: true
query 7     | top-50 顺序一致: true | 最大分差: 0 | 位相等: true
```

**这改变了黄金基线的策略**：原计划"重新生成基线"，现在可以改为**断言两条路径输出完全相同**——比重新生成强得多，因为它证明新路径没有引入行为变化。若 fixture 上排序也一致，基线甚至不需要改动就能保持绿。

### A.2 必须知道的硬约束

| 约束 | 表现 | 影响 |
|---|---|---|
| **rowid 必须绑 BigInt** | `run(101, buf)` → `Only integers are allows for primary key values on t`；`run(102n, buf)` 或 SQL 字面量 `101` 可以 | 双写时必须 `BigInt(rowid)`。**这是最容易踩的坑**，且错误信息完全不提 BigInt |
| **`LIMIT` 不能与 `k = ?` 同时用** | `Only LIMIT or 'k =?' can be provided, not both` | KNN 查询只能用 `k = ?`，不能再加 LIMIT |
| **KNN 默认按距离有序** | 不带 `ORDER BY` 也返回升序 | 不需要写 `ORDER BY distance`（写了也无害） |
| **维度在插入时严格校验** | `Dimension mismatch ... Expected 4 but received 64` | 天然护栏；但反过来意味着**建表时维度必须正确**，而维度是逐库不同的 |
| **零向量 → `distance: null`** | 余弦对零向量未定义，两条路径都返回 `null` | 见 A.3 |

### A.3 发现一个存量隐患（零向量的排序差异）

零向量（全 0 向量）上两条路径**排序相反**：

```
标量路径 ORDER BY d ASC : [zero(null), normal(0)]   ← NULL 在 ASC 下排最前
vec0 KNN                : [normal(0), zero(null)]   ← null 排最后
```

结合现有代码 `score: 1 - row.distance`，JS 里 `1 - null === 1`，于是：

> **零向量的分块会以 score = 1.0 出现在首位**——假满分。这是**现有实现的存量 bug**，不是 vec0 引入的。

零向量在正常嵌入模型下不会出现，所以一直没暴露。建议在改造中一并处理：**两条路径都丢弃 `distance === null` 的行**。黄金基线的语料是归一化的合成向量（无零向量），所以这个修正不影响基线。

### A.4 已验证可用的操作

`CREATE VIRTUAL TABLE ... USING vec0(embedding float[N] distance_metric=cosine)`、显式 rowid 插入（BigInt）、`WHERE embedding MATCH ? AND k = ?`、`SELECT rowid`（读回是 JS `number`）、`COUNT(*)`、`MAX(rowid)`、`DELETE ... WHERE rowid = ?`（BigInt）、`DELETE ... WHERE rowid IN (SELECT rowid FROM chunk WHERE item_id = ?)`（`replaceChunks` 需要的形态）、`DROP TABLE`、与普通表 `JOIN ... ON c.rowid = v.rowid`、`k` 大于总行数（返回全部）、空表 KNN（返回 `[]`）。

### A.5 由此确定的实现决策

1. **不依赖 vec0 的元数据列过滤**——「按文件过滤」走 legacy 受限扫描（`WHERE item_id = ?`，已被单个文件界定，本来就快且精确）。避免赌一个未实测的能力。
2. **rowid 映射用 `chunk.rowid` 镜像**，不引入额外的映射列：写入时照现有 FTS 的写法回读 rowid，`BigInt` 转换后插 vec0。
3. **等价性断言用严格相等**（顺序 + 分数），不需要容差。
4. **丢弃 `distance IS NULL` 的行**，顺带修掉存量假满分。
5. **维度探测必须先做**：vec0 的维度在 `CREATE` 时固定，而 `chunk.embedding_dimensions` 是逐行的。单库混合维度 → 拒绝建索引 + 告警，继续走 legacy 路径。

### A.6 环境提示

本机 `better-sqlite3` 当前是 **node-ABI（141）**，与系统 Node v25.2.1 匹配，KB 测试可正常跑。注意历史坑：`pnpm rebuild:backend-native:electron` 会把它编成 Electron ABI，届时系统 Node 下 5 个 KB spec 会整体失败。跑 KB 测试前先确认绑定。

---

## 附录 B：vec0 改造后的实测性能（**纠正了一个预期错误**）

复现：`pnpm --dir backend-ts exec node scripts/kb-vec-bench.js <分块数> <维度>`（脚本已入库）。
环境：Node v25.2.1 / SQLite 3.53.2 / sqlite-vec 0.1.9 / `:memory:` 库 / 每条 20 次查询取均值。

### B.1 关键纠正：`vec0` 不是 ANN 索引

改造前我预期"O(n) → O(log n)、十万块亚毫秒"。**实测证明这是错的。**

| 规模（1024 维） | 全表扫描 | vec0 KNN | 加速比 |
|---|---|---|---|
| 5,000 块（20 MB） | 18.0 ms | 8.2 ms | 2.2x |
| 20,000 块（78 MB） | 70.1 ms | 31.1 ms | 2.3x |
| 80,000 块（313 MB） | 299.0 ms | 149.5 ms | **2.0x** |

**耗时随数据量线性增长**（数据量 ×4 → 耗时约 ×4.8），加速比是**常数 ~2 倍**而非复杂度改善。

原因：sqlite-vec 0.1.x 的 `vec0` 是 **SIMD 加速的穷举搜索**，不是 HNSW/IVF 那类近似最近邻索引。
那 2 倍来自：C 层 SIMD 计算、向量不进 JS 堆、省掉标量函数逐行调用与 BLOB 物化。

> **结论**：本次改造把 P0 **缓解**了约一半，**没有解决**。10 万块量级仍有 150 ms 级的主线程阻塞。

### B.2 但改造仍然值得做（三条独立收益）

1. **常数级提速 ~2x**，且零行为变化（位级等价，见 A.1）。
2. **修掉一个会抛错的存量缺陷**：标量 `vec_distance_cosine` 遇到与查询维度不同的行会直接抛
   `Vector dimension mistmatch`，于是"单库混了两种维度"会让**整个库的语义检索完全不可用**。
   改造后在扫描路径加了 `LENGTH(embedding) = ?` 过滤，混合维度的库仍可正常搜索（只在与查询
   同维度的向量上召回）。
3. **修掉零向量的"假满分"**（见 A.3）：`1 - null === 1` 会让零向量分块以 score=1.0 出现在首位。

### B.3 下一步真正解决 P0 的两个方向

| 方向 | 做法 | 预期 | 代价 |
|---|---|---|---|
| **量化** | sqlite-vec 0.1.9 已支持 `vec_quantize_int8()` / `vec_quantize_binary()`、`int8` 列类型、二值向量的 Hamming 距离。改 `chunk_vec(embedding int8[N])` 或加一个二值列 | 二值量化可把向量内存降 32 倍、扫描走位运算，量级上比现在的 float32 穷举快一个数量级；配合"量化粗筛 + float32 精排"可保住召回 | 需要重建索引；量化有召回损失，必须靠评测集验证（见 B.4） |
| **移出主线程** | 检索走 `worker_threads`（项目内已有 workflow 模块的 Worker 模板可参考，但没有可复用的池） | 不减少计算量，但**不再阻塞事件循环**——这才是 P0 描述里更严重的那个后果 | 需跨线程句柄协调（主线程删库前 worker 必须放开句柄）、worker 内只读连接、崩溃恢复 |

**建议顺序**：先量化（收益大、改动局部），量化后若单次检索降到 10 ms 级，worker 的必要性大幅下降。

### B.4 但前提是先有评测集

上面两个方向都会**改变召回结果**（量化有损；worker 不改变结果但会让你更愿意调参）。
没有质量评测集，就无法判断"快了但搜得还准不准"。这正是阶段 0（补齐评测）必须先做的原因。

### B.5 改造期间发现并修掉的其他问题

| 问题 | 表现 | 根因 |
|---|---|---|
| 迁移时 `no such module: vec0` | 迁移后知识库**整个是空的**，只在日志里留一行 `知识库迁移失败（下次启动重试）` | 迁移器的 staging 连接（`kb-migration-bootstrap.service.ts`）没有 `sqliteVec.load(db)`。**而 `run()` 用 try/catch 把异常吞成一行日志**，所以表现为静默丢数据。已修（补 load + 对齐 pragma） |
| 混合维度检索抛错 | `Vector dimension mistmatch` | 见 B.2 第 2 条。已在扫描路径加维度过滤 |
| 零向量假满分 | score=1.0 排首位 | 见 B.2 第 3 条。两条路径都已过滤 `distance IS NULL` |

> **附带发现（未修，属另一个议题）**：`KbMigrationBootstrapService.run()` 的
> `catch { logger.error(...) }` 会把**任何**导入异常降级成一行日志然后放行门控，
> 调用方无法感知失败。上面那个 `no such module: vec0` 就是被它掩盖的。
> 建议后续把导入失败暴露成启动诊断（或在 marker 里记录失败状态），否则下次再出这类问题
> 依然只能靠翻日志发现。

---

## 附录 C：本轮改造清单与新增缺陷（2026-09-24）

### C.1 已落地

| 项 | 内容 | 主要文件 |
|---|---|---|
| **vec0 向量索引** | `chunk_vec`（vec0，`distance_metric=cosine`）+ 幂等建表 + 分批可续跑回填 + 计数自愈的就绪判定 | `kb-vector-index.ts`、`kb-vector-index.service.ts` |
| **写入双写** | `replaceChunks` / `updateEmbeddings` / 三条删除路径同步维护索引；vec0 的 rowid 是主键且不支持 `INSERT OR REPLACE`，故先删后插 | `kb-chunk.repository.ts` |
| **检索分流** | `index`（vec0 KNN）/ `scan`（索引未就绪时降级）/ `scan-scoped`（按文件过滤，候选集已被单文件界定）；带路径与耗时埋点，超 200ms 打 warn | `kb-search.service.ts` |
| **分块按类型分流** | `markdown` 保标题层级并给每块加标题路径前缀；`code` 按空行块聚合；`table` 分组重复表头；`prose` 沿用旧行为（刻意） | `chunking.service.ts`、`chunking-kind.util.ts` |
| **`chunkMinSize` 接线** | 原为死配置，现用于合并尾部碎片块 | 同上 |
| **策略版本标记** | `sentence-v2` / `md-heading-v2` / `code-block-v2` / `table-rows-v2`；老数据为 `token`，前端据此提示重新处理 | 同上 |
| **融合权重落 `kb.json`** | `semanticWeight` / `keywordWeight`（默认 0.3/0.7），REST 与 Agent 工具都读配置，请求体可覆盖；两者同为 0 时回退默认 | `kb-meta.store.ts`、`kb-search.controller.ts`、`plugins/knowledge-base.plugin.ts` |
| **重复内容检测** | `content_hash` 首次被真正使用；`onDuplicate` 三档（默认 `keep-both` 保持原行为） | `kb-file.service.ts` |
| **删除事务化** | 条目行与分块并入同一事务（原为两个事务，崩中间留下"行在、分块没了"） | `kb-file.service.ts`、两个仓储的 `deleteManyWithin` |
| **死配置清理** | 删除 `metadataConfig` / `isPublic` / `isActive`（无任何消费者） | 后端 + 前端 + i18n |
| **评测骨架** | `metrics.ts`（recall@k / MRR / NDCG@k，29 个手算校验用例）+ `scripts/kb-eval.ts` + 查询集模板 | `eval/metrics.ts`、`scripts/kb-eval.ts` |
| **性能基准** | `scripts/kb-vec-bench.js`（见附录 B） | `scripts/kb-vec-bench.js` |

### C.2 本轮**新发现**的缺陷

评审初稿漏掉、在实施过程中才暴露出来的：

| # | 问题 | 表现 | 状态 |
|---|---|---|---|
| **B1** | 按文件过滤端到端失效 | 前端发 `filterFileId`，后端读 `filter_file_id`——静默不生效、不报错 | 已修（后端以 camelCase 为准，兼容旧名） |
| **B2** | 分块号从未显示过 | `metadata` 里根本没有 `chunkIndex`（写入侧不写、读取侧不带），所以 Agent 工具与前端**都**读不到 | 已修（`mergeMetadata` 从 `chunk_index` 列补出） |
| **B3** | 点击搜索结果无反应 | `KBSearchPanel` 的 `result-click` 事件没有任何监听者 | 已修（绑定并实现跳转到分块查看器） |
| **B4** | `kb_search` 不输出 `file_id` | Agent 拿到命中后无法走到 `kb_get_chunks`，只能先按文件名猜 id | 已修 |
| **B5** | 工具与 REST 的融合权重分叉 | 工具硬编码 0.6/0.4、REST 硬编码 0.3/0.7，同一次检索排序不同 | 已修（统一读 kb 配置） |
| **B6** | 迁移时 `no such module: vec0` | 迁移后知识库**整个是空的**，只在日志留一行 | 已修（staging 连接补 `sqliteVec.load`） |
| **B7** | 混合维度会让整个库检索抛错 | 标量 `vec_distance_cosine` 遇到维度不同的行直接抛 `Vector dimension mistmatch` | 已修（扫描路径加 `LENGTH(embedding) = ?` 过滤） |
| **B8** | 零向量"假满分" | `1 - null === 1`，零向量分块以 score=1.0 排首位 | 已修（两条路径都丢弃 `distance IS NULL`） |
| **B9** | 上传扩展名白名单有两份 | `KBFileUploader` 里 `handleFolderSelect` 那份漏了 `.dts/.dtsi`，文件夹上传静默跳过设备树源文件 | 已修（合并为一份） |

> B1~B5 的共同特征：**都是"看起来能用、实际静默失效"**。它们没有任何报错，
> 只能靠读代码或对比两条调用路径发现。这也是为什么本轮的 characterization test
> 先"把现状钉住"再改——否则改完也不知道自己改掉的是 bug 还是 feature。

### C.3 本轮**未做**（明确的后续项）

| 项 | 为什么留到后面 |
|---|---|
| 检索移出主线程（worker_threads） | 你选择了先只上 vec0。vec0 只带来 ~2x 常数收益（附录 B），10 万块仍有 150ms 级阻塞，**这一项仍然需要**，但应基于实测决定 |
| 向量量化（int8 / 二值 + Hamming） | 见 B.3：这是比 worker 更划算的下一步（收益大、改动局部），但会改变召回，需先有评测集 |
| 重排模型 / 查询改写 / 多查询 | 属质量增强，不在本轮范围 |
| 真实评测集的规模化标注 | 骨架已就位（C.1），标注是人力活 |
| 启动期跨库对账 O(库数) 优化 | 性能项非缺陷 |
| `KbMigrationBootstrapService.run()` 吞异常 | 见附录 B 末尾的附带发现 |
| 黄金基线重生脚本 | **不需要了**：vec0 与标量路径位级等价（A.1），基线继续锁扫描路径即可，等价性由 `kb-vector-index.spec.ts` 独立断言 |


