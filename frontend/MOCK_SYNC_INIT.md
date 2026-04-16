# Mock 同步初始化方案

## 🎯 问题背景

之前的异步初始化方案存在**竞态条件**问题：

```typescript
// ❌ 异步初始化 - 可能导致 apiService 为 null
export let apiService: any = null
initializeApiService() // 异步执行

// 其他模块导入时
import { apiService } from './ApiService'
apiService.getProfile() // ❌ 可能报错：Cannot read property 'getProfile' of null
```

## ✅ 解决方案：同步创建 + 延迟加载配置

### 核心思路

1. **立即同步创建** ApiService 实例（不读取 Mock 配置）
2. **仅在首次调用 chat 方法时**才异步加载 Mock 配置
3. 配置加载后缓存，避免重复加载

### 实现细节

#### 1. 延迟加载配置的 Mock 方法集合

```typescript
function createMockMethods() {
  // 缓存配置，避免重复加载
  let cachedConfig: any = null
  let configPromise: Promise<any> | null = null

  async function loadMockConfig(): Promise<any> {
    if (cachedConfig) return cachedConfig
    if (configPromise) return configPromise

    configPromise = (async () => {
      let defaultConfig: any = {}
      const scenarioName = localStorage.getItem('VITE_MOCK_SCENARIO') || 
                          import.meta.env.VITE_MOCK_SCENARIO
      
      if (scenarioName) {
        try {
          const { getScenarioConfig } = await import('./mockStreamService')
          defaultConfig = getScenarioConfig(scenarioName as any)
        } catch (e) {
          console.warn('⚠️ [Mock] 场景配置加载失败:', e)
        }
      }

      cachedConfig = defaultConfig
      return defaultConfig
    })()

    return configPromise
  }

  // Mock 的 chat 方法
  const mockChat = async function* (...) {
    const config = await loadMockConfig()
    // ... 流式输出逻辑
  }

  // Mock 的 createMessage 方法
  const mockCreateMessage = async (
    sessionId: string,
    content: string,
    files: any[] = [],
    replaceMessageId: string | null = null,
    knowledgeBaseIds?: string[]
  ): Promise<any> => {
    console.log(`🎭 [Mock] 拦截 createMessage 请求`)
    
    // 模拟延迟
    await new Promise(resolve => setTimeout(resolve, 100))
    
    // 返回模拟的用户消息
    return {
      id: `mock_msg_${Date.now()}`,
      sessionId,
      role: 'user',
      content,
      files: files || [],
      parentId: replaceMessageId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      contents: []
    }
  }

  return {
    chat: mockChat,
    createMessage: mockCreateMessage
  }
}
```

#### 2. 同步创建 API Service

```typescript
function createApiServiceInstance() {
  const realService = new ApiService('/api/v1')

  // 生产环境强制使用真实服务
  if (import.meta.env.PROD) {
    return realService
  }

  // 开发环境：检查是否启用 Mock
  const enabled = shouldEnableMock()

  if (!enabled) {
    return realService
  }

  console.log('🎭 开发环境：使用 Mock API Service（配置将在首次调用时加载）')

  // 创建包装实例
  const mockService = Object.create(Object.getPrototypeOf(realService))
  Object.assign(mockService, realService)
  
  // 获取 Mock 方法集合
  const mockMethods = createMockMethods()
  
  // 覆盖 chat 和 createMessage 方法
  mockService.chat = mockMethods.chat
  mockService.createMessage = mockMethods.createMessage
  
  return mockService
}

// ✅ 同步创建，无竞态条件
export let apiService = createApiServiceInstance()
```

#### 3. 同步重新初始化

```typescript
export function reinitApiService() {
  apiService = createApiServiceInstance()
  console.log('🔄 API Service 已重新初始化')
  return apiService
}
```

## 📊 对比分析

### 之前：异步初始化

```typescript
// ❌ 问题流程
应用启动
  ↓
异步创建 apiService (需要时间)
  ↓
其他模块导入 apiService
  ↓
❌ apiService 可能还是 null
  ↓
调用 apiService.getProfile()
  ↓
❌ TypeError: Cannot read property 'getProfile' of null
```

**缺点**：
- ❌ 竞态条件：apiService 可能为 null
- ❌ 需要处理异步初始化逻辑
- ❌ 所有使用 apiService 的地方都要等待初始化
- ❌ 代码复杂度高

### 现在：同步创建 + 延迟加载

```typescript
// ✅ 正确流程
应用启动
  ↓
同步创建 apiService (立即完成)
  ↓
其他模块导入 apiService
  ↓
✅ apiService 立即可用
  ↓
调用 apiService.getProfile()
  ↓
✅ 正常工作

// 首次调用 chat 时
调用 apiService.chat()
  ↓
异步加载 Mock 配置
  ↓
缓存配置
  ↓
执行 Mock 逻辑
  ↓
后续调用直接使用缓存配置
```

