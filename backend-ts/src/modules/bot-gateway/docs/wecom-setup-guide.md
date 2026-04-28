# 企业微信机器人配置指南

## 概述

企业微信适配器使用 `@onebots/adapter-wecom` 提供的底层 `WeComBot` 类，直接封装企业微信开放平台 API，实现消息收发功能。

## 前置条件

1. **企业微信管理员权限**：需要在企业微信管理后台创建自建应用
2. **npm 包已安装**：`@onebots/adapter-wecom`（版本 1.0.7）

## 配置步骤

### 1. 在企业微信管理后台创建应用

1. 登录 [企业微信管理后台](https://work.weixin.qq.com/wework_admin/frame)
2. 进入「应用管理」→「自建」→「创建应用」
3. 填写应用信息：
   - 应用名称：例如 "AI 助手"
   - 应用图标：上传合适的图标
   - 可见范围：选择可以使用该机器人的部门或成员
4. 创建完成后，记录以下信息：
   - **AgentId**：应用 ID
   - **Secret**：应用 Secret（点击「查看」获取）

### 2. 获取企业 ID (CorpId)

1. 在企业微信管理后台，进入「我的企业」
2. 在页面底部找到「企业 ID」
3. 复制该 ID

### 3. 配置环境变量

在 `backend-ts/.env` 文件中添加以下配置：

```env
# 企业微信机器人配置示例
WECOM_BOT_ID=wecom-bot-1
WECOM_BOT_NAME=AI助手
WECOM_CORP_ID=wwxxxxxxxxxxxxxxxx
WECOM_CORP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
WECOM_AGENT_ID=1000001
```

### 4. 通过 API 创建机器人实例

使用 Bot Admin API 创建企业微信机器人：

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

### 5. 启动机器人

创建成功后，调用启动接口：

```bash
POST http://localhost:3000/api/bots/admin/:botId/start
Authorization: Bearer YOUR_JWT_TOKEN
```

## 技术实现细节

### 适配器架构

企业微信适配器采用**轻量级封装模式**：

- **直接使用底层 Bot 类**：`WeComBot` from `@onebots/adapter-wecom`
- **不依赖 BaseApp**：无需启动 HTTP 服务，零端口占用
- **实现 IBotPlatform 接口**：与其他平台适配器保持一致

### 核心功能

1. **Access Token 管理**：自动获取和刷新企业微信访问令牌
2. **消息发送**：支持文本消息发送到指定用户
3. **事件监听**：通过轮询或 Webhook 接收消息（当前实现为基础版本）
4. **断线重连**：支持自动重连机制

### 消息流程

```
用户发送消息 → 企业微信服务器 → WeComBot 接收 → 转换为 BotMessage 
→ BotOrchestrator 处理 → AI 生成回复 → WeComBot 发送回复 → 用户收到
```

## 注意事项

### 1. 消息接收方式

当前实现为基础版本，主要支持**主动发送消息**。如需接收用户消息，有以下选项：

- **Webhook 回调模式**：需要在企业微信管理后台配置回调 URL（需要公网 IP）
- **智能助手 WebSocket 长连接**：使用企业微信智能助手功能（推荐，但需要额外配置）

### 2. 消息类型限制

企业微信应用消息支持以下类型：

- ✅ 文本消息
- ✅ 图片消息
- ✅ 语音消息
- ✅ 视频消息
- ✅ 文件消息
- ✅ Markdown 消息
- ✅ 模板卡片消息

当前适配器仅实现了**文本消息**的发送和接收。

### 3. 会话 ID 说明

在企业微信中，`conversationId` 对应的是用户的 **UserID**（企业微信内部的用户标识）。

### 4. 安全建议

- **不要泄露 Secret**：`corpSecret` 具有高权限，请妥善保管
- **使用环境变量**：敏感信息应存储在 `.env` 文件中，不要提交到代码仓库
- **限制可见范围**：在企业微信管理后台设置应用的可见范围，避免不必要的访问

## 常见问题

### Q1: 如何调试企业微信机器人？

A: 查看后端日志，搜索 "WeComBotAdapter" 相关的日志输出。常见日志包括：
- `Initializing WeCom bot: xxx`
- `WeCom bot is ready`
- `Sending message: ...`
- `Message sent successfully to: ...`

### Q2: 消息发送失败怎么办？

A: 检查以下几点：
1. 确认 `corpId`、`corpSecret`、`agentId` 配置正确
2. 确认目标用户 UserID 正确
3. 确认应用在可见范围内包含该用户
4. 查看错误日志中的具体错误信息

### Q3: 如何接收用户消息？

A: 当前基础版本主要演示了消息发送功能。如需完整的双向通信，建议：
1. 使用企业微信智能助手的 WebSocket 长连接（需要升级到智能助手模式）
2. 或者配置 Webhook 回调地址（需要公网 IP）

## 下一步计划

- [ ] 实现完整的消息接收功能（Webhook 或 WebSocket）
- [ ] 支持更多消息类型（图片、文件等）
- [ ] 支持群聊消息
- [ ] 支持流式回复
- [ ] 添加单元测试

## 参考资料

- [OneBots 官方文档](https://github.com/lc-cn/onebots)
- [企业微信开放平台 API 文档](https://developer.work.weixin.qq.com/document/path/90236)
- [@onebots/adapter-wecom npm 包](https://www.npmjs.com/package/@onebots/adapter-wecom)
