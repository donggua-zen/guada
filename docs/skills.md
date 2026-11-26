# Skills 技能框架

基于 **Anthropic Skills 协议** 设计，以文件系统为存储。技能就是一个 Markdown 文件 + 可选脚本，人人都能编写和分享。

## 架构

```
skills.module.ts
├── core/
│   ├── skill-discovery.service.ts   → 技能发现（文件系统扫描）
│   ├── skill-loader.service.ts      → 技能加载（解析 SKILL.md）
│   ├── skill-orchestrator.service.ts→ 技能编排
│   ├── skill-registry.service.ts    → 技能注册中心
│   ├── skill-watcher.service.ts     → 文件监听（热插拔）
│   ├── skill-version-manager.service.ts → 版本管理
│   └── skill-bundled.service.ts     → 内置技能管理
├── execution/
│   └── skill-script-executor.service.ts → 脚本执行器
├── integration/
│   └── skill-tool-bridge.service.ts → 技能→工具桥接
├── api/
│   └── skills.controller.ts         → REST API
└── common/
    └── skill-metadata.validator.ts  → 元数据校验
```

## 技能结构

```
backend-ts/skills/
├── my-skill/                    # 技能目录
│   ├── SKILL.md                 # 技能清单（必需）
│   ├── instructions.md          # L2 完整指令（可选）
│   └── script.sh                # 执行脚本（可选，Python/Shell/JS）
└── another-skill/
    └── ...
```

### SKILL.md 格式

技能清单文件使用 YAML front matter + Markdown 描述：

```yaml
---
name: my-skill
description: 技能的简短描述
version: 1.0.0
author: username
parameters:         # 工具参数定义（可选）
  - name: input
    type: string
    description: 输入参数
    required: true
---
这里是技能的使用说明和示例。
```

## 项目作用域（项目级技能）

技能除了全局目录，还可以放在**项目工作目录**下，只对该项目可见：

```
<项目目录>/.guada/skills/<技能名>/SKILL.md
```

### 优先级与合并

| 来源 | 目录 | 作用域 |
|---|---|---|
| system | 插件注册的文本技能 | 全局 |
| global | `SKILLS_DIR`（用户安装） | 全局 |
| agents | `~/.agents/skills` | 全局（只读） |
| workspace | `<项目>/.guada/skills` | 仅该项目 |

合并顺序 `workspace > global > system`：同 id 时**项目版本覆盖全局版本**。管理页按项目查询时，被覆盖的项带 `overridden: true`，表示「当前展示的是项目版本，全局也有一份同名技能」。

### 加载方式

项目来源不依赖「会话开始运行」：查询技能列表/文档时会显式 `ensureWorkspaceSource(项目目录)`，因此从未跑过会话的项目也能看到技能。要点：

- 来源键由**归一化路径**派生（`D:\a` 与 `d:/a/` 命中同一来源），不再用原始字符串拼接；
- 目录不存在时**不注册空来源**（chokidar 对不存在的路径会永久过滤同父目录的后续新增），直接返回空清单；
- 动态来源有 TTL（默认 3h）与容量上限（24），淘汰按「最久未续期」且只淘汰动态来源，不会误删 global/agents。

### 接口

```
GET  /skills?projectGroupId=pg-xxx
GET  /skills/:id?projectGroupId=pg-xxx
GET  /skills/:id/documentation?projectGroupId=pg-xxx
POST /skills/:id/reload?projectGroupId=pg-xxx
POST /skills/scan?projectGroupId=pg-xxx
GET  /skills/project-config?projectGroupId=pg-xxx   // 省略 projectGroupId = 全局
PUT  /skills/project-config   { projectGroupId?, skillId, disabled }
```

- 不带 `projectGroupId`：行为与历史一致（全局管理页口径）。
- 带 `projectGroupId`：服务端用 `project_groups` 解析项目目录；项目不存在返回 404（前端据此回落全局视图）。
- 单技能解析（详情/文档/重载/`skill_learn`）统一走「项目优先 → 全局注册表」，保证**列表展示的那一份就是这个操作命中的那一份**。

