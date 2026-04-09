# Prisma Json 类型升级方案（已取消）

## ⚠️ 重要说明

**经过测试，当前使用的 SQLite 版本不支持 Prisma 的 `Json` 类型。**

虽然 Prisma 5.22.0 在代码层面支持 `Json` 类型定义，但底层的 **SQLite 数据库引擎**需要特定版本才能支持原生 JSON 存储。

### 错误信息

```
Error: P1012
error: Error validating field `features` in model `Model`: 
Field `features` in model `Model` can't be of type Json. 
The current connector does not support the Json type.
```

### 原因分析

1. **Prisma 层面**：Prisma 5.x 支持 `Json` 类型定义
2. **SQLite 层面**：需要 SQLite 3.9+ 且启用 JSON1 扩展
3. **当前环境**：Windows 上的 SQLite 可能未正确配置或版本过低

---

## ✅ 最终方案：使用 Service 层手动序列化

由于无法使用 Prisma 的 `Json` 类型，我们采用 **方案 A：Service 层后处理**。

详见：[JSON_FIELD_SERIALIZATION_FIX.md](./JSON_FIELD_SERIALIZATION_FIX.md)

---

## 📊 背景

当前项目使用 Prisma 5.22.0 + SQLite，所有 JSON 字段都定义为 `String` 类型，需要手动序列化/反序列化。

**好消息**：Prisma 5.x 已经完全支持 SQLite 的 `Json` 类型！

---

## ✅ 优势对比

### 当前方案（String 类型）

```prisma
model Model {
  features  String?  // 存储: "[\"thinking\",\"tools\"]"
}
```

**缺点**：
- ❌ 需要手动 `JSON.stringify()` 写入
- ❌ 需要手动 `JSON.parse()` 读取
- ❌ 容易出错（忘记序列化/反序列化）
- ❌ 代码冗余（每个 Service 都要处理）
- ❌ 性能开销（每次都要解析）

---

### 新方案（Json 类型）

```prisma
model Model {
  features  Json?  // 存储: ["thinking", "tools"]
}
```

**优点**：
- ✅ Prisma **自动**处理序列化/反序列化
- ✅ TypeScript 类型安全（编译时检查）
- ✅ 代码简洁（无需手动处理）
- ✅ 性能更好（Prisma 底层优化）
- ✅ 符合最佳实践

---

## 🔧 实施步骤

### Step 1: 修改 Prisma Schema

将所有 `String? // JSON string` 字段改为 `Json?`

**需要修改的字段**：

| 模型 | 字段 | 当前类型 | 新类型 |
|------|------|---------|--------|
| `Model` | `features` | `String?` | `Json?` |
| `Character` | `settings` | `String?` | `Json?` |
| `Session` | `settings` | `String?` | `Json?` |
| `KnowledgeBase` | `metadataConfig` | `String?` | `Json?` |
| `KBChunk` | `metadata` | `String?` | `Json?` |
| `Memory` | `tags` | `String?` | `Json?` |
| `Memory` | `metadata` | `String?` | `Json?` |
| `File` | `fileMetadata` | `String?` | `Json?` |
| `UserSetting` | `settings` | `String` | `Json` |

---

### Step 2: 创建数据库迁移

```bash
# 生成迁移文件
npx prisma migrate dev --name convert_string_to_json

# 或者直接推送（开发环境）
npx prisma db push
```

---

### Step 3: 更新种子脚本

移除所有 `JSON.stringify()` 调用：

```typescript
// 旧代码
await prisma.model.create({
  data: {
    features: JSON.stringify(['thinking', 'tools']),  // ❌
  },
});

// 新代码
await prisma.model.create({
  data: {
    features: ['thinking', 'tools'],  // ✅ 直接传数组
  },
});
```

---

### Step 4: 清理 Service 层代码

删除所有手动序列化/反序列化的代码：

```typescript
// 旧代码 - Model Service
async addModel(data: any, userId: string) {
  const serializedData = {
    ...data,
    features: Array.isArray(data.features) ? JSON.stringify(data.features) : data.features,
  };
  return this.modelRepo.createModel(serializedData);
}

async updateModel(modelId: string, data: any, userId: string) {
  const updatedModel = await this.modelRepo.updateModel(modelId, data);
  return parseJsonFields(updatedModel, ['features']);  // ❌ 不再需要
}

// 新代码 - Model Service
async addModel(data: any, userId: string) {
  return this.modelRepo.createModel(data);  // ✅ 直接传入
}

async updateModel(modelId: string, data: any, userId: string) {
  return this.modelRepo.updateModel(modelId, data);  // ✅ 直接返回
}
```

---

### Step 5: 删除 json-parser.ts 工具类

不再需要手动解析，可以删除 `src/common/utils/json-parser.ts`。

