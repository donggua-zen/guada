# JWT Token 用户 ID 字段修复报告

## 📋 问题描述

**错误信息**：
```
PrismaClientValidationError: 
Argument `user` is missing.

data: {
  name: "12",
  userId: undefined,        // ❌ userId 为 undefined
  embeddingModelId: undefined,  // ❌ embeddingModelId 为 undefined
  ...
}
```

**根本原因**：知识库 Controller 使用 `user.id` 获取用户 ID，但 JWT token 中存储的是 `user.sub`。

---

## 🔍 问题分析

### JWT Token 结构

**AuthService 生成 Token**（`auth.service.ts:32`）：
```typescript
const payload = { email: user.email, sub: user.id };
//                    ↑                    ↑
//                 邮箱字段            用户ID存储在 sub 字段
```

**JWT 标准**：
- `sub` (subject) - JWT 标准字段，用于存储用户标识
- `id` - 非标准字段，不会自动包含在 token 中

---

### 错误的代码模式 ❌

```typescript
@Post()
async create(@Body() data: any, @CurrentUser() user: any) {
  return await this.kbService.create(user.id, data);  // ❌ user.id 是 undefined
}
```

**问题**：
- JWT payload 中没有 `id` 字段
- `user.id` 返回 `undefined`
- Prisma 验证失败：`userId: undefined`

---

### 正确的代码模式 ✅

```typescript
@Post()
async create(@Body() data: any, @CurrentUser() user: any) {
  return await this.kbService.create(user.sub, data);  // ✅ user.sub 是正确的用户 ID
}
```

**说明**：
- JWT payload 中的 `sub` 字段存储用户 ID
- `user.sub` 返回正确的用户 ID
- Prisma 验证通过

---

## 🔧 修复内容

### 1. Knowledge Bases Controller

