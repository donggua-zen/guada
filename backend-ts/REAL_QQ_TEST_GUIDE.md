# 真实QQ机器人测试指南

## ✅ 已完成

- ✅ 安装 @onebots/adapter-qq SDK
- ✅ 集成真实API调用代码
- ✅ 编译通过,无错误

## 📋 前置准备

### 1. 在QQ开放平台创建机器人

访问 [QQ开放平台](https://q.qq.com/)

步骤:
1. 注册/登录开发者账号
2. 点击"创建应用" → 选择"机器人"
3. 填写应用信息(名称、图标、描述)
4. 获取凭证:
   - **App ID** (应用ID)
   - **App Secret** (应用密钥)
   - **Token** (可选,用于验证)

### 2. 配置机器人能力

在开放平台控制台:
1. 进入"开发设置"
2. 启用所需能力:
   - ✅ 私聊消息 (C2C_MESSAGE_CREATE)
   - ✅ 群聊@消息 (GROUP_AT_MESSAGE_CREATE)
3. 保存配置

### 3. 邀请机器人到QQ群(可选)

如果要测试群聊功能:
1. 在控制台生成邀请链接
2. 将机器人邀请到测试群
3. 确保机器人有发送消息权限

## 🔧 配置环境变量

编辑 `backend-ts/.env`:

```env
# ========== QQ Bot 配置 ==========

# 启用QQ机器人
QQ_BOT_ENABLED=true

# 关闭模拟模式(使用真实QQ)
QQ_MOCK_MESSAGES=false
QQ_MOCK_MODE=false

# 机器人基本信息
QQ_BOT_ID=my-qq-bot              # 唯一标识,可自定义
QQ_BOT_NAME=AI助手               # 显示名称

# QQ开放平台凭证(必填!)
QQ_APP_ID=1234567890             # 替换为你的App ID
QQ_APP_SECRET=your_secret_here   # 替换为你的App Secret
QQ_BOT_TOKEN=                    # Token(可选,留空即可)

# 连接模式
QQ_BOT_MODE=websocket            # websocket 或 webhook

# 断线重连配置
QQ_RECONNECT_MAX_RETRIES=10      # 最大重试次数
QQ_RECONNECT_INTERVAL=5000       # 重试间隔(毫秒)

# 默认关联的角色/模型(可选)
QQ_DEFAULT_CHARACTER_ID=
QQ_DEFAULT_MODEL_ID=
```

**重要**: 必须填写真实的 `QQ_APP_ID` 和 `QQ_APP_SECRET`!

## 🚀 启动测试

### 1. 启动后端服务

```bash
cd backend-ts
npm run start:dev
```

### 2. 观察日志

成功连接应该看到:

```
[INFO] Initializing bot instances...
[INFO] Starting bot: AI助手 (qq)
[INFO] Creating adapter for platform: qq
[INFO] Initializing QQ bot: AI助手
[INFO] QQ bot connected: AI助手
[INFO] Bot instances loaded and started
```

如果看到错误,检查:
- App ID/Secret 是否正确
- 网络连接是否正常
- 防火墙是否阻止WebSocket连接

### 3. 发送测试消息

#### 方式1: 私聊测试
1. 在QQ中找到机器人好友
2. 发送任意消息,如 "你好"
3. 应该收到自动回复 "你好"

#### 方式2: 群聊测试
1. 在群里 @机器人
2. 发送消息,如 "@AI助手 你好"
3. 应该收到自动回复 "你好"

### 4. 查看日志

收到消息时应该看到:

```
[INFO] Received private message    # 私聊
或
[INFO] Received group message      # 群聊
[INFO] Received message from xxx: 你好
[INFO] Reply sent to xxx
[INFO] Replied to xxx
```

## ❌ 常见问题排查

### Q1: 连接失败 "Authentication failed"

**原因**: App ID 或 Secret 错误

**解决**:
1. 检查 `.env` 中的凭证是否正确
2. 确认没有多余空格
3. 在开放平台重新生成 Secret

### Q2: 收不到消息

**可能原因**:
1. 机器人未添加为好友/未在群中
2. 未启用对应的 Intent (私聊/群聊)
3. 消息格式不正确(群聊需要@机器人)

**解决**:
1. 确认已将机器人添加到QQ
2. 在开放平台检查"开发设置" → "消息能力"
3. 群聊时必须 @机器人

### Q3: 发送消息失败

**可能原因**:
1. 机器人没有发送消息权限
2. conversationId 不正确
3. API调用频率限制

**解决**:
1. 检查群权限设置
2. 查看日志中的 conversationId
3. 避免短时间内大量发送

### Q4: WebSocket频繁断开

**可能原因**:
1. 网络不稳定
2. 服务端问题

**解决**:
1. 检查网络连接
2. 查看重连日志
3. 增加 `QQ_RECONNECT_MAX_RETRIES`

## 📊 验证清单

测试前确认:

- [ ] 已在QQ开放平台创建应用
- [ ] 已获取 App ID 和 App Secret
- [ ] 已启用私聊和/或群聊消息能力
- [ ] `.env` 中配置了正确的凭证
- [ ] QQ_MOCK_MESSAGES=false (关闭模拟)
- [ ] 服务启动无错误
- [ ] 日志显示 "QQ bot connected"
- [ ] 发送消息后收到"你好"回复

全部打勾 = 测试成功! 🎉

## 🔍 调试技巧

### 查看详细日志

修改 `backend-ts/src/main.ts`,添加日志级别:

```typescript
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // 设置日志级别
  app.useLogger(['log', 'error', 'warn', 'debug', 'verbose']);
  
  await app.listen(3000);
}
```

### 测试API端点

```bash
# 查看机器人状态
curl http://localhost:3000/bot-admin/status

# 预期输出:
# [{"id":"my-qq-bot","name":"AI助手","platform":"qq","status":"connected"}]
```

### 手动触发重连

```bash
# 重启机器人
curl -X POST http://localhost:3000/bot-admin/my-qq-bot/restart
```

## 📝 下一步

测试成功后,可以:

1. **增强回复逻辑**: 修改 `bot-orchestrator.service.ts`,接入 AgentService 实现智能对话
2. **添加前端管理界面**: 创建机器人配置页面
3. **扩展其他平台**: 按照相同模式实现微信/Discord适配器
4. **持久化配置**: 将机器人配置存入数据库

## ⚠️ 注意事项

1. **沙箱环境**: 开发阶段建议使用沙箱模式(sandbox: true),避免影响真实用户
2. **频率限制**: QQ API有调用频率限制,避免短时间内大量发送
3. **内容审核**: 确保回复内容符合QQ平台规范
4. **隐私保护**: 不要泄露 App Secret,不要提交到Git

---

祝测试顺利! 🚀
