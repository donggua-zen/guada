# Mock 原型链继承问题修复

## 🐛 问题描述

启用 Mock 后出现错误：
```
TypeError: apiService.getProfile is not a function
```

但关闭 Mock 后正常工作。

## 🔍 问题原因

### 错误的实现方式

```typescript
// ❌ 使用展开运算符 - 只会复制实例属性
return {
  ...realService,
  chat: createMockChatMethod(defaultConfig),
}
```

**问题分析**：
1. `ApiService` 是一个**类**，它的方法定义在**原型链**上
2. 展开运算符 `...` 只会复制**实例自身的属性**（own properties）
3. **不会复制原型链上的方法**（如 `getProfile`、`login` 等）
4. 导致返回的对象缺少所有类方法

### 示例说明

```typescript
class ApiService {
  baseURL = '/api/v1'  // 实例属性
  
  getProfile() {       // 原型方法
    // ...
  }
  
  login() {           // 原型方法
    // ...
  }
}

const realService = new ApiService()

// ❌ 展开运算符的问题
const mockService = {
  ...realService,
  chat: mockChat
}

console.log(mockService.baseURL)  // ✅ '/api/v1' (实例属性被复制)
console.log(mockService.getProfile) // ❌ undefined (原型方法未被复制)
```

## ✅ 解决方案

### 正确的实现方式

```typescript
// ✅ 使用 Object.create + Object.assign
const mockService = Object.create(Object.getPrototypeOf(realService))

// 复制所有实例属性
Object.assign(mockService, realService)

// 覆盖 chat 方法
mockService.chat = createMockChatMethod(defaultConfig)

return mockService
```

**工作原理**：
1. `Object.create(Object.getPrototypeOf(realService))` 
   - 创建一个新对象
   - 设置其原型链指向 `realService` 的原型
   - 这样新对象可以访问所有原型方法

2. `Object.assign(mockService, realService)`
   - 复制所有实例属性（如 `baseURL`、`axiosInstance` 等）
   - 不覆盖原型链

3. `mockService.chat = ...`
   - 仅覆盖 `chat` 方法
   - 其他方法仍然从原型链继承

### 验证结果

```typescript
const mockService = createApiServiceInstance()

console.log(mockService.baseURL)      // ✅ '/api/v1'
console.log(mockService.getProfile)   // ✅ function (从原型链继承)
console.log(mockService.login)        // ✅ function (从原型链继承)
console.log(mockService.chat)         // ✅ function (被覆盖为 Mock 版本)
```

## 📊 对比总结

| 特性 | 展开运算符 `...` | Object.create + assign |
|------|-----------------|------------------------|
| 实例属性 | ✅ 复制 | ✅ 复制 |
| 原型方法 | ❌ 丢失 | ✅ 继承 |
| 原型链 | ❌ 断开 | ✅ 保持 |
| 适用场景 | 普通对象 | 类实例 |

## 🎯 最佳实践

### 包装类实例的正确方式

```typescript
function wrapClassInstance(originalInstance, overrides) {
  // 1. 创建新对象，保持原型链
  const wrapped = Object.create(Object.getPrototypeOf(originalInstance))
  
  // 2. 复制实例属性
  Object.assign(wrapped, originalInstance)
  
  // 3. 应用覆盖
  Object.assign(wrapped, overrides)
  
  return wrapped
}

// 使用示例
const mockService = wrapClassInstance(realService, {
  chat: createMockChatMethod(config)
})
```

### 常见错误模式

```typescript
// ❌ 错误：展开运算符合并
return { ...original, override }

// ❌ 错误：手动逐个赋值
return {
  prop1: original.prop1,
  prop2: original.prop2,
  method: original.method.bind(original)  // 需要手动绑定 this
}

// ✅ 正确：保持原型链
const wrapped = Object.create(Object.getPrototypeOf(original))
Object.assign(wrapped, original)
wrapped.method = newMethod
return wrapped
```

## 🔧 相关代码位置

**文件**: `frontend/src/services/ApiService.ts`

**函数**: `createApiServiceInstance()`

**修改前**:
```typescript
return {
  ...realService,
  chat: createMockChatMethod(defaultConfig),
}
```

**修改后**:
```typescript
const mockService = Object.create(Object.getPrototypeOf(realService))
Object.assign(mockService, realService)
mockService.chat = createMockChatMethod(defaultConfig)
return mockService
```

## 📝 测试验证

### 测试步骤

1. 启用 Mock 模式
2. 刷新页面
3. 检查控制台是否有错误
4. 尝试登录或获取用户信息

### 预期结果

- ✅ 无 `TypeError: xxx is not a function` 错误
- ✅ 所有 API 方法正常工作
- ✅ `chat` 方法使用 Mock 实现
- ✅ 其他方法使用真实实现

### 验证代码

```typescript
import { apiService } from '@/services/ApiService'

// 验证原型链
console.log('原型链正确:', Object.getPrototypeOf(apiService) === ApiService.prototype)

// 验证实例属性
console.log('baseURL:', apiService.baseURL)

// 验证方法存在
console.log('getProfile 存在:', typeof apiService.getProfile === 'function')
console.log('login 存在:', typeof apiService.login === 'function')
console.log('chat 存在:', typeof apiService.chat === 'function')

// 验证 chat 是 Mock 版本
console.log('chat 是 Mock:', apiService.chat.toString().includes('mockChatStream'))
```

## 🎓 知识点总结

### JavaScript 原型链

```typescript
class MyClass {
  constructor() {
    this.instanceProp = 'value'  // 实例属性
  }
  
  myMethod() {                    // 原型方法
    return 'method'
  }
}

const obj = new MyClass()

// 实例属性存储在对象本身
console.log(obj.hasOwnProperty('instanceProp'))  // true

// 原型方法存储在原型链上
console.log(obj.hasOwnProperty('myMethod'))      // false
console.log(MyClass.prototype.hasOwnProperty('myMethod'))  // true
```

### Object.create vs 展开运算符

```typescript
const proto = { inheritedMethod() {} }
const original = Object.create(proto)
original.ownProp = 'value'

// 展开运算符 - 只复制 own properties
const spread = { ...original }
console.log(spread.ownProp)           // 'value' ✅
console.log(spread.inheritedMethod)   // undefined ❌

// Object.create - 保持原型链
const created = Object.create(Object.getPrototypeOf(original))
Object.assign(created, original)
console.log(created.ownProp)          // 'value' ✅
console.log(created.inheritedMethod)  // function ✅
```

## 🚀 性能考虑

使用 `Object.create` + `Object.assign` 的性能影响：

- **创建开销**: 微小（仅在初始化时执行一次）
- **运行时开销**: 无（原型链查找是 JavaScript 引擎优化的）
- **内存开销**: 微小（多一个对象引用）

对于开发环境的 Mock 功能，这个开销完全可以接受。

---

**修复日期**: 2026-04-16  
**问题类型**: 原型链继承  
**影响范围**: Mock 模式下所有 API 调用  
**解决方案**: 使用 Object.create 保持原型链
