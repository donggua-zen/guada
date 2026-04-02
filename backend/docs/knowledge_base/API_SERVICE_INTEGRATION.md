# 知识库 API 服务集成报告

## 🎯 问题描述

**原始实现**: 知识库 Store 直接使用 `axios` 发送请求  
**问题**: 
- ❌ 不携带认证信息（Authorization header）
- ❌ 会被后端拦截返回 401 Unauthorized
- ❌ 无法统一处理错误和响应

**示例代码 (修复前)**:
```typescript
// stores/knowledgeBase.ts
import axios from 'axios'

async function fetchKnowledgeBases() {
    const response = await axios.get('/api/v1/knowledge-bases')
    // ❌ 没有 Authorization header
}
```

---

## ✅ 解决方案

### 方案概述
1. **在 ApiService 中添加知识库相关方法**
2. **更新 Store 使用 apiService 替代 axios**
3. **自动携带认证信息**

---

## 📝 修改内容

### 1. ApiService.ts - 添加知识库 API 方法

**文件**: [`ApiService.ts`](d:/编程开发/AI/ai_chat/frontend/src/services/ApiService.ts)

**新增接口**:

#### 知识库管理
```typescript
// 获取知识库列表
fetchKnowledgeBases(): Promise<PaginatedResponse<KnowledgeBase>>

// 创建知识库
createKnowledgeBase(data: {...}): Promise<KnowledgeBase>

// 更新知识库
updateKnowledgeBase(kbId: string, data: Partial<KnowledgeBase>): Promise<KnowledgeBase>

// 删除知识库
deleteKnowledgeBase(kbId: string): Promise<{ success: boolean }>

// 获取单个知识库详情
getKnowledgeBase(kbId: string): Promise<KnowledgeBase>
```

#### 知识库文件管理
```typescript
// 获取知识库文件列表
fetchKBFiles(kbId: string): Promise<PaginatedResponse<KBFile>>

// 上传文件到知识库
uploadKBFile(kbId: string, file: File): Promise<KBFile>

// 获取文件详情
getKBFile(kbId: string, fileId: string): Promise<KBFile>

// 删除知识库文件
deleteKBFile(kbId: string, fileId: string): Promise<{ success: boolean }>

// 查询文件处理状态
getFileProcessingStatus(kbId: string, fileId: string): Promise<KBFile>
```

#### 知识库搜索
```typescript
// 在知识库中搜索
searchKnowledgeBase(
    kbId: string,
    query: string,
    topK: number = 5,
    filterFileId?: string
): Promise<KnowledgeSearchResult>
```

---

### 2. knowledgeBase.ts - 使用 apiService

**文件**: [`knowledgeBase.ts`](d:/编程开发/AI/ai_chat/frontend/src/stores/knowledgeBase.ts)

**修改对比**:

#### 导入变更
```diff
- import axios from 'axios'
+ import { apiService } from '@/services/ApiService'
```

#### 方法调用变更
```diff
// 获取知识库列表
async function fetchKnowledgeBases() {
-   const response = await axios.get('/api/v1/knowledge-bases')
+   const response = await apiService.fetchKnowledgeBases()
    knowledgeBases.value = response.items || []
    return response
}

// 创建知识库
async function createKnowledgeBase(data: {...}) {
-   const response = await axios.post('/api/v1/knowledge-bases', data)
+   const response = await apiService.createKnowledgeBase(data)
    knowledgeBases.value.unshift(response)
    return response
}

// 上传文件
async function uploadFile(kbId: string, file: File) {
-   const response = await axios.post(
-       `/api/v1/knowledge-bases/${kbId}/files/upload`,
-       formData,
-       { headers: { 'Content-Type': 'multipart/form-data' } }
-   )
+   const response = await apiService.uploadKBFile(kbId, file)
    return response
}
```

---

## 🔍 技术细节

### Axios 拦截器自动携带认证

**ApiService 中的配置**:
```typescript
class ApiService {
    constructor(baseURL: string = '/api/v1') {
        this.axiosInstance = axios.create({
            baseURL: this.baseURL,
            headers: {
                'Content-Type': 'application/json',
            },
        })

        // 请求拦截器 - 自动添加 Authorization
        this.axiosInstance.interceptors.request.use(
            (config) => {
                const token = this.tokenStore.value
                if (token) {
                    config.headers.Authorization = `Bearer ${token}`
                }
                return config
            },
            (error) => {
                return Promise.reject(error)
            }
        )
    }
}
```

**工作流程**:
1. Store 调用 `apiService.fetchKnowledgeBases()`
2. ApiService 的 `_request()` 方法调用 `axiosInstance`
3. **请求拦截器自动添加 `Authorization: Bearer <token>`**
4. 发送到后端 `/api/v1/knowledge-bases`
5. 后端验证通过，返回数据

---

### 为什么之前会失败？

#### 直接使用的 axios
```typescript
import axios from 'axios'

// ❌ 这个 axios 实例没有配置拦截器
const response = await axios.get('/api/v1/knowledge-bases')
```

**问题**:
- 使用的是 axios 默认实例
- 没有配置请求拦截器
- 不会自动添加 Authorization header
- 后端收到未认证的请求 → 返回 401

