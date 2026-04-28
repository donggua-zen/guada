# 机器人平台能力声明与流式回复架构

## 概述

为了支持不同平台的特性差异（如企业微信的流式回复、QQ 的直接发送等），我们引入了**平台能力声明**机制，让编排器能够根据平台能力智能选择回复方式。

---

## 核心设计

### 1. 平台能力声明 (`PlatformCapabilities`)

每个适配器通过 `getCapabilities()` 方法声明其支持的功能：

```typescript
interface PlatformCapabilities {
  supportsStreaming: boolean;      // 是否支持流式回复
  supportsPushMessage: boolean;    // 是否支持主动推送
  supportsTemplateCard: boolean;   // 是否支持模板卡片
  supportsMultimedia: boolean;     // 是否支持多媒体消息
}
```

### 2. 流式回复接口 (`sendStreamReply`)

在 `IBotPlatform` 中添加了可选的流式回复方法：

```typescript
interface IBotPlatform {
  // ... 其他方法
  
  /**
   * 发送流式回复(如果平台支持)
   */
  sendStreamReply?(
    response: BotResponse, 
    options?: StreamReplyOptions
  ): Promise<boolean>;
}
```

### 3. 响应消息扩展 (`BotResponse`)

添加了 `rawFrame` 字段用于传递原始消息帧：

```typescript
interface BotResponse {
  conversationId: string;
  content: string;
  rawFrame?: any;  // 原始消息帧(用于企业微信等需要上下文的平台)
  // ... 其他字段
}
```

### 4. 编排器透传机制

**关键设计**：不保存消息帧，直接透传

```typescript
// BotOrchestrator 在回复时传递原始帧
await adapter.sendMessage({
  conversationId: message.conversationId,
  content: reply,
  rawFrame: message.rawEvent,  // 直接透传，不保存
});

// 适配器直接使用透传的帧
async sendStreamReply(response: BotResponse): Promise<boolean> {
  const frame = response.rawFrame;  // 直接使用，无需查找
  await this.client.replyStream(frame, streamId, content, finish);
  return true;
}
```

**优势**：
- ✅ **零内存开销**：不需要 Map 存储帧
- ✅ **无查找逻辑**：直接从 response 获取
- ✅ **无泄漏风险**：帧随 response 生命周期管理
- ✅ **代码简洁**：减少 50+ 行代码

---

## 各平台能力对比

| 平台 | 流式回复 | 主动推送 | 模板卡片 | 多媒体 |
|------|---------|---------|---------|--------|
| **企业微信智能机器人** | ✅ | ❌ (待实现) | ✅ | ✅ |
| **QQ** | ❌ | ✅ | ❌ | ✅ |
| **飞书** | ❌ | ✅ | ❌ | ✅ |
| **微信公众号** | ❌ | ✅ | ✅ | ✅ |
| **企业微信应用消息** | ❌ | ✅ | ✅ | ✅ |

---

## 使用示例

### 1. 适配器实现

#### 企业微信智能机器人（支持流式）

```typescript
export class WeComAiBotAdapter implements IBotPlatform {
  getCapabilities(): PlatformCapabilities {
    return {
      supportsStreaming: true,
      supportsPushMessage: false,
      supportsTemplateCard: true,
      supportsMultimedia: true,
    };
  }

  async sendStreamReply(
    response: BotResponse,
    options?: StreamReplyOptions,
  ): Promise<boolean> {
    const frame = response.rawFrame || this.findPendingFrame(response.conversationId);
    
    if (!frame) {
      return false;
    }

    const streamId = options?.streamId || generateReqId('stream');
    const finish = options?.finish ?? true;

    await this.client.replyStream(frame, streamId, response.content, finish);
    
    if (finish) {
      this.cleanupPendingFrame(response.conversationId);
    }
    
    return true;
  }
}
```

#### QQ 机器人（不支持流式）

```typescript
export class QQBotAdapter implements IBotPlatform {
  getCapabilities(): PlatformCapabilities {
    return {
      supportsStreaming: false,  // QQ 不支持流式
      supportsPushMessage: true,
      supportsTemplateCard: false,
      supportsMultimedia: true,
    };
  }

  // 不需要实现 sendStreamReply
}
```

### 2. 编排器智能选择

编排器根据平台能力决定使用哪种回复方式：

```typescript
// BotOrchestrator 中的智能选择逻辑
const capabilities = adapter.getCapabilities();

// 优先使用流式回复（如果平台支持）
if (capabilities.supportsStreaming && adapter.sendStreamReply) {
  try {
    const success = await adapter.sendStreamReply(response, { finish: true });
    
    if (success) {
      this.logger.log('Replied via streaming');
    } else {
      // 降级到普通发送
      await adapter.sendMessage(response);
    }
  } catch (error) {
    // 出错时降级到普通发送
    await adapter.sendMessage(response);
  }
} else {
  // 不支持流式，直接使用普通发送
  await adapter.sendMessage(response);
}
```

