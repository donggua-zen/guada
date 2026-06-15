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
