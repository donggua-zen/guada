# 知识库框架（RAG）详细文档

知识库模块是本系统的核心 RAG 引擎，提供从文件上传、智能分块、向量化到混合检索的完整管线，并深度集成到 Agent 多轮对话循环中。

---

## 架构全景

```
┌─────────────────────────────────────────────────────────────┐
│                     前端 (Vue 3)                             │
│   KnowledgeBasePage.vue  +  knowledgeBase.ts (Pinia Store)  │
└──────────────────────────┬──────────────────────────────────┘
                           │ REST API
┌──────────────────────────▼──────────────────────────────────┐
│                   控制器层 (Controllers)                     │
│  KnowledgeBasesController │ KbFilesController │ KbSearch     │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                   Agent 工具层 (Tool Provider)               │
│   KnowledgeBaseToolProvider ── 注册到 ToolOrchestrator       │
│   ┌──────────────────────────────────────────────────────┐  │
│   │  knowledge_base__search       语义混合搜索            │  │
│   │  knowledge_base__list_files   获取文件列表            │  │
│   │  knowledge_base__get_chunks   查看分块内容            │  │
│   │  knowledge_base__add_document 写入文档到知识库 ★      │  │
│   └──────────────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                    服务层 (Services)                         │
│  KnowledgeBaseService │ KbFileService │ EmbeddingService     │
│  FileParserService    │ ChunkingService                     │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                   基础设施层                                 │
│  SQLite + sqlite-vec (向量) + FTS5 (全文) + Jieba (中文分词)│
│  Prisma ORM (元数据: KnowledgeBase / KBFile / KBChunk)       │
└─────────────────────────────────────────────────────────────┘
```

---

## 数据模型

### KnowledgeBase — 知识库

每个知识库独立配置分块策略和 Embedding 模型。

| 字段 | 说明 |
|------|------|
| `embeddingModelId` | 关联的向量模型，支持兼容 OpenAI Embeddings API 的任意模型 |
| `chunkMaxSize` | 分块上限（Token 数），默认 1000 |
| `chunkOverlapSize` | 相邻分块重叠大小（Token 数），默认 100 |
| `chunkMinSize` | 分块最小阈值（Token 数），默认 50 |
| `metadataConfig` | JSON 扩展字段 |

### KBFile — 文件与文件夹统一节点

用 `isDirectory` 统一管理文件和文件夹，`parentFolderId` 自引用实现树形结构。

| 字段 | 说明 |
|------|------|
| `relativePath` | 知识库内相对路径，如 `docs/api/readme.md` |
| `parentFolderId` | 父文件夹 ID，`null` 表示根目录 |
| `processingStatus` | `pending` → `processing` → `completed` / `failed` |
| `totalChunks` / `totalTokens` | 处理完成后统计 |

### KBChunk — 分块记录

| 字段 | 说明 |
|------|------|
| `vectorId` | 对应向量库中的向量记录 ID |
| `chunkIndex` | 分块序号 |
| `tokenCount` | 该分块的 Token 数 |
| `metadata` | 含重叠长度、分块策略等结构化信息 |

---

## 文件处理管线

### 入口

系统提供两条写入路径：

| 路径 | 来源 | 实现 |
|------|------|------|
| **前端上传** | 用户通过 UI 选择文件 | `KbFileService.uploadFile()` |
| **Agent 写入** | Agent 调用工具写入已有文件 | `KbFileService.addTextDocument()` |

Agent 写入是核心亮点：LLM 自主判断用户意图后，调用 `knowledge_base__add_document` 指定源文件路径和目标路径，系统自动完成整个管线。

### 处理流程

```
┌─────────────────┐
│ 1. 文件解析      │  40+ 格式支持: txt/md/code → 多编码检测; PDF → pdf-parse; Word → mammoth
├─────────────────┤
│ 2. 智能分块      │  tiktoken + cl100k_base; 按句子边界分割 (。！？.!?); 分块间可配置重叠
├─────────────────┤
│ 3. 清理旧数据    │  先删向量库 → 再删 chunk 记录（支持重新处理）
├─────────────────┤
│ 4. 批量向量化    │  调用 Embedding API → 逐条请求带进度日志
├─────────────────┤
│ 5. 双写存储      │  向量库(sqlite-vec) + 全文索引(FTS5) + 元数据库(KBChunk)
├─────────────────┤
│ 6. 标记完成      │  progress=100%, 写入 totalChunks / totalTokens
└─────────────────┘
```