**优势**：
- ✅ **自动适配**：无需手动配置，根据平台能力自动选择
- ✅ **优雅降级**：流式失败时自动切换到普通发送
- ✅ **错误处理**：异常情况也能保证消息送达
- ✅ **统一接口**：上层代码无需关心底层实现细节

### 3. 流式回复分片

对于支持流式的平台，可以分多次发送内容：

```typescript
// 第一次：发送"正在思考中..."
await adapter.sendStreamReply(response, {
  streamId: 'stream-123',
  finish: false,  // 不是最终回复
});

// 中间：逐步输出 AI 回复
for await (const chunk of aiStream) {
  await adapter.sendStreamReply(response, {
    streamId: 'stream-123',
    content: chunk,
    finish: false,
  });
}

// 最后：标记完成
await adapter.sendStreamReply(response, {
  streamId: 'stream-123',
  finish: true,  // 最终回复
});
```

---

## 优势

### 1. **灵活性强**
- ✅ 不同平台可以根据自身特性实现不同的能力
- ✅ 编排器可以智能选择最优的回复方式
- ✅ 易于扩展新的平台和能力

### 2. **用户体验好**
- ✅ 支持流式的平台可以实现打字机效果
- ✅ 不支持流式的平台也能正常工作
- ✅ 自动降级，保证兼容性

### 3. **代码清晰**
- ✅ 能力声明一目了然
- ✅ 职责分离：适配器负责实现，编排器负责决策
- ✅ 类型安全：TypeScript 提供完整的类型检查

### 4. **易于维护**
- ✅ 新增平台只需实现接口和声明能力
- ✅ 修改某个平台不影响其他平台
- ✅ 统一的接口规范

---

## 注意事项

### 1. 企业微信的特殊性

企业微信智能机器人**必须**在收到消息的上下文中回复：

```typescript
// ✅ 正确：保存消息帧
this.client.on('message.text', (frame: WsFrame) => {
  this.pendingFrames.set(messageId, frame);
  // ...
});

// ✅ 正确：使用保存的帧回复
const frame = response.rawFrame || this.findPendingFrame(conversationId);
await this.client.replyStream(frame, streamId, content, finish);

// ❌ 错误：尝试直接发送（没有对应的 API）
await this.client.sendMessage(conversationId, content);  // 不存在
```

### 2. 内存管理

保存的消息帧需要及时清理：

```typescript
// 回复后清理
if (finish) {
  this.cleanupPendingFrame(conversationId);
}

// 或者添加超时清理机制
setInterval(() => {
  // 清理超过 5 分钟的帧
}, 60000);
```

### 3. 流式回复的时序

确保流式回复的顺序正确：

```typescript
// ✅ 正确：按顺序发送
await sendStreamReply({ finish: false });  // 第 1 条
await sendStreamReply({ finish: false });  // 第 2 条
await sendStreamReply({ finish: true });   // 第 3 条（最终）

// ❌ 错误：乱序发送
await sendStreamReply({ finish: true });   // 先发送最终
await sendStreamReply({ finish: false });  // 再发送中间（无效）
```

---

## 未来扩展

### 1. 更多能力声明

可以添加更多能力字段：

```typescript
interface PlatformCapabilities {
  // ... 现有字段
  
  supportsVoiceMessage: boolean;    // 是否支持语音消息
  supportsVideoMessage: boolean;    // 是否支持视频消息
  supportsLocationSharing: boolean; // 是否支持位置分享
  supportsRichText: boolean;        // 是否支持富文本
}
```

### 2. 能力协商

编排器可以与适配器进行能力协商：

```typescript
const capabilities = adapter.getCapabilities();

if (capabilities.supportsStreaming) {
  // 使用流式回复
} else if (capabilities.supportsTemplateCard) {
  // 使用模板卡片
} else {
  // 使用纯文本
}
```

### 3. 性能优化

根据平台能力优化消息处理流程：

```typescript
if (capabilities.supportsPushMessage) {
  // 可以异步处理，稍后推送
  queueMessage(response);
} else {
  // 必须立即回复，同步处理
  await processAndReplyImmediately(response);
}
```

---

## 参考资料

- [企业微信智能机器人长连接文档](https://developer.work.weixin.qq.com/document/path/101463)
- [@wecom/aibot-node-sdk npm 包](https://www.npmjs.com/package/@wecom/aibot-node-sdk)
- [bot-platform.interface.ts](../interfaces/bot-platform.interface.ts)

---

## 更新历史

- **2026-04-28**: 
  - 添加 `PlatformCapabilities` 接口
  - 添加 `sendStreamReply` 方法
  - 所有适配器实现能力声明
  - 企业微信适配器实现流式回复