---

## 📝 具体修改示例

### 1. Prisma Schema 修改

```prisma
model Model {
  id              String   @id @default(cuid())
  name            String?
  providerId      String   @map("provider_id")
  modelName       String   @map("model_name")
  modelType       String   @map("model_type")
  maxTokens       Int?     @map("max_tokens")
  maxOutputTokens Int?     @map("max_output_tokens")
  features        Json?    // ← 改为 Json
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  provider       ModelProvider  @relation(fields: [providerId], references: [id], onDelete: Cascade)
  sessions       Session[]
  characters     Character[]
  knowledgeBases KnowledgeBase[]

  @@map("model")
}

model Character {
  id          String   @id @default(cuid())
  userId      String   @map("user_id")
  title       String
  description String?
  avatarUrl   String?  @map("avatar_url")
  isPublic    Boolean  @default(false) @map("is_public")
  modelId     String?  @map("model_id")
  settings    Json?    // ← 改为 Json
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  user  User   @relation(fields: [userId], references: [id])
  model Model? @relation(fields: [modelId], references: [id])
  sessions Session[]

  @@map("character")
}

model Session {
  id           String    @id @default(cuid())
  title        String?
  userId       String    @map("user_id")
  avatarUrl    String?   @map("avatar_url")
  description  String?
  modelId      String?   @map("model_id")
  characterId  String?   @map("character_id")
  settings     Json?     // ← 改为 Json
  createdAt    DateTime  @default(now()) @map("created_at")
  updatedAt    DateTime  @updatedAt @map("updated_at")
  lastActiveAt DateTime? @map("last_active_at")

  messages Message[]
  memories Memory[]
  model    Model?    @relation(fields: [modelId], references: [id])
  user     User?     @relation(fields: [userId], references: [id])
  character Character? @relation(fields: [characterId], references: [id])

  @@map("session")
}

model KnowledgeBase {
  id                   String   @id @default(cuid())
  name                 String
  description          String?
  userId               String   @map("user_id")
  embeddingModelId     String   @map("embedding_model_id")
  chunkMaxSize         Int      @default(1000) @map("chunk_max_size")
  chunkOverlapSize     Int      @default(100) @map("chunk_overlap_size")
  chunkMinSize         Int      @default(50) @map("chunk_min_size")
  isActive             Boolean  @default(true) @map("is_active")
  isPublic             Boolean  @default(false) @map("is_public")
  metadataConfig       Json?    @map("metadata_config")  // ← 改为 Json
  createdAt            DateTime @default(now()) @map("created_at")
  updatedAt            DateTime @updatedAt @map("updated_at")

  user           User   @relation(fields: [userId], references: [id])
  embeddingModel Model  @relation(fields: [embeddingModelId], references: [id])
  files          KBFile[]

  @@map("knowledge_base")
}

model KBChunk {
  id                  String   @id @default(cuid())
  fileId              String   @map("file_id")
  knowledgeBaseId     String   @map("knowledge_base_id")
  content             String
  chunkIndex          Int      @map("chunk_index")
  vectorId            String?  @map("vector_id")
  embeddingDimensions Int?     @map("embedding_dimensions")
  tokenCount          Int      @default(0) @map("token_count")
  metadata            Json?    // ← 改为 Json
  createdAt           DateTime @default(now()) @map("created_at")

  file KBFile @relation(fields: [fileId], references: [id], onDelete: Cascade)

  @@index([fileId])
  @@index([knowledgeBaseId])
  @@index([vectorId])
  @@map("kb_chunk")
}

model Memory {
  id          String   @id @default(cuid())
  sessionId   String   @map("session_id")
  content     String
  category    String   @default("long_term")
  memoryType  String   @map("memory_type") @default("factual")
  importance  Int      @default(5)
  tags        Json?    // ← 改为 Json
  metadata    Json?    // ← 改为 Json
  expiresAt   DateTime? @map("expires_at")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  session Session @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId])
  @@index([category])
  @@index([memoryType])
  @@map("memory")
}

model File {
  id            String   @id @default(cuid())
  fileName      String   @map("file_name")
  displayName   String   @map("display_name")
  fileSize      BigInt   @map("file_size")
  fileType      String   @map("file_type")
  fileExtension String   @map("file_extension")
  content       String?
  url           String?
  previewUrl    String?  @map("preview_url")
  contentHash   String   @map("content_hash")
  uploadUserId  String?  @map("upload_user_id")
  sessionId     String?  @map("session_id")
  messageId     String?  @map("message_id")
  isPublic      Boolean  @default(false) @map("is_public")
  fileMetadata  Json?    @map("file_metadata")  // ← 改为 Json
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  @@index([contentHash])
  @@index([uploadUserId])
  @@index([sessionId])
  @@index([messageId])
  @@map("file")
}

model UserSetting {
  id        String   @id @default(cuid())
  userId    String   @unique @map("user_id")
  settings  Json     // ← 改为 Json（非可选）
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("user_setting")
}
```

