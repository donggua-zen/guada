# Electron 依赖隔离 - 快速参考

## 🚀 快速开始

### 首次设置（仅需一次）
```bash
npm run install:electron-deps        # 安装 Electron 依赖
npm run rebuild:backend-native:electron  # 编译原生模块
npm run verify:electron-setup        # 验证设置
```

### 日常开发
```bash
npm run dev:backend      # Web 开发模式
npm run dev:electron     # Electron 开发模式
```

### 生产构建
```bash
npm run build:electron   # 一键构建安装包
```

## 📁 目录结构

```
backend-ts/
├── node_modules/              # Web 用（系统 Node.js）
│   └── @prisma/client/        # Prisma Client（系统 Node.js）
└── node_modules_electron/     # Electron 用
    ├── package.json           # 复制的配置文件
    ├── prisma/
    │   └── schema.prisma      # 复制的 Prisma schema
    ├── prisma.config.ts       # 复制的 Prisma 配置
    └── node_modules/          # Electron 依赖
        ├── @prisma/client/    # Prisma Client（Electron Node.js）
        ├── better-sqlite3/
        │   └── build/Release/better_sqlite3.node
        └── sqlite-vec-windows-x64/
            └── vec0.dll
```

## 🔧 常用命令

| 命令 | 说明 |
|------|------|
| `npm run install:electron-deps` | 安装 Electron 依赖 |
| `npm run rebuild:backend-native:electron` | 重新编译原生模块 |
| `npm run verify:electron-setup` | 验证设置是否正确 |
| `npm run dev:backend` | 启动 Web 后端 |
| `npm run dev:electron` | 启动 Electron 应用 |
| `npm run build:electron` | 构建 Electron 安装包 |

## ⚠️ 常见问题

### Q: 运行 `npm run install:electron-deps` 报错？
**A:** 确保在根目录运行，脚本会自动处理所有步骤。

### Q: 原生模块编译失败？
**A:** 
1. 确保已安装 Visual Studio with C++ workload
2. 确保已安装 VSSetup PowerShell 模块
3. 运行 `npm run rebuild:backend-native:electron`

### Q: 如何验证设置是否正确？
**A:** 运行 `npm run verify:electron-setup`，所有检查应显示 ✅ PASS

### Q: 可以同时运行 Web 和 Electron 开发吗？
**A:** 可以！两者使用不同的 node_modules，互不干扰。

### Q: 更新依赖后需要做什么？
**A:** 
```bash
cd backend-ts && npm install           # 更新 Web 依赖
npm run install:electron-deps          # 同步 Electron 依赖
npm run rebuild:backend-native:electron  # 重新编译
```

## 🎯 核心原理

- **源码共享**: `backend-ts/src/` 唯一
- **依赖隔离**: 两套 node_modules 互不影响
- **动态切换**: 通过 `NODE_MODULES_PATH` 环境变量
- **自动编译**: 构建时自动为 Electron 重新编译原生模块

## 📚 详细文档

- [完整实施指南](./electron-native-modules-isolation.md)
- [问题解决总结](./electron-dependency-isolation-summary.md)
- [依赖升级指南](./dependency-upgrade-guide.md)
