# 企业微信智能机器人回复机制说明

## 问题背景

在实现企业微信智能机器人适配器时，遇到了消息回复的问题：

```
[Nest] 27064  - 2026/04/28 16:00:52    WARN [WeComAiBotAdapter] sendMessage not fully implemented for WeCom AI Bot yet
```

AI 已经生成了回复内容，但无法发送给用户。

---

## 原因分析

### 企业微信智能机器人的回复机制

企业微信智能机器人与传统 HTTP API 不同，它使用 **WebSocket 长连接**，回复消息有特殊的上下文要求：

1. **被动回复**（推荐）：在收到消息的回调中立即回复
   - 使用 `replyStream(frame, streamId, content, finish)`
   - 必须在收到消息的上下文中进行
   - 支持流式回复（打字机效果）

2. **主动推送**：无需用户触发，主动向用户发送消息
   - 需要使用不同的 API
   - 当前 SDK 版本可能未完全支持

### 原有实现的问题

原来的 `sendMessage` 方法试图直接调用 SDK 的发送接口，但：

❌ **SDK 没有直接的 `sendMsg(conversationId, content)` 方法**  
❌ **回复必须在收到消息的帧（frame）上下文中进行**  
❌ **需要保存原始消息帧才能后续回复**

---

## 解决方案

### 1. 保存消息帧

在收到消息时，保存原始的 `WsFrame` 对象：

```typescript
// 监听文本消息
this.client.on('message.text', (frame: WsFrame) => {
  const botMessage = this.transformToBotMessage(frame, 'text');
  
  // 保存消息帧，用于后续回复
  const messageId = frame.headers?.req_id || Date.now().toString();
  this.pendingFrames.set(messageId, frame);
  
  // 将消息传递给上层处理
  this.messageSubject.next(botMessage);
});
```

### 2. 查找并回复

在 `sendMessage` 中查找对应的消息帧，然后使用 `replyStream` 回复：

```typescript
async sendMessage(response: BotResponse): Promise<void> {
  // 查找待回复的消息帧
  const frame = this.findPendingFrame(response.conversationId);
  
  if (frame) {
    // 使用流式回复
    const streamId = generateReqId('stream');
    
    // 发送最终回复（finish=true）
    await this.client.replyStream(frame, streamId, response.content, true);
    
    // 清理已使用的帧
    this.cleanupPendingFrame(response.conversationId);
  } else {
    // 如果没有找到帧，记录警告
    this.logger.warn('No pending frame found...');
  }
}
```

### 3. 辅助方法

```typescript
/**
 * 查找待回复的消息帧
 */
private findPendingFrame(conversationId: string): WsFrame | undefined {
  for (const [messageId, frame] of this.pendingFrames.entries()) {
    if (frame.body.from?.userid === conversationId) {
      return frame;
    }
  }
  return undefined;
}

/**
 * 清理已使用的消息帧
 */
private cleanupPendingFrame(conversationId: string): void {
  for (const [messageId, frame] of this.pendingFrames.entries()) {
    if (frame.body.from?.userid === conversationId) {
      this.pendingFrames.delete(messageId);
      break;
    }
  }
}
```

---

## 工作流程

```
用户发送消息
    ↓
企业微信服务器通过 WebSocket 推送
    ↓
WSClient 接收消息帧 (WsFrame)
    ↓
触发 'message.text' 事件
    ↓
保存消息帧到 pendingFrames Map
    ↓
转换为 BotMessage 并传递给 BotOrchestrator
    ↓
BotOrchestrator 调用 AgentService 生成回复
    ↓
AgentService 返回回复内容
    ↓
BotOrchestrator 调用 adapter.sendMessage()
    ↓
adapter 查找对应的消息帧
    ↓
使用 replyStream(frame, streamId, content, true) 回复
    ↓
企业微信服务器收到回复并推送给用户
```

---

## 关键要点

### ✅ 正确的做法

1. **保存消息帧**：在收到消息时立即保存 `WsFrame`
2. **使用 replyStream**：通过 `replyStream` 方法回复
3. **设置 finish=true**：表示这是最终回复
4. **生成 streamId**：使用 `generateReqId('stream')` 生成唯一 ID
5. **清理帧**：回复后清理已使用的帧，避免内存泄漏

