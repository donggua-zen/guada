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
