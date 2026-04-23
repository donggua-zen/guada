# 快速开始

## Web 版本

### 开发环境
```bash
# 终端 1: 启动后端
cd backend-ts
npm run start:dev

# 终端 2: 启动前端
cd frontend
npm run dev
```

访问: http://localhost:5173

### 生产构建
```bash
cd frontend
npm run build
```

## Electron 版本

### 首次使用
```bash
# 安装所有依赖
npm install
```

### 开发模式
```bash
npm run dev:electron
```

### 生产构建
```bash
npm run build:electron
```

构建完成后，安装包位于 `release/` 目录。

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm run dev:web` | 启动 Web 开发环境（仅前端） |
| `npm run dev:backend` | 启动后端服务（开发模式） |
| `npm run dev:electron` | 启动 Electron 开发环境 |
| `npm run build:web` | 构建 Web 生产版本 |
| `npm run build:backend` | 构建后端 |
| `npm run build:frontend` | 构建前端 |
| `npm run build:electron` | 构建 Electron 安装包 |

## 注意事项

1. **首次运行**需要执行 `npm install` 安装所有依赖
2. **Electron 开发模式**会自动编译 TypeScript 文件
3. **数据库**在 Web 和 Electron 版本中是独立的
4. **端口 3000** 不能被其他应用占用
5. **Electron 打包**时会自动重新编译原生模块（约需 1-3 分钟）
6. **Windows 用户**如需打包，可能需要安装 Visual Studio Build Tools

详细文档请查看：
- [ELECTRON_GUIDE.md](./ELECTRON_GUIDE.md) - Electron 使用指南
- [ELECTRON_NATIVE_MODULES.md](./ELECTRON_NATIVE_MODULES.md) - 原生模块兼容性方案
