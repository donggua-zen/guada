# 知识库 (RAG)

GuaDa 的知识库模块实现了完整的 **检索增强生成 (RAG)** 流程，支持混合检索、Agent 自助管理和多格式文档处理。

## 架构

```
知识库模块
├── knowledge-base.service.ts     → 知识库 CRUD
├── kb-file.service.ts            → 文件管理（上传、删除、移动、重命名、重复检测）
├── kb-meta.store.ts              → KB 配置（kb.json）
├── kb-database.service.ts        → 每库一个 kb.db 的连接注册表（懒开 + LRU + schema 迁移）
├── kb-file.repository.ts         → 条目仓储（item 表）
├── kb-chunk.repository.ts        → 分块仓储（chunk / chunk_fts / chunk_vec 的写入与删除）
├── kb-vector-index.ts            → 向量索引的纯 SQL 层（vec0 建表 / KNN / 回填扫描）
├── kb-vector-index.service.ts    → 向量索引生命周期（维度探测、回填、就绪判定）
├── kb-search.service.ts          → 语义 / FTS / BM25 / RRF 融合检索
├── kb-tokenizer.ts               → 分词（写入与查询同口径）
├── chunking.service.ts           → 文档分块（按文件类型分流）
├── chunking-kind.util.ts         → 扩展名 → 分块类型；策略版本标记
├── kb-schema.ts                  → kb.db 表结构与版本迁移
├── kb-files.controller.ts        → 文件 REST API
├── kb-search.controller.ts       → 搜索 REST API
├── knowledge-bases.controller.ts → 知识库 REST API
├── embedding.service.ts          → 向量嵌入
├── file-parser.service.ts        → 文件解析
├── ocr.service.ts                → OCR 图片文字识别
├── eval/metrics.ts               → 检索质量指标（recall@k / MRR / NDCG@k，纯函数）
└── plugins/
    ├── knowledge-base.plugin.ts  → Agent 搜索工具（kb_search 等 4 个）
    └── document.plugin.ts        → Agent 文档解析工具（doc_parse 等，不入库）

配套脚本：
  scripts/kb-reembed.ts   从正文重建向量（不重新解析）
  scripts/kb-eval.ts      检索质量评测（pnpm kb:eval）
  scripts/kb-vec-bench.js 向量检索性能基准
```

## 存储分层

一个知识库 = **一个自包含目录**（原件 + 元信息 + 分块 + 向量都在里面）：

```
<知识库根>/<kbId>/
  kb.json                   KB 配置
  kb.db                     条目 + 分块正文 + 向量 + FTS
  raw/<itemId>/<文件名>      原件副本（上传时写入）
```

处理链：`raw/` 原件 → 解析 → 分块 → 写入 `kb.db`（正文与向量**同一个事务**）→ FTS 由正文派生。

- **知识库根**：`kbStorageRoot` 设置 → `KB_DATA_DIR` → `USERDATA_DIR/data/kb`（Electron）→ `./data/kb`。启动日志会打印实际生效的根。
- **原件复制进库**：上传即写入 `raw/<itemId>/`（`<itemId>` 是条目 id，所以改名只改数据库行、不搬字节）。库目录可整体拷走，删库即删目录、真正释放空间。
- **向量可重建**：`chunk.embedding` 是派生数据，正文正本在 `chunk.content` 与 `raw/` 原件。缺向量或向量损坏时用 `pnpm kb:reembed` 从正文重算，**不必**重新解析/OCR。
- **删条目/删库**：分块与向量在同一个事务里删除，再删 `raw/<itemId>/`；删库是 `关闭连接 → rm -rf <kbId>/`（Windows 上不先关句柄会删不掉）。
- **孤儿处理**：`raw/` 下无人认领的目录、以及共享上传目录里没有元信息引用的历史文件，启动时**只报告不自动删**（那是用户的数据）。

