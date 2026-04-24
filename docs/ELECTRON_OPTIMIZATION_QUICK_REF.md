# Electron 打包优化 - 快速参考

## 一键构建

```bash
npm run build:electron
```

这会自动执行所有优化步骤。

## 常用命令

### 依赖管理
```bash
# 优化依赖（只安装生产依赖）
npm run optimize:electron-deps

# 对比体积
npm run compare:deps-size

# 重建原生模块
npm run rebuild:backend-native:electron
```

### 开发环境
```bash
# 开发模式（使用 node_modules_electron）
npm run dev:electron
```

## 目录结构

```
backend-ts/
├── node_modules/              # Web 开发用（不使用）
├── node_modules_electron/     # Electron 开发用
│   └── node_modules/
└── node_modules_production/   # Electron 生产用（.gitignore）
    ├── node_modules/          # 只包含生产依赖
    ├── prisma/
    └── package.json
```

## 配置要点

### package.json - extraResources
```json
{
  "extraResources": [
    {
      "from": "backend-ts/node_modules_production",
      "to": "backend-ts/node_modules"
    }
  ]
}
```

### electron/main.ts - 环境变量
```typescript
NODE_MODULES_PATH: path.join(backendPath, 'node_modules')
```

## 优化效果

| 指标 | 优化前 | 优化后 | 减少 |
|------|--------|--------|------|
| 体积 | 757 MB | 512 MB | 32.5% |
| 文件数 | 39,284 | 11,988 | 69.5% |

## 注意事项

1. **更新依赖后**: 重新运行 `npm run optimize:electron-deps`
2. **Prisma schema 变更**: 优化脚本会自动重新生成客户端
3. **原生模块**: 优化后必须运行 `npm run rebuild:backend-native:electron`
4. **不要提交**: `node_modules_production/` 已在 .gitignore 中

## 故障排查

### Q: Prisma 客户端生成失败？
A: 确保 `@prisma/client` 在 dependencies 中，然后重新运行优化脚本。

### Q: 原生模块加载失败？
A: 运行 `npm run rebuild:backend-native:electron` 重新编译。

### Q: 打包后应用启动失败？
A: 检查 `electron/main.ts` 中是否设置了 `NODE_MODULES_PATH`。

### Q: 体积没有明显减少？
A: 运行 `npm run compare:deps-size` 查看具体差异，可能某些依赖本身就是大型库。

## 相关文件

- 详细文档: `docs/electron-package-optimization.md`
- 优化报告: `docs/ELECTRON_PACKAGE_OPTIMIZATION_REPORT.md`
- 优化脚本: `scripts/optimize-electron-deps.js`
- 对比工具: `scripts/compare-node-modules-size.js`
