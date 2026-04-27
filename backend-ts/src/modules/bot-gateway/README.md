# Bot Gateway 模块

多渠道机器人适配层,支持 QQ、微信、Discord 等平台的机器人接入。

## 架构设计

### 核心组件

- **IBotPlatform**: 统一平台接口,屏蔽不同平台的差异
- **BotAdapterFactory**: 工厂模式,动态创建适配器实例
- **BotOrchestrator**: 消息编排器,负责消息流转和 Agent 集成
- **SessionMapperService**: 会话映射服务,将外部用户映射到内部 Session
- **BotInstanceManager**: 实例管理器,管理机器人的生命周期

### 目录结构

```
bot-gateway/
├── interfaces/
│   └── bot-platform.interface.ts    # 核心接口定义
├── adapters/
│   └── qq-bot.adapter.ts            # QQ 适配器实现
├── services/
│   ├── bot-adapter.factory.ts       # 适配器工厂
│   ├── bot-instance-manager.service.ts  # 实例管理器
│   ├── bot-orchestrator.service.ts  # 消息编排器
│   └── session-mapper.service.ts    # 会话映射服务
├── controllers/
│   └── bot-admin.controller.ts      # 管理 API
├── dtos/
│   ├── create-bot.dto.ts            # 创建机器人 DTO
│   └── update-bot.dto.ts            # 更新机器人 DTO
└── bot-gateway.module.ts            # 模块定义
```

## 快速开始

### 1. 配置环境变量

在 `.env` 文件中添加 QQ 机器人配置:

```env
# 是否启用 QQ 机器人
QQ_BOT_ENABLED=true

# 机器人 ID(唯一标识)
QQ_BOT_ID=default-qq-bot

# 机器人名称
QQ_BOT_NAME=AI Chat QQ Bot

# QQ 开放平台凭证
QQ_APP_ID=your_app_id
QQ_APP_SECRET=your_app_secret
QQ_BOT_TOKEN=your_token

# 连接模式: websocket 或 webhook
QQ_BOT_MODE=websocket

# 断线重连配置
QQ_RECONNECT_MAX_RETRIES=5
QQ_RECONNECT_INTERVAL=5000

# 默认关联的角色 ID(可选)
QQ_DEFAULT_CHARACTER_ID=character-id-here

# 默认关联的模型 ID(可选)
QQ_DEFAULT_MODEL_ID=model-id-here
```

### 2. 安装 QQ 适配器依赖(待实施)

```bash
npm install @onebots/adapter-qq
```

### 3. 启动应用

```bash
npm run start:dev
```

机器人将在应用启动时自动初始化并开始监听消息。

## API 端点

### 获取所有机器人状态

```http
GET /bot-admin/status
```

响应示例:
```json
[
  {
    "id": "default-qq-bot",
    "name": "AI Chat QQ Bot",
    "platform": "qq",
    "status": "connected"
  }
]
```

### 创建并启动新机器人

```http
POST /bot-admin
Content-Type: application/json

{
  "id": "my-qq-bot",
  "platform": "qq",
  "name": "My Bot",
  "credentials": {
    "appId": "...",
    "appSecret": "...",
    "token": "..."
  },
  "enabled": true
}
```

### 停止机器人

```http
POST /bot-admin/:id/stop
```

### 重启机器人

```http
POST /bot-admin/:id/restart
```

### 更新机器人配置

```http
PUT /bot-admin/:id
Content-Type: application/json

{
  "name": "Updated Bot Name",
  "credentials": { ... }
}
```

### 删除机器人

```http
DELETE /bot-admin/:id
```

## 扩展其他平台

要添加新的平台适配器(如微信),只需:

1. 创建适配器类实现 `IBotPlatform` 接口:

```typescript
@Injectable()
export class WeChatBotAdapter implements IBotPlatform {
  getPlatform(): string {
    return 'wechat';
  }

  async initialize(config: BotConfig): Promise<void> {
    // 实现微信初始化逻辑
  }

  async sendMessage(response: BotResponse): Promise<void> {
    // 实现微信消息发送
  }

  onMessage(): Observable<BotMessage> {
    // 实现微信消息监听
  }

  getStatus(): BotStatus {
    // 返回连接状态
  }

  async shutdown(): Promise<void> {
    // 实现优雅关闭
  }
}
```

2. 在 `BotAdapterFactory` 中注册:

```typescript
constructor() {
  this.registerAdapter('qq', QQBotAdapter);
  this.registerAdapter('wechat', WeChatBotAdapter); // 新增
}
```

3. 在 `BotGatewayModule` 中提供:

```typescript
providers: [
  // ...
  WeChatBotAdapter, // 新增
]
```

无需修改其他代码!

## 当前状态

- ✅ 基础架构完成
- ✅ QQ 适配器框架(模拟模式)
- ✅ 会话映射服务
- ✅ 消息编排器(集成 AgentService)
- ✅ 管理 API
- ⏳ QQ 真实 API 集成(待安装 @onebots/adapter-qq)
- ⏳ 微信适配器(待扩展)
- ⏳ Discord 适配器(待扩展)

## 测试

### 模拟消息测试

在开发环境中,可以启用模拟消息接收:

```env
QQ_MOCK_MESSAGES=true
QQ_MOCK_MODE=true
```

这将每 3 秒发送一条测试消息,用于验证架构是否正确工作。

### 验证流程

1. 启动应用
2. 访问 `http://localhost:3000/bot-admin/status` 查看机器人状态
3. 检查日志输出,确认消息处理流程

## 注意事项

1. **循环依赖**: `BotOrchestrator` 和 `BotInstanceManager` 之间存在循环依赖,已使用 `forwardRef` 解决
2. **JSON 查询**: SQLite 的 JSON 字段查询有限制,当前使用内存过滤方式
3. **资源限制**: 个人电脑建议同时运行的机器人不超过 3 个
4. **断线重连**: 已实现指数退避策略,适应不稳定的网络环境

## 下一步计划

1. 安装并集成真实的 QQ SDK
2. 实现前端管理界面
3. 添加数据库持久化(BotConfig 表)
4. 扩展微信适配器
5. 添加消息队列支持(高并发场景)
6. 完善错误处理和监控