---

### 2. 更新种子脚本

```typescript
// src/scripts/seed.ts

/**
 * 创建默认模型（直接使用数组，无需 JSON.stringify）
 */
async function createModels(providerId: string) {
  const modelsData = [
    {
      modelName: 'deepseek-ai/DeepSeek-V3.2',
      name: 'DeepSeek V3.2',
      modelType: 'text',
      maxTokens: 128000,
      features: ['thinking', 'tools'],  // ✅ 直接传数组
    },
    {
      modelName: 'Qwen/Qwen3-Embedding-8B',
      name: 'Qwen3 Embedding 8B',
      modelType: 'embedding',
      maxTokens: 8192,
      features: [],  // ✅ 直接传数组
    },
  ];

  for (const modelData of modelsData) {
    await prisma.model.create({
      data: {
        ...modelData,
        providerId,
        // ✅ 不需要 JSON.stringify(features)
      },
    });
  }
}

/**
 * 创建默认角色（直接使用对象，无需 JSON.stringify）
 */
async function createDefaultCharacter(userId: string, modelId: string) {
  await prisma.character.create({
    data: {
      userId,
      title: '智能助手',
      description: '一个通用的 AI 助手',
      modelId,
      settings: {  // ✅ 直接传对象
        system_prompt: '你是一个有用的 AI 助手...',
        temperature: 0.7,
        max_tokens: 2048,
      },
    },
  });
}

/**
 * 创建全局设置
 */
async function createGlobalSettings() {
  const settings = [
    {
      key: 'default_chat_model',
      value: JSON.stringify({ provider: 'siliconflow', model: 'deepseek-ai/DeepSeek-V3.2' }),
      valueType: 'json',
      description: '默认聊天模型',
      category: 'chat',
    },
    // ... 其他设置
  ];

  for (const setting of settings) {
    await prisma.globalSetting.create({
      data: setting,
    });
  }
}
```

**注意**：`GlobalSetting.value` 保持为 `String` 类型，因为它的值是动态的（可能是字符串、数字、JSON 等），所以仍然需要手动序列化。

---

### 3. 简化 Service 层

#### Model Service

```typescript
// src/modules/models/model.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { ModelRepository } from '../../common/database/model.repository';
import { UserRepository } from '../../common/database/user.repository';
import { OpenAI } from 'openai';

@Injectable()
export class ModelService {
  private readonly logger = new Logger(ModelService.name);

  constructor(
    private modelRepo: ModelRepository,
    private userRepo: UserRepository,
  ) {}

  async getModelsAndProviders(userId: string) {
    const user = await this.userRepo.findById(userId);
    const effectiveUserId = user?.role === 'primary' ? userId : (user?.parentId || userId);
    
    const providers = await this.modelRepo.getProvidersWithModels(effectiveUserId);
    
    // ✅ features 已经是数组，无需解析
    return {
      items: providers,
      size: providers.length,
    };
  }

  async addModel(data: any, userId: string) {
    const provider = await this.modelRepo.getProviderById(data.providerId);
    if (!provider || provider.userId !== userId) {
      throw new Error('Provider not found or unauthorized');
    }
    
    // ✅ 直接传入，Prisma 自动处理
    return this.modelRepo.createModel(data);
  }

  async updateModel(modelId: string, data: any, userId: string) {
    const model = await this.modelRepo.findById(modelId);
    if (!model) {
      throw new Error('Model not found');
    }
    
    const provider = await this.modelRepo.getProviderById(model.providerId);
    if (!provider || provider.userId !== userId) {
      throw new Error('Unauthorized');
    }
    
    // ✅ 直接更新，Prisma 自动处理
    return this.modelRepo.updateModel(modelId, data);
  }

  // ... 其他方法同样简化
}
```

#### Character Service