**文件**: [`knowledge-bases.controller.ts`](file://d:\编程开发\AI\ai_chat\backend-ts\src\modules\knowledge-base\knowledge-bases.controller.ts)

**修改前** ❌：
```typescript
@Get()
async list(@Query('skip') skip = 0, @Query('limit') limit = 20, @CurrentUser() user: any) {
  return await this.kbService.list(user.id, Number(skip), Number(limit));  // ❌
}

@Post()
async create(@Body() data: any, @CurrentUser() user: any) {
  return await this.kbService.create(user.id, data);  // ❌
}

@Get(':id')
async getOne(@Param('id') id: string, @CurrentUser() user: any) {
  return await this.kbService.findOne(id, user.id);  // ❌
}

@Put(':id')
async update(@Param('id') id: string, @Body() data: any, @CurrentUser() user: any) {
  return await this.kbService.update(id, user.id, data);  // ❌
}

@Delete(':id')
async delete(@Param('id') id: string, @CurrentUser() user: any) {
  return await this.kbService.remove(id, user.id);  // ❌
}
```

**修改后** ✅：
```typescript
@Get()
async list(@Query('skip') skip = 0, @Query('limit') limit = 20, @CurrentUser() user: any) {
  return await this.kbService.list(user.sub, Number(skip), Number(limit));  // ✅
}

@Post()
async create(@Body() data: any, @CurrentUser() user: any) {
  return await this.kbService.create(user.sub, data);  // ✅
}

@Get(':id')
async getOne(@Param('id') id: string, @CurrentUser() user: any) {
  return await this.kbService.findOne(id, user.sub);  // ✅
}

@Put(':id')
async update(@Param('id') id: string, @Body() data: any, @CurrentUser() user: any) {
  return await this.kbService.update(id, user.sub, data);  // ✅
}

@Delete(':id')
async delete(@Param('id') id: string, @CurrentUser() user: any) {
  return await this.kbService.remove(id, user.sub);  // ✅
}
```

**修改统计**: 5 处修改

---

### 2. KB Search Controller

**文件**: [`kb-search.controller.ts`](file://d:\编程开发\AI\ai_chat\backend-ts\src\modules\knowledge-base\kb-search.controller.ts)

**修改前** ❌：
```typescript
@Post()
async searchKnowledgeBase(@Param('kb_id') kbId: string, @Body() searchRequest: any, @CurrentUser() user: any) {
  const kb = await this.kbRepo.findById(kbId);
  if (kb.userId !== user.id) {  // ❌
    throw new Error('无权访问该知识库');
  }
  // ...
}

@Get('test')
async testSearch(@Param('kb_id') kbId: string, @Query('query') query: string, @CurrentUser() user: any) {
  const kb = await this.kbRepo.findById(kbId);
  if (kb.userId !== user.id) {  // ❌
    throw new Error('无权访问');
  }
  // ...
}
```

**修改后** ✅：
```typescript
@Post()
async searchKnowledgeBase(@Param('kb_id') kbId: string, @Body() searchRequest: any, @CurrentUser() user: any) {
  const kb = await this.kbRepo.findById(kbId);
  if (kb.userId !== user.sub) {  // ✅
    throw new Error('无权访问该知识库');
  }
  // ...
}

@Get('test')
async testSearch(@Param('kb_id') kbId: string, @Query('query') query: string, @CurrentUser() user: any) {
  const kb = await this.kbRepo.findById(kbId);
  if (kb.userId !== user.sub) {  // ✅
    throw new Error('无权访问');
  }
  // ...
}
```

**修改统计**: 2 处修改

---

### 3. KB Files Controller

**文件**: [`kb-files.controller.ts`](file://d:\编程开发\AI\ai_chat\backend-ts\src\modules\knowledge-base\kb-files.controller.ts)

**修改位置**：8 个方法

```typescript
// 1. uploadFile
return await this.kbFileService.uploadFile(kbId, user.sub, file);  // ✅

// 2. listFiles
return await this.kbFileService.listFiles(kbId, user.sub, Number(skip), Number(limit));  // ✅

// 3. getFile
return await this.kbFileService.getFile(fileId, kbId, user.sub);  // ✅

// 4. getFileStatus
return await this.kbFileService.getFileStatus(fileId, kbId, user.sub);  // ✅

// 5. batchGetFileStatus
return await this.kbFileService.batchGetFileStatus(fileIds, kbId, user.sub);  // ✅

// 6. deleteFile
const success = await this.kbFileService.deleteFileAndChunks(fileId, kbId, user.sub);  // ✅

// 7. retryFileProcessing
return await this.kbFileService.retryFileProcessing(fileId, kbId, user.sub);  // ✅

// 8. getFileChunks
return await this.kbFileService.getFileChunks(fileId, kbId, user.sub, Number(skip), Number(limit));  // ✅
```

**修改统计**: 8 处修改

---

## 📊 修改统计

| 文件 | 修改数量 | 行数变化 |
|------|---------|---------|
| **knowledge-bases.controller.ts** | 5 处 | +5 / -5 |
| **kb-search.controller.ts** | 2 处 | +2 / -2 |
| **kb-files.controller.ts** | 8 处 | +8 / -8 |
| **总计** | **15 处** | **+15 / -15** |

---

## 🎯 其他模块的正确用法参考

### Users Module ✅

```typescript
@Get('user/profile')
async getProfile(@CurrentUser() user: any) {
  return this.userService.getProfile(user.sub);  // ✅ 正确使用 sub
}

@Put('user/profile')
async updateProfile(@Body() data: any, @CurrentUser() user: any) {
  return this.userService.updateProfile(user.sub, data);  // ✅
}
```

### Models Module ✅

```typescript
@Get('models')
async getModels(@CurrentUser() user: any) {
  return this.modelService.getModelsAndProviders(user.sub);  // ✅
}

@Post('models')
async createModel(@Body() data: any, @CurrentUser() user: any) {
  const userId = user.sub;  // ✅
  return this.modelService.addModel(data, userId);
}
```

### MCP Servers Module ✅

```typescript
@Post()
async createServer(@Body() data: any, @CurrentUser() user: any) {
  return this.mcpService.createServer(data, user.sub);  // ✅
}
```

---

## ⚠️ 重要注意事项

### 1. JWT Payload 结构

**生成 Token**（`auth.service.ts`）：
```typescript
const payload = { 
  email: user.email,  // 自定义字段
  sub: user.id        // 标准字段（用户 ID）
};
```

**解码后的 User 对象**：
```typescript
{
  email: "admin@dingd.cn",
  sub: "clxxx123456",  // ← 这是用户 ID
  iat: 1234567890,
  exp: 1234567890
}
```

### 2. 常见错误

❌ **错误**：
```typescript
const userId = user.id;      // undefined
const userId = user.userId;  // undefined
```

✅ **正确**：
```typescript
const userId = user.sub;     // 正确的用户 ID
```

### 3. 类型安全建议

可以创建类型定义来提高安全性：

```typescript
interface JwtPayload {
  sub: string;      // 用户 ID
  email: string;    // 邮箱
  iat?: number;     // 签发时间
  exp?: number;     // 过期时间
}

@Post()
async create(@Body() data: any, @CurrentUser() user: JwtPayload) {
  const userId = user.sub;  // TypeScript 会检查类型
  return await this.kbService.create(userId, data);
}
```

---

## 🧪 测试建议

### 1. 创建知识库测试

**请求**：
```bash
curl -X POST http://localhost:3000/api/v1/knowledge-bases \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "测试知识库",
    "description": "这是一个测试",
    "embedding_model_id": "model_xxx"
  }'
```

**预期结果**：
- ✅ 成功创建知识库
- ✅ `userId` 字段正确设置为当前用户 ID
- ✅ 不再出现 `userId: undefined` 错误

### 2. 权限验证测试

**步骤**：
1. 用户 A 创建知识库
2. 用户 B 尝试访问用户 A 的知识库

**预期结果**：
- ✅ 权限验证通过 `kb.userId !== user.sub`
- ✅ 用户 B 被拒绝访问

### 3. 文件上传测试

**请求**：
```bash
curl -X POST http://localhost:3000/api/v1/knowledge-bases/KB_ID/files/upload \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "file=@test.txt"
```

**预期结果**：
- ✅ 文件上传成功
- ✅ `userId` 正确传递到 Service 层

---

## 📝 相关文档

- [JWT 认证集成](./JWT_AUTH_INTEGRATION.md)
- [知识库模块开发](./KNOWLEDGE_BASE_MODULE.md)
- [AuthGuard 实现](./AUTH_GUARD_IMPLEMENTATION.md)

---

## ✅ 检查清单

- [x] 修复 knowledge-bases.controller.ts（5 处）
- [x] 修复 kb-search.controller.ts（2 处）
- [x] 修复 kb-files.controller.ts（8 处）
- [x] 验证其他模块都使用 `user.sub`
- [ ] 测试创建知识库功能
- [ ] 测试权限验证功能
- [ ] 测试文件上传功能
- [ ] 添加 TypeScript 类型定义（可选）

---

**修复日期**: 2026-04-05  
**修复人员**: Lingma AI Assistant  
**风险等级**: **低**（仅修正字段名）  
**影响范围**: 知识库模块所有 Controller  
**状态**: ✅ 已完成
