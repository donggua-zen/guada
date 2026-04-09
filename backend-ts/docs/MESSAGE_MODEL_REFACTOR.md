# Message 模型重构报告

## 📋 重构目标

将 TypeScript 后端的 `Message` 模型与 Python 后端对齐，添加缺失的 `currentTurnsId` 字段。

---

## 🔍 模型对比分析

### Python 后端字段（标准）

**文件**: `backend/app/models/message.py`

```python
class Message(ModelBase):
    __tablename__ = "message"

    id = Column(String(26), primary_key=True, default=lambda: str(ulid.new()))
    session_id = Column(String(26), ForeignKey("session.id", ondelete="CASCADE"), index=True)
    role = Column(String(50))
    parent_id = Column(String(26), nullable=True)
    current_turns_id = Column(String(26), nullable=True)  # ✅ 关键字段
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    files: Mapped[List["File"]] = relationship(...)
    contents: Mapped[List["MessageContent"]] = relationship(...)
```

---

### TypeScript 后端字段（修复前）❌

**文件**: `backend-ts/prisma/schema.prisma`

```prisma
model Message {
  id                 String   @id @default(cuid())
  sessionId          String   @map("session_id")
  role               String
  parentId           String?  @map("parent_id")
  knowledgeBaseIds   String?  @map("knowledge_base_ids") // 业务需要
  currentContentId   String?  @map("current_content_id") // 业务需要
  createdAt          DateTime @default(now()) @map("created_at")
  updatedAt          DateTime @updatedAt @map("updated_at")
  
  // ❌ 缺少 currentTurnsId
}
```

---

### TypeScript 后端字段（修复后）✅

```prisma
model Message {
  id                 String   @id @default(cuid())
  sessionId          String   @map("session_id")
  role               String
  parentId           String?  @map("parent_id")
  currentTurnsId     String?  @map("current_turns_id") // ✅ 添加 current_turns_id
  knowledgeBaseIds   String?  @map("knowledge_base_ids") // 业务需要
  currentContentId   String?  @map("current_content_id") // 业务需要
  createdAt          DateTime @default(now()) @map("created_at")
  updatedAt          DateTime @updatedAt @map("updated_at")

  session        Session          @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  parent         Message?         @relation("MessageThread", fields: [parentId], references: [id])
  children       Message[]        @relation("MessageThread")
  contents       MessageContent[]
  currentContent MessageContent?  @relation("CurrentContent", fields: [currentContentId], references: [id])

  @@index([sessionId])
  @@index([parentId])
  @@index([currentTurnsId]) // ✅ 添加索引
  @@map("message")
}
```

---

## 📊 字段变更汇总

| 操作 | 字段名 | 说明 |
|------|--------|------|
| ✅ **添加** | `currentTurnsId` | 当前轮次 ID（与 Python 后端一致） |

**注意**：
- `knowledgeBaseIds` 和 `currentContentId` 是 TypeScript 后端的业务需要字段，Python 后端没有，但保留
- 这些字段不影响与 Python 后端的兼容性

---

## 🔧 代码修改详情

### 1. Prisma Schema

