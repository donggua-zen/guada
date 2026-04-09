# Prisma 字段命名规范说明

## 📋 核心原则

**Prisma 使用 TypeScript 属性名（驼峰式），自动映射到数据库列名（蛇形命名）。**

---

## 🔍 Prisma Schema 映射机制

### Schema 定义

```prisma
model KnowledgeBase {
  id                   String   @id @default(cuid())
  name                 String
  userId               String   @map("user_id")              // ← 数据库列名是 user_id
  embeddingModelId     String   @map("embedding_model_id")   // ← 数据库列名是 embedding_model_id
  chunkMaxSize         Int      @default(1000) @map("chunk_max_size")
  isPublic             Boolean  @default(false) @map("is_public")
  
  @@map("knowledge_base")  // ← 数据库表名是 knowledge_base
}
```

### TypeScript 代码中使用

```typescript
// ✅ 正确：使用 TypeScript 属性名（驼峰式）
await prisma.knowledgeBase.create({
  data: {
    name: "测试",
    userId: "user_123",           // ← 驼峰式
    embeddingModelId: "model_456", // ← 驼峰式
    chunkMaxSize: 1000,            // ← 驼峰式
    isPublic: false                // ← 驼峰式
  }
});

// ❌ 错误：不要使用数据库列名
await prisma.knowledgeBase.create({
  data: {
    user_id: "user_123",              // ← 这会报错！
    embedding_model_id: "model_456",  // ← 这会报错！
    chunk_max_size: 1000,             // ← 这会报错！
    is_public: false                  // ← 这会报错！
  }
});
```

---

## 🎯 数据流示例

### 完整的请求流程

**1. 前端发送（驼峰式）**：
```json
{
  "name": "测试知识库",
  "embeddingModelId": "model_456",
  "chunkMaxSize": 1000,
  "isPublic": false
}
```

**2. Controller 接收**：
```typescript
@Post()
async create(@Body() data: any, @CurrentUser() user: any) {
  // data.embeddingModelId = "model_456"  ← 驼峰式
  return await this.kbService.create(user.sub, data);
}
```

**3. Service 处理**：
```typescript
async create(userId: string, data: any) {
  const kb = await this.kbRepo.create({
    name: data.name,
    userId: userId,
    embeddingModelId: data.embeddingModelId,  // ← 驼峰式
    chunkMaxSize: data.chunkMaxSize,
    isPublic: data.isPublic,
  });
}
```

**4. Repository 调用 Prisma**：
```typescript
async create(data: any) {
  return this.prisma.knowledgeBase.create({
    data,  // ← 包含驼峰式属性名
  });
}
```

**5. Prisma 执行 SQL**：
```sql
INSERT INTO knowledge_base (
  name,
  user_id,                    -- ← Prisma 自动映射
  embedding_model_id,         -- ← Prisma 自动映射
  chunk_max_size,             -- ← Prisma 自动映射
  is_public                   -- ← Prisma 自动映射
) VALUES (
  '测试知识库',
  'user_123',
  'model_456',
  1000,
  false
);
```

---

## ⚠️ 常见错误

### 错误 1：在 TypeScript 代码中使用数据库列名

```typescript
// ❌ 错误
await prisma.knowledgeBase.create({
  data: {
    embedding_model_id: "xxx"  // ← 这是数据库列名，不是 TypeScript 属性名
  }
});

// ✅ 正确
await prisma.knowledgeBase.create({
  data: {
    embeddingModelId: "xxx"  // ← 这是 TypeScript 属性名
  }
});
```

**错误信息**：
```
PrismaClientValidationError: 
Unknown arg `embedding_model_id` in data.embedding_model_id
```

---

### 错误 2：不必要的字段转换

```typescript
// ❌ 错误：多余的转换
@Post()
async create(@Body() data: any) {
  const convertedData = {
    embedding_model_id: data.embeddingModelId,  // ← 不需要转换
    chunk_max_size: data.chunkMaxSize,          // ← 不需要转换
  };
  return await this.service.create(convertedData);
}

// ✅ 正确：直接传递
@Post()
async create(@Body() data: any) {
  return await this.service.create(data);  // ← 直接使用
}
```

---

## 📊 命名对照表

| 层级 | 命名方式 | 示例 |
|------|---------|------|
| **前端 JSON** | 驼峰式 | `embeddingModelId` |
| **TypeScript 对象** | 驼峰式 | `data.embeddingModelId` |
| **Prisma Schema 属性** | 驼峰式 | `embeddingModelId` |
| **Prisma Client API** | 驼峰式 | `embeddingModelId: "xxx"` |
| **数据库列名** | 蛇形命名 | `embedding_model_id` |
| **SQL 语句** | 蛇形命名 | `INSERT INTO ... (embedding_model_id)` |

---

## 🎓 关键理解

### Prisma 的 `@map` 指令

```prisma
embeddingModelId String @map("embedding_model_id")
//      ↑                       ↑
//   TypeScript 属性名      数据库列名
```

**作用**：
- 在 **TypeScript 代码**中使用 `embeddingModelId`
- Prisma 自动将其映射到数据库的 `embedding_model_id` 列
- **开发者无需手动转换**

---

### 为什么不需要转换？

**原因**：
1. ✅ Prisma Client 是 TypeScript 原生的
2. ✅ Prisma 在编译时生成类型定义
3. ✅ Prisma 运行时自动处理字段映射
4. ✅ 整个 TypeScript 层都使用驼峰式

**好处**：
- ✅ 代码更简洁
- ✅ 类型安全
- ✅ 减少出错
- ✅ 符合 JavaScript/TypeScript 规范

---

## 🔧 最佳实践

### 1. 全程使用驼峰式

```typescript
// ✅ 推荐：前端 → 后端 → Prisma 全程驼峰式
const data = {
  embeddingModelId: "xxx",
  chunkMaxSize: 1000,
  isPublic: false
};

await prisma.knowledgeBase.create({ data });
```

### 2. 避免手动转换

```typescript
// ❌ 不推荐
const converted = {
  embedding_model_id: data.embeddingModelId,
  chunk_max_size: data.chunkMaxSize
};

// ✅ 推荐
const data = {
  embeddingModelId: data.embeddingModelId,
  chunkMaxSize: data.chunkMaxSize
};
```

### 3. 使用 TypeScript 类型

```typescript
interface CreateKnowledgeBaseInput {
  name: string;
  embeddingModelId: string;  // ← 驼峰式
  chunkMaxSize?: number;
  isPublic?: boolean;
}

async create(data: CreateKnowledgeBaseInput) {
  return await this.kbRepo.create(data);  // ← 类型安全
}
```

---

## 📝 总结

**核心规则**：
> **在 TypeScript 代码中，始终使用 Prisma Schema 定义的属性名（驼峰式），Prisma 会自动处理数据库列名映射。**

**记住**：
- ✅ TypeScript 层：驼峰式（`embeddingModelId`）
- ✅ 数据库层：蛇形命名（`embedding_model_id`）
- ✅ Prisma 自动映射，无需手动转换

---

**文档日期**: 2026-04-05  
**适用项目**: ai_chat backend-ts  
**状态**: ✅ 已应用
