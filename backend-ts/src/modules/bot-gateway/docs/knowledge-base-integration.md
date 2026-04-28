# Bot 知识库引用功能实现说明

## 功能概述

为 Bot 实例添加知识库引用功能,使 AI 在回复时能够引用指定的知识库内容。

## 实现方案

使用 `BotInstance.additionalKwargs` 字段存储 `knowledgeBaseIds`,避免新增数据库字段。

### 数据结构

```typescript
// BotInstance.additionalKwargs 结构
{
  knowledgeBaseIds: ["kb-id-1", "kb-id-2", ...]
}
```

## 修改内容

### 1. BotConfig 接口扩展

**文件**: `src/modules/bot-gateway/interfaces/bot-platform.interface.ts`

```typescript
export interface BotConfig {
  // ... 其他字段
  /** 关联的知识库ID列表(从 additionalKwargs 中读取) */
  knowledgeBaseIds?: string[];
}
```

### 2. BotInstanceManager 加载逻辑

**文件**: `src/modules/bot-gateway/services/bot-instance-manager.service.ts`

从数据库加载 Bot 配置时,从 `additionalKwargs` 中提取知识库ID:

```typescript
const config: BotConfig = {
  // ... 其他字段
  // 从 additionalKwargs 中提取知识库ID列表
  knowledgeBaseIds: (bot.additionalKwargs as any)?.knowledgeBaseIds || [],
};
```

### 3. SessionMapper 消息创建逻辑

**文件**: `src/modules/bot-gateway/services/session-mapper.service.ts`

#### 依赖注入
```typescript
constructor(
  // ... 其他依赖
  private kbRepo: KnowledgeBaseRepository,
) {}
```

#### createUserMessage 方法增强
```typescript
/**
 * 创建用户消息
 * @param sessionId 会话 ID
 * @param content 消息内容
 * @param knowledgeBaseIds 引用的知识库 ID 列表(可选)
 */
async createUserMessage(
  sessionId: string,
  content: string,
  knowledgeBaseIds?: string[],
): Promise<any> {
  const message = await this.messageRepo.create({
    sessionId,
    role: 'user',
    parentId: null,
  });

  // 处理知识库引用逻辑
  let additionalKwargs: any = null;
  if (knowledgeBaseIds && knowledgeBaseIds.length > 0) {
    // 使用批量查询提升效率
    const kbs = await this.kbRepo.findByIds(knowledgeBaseIds);
    const kbMetadata = kbs.map((kb) => ({
      id: kb.id,
      name: kb.name,
      description: kb.description,
    }));
    additionalKwargs = { referencedKbs: kbMetadata };
  }

  await this.prisma.messageContent.create({
    data: {
      messageId: message.id,
      turnsId: this.generateTurnsId(),
      role: 'user',
      content,
      additionalKwargs,  // 附加知识库元数据
    },
  });

  return message;
}
```

### 4. BotOrchestrator 调用更新

**文件**: `src/modules/bot-gateway/services/bot-orchestrator.service.ts`

#### generateReply 方法签名更新
```typescript
private async generateReply(
  session: any, 
  message: BotMessage, 
  config: BotConfig  // 新增参数
): Promise<string> {
  // 1. 创建用户消息记录(附带知识库ID列表)
  const userMessage = await this.sessionMapper.createUserMessage(
    session.id,
    message.content,
    config.knowledgeBaseIds,  // 传递知识库ID
  );
  
  // ... 后续逻辑
}
```

#### 调用处更新
```typescript
// 4. 调用 AgentService 生成回复(内部会创建消息记录)
const reply = await this.generateReply(session, message, config);
```

## 数据流程

```
前端配置 Bot
    ↓
保存 knowledgeBaseIds 到 BotInstance.additionalKwargs
    ↓
BotInstanceManager 加载配置
    ↓
提取 knowledgeBaseIds 到 BotConfig
    ↓
BotOrchestrator 接收消息
    ↓
调用 createUserMessage(knowledgeBaseIds)
    ↓
SessionMapper 查询知识库元数据
    ↓
保存到 MessageContent.additionalKwargs
    ↓
AgentService 读取 referencedKbs
    ↓
AI 回复时引用知识库内容
```

## 前端集成指南

### 创建/编辑 Bot 时

```typescript
// 前端表单提交数据
{
  platform: "qq",
  name: "客服机器人",
  platformConfig: { ... },
  defaultCharacterId: "char-xxx",
  additionalKwargs: {
    knowledgeBaseIds: ["kb-1", "kb-2"]  // 用户选择的知识库ID列表
  }
}
```

### API 示例

**创建 Bot**:
```bash
POST /api/v1/bot-admin/instances
Content-Type: application/json

{
  "platform": "qq",
  "name": "智能客服",
  "platformConfig": {
    "appId": "...",
    "appSecret": "..."
  },
  "defaultCharacterId": "char-cuid-123",
  "additionalKwargs": {
    "knowledgeBaseIds": ["kb-cuid-1", "kb-cuid-2"]
  }
}
```

**更新 Bot**:
```bash
PUT /api/v1/bot-admin/instances/:id
Content-Type: application/json

{
  "additionalKwargs": {
    "knowledgeBaseIds": ["kb-cuid-3"]  // 更新知识库列表
  }
}
```

## 优势

1. **灵活性**: 使用 JSON 字段存储,无需修改数据库 schema
2. **可扩展性**: `additionalKwargs` 可存储其他扩展配置
3. **向后兼容**: 不影响现有 Bot 实例
4. **性能优化**: 批量查询知识库元数据,避免 N+1 查询

## 注意事项

1. **前端必传**: 创建 Bot 时,如果需要使用知识库,必须在 `additionalKwargs` 中传入 `knowledgeBaseIds`
2. **空值处理**: 如果未配置知识库,`knowledgeBaseIds` 为空数组,不会附加元数据
3. **元数据格式**: 存储在 `MessageContent.additionalKwargs.referencedKbs` 中,格式与 Web 端一致

## 测试验证

1. 创建 Bot 时配置知识库ID
2. 发送消息到 Bot
3. 检查数据库中 `MessageContent.additionalKwargs` 是否包含 `referencedKbs`
4. 验证 AI 回复是否正确引用了知识库内容
