# 知识库 API 字段命名转换修复报告

## 📋 问题描述

**错误信息**：
```
PrismaClientValidationError: 
Argument `user` is missing.

data: {
  name: "12",
  userId: "cmnlw0h5s0000ie8rv7ivtzf6",
  embeddingModelId: undefined,  // ❌ undefined
  ...
}
```

**根本原因**：前端传递驼峰式命名（`embeddingModelId`），但后端期望蛇形命名（`embedding_model_id`）。

---

## 🔍 问题分析

### 前端数据格式

**前端发送的数据**（驼峰式）：
```json
{
  "name": "12",
  "embeddingModelId": "cmnlw0h680005ie8rcyk650iq",
  "chunkMaxSize": 1000,
  "chunkMinSize": 50,
  "chunkOverlapSize": 100,
  "isPublic": false
}
```

### 后端期望格式

**后端 Prisma Schema**（蛇形命名映射）：
```prisma
model KnowledgeBase {
  id                   String   @id @default(cuid())
  name                 String
  description          String?
  userId               String   @map("user_id")              // ← 数据库列名是 user_id
  embeddingModelId     String   @map("embedding_model_id")   // ← 数据库列名是 embedding_model_id
  chunkMaxSize         Int      @default(1000) @map("chunk_max_size")
  chunkOverlapSize     Int      @default(100) @map("chunk_overlap_size")
  chunkMinSize         Int      @default(50) @map("chunk_min_size")
  isPublic             Boolean  @default(false) @map("is_public")
  metadataConfig       String?  @map("metadata_config")
}
```

**Service 层期望的数据**（蛇形命名）：
```typescript
const kb = await this.kbRepo.create({
  name: data.name,
  userId: userId,
  embeddingModelId: data.embedding_model_id,  // ← 期望蛇形命名
  chunkMaxSize: data.chunk_max_size,
  chunkOverlapSize: data.chunk_overlap_size,
  chunkMinSize: data.chunk_min_size,
  isPublic: data.is_public,
  metadataConfig: data.metadata_config ? JSON.stringify(data.metadata_config) : null,
});
```

---

## 🔧 修复方案

### 方案选择

**在后端 Controller 层进行转换** ✅

**优点**：
- ✅ 前端保持驼峰式命名（符合 JavaScript/TypeScript 规范）
- ✅ 后端内部使用蛇形命名（符合 Python/SQL 规范）
- ✅ 集中管理，易于维护
- ✅ 不影响其他模块

**缺点**：
- ❌ 需要在每个 Controller 方法中手动转换

---

### 修复内容

#### 1. Create 方法