### 技能开关（统一为 `skills.yaml` 覆盖表）

全局与项目用**同一套格式**，只有作用域不同：

| 作用域 | 文件 | 生效范围 |
|---|---|---|
| 全局 | `<SETTINGS_DIR>/skills.yaml`（与 `account.json` / `models.json` 同目录） | 所有项目 |
| 项目 | `<项目>/.guada/skills.yaml` | 仅该项目 |

```yaml
# 技能开关
# - 键存在即覆盖上层状态；键不存在 = 继承上层
# - 全局是顶层：继承落空时默认启用
# - 项目可双向覆盖全局（false 关掉 / true 打开）
skills:
  browser-script: false      # 关掉
  weread-skills: true        # 显式启用（项目里可覆盖全局的 false）
```

生效优先级：**项目覆盖 > 全局覆盖 > 默认启用**。

| 全局状态 | 项目文件 | 页面显示 | 会话可用 |
|---|---|---|---|
| 启用 | 未覆盖 | 启用（全局） | 可用 |
| 启用 | `false` | **本项目已禁用** | 不可用 |
| 禁用 | 未覆盖 | 禁用（继承全局） | 不可用 |
| 禁用 | `true` | **本项目已启用** | **可用** |

设计要点：

- **键是技能 id**（`manifest.name.toLowerCase()`），不是 SKILL.md 路径。路径会把配置绑死到某台机器的目录布局，id 与安装位置无关。
- **覆盖表双向表达**：一个字段同时表达「开」与「关」，因此项目既能收紧也能放宽；键不存在表示继承，语义单一。
- **投影而非改写**：项目覆盖项在返回结果里被置为对应 `enabled` 并打 `projectOverride`，注册表里的全局状态不受影响。
- **读取永不抛错**：文件缺失 / YAML 损坏 / 结构不合法一律降级为「无覆盖」，按上层状态生效。配置坏了不该让技能清单整段消失。
- **热路径用 mtime + size 缓存**：`listSkills()` 在 prompt 构建热路径上同步调用，`statSync` 开销可忽略且无需 watcher。
- **空表即删文件**：不留 `skills: {}` 噪音；全局 `enabled=true` 等于默认态，同样不落盘。
- **项目覆盖与全局状态相同时不留记录**：写接口会自动删除冗余覆盖，保持文件干净。
- **学习入口同口径**：`skill_learn` 按最终生效状态判定，避免「列表看不到但技能名可学」的后门（也顺带修掉了全局禁用技能仍可按名学习的旧漏洞）。

#### 兼容旧格式

旧版是 `disabled: [...]` 列表（只能表达「关」）。解析器同时接受它，等价于 `skills: { id: false }`；写入时一律产出新格式，**首次切换即完成该文件的迁移**，不做启动期批量重写。

#### 从 `plugins.json` 迁移

更早的全局开关以 `skills.<id>` 私有字段混存在 `plugins.json`（一个分组里塞了 20+ 个带前缀的键）。启动时一次性迁移到 `skills.yaml`：

- 只搬 `false`（禁用）；`true` 是默认态，搬过去只是噪音；
- 迁移后从 `plugins.json` **逐个删除**旧键（`updateSettings` 是 `Object.assign` 删不掉键，必须用 `deleteSettingValue`）；
- `skills.yaml` 已存在时不再迁移，尊重用户手工编辑；
- 幂等：没有旧键时是 no-op。

### 已知边界

- 项目配置不随仓库共享：`.guada/**` 在 `.gitignore` 中被整体忽略，这份文件只在本机生效。项目覆盖已可双向放宽，若将来要把该文件纳入仓库共享，需重新评估「仓库能否放宽全局设置」的安全策略。
- 命令面板 `/` 的技能列表不带工作区上下文（`CommandContext` 只有 `agentId`），因此不受项目覆盖影响；但其 `parse` 阶段会走 `skill_learn`，被关闭的技能在那里仍会被拒绝。
- 项目技能的**删除**仍属项目资产：管理页可以开关，但不能卸载（避免误删项目目录内容）。

