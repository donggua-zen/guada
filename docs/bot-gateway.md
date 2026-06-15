# Bot 网关

Bot 网关将 AI 对话能力扩展到即时通讯平台，通过统一的适配接口实现多平台无缝接入。

## 架构

```
bot-gateway.module.ts
├── interfaces/
│   └── bot-platform.interface.ts    → IBotPlatform 统一接口
├── adapters/
│   ├── base-bot.adapter.ts          → 基类（公共逻辑）
│   ├── qq-bot.adapter.ts            → QQ 个人 Bot
│   ├── wecom-aibot.adapter.ts       → 企微 AI Bot
│   ├── wecom-app-bot.adapter.ts     → 企微应用 Bot（已禁用）
│   ├── lark-bot.adapter.ts          → 飞书 Bot
│   ├── discord-bot.adapter.ts       → Discord Bot
│   ├── wechat-personal-bot.adapter.ts → 微信个人号 Bot
│   ├── wechat-bot.adapter.ts        → 企业微信 Bot（已禁用）
│   └── mock-bot.adapter.ts          → 测试 Mock
├── services/
│   ├── bot-orchestrator.service.ts  → 消息分发调度
│   ├── bot-instance-manager.service.ts → 实例生命周期管理
│   ├── bot-adapter.factory.ts       → 适配器工厂
│   ├── session-mapper.service.ts    → 会话映射
│   ├── platform-utils.service.ts    → 平台工具函数
│   ├── temp-file-manager.service.ts → 临时文件管理
│   └── bot-admin.service.ts         → 管理后台服务
├── controllers/
│   └── bot-admin.controller.ts      → 管理 API
└── tools/
    └── session-management-tool.provider.ts → Agent 工具
```

## IBotPlatform 接口

策略模式设计，新平台接入只需实现以下接口：

```typescript
interface IBotPlatform {
  getPlatform(): string;
  getCapabilities(): PlatformCapabilities;
  connect(config: BotConfig): Promise<void>;
  disconnect(): Promise<void>;
  sendMessage(message: BotResponse): Promise<void>;
  onMessage(): Observable<BotMessage>;
  onConnect(): Observable<void>;
  onDisconnect(): Observable<BotDisconnectEvent>;
  getStatus(): BotStatus;
  reconnect(): Promise<void>;
}
```

`BaseBotAdapter` 提供通用实现（Subject 管理、连接状态跟踪），子类只需聚焦平台特定的连接和消息收发逻辑。

## 支持平台

| 平台 | 适配器 | 状态 | 能力 |
|------|--------|------|------|
| **QQ 个人 Bot** | `QQBotAdapter` | ✅ 可用 | 消息收发、群聊、图片 |
| **企微 AI Bot** | `WecomAiBotAdapter` | ✅ 可用 | 消息收发、文件 |
| **飞书** | `LarkBotAdapter` | ✅ 可用 | 消息收发、富文本 |
| **微信个人号** | `WechatPersonalBotAdapter` | ✅ 可用 | 消息收发 |
| **Discord** | `DiscordBotAdapter` | ✅ 可用 | 消息收发、Embed |
| **企微应用 Bot** | `WecomAppBotAdapter` | ⚠️ 已禁用 | — |
| **企业微信** | `WechatBotAdapter` | ⚠️ 已禁用 | — |

## 核心机制

### 消息分发流程

```
IM 平台消息
    ↓ WebSocket / HTTP
BotAdapter.onMessage() → Observable<BotMessage>
    ↓
BotOrchestrator 调度
    ├─ 消息去重（相同 sessionId 串行处理）
    └─ session-mapper 映射 → 找到内部 Session
            ↓
        ChatRunnerService.startStream() → Agent Engine
            ↓
        BotResponse → BotAdapter.sendMessage()
            ↓
    IM 平台回复
```

### 会话映射

通过 `SessionMapperService` 建立外部用户到内部 Session 的映射：

```
(platform, type, nativeId) → Session ID
    ├─ platform: "qq" | "wecom" | "lark" | ...
    ├─ type: "private" | "group"
    └─ nativeId: 平台用户/群组 ID
```

映射关系持久化到数据库，确保跨会话、跨重启的连续性。

### 消息合并

同一用户 1.5 秒窗口内的多条消息合并为一条处理，避免碎片化。合并后的消息体包含所有文本片段。

### 自动重连

`BaseBotAdapter` 内置指数退避重连机制：
- 首次重连等待 1 秒
- 后续每次翻倍（最多 60 秒）
- 持续重连直到成功或被手动停止

### 实例生命周期

`BotInstanceManagerService` 提供：
- 动态启动/停止/重启机器人实例
- 多实例并行管理
- 状态监控（running / stopped / error）
- 配置热更新

### 临时文件管理

IM 消息中的图片、文件等附件通过 `TempFileManagerService` 下载保存，供 Agent 处理使用，处理完成后自动清理。