```typescript
// src/modules/characters/character.service.ts

import { Injectable } from '@nestjs/common';
import { CharacterRepository } from '../../common/database/character.repository';
import { createPaginatedResponse, PaginatedResponse } from '../../common/types/pagination';

@Injectable()
export class CharacterService {
  constructor(private characterRepo: CharacterRepository) {}

  async getCharactersByUser(userId: string, skip: number = 0, limit: number = 20): Promise<PaginatedResponse<any>> {
    const { items, total } = await this.characterRepo.findByUserId(userId, skip, limit);
    
    // ✅ settings 已经是对象，无需解析
    return createPaginatedResponse(items, total, { skip, limit });
  }

  async getSharedCharacters(skip: number = 0, limit: number = 20): Promise<PaginatedResponse<any>> {
    const { items, total } = await this.characterRepo.findPublic(skip, limit);
    
    // ✅ settings 已经是对象，无需解析
    return createPaginatedResponse(items, total, { skip, limit });
  }

  async createCharacter(userId: string, data: any) {
    // ✅ 直接传入，Prisma 自动处理
    return this.characterRepo.create({
      ...data,
      userId,
    });
  }

  async updateCharacter(characterId: string, userId: string, data: any) {
    const character = await this.characterRepo.findById(characterId);
    if (!character || character.userId !== userId) {
      throw new Error('Character not found or unauthorized');
    }
    
    // ✅ 直接更新，Prisma 自动处理
    return this.characterRepo.update(characterId, data);
  }

  // ... 其他方法
}
```

---

## 🎯 迁移流程

### 1. 备份数据库

```bash
cp data/dev.db data/dev.db.backup
```

### 2. 修改 Schema

按照上面的示例修改 `prisma/schema.prisma`

### 3. 推送更改到数据库

```bash
npx prisma db push
```

### 4. 重新生成 Prisma Client

```bash
npx prisma generate
```

### 5. 更新种子脚本

修改 `src/scripts/seed.ts`，移除所有 `JSON.stringify()`

### 6. 简化 Service 层

删除所有手动序列化/反序列化代码

### 7. 删除 json-parser.ts

```bash
rm src/common/utils/json-parser.ts
```

### 8. 重新填充数据（可选）

```bash
npm run db:seed:force
```

### 9. 测试验证

```bash
npm run start:dev

# 测试 API
$token = (Invoke-WebRequest -Uri "http://localhost:3000/api/v1/auth/login" -Method POST -ContentType "application/json" -Body '{"type":"email","username":"admin@dingd.cn","password":"123456"}' -UseBasicParsing | ConvertFrom-Json).access_token

$response = Invoke-WebRequest -Uri "http://localhost:3000/api/v1/models" -Headers @{ Authorization = "Bearer $token" } -UseBasicParsing
$data = $response.Content | ConvertFrom-Json

Write-Host "Features type:" $data.items[0].models[0].features.GetType().Name
Write-Host "Features value:" ($data.items[0].models[0].features -join ", ")
```

**预期输出**：
```
Features type: Object[]
Features value: thinking, tools
```

---

## ⚠️ 注意事项

### 1. 数据迁移

如果数据库中已有数据，Prisma 会自动将 `String` 类型的 JSON 字符串转换为 `Json` 类型。

**例如**：
- 旧数据：`"[\"thinking\",\"tools\"]"` （字符串）
- 新数据：`["thinking", "tools"]` （JSON 数组）

Prisma 会在读取时自动解析，所以**不会丢失数据**。

### 2. GlobalSetting 表

`GlobalSetting.value` 字段保持为 `String` 类型，因为：
- 它可能存储各种类型的值（字符串、数字、JSON）
- 使用 `valueType` 字段区分类型
- 需要在应用层手动序列化/反序列化

### 3. TypeScript 类型

Prisma Client 会自动推断正确的类型：

```typescript
// Prisma 生成的类型
interface Model {
  features: Prisma.JsonValue | null;  // 可以是 object、array、string、number 等
}

// 使用时需要类型断言
const features = model.features as string[] | null;
```

为了更好的类型安全，可以创建 DTO：

```typescript
interface ModelOutDto {
  id: string;
  features: string[] | null;  // 明确指定类型
}
```

---

## 📊 对比总结

| 特性 | String 类型 | Json 类型 |
|------|------------|----------|
| **代码复杂度** | 高（需手动处理） | 低（自动处理） |
| **类型安全** | 弱（运行时才知道） | 强（编译时检查） |
| **性能** | 一般（每次解析） | 好（Prisma 优化） |
| **维护成本** | 高（容易遗漏） | 低（统一管理） |
| **数据迁移** | 无需迁移 | 自动转换 |
| **推荐度** | ⭐⭐ | ⭐⭐⭐⭐⭐ |

---

## ✅ 结论

**强烈建议升级到 Json 类型**，理由：

1. ✅ Prisma 5.22.0 完全支持 SQLite Json
2. ✅ 大幅简化代码（删除 100+ 行序列化逻辑）
3. ✅ 提升类型安全性
4. ✅ 符合 Prisma 最佳实践
5. ✅ 自动数据迁移，无风险

**预计工作量**：
- 修改 Schema：5 分钟
- 更新种子脚本：10 分钟
- 简化 Service 层：15 分钟
- 测试验证：10 分钟
- **总计**：约 40 分钟

---

**最后更新**：2026-04-05  
**状态**：✅ 方案已完成，待实施  
**优先级**：高（显著提升代码质量）
