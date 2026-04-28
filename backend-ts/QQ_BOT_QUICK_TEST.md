# QQ机器人快速测试指南(第一阶段)

## 目标

验证基础架构可行性:**收到QQ消息 → 自动回复"你好"**

## 步骤

### 1. 启用模拟模式(无需真实QQ账号)

编辑 `backend-ts/.env`:

```env
# 启用QQ机器人
QQ_BOT_ENABLED=true

# 启用模拟消息测试
QQ_MOCK_MESSAGES=true
QQ_MOCK_MODE=true

# 其他保持默认
QQ_BOT_ID=test-bot
QQ_BOT_NAME=Test Bot
```

### 2. 启动服务

```bash
cd backend-ts
npm run start:dev
```

### 3. 观察日志

应该看到:

```
[INFO] Initializing bot instances...
[INFO] Starting bot: Test Bot (qq)
[WARN] QQ adapter initialized in MOCK mode
[INFO] QQ bot connected: Test Bot
[WARN] Starting mock message simulation for testing
```

3秒后开始收到模拟消息并自动回复:

```
[WARN] [MOCK] Sent test message: 这是第 1 条测试消息
[INFO] Received message from test-user-001: 这是第 1 条测试消息
[INFO] [MOCK] Reply sent to test-conversation: 你好
[INFO] Replied to test-user-001
```

**关键**:看到 "Reply sent...你好" 说明流程打通!

### 4. 测试管理API

```bash
# 查看机器人状态
curl http://localhost:3000/bot-admin/status

# 预期输出:
# [{"id":"test-bot","name":"Test Bot","platform":"qq","status":"connected"}]
```

## 下一步:接入真实QQ

### 1. 安装SDK

```bash
npm install @onebots/adapter-qq
```

### 2. 配置真实凭证

在 [QQ开放平台](https://q.qq.com/) 创建机器人应用,获取:
- App ID
- App Secret  
- Token

填入 `.env`:

```env
QQ_BOT_ENABLED=true
QQ_MOCK_MESSAGES=false  # 关闭模拟
QQ_MOCK_MODE=false

QQ_APP_ID=your_app_id
QQ_APP_SECRET=your_secret
QQ_BOT_TOKEN=your_token
QQ_BOT_MODE=websocket
```

### 3. 取消注释真实代码

编辑 `qq-bot.adapter.ts`,取消以下代码的注释:

```typescript
// 第44-66行:客户端初始化
this.client = new QQBotClient({
  appId: config.credentials.appId,
  appSecret: config.credentials.appSecret,
  token: config.credentials.token,
  mode: config.credentials.mode || 'websocket',
});

// 注册消息监听器
this.client.on('message', (event: any) => {
  const botMessage = this.transformToBotMessage(event);
  this.messageSubject.next(botMessage);
});

// 注册错误处理
this.client.on('error', (error: Error) => {
  this.logger.error(`QQ bot error: ${error.message}`);
  this.handleReconnect();
});

// 启动连接
await this.client.start();

// 第89-97行:真实消息发送
await this.client.sendMessage({
  conversationId: response.conversationId,
  content: response.content,
  attachments: response.attachments,
  replyToMessageId: response.replyToMessageId,
});
```

### 4. 重启服务

```bash
npm run start:dev
```

现在可以用真实QQ给机器人发消息,会收到"你好"回复!

## 当前代码状态

✅ **已简化完成**:
- BotOrchestrator: 收到消息直接回复"你好",不经过AgentService
- QQBotAdapter: 模拟模式可用,真实SDK代码已注释待启用
- SessionMapper: 暂时不使用,后续可扩展

⏳ **待实施**:
- 安装 @onebots/adapter-qq
- 取消注释真实API调用
- 配置QQ开放平台凭证

## 常见问题

### Q: 为什么不用AgentService?

A: 第一阶段目标是**快速验证架构可行性**,简化为固定回复可以:
1. 避免LLM API调用失败影响测试
2. 快速确认消息收发流程
3. 后续再逐步接入完整对话逻辑

### Q: 如何确认消息真的发出去了?

A: 在模拟模式下,日志显示 "[MOCK] Reply sent..." 即表示流程正确。
接入真实SDK后,QQ聊天窗口会收到实际消息。

### Q: 想测试更复杂的回复怎么办?

A: 修改 `bot-orchestrator.service.ts` 第85行:

```typescript
content: '你好',  // 改成任意文本
```

或者后续启用AgentService实现智能对话。

## 验证清单

- [ ] 编译无错误 (`npm run build`)
- [ ] 服务正常启动
- [ ] 日志显示 "QQ bot connected"
- [ ] 收到模拟消息
- [ ] 日志显示 "Reply sent...你好"
- [ ] API端点 `/bot-admin/status` 返回正常

全部打勾后,即可进入真实QQ测试阶段! 🎉
