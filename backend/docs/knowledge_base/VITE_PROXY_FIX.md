# Vite 代理配置修复报告

## 🐛 问题描述

**现象**: 前端请求 API 时出现 `ECONNREFUSED` 错误  
**错误日志**:
```
11:19:24 [vite] http proxy error: /api/v1/knowledge-bases
AggregateError [ECONNREFUSED]: 
    at internalConnectMultiple (node:net:1134:18)
```

**原因**: Vite 代理配置的后端地址与实际不符
- ❌ 配置地址：`http://localhost:8800`
- ✅ 实际地址：`http://localhost:8000`

---

## ✅ 修复内容

### 修改文件
[`vite.config.ts`](d:/编程开发/AI/ai_chat/frontend/vite.config.ts)

### 修改对比
```diff
server: {
  proxy: {
    // 代理 API 请求
    '/api/v1': {
-      target: 'http://localhost:8800', // 后端地址
+      target: 'http://localhost:8000', // 后端地址
      changeOrigin: true,
    },
    // 代理静态资源请求
    '/static': {
-      target: 'http://localhost:8800',
+      target: 'http://localhost:8000',
      changeOrigin: true
    }
  }
}
```

---

## 📊 当前服务状态

| 服务 | 状态 | 地址 | 端口 |
|------|------|------|------|
| **后端 API** | ✅ 运行中 | http://localhost:8000 | 8000 |
| **前端服务** | ✅ 运行中 | http://localhost:5174 | 5174 |

**注意**: 前端使用了 **5174** 端口（因为 5173 被占用）

---

## 🚀 验证步骤

### 1. 访问应用
打开浏览器访问：
```
http://localhost:5174
```

### 2. 测试 API 连接
按 F12 打开开发者工具，查看 Console：
- ✅ 应该没有 `ECONNREFUSED` 错误
- ✅ 应该没有 404 错误

### 3. 进入知识库页面
- 点击左侧"📚 知识库"导航
- ✅ 应该能正常加载知识库列表
- ✅ 控制台显示成功响应

### 4. 创建知识库测试
- 点击"新建知识库"按钮
- 填写表单信息
- 点击"创建"
- ✅ 应该返回成功响应

---

## 🔍 技术说明

### Vite 代理原理

Vite 使用 `http-proxy-middleware` 来代理 API 请求：

```typescript
server: {
  proxy: {
    '/api/v1': {
      target: 'http://localhost:8000',  // 目标服务器地址
      changeOrigin: true,               // 修改 Host 头
      // rewrite: (path) => path.replace(/^\/api/, '')
    }
  }
}
```

**工作流程**:
1. 前端请求：`http://localhost:5174/api/v1/knowledge-bases`
2. Vite 拦截并转发：`http://localhost:8000/api/v1/knowledge-bases`
3. 后端处理并返回响应
4. Vite 将响应返回给浏览器

### changeOrigin 参数

```typescript
changeOrigin: true
```

**作用**: 修改请求头中的 `Host` 字段  
**原因**: 某些后端服务器会验证 `Host` 头，需要修改为目标服务器的 host

---

## ⚠️ 常见问题

### 问题 1: 为什么使用代理？

**原因**: 
1. **避免 CORS 问题**: 直接请求 `http://localhost:8000` 会遇到跨域问题
2. **开发环境一致性**: 所有请求都通过同一个域名和端口
3. **简化配置**: 不需要在后端配置 CORS

### 问题 2: 端口冲突

**现象**: 5173 端口被占用  
**解决**: Vite 自动切换到下一个可用端口（5174）

**手动指定端口**:
```typescript
server: {
  port: 5173,  // 强制使用 5173
  strictPort: false  // 如果 5173 被占用则报错
}
```

### 问题 3: 代理不生效

**检查清单**:
- [ ] vite.config.ts 配置正确
- [ ] 后端服务已启动
- [ ] 后端监听正确的端口
- [ ] 前端服务已重启（配置修改不会热重载）

---

## 📝 调试技巧

### 1. 检查后端是否可访问

```bash
# 直接访问后端 API
curl http://localhost:8000/api/v1/knowledge-bases
# 应该返回 JSON 或认证错误
```

### 2. 检查代理是否工作

在浏览器控制台：
```javascript
fetch('/api/v1/knowledge-bases')
  .then(r => r.json())
  .then(console.log)
// 如果代理正常，应该能看到后端返回的数据
```

### 3. 查看 Vite 日志

```bash
npm run dev
# 观察终端输出
# 代理请求时会显示：
# [vite] proxy request /api/v1/knowledge-bases to http://localhost:8000
```

---

## 🎯 最佳实践

### 1. 环境变量管理

使用 `.env` 文件管理不同环境的配置：

**.env.development**:
```
VITE_API_BASE_URL=http://localhost:8000
```

**.env.production**:
```
VITE_API_BASE_URL=https://api.example.com
```

**vite.config.ts**:
```typescript
export default defineConfig({
  server: {
    proxy: {
      '/api/v1': {
        target: import.meta.env.VITE_API_BASE_URL,
        changeOrigin: true,
      }
    }
  }
})
```

### 2. API 基础路径统一

在 ApiService 中使用相对路径：
```typescript
const API_BASE = '/api/v1'  // 使用代理

// 而不是
const API_BASE = 'http://localhost:8000/api/v1'
```

### 3. 错误处理

在 Store 中添加完善的错误处理：
```typescript
try {
  const response = await axios.get('/api/v1/knowledge-bases')
  return response.data
} catch (error: any) {
  if (error.code === 'ECONNREFUSED') {
    ElMessage.error('无法连接到后端服务')
  } else if (error.response?.status === 404) {
    ElMessage.error('API 不存在')
  }
  throw error
}
```

---

## ✅ 验收清单

- [x] **代理配置正确**
  - [x] target: `http://localhost:8000`
  - [x] changeOrigin: `true`
  
- [x] **后端服务运行**
  - [x] 监听端口：8000
  - [x] 路由已注册
  
- [x] **前端服务运行**
  - [x] 端口：5174
  - [x] 代理配置已更新
  
- [ ] **功能测试通过**
  - [ ] 知识库列表加载成功
  - [ ] 创建知识库成功
  - [ ] 无控制台错误

---

## 🎉 当前状态

**代理配置**: ✅ 已修复  
**后端服务**: ✅ 运行正常  
**前端服务**: ✅ 运行正常  
**API 连接**: ✅ 应该正常  

**可以开始测试**！

---

**修复时间**: 2026-04-01  
**修复者**: AI Assistant  
**状态**: ✅ 完成
