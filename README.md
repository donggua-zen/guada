# GuaDa - 智能AI对话系统

> 一个功能强大的企业级AI对话平台，支持多模型接入、知识库检索增强(RAG)、MCP工具调用、长上下文管理等高级功能。

![NestJS](https://img.shields.io/badge/NestJS-11.x-red.svg)
![Vue.js](https://img.shields.io/badge/Vue.js-3.x-4FC08D?style=flat&logo=vue.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-6.x-blue.svg)
![Prisma](https://img.shields.io/badge/Prisma-7.x-2D3748?style=flat&logo=prisma&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-blue.svg)

## 📋 目录

- [项目简介](#项目简介)
- [核心功能](#核心功能)
- [技术架构](#技术架构)
- [快速开始](#快速开始)
- [项目结构](#项目结构)
- [API文档](#api文档)
- [开发指南](#开发指南)
- [部署说明](#部署说明)
- [贡献指南](#贡献指南)

## 🎯 项目简介

GuaDa 是一个现代化的全栈AI对话应用，采用前后端分离架构。后端基于 NestJS + TypeScript 构建，前端使用 Vue 3 + Vite。系统支持多种LLM提供商（OpenAI、阿里云、智谱等），集成了RAG知识库、MCP协议工具调用、会话上下文压缩、多轮工具调用等高级特性。

### 主要特点

- **多模型支持**: 兼容 OpenAI、阿里云、智谱GLM、Google Gemini 等多种LLM提供商
- **RAG知识库**: 支持PDF、Word、TXT等文档上传，自动分块向量化，实现精准检索增强生成
- **MCP工具集成**: 支持 Model Context Protocol，可连接外部MCP服务器扩展AI能力
- **智能上下文管理**: 自动摘要压缩、滑动窗口策略、Token统计与优化
- **多角色系统**: 支持创建个性化AI角色，分组管理，灵活切换
- **实时流式响应**: SSE流式输出，支持思考过程展示、工具调用可视化
- **用户权限管理**: JWT认证，主账户/子账户体系，细粒度权限控制
- **文件夹层级上传**: 知识库支持完整的文件夹层级结构管理

## ✨ 核心功能

### 💬 智能对话系统

- **流式对话**: 基于SSE的实时流式响应，支持文本、推理内容、工具调用的增量展示
- **消息再生**: 支持三种再生模式（覆盖、多版本、追加），灵活管理对话历史
- **会话锁定**: 防止并发请求冲突，确保会话一致性
- **中断处理**: 客户端断开时自动中止LLM请求，节省资源

### 🧠 上下文管理

- **智能摘要压缩**: 当对话超出上下文窗口时，自动生成历史摘要并压缩旧消息
- **滑动窗口策略**: 可配置的记忆长度，平衡上下文质量与Token消耗
- **语义轮次分组**: 按对话轮次组织消息，保持逻辑完整性
- **Token统计**: 实时监控Token使用情况，显示使用率和剩余容量

### 📚 RAG知识库

- **多格式支持**: PDF、DOCX、TXT等常见文档格式
- **智能分块**: 可配置的chunk大小、重叠率，支持最小分块过滤
- **混合检索**: 集成 sqlite-vec 向量搜索 + FTS5全文检索，支持语义+关键词加权融合
- **中文优化**: 内置 jieba 分词器，精准支持中文关键词搜索
- **文件夹层级**: 完整的目录树结构，支持批量上传和管理
- **处理进度追踪**: 实时显示文档处理状态和进度百分比

### 🔧 MCP工具调用

- **MCP协议支持**: 兼容 Model Context Protocol 标准
- **动态工具发现**: 自动从MCP服务器获取可用工具列表
- **多轮工具执行**: 支持Agent循环，连续调用多个工具完成任务
- **工具命名空间**: 清晰的工具分类和组织（mcp、time、memory、knowledge_base）

### 👤 用户与角色系统

- **JWT认证**: 安全的用户认证机制
- **角色分组**: 将AI角色按用途分组，便于管理
- **个性化配置**: 每个角色可独立设置系统提示词、温度参数等

### 📊 监控与优化

- **思考时长统计**: 记录模型的推理时间
- **Token使用分析**: 详细的Token消耗统计
- **错误处理**: 完善的异常捕获和错误信息返回
- **性能优化**: 批量SQL操作、索引优化、缓存策略

## 🏗️ 技术架构

### 后端技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| **NestJS** | ^11.1.18 | Node.js Web框架 |
| **TypeScript** | ^6.0.2 | 类型安全的JavaScript超集 |
| **Prisma ORM** | ^7.6.0 | 数据库ORM和迁移工具 |
| **SQLite** | - | 主业务数据库（通过Better-SQLite3） |
| **sqlite-vec** | ^0.1.9 | SQLite向量搜索扩展 |
| **@node-rs/jieba** | ^2.0.1 | 中文分词器（用于关键词搜索） |
| **@modelcontextprotocol/sdk** | ^1.29.0 | MCP协议SDK |
| **tiktoken** | ^1.0.22 | OpenAI Tokenizer |
| **@huggingface/tokenizers** | ^0.1.3 | HuggingFace Tokenizer |
| **pdf-parse** | ^2.4.5 | PDF内容提取 |
| **mammoth** | ^1.12.0 | Word文档解析 |
| **sharp** | ^0.34.5 | 图片处理 |
| **openai** | ^4.28.0 | OpenAI SDK |
| **@google/generative-ai** | ^0.24.1 | Google Gemini SDK |
| **bcrypt** | ^6.0.0 | 密码加密 |
| **passport-jwt** | ^4.0.1 | JWT认证中间件 |

### 前端技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| **Vue 3** | ^3.5.21 | 渐进式JavaScript框架 |
| **Vite** | ^7.3.0 | 下一代前端构建工具 |
| **Pinia** | ^3.0.4 | Vue状态管理 |
| **Vue Router** | ^4.6.4 | 官方路由管理器 |
| **Element Plus** | ^2.13.0 | Vue 3 UI组件库 |
| **Tailwind CSS** | ^4.1.18 | 实用优先的CSS框架 |
| **Axios** | ^1.13.2 | HTTP客户端 |
| **Marked** | ^16.4.2 | Markdown解析器 |
| **Highlight.js** | ^11.11.1 | 代码语法高亮 |
| **SimpleBar** | ^2.4.2 | 自定义滚动条 |
| **VueUse** | ^14.1.0 | Vue组合式工具集 |
| **Vuelidate** | ^2.0.3 | 表单验证 |

### 数据库设计

系统使用关系型数据库存储核心数据，主要表包括：

- **Session**: 会话管理，关联用户、角色、模型
- **Message**: 消息记录，支持树形结构（父子关系）
- **MessageContent**: 消息内容，支持多轮次（turns）
- **Model & ModelProvider**: 模型和提供商配置
- **Character & CharacterGroup**: AI角色及分组
- **KnowledgeBase & KBFile & KBChunk**: 知识库三层结构（知识库-文件-分块）
- **Memory**: 长期记忆存储
- **McpServer**: MCP服务器配置
- **User & UserSetting**: 用户信息及设置
- **SessionContextState**: 会话上下文状态（摘要压缩、清理策略）
- **File**: 通用文件管理

**向量数据存储**：
- 使用 **SQLite + sqlite-vec** 扩展实现向量相似度搜索
- 独立存储文件：`data/vector_db.sqlite`，避免与主业务库锁竞争
- 集成 **FTS5** 虚拟表实现全文关键词搜索
- 支持语义搜索、关键词搜索和混合搜索（加权融合）

详细Schema请参考 [prisma/schema.prisma](backend-ts/prisma/schema.prisma)

## 🚀 快速开始

### 环境要求

- **Node.js**: >= 18.x (推荐 20.x LTS)
- **npm**: >= 9.x (或使用 pnpm/yarn)
- **Docker**: (可选，用于运行Qdrant向量数据库)

### 安装步骤

#### 1. 克隆项目

```bash
git clone <repository-url>
cd ai_chat
```

#### 2. 后端设置

```bash
cd backend-ts

# 安装依赖
npm install

# 初始化数据库（首次运行或schema变更后）
npx prisma migrate dev

# 启动开发服务器
npm run start:dev
```

后端服务将在 `http://localhost:3000` 启动

#### 3. 前端设置

```bash
cd frontend

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

前端应用将在 `http://localhost:5173` 启动（或Vite分配的端口）

### 首次访问

1. 打开浏览器访问前端地址（如 http://localhost:5173）
2. 首次使用需要注册管理员账户（访问 `/password` 路径设置初始密码）
3. 登录后即可开始使用

## 📁 项目结构

```
ai_chat/
├── backend-ts/                    # NestJS 后端
│   ├── src/
│   │   ├── common/               # 通用模块
│   │   │   ├── config/           # 配置文件（上传路径配置等）
│   │   │   ├── database/         # 数据库Repository层（Prisma封装）
│   │   │   ├── filters/          # 异常过滤器
│   │   │   ├── mcp/              # MCP客户端服务
│   │   │   ├── services/         # 通用服务（UploadPathService, UrlService）
│   │   │   ├── types/            # 通用类型定义
│   │   │   ├── upload/           # 文件上传模块
│   │   │   ├── utils/            # 工具函数
│   │   │   │   └── tokenizer/    # Token计算服务
│   │   │   └── vector-db/        # 向量数据库抽象层（支持sqlite-vec）
│   │   ├── constants/            # 常量定义
│   │   ├── modules/              # 业务模块
│   │   │   ├── auth/             # 认证授权（JWT、登录、注册）
│   │   │   ├── characters/       # 角色管理（AI角色、分组）
│   │   │   ├── chat/             # 对话核心
│   │   │   │   ├── agent.service.ts      # Agent服务（对话引擎）
│   │   │   │   ├── context-manager.service.ts  # 上下文管理
│   │   │   │   ├── llm.service.ts        # LLM调用服务
│   │   │   │   ├── session.service.ts    # 会话管理
│   │   │   │   ├── message.service.ts    # 消息管理
│   │   │   │   ├── tool-result-cleaner.service.ts  # 工具结果清理
│   │   │   │   └── session-lock.service.ts     # 会话锁
│   │   │   ├── files/            # 文件管理
│   │   │   ├── knowledge-base/   # 知识库管理
│   │   │   │   ├── knowledge-bases.controller.ts  # 知识库CRUD
│   │   │   │   ├── kb-files.controller.ts       # 文件管理（含文件夹层级）
│   │   │   │   └── kb-search.controller.ts      # 混合检索（向量+全文）
│   │   │   ├── llm-core/         # LLM核心模块（多模型适配）
│   │   │   ├── mcp-servers/      # MCP服务器管理
│   │   │   ├── models/           # 模型管理（模型、提供商）
│   │   │   ├── settings/         # 全局设置
│   │   │   ├── tools/            # 工具系统
│   │   │   │   ├── providers/    # 工具提供者（MCP、Time、Memory、KnowledgeBase、ImageRecognition）
│   │   │   │   ├── tool-context.ts            # 工具上下文
│   │   │   │   └── tool-orchestrator.service.ts  # 工具编排器
│   │   │   └── users/            # 用户管理
│   │   ├── scripts/              # 脚本文件（数据种子、验证等）
│   │   ├── app.module.ts         # 根模块
│   │   └── main.ts               # 入口文件
│   ├── prisma/
│   │   ├── migrations/           # 数据库迁移记录
│   │   └── schema.prisma         # Prisma Schema
│   ├── data/                     # 数据库文件
│   │   ├── ai_chat.db            # 主业务数据库
│   │   └── vector_db.sqlite      # 向量数据库
│   ├── static/                   # 静态文件存储
│   │   ├── file_stores/          # 用户上传文件
│   │   │   ├── avatars/          # 头像
│   │   │   ├── images/           # 图片
│   │   │   ├── previews/         # 预览图
│   │   │   ├── files/            # 普通文件
│   │   │   └── knowledge-base/   # 知识库文件
│   │   └── images/               # 模型/提供商图标
│   ├── dist/                     # 编译输出
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/                      # Vue 3 前端
│   ├── src/
│   │   ├── assets/               # 静态资源
│   │   ├── components/           # Vue组件
│   │   │   ├── ChatPanel/        # 聊天面板相关
│   │   │   ├── KnowledgeBase/    # 知识库页面组件
│   │   │   ├── MessageItem/      # 消息项组件
│   │   │   ├── account/          # 账户管理
│   │   │   ├── icons/            # 图标组件
│   │   │   ├── setting/          # 设置相关
│   │   │   │   └── MCPServers.vue  # MCP服务器管理
│   │   │   └── ui/               # UI组件
│   │   ├── composables/          # Vue组合式函数
│   │   ├── services/             # API服务（ApiService）
│   │   ├── stores/               # Pinia状态管理
│   │   │   ├── auth.ts           # 认证状态
│   │   │   ├── session.ts        # 会话状态
│   │   │   ├── knowledgeBase.ts  # 知识库状态
│   │   │   └── fileUpload.ts     # 文件上传状态
│   │   ├── types/                # TypeScript类型定义
│   │   ├── utils/                # 工具函数
│   │   ├── App.vue               # 根组件
│   │   └── main.js               # 入口文件
│   ├── public/                   # 公共资源
│   ├── dist/                     # 构建输出
│   ├── package.json
│   └── vite.config.ts
│
├── docs/                          # 项目文档
│   ├── folder-hierarchy-upload.md  # 文件夹上传功能
│   ├── session-context-compression-optimization.md  # 上下文压缩优化
│   ├── tool-context-optimization.md  # 工具上下文优化
│   └── ...                       # 其他功能文档
│
└── README.md                      # 本文件
```

## 📖 API文档

### 认证接口

- `POST /api/v1/auth/login` - 用户登录
- `POST /api/v1/auth/register` - 用户注册
- `POST /api/v1/auth/auto-login` - 自动登录（Electron环境）

### 会话管理

- `GET /api/v1/sessions` - 获取会话列表
- `POST /api/v1/sessions` - 创建新会话
- `GET /api/v1/sessions/:id` - 获取会话详情
- `PUT /api/v1/sessions/:id` - 更新会话
- `DELETE /api/v1/sessions/:id` - 删除会话
- `POST /api/v1/sessions/:id/generate-title` - 自动生成会话标题
- `POST /api/v1/sessions/:id/compress-history` - 压缩会话历史
- `GET /api/v1/sessions/:id/summaries` - 获取会话摘要列表
- `PUT /api/v1/sessions/summaries/:summaryId` - 更新摘要
- `DELETE /api/v1/sessions/summaries/:summaryId` - 删除摘要
- `GET /api/v1/sessions/:id/token-stats` - 获取Token统计

### 对话接口

- `SSE /api/v1/chat/completions` - SSE流式对话（标准SSE端点）
- `POST /api/v1/chat/stream` - POST流式对话（推荐，支持更多控制）

### 消息管理

- `GET /api/v1/sessions/:sessionId/messages` - 获取会话消息列表
- `POST /api/v1/sessions/:sessionId/messages` - 创建新消息
- `PUT /api/v1/messages/:messageId` - 更新消息
- `DELETE /api/v1/messages/:messageId` - 删除消息
- `DELETE /api/v1/sessions/:sessionId/messages` - 清空会话所有消息
- `PUT /api/v1/message-content/:contentId/active` - 激活指定消息内容（多版本切换）
- `POST /api/v1/sessions/:sessionId/messages/import` - 导入消息

### 知识库管理

- `GET /api/v1/knowledge-bases` - 获取知识库列表
- `POST /api/v1/knowledge-bases` - 创建知识库
- `GET /api/v1/knowledge-bases/:id` - 获取知识库详情
- `PUT /api/v1/knowledge-bases/:id` - 更新知识库
- `DELETE /api/v1/knowledge-bases/:id` - 删除知识库
- `POST /api/v1/knowledge-bases/:id/files/upload` - 上传文件到知识库
- `GET /api/v1/knowledge-bases/:id/files` - 获取知识库文件列表
- `GET /api/v1/knowledge-bases/:id/files/by-parent` - 按父文件夹获取文件
- `GET /api/v1/knowledge-bases/:id/files/by-path` - 按路径获取文件
- `GET /api/v1/knowledge-bases/:id/files/:file_id` - 获取文件详情
- `GET /api/v1/knowledge-bases/:id/files/:file_id/status` - 获取文件处理状态
- `POST /api/v1/knowledge-bases/:id/files/status/batch` - 批量获取文件状态
- `DELETE /api/v1/knowledge-bases/:id/files/:file_id` - 删除文件
- `POST /api/v1/knowledge-bases/:id/files/:file_id/retry` - 重试文件处理
- `GET /api/v1/knowledge-bases/:id/files/:file_id/chunks` - 获取文件分块列表
- `POST /api/v1/knowledge-bases/:id/files/:file_id/rename` - 重命名文件
- `POST /api/v1/knowledge-bases/:id/files/:file_id/move` - 移动文件
- `POST /api/v1/knowledge-bases/:id/files/folder` - 创建文件夹
- `POST /api/v1/knowledge-bases/:id/search` - 知识库混合检索（向量+全文）

### MCP服务器

- `GET /api/v1/mcp-servers` - 获取MCP服务器列表
- `POST /api/v1/mcp-servers` - 添加MCP服务器
- `PUT /api/v1/mcp-servers/:id` - 更新MCP服务器
- `DELETE /api/v1/mcp-servers/:id` - 删除MCP服务器
- `POST /api/v1/mcp-servers/:id/refresh-tools` - 刷新工具列表

### 模型管理

- `GET /api/v1/models` - 获取模型列表
- `POST /api/v1/models` - 添加模型
- `PUT /api/v1/models/:id` - 更新模型
- `DELETE /api/v1/models/:id` - 删除模型
- `GET /api/v1/providers` - 获取提供商列表
- `GET /api/v1/providers/templates` - 获取提供商模板
- `POST /api/v1/providers` - 添加提供商
- `PUT /api/v1/providers/:id` - 更新提供商
- `DELETE /api/v1/providers/:id` - 删除提供商
- `POST /api/v1/providers/test-connection` - 测试提供商连接
- `GET /api/v1/providers/:id/remote_models` - 获取远程模型列表

### 角色管理

- `GET /api/v1/characters` - 获取角色列表
- `POST /api/v1/characters` - 创建角色
- `GET /api/v1/characters/:id` - 获取角色详情
- `PUT /api/v1/characters/:id` - 更新角色
- `DELETE /api/v1/characters/:id` - 删除角色
- `POST /api/v1/characters/:id/avatars` - 上传角色头像
- `GET /api/v1/characters/:id/tools` - 获取角色可用工具
- `GET /api/v1/character-groups` - 获取角色分组列表
- `POST /api/v1/character-groups` - 创建角色分组
- `PUT /api/v1/character-groups/:id` - 更新角色分组
- `DELETE /api/v1/character-groups/:id` - 删除角色分组

## 🛠️ 开发指南

### 后端开发

#### 添加新的业务模块

1. 在 `src/modules/` 下创建模块目录
2. 创建Module、Controller、Service文件
3. 在 `app.module.ts` 中导入新模块
4. 编写单元测试

#### 数据库迁移

```bash
# 修改 prisma/schema.prisma 后执行
npx prisma migrate dev --name <migration_name>

# 生成Prisma Client
npx prisma generate
```

#### 添加工具提供者

在 `src/modules/tools/providers/` 下创建新的Provider类，实现 `IToolProvider` 接口：

```typescript
export class MyToolProvider implements IToolProvider {
  readonly namespace = 'my_tools';
  
  async getToolsNamespaced(...) { ... }
  async executeWithNamespace(...) { ... }
}
```

### 前端开发

#### 添加新页面

1. 在 `src/components/` 下创建页面组件
2. 在路由配置中添加路由
3. 如需状态管理，在 `src/stores/` 中添加Store

#### API调用

使用 `src/services/` 中的API服务：

```javascript
import { sessionApi } from '@/services/api'

const sessions = await sessionApi.getSessions()
```

### 代码规范

项目遵循统一的代码规范（见 `.lingma/rules/develop.md`）：

- **缩进**: 4个空格
- **注释**: 使用中文，解释"为什么"而非"做什么"
- **命名**: 
  - 变量/函数: camelCase
  - 类/接口: PascalCase
  - 常量: UPPER_SNAKE_CASE
- **TypeScript**: 避免使用any，显式声明类型

## 🌐 部署说明

### 生产环境构建

#### 后端

```bash
cd backend-ts

# 构建
npm run build

# 启动生产服务器
npm run start:prod
```

#### 前端

```bash
cd frontend

# 构建
npm run build

# 生成的文件在 dist/ 目录，可部署到Nginx或其他静态服务器
```

### 环境变量配置

关键环境变量（`.env`）：

```bash
# 数据库配置
DATABASE_URL="file:./data/ai_chat.db"
VECTOR_DB_PATH=./data/vector_db.sqlite

# JWT配置
JWT_SECRET="your-super-secret-jwt-key-change-this-in-production-2026"
JWT_EXPIRES_IN="7d"

# 服务器配置
PORT=3000
NODE_ENV=development
BASE_URL=http://localhost:3000

# 静态资源配置
STATIC_DIR=./static
STATIC_URL=/static

# 文件上传配置
UPLOAD_BASE_DIR=file_stores
UPLOAD_AVATAR_SUBDIR=avatars
UPLOAD_IMAGE_SUBDIR=images
UPLOAD_PREVIEW_SUBDIR=previews
UPLOAD_FILE_SUBDIR=files
UPLOAD_KB_SUBDIR=knowledge-base

# 模型提供商API Keys（可选）
SILICONFLOW_API_KEY=sk-xxx
```

## 📝 功能文档

更多详细的功能说明和最佳实践，请查看 [docs/](docs/) 目录：

- [自动登录功能](docs/auto-login-feature.md) - Electron环境自动登录实现
- [后端URL转换](docs/backend-url-transformation.md) - URL转换机制详解
- [角色头像默认值](docs/character-avatar-default.md) - 角色头像默认处理逻辑
- [依赖升级指南](docs/dependency-upgrade-guide.md) - 依赖版本升级注意事项
- [Windows原生模块配置](docs/windows-native-modules-setup.md) - Windows环境native模块编译
- [Electron优化报告](docs/ELECTRON_PACKAGE_OPTIMIZATION_REPORT.md) - Electron打包优化
- [Electron快速参考](docs/ELECTRON_QUICK_REFERENCE.md) - Electron开发快速参考

## 🤝 贡献指南

欢迎提交Issue和Pull Request来改进项目！

### 贡献流程

1. Fork 本项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

### 提交规范

- feat: 新功能
- fix: 修复bug
- docs: 文档更新
- style: 代码格式调整
- refactor: 重构
- test: 测试相关
- chore: 构建过程或辅助工具的变动

## 📄 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件

## 📞 联系方式

如有问题或建议：

- 提交 [Issue](../../issues)
- 发送邮件至项目维护者

---

**最后更新**: 2026-04-25  
**当前版本**: v2.0.0 (TypeScript重构版)
