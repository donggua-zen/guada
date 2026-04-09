# Message Repository 增强说明

## 概述

本次更新将 TypeScript 后端的 `MessageRepository` 与 Python 后端的功能对齐，主要增强了以下两个方面：

1. **关联 Files 表加载**：支持在查询消息时同时加载关联的文件数据
2. **基于 turnsId 的内容过滤**：实现类似 Python 后端 `only_current_content` 的逻辑

## 修改内容

### 1. Prisma Schema 更新

#### Message 模型
```prisma
model Message {
  // ... 其他字段
  contents       MessageContent[]
  files          File[]  // ✅ 新增：与 File 的一对多关系
}
```

#### File 模型
```prisma
model File {
  // ... 其他字段
  messageId     String?  @map("message_id")
  message       Message? @relation(fields: [messageId], references: [id], onDelete: SetNull)  // ✅ 新增：反向关系
}
```

**说明**：
- 在 `Message` 模型中添加了 `files` 字段，建立一对多关系
- 在 `File` 模型中添加了 `message` 字段作为反向关系
- 使用 `onDelete: SetNull` 确保删除消息时文件的外键被置空而非删除文件（与 Python 后端一致）

### 2. MessageRepository 方法增强

所有查询方法现在都支持可选的 `options` 参数：

```typescript
interface QueryOptions {
  withFiles?: boolean;           // 是否加载 files 关联
  withContents?: boolean;        // 是否加载 contents 关联
  onlyCurrentContent?: boolean;  // 是否仅返回当前轮次的内容
}
```

#### 受影响的方法

1. **findBySessionId**
   ```typescript
   async findBySessionId(sessionId: string, options?: QueryOptions)
   ```

2. **findRecentBySessionId**
   ```typescript
   async findRecentBySessionId(
     sessionId: string,
     limit: number,
     beforeMessageId?: string,
     options?: QueryOptions
   )
   ```

3. **findById**
   ```typescript
   async findById(messageId: string, options?: QueryOptions)
   ```

### 3. onlyCurrentContent 实现方案

由于 **Prisma 不支持在 `include` 中进行嵌套过滤**（nested filtering），我们采用了**应用层过滤**的方案：

```typescript
// ✅ 如果需要仅当前轮次内容，在应用层过滤
if (onlyCurrentContent) {
  return messages.map((message) => {
    if (message.contents && message.currentTurnsId) {
      return {
        ...message,
        contents: message.contents.filter(
          (content) => content.turnsId === message.currentTurnsId
        ),
      };
    }
    return message;
  });
}
```

**为什么选择应用层过滤？**

1. **Prisma 限制**：Prisma 的 `include` API 不支持在关联查询中使用 `where` 条件
2. **性能考虑**：虽然需要在应用层过滤，但只获取单个会话的消息，数据量可控
3. **代码清晰度**：逻辑清晰，易于维护和测试
4. **与 Python 后端对齐**：Python 后端使用 SQLAlchemy 的 `selectinload(...).and_(...)` 实现类似功能

## 使用示例

### 示例 1：获取消息并包含文件

```typescript
const messages = await messageRepository.findBySessionId(sessionId, {
  withFiles: true,
  withContents: true,
});

// 结果中每个消息都会包含 files 数组
messages.forEach(msg => {
  console.log(msg.files);  // File[]
  console.log(msg.contents);  // MessageContent[]
});
```

### 示例 2：仅获取当前轮次内容

```typescript
const recentMessages = await messageRepository.findRecentBySessionId(
  sessionId,
  10,
  undefined,
  {
    withFiles: false,
    withContents: true,
    onlyCurrentContent: true,  // ✅ 仅返回 currentTurnsId 匹配的内容
  }
);

// 结果中每个消息的 contents 只包含当前轮次的内容
recentMessages.forEach(msg => {
  console.log(msg.contents.length);  // 通常为 1（如果 currentTurnsId 存在）
  console.log(msg.contents[0].turnsId === msg.currentTurnsId);  // true
});
```

### 示例 3：获取单条消息详情

```typescript
const message = await messageRepository.findById(messageId, {
  withFiles: true,
  withContents: true,
  onlyCurrentContent: false,  // 返回所有内容版本
});
```

## 与 Python 后端的对比

| 功能 | Python 后端 | TypeScript 后端 | 状态 |
|------|------------|----------------|------|
| 加载 files 关联 | `selectinload(Message.files)` | `include: { files: true }` | ✅ 已对齐 |
| 加载 contents 关联 | `selectinload(Message.contents)` | `include: { contents: {...} }` | ✅ 已对齐 |
| 仅当前轮次内容 | `selectinload(...).and_(MessageContent.turns_id == Message.current_turns_id)` | 应用层过滤 `contents.filter(content => content.turnsId === message.currentTurnsId)` | ✅ 已对齐（实现方式不同） |
| 条件加载关联 | 通过 `with_files`、`with_contents` 参数控制 | 通过 `options` 对象控制 | ✅ 已对齐 |

## 注意事项

1. **向后兼容性**：所有 `options` 参数都是可选的，默认行为与之前保持一致
2. **性能影响**：启用 `withFiles` 会增加一次 JOIN 查询，仅在需要时启用
3. **类型安全**：TypeScript 类型系统会确保正确使用选项参数
4. **数据库迁移**：Schema 变更后需要运行 `npx prisma generate` 重新生成客户端

## 下一步

运行以下命令以应用 schema 变更：

```bash
cd backend-ts
npx prisma generate
```

如果使用的是 SQLite 开发数据库，可能还需要：

```bash
npx prisma db push
```

对于生产环境的 PostgreSQL，应创建迁移：

```bash
npx prisma migrate dev --name add_message_files_relation
```
