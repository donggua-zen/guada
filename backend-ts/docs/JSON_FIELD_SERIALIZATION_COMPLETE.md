# JSON 字段序列化修复 - 完成报告

## ✅ 问题背景

TypeScript 后端中，所有定义为 `String` 类型的 JSON 字段在 API 响应中都返回**原始 JSON 字符串**，而非解析后的对象/数组。

**受影响字段**：
- `Model.features` - 应为 `string[]`，实际返回 `"[\"thinking\",\"tools\"]"`
- `Character.settings` - 应为 `object`，实际返回 JSON 字符串
- `Session.settings` - 应为 `object`，实际返回 JSON 字符串
- `KnowledgeBase.metadataConfig` - 应为 `object`，实际返回 JSON 字符串
- 其他 JSON 字段...

---

## 🔍 尝试使用 Prisma Json 类型

### 测试结果

❌ **失败**：当前 SQLite 版本不支持 Prisma 的 `Json` 类型

**错误信息**：
```
Error: P1012
error: Error validating field `features` in model `Model`: 
Field `features` in model `Model` can't be of type Json. 
The current connector does not support the Json type.
```

### 原因分析

1. **Prisma 层面**：Prisma 5.22.0 支持 `Json` 类型定义
2. **SQLite 层面**：需要 SQLite 3.9+ 且启用 JSON1 扩展
3. **当前环境**：Windows 上的 SQLite 未正确配置或版本过低

**详见**：[PRISMA_JSON_TYPE_UPGRADE.md](./PRISMA_JSON_TYPE_UPGRADE.md)

---

## ✅ 最终方案：Service 层手动序列化

采用 **方案 A：Service 层后处理**，通过工具类统一处理 JSON 字段的序列化和反序列化。

---

## 🛠️ 实施内容

### 1. 创建 JSON 解析工具类

**文件**：`src/common/utils/json-parser.ts`

提供三个核心函数：

```typescript
// 读取时：解析 JSON 字符串为对象/数组
parseJsonFields(obj, ['features', 'settings'])

// 批量解析数组
parseJsonFieldsArray(items, ['features', 'settings'])

// 写入时：序列化对象/数组为 JSON 字符串
serializeJsonFields(data, ['features', 'settings'])
```

**特点**：
- ✅ 类型安全（TypeScript 泛型）
- ✅ 错误处理（解析失败时保持原值）
- ✅ 灵活配置（指定需要处理的字段）

---

### 2. 修复 Model Service

**文件**：`src/modules/models/model.service.ts`

**修改内容**：

#### 读取时解析
```typescript
async getModelsAndProviders(userId: string) {
  const providers = await this.modelRepo.getProvidersWithModels(effectiveUserId);
  
  // ✅ 解析每个 provider 下模型的 features 字段
  const parsedProviders = providers.map(provider => ({
    ...provider,
    models: parseJsonFieldsArray(provider.models || [], ['features']),
  }));
  
  return { items: parsedProviders, size: parsedProviders.length };
}
```

#### 写入时序列化
```typescript
async addModel(data: any, userId: string) {
  // ✅ 序列化 features 字段
  const serializedData = {
    ...data,
    features: Array.isArray(data.features) ? JSON.stringify(data.features) : data.features,
  };
  
  return this.modelRepo.createModel(serializedData);
}

async updateModel(modelId: string, data: any, userId: string) {
  // ✅ 序列化 features 字段
  const serializedData = {
    ...data,
    ...(data.features && { 
      features: Array.isArray(data.features) ? JSON.stringify(data.features) : data.features 
    }),
  };
  
  const updatedModel = await this.modelRepo.updateModel(modelId, serializedData);
  
  // ✅ 解析返回的 features 字段
  return parseJsonFields(updatedModel, ['features']);
}
```

---

### 3. 修复 Character Service

**文件**：`src/modules/characters/character.service.ts`

**修改内容**：

#### 列表查询
```typescript
async getCharactersByUser(userId: string, skip: number = 0, limit: number = 20) {
  const { items, total } = await this.characterRepo.findByUserId(userId, skip, limit);
  
  // ✅ 解析 settings 字段
  const parsedItems = parseJsonFieldsArray(items, ['settings']);
  
  return createPaginatedResponse(parsedItems, total, { skip, limit });
}
```

#### 创建/更新
```typescript
async createCharacter(userId: string, data: any) {
  // ✅ 序列化 settings 字段
  const serializedData = {
    ...data,
    userId,
    ...(data.settings && { 
      settings: typeof data.settings === 'object' ? JSON.stringify(data.settings) : data.settings 
    }),
  };
  
  const character = await this.characterRepo.create(serializedData);
  
  // ✅ 解析返回的 settings 字段
  return parseJsonFields(character, ['settings']);
}
```

