# 企业微信机器人快速开始

## 5 分钟快速配置

### 步骤 1: 获取企业微信凭证（2 分钟）

1. 登录 [企业微信管理后台](https://work.weixin.qq.com/wework_admin/frame)
2. 进入「我的企业」→ 复制底部的 **企业 ID (CorpId)**
3. 进入「应用管理」→「自建」→「创建应用」
4. 创建后记录：
   - **AgentId**（应用 ID）
   - **Secret**（点击「查看」获取）

### 步骤 2: 配置环境变量（1 分钟）

在 `backend-ts/.env` 文件中添加：

```env
WECOM_CORP_ID=wwxxxxxxxxxxxxxxxx
WECOM_CORP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
WECOM_AGENT_ID=1000001
```

### 步骤 3: 启动后端服务（1 分钟）

```bash
cd backend-ts
npm run start:dev
```

### 步骤 4: 创建并启动机器人（1 分钟）

使用 curl 或 Postman：

```bash
# 1. 创建机器人
curl -X POST http://localhost:3000/api/bots/admin/create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "platform": "wecom",
    "name": "AI助手",
    "enabled": true,
    "platformConfig": {
      "corpId": "wwxxxxxxxxxxxxxxxx",
      "corpSecret": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "agentId": "1000001"
    },
    "defaultCharacterId": "your-character-id",
    "reconnectConfig": {
      "enabled": true,
      "maxRetries": 5,
      "retryInterval": 5000
    }
  }'

# 2. 启动机器人（替换 BOT_ID 为上一步返回的 ID）
curl -X POST http://localhost:3000/api/bots/admin/BOT_ID/start \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 步骤 5: 测试消息发送

```bash
# 通过 Bot Orchestrator 发送测试消息
curl -X POST http://localhost:3000/api/bots/orchestrator/send \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "botId": "BOT_ID",
    "conversationId": "USER_ID",
    "content": "你好，这是测试消息！",
    "sourceType": "private"
  }'
```

## 验证是否成功

### 检查日志

在后端控制台查看日志，应该看到：

```
[WeComBotAdapter] Initializing WeCom bot: AI助手
[WeComBotAdapter] WeCom bot is ready
[WeComBotAdapter] WeCom bot initialized successfully: AI助手
```

### 在企业微信中接收消息

1. 确保目标用户在应用的可见范围内
2. 在企业微信中打开与该应用的对话
3. 应该能看到机器人发送的消息

## 常见问题排查

### 问题 1: Access Token 获取失败

**错误信息**: `获取访问令牌失败: invalid corpid or corpsecret`

**解决方案**:
- 检查 `corpId` 和 `corpSecret` 是否正确
- 确认没有多余的空格或换行符

### 问题 2: 消息发送失败

**错误信息**: `发送消息失败: invalid user`

**解决方案**:
- 确认 `conversationId`（即 UserID）正确
- 确认该用户在应用的可见范围内
- 在企业微信管理后台检查应用配置

### 问题 3: 收不到用户消息

**原因**: 当前基础版本主要演示消息发送功能，消息接收需要额外配置

**解决方案**:
- 参考完整文档中的"消息接收方式"部分
- 配置 Webhook 或使用智能助手 WebSocket

## 下一步

- 📖 阅读 [完整配置指南](./wecom-setup-guide.md)
- 📖 阅读 [实现总结](./wecom-implementation-summary.md)
- 🧪 运行自动化测试：`npm run test:wecom-adapter`

## 技术支持

如有问题，请查看：
- 后端日志（搜索 "WeComBotAdapter"）
- [企业微信开放平台文档](https://developer.work.weixin.qq.com/document/path/90236)
- [OneBots 官方文档](https://github.com/lc-cn/onebots)