**文件**: [`prisma/schema.prisma`](file://d:\编程开发\AI\ai_chat\backend-ts\prisma\schema.prisma#L32-L52)

- ✅ 添加 `currentTurnsId` 字段
- ✅ 添加 `currentTurnsId` 索引

---

### 2. Message Repository

**文件**: [`message.repository.ts`](file://d:\编程开发\AI\ai_chat\backend-ts\src\common\database\message.repository.ts#L69-L80)

```typescript
// 修改前 ❌
async create(data: {
  sessionId: string;
  role: string;
  parentId?: string;
  knowledgeBaseIds?: string;
  currentContentId?: string;
})

// 修改后 ✅
async create(data: {
  sessionId: string;
  role: string;
  parentId?: string;
  currentTurnsId?: string;  // ✅ 添加 currentTurnsId
  knowledgeBaseIds?: string;
  currentContentId?: string;
})
```

---

### 3. Agent Service

**文件**: [`agent.service.ts`](file://d:\编程开发\AI\ai_chat\backend-ts\src\modules\chat\agent.service.ts#L59-L64)

```typescript
const assistantMessage = await this.messageRepo.create({
  sessionId,
  role: 'assistant',
  parentId: messageId,
  currentTurnsId: turnsId,  // ✅ 设置当前轮次 ID
});
```

---

### 4. Message Service

**文件**: [`message.service.ts`](file://d:\编程开发\AI\ai_chat\backend-ts\src\modules\chat\message.service.ts)

#### 替换模式

```typescript
const turnsId = uuidv4();  // ✅ 生成新的轮次 ID
const newMessage = await this.messageRepo.create({
  sessionId,
  role,
  parentId: existingMessage.parentId,
  currentTurnsId: turnsId,  // ✅ 设置当前轮次 ID
});

await this.contentRepo.create({
  messageId,
  turnsId,  // ✅ 使用相同的 turnsId
  role,
  content,
});
```

#### 正常模式

```typescript
const turnsId = uuidv4();  // ✅ 生成轮次 ID
const message = await this.messageRepo.create({
  sessionId,
  role,
  parentId,
  currentTurnsId: turnsId,  // ✅ 设置当前轮次 ID
  knowledgeBaseIds: knowledgeBaseIds ? JSON.stringify(knowledgeBaseIds) : null,
});

const contentRecord = await this.contentRepo.create({
  messageId: message.id,
  turnsId,  // ✅ 使用相同的 turnsId
  role,
  content,
});
```

---

## 🎯 currentTurnsId 的作用

### 1. 关联消息与轮次

`currentTurnsId` 标识消息所属的对话轮次：

```
用户消息 (turnsId: "abc123", currentTurnsId: "abc123")
  └─ AI 回复 1 (turnsId: "abc123", currentTurnsId: "abc123")
  └─ AI 回复 2 (turnsId: "abc123", currentTurnsId: "abc123")  ← 重新生成
```

### 2. 支持多版本消息

当用户重新生成 AI 回复时：
- ✅ 创建新的 MessageContent（新的 content 记录）
- ✅ 更新 Message 的 `currentContentId` 指向最新版本
- ✅ `currentTurnsId` 保持不变，表示同一轮对话

### 3. 前端显示优化

前端可以根据 `currentTurnsId` 分组显示对话：

```typescript
// 按轮次分组
const turnsMap = new Map<string, Turn>();
messages.forEach(msg => {
  const turnId = msg.currentTurnsId;
  if (!turnsMap.has(turnId)) {
    turnsMap.set(turnId, { userMessage: null, assistantMessages: [] });
  }
  // ...
});
```

---

## 📝 数据库重建步骤

**需要手动执行**（因为后端服务正在运行，文件被锁定）：

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

## ⚠️ 重要注意事项

### 1. currentTurnsId vs turnsId

| 字段 | 位置 | 作用 |
|------|------|------|
| `Message.currentTurnsId` | Message 表 | 标识消息所属的轮次 |
| `MessageContent.turnsId` | MessageContent 表 | 标识内容版本所属的轮次 |

**关系**：
- ✅ 同一轮对话的所有 Message 和 MessageContent 应该有相同的 `turnsId`
- ✅ `Message.currentTurnsId` 应该等于其 `currentContent.turnsId`

### 2. 数据一致性

创建消息时，必须确保：

```typescript
const turnsId = uuidv4();

// Message 的 currentTurnsId
const message = await this.messageRepo.create({
  currentTurnsId: turnsId,  // ✅
  // ...
});

// MessageContent 的 turnsId
await this.contentRepo.create({
  messageId: message.id,
  turnsId: turnsId,  // ✅ 使用相同的 ID
  // ...
});
```

### 3. 向后兼容性

如果数据库中已有数据，`currentTurnsId` 可能为 `null`。前端需要兼容：

```typescript
const turnId = message.currentTurnsId || message.contents[0]?.turnsId;
```

---

## 🧪 测试建议

### 1. 基础对话测试

发送一条用户消息，检查数据库中的 `message` 表。

**预期结果**：
```sql
SELECT id, session_id, role, parent_id, current_turns_id 
FROM message;
```

应该看到：
- ✅ `current_turns_id` 不为空
- ✅ 用户消息和 AI 回复的 `current_turns_id` 相同

### 2. 多版本消息测试

重新生成 AI 回复，检查是否有多个 content 记录。

**预期结果**：
- ✅ 同一 `message_id` 有多个 content 记录
- ✅ 所有记录的 `turns_id` 相同
- ✅ Message 的 `current_turns_id` 等于 content 的 `turns_id`

### 3. 轮次分组测试

查询同一会话的所有消息，按 `current_turns_id` 分组。

**预期结果**：
- ✅ 每组包含一个用户消息和一个或多个 AI 回复
- ✅ 同一组的所有消息 `current_turns_id` 相同

---

## 📝 相关文档

- [MessageContent 模型重构](./MESSAGE_CONTENT_MODEL_REFACTOR.md)
- [Usage 信息持久化验证](./USAGE_PERSISTENCE_VERIFICATION.md)
- [SSE 事件字段命名统一为驼峰式](./SSE_EVENT_CAMELCASE_UNIFICATION.md)

---

## ✅ 检查清单

- [x] 对比 Python 和 TypeScript 后端 Message 模型
- [x] 更新 Prisma Schema（添加 currentTurnsId）
- [x] 更新 Message Repository
- [x] 更新 Agent Service
- [x] 更新 Message Service（替换模式）
- [x] 更新 Message Service（正常模式）
- [ ] 停止后端服务
- [ ] 删除旧数据库文件
- [ ] 运行 `npx prisma db push --accept-data-loss`
- [ ] 运行 `npx prisma generate`
- [ ] 重启后端服务
- [ ] 测试基础对话功能
- [ ] 验证 currentTurnsId 正确生成
- [ ] 验证 Message 和 MessageContent 的 turnsId 一致
- [ ] 测试多版本消息功能

---

**重构日期**: 2026-04-05  
**重构人员**: Lingma AI Assistant  
**风险等级**: **中**（添加新字段，不影响现有功能）  
**影响范围**: Message 模型、所有创建消息的代码  
**状态**: ✅ 代码已完成，需要重建数据库