完整设计（不变式、连接管理、迁移与回滚、备份注意）见 [design/kb-storage.md](design/kb-storage.md)。

## 核心能力

### 混合检索

| 检索方式 | 技术 | 说明 |
|----------|------|------|
| **语义搜索** | sqlite-vec `vec0` KNN | 基于向量相似度的语义匹配，走 `chunk_vec` 索引 |
| **关键词搜索** | FTS5 + jieba + BM25 | 中文分词 + 全文检索 + BM25 排序 |
| **融合策略** | RRF（Reciprocal Rank Fusion）| 两路各召回 `topK × 4`，动态权重 + RRF 融合后归一化 |

**融合权重**：`semanticWeight` / `keywordWeight` 存在每个知识库的 `kb.json` 里
（默认 0.3 / 0.7），设置页可调；请求体可临时覆盖。REST 接口与 Agent 工具读的是**同一份配置**。

**按文件过滤**：`filterFileId` 走「受限扫描」而非向量索引——候选集已被单个文件界定
（通常几十到几百行），全表扫描的开销与文件大小同阶、本来就快，且语义精确。

> **语义召回的两条路径**：索引就绪走 `vec0` KNN；未就绪（升级后尚未回填、维度不一致、
> 索引损坏）**自动降级为全表扫描**——慢但结果正确，并在日志里标明走了哪条路径与耗时。
> 两条路径的 id 序列与分数已实测**位级相同**（`kb-vector-index.spec.ts` 有等价性断言）。

支持分区存储（按知识库 ID）。

### Agent 自助管理（区别于常规 RAG）

| 能力 | 说明 |
|------|------|
| **自助多轮搜索** | Agent 自主决定搜索策略、轮次和文件组合，而非系统预先排序 |
| **自助写入** | Agent 读取本地文件后自动解析、分块、向量化并存入知识库 |
| **文档管理** | Agent 可调用工具创建文件夹、上传文件、移动、重命名 |

### 文档处理流程

```
PDF/DOCX/TXT/MD/Excel/PPT/图片 → file-parser.service 解析
    ↓
按文件类型分块 → chunking.service
    ├─ markdown：按 ATX 标题切分，每块带标题路径前缀
    ├─ code    ：按空行分隔的代码块聚合，不切在块内部
    ├─ table   ：按行分组，每组重复表头
    ├─ prose   ：按句子边界切分（txt 等）
    ├─ Token 上限（chunkMaxSize，可配置）
    ├─ 重叠窗口（chunkOverlapSize）保留上下文连贯性
    └─ 尾部碎片块合并（chunkMinSize）
    ↓
向量嵌入 → embedding.service（生成向量）
    ↓
写入 kb.db → KBChunkRepository.replaceChunks（正文 + 向量 + FTS + 向量索引 单事务）
```

支持 40+ 文件格式，异步处理自动恢复中断。

> **分块策略带版本标记**（`md-heading-v2` 等），存在分块的 metadata 里。改造前入库的
> 文件标记为 `token`（旧方案），前端会提示"建议重新处理"——**不会自动重处理**，
> 因为重新分块必须重新调用嵌入模型，是有成本的，由用户决定。

### 文件管理

- **层级目录结构**：支持文件夹嵌套，类似文件系统
- **批量上传**：一次上传多个文件，自动解析入库
- **移动/重命名**：文件可在目录间移动，标题可修改
- **OCR 支持**：图片格式文档自动 OCR 识别

## 工具接口

### 搜索工具 (`knowledge-base`)

Agent 调用时传递搜索关键词和知识库 ID，返回匹配的文档片段。

### 文档管理工具 (`document`)

| 操作 | 说明 |
|------|------|
| `add` | 添加文档到知识库 |
| `list` | 列出知识库文件 |
| `read` | 读取文件内容 |
| `delete` | 删除文件 |
| `rename` | 重命名文件 |
| `move` | 移动文件到其他目录 |
| `create_folder` | 创建文件夹 |
