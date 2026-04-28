# 企业微信适配器说明

## 概述

企业微信提供了两种不同的机器人接入模式：

1. **智能机器人长连接模式**（推荐）- `WeComAiBotAdapter`
2. **应用消息模式**（已隐藏）- `WeComAppBotAdapter`

---

## 🚀 智能机器人长连接模式（当前启用）

### 技术栈
- **SDK**: `@wecom/aibot-node-sdk`（官方 SDK）
- **连接方式**: WebSocket 长连接
- **适配器类**: `WeComAiBotAdapter`
- **平台标识**: `wecom`

### 优势
✅ **无需公网 IP**：WebSocket 长连接，内网即可使用  
✅ **低延迟**：复用连接，实时性更好  
✅ **无需加解密**：SDK 自动处理  
✅ **支持流式回复**：可实现打字机效果  
✅ **主动推送**：可向用户或群聊主动发送消息  
✅ **官方支持**：企业微信官方提供的 Node.js SDK  

### 配置字段
```typescript
{
  botId: string;        // 智能机器人 Bot ID
  secret: string;       // 长连接专用 Secret
  wsUrl?: string;       // WebSocket URL（可选，默认 wss://openws.work.weixin.qq.com）
}
```

### 获取凭证步骤
1. 打开企业微信客户端 → 工作台 → 智能机器人
2. 点击「创建机器人」→「手动创建」
3. 选择「API 模式创建」
4. 连接方式选择「使用长连接」
5. 保存后自动生成 Bot ID 和 Secret

### 功能特性
- ✅ 接收文本、图片、语音、文件消息
- ✅ 流式回复（支持 Markdown）
- ✅ 模板卡片交互
- ✅ **自动发送欢迎语**（用户首次进入会话时）
- ✅ 进入会话事件
- ✅ 主动推送消息
- ✅ 自动心跳保活
- ✅ 断线重连（指数退避策略）

### 限制
⚠️ **同一时间只能保持一个有效连接**：新连接会踢掉旧连接  
⚠️ **需要维护心跳**：建议 30 秒间隔  

---

## 📦 应用消息模式（已隐藏，保留代码）

### 技术栈
- **SDK**: `@onebots/adapter-wecom`
- **连接方式**: HTTP API + Access Token
- **适配器类**: `WeComAppBotAdapter`（已注释）
- **文件位置**: `adapters/wecom-app-bot.adapter.ts`

### 特点
- 使用企业微信自建应用的 `/cgi-bin/message/send` API
- 需要 CorpId、CorpSecret、AgentId
- 适用于传统的企业微信应用消息场景
- **不支持**智能机器人的高级功能（流式回复、模板卡片等）

### 为何隐藏
❌ **不是智能机器人**：这是普通应用消息，不是 AI 机器人  
❌ **功能受限**：不支持流式回复、模板卡片等高级功能  
❌ **需要公网 IP**：如需接收消息回调，需要配置 Webhook  
❌ **复杂度高**：需要管理 Access Token、处理加解密  

---

## 🔧 如何切换模式

### 当前状态
- ✅ **智能机器人长连接模式**已启用
- ❌ **应用消息模式**已隐藏（代码保留但未注册）

### 如果需要启用应用消息模式

1. **取消注释模块注册** (`bot-gateway.module.ts`)：
   ```typescript
   import { WeComAppBotAdapter } from './adapters/wecom-app-bot.adapter';
   // ...
   providers: [
     // ...
     WeComAppBotAdapter, // 取消注释
   ]
   ```

2. **取消注释工厂注册** (`bot-adapter.factory.ts`)：
   ```typescript
   import { WeComAppBotAdapter } from '../adapters/wecom-app-bot.adapter';
   // ...
   constructor() {
     this.registerAdapter('wecom-app', WeComAppBotAdapter); // 使用不同平台标识
   }
   ```

3. **更新平台元数据** (`platform-metadata.ts`)：
   - 添加新的平台配置或使用现有的 wecom 配置

**注意**：不建议同时启用两种模式，容易混淆。

---

## 📝 使用示例

### 创建智能机器人

```bash
POST http://localhost:3000/api/bots/admin/create
Content-Type: application/json
Authorization: Bearer YOUR_JWT_TOKEN

{
  "platform": "wecom",
  "name": "AI助手",
  "enabled": true,
  "platformConfig": {
    "botId": "YOUR_BOT_ID",
    "secret": "YOUR_SECRET",
    "wsUrl": "wss://openws.work.weixin.qq.com"
  },
  "defaultCharacterId": "your-character-id",
  "reconnectConfig": {
    "enabled": true,
    "maxRetries": 5,
    "retryInterval": 5000
  }
}
```

### 启动机器人

```bash
POST http://localhost:3000/api/bots/admin/:botId/start
Authorization: Bearer YOUR_JWT_TOKEN
```

---

## 🎯 推荐方案

**强烈推荐使用智能机器人长连接模式**，原因：

1. **官方推荐**：企业微信官方主推的 AI 机器人接入方式
2. **功能完整**：支持流式回复、模板卡片、主动推送等
3. **开发简单**：无需处理加解密、Token 管理等复杂逻辑
4. **部署灵活**：内网、本地开发环境均可使用
5. **性能更好**：WebSocket 长连接，延迟更低

---

## 📚 参考资料

- [企业微信智能机器人长连接文档](https://developer.work.weixin.qq.com/document/path/101463)
- [@wecom/aibot-node-sdk npm 包](https://www.npmjs.com/package/@wecom/aibot-node-sdk)
- [企业微信应用消息 API](https://developer.work.weixin.qq.com/document/path/90236)

---

## 📅 更新历史

- **2026-04-28**: 
  - 实现智能机器人长连接适配器 (`WeComAiBotAdapter`)
  - 隐藏应用消息适配器 (`WeComAppBotAdapter`)
  - 更新平台元数据配置