---

### 4. 修复 Session Service

**文件**：`src/modules/chat/session.service.ts`

**修改内容**：

#### 列表查询
```typescript
async getSessionsByUser(userId: string, skip: number = 0, limit: number = 20) {
  const { items, total } = await this.sessionRepo.findByUserId(userId, skip, limit);
  
  // ✅ 解析 settings 字段
  const parsedItems = parseJsonFieldsArray(items, ['settings']);
  
  return createPaginatedResponse(parsedItems, total, { skip, limit });
}
```

#### 单个查询
```typescript
async getSessionById(sessionId: string, userId?: string) {
  const session = await this.sessionRepo.findById(sessionId);
  
  if (userId && (!session || session.userId !== userId)) {
    throw new Error('Session not found or unauthorized');
  }
  
  // ✅ 解析 settings 字段
  return parseJsonFields(session, ['settings']);
}
```

#### 创建会话
```typescript
async createSession(userId: string, data: any) {
  // 合并设置（角色设置 + 用户设置）
  const mergedSettings = this.mergeSettings(character.settings, settings);
  
  const sessionData = {
    userId,
    characterId: character_id,
    title: title || character.title,
    // ... 其他字段
    settings: typeof mergedSettings === 'object' ? JSON.stringify(mergedSettings) : mergedSettings,
  };
  
  const session = await this.sessionRepo.create(sessionData);
  
  // ✅ 解析返回的 settings 字段
  return parseJsonFields(session, ['settings']);
}
```

#### 更新会话
```typescript
async updateSession(sessionId: string, userId: string, data: any) {
  const updateData: any = {};
  
  for (const key of allowedFields) {
    if (data[key] !== undefined) {
      updateData[key] = key === 'settings' && typeof data[key] === 'object' 
        ? JSON.stringify(data[key]) 
        : data[key];
    }
  }
  
  const updatedSession = await this.sessionRepo.update(sessionId, updateData);
  
  // ✅ 解析返回的 settings 字段
  return parseJsonFields(updatedSession, ['settings']);
}
```

---

## 📊 修复范围

| 模块 | JSON 字段 | 读取处理 | 写入处理 | 状态 |
|------|----------|---------|---------|------|
| **Models** | `features` | ✅ `parseJsonFields()` | ✅ `JSON.stringify()` | ✅ 已完成 |
| **Characters** | `settings` | ✅ `parseJsonFields()` | ✅ `JSON.stringify()` | ✅ 已完成 |
| **Sessions** | `settings` | ✅ `parseJsonFields()` | ✅ `JSON.stringify()` | ✅ 已完成 |
| **Knowledge Bases** | `metadataConfig` | ⏳ 待修复 | ⏳ 待修复 | ⏸️ 待实施 |
| **KB Chunks** | `metadata` | ⏳ 待修复 | ⏳ 待修复 | ⏸️ 待实施 |
| **Memories** | `tags`, `metadata` | ⏳ 待修复 | ⏳ 待修复 | ⏸️ 待实施 |
| **Files** | `fileMetadata` | ⏳ 待修复 | ⏳ 待修复 | ⏸️ 待实施 |
| **User Settings** | `settings` | ⏳ 待修复 | ⏳ 待修复 | ⏸️ 待实施 |

---

## 🧪 验证方法

### 1. 启动服务

```bash
cd backend-ts
npm run start:dev
```

**输出**：
```
Application is running on: http://localhost:3000
```

### 2. 获取 JWT Token

```powershell
$token = (Invoke-WebRequest -Uri "http://localhost:3000/api/v1/auth/login" -Method POST -ContentType "application/json" -Body '{"type":"email","username":"admin@dingd.cn","password":"123456"}' -UseBasicParsing | ConvertFrom-Json).access_token
```

### 3. 测试 Models 接口

```powershell
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

### 4. 测试 Characters 接口

```powershell
$response = Invoke-WebRequest -Uri "http://localhost:3000/api/v1/characters" -Headers @{ Authorization = "Bearer $token" } -UseBasicParsing
$data = $response.Content | ConvertFrom-Json

Write-Host "Settings type:" $data.items[0].settings.GetType().Name
Write-Host "Settings keys:" ($data.items[0].settings.PSObject.Properties.Name -join ", ")
```

**预期输出**：
```
Settings type: PSCustomObject
Settings keys: system_prompt, temperature, max_tokens
```

### 5. 前端验证

```typescript
// 在前端组件中
const models = await api.getModels();
console.log(models.items[0].models[0].features); 
// ✅ 应该输出: ["thinking", "tools"]
// ❌ 不应该输出: "[\"thinking\",\"tools\"]"

