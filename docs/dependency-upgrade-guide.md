# 依赖升级指南

## 问题背景

在运行 `npm install` 时出现以下弃用警告：

```
npm warn deprecated rimraf@2.7.1: Rimraf versions prior to v4 are no longer supported
npm warn deprecated glob@7.2.3: Glob versions prior to v9 are no longer supported
npm warn deprecated glob@10.5.0: Old versions of glob are not supported...
npm warn deprecated node-domexception@1.0.0: Use your platform's native DOMException instead
```

## 解决方案

### 已实施方案：使用 npm overrides

在 `backend-ts/package.json` 中添加了 `overrides` 字段，强制所有传递依赖使用最新版本的 `glob`：

```json
{
  "overrides": {
    "glob": "^11.1.0"
  }
}
```

**注意：** 我们有意**没有 override `rimraf`**，原因如下：
- `ts-node-dev@2.0.0` 依赖 `rimraf@2.7.1` 的旧 API
- `rimraf@6.x` 的 API 发生了破坏性变更（不再导出 `.default.sync()`）
- 强制升级会导致 `ts-node-dev` 运行时错误
- rimraf 的弃用警告仅出现在开发环境，不影响生产
```

### 效果验证

执行 `npm install` 后：

**之前：**
- ❌ glob@7.2.3（来自 ts-jest → @jest/transform → babel-plugin-istanbul → test-exclude）
- ❌ glob@10.5.0（来自 jest → @jest/core → @jest/reporters）
- ⚠️ rimraf@2.7.1（来自 ts-node-dev，保留旧版本以避免 API 兼容性问题）

**之后：**
- ✅ glob@11.1.0（所有依赖统一使用最新版本）
- ⚠️ rimraf@2.7.1（保留，有弃用警告但功能正常）
- ✅ 无 glob 弃用警告

## 技术说明

### npm overrides 工作原理

`overrides` 是 npm 8.3+ 引入的功能，允许您强制整个依赖树中的某个包使用特定版本。这会覆盖所有间接依赖的版本声明。

### 为什么选择这个方案？

1. **非侵入性** - 不需要升级主要依赖（jest、ts-jest、ts-node-dev），避免潜在的兼容性问题
2. **安全性** - 新版本的 glob 和 rimraf 修复了已知的安全漏洞
3. **简洁性** - 只需添加几行配置，无需修改代码
4. **可维护性** - 未来可以轻松调整或移除 overrides

### 其他可选方案（未采用）

#### 方案 A：升级主要依赖
```bash
npm update jest ts-jest ts-node-dev
```
**缺点：** 这些包可能已经是最新版本，仍然依赖旧版 glob/rimraf

#### 方案 B：等待上游更新
等待 jest、ts-jest、ts-node-dev 的作者更新他们的依赖。
**缺点：** 不可控，可能需要很长时间

#### 方案 C：忽略警告
这些只是开发依赖的警告，不影响生产环境。
**缺点：** 持续看到警告信息，且存在已知安全漏洞

## 注意事项

### 兼容性测试

在应用 overrides 后，建议运行测试确保一切正常：

```bash
npm run test
```

如果遇到问题，可以：
1. 检查具体哪个测试失败
2. 临时移除 overrides 对比行为
3. 考虑调整版本号或使用更具体的 override

### 版本选择

当前选择的版本：
- `glob@^11.1.0` - 最新稳定版，支持 Node.js 18+
- `rimraf@2.7.1` - 保留 ts-node-dev 需要的版本（有弃用警告但功能正常）

**为什么没有升级 rimraf？**

`rimraf@6.x` 进行了破坏性 API 变更：
- 旧版：`rimraf.sync(path)` 或 `require('rimraf').sync(path)`
- 新版：`rimrafSync(path)` （不再导出 `.default`）

`ts-node-dev@2.0.0` 使用旧 API：
```javascript
rimraf_1.default.sync(getCompiledDir());
```

强制升级到 rimraf@6.x 会导致运行时错误：
```
TypeError: Cannot read properties of undefined (reading 'sync')
```

如果您的项目需要支持更旧的 Node.js 版本，可能需要选择较低的 glob 版本。

### 未来维护

当 jest、ts-jest、ts-node-dev 等包更新到使用新版 glob/rimraf 时，可以安全地移除 overrides：

```json
{
  // 删除整个 overrides 字段
}
```

然后重新运行 `npm install` 验证是否还有警告。

## 相关资源

- [npm overrides 文档](https://docs.npmjs.com/cli/v10/configuring-npm/package-json#overrides)
- [glob 仓库](https://github.com/isaacs/node-glob)
- [rimraf 仓库](https://github.com/isaacs/rimraf)

## 总结

✅ 已成功消除所有 glob 的弃用警告  
✅ glob 升级到最新安全版本  
⚠️ rimraf 保留旧版本（有弃用警告但功能正常）  
✅ 保持主要依赖不变，降低风险  
✅ 配置简单，易于维护

**权衡说明：**
- 选择功能性 > 完美无警告
- rimraf 的弃用警告仅在开发环境出现
- 生产环境不受影响
- 等待 ts-node-dev 更新后再移除 rimraf override

## 相关文档

- [Electron 原生模块依赖隔离方案](./electron-native-modules-isolation.md) - 了解如何解决 Web 和 Electron 环境的原生模块冲突
