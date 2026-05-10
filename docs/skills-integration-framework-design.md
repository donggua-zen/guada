# Skills 集成框架设计方案

> **版本**: 1.0  
> **日期**: 2026-05-04  
> **状态**: 设计阶段

---

## 目录

1. [现有系统架构分析](#1-现有系统架构分析)
2. [Anthropic Skills 协议规范研究](#2-anthropic-skills-协议规范研究)
3. [Skills 集成框架总体架构](#3-skills-集成框架总体架构)
4. [关键接口设计规范](#4-关键接口设计规范)
5. [热插拔实现机制](#5-热插拔实现机制)
6. [本地文件扫描与 Skills 管理流程](#6-本地文件扫描与-skills-管理流程)
7. [与现有系统集成方案](#7-与现有系统集成方案)
8. [框架扩展性设计](#8-框架扩展性设计)
9. [附录：关键代码修改](#9-附录关键代码修改)

---

## 1. 现有系统架构分析

### 1.1 系统总体架构

当前系统基于 **NestJS** 构建，采用模块化单体架构，通过 Express.js 提供 HTTP API 服务。

```
┌─────────────────────────────────────────────────────────────────┐
│                        AppModule (Root)                         │
├────────────┬────────────┬────────────┬────────────┬────────────┤
│ ChatModule │ToolsModule │LlmCoreMod  │ AuthModule │Characters  │
│ (对话管理)  │ (工具执行)  │ (LLM抽象)  │ (认证)     │ (角色)     │
├────────────┼────────────┼────────────┼────────────┼────────────┤
│ ModelsMod  │FilesModule │SettingsMod │ MCP Module │ KB Module  │
│ (模型管理)  │ (文件)     │ (设置)     │ (MCP客户端) │ (知识库)   │
└────────────┴────────────┴────────────┴────────────┴────────────┘
```

入口文件 `main.ts` 负责启动 NestJS 应用，挂载静态资源目录，配置日志和全局过滤器。模块声明集中在 `app.module.ts` 中。

### 1.2 对话管理流程（ChatModule）

核心流程图：

```
HTTP Request (ChatController)
        │
        ▼
  AgentService.completions()
        │
        ├─ SessionLockService.tryLock()     ← 会话级并发锁（Map实现）
        │     └─ 失败 → ConflictException
        │
        ├─ SessionRepo.findById()           ← 加载会话配置
        ├─ mergeSessionSettings()           ← 合并角色/会话设置
        │
        ├─ ConversationContextFactory.create() ← 创建上下文
        │     ├─ MessageStore.loadMessages()   ← 加载历史消息
        │     └─ CompressionEngine.getCheckpoint() ← 恢复压缩状态
        │
        └─ executeAgentLoop()               ← ReAct 多轮循环
              │
              ├─ ToolContextFactory.createContext() ← 构建工具上下文
              ├─ ToolOrchestrator.getAllTools()     ← 获取工具定义
              ├─ ToolOrchestrator.getAllToolPrompts() ← 获取工具提示词
              │
              └─ do {  ← 最大 40 次迭代
                    ├─ context.getMessages()        ← 含压缩判断
                    ├─ llmService.completions()     ← 流式 AI 推理
                    ├─ yield SSE events             ← 实时推送(start/text/think/tool_call/finish)
                    ├─ toolOrchestrator.executeBatch() ← 批量执行工具
                    └─ context.appendParts()        ← 持久化消息
                  } while (needToContinue)
```

### 1.3 工具调用管理流程（ToolsModule）

核心架构：

```
ToolOrchestrator (中央调度器)
│
├─ Map<string, IToolProvider> providers
│     ├─ "knowledge_base" → KnowledgeBaseToolProvider
│     ├─ "memory"         → MemoryToolProvider
│     ├─ "mcp"            → MCPToolProvider
│     ├─ "time"           → TimeToolProvider
│     ├─ "shell"          → ShellToolProvider
│     └─ "image"          → ImageRecognitionToolProvider
│
├─ getAllTools(context)    — 收集所有 Provider 的工具定义，加 namespace 前缀
├─ getAllToolPrompts(context) — 收集所有 Provider 的提示词
├─ executeBatch(requests, context) — 按 namespace 路由到对应 Provider
└─ getLocalToolsList(userId, settings) — 获取本地工具列表（管理用）
```

关键接口 `IToolProvider`：

```typescript
export interface IToolProvider {
  namespace: string;
  getTools(enabled?: boolean | string[]): Promise<any[]>;
  execute(request: ToolCallRequest, context?: Record<string, any>): Promise<string>;
  getPrompt(context?: Record<string, any>): Promise<string>;
  getMetadata(): ToolProviderMetadata;
}
```

`ToolContextFactory` 在每次 Agent 循环开始时动态遍历 ToolOrchestrator 的所有 Provider 构建每会话的工具配置。

### 1.4 会话状态管理机制

| 组件 | 职责 |
|------|------|
| `SessionService` | 会话 CRUD，角色配置继承，memory 设置合并 |
| `SessionLockService` | 基于 `Map<string, boolean>` 的内存锁 |
| `ConversationContext` | 对话历史管理、Token 计数缓存（增量维护）、压缩触发 |
| `CompressionEngine` | 消息压缩策略（保留/摘要/裁剪） |
| `MessageStoreService` | 消息持久化与加载 |

### 1.5 与 Skills 协议的关键差异分析

| 维度 | 现有 Tool 框架 | Anthropic Skills 协议 | 差异 |
|------|--------------|---------------------|------|
| **抽象层级** | LLM 可调用的函数 | 领域专业知识包 | Skills 是更高层抽象，可包含多个 Tool |
| **加载方式** | 启动时注册全部 | 渐进式三阶段加载 | Skills 更节约上下文窗口 |
| **存储介质** | 代码中硬编码 / 数据库(MCP) | 文件系统目录 | 核心差异 |
| **生命周期** | 静态（代码级） | 动态（hot-reload） | Skills 支持热插拔 |
| **与 LLM 交互** | 注入 tool_choice | 注入 system prompt + 文件读取 | 不同的注入路径 |
| **可组合性** | 通过 namespace 前缀 | 自动发现+组合 | Skills 组合更灵活 |
| **版本管理** | 无 | 内建版本控制 | Skills 有版本概念 |

---

## 2. Anthropic Skills 协议规范研究

### 2.1 协议核心概念

Anthropic Skills 协议定义了一套 **文件系统为基础的渐进式知识加载标准**，核心思想是将领域专业知识打包为可发现的、按需加载的模块。于 2025 年 10 月首次推出，2025 年 12 月作为开放标准发布，48 小时内被 Microsoft、OpenAI 采纳。

### 2.2 三级渐进披露（Progressive Disclosure）

```
Level 1: Metadata（始终加载）
  └─ YAML frontmatter: name + description
  └─ Token 成本: ~100 tokens/skill
  └─ 注入位置: system prompt 顶部

Level 2: Instructions（触发时加载）
  └─ SKILL.md 正文: 工作流、最佳实践、代码示例
  └─ Token 成本: <5000 tokens
  └─ 加载方式: bash read SKILL.md

Level 3: Resources & Code（按需加载）
  └─ *.md 参考文档、scripts/*.py、templates/*
  └─ Token 成本: 近乎无限（脚本输出不计入上下文）
  └─ 加载方式: bash 读取文件 / bash 执行脚本
```

### 2.3 SKILL.md 标准格式

```yaml
---
name: skill-name           # 64字符内，小写字母+数字+连字符
description: >             # 1024字符内，第三人称，描述功能和使用场景
  描述这个 Skill 做什么以及何时使用它。
---
```

Markdown 正文包含：工作流程指导（workflows）、代码示例和脚本引用、资源文件路径引用、条件分支逻辑。

### 2.4 目录结构标准

```
skill-name/
├── SKILL.md              # 必需：核心指令文件
├── FORMS.md              # 可选：专项指南
├── REFERENCE.md          # 可选：API/数据库参考
├── EXAMPLES.md           # 可选：使用示例
└── scripts/
    ├── utility.py        # 可执行脚本（输出不计入上下文）
    └── validate.py
```

### 2.5 Skills API 集成方式

Skills 通过 `container` 参数注入到 Messages API 请求中：

```json
{
  "container": {
    "skills": [
      { "type": "anthropic", "skill_id": "pptx", "version": "latest" },
      { "type": "custom", "skill_id": "skill_xxx", "version": "latest" }
    ]
  }
}
```

- Anthropic Skills 版本格式：`latest` 或日期格式（`20251013`）
- 自定义 Skills 版本格式：epoch 时间戳或 `latest`

---

## 3. Skills 集成框架总体架构

### 3.1 架构决策：全新设计 vs 复用 Tool 框架

经过对现有 Tool 框架的深入分析，**决定采用全新框架设计**，理由如下：

1. **抽象层级不匹配**：Tool 是"LLM可调用的函数"，Skill 是"领域专业知识包"——Skill 可以包含多个 Tool 定义
2. **生命周期管理差异**：Tool 在应用启动时注册（静态），Skill 需要运行时热插拔（动态）
3. **加载策略本质不同**：Tool 全量注入 tool_choice，Skill 采用渐进式披露
4. **存储模型差异**：Tool 定义在代码/数据库中，Skill 以文件系统为唯一事实来源
5. **集成路径差异**：Skill 修改 system prompt 结构，而 Tool 修改 tool_choice

**保留互操作能力**：Skill 可通过声明方式注册自定义 ToolProvider，实现与现有 Tool 框架的双向整合。

### 3.2 核心模块划分

```
src/modules/skills/
├── skills.module.ts                       # NestJS 模块定义
├── interfaces/
│   ├── skill-manifest.interface.ts         # SKILL.md 解析结构
│   ├── skill-executor.interface.ts         # 脚本执行器接口
│   └── skill-registry.interface.ts         # 注册表/发现接口
├── core/
│   ├── skill-orchestrator.service.ts       # 技能编排器（中央调度）
│   ├── skill-registry.service.ts           # 技能注册表（内存索引）
│   ├── skill-discovery.service.ts          # 文件系统扫描与发现
│   ├── skill-loader.service.ts             # 渐进式加载引擎
│   └── skill-version-manager.service.ts    # 版本控制管理
├── execution/
│   ├── skill-script-executor.service.ts    # 脚本执行沙箱
│   └── skill-bash-proxy.service.ts         # Bash 命令代理
├── integration/
│   ├── skill-tool-bridge.service.ts        # Skill→Tool 桥接器
│   └── skill-context-injector.service.ts   # 上下文注入器
└── api/
    ├── skills.controller.ts                # Skills REST API
    └── dto/
        ├── install-skill.dto.ts
        ├── update-skill.dto.ts
        └── skill-list.dto.ts
```

### 3.3 系统架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            Skills Integration Framework                      │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                        Skills REST API Layer                          │  │
│  │  GET    /api/v1/skills          → 列出已加载 Skills                   │  │
│  │  GET    /api/v1/skills/:id      → 获取 Skill 详情                    │  │
│  │  POST   /api/v1/skills/install  → 安装 Skill                        │  │
│  │  POST   /api/v1/skills/:id/uninstall → 卸载 Skill                  │  │
│  │  POST   /api/v1/skills/scan     → 触发手动扫描                       │  │
│  │  POST   /api/v1/skills/:id/reload → 热加载指定 Skill                 │  │
│  └───────────────────────────────┬──────────────────────────────────────┘  │
│                                  │                                          │
│  ┌───────────────────────────────▼──────────────────────────────────────┐  │
│  │                     SkillOrchestrator (编排层)                        │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────────┐  │  │
│  │  │ Discovery    │  │ Registry     │  │ VersionManager             │  │  │
│  │  │ (文件扫描)    │  │ (内存索引)    │  │ (版本控制)                  │  │  │
│  │  └──────┬───────┘  └──────┬───────┘  └─────────────┬──────────────┘  │  │
│  │         │                 │                        │                  │  │
│  │         └─────────┬───────┴────────────────────────┘                  │  │
│  │                   │                                                    │  │
│  │         ┌─────────▼──────────┐                                        │  │
│  │         │  SkillLoader       │  ←── 渐进式加载引擎                    │  │
│  │         │  L1: Metadata      │       (name + description)             │  │
│  │         │  L2: Instructions  │       (SKILL.md body)                  │  │
│  │         │  L3: Resources     │       (scripts/*, *.md, templates/*)   │  │
│  │         └─────────┬──────────┘                                        │  │
│  └───────────────────┼───────────────────────────────────────────────────┘  │
│                      │                                                      │
│  ┌───────────────────┼───────────────────────────────────────────────────┐  │
│  │         Execution Layer                                                │  │
│  │  ┌────────────┐  ┌────────────────────┐  ┌────────────────────────┐  │  │
│  │  │ Script     │  │ Bash Proxy         │  │ Tool Bridge            │  │  │
│  │  │ Executor   │  │ (沙箱命令执行)      │  │ (Skill→IToolProvider)   │  │  │
│  │  │ (沙箱脚本)  │  │                    │  │                        │  │  │
│  │  └────────────┘  └────────────────────┘  └────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                      │                                                      │
│  ┌───────────────────▼───────────────────────────────────────────────────┐  │
│  │                     Integration Layer                                  │  │
│  │  ┌────────────────────────────────┐  ┌────────────────────────────┐  │  │
│  │  │ SkillContextInjector           │  │ ToolOrchestrator (现有)     │  │  │
│  │  │ • 注入 System Prompt           │  │ • 动态注册 Skill Tools      │  │  │
│  │  │ • 注入可用 Skills 元数据        │  │ • 路由 Skill 工具调用        │  │  │
│  │  └────────────────────────────────┘  └────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                      File System Layer                               │  │
│  │                                                                      │  │
│  │  {SKILLS_DIR}/                         ← 环境变量配置               │  │
│  │  ├── pdf-processing/                   ← Skill 目录                 │  │
│  │  │   ├── SKILL.md                      ← 必需                       │  │
│  │  │   ├── FORMS.md                      ← 可选                       │  │
│  │  │   └── scripts/                                                  │  │
│  │  │       └── extract.py                                             │  │
│  │  ├── code-review/                                                   │  │
│  │  │   ├── SKILL.md                                                   │  │
│  │  │   └── templates/                                                 │  │
│  │  └── .versions/                          ← 版本元数据缓存           │  │
│  │      └── versions.json                                               │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.4 模块间核心交互流程

```
启动流程：
  1. NestJS DI → SkillsModule.onModuleInit()
  2. SkillOrchestrator.initialize()
     ├─ fs.mkdir(SKILLS_DIR, { recursive: true })
     ├─ SkillDiscovery.scan()
     │   ├─ fs.readdir → 过滤含 SKILL.md 的目录
     │   └─ 并行 SkillLoader.loadManifest(dir) → SkillDefinition[]
     └─ 批量 SkillRegistry.register(skills[])

对话请求流程：
  1. AgentService.completions(sessionId, msgId)
  2. 构建 systemPrompt:
     basePrompt + skillOrchestrator.getMetadataInjection() + toolPrompts
     // 此时 L1 元数据已注入，LLM 知道有哪些 Skill 及其作用
  3. executeAgentLoop() — LLM 通过工具调用自主获取 Skill 内容：
     ┌─ L2 加载：LLM 调用 shell__read_file { path: "skills/xxx/SKILL.md" }
     │   → ShellToolProvider 读取文件 → 指令进入上下文
     ├─ L3 资源：LLM 调用 shell__read_file { path: "skills/xxx/REFERENCE.md" }
     │   → 按需读取特定参考文档
     ├─ L3 脚本：LLM 调用 shell__execute_command
     │   { command: "python skills/xxx/scripts/extract.py" }
     │   → 脚本代码不占上下文，仅 stdout 进入对话
     └─ 自定义工具：若 Skill 注册了 tools/tools.json
         LLM 调用 skill__{skillName}__{toolName}
         → SkillToolBridge → SkillScriptExecutor
  4. 总结：L1 通过 system prompt 自动注入，L2/L3 由 LLM
     通过已有的 ShellToolProvider 工具主动拉取，无需额外机制

Skill 变更流程（用户主动触发，无自动文件监听）：
  1. 用户通过 API 安装/卸载 Skill，或手动修改本地文件后调用 reload 接口
  2. install/uninstall 操作完成后自动调用 scan() 刷新注册表
  3. 单 Skill 重载（reload）：重新解析 SKILL.md，对比 contentHash
  4. 若变更 → SkillRegistry.update() → 若已加载 L2 标记为脏
  5. 若注册了自定义工具 → 通知 ToolOrchestrator
```

---

## 4. 关键接口设计规范

### 4.1 数据模型

```typescript
// ======== SkillManifest (L1 元数据，对应 SKILL.md YAML frontmatter) ========
export interface SkillManifest {
  name: string;               // 技能名称（≤64字符，小写+数字+连字符）
  description: string;        // 技能描述（≤1024字符，第三人称）
  version?: string;           // 语义化版本 "1.0.0"
  dependencies?: string[];    // 依赖的其他 Skill 名称
  author?: string;            // 作者
  tags?: string[];            // 分类标签
}

// ======== SkillDefinition (完整定义，内存表示) ========
export interface SkillDefinition {
  id: string;                    // = manifest.name
  basePath: string;              // 文件系统绝对路径
  manifest: SkillManifest;       // 解析后的 YAML frontmatter
  instructions?: string;         // SKILL.md 正文（L2，惰性加载）
  resources?: Map<string, string>;// L3 资源文件
  loadState: SkillLoadState;     // 加载状态
  installedAt: Date;
  lastModifiedAt: Date;
  contentHash: string;           // SHA256（用于变更检测）
  error?: string;                // 加载错误信息
  hasCustomTools?: boolean;      // 是否注册了自定义工具
}

export enum SkillLoadState {
  DISCOVERED = 'discovered',     // 仅 L1 加载（元数据）
  INDEXED    = 'indexed',        // 已注册到 Registry
  LOADED     = 'loaded',         // L2 已加载（指令）
  ACTIVE     = 'active',         // 当前会话正在使用
  ERROR      = 'error',          // 加载失败
  UNLOADING  = 'unloading',      // 正在卸载
}

// ======== 脚本执行模型 ========
export interface ScriptExecutionRequest {
  skillId: string;
  scriptPath: string;            // 相对路径
  args?: string[];               // 命令行参数
  env?: Record<string, string>;  // 环境变量
  timeoutMs?: number;            // 默认 30000
  maxOutputBytes?: number;       // 默认 1MB
}

export interface ScriptExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
}

// ======== 扫描结果模型 ========
export interface SkillDiscoveryResult {
  added: SkillDefinition[];
  updated: SkillDefinition[];
  removed: string[];
  errors: Array<{ path: string; error: string }>;
  scanDurationMs: number;
}

// ======== 安装源模型 ========
export interface SkillSource {
  type: 'directory' | 'zip' | 'git';
  path?: string;
  buffer?: Buffer;
  url?: string;
  overwrite?: boolean;
}
```

### 4.2 核心服务接口

```typescript
// ======== ISkillOrchestrator — 中央调度器 ========
export interface ISkillOrchestrator {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;

  // Skills CRUD
  install(source: SkillSource): Promise<SkillDefinition>;
  uninstall(skillId: string): Promise<void>;
  update(skillId: string, source: SkillSource): Promise<SkillDefinition>;

  // 上下文注入（核心集成点）
  getMetadataInjection(): string;
  getInstructionInjection(skillId: string): Promise<string>;
  matchSkills(userMessage: string): Promise<SkillMatch[]>;

  // 工具集成
  getSkillToolDefinitions(): Promise<any[]>;
  getSkillToolPrompts(): Promise<string>;
  getSkillToolProviders(): Map<string, IToolProvider>;

  // 脚本执行
  executeScript(req: ScriptExecutionRequest): Promise<ScriptExecutionResult>;

  // 查询
  listSkills(): SkillListResponse;
  getSkillDetail(skillId: string): SkillDetailResponse | null;
}

// ======== ISkillRegistry — 内存注册表 ========
export interface ISkillRegistry {
  register(skill: SkillDefinition): void;
  unregister(skillId: string): void;
  get(skillId: string): SkillDefinition | undefined;
  getAll(): ReadonlyMap<string, SkillDefinition>;
  getActive(): SkillDefinition[];
  searchByTags(tags: string[]): SkillDefinition[];
  snapshot(): Readonly<SkillDefinition[]>;
  onChange(listener: (e: SkillRegistryEvent) => void): () => void; // 返回取消订阅函数
}

// ======== ISkillDiscovery — 文件发现（仅启动时 + 手动触发） ========
export interface ISkillDiscovery {
  scan(): Promise<SkillDiscoveryResult>;
}

// ======== ISkillScriptExecutor — 脚本执行 ========
export interface ISkillScriptExecutor {
  execute(request: ScriptExecutionRequest): Promise<ScriptExecutionResult>;
  validateEnvironment(skillId: string): Promise<EnvironmentValidation>;
  installDependencies(skillId: string): Promise<void>;
}
```

### 4.3 REST API 规范

| 方法 | 路径 | 说明 | 请求体 | 响应 |
|------|------|------|--------|------|
| `GET` | `/api/v1/skills` | 列出已加载 Skills | — | `SkillListResponse` |
| `GET` | `/api/v1/skills/:id` | 获取 Skill 详情 | — | `SkillDetailResponse` |
| `POST` | `/api/v1/skills/install` | 安装 Skill | `SkillInstallDto` | `SkillDefinition` |
| `POST` | `/api/v1/skills/:id/uninstall` | 卸载 Skill | — | `{ ok: true }` |
| `POST` | `/api/v1/skills/scan` | 触发手动扫描 | — | `SkillDiscoveryResult` |
| `POST` | `/api/v1/skills/:id/reload` | 热加载 Skill 指令 | — | `SkillDefinition` |

### 4.4 错误处理机制

```typescript
// ======== 统一错误类型 ========
export class SkillError extends Error {
  constructor(
    message: string,
    public readonly code: SkillErrorCode,
    public readonly skillId?: string,
    public readonly details?: Record<string, any>,
  ) {
    super(message);
    this.name = 'SkillError';
  }
}

export enum SkillErrorCode {
  SKILL_NOT_FOUND            = 'SKILL_NOT_FOUND',            // 404
  MANIFEST_PARSE_ERROR       = 'MANIFEST_PARSE_ERROR',       // 400
  INVALID_MANIFEST           = 'INVALID_MANIFEST',           // 400
  DEPENDENCY_CYCLE           = 'DEPENDENCY_CYCLE',           // 400
  SKILL_ALREADY_LOADED       = 'SKILL_ALREADY_LOADED',       // 409
  SKILL_NOT_LOADED           = 'SKILL_NOT_LOADED',           // 404
  SKILL_LOCKED               = 'SKILL_LOCKED',               // 423
  SCRIPT_NOT_FOUND           = 'SCRIPT_NOT_FOUND',           // 404
  SCRIPT_TIMEOUT             = 'SCRIPT_TIMEOUT',             // 504
  SCRIPT_EXECUTION_FAILED    = 'SCRIPT_EXECUTION_FAILED',    // 500
  SCRIPT_PERMISSION_DENIED   = 'SCRIPT_PERMISSION_DENIED',   // 403
  ENVIRONMENT_NOT_READY      = 'ENVIRONMENT_NOT_READY',      // 503
  DEPENDENCY_MISSING         = 'DEPENDENCY_MISSING',         // 500
  SANDBOX_VIOLATION          = 'SANDBOX_VIOLATION',          // 403
  VERSION_CONFLICT           = 'VERSION_CONFLICT',           // 409
  SKILL_NAME_CONFLICT        = 'SKILL_NAME_CONFLICT',        // 409
  FILE_SYSTEM_ERROR          = 'FILE_SYSTEM_ERROR',          // 500
  DIRECTORY_ACCESS_DENIED    = 'DIRECTORY_ACCESS_DENIED',    // 403
}
```

---

## 5. 热插拔实现机制

### 5.1 状态机

```
              install()          activate()
  [NONE] ──────────────▶ [LOADED] ─────────▶ [ACTIVE]
    ▲                       │                    │
    │              reload() │            deactivate()
    │                       ▼                    ▼
    │                    [LOADED] ◀──────── [LOADED]
    │                       │
    │              error    │
    │                       ▼
    │                    [ERROR] ── retry ──▶ [LOADED]
    │
    └──── uninstall() ──── [REMOVED]
```

### 5.2 安装流程（install）

```
SkillOrchestrator.install(source)
├─ 1. 验证 source 类型 (directory | zip | git)
├─ 2. 检查名称冲突（SkillRegistry.get(name)）
│     └─ 冲突 + !overwrite → SKILL_NAME_CONFLICT
├─ 3. 复制/解压 Skill 到 {SKILLS_DIR}/{name}/
│     ├─ directory → fs.cp (递归复制)
│     ├─ zip → 解压到目标目录
│     └─ git → git clone / git pull
├─ 4. SkillLoader.loadManifest(path)
│     ├─ 读取并解析 SKILL.md YAML frontmatter
│     └─ 失败 → 清理已复制文件 + MANIFEST_PARSE_ERROR
├─ 5. SkillRegistry.register(skillDefinition)
│     └─ 写入内存 Map + 触发 onChange 事件
├─ 6. SkillVersionManager.recordInstall(skillId)
└─ 7. 返回 SkillDefinition
```

### 5.3 卸载流程（uninstall）

```
SkillOrchestrator.uninstall(skillId)
├─ 1. 检查 Skill 是否在活跃使用中
│     └─ 若 ACTIVE → 等待当前会话完成（带超时 30s）+ 标记 UNLOADING
├─ 2. 从 ToolOrchestrator 移除对应 ToolProvider（如已注册）
├─ 3. SkillRegistry.unregister(skillId)
│     └─ 从 Map 移除 + 触发 onChange 事件
├─ 4. fs.rm(skillDir, { recursive: true })
└─ 5. SkillVersionManager.recordUninstall(skillId)
```

### 5.4 手动重载流程（reload）

用户通过 API `POST /api/v1/skills/:id/reload` 触发，适用于手动修改 Skill 文件后的场景：

```
API 请求: POST /api/v1/skills/:id/reload
  │
  ├─ 1. SkillRegistry.get(skillId) → 验证 Skill 存在
  ├─ 2. SkillLoader.computeContentHash() → 新哈希
  ├─ 3. 对比缓存的 contentHash
  │     └─ 相同 → 返回当前状态（无变更）
  ├─ 4. SkillLoader.reloadManifest() → 重新解析 SKILL.md
  ├─ 5. SkillVersionManager.compareVersions(old, new)
  │     ├─ Major 升级 (1.x→2.x) → 记录警告日志
  │     ├─ Minor/Patch 升级 → 正常处理
  │     └─ 版本降级 → 警告日志 + 继续处理
  ├─ 6. SkillRegistry.update(newDefinition)
  ├─ 7. 若 L2 指令已加载 → 标记为脏（下次请求时重新加载）
  └─ 8. 若注册了自定义工具 → 通知 ToolOrchestrator 刷新
```

### 5.5 版本控制策略

- **一级版本**：SKILL.md 中 `version` 字段（语义化版本 `major.minor.patch`）
- **二级哈希**：基于 SKILL.md 内容的 SHA256（精确变更检测）
- **版本缓存**：`.versions/versions.json` 本地文件（不纳入数据库）
- **变更策略**：Major 升级需确认，Minor/Patch 自动热加载

### 5.6 保证服务连续性

- **非阻塞操作**：安装/卸载不影响正在进行的对话
- **轻量级锁**：仅阻止正在使用中的 Skill 被卸载
- **原子更新**：Registry 批量替换，避免中间状态暴露
- **优雅降级**：单个 Skill 加载失败不影响其他 Skills 的正常运行

---

## 6. 本地文件扫描与 Skills 管理流程

### 6.1 设计原则：内存缓存 + 启动/手动触发扫描

Skills 的发现与加载采用**简洁的两时机策略**，无需文件系统监听或定时轮询。

#### 为什么不每次请求都读盘？

| 维度 | 每次请求读盘 | 当前方案（内存缓存） |
|------|------------|-------------------|
| **SSD 损耗** | 每次对话产生 N 次 `readFile`，高频对话场景下无意义的重复读取 | 仅在启动、安装/卸载、手动重载时读盘 |
| **延迟** | 20 个 Skill 约 15-55ms，100 个约 70-250ms | **~0.01ms**（`Map.get`），零 I/O |
| **内存占用** | 0 | 每个 Skill L1 元数据约 2KB，100 个仅 ~200KB |
| **数据一致性** | 天然一致（每次读最新） | 一致性窗口 = [上次 scan, 下次 scan]，用户手动控制 |

虽然 SSD 读操作几乎不影响硬盘寿命（SSD 的 TBW 限制仅针对写入），但每次请求重复读取相同文件属于**完全不必要的 I/O 开销**。本项目的运行环境为个人电脑（通常为消费级 SSD），在高频对话场景下这种浪费尤为明显。

内存缓存方案以极小的内存代价（100 个 Skill 仅 ~200KB）换取了零磁盘读取，是最佳平衡点。

#### 扫描时机

```
时机1: 启动全量扫描（自动）
  SkillsModule.onModuleInit()
    → SkillOrchestrator.initialize()
    → SkillDiscovery.scan()
    → 发现所有含 SKILL.md 的目录 → 注册到 SkillRegistry

时机2: 手动触发扫描（API）
  POST /api/v1/skills/scan
    → SkillDiscovery.scan()
    → 对比 Registry 现有状态 → 输出 add/update/remove 差异

此外，install / uninstall 操作完成后会自动调用 scan() 刷新注册表。
```

### 6.2 目录结构约定

```
{SKILLS_DIR}/                          ← 环境变量 SKILLS_DIR，默认 ./skills
├── <skill-name>/                      ← name 匹配 SKILL.md 的 name 字段
│   ├── SKILL.md                       ← 唯一必需文件
│   ├── *.md                           ← L3 参考文档（允许多个）
│   ├── scripts/                       ← L3 可执行脚本
│   │   ├── *.py / *.sh / *.js
│   │   └── requirements.txt           ← 脚本依赖声明
│   ├── templates/                     ← L3 模板文件
│   └── tools/                         ← 可选：自定义工具定义
│       └── tools.json
├── .versions/                         ← 版本缓存（不纳入Git）
│   └── versions.json
└── .trash/                            ← 卸载临时备份（可选）
```

### 6.3 不持久化到数据库

- Skills 的全部内容以**文件系统为唯一事实来源**
- `.versions/versions.json` 仅为本地版本缓存文件
- 内存中的 `SkillRegistry` 是文件系统状态的运行时镜像
- 启动时**完全从文件系统重建**全部索引
- 数据库（Prisma schema）中**不创建**任何 Skills 相关表

### 6.4 内容哈希与变更检测

```typescript
// SHA256 哈希计算（变更检测核心）
function computeContentHash(skillDir: string): string {
  const skillMdContent = fs.readFileSync(path.join(skillDir, 'SKILL.md'));
  return createHash('sha256').update(skillMdContent).digest('hex');
}

// 还可附加 tools/tools.json 和 package.json 等关键文件到哈希输入
```

### 6.5 扫描实现关键逻辑

```typescript
async scan(): Promise<SkillDiscoveryResult> {
  const result = { added: [], updated: [], removed: [], errors: [], scanDurationMs: 0 };
  const startTime = Date.now();

  // 1. 读取目录，过滤非隐藏子目录
  const currentDirs = (await fs.readdir(this.skillsDir, { withFileTypes: true }))
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(e => e.name);

  // 2. 检测已移除的 Skills（在 Registry 中但不在文件系统中）
  const knownIds = [...this.registry.getAll().keys()];
  result.removed = knownIds.filter(id => !currentDirs.includes(id));

  // 3. 并行加载每个目录
  const tasks = currentDirs.map(dirName => this.loadSkillFromDir(dirName));
  const loadResults = await Promise.allSettled(tasks);

  // 4. 分类结果
  for (const r of loadResults) {
    if (r.status === 'fulfilled') {
      const { skill, isNew } = r.value;
      (isNew ? result.added : result.updated).push(skill);
    } else {
      result.errors.push({ path: '', error: r.reason.message });
    }
  }

  result.scanDurationMs = Date.now() - startTime;
  return result;
}
```

---

## 7. 与现有系统集成方案

### 7.1 集成架构总览

```
                     集成后的完整架构

┌──────────────────────────────────────────────────────────────────┐
│                         AppModule                                │
│  ┌────────────┐  ┌──────────────┐  ┌─────────────────────────┐  │
│  │ ChatModule │  │ ToolsModule  │  │ SkillsModule (新增)      │  │
│  │            │  │              │  │                         │  │
│  │ AgentSvc ──┼──┼─ ToolOrch   │◄─┼─ SkillOrchestrator       │  │
│  │            │  │              │  │    ├─ SkillRegistry      │  │
│  │ Context    │  │ ToolContext  │  │    ├─ SkillDiscovery     │  │
│  │            │  │ 6 ToolProvs  │  │    └─ SkillToolBridge ───┼──┤
│  └────────────┘  └──────────────┘  └─────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### 7.2 AppModule 集成

```typescript
// app.module.ts — 新增导入
import { SkillsModule } from "./modules/skills/skills.module";

@Module({
  imports: [
    // ... 现有模块
    SkillsModule,  // ← 新增
  ],
})
export class AppModule {}
```

### 7.3 AgentService 集成

在 `agent.service.ts` 的 `executeAgentLoop()` 中做两处关键改造：

**改造点 1：注入 SkillOrchestrator（可选注入，确保无 Skills 模块时降级运行）**

```typescript
constructor(
  // ... 现有依赖
  @Optional() private skillOrchestrator?: SkillOrchestrator,
) {}
```

**改造点 2：System Prompt 注入 Skills 元数据**

```typescript
// executeAgentLoop() 中，systemPrompt 构建部分：
const skillMetadataInjection = this.skillOrchestrator
  ? this.skillOrchestrator.getMetadataInjection()
  : '';

// 原: systemPrompt = sessionSettings.systemPrompt + "\n" + toolPrompts
// 改为:
const effectiveSystemPrompt = [
  sessionSettings.systemPrompt,
  skillMetadataInjection,
  toolPrompts,
].filter(Boolean).join('\n');
```

### 7.4 ToolOrchestrator 集成

`SkillToolBridge` 实现 `IToolProvider` 接口，作为所有 Skill 自定义工具的代理注册到 `ToolOrchestrator`：

```typescript
@Injectable()
export class SkillToolBridgeService implements IToolProvider {
  namespace = "skill";

  constructor(private skillOrchestrator: SkillOrchestrator) {}

  async getTools(enabled?: boolean | string[]): Promise<any[]> {
    return this.skillOrchestrator.getSkillToolDefinitions();
  }

  async execute(request: ToolCallRequest, context?: Record<string, any>): Promise<string> {
    // 解析 skill__{skillName}__{toolName} → 找到脚本并执行
    const result = await this.skillOrchestrator.executeScript({
      skillId: extractSkillName(request.name),
      scriptPath: extractToolScript(request.name),
      args: [JSON.stringify(request.arguments)],
    });
    return result.stdout;
  }

  async getPrompt(context?: Record<string, any>): Promise<string> {
    return this.skillOrchestrator.getSkillToolPrompts();
  }

  getMetadata(): ToolProviderMetadata {
    return {
      namespace: "skill",
      displayName: "Skills 工具",
      description: "由 Skills 模块提供的自定义工具",
      isMcp: false,
    };
  }
}
```

### 7.5 ChatModule 集成

```typescript
// chat.module.ts — 新增导入
@Module({
  imports: [AuthModule, ToolsModule, CharactersModule, FilesModule, LlmCoreModule,
    SkillsModule,  // ← 新增
  ],
  // ...
})
export class ChatModule {}
```

### 7.6 上下文注入策略

Skill 的 System Prompt 注入采用三级渐进式：

```
┌─────────────────────────────────────────────────────┐
│ System Prompt                                       │
│                                                     │
│ [角色定义 + 基础系统提示词]                            │
│                                                     │
│ ┌─ L1: Skills 元数据注入 ─────────────────────────┐ │
│ │                                                  │ │
│ │ 你拥有以下专业技能（Skills），可根据需要激活使用：   │ │
│ │                                                  │ │
│ │ - pdf-processing: 处理PDF文档，提取文本/表格      │ │
│ │ - code-review: 按团队规范进行代码审查             │ │
│ │                                                  │ │
│ │ 使用方式：当任务需要某技能时，通过相关指令读取      │ │
│ │ SKILL.md 获取详细指令。                          │ │
│ └──────────────────────────────────────────────────┘ │
│                                                     │
│ [Tool 提示词注入]                                    │
│                                                     │
│ ┌─ L2: 激活后的 Skills 指令注入 ──────────────────┐ │
│ │ (仅当判定 Skill 相关时动态加载)                  │ │
│ └──────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

---

## 8. 框架扩展性设计

### 8.1 扩展点架构

```
                       Skills Framework Extension Points
  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                      │
  │  EP-1: Custom Skill Loaders                                         │
  │  ┌──────────────────────────────────────────────────────────┐      │
  │  │ ISkillLoader { canHandle(ext): boolean; load(path): Def } │      │
  │  │ 可扩展支持: .skill.yaml, skill.json, skill.toml 等格式     │      │
  │  └──────────────────────────────────────────────────────────┘      │
  │                                                                      │
  │  EP-2: Custom Script Runtimes                                       │
  │  ┌──────────────────────────────────────────────────────────┐      │
  │  │ IScriptRuntime { runtime: string; execute(): Result }     │      │
  │  │ 内置: python, bash, node                                 │      │
  │  │ 可扩展: deno, lua, wasm, docker                           │      │
  │  └──────────────────────────────────────────────────────────┘      │
  │                                                                      │
  │  EP-3: Skill Source Providers                                       │
  │  ┌──────────────────────────────────────────────────────────┐      │
  │  │ ISkillSourceProvider { fetch(url): SkillSource }          │      │
  │  │ 内置: directory, zip, git                                │      │
  │  │ 可扩展: npm, docker-registry, S3, marketplace              │      │
  │  └──────────────────────────────────────────────────────────┘      │
  │                                                                      │
  │  EP-4: Skill Triggers (激活策略)                                     │
  │  ┌──────────────────────────────────────────────────────────┐      │
  │  │ ISkillTrigger { evaluate(message): MatchScore }          │      │
  │  │ 内置: keyword-match, embedding-similarity                │      │
  │  │ 可扩展: semantic-search, rule-engine, ML-classifier       │      │
  │  └──────────────────────────────────────────────────────────┘      │
  │                                                                      │
  │  EP-5: Skill Lifecycle Hooks                                        │
  │  ┌──────────────────────────────────────────────────────────┐      │
  │  │ onInstall / onUninstall / onActivate / onDeactivate       │      │
  │  │ onBeforeScriptExecute / onAfterScriptExecute              │      │
  │  │ 用于: 日志、监控、计费、沙箱增强                              │      │
  │  └──────────────────────────────────────────────────────────┘      │
  │                                                                      │
  └─────────────────────────────────────────────────────────────────────┘
```

### 8.2 协议版本兼容策略

```
兼容性层次：
  1. SKILL.md 格式版本字段（SCHEMA_VERSION）
     - 当前版本: "1.0"
     - 向后兼容：新版本解析器能读旧格式
     - 向前兼容：旧解析器遇到新格式时降级处理 + 警告日志

  2. 字段扩展策略
     - 新增可选字段：完全向后兼容
     - 新增必填字段：仅在 Major 版本升级时引入
     - 废弃字段：标记 @deprecated 1 个 Major 版本后移除

  3. 协议适配器模式
     interface ISkillProtocolAdapter {
       version: string;
       parse(raw: string): SkillManifest;
       serialize(manifest: SkillManifest): string;
     }
     // 可注册多个适配器以支持不同协议版本
```

### 8.3 未来扩展支持规划

| 扩展方向 | 实现方式 | 优先级 |
|---------|--------|--------|
| Skill 市场集成 | `ISkillSourceProvider` 新增 `marketplace` 类型 | P1 |
| Skills 间依赖管理 | `manifest.dependencies` + 拓扑排序加载 | P1 |
| 沙箱隔离增强 | Docker / Deno 隔离沙箱（`IScriptRuntime`） | P2 |
| 语义匹配激活 | Embedding 向量相似度匹配（`ISkillTrigger`） | P2 |
| Skills 可视化编辑器 | 前端管理界面 + API | P2 |
| Skills 遥测与使用统计 | Lifecycle Hooks + 日志聚合 | P3 |
| 多用户 Skills 隔离 | 每用户独立 SKILLS_DIR + 权限控制 | P3 |
| A2A 协议整合 | Skills 通过 Agent-to-Agent 协议共享 | P3 |

---

## 9. 附录：关键代码修改

### 9.1 agent.service.ts — System Prompt 注入点

**文件**: `backend-ts/src/modules/chat/agent.service.ts`

在 `executeAgentLoop()` 方法中，位于 `conversationContext.initialize()` 调用前的 systemPrompt 构建处：

```typescript
// 原代码（第 ~170 行附近）：
await conversationContext.initialize({
  memory: sessionSettings.memory,
  systemPrompt: sessionSettings.systemPrompt + "\n" + toolPrompts,
  // ...
});

// 改为：
const skillMetadataInjection = this.skillOrchestrator
  ? this.skillOrchestrator.getMetadataInjection()
  : '';

await conversationContext.initialize({
  memory: sessionSettings.memory,
  systemPrompt: [
    sessionSettings.systemPrompt,
    skillMetadataInjection,
    toolPrompts,
  ].filter(Boolean).join('\n'),
  // ...
});
```

构造函数新增可选注入：

```typescript
import { Optional } from '@nestjs/common';
import { SkillOrchestrator } from '../skills/core/skill-orchestrator.service';

constructor(
  private sessionRepo: SessionRepository,
  private toolOrchestrator: ToolOrchestrator,
  private llmService: LLMService,
  private sessionLockService: SessionLockService,
  private toolContextFactory: ToolContextFactory,
  private conversationContextFactory: ConversationContextFactory,
  @Optional() private skillOrchestrator?: SkillOrchestrator,  // ← 新增
) { }
```

### 9.2 app.module.ts — Skills 模块注册

**文件**: `backend-ts/src/app.module.ts`

```typescript
import { SkillsModule } from "./modules/skills/skills.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    SharedModule,
    UploadModule,
    VectorDbModule,
    McpClientModule,
    LlmCoreModule,
    ChatModule,
    ModelsModule,
    AuthModule,
    CharactersModule,
    FilesModule,
    McpServersModule,
    SettingsModule,
    UsersModule,
    ToolsModule,
    KnowledgeBaseModule,
    BotGatewayModule,
    SkillsModule,  // ← 新增
  ],
})
export class AppModule {}
```

### 9.3 tools.module.ts — 注册 SkillToolBridge

**文件**: `backend-ts/src/modules/tools/tools.module.ts`

```typescript
import { SkillsModule } from '../skills/skills.module';
import { SkillToolBridgeService } from '../skills/integration/skill-tool-bridge.service';

@Module({
  imports: [VectorDbModule, SkillsModule],  // ← 新增 SkillsModule
  providers: [
    ToolOrchestrator,
    ToolContextFactory,
    // ... 现有 Provider 保持不变
    SkillToolBridgeService,  // ← 新增
  ],
  exports: [ToolOrchestrator, ToolContextFactory],
})
export class ToolsModule {}
```

同时在 `ToolOrchestrator` 构造函数中注入 `SkillToolBridgeService` 并注册：

```typescript
constructor(
  // ... 现有 Provider
  skillToolBridge: SkillToolBridgeService,  // ← 新增
) {
  // ... 现有 addProvider 调用
  this.addProvider(skillToolBridge);  // ← 新增
}
```

### 9.4 skills.module.ts — Skills 模块定义

**文件**: `backend-ts/src/modules/skills/skills.module.ts`

```typescript
import { Module, OnModuleInit } from '@nestjs/common';
import { SkillOrchestrator } from './core/skill-orchestrator.service';
import { SkillRegistry } from './core/skill-registry.service';
import { SkillDiscoveryService } from './core/skill-discovery.service';
import { SkillLoaderService } from './core/skill-loader.service';
import { SkillVersionManager } from './core/skill-version-manager.service';
import { SkillScriptExecutor } from './execution/skill-script-executor.service';
import { SkillToolBridgeService } from './integration/skill-tool-bridge.service';
import { SkillContextInjector } from './integration/skill-context-injector.service';
import { SkillsController } from './api/skills.controller';

@Module({
  controllers: [SkillsController],
  providers: [
    SkillOrchestrator,
    SkillRegistry,
    SkillDiscoveryService,
    SkillLoaderService,
    SkillVersionManager,
    SkillScriptExecutor,
    SkillToolBridgeService,
    SkillContextInjector,
  ],
  exports: [
    SkillOrchestrator,
    SkillToolBridgeService,
  ],
})
export class SkillsModule implements OnModuleInit {
  constructor(private orchestrator: SkillOrchestrator) {}

  async onModuleInit() {
    await this.orchestrator.initialize();
  }
}
```

---

## 总结

本设计方案在深入分析现有系统架构和 Anthropic Skills 协议规范的基础上，提出了一个**全新独立的 Skills 集成框架**，核心设计决策包括：

1. **全新框架而非复用 Tool 框架**：因为 Skills 的抽象层级、加载方式、生命周期管理与现有 `IToolProvider` 模型本质不同，全新设计能带来更好的扩展性和更低的耦合度
2. **基于现有模块的集成接口**：通过 `SkillOrchestrator` 注入到 `AgentService`、通过 `SkillToolBridge`（实现 `IToolProvider`）注册到 `ToolOrchestrator`，实现最小化侵入式改造
3. **文件系统为唯一事实来源**：所有 Skills 通过本地目录扫描加载，不持久化到数据库，`.versions/versions.json` 仅为本地版本缓存
4. **三级渐进式披露**：完整实现 Anthropic 协议的 L1（metadata）→ L2（instructions）→ L3（resources/scripts）加载策略，Token 高效
5. **热插拔无停机**：install/uninstall 后自动 scan() 刷新，reload 支持单 Skill 级别重载，均无需重启 agent 服务
6. **丰富的扩展点**：预留 Loader、Runtime、SourceProvider、Trigger、Lifecycle Hooks 五大扩展点体系，支持未来协议升级和新特性添加