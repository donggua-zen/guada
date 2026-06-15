# 知识库 (RAG)

GuaDa 的知识库模块实现了完整的 **检索增强生成 (RAG)** 流程，支持混合检索、Agent 自助管理和多格式文档处理。

## 架构

```
知识库模块
├── knowledge-base.service.ts     → 知识库 CRUD
├── kb-file.service.ts            → 文件管理（上传、删除、移动、重命名）
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
向量嵌入 → embedding.service
    ├─ 生成向量
    └─ 存入 sqlite-vec 索引
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
