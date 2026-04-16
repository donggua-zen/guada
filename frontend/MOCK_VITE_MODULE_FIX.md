# Vite 环境模块加载修复

## 🐛 问题描述

切换 Mock 场景时出现错误：
```
ReferenceError: require is not defined
    at createApiServiceInstance (ApiService.ts:842:37)
```

## 🔍 问题原因

### Vite vs Webpack 的模块系统差异

**Webpack**（传统打包工具）：
- 支持 CommonJS (`require/module.exports`)
- 支持 ES Modules (`import/export`)
- 两者可以混用

**Vite**（现代构建工具）：
- **仅支持 ES Modules** (`import/export`)
- **不支持 CommonJS** (`require/module.exports`)
- 在浏览器中直接运行原生 ESM

### 错误的代码

```typescript
// ❌ 在 Vite 环境中会报错
const { getScenarioConfig } = require('./mockStreamService')
```

**为什么报错**：
- `require` 是 Node.js/CommonJS 的全局函数
- 浏览器环境没有 `require`
- Vite 在开发模式下直接在浏览器中运行代码
- 因此 `require` 未定义

## ✅ 解决方案

### 使用动态 import()

```typescript
// ✅ 正确的写法（ES Modules）
const { getScenarioConfig } = await import('./mockStreamService')
```

**优势**：
1. ✅ 符合 ES Modules 标准
2. ✅ 浏览器原生支持
3. ✅ Vite 完美支持
4. ✅ 支持代码分割和懒加载
5. ✅ 返回 Promise，可以 async/await

### 完整的修复方案

由于 `import()` 是异步的，我们需要将整个初始化流程改为异步：

#### 修改前（同步）

```typescript
// ❌ 无法在 Vite 中工作
function createApiServiceInstance() {
  const scenarioName = localStorage.getItem('VITE_MOCK_SCENARIO')
  
  if (scenarioName) {
    const { getScenarioConfig } = require('./mockStreamService')  // ❌ 错误
    defaultConfig = getScenarioConfig(scenarioName)
  }
  
  return mockService
}

export let apiService = createApiServiceInstance()
```

#### 修改后（异步）

```typescript
// ✅ 正确的异步实现
async function createApiServiceInstance() {
  const scenarioName = localStorage.getItem('VITE_MOCK_SCENARIO')
  
  if (scenarioName) {
    const { getScenarioConfig } = await import('./mockStreamService')  // ✅ 正确
    defaultConfig = getScenarioConfig(scenarioName as any)
  }
  
  return mockService
}

// 异步初始化
export let apiService: any = null
let initPromise: Promise<any> | null = null

function initializeApiService() {
  if (!initPromise) {
    initPromise = createApiServiceInstance().then((service) => {
      apiService = service
      return service
    })
  }
  return initPromise
}

// 立即开始初始化
initializeApiService()

// 重新初始化也需要是异步的
export async function reinitApiService() {
  initPromise = null
  apiService = await createApiServiceInstance()
  return apiService
}
```

## 📊 对比总结

| 特性 | require() | import() |
|------|-----------|----------|
| **模块系统** | CommonJS | ES Modules |
| **执行方式** | 同步 | 异步（返回 Promise） |
| **Vite 支持** | ❌ 不支持 | ✅ 完全支持 |
| **浏览器支持** | ❌ 不支持 | ✅ 原生支持 |
| **代码分割** | ❌ 困难 | ✅ 自动支持 |
| **类型推断** | ⚠️ 较弱 | ✅ 完整支持 |
| **Tree-shaking** | ❌ 困难 | ✅ 自动优化 |

## 🔧 相关修改

### 1. ApiService.ts

**修改点**：
- `createApiServiceInstance` 改为 `async` 函数
- 使用 `await import()` 代替 `require()`
- `apiService` 初始化为 `null`，通过异步初始化
- `reinitApiService` 改为 `async` 函数

