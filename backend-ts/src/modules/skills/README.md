# Skills 集成框架

> **版本**: 1.0  
> **状态**: 已实现核心功能

## 概述

Skills 集成框架基于 Anthropic Skills 协议，实现了文件系统驱动的渐进式知识加载系统。它允许将领域专业知识打包为可发现的、按需加载的模块，通过三级渐进披露策略优化 Token 使用效率。

## 架构特点

- **文件系统驱动**：所有 Skills 以本地目录形式存储，不依赖数据库
- **热插拔支持**：无需重启服务即可安装、卸载、重载 Skills
- **渐进式加载**：L1（元数据）→ L2（指令）→ L3（资源/脚本）
- **沙箱执行**：脚本执行受到资源和权限限制
- **版本控制**：支持语义化版本和内容哈希变更检测

## 目录结构

```
backend-ts/src/modules/skills/
├── interfaces/              # 接口定义
│   ├── skill-manifest.interface.ts
│   └── index.ts
├── core/                    # 核心服务
│   ├── skill-orchestrator.service.ts      # 中央调度器
│   ├── skill-registry.service.ts          # 内存注册表
│   ├── skill-discovery.service.ts         # 文件扫描
│   ├── skill-loader.service.ts            # SKILL.md 解析
│   └── skill-version-manager.service.ts   # 版本管理
├── execution/               # 脚本执行
│   └── skill-script-executor.service.ts
├── integration/             # 系统集成
│   └── skill-tool-bridge.service.ts       # Tool Provider 桥接
├── api/                     # REST API
│   └── skills.controller.ts
└── skills.module.ts         # NestJS 模块
```

## 快速开始

### 1. 创建新 Skill

在 `backend-ts/skills/` 目录下创建新的 Skill 目录：

```bash
mkdir skills/my-skill
```

创建 `SKILL.md` 文件：

```markdown
---
name: my-skill
description: 描述这个 Skill 的功能和使用场景
version: 1.0.0
author: Your Name
tags:
  - category1
  - category2
---

# My Skill

详细说明工作流程、最佳实践和代码示例...
```

### 2. 自动加载

启动后端服务时，Skills 框架会自动扫描 `skills/` 目录并加载所有有效的 Skill。

### 3. 查看已加载的 Skills

```bash
curl http://localhost:3000/api/v1/skills
```

### 4. 手动触发扫描

如果手动添加了 Skill 文件，可以触发重新扫描：

```bash
curl -X POST http://localhost:3000/api/v1/skills/scan
```

### 5. 热重载 Skill

修改 Skill 后，无需重启服务：

```bash
curl -X POST http://localhost:3000/api/v1/skills/my-skill/reload
```

## REST API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/v1/skills` | 列出所有 Skills |
| `GET` | `/api/v1/skills/:id` | 获取 Skill 详情 |
| `POST` | `/api/v1/skills/scan` | 触发手动扫描 |
| `POST` | `/api/v1/skills/:id/reload` | 热重载指定 Skill |

## 与 Agent 系统集成

Skills 框架通过以下方式与现有的 Agent 系统集成：

1. **System Prompt 注入**：在 `AgentService.executeAgentLoop()` 中，Skills 元数据会被自动注入到 system prompt 中
2. **工具调用桥接**：`SkillToolBridgeService` 实现了 `IToolProvider` 接口，使 Skills 可以作为工具被 LLM 调用
3. **上下文窗口管理**：Skills 元数据会纳入 Token 计数，触发压缩引擎的正常工作

## 配置

在 `.env` 文件中配置 Skills 目录路径（可选）：

```env
SKILLS_DIR=./skills
```

默认值为项目根目录下的 `skills/` 文件夹。

## 开发指南

### 添加自定义脚本

在 Skill 目录中创建 `scripts/` 子目录：

```
my-skill/
├── SKILL.md
└── scripts/
    └── process.py
```

在 SKILL.md 中引用脚本：

```markdown
## 使用方法

运行以下脚本来处理数据：

```bash
python scripts/process.py --input data.txt
```
```

### 添加工具定义（未来功能）

创建 `tools/tools.json` 文件来定义自定义工具（待实现）。

## 技术细节

### SKILL.md 格式

```yaml
---
name: skill-name              # 必填，≤64字符，小写+数字+连字符
description: >                # 必填，≤1024字符，第三人称
  描述这个 Skill 做什么以及何时使用它。
version: 1.0.0                # 可选，语义化版本
author: Author Name           # 可选
tags:                         # 可选，分类标签
  - tag1
  - tag2
dependencies:                 # 可选，依赖的其他 Skills
  - other-skill
---
```

### 加载状态

- `DISCOVERED`：仅加载元数据（L1）
- `LOADED`：已加载指令内容（L2）
- `ACTIVE`：当前会话正在使用

### 版本控制

- **一级版本**：`manifest.version` 字段（语义化版本）
- **二级哈希**：基于 SKILL.md 内容的 SHA256
- **变更记录**：存储在 `skills/.versions/versions.json`

## 示例 Skill

项目包含一个示例 Skill：`skills/example-skill/SKILL.md`，可以作为模板参考。

## 未来扩展

- [ ] 支持 ZIP/Git 安装源
- [ ] 实现完整的工具定义系统
- [ ] Embedding 语义匹配激活
- [ ] Docker 沙箱隔离
- [ ] Skills 市场集成
- [ ] 多用户隔离

## 故障排除

### Skill 未被加载

1. 检查 `SKILL.md` 格式是否正确（必须有 YAML frontmatter）
2. 验证 name 字段是否符合命名规范
3. 查看后端日志中的错误信息
4. 手动触发扫描：`POST /api/v1/skills/scan`

### 脚本执行失败

1. 确认脚本解释器已安装（python/node/bash）
2. 检查脚本路径是否正确
3. 查看执行结果的 stderr 输出
4. 验证超时设置是否合理（默认 30 秒）

## 相关文档

- [Skills 集成框架设计方案](../../docs/skills-integration-framework-design.md)
- [Anthropic Skills Protocol](https://docs.anthropic.com/skills)
