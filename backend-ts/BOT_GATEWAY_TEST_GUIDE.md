# Bot Gateway 快速测试指南

## 目标

验证 Bot Gateway 模块的基础架构是否正常工作,无需真实的 QQ 账号。

## 步骤

### 1. 启用模拟模式

编辑 `backend-ts/.env` 文件,设置以下配置:

```env
# 启用 QQ 机器人
QQ_BOT_ENABLED=true

# 启用模拟消息(每3秒发送一条测试消息)
QQ_MOCK_MESSAGES=true

# 启用模拟模式(无需真实连接)
QQ_MOCK_MODE=true

# 其他配置保持默认即可
QQ_BOT_ID=test-bot
QQ_BOT_NAME=Test Bot
```

### 2. 启动后端服务

```bash
cd d:\AI\ai_chat\backend-ts
npm run start:dev
```

### 3. 观察日志输出

你应该看到类似以下的日志:

```
[Nest] xxx  - [INFO] Initializing bot instances...
[Nest] xxx  - [INFO] Starting bot: Test Bot (qq)
[Nest] xxx  - [INFO] Creating adapter for platform: qq
[Nest] xxx  - [WARN] QQ adapter initialized in MOCK mode (no real connection)
[Nest] xxx  - [INFO] QQ bot connected: Test Bot
[Nest] xxx  - [INFO] Starting message listener for bot: test-bot
[Nest] xxx  - [WARN] Starting mock message simulation for testing
[Nest] xxx  - [INFO] Bot instances loaded and started
```

3秒后开始收到模拟消息:

```
[Nest] xxx  - [WARN] [MOCK] Sent test message: 这是第 1 条测试消息
[Nest] xxx  - [INFO] Received message from test-user-001 in conversation test-conversation
[Nest] xxx  - [INFO] Created external user: xxx
[Nest] xxx  - [INFO] Created new session: xxx for qq_private_test-user-001
[Nest] xxx  - [INFO] Retrieved xx messages for LLM inference
[Nest] xxx  - [INFO] Tokens saved: prompt=xx, completion=xx, total=xx
[Nest] xxx  - [INFO] Message content updated: xxx, finishReason: stop
[Nest] xxx  - [INFO] Response sent to test-user-001
```

### 4. 测试管理 API

打开新的终端窗口,测试 API 端点:

#### 获取机器人状态

```bash
curl http://localhost:3000/bot-admin/status
```

预期响应:
```json
[
  {
    "id": "test-bot",
    "name": "Test Bot",
    "platform": "qq",
    "status": "connected"
  }
]
```

#### 创建新机器人

```bash
curl -X POST http://localhost:3000/bot-admin \
  -H "Content-Type: application/json" \
  -d "{\"id\":\"bot-2\",\"platform\":\"qq\",\"name\":\"Bot 2\",\"credentials\":{},\"enabled\":true}"
```

预期响应:
```json
{
  "success": true,
  "message": "Bot created and started"
}
```

#### 停止机器人

```bash
curl -X POST http://localhost:3000/bot-admin/test-bot/stop
```

预期响应:
```json
{
  "success": true,
  "message": "Bot stopped"
}
```

### 5. 验证数据库

检查 `backend-ts/data/ai_chat.db`,应该看到:

1. **user 表**: 新增了一条记录
   - username: `external_test-user-001`
   - nickname: `User test-us`

2. **session 表**: 新增了一条记录
   - settings 包含: `{"externalSessionKey":"qq_private_test-user-001",...}`

3. **message 表**: 每条模拟消息会创建 2 条记录
   - role: 'user' (用户消息)
   - role: 'assistant' (AI 回复)

4. **message_content 表**: 对应的消息内容

可以使用 SQLite 浏览器或命令行查看:

```bash
# 安装 sqlite3 命令行工具
npm install -g sqlite3

# 查询外部用户
sqlite3 data/ai_chat.db "SELECT * FROM user WHERE username LIKE 'external_%';"

# 查询外部会话
sqlite3 data/ai_chat.db "SELECT id, title, settings FROM session WHERE settings IS NOT NULL;"
```

### 6. 测试完整流程

模拟消息会自动触发以下流程:

```
模拟消息 → QQBotAdapter 
         → BotOrchestrator 
         → SessionMapper (创建 User/Session)
         → AgentService (调用 LLM)
         → QQBotAdapter (发送回复)
```

你可以在日志中看到完整的处理链路。

## 常见问题

### Q1: 编译错误 "Cannot find module"

**解决**: TypeScript 语言服务缓存问题,重启 VSCode 或运行:

```bash
npm run build
```

如果编译成功,说明代码没问题,可以忽略 IDE 的错误提示。

### Q2: 循环依赖警告

**正常现象**。BotOrchestrator 和 BotInstanceManager 之间存在循环依赖,已通过 `forwardRef` 解决。

NestJS 会在启动时显示警告,但不影响功能:

```
[Nest] xxx  - [WARN] A circular dependency has been detected...
```

### Q3: 没有看到模拟消息

**检查**:
1. `.env` 中 `QQ_MOCK_MESSAGES=true`
2. 日志中是否有 "Starting mock message simulation for testing"
3. 等待至少 3 秒(第一条消息在 3 秒后发送)

### Q4: AgentService 调用失败

**可能原因**:
1. 没有配置有效的模型提供商
2. LLM API Key 无效

**解决**: 确保 `models` 表中有可用的模型配置,或者先在前端界面配置好模型。

## 下一步

模拟测试通过后:

1. **禁用模拟模式**:
   ```env
   QQ_MOCK_MESSAGES=false
   QQ_MOCK_MODE=false
   ```

2. **安装真实 QQ SDK**:
   ```bash
   npm install @onebots/adapter-qq
   ```

3. **配置真实凭证**:
   - 在 [QQ 开放平台](https://q.qq.com/) 创建机器人应用
   - 获取 AppID、AppSecret、Token
   - 填入 `.env` 文件

4. **重启服务**,开始接收真实 QQ 消息!

## 性能提示

- 模拟模式下,每 3 秒发送一条消息,共 10 条
- 每条消息会触发一次完整的 LLM 调用
- 如需调整频率,修改 `qq-bot.adapter.ts` 中的 `setInterval` 时间
- 生产环境建议限制并发对话数,避免资源耗尽

## 清理测试数据

测试完成后,如需清理:

```bash
# 删除测试用户和会话
sqlite3 data/ai_chat.db <<EOF
DELETE FROM message_content WHERE messageId IN (
  SELECT id FROM message WHERE sessionId IN (
    SELECT id FROM session WHERE userId IN (
      SELECT id FROM user WHERE username LIKE 'external_%'
    )
  )
);
DELETE FROM message WHERE sessionId IN (
  SELECT id FROM session WHERE userId IN (
    SELECT id FROM user WHERE username LIKE 'external_%'
  )
);
DELETE FROM session WHERE userId IN (
  SELECT id FROM user WHERE username LIKE 'external_%'
);
DELETE FROM user WHERE username LIKE 'external_%';
EOF
```

⚠️ **注意**: 上述操作不可恢复,请谨慎执行!