const characters = await api.getCharacters();
console.log(characters.items[0].settings.system_prompt);
// ✅ 应该可以直接访问嵌套属性
// ❌ 不应该需要先 JSON.parse()
```

---

## 📝 修改的文件清单

| 文件路径 | 修改内容 | 行数变化 |
|---------|---------|---------|
| `src/common/utils/json-parser.ts` | ✨ 新建工具类 | +66 |
| `src/modules/models/model.service.ts` | 🔧 添加 JSON 解析逻辑 | +29/-4 |
| `src/modules/characters/character.service.ts` | 🔧 添加 JSON 解析逻辑 | +35/-5 |
| `src/modules/chat/session.service.ts` | 🔧 添加 JSON 解析逻辑 | +25/-8 |
| `docs/PRISMA_JSON_TYPE_UPGRADE.md` | 📄 Json 类型升级方案（已取消） | +683 |
| `docs/JSON_FIELD_SERIALIZATION_FIX.md` | 📄 详细修复方案文档 | +653 |

**总计**：6 个文件，新增 ~1491 行，删除 ~17 行

---

## ⚠️ 注意事项

### 1. 向后兼容性

- ✅ 数据库中的数据保持不变（仍然是 JSON 字符串）
- ✅ API 响应格式改变（从字符串变为对象/数组）
- ⚠️ **前端需要同步更新**，移除手动的 `JSON.parse()` 调用

### 2. 错误处理

- ✅ `JSON.parse()` 失败时会捕获异常并记录警告
- ✅ 保持原值不变，避免崩溃

### 3. 性能考虑

- ⚠️ 每次查询都要执行 `JSON.parse()`
- 💡 对于大数据量场景，可以考虑缓存解析结果
- 💡 或者未来迁移到 PostgreSQL 后使用原生 `Json` 类型

### 4. 待修复模块

以下模块尚未修复，可按需实施：
- Knowledge Bases (`metadataConfig`)
- KB Chunks (`metadata`)
- Memories (`tags`, `metadata`)
- Files (`fileMetadata`)
- User Settings (`settings`)

**修复方式**：参考 Models/Characters/Sessions 的实现模式

---

## 🎯 最佳实践

### 统一的 JSON 字段处理模式

```typescript
// 1. 导入工具函数
import { parseJsonFields, parseJsonFieldsArray } from '../../common/utils/json-parser';

// 2. 读取时解析
async getList() {
  const items = await repo.findAll();
  return parseJsonFieldsArray(items, ['jsonField1', 'jsonField2']);
}

async getOne(id: string) {
  const item = await repo.findById(id);
  return parseJsonFields(item, ['jsonField1', 'jsonField2']);
}

// 3. 写入时序列化
async create(data: any) {
  const serializedData = {
    ...data,
    jsonField: typeof data.jsonField === 'object' 
      ? JSON.stringify(data.jsonField) 
      : data.jsonField,
  };
  
  const result = await repo.create(serializedData);
  return parseJsonFields(result, ['jsonField']);
}

async update(id: string, data: any) {
  const serializedData = {
    ...data,
    ...(data.jsonField && { 
      jsonField: typeof data.jsonField === 'object' 
        ? JSON.stringify(data.jsonField) 
        : data.jsonField 
    }),
  };
  
  const result = await repo.update(id, serializedData);
  return parseJsonFields(result, ['jsonField']);
}
```

---

## 📚 相关文档

- [JSON 字段序列化修复详细方案](./JSON_FIELD_SERIALIZATION_FIX.md)
- [Prisma Json 类型升级方案（已取消）](./PRISMA_JSON_TYPE_UPGRADE.md)
- [API 命名规范分析](./API_NAMING_CONVENTION_ANALYSIS.md)
- [分页格式统一修复](./PAGINATION_FIX_COMPLETE.md)

---

## ✅ 总结

### 成果

- ✅ 创建了通用的 JSON 解析工具类
- ✅ 修复了 3 个核心模块（Models、Characters、Sessions）
- ✅ 提供了完整的测试验证方法
- ✅ 编写了详细的文档和最佳实践

### 收益

1. ✅ **前端开发体验提升**：无需手动 `JSON.parse()`
2. ✅ **代码质量提升**：统一的序列化/反序列化逻辑
3. ✅ **类型安全**：TypeScript 类型推断更准确
4. ✅ **可维护性**：集中管理 JSON 字段处理逻辑

### 下一步

1. ⏳ 更新前端代码，移除手动的 `JSON.parse()` 调用
2. ⏳ 按需修复其他模块（Knowledge Bases、Memories 等）
3. ⏳ 考虑未来迁移到 PostgreSQL 并使用原生 `Json` 类型

---

**完成时间**：2026-04-05  
**状态**：✅ 核心模块已完成，待前端适配  
**优先级**：高（显著提升开发体验）
