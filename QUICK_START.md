# 快速开始

## Web 版本

### 开发环境
```bash
# 终端 1: 启动后端
cd backend-ts
pnpm install             # 自动执行 prisma generate
pnpm run db:seed:force    # 首次运行需要初始化数据库
pnpm run start:dev

# 终端 2: 启动前端
cd frontend
pnpm install
pnpm run dev
```

访问: http://localhost:5173

### 生产构建
```bash
# 后端
cd backend-ts
pnpm run build

# 前端
cd frontend
pnpm run build
```

**注意**: 生产环境需要配置 Nginx 反向代理，详见 [生产环境部署文档](docs/PRODUCTION_DEPLOYMENT.md)

## Electron 版本

### 首次使用
```bash
# 安装所有依赖
pnpm install
```

### 开发模式
```bash
pnpm run dev:electron
```

### 开发模式与数据隔离（自举开发）

应用支持三种运行模式，数据目录与单实例锁（userData）互不冲突，可实现"用项目开发自己"：

| 模式 | 命令 | 数据目录 | 热重载 | 端口 | 用途 |
|------|------|----------|--------|------|------|
| dev | `pnpm run dev:electron` | `~/.guada-dev` | ✅ 后端 ts-node-dev + 前端 Vite HMR | 3000 / 5173 | 日常开发，与正式数据解耦 |
| prod-debug | `pnpm run dev:prod-debug` | `~/.guada`（正式数据） | ❌ 后端 ts-node + 静态前端 | 随机（自动分配） | 生产调试/自举开发：改代码不重启，与真实生产一致（不打包） |
| 打包版 | 安装后运行 | `~/.guada`（正式数据） | ❌ | 随机 | 正式使用 |

> **并行规则**：dev 与 prod-debug 可同时运行（数据、userData、端口全隔离）；dev 与打包版可同时运行；**prod-debug 与打包版不可同时运行**（共享 `~/.guada`，SQLite 并发写会锁冲突）。

**dev 模式数据（可选一次性）**：全新环境自动创建种子数据，开箱即用。若想继承已配置的模型/插件/技能/会话，先关闭正式实例，再手动复制一次：

```bat
robocopy "%USERPROFILE%\.guada" "%USERPROFILE%\.guada-dev" /E /XD logs
```

**自举开发工作流**：
1. `pnpm run dev:prod-debug` 启动生产调试实例（正式数据、无热重载）
2. 在 prod-debug 中创建会话，工作目录设为项目根目录（如 `D:\AI\ai_chat`）
3. 让 AI 修改自身源码 —— 无热重载，改动不会重启当前实例
4. `pnpm run dev:electron` 并行启动热重载实例，实时查看改动效果
5. 改完手动重启 prod-debug（Ctrl+C → 重新运行），会话记录保存在正式 DB 中不丢失

### 生产构建
```bash
pnpm run build:electron
```

构建完成后，安装包位于 `release/` 目录。

详细的 Electron 部署指南请查看：[Electron 部署文档](docs/ELECTRON_DEPLOYMENT.md)

## 常用命令

| 命令 | 说明 |
|------|------|
| `pnpm run dev:web` | 启动 Web 开发环境（仅前端） |
| `pnpm run dev:backend` | 启动后端服务（开发模式） |
| `pnpm run dev:electron` | 启动 Electron 开发环境（数据隔离到 ~/.guada-dev） |
| `pnpm run dev:prod-debug` | 生产调试模式（无热重载、静态前端、正式数据、随机端口） |
| `pnpm run build:web` | 构建 Web 生产版本 |
| `pnpm run build:backend` | 构建后端 |
| `pnpm run build:frontend` | 构建前端 |
| `pnpm run build:electron` | 构建 Electron 安装包 |

## 注意事项

1. **首次运行**需要执行 `pnpm install` 安装所有依赖
2. **Electron 开发模式**会自动编译 TypeScript 文件
3. **数据库**在 Web 和 Electron 版本中是独立的
4. **端口 3000（dev）** 不能被其他应用占用（prod-debug 使用随机端口，自动避开）
5. **Electron 打包**时会自动重新编译原生模块（约需 1-3 分钟）
6. **Windows 用户**如需打包，可能需要安装 Visual Studio Build Tools

详细文档请查看：
- [ELECTRON_GUIDE.md](./ELECTRON_GUIDE.md) - Electron 使用指南
- [ELECTRON_NATIVE_MODULES.md](./ELECTRON_NATIVE_MODULES.md) - 原生模块兼容性方案