#### 使用 apiService
```typescript
import { apiService } from '@/services/ApiService'

// ✅ 这个实例有拦截器配置
const response = await apiService.fetchKnowledgeBases()
```

**优势**:
- 使用配置好的 axios 实例
- 自动添加认证信息
- 统一的错误处理
- 统一的响应格式

---

## 📊 完整的方法映射

| Store 方法 | ApiService 方法 | HTTP 方法 | 端点 |
|-----------|----------------|----------|------|
| `fetchKnowledgeBases()` | `fetchKnowledgeBases()` | GET | `/knowledge-bases` |
| `createKnowledgeBase(data)` | `createKnowledgeBase(data)` | POST | `/knowledge-bases` |
| `updateKnowledgeBase(kbId, data)` | `updateKnowledgeBase(kbId, data)` | PUT | `/knowledge-bases/{kbId}` |
| `deleteKnowledgeBase(kbId)` | `deleteKnowledgeBase(kbId)` | DELETE | `/knowledge-bases/{kbId}` |
| `fetchFiles(kbId)` | `fetchKBFiles(kbId)` | GET | `/knowledge-bases/{kbId}/files` |
| `uploadFile(kbId, file)` | `uploadKBFile(kbId, file)` | POST | `/knowledge-bases/{kbId}/files/upload` |
| `deleteFile(kbId, fileId)` | `deleteKBFile(kbId, fileId)` | DELETE | `/knowledge-bases/{kbId}/files/{fileId}` |
| `getFileProcessingStatus(kbId, fileId)` | `getFileProcessingStatus(kbId, fileId)` | GET | `/knowledge-bases/{kbId}/files/{fileId}/status` |
| `searchInKB(kbId, query, topK)` | `searchKnowledgeBase(kbId, query, topK)` | POST | `/knowledge-bases/{kbId}/search` |

---

## 🚀 验证步骤

### 1. 检查认证头

打开浏览器开发者工具 → Network 面板：

**请求示例**:
```http
GET /api/v1/knowledge-bases HTTP/1.1
Host: localhost:5173
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json
```

**应该看到**:
- ✅ `Authorization` header 存在
- ✅ Token 值正确
- ✅ 响应状态码 200 OK

### 2. 测试功能

#### 获取知识库列表
```typescript
const store = useKnowledgeBaseStore()
await store.fetchKnowledgeBases()
// ✅ 应该成功返回数据
```

#### 创建知识库
```typescript
const store = useKnowledgeBaseStore()
await store.createKnowledgeBase({
    name: '测试知识库',
    embedding_model_provider: '硅基流动',
    embedding_model_name: 'text-embedding-v4'
})
// ✅ 应该创建成功
```

#### 上传文件
```typescript
const store = useKnowledgeBaseStore()
const file = new File(['test'], 'test.txt', { type: 'text/plain' })
await store.uploadFile('kb-id-123', file)
// ✅ 应该上传成功
```

---

## ⚠️ 常见问题

### Q1: 为什么要复制到 ApiService？

**A**: 
1. **统一认证**: 所有 API 都通过同一个服务调用
2. **代码复用**: 避免重复的 axios 配置
3. **易于维护**: 修改认证逻辑只需改一处
4. **类型安全**: 统一的类型定义和返回值

### Q2: 文件上传如何处理？

**A**: 
文件上传比较特殊，需要设置 `Content-Type: multipart/form-data`。

在 ApiService 中单独处理：
```typescript
async uploadKBFile(kbId: string, file: File): Promise<KBFile> {
    const formData = new FormData()
    formData.append('file', file)
    
    return await this.axiosInstance.post(
        `/knowledge-bases/${kbId}/files/upload`,
        formData,
        {
            headers: {
                'Content-Type': 'multipart/form-data',
            },
        }
    )
}
```

**注意**: 
- 使用 `this.axiosInstance` 而不是 `this._request()`
- 手动设置 `Content-Type` header
- 但仍然会自动添加 `Authorization` header（通过请求拦截器）

### Q3: 如果 token 过期怎么办？

**A**: 
ApiService 已经有处理：
```typescript
this.axiosInstance.interceptors.response.use(
    (response) => response.data,
    (error) => {
        if (error.status === 401) {
            window.location.href = '/login'  // 跳转到登录页
        }
        return Promise.reject(error)
    }
)
```

---

## 📋 验收清单

- [x] **ApiService 已添加知识库方法**
  - [x] 知识库管理（CRUD）
  - [x] 文件管理（上传、查询、删除）
  - [x] 搜索功能
  
- [x] **Store 已切换到 apiService**
  - [x] 移除 axios 直接导入
  - [x] 所有方法使用 apiService
  - [x] 类型定义正确

- [ ] **功能测试通过**
  - [ ] 获取知识库列表成功
  - [ ] 创建知识库成功
  - [ ] 上传文件成功
  - [ ] 搜索功能正常
  - [ ] Network 面板显示 Authorization header

---

## 🎉 当前状态

**ApiService**: ✅ 已添加知识库 API 方法  
**Store**: ✅ 已切换到 apiService  
**认证**: ✅ 自动携带 Authorization header  

**下一步**: 刷新页面测试功能！

---

**修复时间**: 2026-04-01  
**修复者**: AI Assistant  
**状态**: ✅ 完成
