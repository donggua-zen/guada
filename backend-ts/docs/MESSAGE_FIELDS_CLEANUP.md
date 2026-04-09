# Message 模型字段清理报告

## 📋 清理目标

删除 Message 模型中多余的 `knowledgeBaseIds` 和 `currentContentId` 字段，与 Python 后端保持一致。

---

## 🔍 字段分析

### 1. knowledgeBaseIds

**状态**: ❌ **已删除**

**原因**:
- Python 后端没有此字段
- TypeScript 后端只存储但从未查询使用
- 知识库关联应通过其他方式实现（如 MessageContent 的 metaData）

**影响范围**:
- ✅ Prisma Schema
- ✅ Message Repository
- ✅ Message Service (addMessage, updateMessage, importMessages)
- ✅ Messages Controller

---

### 2. currentContentId

**状态**: ❌ **已删除**

**原因**:
- Python 后端没有此字段
- Python 后端通过查询 MessageContent 列表的最后一个元素获取当前内容
- TypeScript 后端可以沿用相同策略

**Python 后端的实现**:
```python
# 获取消息时包含所有内容版本
message = await self.message_repo.get_message(message_id)
# 当前内容是列表中的最后一个
current_content = message.contents[-1] if message.contents else None
```

**影响范围**:
- ✅ Prisma Schema
- ✅ Message Repository (删除 setCurrentContent 方法)
- ✅ Message Service (删除 setCurrentContent 调用)
- ✅ Agent Service (删除 setCurrentContent 调用)

---

## 🔧 代码修改详情

### 1. Prisma Schema

