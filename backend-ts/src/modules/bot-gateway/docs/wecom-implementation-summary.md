# 企业微信适配器实现总结

## 完成的工作

### 1. 安装依赖包

```bash
npm install @onebots/adapter-wecom
```

已安装版本：`@onebots/adapter-wecom@1.0.7`

### 2. 创建适配器类

**文件**: `backend-ts/src/modules/bot-gateway/adapters/wecom-bot.adapter.ts`

**核心特性**:
- ✅ 实现 `IBotPlatform` 接口
- ✅ 使用 OneBots 底层 `WeComBot` 类（轻量级封装模式）
- ✅ 自动管理 Access Token
- ✅ 支持文本消息发送
- ✅ 支持断线重连机制
- ✅ 完整的日志记录
- ✅ 与其他平台适配器保持一致的架构

### 3. 注册适配器

**修改的文件**:
- `bot-gateway.module.ts`: 导入并注册 `WeComBotAdapter`
- `bot-adapter.factory.ts`: 在工厂中注册 'wecom' 平台
- `bot-platform.interface.ts`: 更新 `BotConfig` 接口，添加 'wecom' 平台类型

### 4. 文档和测试

**创建的文档**:
- `docs/wecom-setup-guide.md`: 完整的配置和使用指南
- `scripts/test-wecom-adapter.ts`: 自动化测试脚本
- `package.json`: 添加测试命令 `test:wecom-adapter`

## 技术架构

### 设计模式

采用**轻量级封装模式**，与现有的 QQ 和飞书适配器保持一致：

```
┌─────────────────────────────────────┐
│   BotOrchestrator (业务层)          │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│   WeComBotAdapter (适配器层)        │
│   - 实现 IBotPlatform 接口          │
│   - 转换消息格式                     │
│   - 管理连接状态                     │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│   WeComBot (OneBots 底层类)         │
│   - 封装企业微信 API                 │
│   - 管理 Access Token                │
│   - 发送 HTTP 请求                   │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│   企业微信开放平台 API               │
└─────────────────────────────────────┘
```

### 关键优势

1. **零端口占用**: 不启动 HTTP 服务，避免与 NestJS 冲突
2. **简单直观**: 直接使用底层 Bot 类，无需理解复杂的抽象层
3. **易于维护**: 代码量小，逻辑清晰
4. **可扩展**: 可以轻松添加更多功能（图片、文件等）

## 当前功能

### 已实现

- ✅ 机器人初始化（获取 Access Token）
- ✅ 发送文本消息到指定用户
- ✅ 断线重连机制
- ✅ 优雅关闭
- ✅ 完整的错误处理
- ✅ 详细的日志记录

### 待完善

- ⏳ 完整的消息接收功能（Webhook 或 WebSocket）
- ⏳ 支持更多消息类型（图片、文件、Markdown 等）
- ⏳ 支持群聊消息
- ⏳ 支持流式回复
- ⏳ 单元测试

## 使用方法

### 1. 配置环境变量

在 `.env` 文件中添加：

```env
WECOM_CORP_ID=wwxxxxxxxxxxxxxxxx
WECOM_CORP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
WECOM_AGENT_ID=1000001
```

### 2. 通过 API 创建机器人

```bash
POST http://localhost:3000/api/bots/admin/create
Content-Type: application/json
Authorization: Bearer YOUR_JWT_TOKEN

{
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
}
```

### 3. 启动机器人

```bash
POST http://localhost:3000/api/bots/admin/:botId/start
Authorization: Bearer YOUR_JWT_TOKEN
```

### 4. 运行测试脚本

```bash
npm run test:wecom-adapter
```

## 注意事项

### 消息接收限制

当前实现为基础版本，主要演示了**消息发送**功能。如需完整的双向通信：

**选项 1: Webhook 回调模式**
- 需要在企业微信管理后台配置回调 URL
- 需要公网 IP 或内网穿透工具
- 适合生产环境

**选项 2: 智能助手 WebSocket 长连接**
- 使用企业微信智能助手功能
- 无需公网 IP
- 推荐用于开发和本地测试
- 需要使用 `@wecom/aibot-node-sdk` 而非 `@onebots/adapter-wecom`

### 会话 ID 说明

在企业微信中，`conversationId` 对应的是用户的 **UserID**（企业微信内部的用户标识），可以通过以下方式获取：

1. 企业微信管理后台查看成员列表
2. 调用企业微信 API `/cgi-bin/user/list` 获取部门成员
3. 从消息事件中获取 `FromUserName` 字段

## 下一步计划

### 短期（1-2 周）

1. **实现消息接收功能**
   - 选项 A: 实现 Webhook 回调处理
   - 选项 B: 切换到智能助手 WebSocket 模式

2. **完善消息类型支持**
   - 图片消息
   - 文件消息
   - Markdown 消息

3. **添加基础测试**
   - 单元测试
   - 集成测试

### 中期（1 个月）

1. **支持群聊消息**
2. **支持流式回复**
3. **优化错误处理和重试机制**
4. **添加性能监控**

### 长期（3 个月）

1. **支持模板卡片消息**
2. **支持主动推送消息**
3. **集成企业微信通讯录管理**
4. **支持多租户隔离**

## 参考资料

- [OneBots 官方仓库](https://github.com/lc-cn/onebots)
- [@onebots/adapter-wecom npm 包](https://www.npmjs.com/package/@onebots/adapter-wecom)
- [企业微信开放平台 API 文档](https://developer.work.weixin.qq.com/document/path/90236)
- [企业微信智能助手 SDK](https://www.npmjs.com/package/@wecom/aibot-node-sdk)

## 贡献者

- 初始实现：Lingma AI Assistant
- 日期：2026-04-28
