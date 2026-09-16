# 知识库 (RAG)

GuaDa 的知识库模块实现了完整的 **检索增强生成 (RAG)** 流程，支持混合检索、Agent 自助管理和多格式文档处理。

## 架构

```
知识库模块
├── knowledge-base.service.ts     → 知识库 CRUD
├── kb-file.service.ts            → 文件管理（上传、删除、移动、重命名）
├── kb-meta.store.ts              → KB 配置（kb.json）
├── kb-database.service.ts        → 每库一个 kb.db 的连接注册表（懒开 + LRU + schema 迁移）
├── kb-search.service.ts          → 语义 / FTS / BM25 / RRF 融合检索
├── kb-tokenizer.ts               → 分词（写入与查询同口径）
├── kb-schema.ts                  → kb.db 表结构与版本迁移
├── kb-files.controller.ts        → 文件 REST API
├── kb-search.controller.ts       → 搜索 REST API
├── knowledge-bases.controller.ts → 知识库 REST API
├── embedding.service.ts          → 向量嵌入
├── chunking.service.ts           → 文档分块
├── file-parser.service.ts        → 文件解析
├── ocr.service.ts                → OCR 图片文字识别
└── tools/
    ├── knowledge-base-tool.provider.ts  → Agent 搜索工具
    └── document-tool.provider.ts         → Agent 文档管理工具
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
| **语义搜索** | sqlite-vec | 基于向量相似度的语义匹配 |
| **关键词搜索** | FTS5 + jieba + BM25 | 中文分词 + 全文检索 + BM25 排序 |
| **融合策略** | 加权融合 | 语义和关键词得分按权重混合，权重可配置 |

支持文件过滤（按文件 ID）、分区存储（按知识库 ID）。

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
Token 智能分块 → chunking.service
    ├─ 按 Token 数切割（可配置）
    └─ 重叠窗口保留上下文连贯性
    ↓
向量嵌入 → embedding.service（生成向量）
    ↓
写入 kb.db → KBChunkRepository.replaceChunks（正文 + 向量 + FTS 单事务）
```

支持 40+ 文件格式，异步处理自动恢复中断。

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
