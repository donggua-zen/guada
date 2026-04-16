# Mock 动态切换机制说明

## 🔄 问题背景

最初实现中，`apiService` 是在模块加载时创建的**单例实例**：

```typescript
// 原来的实现
export const apiService = createApiServiceInstance()
```

这导致了一个问题：当用户通过 UI 面板动态开启/关闭 Mock 时，由于 `apiService` 已经创建完成，新的配置不会生效。

## ✅ 解决方案

### 1. 将 `apiService` 改为可重新赋值的变量

```typescript
// 新的实现
export let apiService = createApiServiceInstance()

export function reinitApiService() {
  apiService = createApiServiceInstance()
  console.log('🔄 API Service 已重新初始化')
  return apiService
}
```

### 2. 优先从 localStorage 读取配置

```typescript
// 优先从 localStorage 读取（运行时配置）
const localStorageEnabled = localStorage.getItem('VITE_ENABLE_MOCK')
const envEnabled = import.meta.env.VITE_ENABLE_MOCK === 'true'
const enabled = localStorageEnabled !== null 
  ? localStorageEnabled === 'true' 
  : envEnabled  // 降级到环境变量
```

### 3. UI 面板调用重新初始化

```typescript
// MockControlPanel.vue
async function handleToggleMock(event: Event) {
  const enabled = (event.target as HTMLInputElement).checked
  
  // 保存到 localStorage
  localStorage.setItem('VITE_ENABLE_MOCK', enabled ? 'true' : 'false')
  
  // 重新初始化 API Service
  const { reinitApiService } = await import('@/services/ApiService')
  reinitApiService()
  
  console.log('✅ API Service 已更新，请刷新页面以完全生效')
}
```

## 🎯 工作流程

### 场景 1: 启动时启用 Mock

```
应用启动
  ↓
检查 localStorage.VITE_ENABLE_MOCK
  ↓
如果为 'true' → 创建 Mock API Service
如果为 'false' 或不存在 → 检查环境变量
  ↓
使用相应的配置创建 apiService
```

### 场景 2: 运行时动态切换

```
用户点击 Mock 开关
  ↓
更新 localStorage.VITE_ENABLE_MOCK
  ↓
调用 reinitApiService()
  ↓
重新创建 apiService 实例
  ↓
提示用户刷新页面（确保所有组件使用新实例）
```

## 📝 使用说明

### 方式一：环境变量（推荐用于长期测试）

```bash
# .env.local
VITE_ENABLE_MOCK=true
VITE_MOCK_SCENARIO=NORMAL_TEXT
```

重启开发服务器后生效。

### 方式二：UI 面板（推荐用于快速切换）

1. 点击右下角 🎭 按钮
2. 切换 Mock 开关
3. API Service 自动重新初始化
4. **建议刷新页面**以确保所有组件使用新实例

### 方式三：编程式调用

```typescript
import { reinitApiService } from '@/services/ApiService'

// 启用 Mock
localStorage.setItem('VITE_ENABLE_MOCK', 'true')
localStorage.setItem('VITE_MOCK_SCENARIO', 'WITH_THINKING')
reinitApiService()

// 禁用 Mock
localStorage.setItem('VITE_ENABLE_MOCK', 'false')
reinitApiService()
```

## ⚠️ 注意事项

### 为什么仍建议刷新页面？

虽然 `reinitApiService()` 会重新创建 `apiService` 实例，但：

1. **已导入的引用不会自动更新**
   ```typescript
   // 在某些组件中
   import { apiService } from '@/services/ApiService'
   
   // 这个引用指向的是旧实例
   // 即使 apiService 被重新赋值，这里的引用不会变
   ```

2. **Vue 响应式系统可能需要更新**
   - 如果组件已经将 apiService 存储在响应式数据中
   - 需要刷新才能获取最新实例

3. **确保一致性**
   - 刷新页面可以保证整个应用使用同一个新实例
   - 避免部分组件用旧实例，部分用新实例

### 最佳实践

```typescript
// ❌ 不推荐：直接使用导入的 apiService
import { apiService } from '@/services/ApiService'
apiService.chat(...)

// ✅ 推荐：每次使用时重新获取
import { getApiService } from '@/services/ApiService'
const apiService = getApiService()
apiService.chat(...)
```

不过，由于我们使用了 `export let`，大多数情况下直接导入也能工作，因为 JavaScript 模块的导出是**实时绑定**的。

## 🔍 技术细节

### JavaScript 模块的实时绑定

```typescript
// ApiService.ts
export let apiService = createInstance()

export function reinitApiService() {
  apiService = createInstance()  // 重新赋值
}

// 其他文件
import { apiService } from './ApiService'

// 当 reinitApiService() 被调用后
// apiService 会自动指向新实例（因为是 let 而非 const）
```

这是 ES6 模块的特性：**导出的变量是实时绑定的**，而不是值的拷贝。

### 与 const 的区别

```typescript
// ❌ 使用 const - 无法重新赋值
export const apiService = createInstance()
// apiService = newInstance()  // 错误！

// ✅ 使用 let - 可以重新赋值
export let apiService = createInstance()
apiService = newInstance()  // 正确！
```

## 🎉 总结

通过这个改进，现在您可以：

✅ **启动时配置**：通过 `.env.local` 设置初始状态  
✅ **运行时切换**：通过 UI 面板动态开启/关闭 Mock  
✅ **自动重新初始化**：切换后 API Service 自动更新  
✅ **灵活便捷**：无需重启开发服务器  

只需注意：**动态切换后建议刷新页面**，以确保最佳的一致性。

---

**更新日期**: 2026-04-16  
**版本**: v1.1 - 支持动态切换