**文件**: [`prisma/schema.prisma`](file://d:\编程开发\AI\ai_chat\backend-ts\prisma\schema.prisma#L32-L50)

**删除前**:
```prisma
model Message {
  id                 String   @id @default(cuid())
  sessionId          String   @map("session_id")
  role               String
  parentId           String?  @map("parent_id")
  currentTurnsId     String?  @map("current_turns_id")
  knowledgeBaseIds   String?  @map("knowledge_base_ids") // ❌ 删除
  currentContentId   String?  @map("current_content_id") // ❌ 删除
  createdAt          DateTime @default(now()) @map("created_at")
  updatedAt          DateTime @updatedAt @map("updated_at")

  session        Session          @relation(...)
  parent         Message?         @relation(...)
  children       Message[]        @relation(...)
  contents       MessageContent[]
  currentContent MessageContent?  @relation("CurrentContent", ...) // ❌ 删除
}
```

**删除后**:
```prisma
model Message {
  id                 String   @id @default(cuid())
  sessionId          String   @map("session_id")
  role               String
  parentId           String?  @map("parent_id")
  currentTurnsId     String?  @map("current_turns_id") // ✅ 保留
  createdAt          DateTime @default(now()) @map("created_at")
  updatedAt          DateTime @updatedAt @map("updated_at")

  session        Session          @relation(...)
  parent         Message?         @relation(...)
  children       Message[]        @relation(...)
  contents       MessageContent[]
}
```

---

### 2. Message Repository

**文件**: [`message.repository.ts`](file://d:\编程开发\AI\ai_chat\backend-ts\src\common\database\message.repository.ts)

#### 删除 create 方法的参数

```typescript
// 删除前 ❌
async create(data: {
  sessionId: string;
  role: string;
  parentId?: string;
  currentTurnsId?: string;
  knowledgeBaseIds?: string;    // ❌ 删除
  currentContentId?: string;    // ❌ 删除
})

// 删除后 ✅
async create(data: {
  sessionId: string;
  role: string;
  parentId?: string;
  currentTurnsId?: string;
})
```

#### 删除 setCurrentContent 方法

```typescript
// ❌ 完全删除此方法
async setCurrentContent(messageId: string, contentId: string) {
  return this.prisma.message.update({
    where: { id: messageId },
    data: { currentContentId: contentId },
  });
}
```

#### 删除查询中的 currentContent include

```typescript
// 删除前 ❌
include: {
  contents: { orderBy: { createdAt: 'asc' } },
  currentContent: true,  // ❌ 删除
}

// 删除后 ✅
include: {
  contents: { orderBy: { createdAt: 'asc' } },
}
```

---

### 3. Message Service

**文件**: [`message.service.ts`](file://d:\编程开发\AI\ai_chat\backend-ts\src\modules\chat\message.service.ts)

#### addMessage 方法

```typescript
// 删除前 ❌
async addMessage(
  sessionId: string,
  role: string,
  content: string,
  files: any[] = [],
  replaceMessageId?: string,
  parentId?: string,
  knowledgeBaseIds?: string[],  // ❌ 删除
)

// 删除后 ✅
async addMessage(
  sessionId: string,
  role: string,
  content: string,
  files: any[] = [],
  replaceMessageId?: string,
  parentId?: string,
)
```

#### 创建消息时删除 knowledgeBaseIds

```typescript
// 删除前 ❌
const message = await this.messageRepo.create({
  sessionId,
  role,
  parentId,
  currentTurnsId: turnsId,
  knowledgeBaseIds: knowledgeBaseIds ? JSON.stringify(knowledgeBaseIds) : null,  // ❌ 删除
});

// 删除后 ✅
const message = await this.messageRepo.create({
  sessionId,
  role,
  parentId,
  currentTurnsId: turnsId,
});
```

#### 删除 setCurrentContent 调用

```typescript
// 删除前 ❌
const contentRecord = await this.contentRepo.create({...});
await this.messageRepo.setCurrentContent(message.id, contentRecord.id);  // ❌ 删除
return this.messageRepo.findById(message.id);

// 删除后 ✅
const contentRecord = await this.contentRepo.create({...});
return this.messageRepo.findById(message.id);
```

#### updateMessage 方法

```typescript
// 删除前 ❌
const allowedFields = ['role', 'knowledgeBaseIds'];  // ❌ 删除 knowledgeBaseIds
for (const key of allowedFields) {
  if (data[key] !== undefined) {
    updateData[key] = key === 'knowledgeBaseIds' && Array.isArray(data[key])
      ? JSON.stringify(data[key])
      : data[key];
  }
}

// 删除后 ✅
const allowedFields = ['role'];
for (const key of allowedFields) {
  if (data[key] !== undefined) {
    updateData[key] = data[key];
  }
}
```

#### importMessages 方法

```typescript
// 删除前 ❌
const formattedMessages = messages.map(msg => ({
  sessionId,
  role: msg.role || 'user',
  content: msg.content || '',
  parentId: msg.parent_id || null,
  knowledgeBaseIds: msg.knowledge_base_ids ? JSON.stringify(msg.knowledge_base_ids) : null,  // ❌ 删除
  createdAt: msg.created_at ? new Date(msg.created_at) : new Date(),
}));

// 删除后 ✅
const formattedMessages = messages.map(msg => ({
  sessionId,
  role: msg.role || 'user',
  content: msg.content || '',
  parentId: msg.parent_id || null,
  createdAt: msg.created_at ? new Date(msg.created_at) : new Date(),
}));
```

---

### 4. Messages Controller

**文件**: [`messages.controller.ts`](file://d:\编程开发\AI\ai_chat\backend-ts\src\modules\chat\messages.controller.ts)

```typescript
// 删除前 ❌
@Body() body: {
  content: string;
  role?: string;
  files?: any[];
  replaceMessageId?: string;
  parentId?: string;
  knowledgeBaseIds?: string[];  // ❌ 删除
}

return this.messageService.addMessage(
  sessionId,
  body.role || 'user',
  body.content,
  body.files || [],
  body.replaceMessageId,
  body.parentId,
  body.knowledgeBaseIds,  // ❌ 删除
);

// 删除后 ✅
@Body() body: {
  content: string;
  role?: string;
  files?: any[];
  replaceMessageId?: string;
  parentId?: string;
}

return this.messageService.addMessage(
  sessionId,
  body.role || 'user',
  body.content,
  body.files || [],
  body.replaceMessageId,
  body.parentId,
);
```

---

### 5. Agent Service

**文件**: [`agent.service.ts`](file://d:\编程开发\AI\ai_chat\backend-ts\src\modules\chat\agent.service.ts)

```typescript
// 删除前 ❌
const messageContent = await this.contentRepo.create({...});
await this.messageRepo.setCurrentContent(assistantMessage.id, messageContent.id);  // ❌ 删除
yield { type: 'create', ... };

// 删除后 ✅
const messageContent = await this.contentRepo.create({...});
yield { type: 'create', ... };
```

---

## 📊 修改统计

| 文件 | 修改类型 | 行数变化 |
|------|---------|---------|
| **schema.prisma** | 删除 | -3 |
| **message.repository.ts** | 删除 | -14 |
| **message.service.ts** | 删除 + 重构 | -7 / +3 |
| **messages.controller.ts** | 删除 | -2 |
| **agent.service.ts** | 删除 | -3 |
| **总计** | - | **-29 / +3** |

---

## 🎯 如何获取当前内容版本

删除 `currentContentId` 后，获取当前内容版本的策略：

### TypeScript 后端

```typescript
// 查询消息时包含所有内容版本
const message = await this.messageRepo.findById(messageId);

// 当前内容是列表中的最后一个（按 createdAt 升序排列）
const currentContent = message.contents[message.contents.length - 1];
```

### Python 后端（参考）

```python
# 查询消息时包含所有内容版本
message = await self.message_repo.get_message(message_id)

# 当前内容是列表中的最后一个
current_content = message.contents[-1] if message.contents else None
```

---

## ⚠️ 重要注意事项

### 1. 前端适配

前端需要修改获取当前内容的逻辑：

```typescript
// 删除前 ❌
const currentContent = message.currentContent;

// 删除后 ✅
const currentContent = message.contents[message.contents.length - 1];
```

### 2. 多版本消息

当用户重新生成 AI 回复时：
- ✅ 创建新的 MessageContent 记录
- ✅ 不更新 Message 表的任何字段
- ✅ 前端通过 `contents` 数组的最后一个元素获取最新版本

### 3. 性能考虑

**问题**：每次查询都加载所有 content 版本是否影响性能？

**答案**：
- ✅ 对于大多数对话，每个消息只有 1-2 个版本
- ✅ 即使有 10 个版本，JSON 数据也很小
- ✅ 避免了额外的 JOIN 查询
- ✅ 与 Python 后端保持一致

如果需要优化，可以：
- 添加分页：只加载最近的 N 个版本
- 延迟加载：首次查询不包含 contents，需要时再查询

---

## 🗄️ 数据库重建步骤

```bash
# 1. 停止后端服务
# （在运行后端的终端按 Ctrl+C）

# 2. 删除旧数据库
cd d:\编程开发\AI\ai_chat\backend-ts
Remove-Item dev.db

# 3. 应用 Schema 变更
npx prisma db push --accept-data-loss

# 4. 生成 Prisma Client
npx prisma generate

# 5. 重启后端服务
npm run start:dev
```

---

## 🧪 测试建议

### 1. 基础对话测试

发送一条用户消息，检查返回的消息结构。

**预期结果**：
```json
{
  "id": "msg_001",
  "sessionId": "session_xxx",
  "role": "user",
  "parentId": null,
  "currentTurnsId": "turns_abc",
  "contents": [
    {
      "id": "content_001",
      "messageId": "msg_001",
      "turnsId": "turns_abc",
      "role": "user",
      "content": "你好"
    }
  ]
  // ❌ 没有 currentContent 字段
  // ❌ 没有 knowledgeBaseIds 字段
}
```

### 2. 多版本消息测试

重新生成 AI 回复，检查是否有多个 content 记录。

**预期结果**：
```json
{
  "id": "msg_002",
  "role": "assistant",
  "contents": [
    { "id": "content_001", "content": "第一个版本" },
    { "id": "content_002", "content": "第二个版本" }  ← 当前版本
  ]
}
```

前端应该显示 `contents[1].content`（最后一个）。

### 3. 导入消息测试

批量导入历史消息，验证没有 `knowledgeBaseIds` 字段。

**预期结果**：
- ✅ 消息成功导入
- ✅ 数据库中 `knowledge_base_ids` 列为 NULL

---

## 📝 相关文档

- [Message 模型重构](./MESSAGE_MODEL_REFACTOR.md)
- [MessageContent 模型重构](./MESSAGE_CONTENT_MODEL_REFACTOR.md)
- [Usage 信息持久化验证](./USAGE_PERSISTENCE_VERIFICATION.md)

---

## ✅ 检查清单

- [x] 删除 Prisma Schema 中的 knowledgeBaseIds 和 currentContentId
- [x] 删除 Message Repository 中的相关参数和方法
- [x] 删除 Message Service 中的所有引用
- [x] 删除 Messages Controller 中的参数
- [x] 删除 Agent Service 中的 setCurrentContent 调用
- [x] 删除查询中的 currentContent include
- [ ] 停止后端服务
- [ ] 删除旧数据库文件
- [ ] 运行 `npx prisma db push --accept-data-loss`
- [ ] 运行 `npx prisma generate`
- [ ] 重启后端服务
- [ ] 测试基础对话功能
- [ ] 测试多版本消息功能
- [ ] 验证前端适配（获取最后一个 content）

---

**清理日期**: 2026-04-05  
**清理人员**: Lingma AI Assistant  
**风险等级**: **中**（删除字段，需要前端适配）  
**影响范围**: Message 模型、所有消息相关接口  
**状态**: ✅ 代码已完成，需要重建数据库并通知前端适配