### ❌ 错误的做法

1. ~~直接调用不存在的 `sendMsg()` 方法~~
2. ~~尝试在消息上下文外回复~~
3. ~~不保存消息帧就丢弃~~
4. ~~忘记设置 `finish=true`~~

---

## 测试验证

### 日志输出

修复后的日志应该显示：

```
[Nest] 27064  - 2026/04/28 16:00:49     LOG [WeComAiBotAdapter] Received text message: 你好...
[Nest] 27064  - 2026/04/28 16:00:49     LOG [BotOrchestrator] Received message from ZhenDongDong: 你好
[Nest] 27064  - 2026/04/28 16:00:52     LOG [AgentService] Message content updated: xxx
[Nest] 27064  - 2026/04/28 16:00:52     LOG [WeComAiBotAdapter] Sending message: conversationId=ZhenDongDong, content=你好！我是你的 AI 助手...
[Nest] 27064  - 2026/04/28 16:00:52     LOG [WeComAiBotAdapter] Reply sent successfully via replyStream to: ZhenDongDong
[Nest] 27064  - 2026/04/28 16:00:52     LOG [BotOrchestrator] Replied to ZhenDongDong
```

### 预期行为

1. ✅ 用户发送"你好"
2. ✅ 机器人接收到消息
3. ✅ AI 生成回复"你好！我是你的 AI 助手，有什么可以帮你的吗？😊"
4. ✅ 回复通过 `replyStream` 发送
5. ✅ 用户在企业微信中看到回复

---

## 限制和注意事项

### 1. 回复时效性

企业微信要求在一定时间内回复（通常是几秒），如果 AI 处理时间过长：

- **方案 A**：先发送"正在思考中..."的中间回复（`finish=false`）
- **方案 B**：优化 AI 响应速度
- **方案 C**：使用流式回复逐步输出

### 2. 内存管理

`pendingFrames` Map 会存储所有待回复的消息帧，需要定期清理：

- ✅ 回复后立即清理
- ⚠️ 考虑添加超时清理机制（例如 5 分钟后自动清理）

### 3. 并发处理

如果多个用户同时发消息：

- ✅ 每个消息帧都有唯一的 `req_id`
- ✅ Map 可以存储多个帧
- ⚠️ 确保正确匹配 conversationId

### 4. 主动推送

当前实现主要支持**被动回复**。如果需要主动推送（定时提醒、通知等）：

- 需要研究 SDK 是否提供 `pushToUser` 或类似 API
- 或者使用企业微信的其他 API（如应用消息推送）

---

## 未来优化方向

### 1. 流式回复支持

实现真正的打字机效果：

```typescript
// 先发送"正在思考中..."
await this.client.replyStream(frame, streamId, '正在思考中...', false);

// 逐步输出 AI 回复
for await (const chunk of aiStream) {
  await this.client.replyStream(frame, streamId, chunk, false);
}

// 最后标记完成
await this.client.replyStream(frame, streamId, '', true);
```

### 2. 超时清理

添加定时任务清理过期的消息帧：

```typescript
setInterval(() => {
  const now = Date.now();
  for (const [messageId, frame] of this.pendingFrames.entries()) {
    if (now - frame.timestamp > 5 * 60 * 1000) { // 5分钟
      this.pendingFrames.delete(messageId);
    }
  }
}, 60 * 1000); // 每分钟检查一次
```

### 3. 主动推送 API

研究并实现主动推送功能，支持：
- 定时提醒
- 异步任务通知
- 告警推送

---

## 参考资料

- [企业微信智能机器人长连接文档](https://developer.work.weixin.qq.com/document/path/101463)
- [@wecom/aibot-node-sdk npm 包](https://www.npmjs.com/package/@wecom/aibot-node-sdk)
- [被动回复消息格式](https://developer.work.weixin.qq.com/document/path/101031)

---

## 更新历史

- **2026-04-28**: 
  - 实现消息帧保存机制
  - 修复 `sendMessage` 方法使用 `replyStream`
  - 添加帧查找和清理逻辑