## 核心特性

### 渐进式加载 (L1 / L2)

| 阶段 | 加载内容 | 时机 | Token 成本 |
|------|----------|------|------------|
| **L1 元数据** | 名称、描述、参数定义 → 注入 System Prompt | 会话初始化 | 低 |
| **L2 完整指令** | instructions.md 完整内容 + 脚本 | Agent 决定调用该技能时 | 按需 |

这样 Agent 知道"有哪些技能可用"，但不会一次性加载所有技能的完整指令，大幅节省 Token。

### L2 契约：`skill_learn` 返回位置头 + 自管长度

L1 清单只注入名称与描述（**不含路径**）。Agent 调用 `skill_learn` 拿到 L2 正文时，正文**开头**会带一行位置头：

```
Base directory for this skill: <资源目录>
Scripts and referenced resources live under this directory.
```

位置头解决两件事：

- **技能自带脚本的落点**。带脚本的技能（如内置 `skill-creator` / `skill-installer` 的 `scripts/validate-skill.mjs`）需要知道从哪个目录执行；该目录来自技能声明的 `resourceBase`（内置技能共享 `bundled-skills/`），文件型技能则为其自身目录。
- **即使被截断也能定位**。位置头置于正文最前，因此任何预览/截断都保留它。

位置来源与退化规则（`skill-orchestrator.service.ts` 的 `skillLearn`）：

| 技能来源 | `baseDirectory` | `skillMdPath` |
|---|---|---|
| 文件型（有磁盘 SKILL.md） | 技能自身目录 | `<技能目录>/SKILL.md` |
| 插件注册型（内嵌正文） | 声明的 `resourceBase` 目录 | `null`（无磁盘文件） |
| 声明 `resourceBase.kind = "url"` | `null` | `null`，位置头输出 URL |
| 未声明且无技能目录 | `null` | `null`，位置头如实说明"未声明资源目录"（**不编造 `__plugin__/SKILL.md` 这类假路径**） |

`skill_learn` 在 `registerTool` 时声明 `exemptFromLargeResult: true`，豁免执行器的通用大结果裁剪（否则正文会被换成 2048 字符预览，技能指令等于报废）。作为交换，它自管上限：正文超过 `SKILL_LEARN_MAX_CHARS`（60000 字符）即截断，并附上续读指引——有磁盘文件时给出 `read` 的 `file_path` / `unit` / `offset` / `limit`；插件注册型无文件可读则如实说明。这与 `read` 工具"自带上限 + 续读参数"的做法一致。

### 热插拔

通过 `skill-watcher.service.ts` 监听 `backend-ts/skills/` 目录的文件变化（`fs.watch`）：

| 操作 | 行为 |
|------|------|
| **新增技能** | 自动发现并注册，即时可用 |
| **修改技能** | 重新加载，下次调用生效 |
| **删除技能** | 自动注销，Agent 不再看到 |

无需重启系统。

### Agent 原生调度

技能通过 `skill-tool-bridge.service.ts` 自动注册为 `skill__` 命名空间下的工具。Agent 在 ReAct 循环中像调用普通工具一样调用技能。

### 脚本执行

技能可关联可执行脚本（Shell / Python / Node.js），通过 `skill-script-executor.service.ts` 执行。脚本与技能目录绑定，可访问同目录下的资源文件。

### 版本管理

`skill-version-manager.service.ts` 提供：
- 版本号追踪（SKILL.md 中的 version 字段）
- 版本回退支持
- 变更历史记录

## 内置技能

框架附带一系列内置技能，涵盖编码、写作、分析等场景，位于 `backend-ts/skills/` 目录。可通过 API 查询可用技能列表。