### 可靠性设计

- **串行处理信号量**：`processingSemaphore` 确保同一时刻只处理一个文件，避免向量库写冲突
- **启动自动恢复**：`onModuleInit` 扫描 `pending/processing` 状态文件并重新调度
- **孤儿文件清理**：启动时清除知识库已删除但记录残留的数据
- **进度追踪**：前端以 3 秒轮询刷新 `progressPercentage` 和 `currentStep`

---

## 搜索引擎

### 混合检索

检索融合语义搜索和关键词搜索：

```
最终得分 = semanticWeight × 语义分数 + keywordWeight × 关键词分数
```

| 维度 | 技术 | 说明 |
|------|------|------|
| 语义搜索 | sqlite-vec 余弦相似度 | 基于向量嵌入的语义匹配 |
| 关键词搜索 | FTS5 全文检索 + Jieba 中文分词 | 精确关键词匹配 |
| BM25 重排序 | FTS5 BM25 算法 | 对关键词搜索结果重排，默认开启 |

### 搜索入口

| 入口 | 语义权重 | 关键词权重 | 用途 |
|------|-----------|-----------|------|
| REST API (`KbSearchController`) | 0.3 | 0.7 | 前端/用户直接使用 |
| Agent 工具 (`knowledge_base__search`) | 0.6 | 0.4 | Agent 多轮对话调用 |

两种入口均支持按文件 ID 过滤、调整 topK。

### 存储架构

每个知识库对应一个独立向量表 `kb_{kbId}`，附带同名的 `_fts` 全文虚拟表。删除知识库时级联清理所有关联数据。

---

## Agent 集成

### 工具注册

`KnowledgeBaseToolProvider` 以 `knowledge_base` 命名空间注册到 `ToolOrchestrator`，对外暴露 4 个工具。

所有工具名称自动加前缀：`knowledge_base__search`、`knowledge_base__add_document` 等。

### Prompt 注入

每轮对话构建上下文时，`KnowledgeBaseToolProvider.getPrompt()` 动态生成使用说明注入 System Prompt，内容包括：

- 4 个工具的功能和参数说明
- 何时使用哪个工具的判断指引
- 最佳实践（如先 search 后 get_chunks）

### 多轮搜索循环

Agent 在 ReAct 循环中可多次调用知识库工具：

```
用户: "查找关于 OAuth2 的文档并告诉我详细内容"
  ↓
LLM → 调用 knowledge_base__search(query="OAuth2", top_k=5)
  ↓
LLM → 分析搜索结果，找到了 3 个相关文件
  ↓
LLM → 调用 knowledge_base__get_chunks(file_id="xxx") 获取具体分块
  ↓
LLM → 综合所有检索结果生成回答
```

### Agent 写入知识库

```
用户: "把 /docs/api.md 加入我的知识库"
  ↓
LLM → 调用 knowledge_base__add_document({
    knowledge_base_id: "xxx",
    source_file_path: "/docs/api.md",
    target_path: "docs/api.md"
})
  ↓
系统 → addTextDocument() → 后台处理管线 → 返回 { success: true, file_id: "xxx" }
```

写入完成后，该文档即刻对后续搜索生效。

---

## 文件结构

```
backend-ts/src/modules/knowledge-base/
├── chunking.service.ts          # Token 智能分块服务
├── embedding.service.ts         # 向量嵌入服务（OpenAI 兼容 API）
├── file-parser.service.ts       # 多格式文件解析器
├── kb-file.service.ts           # 文件管理核心服务（上传/写入/处理/恢复）
├── kb-files.controller.ts       # 文件 REST API
├── kb-search.controller.ts      # 搜索 REST API
├── knowledge-base.module.ts     # 模块定义
├── knowledge-base.service.ts    # 知识库 CRUD 服务
└── knowledge-bases.controller.ts # 知识库 REST API

backend-ts/src/common/vector-db/
├── interfaces/vector-database.interface.ts  # 向量库抽象接口
├── implementations/sqlite-vector-db.ts      # sqlite-vec 实现
└── vector-db.service.ts                     # 向量库门面服务

backend-ts/src/modules/tools/providers/
└── knowledge-base-tool.provider.ts  # Agent 工具注册与处理

frontend/src/
├── components/knowledge-base/
│   └── KnowledgeBasePage.vue        # 知识库管理界面
└── stores/knowledgeBase.ts          # 前端状态管理 + 轮询
```