**关键代码**：
```typescript
async function createApiServiceInstance() {
  // ...
  if (scenarioName) {
    try {
      const { getScenarioConfig } = await import('./mockStreamService')
      defaultConfig = getScenarioConfig(scenarioName as any)
    } catch (e) {
      console.warn('⚠️ [Mock] 场景配置加载失败:', e)
    }
  }
  // ...
}

export let apiService: any = null

// 异步初始化
initializeApiService()

export async function reinitApiService() {
  initPromise = null
  apiService = await createApiServiceInstance()
  return apiService
}
```

### 2. MockControlPanel.vue

**修改点**：
- 所有调用 `reinitApiService` 的地方都加上 `await`

**关键代码**：
```typescript
// 之前
reinitApiService()

// 现在
await reinitApiService()
```

## 🎯 最佳实践

### Vite 项目中的模块加载

```typescript
// ✅ 静态导入（编译时确定）
import { someFunction } from './module'

// ✅ 动态导入（运行时确定）
const module = await import('./module')
const { someFunction } = module

// ✅ 条件动态导入
if (condition) {
  const { feature } = await import('./feature-module')
  feature.init()
}

// ❌ 不要使用 require
const module = require('./module')  // 错误！
```

### 异步初始化的模式

```typescript
// 模式 1: 立即初始化
let instance: any = null
let initPromise: Promise<any> | null = null

async function getInstance() {
  if (!initPromise) {
    initPromise = createInstance()
  }
  return initPromise
}

// 模式 2: 导出 Promise
export const instancePromise = createInstance()

// 使用时
const instance = await instancePromise

// 模式 3: 同步占位 + 异步更新（当前采用）
export let instance: any = null
initializeAsync().then((inst) => {
  instance = inst
})
```

## 🧪 验证步骤

### 1. 检查控制台日志

启用 Mock 并切换场景后，应该看到：

```
🎭 开发环境：使用 Mock API Service { enableThinking: false, ... }
```

**不应该看到**：
```
❌ ReferenceError: require is not defined
```

### 2. 测试场景切换

1. 打开 Mock 控制面板
2. 选择不同的场景
3. 点击"应用并刷新"
4. 刷新页面
5. 发送消息，验证 Mock 生效

### 3. 验证类型安全

```typescript
// TypeScript 应该能正确推断类型
const { getScenarioConfig } = await import('./mockStreamService')
// getScenarioConfig 的类型应该是: (name: keyof typeof MOCK_SCENARIOS) => MockConfig
```

## 📝 技术背景

### ES Modules vs CommonJS

**CommonJS**（Node.js 传统模块系统）：
```javascript
// 导出
module.exports = { foo: 'bar' }

// 导入
const { foo } = require('./module')
```

**ES Modules**（现代标准）：
```javascript
// 导出
export const foo = 'bar'

// 静态导入
import { foo } from './module'

// 动态导入
const module = await import('./module')
```

### Vite 为什么选择 ES Modules

1. **浏览器原生支持**：现代浏览器都支持 `<script type="module">`
2. **更快的开发体验**：无需打包，直接加载模块
3. **更好的 Tree-shaking**：静态分析更准确
4. **标准化**：ECMAScript 官方标准

## 🚀 性能影响

### 动态 import 的性能

**优点**：
- ✅ 按需加载，减少初始包体积
- ✅ 代码分割，提升加载速度
- ✅ 浏览器缓存友好

**缺点**：
- ⚠️ 首次加载有轻微延迟（通常 < 10ms）
- ⚠️ 需要处理异步逻辑

**对于 Mock 服务**：
- 仅在开发环境使用
- 初始化只执行一次
- 性能影响可忽略不计

## 📚 相关文档

- [Vite 官方文档 - 依赖预构建](https://cn.vitejs.dev/guide/dep-pre-bundling.html)
- [MDN - import()](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Operators/import)
- [ES Modules 规范](https://tc39.es/ecma262/#sec-modules)

---

**修复日期**: 2026-04-16  
**问题类型**: 模块系统兼容性  
**影响范围**: Mock 场景切换功能  
**解决方案**: 使用动态 import() 代替 require()
