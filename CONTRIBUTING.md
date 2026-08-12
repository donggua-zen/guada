# 贡献指南

感谢你对 GuaDa AI 项目的关注！本文档将帮助你快速参与项目贡献。

无论是修复 Bug、新增功能、完善文档，还是提交插件，每一份贡献都让这个项目变得更好。

---

## 目录

- [行为准则](#行为准则)
- [环境准备](#环境准备)
- [获取源码](#获取源码)
- [项目结构](#项目结构)
- [开发工作流](#开发工作流)
- [代码规范](#代码规范)
- [提交规范](#提交规范)
- [数据库变更](#数据库变更)
- [插件开发](#插件开发)
- [测试](#测试)
- [构建与打包](#构建与打包)
- [提交 Pull Request](#提交-pull-request)
- [报告 Bug 与功能建议](#报告-bug-与功能建议)

---

## 行为准则

请保持友善和尊重。我们欢迎所有背景的贡献者，不接受任何形式的骚扰、歧视或人身攻击。讨论聚焦技术和方案本身，对事不对人。

---

## 环境准备

### 必要环境

| 工具 | 最低版本 | 说明 |
|------|---------|------|
| **Node.js** | 20+ | 推荐使用 LTS 版本 |
| **npm** | 10+ | 随 Node 安装，注意 [npm v11 注意事项](#npm-v11-注意事项) |
| **Git** | 2.30+ | |
| **Go** | 1.23+ | 仅在修改 `plugins/remote-ssh/agent/` 时需要 |

### 推荐工具

- **VS Code** — 项目内置 `.vscode/` 配置
- **Electron Rebuild** — 原生模块编译需要 Visual Studio Build Tools（Windows）

### npm v11 注意事项

npm v11+ 默认 `omit=dev`，即 **devDependencies 不会被安装**。如果 `npm install` 后发现 `vite`、`cross-env`、`ts-node-dev` 等工具缺失，请执行：

```bash
npm install --include=dev
```

或全局配置：

```bash
npm config set include dev
```

项目 `.npmrc` 已配置淘宝镜像源，加速依赖下载。

---

## 获取源码

项目同时在 Gitee、GitHub、GitCode 三个平台维护镜像：

```bash
# Gitee（主仓库）
git clone https://gitee.com/zhendongdong/guada_ai.git

# GitHub
git clone https://github.com/donggua-zen/guada.git

# GitCode
git clone https://gitcode.com/donggua_sherlock/GuaDaAI.git
```

克隆后进入项目目录：

```bash
cd guada_ai
```

### 安装依赖

根目录执行（会自动安装 backend-ts 和 frontend 的依赖）：

```bash
npm install
```

或分别安装：

```bash
cd backend-ts && npm install && cd ../frontend && npm install
```

---

## 项目结构

```
guada_ai/
├── backend-ts/              # NestJS 11 后端（TypeScript）
│   ├── prisma/schema.prisma # 数据库 Schema
│   ├── src/
│   │   ├── common/          # 基础设施（数据库、向量库、MCP、日志）
│   │   └── modules/         # 业务模块（chat / plugins / knowledge-base / ...）
│   └── test/                # Jest 测试
├── frontend/                # Vue 3 前端（Vite + Pinia + Element Plus + Tailwind 4）
├── electron/                # Electron 41 桌面端（内嵌 Chromium 浏览器自动化）
├── sandbox/                 # 沙箱进程（Windows/Linux）
├── plugins/                 # 外部插件目录（开发模式）
│   ├── hello-plugin/        # 示例插件
│   └── remote-ssh/           # 远程 SSH 插件（Go Agent + WebSocket）
├── docs/                    # 架构文档
├── scripts/                 # 构建/打包脚本
├── docker-compose.yml       # Docker 一键部署
└── package.json             # 根 package.json（Electron 构建 + 代理安装）
```

### 技术栈速览

| 层 | 技术 |
|----|------|
| 后端 | NestJS 11, TypeScript 6, Prisma 7, SQLite + sqlite-vec + FTS5 |
| 前端 | Vue 3, Vite 7, Pinia, Element Plus, Tailwind CSS 4, vue-i18n 9 |
| 桌面 | Electron 41, TypeScript |
| 测试 | Jest（后端） |
| 部署 | Docker Compose, electron-builder |

---

## 开发工作流

### 方式一：Web 开发（前后端分离）

需要两个终端：

```bash
# 终端 1：启动后端
cd backend-ts
npm install
npm run db:seed:force    # 仅首次需要初始化数据库
npm run start:dev

# 终端 2：启动前端
cd frontend
npm install
npm run dev
```

前端访问 `http://localhost:5173`，后端监听 `http://localhost:3000`。

### 方式二：Electron 桌面端开发

```bash
# 根目录执行
npm run dev:electron
```

此命令会编译 Electron TypeScript、启动前端 Dev Server、并在就绪后启动 Electron。

### 方式三：Docker 开发

```bash
docker compose up -d --build
# 访问 http://localhost:8787
```

---

## 代码规范

### TypeScript

项目使用 TypeScript 严格模式，但没有配置 ESLint 或 Prettier。类型检查是主要的质量门禁：

```bash
# 后端类型检查
cd backend-ts && npx tsc --noEmit

# 前端类型检查
cd frontend && npx vue-tsc --noEmit
```

**提交前请确保以上两条命令零错误。**

### 编码约定

- **命名**：后端使用 PascalCase 类名 + camelCase 方法名；前端 Vue 组件使用 PascalCase，组合式函数使用 `use` 前缀（如 `useTheme`、`useStreamResponse`）
- **类型**：定义完整的 TypeScript 类型，避免使用 `as any`。仅在不可避免或临时变量时使用
- **注释**：只在复杂逻辑处添加注释，解释 *为什么* 而非 *做什么*。不修改与本次变更无关的注释
- **国际化**：用户可见的文案需使用 vue-i18n。后端工具描述用英文（供 LLM 消费），插件 manifest 的 name/description 用中文（供 UI 展示）
- **样式**：前端优先使用 Tailwind utility class 和 CSS 变量（`var(--color-*)`）。视觉修复优先用 `:deep()` CSS 覆盖，避免修改 DOM 结构
- **资源路径**：静态图片放 `frontend/public/images/`，使用 `fixFrontendAssetUrl()` 确保 Electron/Web 兼容

### 文件组织

- 后端模块放在 `backend-ts/src/modules/<module-name>/`，每个模块包含 controller、service、module 文件
- 前端组件按功能域组织：`frontend/src/components/<domain>/`
- 测试文件与源文件同目录，命名为 `*.spec.ts`

---

## 提交规范

### Commit Message

使用**简明中文**描述变更，格式：

```
<简短描述>（不超过 50 字）
```

如需补充说明，空一行后写详细描述。示例：

```
修复流式响应结束判断逻辑

turn_end 事件在 do-while 循环退出后只应 yield 一次，
之前在 catch 块中重复触发导致前端收到两次 finish。
```

### 分支命名

```
feature/<简短描述>     # 新功能
fix/<简短描述>         # Bug 修复
docs/<简短描述>        # 文档
plugin/<插件名>        # 插件
refactor/<简短描述>    # 重构
```

---

## 数据库变更

项目使用自建的 MigrationRunner（非 Prisma Migrate），详见 [数据库迁移文档](docs/DATABASE_MIGRATION.md)。

修改 Schema 的流程：

1. 编辑 `backend-ts/prisma/schema.prisma`
2. 生成迁移：

   ```bash
   cd backend-ts
   npm run db:migrate:gen -- --name <迁移名称>
   ```

   此命令会同时生成增量迁移文件（供升级用户）和重新生成 `baseline.sql`（供全新安装）。

3. 如涉及种子数据，更新 `src/common/database/migrations/seed-data.ts`
4. 在 `migrations/index.ts` 中注册新迁移
5. 重启后端，MigrationRunner 自动执行待迁移项

**不要使用 `prisma db push`** — 该命令是开发专用、不可逆、可能静默丢弃列。

---

## 插件开发

GuaDa 的核心功能全部插件化。外部插件放在 `plugins/` 目录，开发模式下通过 ts-node 直接加载 `.ts` 文件。

### 创建插件

参考 `plugins/hello-plugin/`：

```
plugins/my-plugin/
├── manifest.json          # 插件清单（id/name/version/icon/main）
├── index.ts               # 入口文件
├── package.json           # 依赖声明
└── tsconfig.json          # TypeScript 配置
```

`manifest.json` 示例：

```json
{
  "id": "my-plugin",
  "name": "我的插件",
  "version": "1.0.0",
  "description": "插件描述",
  "author": "your-name",
  "category": "user",
  "main": "index.ts"
}
```

`index.ts` 示例：

```typescript
import { PluginBase, type PluginApi } from "../../backend-ts/src/modules/plugins";
import { z } from "zod";

export default class MyPlugin extends PluginBase {
  async onLoad(api: PluginApi) {
    api.registerTool({
      name: "my_tool",
      description: "Tool description in English for LLM consumption.",
      inputSchema: z.object({
        param: z.string().describe("Parameter description"),
      }),
      execute: async (args) => {
        return `Result: ${args.param}`;
      },
      display: { actionType: "my_action", icon: "tool" },
    });
  }
}
```

### 插件 API 要点

- `api.registerTool()` — 注册工具（LLM 可调用）
- `api.registerPrompt()` — 注入提示词
- `api.registerInterceptor()` — 注册回合拦截器
- `api.registerNls()` — 注册本地化语言包
- 工具描述、错误信息、返回值用**英文**（供 LLM 消费）
- manifest 的 name/description 用**中文**（供 UI 展示）
- 工具文案使用 `%key%` 引用语言包，详见 NLS 系统

### 插件加载路径

| 路径 | 用途 |
|------|------|
| `plugins/`（项目根） | 开发模式，直接加载 `.ts` |
| `~/.guada/plugins/` | 用户安装目录，需编译为 `.js` |

---

## 测试

### 后端测试

```bash
cd backend-ts

# 运行所有测试
npm test

# 监听模式
npm run test:watch

# 覆盖率报告
npm run test:coverage
```

测试使用 Jest + ts-jest，测试文件与源文件同目录，命名为 `*.spec.ts`。

### 前端

前端暂无自动化测试。请确保 `vue-tsc --noEmit` 通过。

### 测试要求

- 新功能需附带测试
- Bug 修复需包含复现测试
- 测试应覆盖 API 入口路径（Controller → Service → DTO 验证），不仅限于隔离的单元测试
- 至少包含一个正常路径和一个拒绝路径

---

## 构建与打包

### Web 构建

```bash
# 后端
cd backend-ts && npm run build

# 前端
cd frontend && npm run build
```

### Electron 打包

```bash
# 根目录执行
npm run build:electron
```

输出在 `release/` 目录。Windows 打包可能需要 Visual Studio Build Tools。

### Docker 构建

```bash
docker compose up -d --build
```

---

## 提交 Pull Request

### 流程

1. **Fork** 仓库到你自己的账号
2. 从 `main` 分支创建特性分支：`git checkout -b feature/your-feature`
3. 编码、测试、确保类型检查通过
4. 提交变更，遵循 [提交规范](#提交规范)
5. 推送到你的 Fork：`git push origin feature/your-feature`
6. 在 Gitee / GitHub 上发起 Pull Request，目标分支为 `main`

### PR 标题

简明描述变更内容，中文。

### PR 检查清单

提交前请逐项确认：

- [ ] `tsc --noEmit`（后端）零错误
- [ ] `vue-tsc --noEmit`（前端）零错误
- [ ] `npm test`（后端）通过
- [ ] 新功能附带测试
- [ ] Bug 修复包含复现测试
- [ ] 如涉及数据库 Schema 变更，已通过 MigrationRunner 生成迁移
- [ ] 如涉及用户可见文案，已添加 vue-i18n 国际化翻译
- [ ] 不包含密钥、Token 等敏感信息
- [ ] 不包含与本次变更无关的改动

### Review

维护者会在收到 PR 后尽快进行 Review。如需修改，请在原分支上提交新 commit 并推送，PR 会自动更新。

---

## 报告 Bug 与功能建议

### 报告 Bug

请到 [Gitee Issues](https://gitee.com/zhendongdong/guada_ai/issues) 提交，包含以下信息：

1. **环境信息**：操作系统、GuaDa 版本（Web / Electron / Docker）
2. **复现步骤**：能重现问题的最小操作序列
3. **预期行为**：你期望发生什么
4. **实际行为**：实际发生了什么（附截图或日志）

### 功能建议

同样通过 Issue 提交，请描述：

1. **使用场景**：你在什么情况下需要这个功能
2. **期望方案**：你希望它怎么工作
3. **替代方案**：你考虑过的其他方式

---

## 沟通渠道

| 渠道 | 地址 |
|------|------|
| QQ 群 | 1047993501 |
| 公众号 | 冬瓜编程实验室 |
| Issue | [Gitee Issues](https://gitee.com/zhendongdong/guada_ai/issues) |

---

## 许可证

贡献的代码将遵循 [MIT License](LICENSE) 开源。提交 PR 即表示你同意将代码以 MIT 协议贡献给本项目。

---

<p align="center">
  感谢你的贡献！每一位贡献者都让 GuaDa 变得更好 🎉
</p>