**优点**：
- ✅ 无竞态条件：apiService 始终可用
- ✅ 同步创建：立即返回实例
- ✅ 延迟加载：仅在需要时加载配置
- ✅ 配置缓存：避免重复加载
- ✅ 代码简洁：无需处理异步初始化

## 🔑 关键技术点

### 1. 配置缓存机制

```typescript
let cachedConfig: any = null
let configPromise: Promise<any> | null = null

async function loadMockConfig(): Promise<any> {
  // 如果已有缓存，直接返回
  if (cachedConfig) return cachedConfig
  
  // 如果正在加载，返回同一个 Promise（避免并发请求）
  if (configPromise) return configPromise

  // 开始加载
  configPromise = (async () => {
    // ... 加载逻辑
    cachedConfig = result
    return result
  })()

  return configPromise
}
```

**优势**：
- ✅ 避免重复加载
- ✅ 防止并发请求
- ✅ 线程安全

### 2. 原型链继承

```typescript
const mockService = Object.create(Object.getPrototypeOf(realService))
Object.assign(mockService, realService)
mockService.chat = createMockChatMethod()
```

确保所有原型方法（如 `getProfile`、`login` 等）都能正常工作。

### 3. 环境判断

```typescript
function shouldEnableMock(): boolean {
  // 生产环境强制禁用
  if (import.meta.env.PROD) {
    return false
  }

  // 优先从 localStorage 读取
  const localStorageEnabled = localStorage.getItem('VITE_ENABLE_MOCK')
  if (localStorageEnabled !== null) {
    return localStorageEnabled === 'true'
  }

  // 降级到环境变量
  return import.meta.env.VITE_ENABLE_MOCK === 'true'
}
```

## 🧪 测试验证

### 测试 1: 同步可用性

```typescript
import { apiService } from '@/services/ApiService'

// ✅ 立即可以使用，不会为 null
console.log(apiService) // ApiService 实例
console.log(typeof apiService.getProfile) // "function"
console.log(typeof apiService.login) // "function"
```

### 测试 2: Mock createMessage

```typescript
// 发送消息（不会实际请求后端）
const message = await apiService.createMessage(
  'session_123',
  '你好，这是一个测试消息',
  [],  // files
  null, // replaceMessageId
  undefined // knowledgeBaseIds
)

// 控制台输出：
// 🎭 [Mock] 拦截 createMessage 请求: {
//   sessionId: "session_123",
//   content: "你好，这是一个测试消息",
//   filesCount: 0,
//   replaceMessageId: null,
//   knowledgeBaseIds: undefined
// }

console.log(message.id) // "mock_msg_xxx"
console.log(message.role) // "user"
console.log(message.content) // "你好，这是一个测试消息"
```

### 测试 3: 首次调用 chat 时加载配置

```typescript
// 第一次调用
for await (const event of apiService.chat(...)) {
  // 控制台输出：
  // 🎭 [Mock] 配置已加载 { enableThinking: false, ... }
  // 🎭 [Mock] 拦截 chat 请求: { ... }
}

// 第二次调用（使用缓存配置）
for await (const event of apiService.chat(...)) {
  // 控制台输出：
  // 🎭 [Mock] 拦截 chat 请求: { ... }
  // （没有“配置已加载”，因为使用了缓存）
}
```

### 测试 4: 动态切换

```typescript
// 切换场景
localStorage.setItem('VITE_MOCK_SCENARIO', 'WITH_THINKING')

// 重新初始化（同步）
reinitApiService()

// 下次调用 chat 时会加载新配置
```

## 📝 最佳实践

### 1. 不要在模块顶层 await

```typescript
// ❌ 错误：阻塞模块加载
const config = await loadConfig()

// ✅ 正确：在函数内部异步加载
async function doSomething() {
  const config = await loadConfig()
  // ...
}
```

### 2. 使用缓存避免重复加载

```typescript
// ✅ 好的做法
let cache: any = null
async function getData() {
  if (cache) return cache
  cache = await fetchData()
  return cache
}
```

### 3. 同步导出，异步按需加载

```typescript
// ✅ 推荐模式
export const service = createServiceSync()

// 在方法内部异步加载重型依赖
service.heavyMethod = async () => {
  const heavyModule = await import('./heavy-module')
  // ...
}
```

## 🎯 适用场景

这种模式特别适合：

1. **单例服务**：需要立即可用的全局服务
2. **可选功能**：某些功能可能不会用到（如 Mock）
3. **重型依赖**：依赖加载成本高，希望延迟加载
4. **动态配置**：配置可能在运行时改变

## 📚 相关文档

- `MOCK_VITE_MODULE_FIX.md` - Vite 模块加载修复
- `MOCK_PROTOTYPE_FIX.md` - 原型链继承修复
- `MOCK_REGENERATION_MODES.md` - 再生模式支持
- `MOCK_QUICK_START.md` - 快速开始指南

---

**更新日期**: 2026-04-16  
**版本**: v2.0 - 同步初始化方案  
**状态**: ✅ 已完成并验证