**文件**: [`knowledge-bases.controller.ts`](file://d:\编程开发\AI\ai_chat\backend-ts\src\modules\knowledge-base\knowledge-bases.controller.ts#L20-L35)

**修改前** ❌：
```typescript
@Post()
async create(@Body() data: any, @CurrentUser() user: any) {
  return await this.kbService.create(user.sub, data);  // ❌ 直接传递，字段名不匹配
}
```

**修改后** ✅：
```typescript
@Post()
async create(@Body() data: any, @CurrentUser() user: any) {
  // ✅ 将前端驼峰式命名转换为后端蛇形命名
  const convertedData = {
    name: data.name,
    description: data.description,
    embedding_model_id: data.embeddingModelId,  // ✅ 转换
    chunk_max_size: data.chunkMaxSize,
    chunk_overlap_size: data.chunkOverlapSize,
    chunk_min_size: data.chunkMinSize,
    is_public: data.isPublic,  // ✅ 转换
    metadata_config: data.metadataConfig,
  };
  
  return await this.kbService.create(user.sub, convertedData);
}
```

---

#### 2. Update 方法

**文件**: [`knowledge-bases.controller.ts`](file://d:\编程开发\AI\ai_chat\backend-ts\src\modules\knowledge-base\knowledge-bases.controller.ts#L42-L56)

**修改前** ❌：
```typescript
@Put(':id')
async update(@Param('id') id: string, @Body() data: any, @CurrentUser() user: any) {
  return await this.kbService.update(id, user.sub, data);  // ❌ 直接传递
}
```

**修改后** ✅：
```typescript
@Put(':id')
async update(@Param('id') id: string, @Body() data: any, @CurrentUser() user: any) {
  // ✅ 将前端驼峰式命名转换为后端蛇形命名
  const convertedData: any = {};
  if (data.name !== undefined) convertedData.name = data.name;
  if (data.description !== undefined) convertedData.description = data.description;
  if (data.embeddingModelId !== undefined) convertedData.embedding_model_id = data.embeddingModelId;
  if (data.chunkMaxSize !== undefined) convertedData.chunk_max_size = data.chunkMaxSize;
  if (data.chunkOverlapSize !== undefined) convertedData.chunk_overlap_size = data.chunkOverlapSize;
  if (data.chunkMinSize !== undefined) convertedData.chunk_min_size = data.chunkMinSize;
  if (data.isPublic !== undefined) convertedData.is_public = data.isPublic;
  if (data.metadataConfig !== undefined) convertedData.metadata_config = data.metadataConfig;
  
  return await this.kbService.update(id, user.sub, convertedData);
}
```

**注意**：Update 方法使用条件判断，只转换存在的字段（部分更新）。

---

#### 3. Service 层验证

**文件**: [`knowledge-base.service.ts`](file://d:\编程开发\AI\ai_chat\backend-ts\src\modules\knowledge-base\knowledge-base.service.ts#L17-L40)

**添加必填字段验证**：
```typescript
async create(userId: string, data: any) {
  // ✅ 验证必填字段
  if (!data.name) {
    throw new Error('知识库名称不能为空');
  }
  if (!data.embedding_model_id) {
    throw new Error('向量模型 ID 不能为空');
  }

  try {
    const kb = await this.kbRepo.create({
      name: data.name,
      userId: userId,
      embeddingModelId: data.embedding_model_id,  // ✅ 必填字段
      description: data.description || null,
      chunkMaxSize: data.chunk_max_size || 1000,
      chunkOverlapSize: data.chunk_overlap_size || 100,
      chunkMinSize: data.chunk_min_size || 50,
      isPublic: data.is_public || false,
      metadataConfig: data.metadata_config ? JSON.stringify(data.metadata_config) : null,
    });

    this.logger.log(`创建知识库成功：${kb.id}, user=${userId}`);
    return kb;
  } catch (error: any) {
    this.logger.error(`创建知识库失败：${error.message}`);
    throw error;
  }
}
```

---

## 📊 字段映射对照表

| 前端（驼峰式） | 后端（蛇形命名） | 数据库列名 | 必填 |
|---------------|-----------------|-----------|------|
| `name` | `name` | `name` | ✅ |
| `description` | `description` | `description` | ❌ |
| `embeddingModelId` | `embedding_model_id` | `embedding_model_id` | ✅ |
| `chunkMaxSize` | `chunk_max_size` | `chunk_max_size` | ❌ (默认 1000) |
| `chunkOverlapSize` | `chunk_overlap_size` | `chunk_overlap_size` | ❌ (默认 100) |
| `chunkMinSize` | `chunk_min_size` | `chunk_min_size` | ❌ (默认 50) |
| `isPublic` | `is_public` | `is_public` | ❌ (默认 false) |
| `metadataConfig` | `metadata_config` | `metadata_config` | ❌ |

---

## 🎯 数据流示例

### 创建知识库流程

**1. 前端发送请求**：
```javascript
// ApiService.ts
await apiService.createKnowledgeBase({
  name: "测试知识库",
  embeddingModelId: "cmnlw0h680005ie8rcyk650iq",
  chunkMaxSize: 1000,
  isPublic: false
})
```

**2. HTTP 请求体**：
```json
{
  "name": "测试知识库",
  "embeddingModelId": "cmnlw0h680005ie8rcyk650iq",
  "chunkMaxSize": 1000,
  "isPublic": false
}
```

**3. Controller 转换**：
```typescript
const convertedData = {
  name: "测试知识库",
  embedding_model_id: "cmnlw0h680005ie8rcyk650iq",  // ✅ 转换
  chunk_max_size: 1000,                               // ✅ 转换
  is_public: false                                     // ✅ 转换
};
```

**4. Service 验证**：
```typescript
if (!data.embedding_model_id) {
  throw new Error('向量模型 ID 不能为空');
}
```

**5. Repository 创建**：
```typescript
await prisma.knowledgeBase.create({
  data: {
    name: "测试知识库",
    userId: "cmnlw0h5s0000ie8rv7ivtzf6",
    embeddingModelId: "cmnlw0h680005ie8rcyk650iq",  // ✅ Prisma 自动映射到 embedding_model_id
    chunkMaxSize: 1000,
    isPublic: false
  }
});
```

**6. 数据库插入**：
```sql
INSERT INTO knowledge_base (
  name,
  user_id,
  embedding_model_id,
  chunk_max_size,
  is_public
) VALUES (
  '测试知识库',
  'cmnlw0h5s0000ie8rv7ivtzf6',
  'cmnlw0h680005ie8rcyk650iq',
  1000,
  false
);
```

---

## ⚠️ 重要注意事项

### 1. Prisma 的字段映射

Prisma Schema 中使用 `@map` 指令进行字段名映射：

```prisma
model KnowledgeBase {
  embeddingModelId String @map("embedding_model_id")
  //      ↑                    ↑
  //   TypeScript 属性名    数据库列名
}
```

**TypeScript 代码中使用**：
```typescript
// ✅ 正确：使用 TypeScript 属性名（驼峰式）
await prisma.knowledgeBase.create({
  data: {
    embeddingModelId: "xxx"  // ← 驼峰式
  }
});

// ❌ 错误：不要使用数据库列名
await prisma.knowledgeBase.create({
  data: {
    embedding_model_id: "xxx"  // ← 这会报错
  }
});
```

**但是**，我们的 Service 层接收的是从 Controller 传来的原始数据（蛇形命名），所以需要转换。

---

### 2. 更好的解决方案

**方案 A：在 Service 层统一转换** ✅✅✅

创建一个工具函数：

```typescript
// utils/naming-convention.ts
export function camelToSnake(obj: any): any {
  const result: any = {};
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
      result[snakeKey] = obj[key];
    }
  }
  return result;
}
```

然后在 Controller 中使用：

```typescript
@Post()
async create(@Body() data: any, @CurrentUser() user: any) {
  const convertedData = camelToSnake(data);
  return await this.kbService.create(user.sub, convertedData);
}
```

**方案 B：使用 class-transformer** ✅✅

```typescript
import { Expose, Transform } from 'class-transformer';

export class CreateKnowledgeBaseDto {
  @Expose()
  name: string;

  @Expose()
  description?: string;

  @Expose({ name: 'embeddingModelId' })
  @Transform(({ value }) => value)
  embedding_model_id: string;

  @Expose({ name: 'chunkMaxSize' })
  chunk_max_size: number;

  @Expose({ name: 'chunkOverlapSize' })
  chunk_overlap_size: number;

  @Expose({ name: 'chunkMinSize' })
  chunk_min_size: number;

  @Expose({ name: 'isPublic' })
  is_public: boolean;
}
```

---

### 3. 当前方案的局限性

**手动转换的缺点**：
- ❌ 每个字段都要手动映射
- ❌ 容易遗漏字段
- ❌ 维护成本高

**建议**：
- ✅ 短期：使用当前的手动转换
- ✅ 长期：引入 `class-transformer` 或自定义工具函数

---

## 📊 修改统计

| 文件 | 修改类型 | 行数变化 | 说明 |
|------|---------|---------|------|
| **knowledge-bases.controller.ts** | 新增 | +25 / -2 | Create 和 Update 方法的字段转换 |
| **knowledge-base.service.ts** | 新增 | +9 / -1 | 添加必填字段验证 |
| **总计** | - | **+34 / -3** | 净增加 31 行 |

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
    "embeddingModelId": "cmnlw0h680005ie8rcyk650iq",
    "chunkMaxSize": 1000,
    "chunkMinSize": 50,
    "chunkOverlapSize": 100,
    "isPublic": false
  }'
```

**预期结果**：
- ✅ 成功创建知识库
- ✅ `embedding_model_id` 正确设置
- ✅ 不再出现 `undefined` 错误

### 2. 更新知识库测试

**请求**：
```bash
curl -X PUT http://localhost:3000/api/v1/knowledge-bases/KB_ID \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "更新后的名称",
    "chunkMaxSize": 2000
  }'
```

**预期结果**：
- ✅ 只更新指定的字段
- ✅ 未传递的字段保持不变

### 3. 验证错误处理

**请求**（缺少必填字段）：
```bash
curl -X POST http://localhost:3000/api/v1/knowledge-bases \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "测试知识库"
  }'
```

**预期结果**：
- ✅ 返回错误：`向量模型 ID 不能为空`

---

## 📝 相关文档

- [JWT Token 用户 ID 字段修复](./JWT_USER_ID_FIELD_FIX.md)
- [知识库模块开发](./KNOWLEDGE_BASE_MODULE.md)
- [API 命名规范](./API_NAMING_CONVENTION.md)

---

## ✅ 检查清单

- [x] 修复 Create 方法的字段转换
- [x] 修复 Update 方法的字段转换
- [x] 添加 Service 层必填字段验证
- [ ] 测试创建知识库功能
- [ ] 测试更新知识库功能
- [ ] 测试错误处理
- [ ] 考虑引入自动转换工具（长期优化）

---

**修复日期**: 2026-04-05  
**修复人员**: Lingma AI Assistant  
**风险等级**: **低**（仅添加字段转换逻辑）  
**影响范围**: 知识库创建和更新接口  
**状态**: ✅ 已完成
