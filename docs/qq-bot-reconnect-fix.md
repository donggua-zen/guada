# QQ 机器人重连机制问题分析与修复方案

> **文档版本**: v1.0  
> **编写日期**: 2026-05-07  
> **涉及模块**: `bot-gateway` (QQBotAdapter / QQBot SDK / BotInstanceManager)  
> **问题现象**: QQ 机器人运行时间一长就断开连接，断开后无法成功重连，最终被永久禁用  

---

## 目录

1. [问题概述](#1-问题概述)  
2. [架构现状分析](#2-架构现状分析)  
3. [根因分析](#3-根因分析)  
   - [3.1 双重重连冲突](#31-双重重连冲突)  
   - [3.2 递归重连无保护](#32-递归重连无保护)  
   - [3.3 Token 过期未刷新](#33-token-过期未刷新)  
   - [3.4 重连状态未完全重置](#34-重连状态未完全重置)  
4. [修复方案](#4-修复方案)  
   - [4.1 QQBot SDK 层修复](#41-qqbot-sdk-层修复)  
   - [4.2 QQBotAdapter 层修复](#42-qqbotadapter-层修复)  
   - [4.3 BotInstanceManager 层修复](#43-botinstancemanager-层修复)  
5. [修复后流程图](#5-修复后流程图)  
6. [验证方法](#6-验证方法)  
7. [附录：核心代码修改清单](#7-附录核心代码修改清单)

---

## 1. 问题概述

### 1.1 现象

- QQ 机器人运行 **30 分钟 ~ 数小时** 后，WebSocket 连接断开
- 断开后，`BotInstanceManager` 触发重连，**但重连始终不成功**
- 经过若干次重试后，机器人被标记为 `enabled: false`，永久禁用
- 重新手动启用后可恢复正常，但一段时间后又复现

### 1.2 影响范围

| 项目 | 影响 |
|:----|:----|
| 用户体验 | QQ 群/私聊机器人不可用 |
| 恢复成本 | 需手动重新启用，无法自动恢复 |
| 日志噪音 | 重连失败期间大量 Error 日志刷屏 |

---

## 2. 架构现状分析

当前重连涉及三层，**每一层都有自己的重连逻辑**：

```
┌─────────────────────────────────────────────────────────────┐
│ BotInstanceManager (bot-instance-manager.service.ts)        │
│                                                             │
│  scheduleReconnect():                                       │
│    ├── shutdown() → stop bot                                │
│    ├── initialize() → restart bot (全新连接)                │
│    ├── 失败 → 递归调用 scheduleReconnect()                   │
│    └── 达到 maxRetries → 禁用机器人                          │
├─────────────────────────────────────────────────────────────┤
│  QQBotAdapter (qq-bot.adapter.ts)                           │
│                                                             │
│  reconnect():                                               │
│    ├── this.shutdown() → client.stop()                      │
│    ├── this.initialize() → new QQBot() + client.start()     │
│    └── 注意: 注释写着"不负责重连,由Manager统一管理"          │
├─────────────────────────────────────────────────────────────┤
│  QQBot SDK (qq/qq-bot.sdk.ts)                               │
│                                                             │
│  handleReconnect():                                         │
│    ├── Resume 恢复会话 (3次尝试)                              │
│    ├── 指数退避重连 (公式: min(2^n * 1s, 30s))               │
│    └── 达到 maxRetry → 停止（但初始配置了 maxRetry: 0）      │
└─────────────────────────────────────────────────────────────┘
```

### 2.1 核心矛盾

**QQBot SDK** 的 `handleReconnect()` 在接收到 WebSocket `close` 事件时**自动触发**，而 **BotInstanceManager** 在检测到连接异常时也**同时触发** `scheduleReconnect()`。两层重连同时运行，互相干扰。

---

## 3. 根因分析

### 3.1 双重重连冲突（致命问题）

**涉及文件**: `qq-bot.sdk.ts` 第 290~330 行 `handleReconnect()`

**问题描述**:
QQBot SDK 内部有自己的重连机制（在 `ws.on('close')` 回调中自动触发），同时 BotInstanceManager 也在外部调度重连。两者**没有协调机制**，导致：

```
时间轴:
T0: WebSocket 断开 → ws.on('close') 触发
T1: SDK.handleReconnect() 开始内部重连 (connectWebSocket + resume)
T2: Manager.scheduleReconnect() 定时器触发
T3: Manager 调用 adapter.shutdown()
     → client.stop() 关闭正在重连中的 WebSocket
T4: SDK 内部重连被中断，触发新的 close 事件
T5: SDK.handleReconnect() 再次触发 → 死循环
```

**直接后果**:
- 多个 WebSocket 连接同时存在
- 心跳定时器泄漏
- Token 被多次刷新，触发频率限制

### 3.2 递归重连无保护

**涉及文件**: `bot-instance-manager.service.ts` 第 245~280 行

**问题描述**:
`scheduleReconnect()` 在重连失败时递归调用自身，但**没有防止重复调用的锁机制**：

```typescript
// 伪代码表示当前逻辑
scheduleReconnect(botId, config, error):
    if (attempts >= maxRetries) {
        disableBot()  // 禁用机器人
        return
    }
    attempts++
    setTimeout(async () => {
        try {
            await adapter.shutdown()    // 如果这里抛异常...
            await adapter.initialize()
        } catch (e) {
            scheduleReconnect(botId, config, e.message)  // ← 递归
        }
    }, interval)
```

**问题链**:
1. `shutdown()` 在被 SDK 内部重连打断时抛异常
2. 进入 catch，递归调用 `scheduleReconnect()`
3. 再次 `shutdown()` 仍然抛异常 → 再次递归
4. 可能短时间内堆积多个定时器

### 3.3 Token 过期未刷新

**涉及文件**: `qq-bot.sdk.ts` 第 109~140 行 `getAccessToken()`

**问题描述**:
QQ 官方 Access Token 有效期为 **7200 秒（2 小时）**，但 SDK 的重连流程中不会主动检查 Token 有效性：

```
WebSocket 断开 → 时间流逝
     ↓
SDK 内部重连（指数退避: 1s, 2s, 4s, 8s... 最长 30s）
     ↓
尝试恢复会话 (Resume) → 使用缓存的 accessToken
     ↓
如果 Token 恰好过期 → 认证失败 (401)
     ↓
SessionId 被清空 → 重新 Identify
     ↓
Identify 仍然使用过期 Token → 再次失败
     ↓
循环...
```

Token 刷新仅在 `getAccessToken()` 被调用时检查，但在重连流程中，`resume()` 和 `identify()` 调用 `getAccessToken()` 时可能正好在过期边界，导致认证反复失败。

### 3.4 重连状态未完全重置

**涉及文件**: `qq-bot.adapter.ts` 第 138~145 行 `reconnect()`

**问题描述**:
Adapter 的 `reconnect()` 方法复用同一个 `QQBot` 实例，但 SDK 内部的 `reconnectAttempts` 和 `resumeFailCount` 计数器没有被重置：

```typescript
async reconnect(): Promise<void> {
    await this.shutdown();        // 清空了 ws, sessionId, lastSeq
    if (this.config) {
        await this.initialize(this.config);  // new QQBot()? 不，用旧的
    }
}
```

`this.client` 是同一个对象，`stop()` 没有重置 `reconnectAttempts` 和 `resumeFailCount`。当 `initialize()` 再次调用 `start()` → `connectWebSocket()` 时，如果再次断开，SDK 内部会认为"已经重试过 N 次了"，可能过早放弃。

---

## 4. 修复方案

### 4.1 QQBot SDK 层修复

#### 4.1.1 完全禁用 SDK 内部重连

**文件**: `qq/qq-bot.sdk.ts`

**修改 `handleReconnect()` 方法**：

```typescript
/**
 * WebSocket 断开处理
 * 
 * 注意: 内部重连已禁用（由 BotInstanceManager 统一管理）
 * 这里只负责: 清理资源 + 发射事件通知上层
 */
private handleReconnect(code: number): void {
    // 清除心跳
    if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
    }

    // [修改] 无论什么情况，都不在 SDK 内部重连
    // 只发射 close 事件，让上层 (Adapter/Manager) 处理
    this.emit('ws_closed', { code, sessionId: this.sessionId, lastSeq: this.lastSeq });
    
    // [删除] 以下代码全部移除:
    // - Resume 恢复会话逻辑
    // - 指数退避重连逻辑
    // - reconnectAttempts 相关逻辑
}
```

#### 4.1.2 新增主动清理方法

**文件**: `qq/qq-bot.sdk.ts`

新增 `reset()` 方法，供 Adapter 在重连前调用，**彻底重置 SDK 内部状态**：

```typescript
/**
 * 彻底重置 SDK 内部状态（在重连前调用）
 * 比 stop() 更彻底，重置所有计数器
 */
async reset(): Promise<void> {
    await this.stop();
    
    // 重置所有计数器状态
    this.reconnectAttempts = 0;
    this.resumeFailCount = 0;
    this.isResuming = false;
    this.sessionId = '';
    this.lastSeq = 0;
    this.accessToken = '';
    this.tokenExpireTime = 0;
    this.user = null;
}
```

#### 4.1.3 重连时强制刷新 Token

**文件**: `qq/qq-bot.sdk.ts`

修改 `getAccessToken()` 或新增 `forceRefreshToken()`：

```typescript
/**
 * 强制刷新 Access Token（重连时使用）
 * 不管旧 Token 是否过期，都重新获取
 */
async forceRefreshToken(): Promise<string> {
    this.accessToken = '';          // 清空旧 Token
    this.tokenExpireTime = 0;       // 强制过期
    return this.getAccessToken();   // 重新获取
}
```

---

### 4.2 QQBotAdapter 层修复

#### 4.2.1 重连时使用全新的 SDK 实例

**文件**: `qq-bot.adapter.ts`

修改 `reconnect()` 方法，**每次都创建新的 `QQBot` 实例**，避免状态残留：

```typescript
async reconnect(): Promise<void> {
    this.logger.log(`Attempting to reconnect QQ bot...`);
    
    // 1. 先彻底关闭旧客户端
    if (this.client) {
        try {
            await this.client.reset();  // 调用新增的 reset 方法
        } catch (error: any) {
            this.logger.warn(`Error during client reset: ${error.message}`);
        }
        this.client = null;
    }
    
    // 2. 重新初始化（会创建新的 QQBot 实例）
    if (this.config) {
        await this.initialize(this.config);
    }
}
```

同时修改 `initialize()` 方法，确保**如果已有 client，先清理干净**：

```typescript
async initialize(config: BotConfig): Promise<void> {
    this.logger.log(`Initializing QQ bot: ${config.name}`);
    this.config = config;
    this.status = BotStatus.CONNECTING;

    try {
        // [新增] 如果已有 client，先清理
        if (this.client) {
            try {
                await this.client.reset();
            } catch {
                // 忽略清理错误
            }
            this.client = null;
        }
        
        // 创建全新 QQ Bot 实例
        this.client = new QQBot({
            // ... 配置不变
        });
        // ... 其余逻辑不变
    }
}
```

#### 4.2.2 监听 SDK 的 ws_closed 事件，通知 Manager

**文件**: `qq-bot.adapter.ts`

在当前 `client.on('error')` 基础上，增加对 `ws_closed` 的监听：

```typescript
// 注册错误处理
this.client.on('error', (error: Error) => {
    this.logger.error(`QQ bot error: ${error.message}`);
    this.status = BotStatus.ERROR;
    // [新增] 发射自定义事件，让 Manager 感知
    this.emit('bot_error', error);
});

// [新增] 监听 WebSocket 关闭事件（来自 SDK 的主动通知）
this.client.on('ws_closed', (info: { code: number }) => {
    this.logger.warn(`QQ bot WebSocket closed with code: ${info.code}`);
    this.status = BotStatus.DISCONNECTED;
    // 发射断开事件，触发 Manager 重连
    this.emit('bot_disconnected', info);
});
```

---

### 4.3 BotInstanceManager 层修复

#### 4.3.1 加防重入锁

**文件**: `bot-instance-manager.service.ts`

修改 `scheduleReconnect()`，添加**重连中标记**防止并发：

```typescript
// 在 BotInstanceManager 类中添加属性
private reconnectingBots: Set<string> = new Set();

private scheduleReconnect(botId: string, config: BotConfig, lastError: string): void {
    const instance = this.botInstances.get(botId);
    if (!instance) {
        this.logger.error(`Cannot schedule reconnect: bot instance not found for ${botId}`);
        return;
    }

    // [新增] 防重入检查
    if (this.reconnectingBots.has(botId)) {
        this.logger.warn(`Bot ${botId} is already reconnecting, skipping duplicate schedule`);
        return;
    }

    if (!config.reconnectConfig?.enabled) {
        this.logger.log(`Reconnect disabled for bot ${botId}`);
        this.botInstances.delete(botId);
        return;
    }

    const maxRetries = config.reconnectConfig.maxRetries || 5;
    const retryInterval = config.reconnectConfig.retryInterval || 5000;

    if (instance.reconnectAttempts >= maxRetries) {
        this.logger.error(`Max reconnection attempts reached for bot ${botId} (${maxRetries}).`);
        this.disableBot(botId, lastError).catch((err) => {
            this.logger.error(`Failed to disable bot ${botId}: ${err.message}`);
        });
        this.botInstances.delete(botId);
        return;
    }

    instance.reconnectAttempts++;

    this.logger.log(
        `Scheduling reconnect for bot ${botId} in ${retryInterval}ms (attempt ${instance.reconnectAttempts}/${maxRetries})`,
    );

    // [新增] 标记为正在重连
    this.reconnectingBots.add(botId);

    instance.reconnectTimer = setTimeout(async () => {
        try {
            this.logger.log(`Attempting to reconnect bot ${botId}...`);
            
            // [修改] 使用 adapter 的 reconnect() 方法而不是 shutdown + initialize
            // 让 adapter 内部处理清理和重新初始化的逻辑
            await instance.adapter.reconnect();
            
            // 重连成功后重新绑定消息监听
            await this.orchestrator.startBotListener(botId, instance.adapter, config);
            
            // 重连成功，重置计数器
            instance.reconnectAttempts = 0;
            this.logger.log(`Bot ${botId} reconnected successfully`);
            
            // [新增] 更新数据库状态为已连接
            await this.prisma.botInstance.update({
                where: { id: botId },
                data: { status: 'connected', lastError: null },
            }).catch((err) => {
                this.logger.error(`Failed to update bot status: ${err.message}`);
            });
        } catch (error: any) {
            this.logger.error(`Reconnection failed for bot ${botId}: ${error.message}`);
            
            await this.prisma.botInstance.update({
                where: { id: botId },
                data: { status: 'error', lastError: error.message },
            }).catch((dbError) => {
                this.logger.error(`Failed to update bot status: ${dbError.message}`);
            });
            
            // 继续调度下一次重连
            this.scheduleReconnect(botId, config, error.message);
        } finally {
            // [新增] 无论成功还是失败，都移除重连标记
            this.reconnectingBots.delete(botId);
        }
    }, retryInterval);
}
```

#### 4.3.2 超时保护

**文件**: `bot-instance-manager.service.ts`

为每次重连操作添加**超时保护**：

```typescript
// [新增] 重连超时时间（30秒）
private readonly RECONNECT_TIMEOUT_MS = 30000;

// 在重连的 try 块中：
instance.reconnectTimer = setTimeout(async () => {
    // [新增] 超时控制
    const reconnectPromise = instance.adapter.reconnect();
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Reconnect timed out after 30s')), 
                   this.RECONNECT_TIMEOUT_MS);
    });
    
    try {
        await Promise.race([reconnectPromise, timeoutPromise]);
        // ... 重连成功处理
    } catch (error: any) {
        if (error.message.includes('timed out')) {
            this.logger.error(`Reconnect timed out for bot ${botId}`);
            // 超时后，强制销毁旧客户端，确保下次重连能从干净状态开始
            const instance = this.botInstances.get(botId);
            if (instance) {
                try { await instance.adapter.shutdown(); } catch {}
                this.botInstances.delete(botId);
            }
        }
        // ... 重试或放弃处理
    }
}, retryInterval);
```

---

## 5. 修复后流程图

修复后的重连流程：

```
WebSocket 断开
    │
    ▼
QQBot SDK: ws.on('close')
    │
    ├─ 清理心跳定时器
    ├─ 清空 ws 引用
    └─ emit('ws_closed', { code })  ← 不再内部重连
         │
         ▼
QQBotAdapter: 收到 ws_closed 事件
    │
    ├─ status = DISCONNECTED
    └─ emit('bot_disconnected')
         │
         ▼
BotInstanceManager: 收到断开通知 或 定时检查发现状态异常
    │
    ├─ 检查 reconnectingBots 锁 ← 防重入
    ├─ 检查 reconnectAttempts < maxRetries
    ├─ reconnectingBots.add(botId)
    │
    ▼
    延迟 retryInterval 后：
    │
    ├─ adapter.reconnect()
    │   ├─ client.reset()      ← 彻底清理旧状态
    │   ├─ forceRefreshToken() ← 强制刷新 Token
    │   ├─ new QQBot()         ← 全新实例
    │   └─ client.start()      ← 新连接
    │
    ├─ 成功 → 重置计数器，更新状态
    ├─ 失败 → scheduleReconnect() 递归
    │
    └─ finally: reconnectingBots.delete(botId)
```

---

## 6. 验证方法

### 6.1 单元测试

测试 SDK 层改动：

```typescript
// 测试 handleReconnect 不再内部重连
test('SDK should not reconnect internally after close', () => {
    const bot = new QQBot({ appId: 'test', secret: 'test', maxRetry: 0 });
    const connectSpy = jest.spyOn(bot as any, 'connectWebSocket');
    
    bot.emit('close', 4000, 'test');
    
    expect(connectSpy).not.toHaveBeenCalled();
});
```

### 6.2 集成测试

| 测试场景 | 预期结果 | 验证方式 |
|:--------|:--------|:---------|
| 正常启动 QQ 机器人 | 状态为 connected | 查看数据库 bot_instance 状态 |
| 手动断网 30 秒后恢复 | 自动重连成功，不超过 3 次尝试 | 观察日志重连流程 |
| 断网 10 分钟后恢复 | Token 刷新后重连成功 | 检查 Token 刷新日志 |
| 连续断网 6 次（超过 maxRetries） | 机器人被禁用 | 数据库 enabled = false |
| 短时间内多次触发重连 | 防重入锁生效，不会并发重连 | 日志中无重叠的重连记录 |

### 6.3 压力测试

```bash
# 模拟网络波动：每 5 分钟断一次网，持续 2 小时
for i in $(seq 1 24); do
    # 断开 QQ 机器人网络
    # ... 根据实际环境执行网络隔离 ...
    sleep 30
    
    # 恢复网络
    # ... 恢复网络连接 ...
    sleep 270
    
    # 检查机器人状态
    curl http://localhost:3000/api/v1/bot-admin/status
done
```

### 6.4 日志监控

修复后应关注的日志模式：

```
✅ 正常重连:
  [BotInstanceManager] Scheduling reconnect... (attempt 1/5)
  [QQBotAdapter] Attempting to reconnect QQ bot...
  [QQBot] forceRefreshToken: token refreshed
  [QQBot] WebSocket connected
  [QQBot] READY received, session established
  [BotInstanceManager] Bot reconnected successfully

❌ 异常重连（不应再出现）:
  [QQBot] Resume failed, attempt 1/3    ← SDK 不应尝试 Resume
  [QQBot] Reconnect attempt 1/0         ← maxRetry=0 不应有重试计数
```

---

## 7. 附录：核心代码修改清单

### 7.1 需修改的文件及行号

| 文件 | 行号 | 修改内容 | 优先级 |
|:----|:----|:---------|:------|
| `qq/qq-bot.sdk.ts` | 290~330 | `handleReconnect()`: 移除内部重连逻辑，改为发射事件 | 🔴 必改 |
| `qq/qq-bot.sdk.ts` | 新增方法 | `reset()`: 彻底重置 SDK 内部状态 | 🔴 必改 |
| `qq/qq-bot.sdk.ts` | 新增方法 | `forceRefreshToken()`: 强制刷新 Token | 🔴 必改 |
| `qq-bot.adapter.ts` | 138~145 | `reconnect()`: 使用全新实例 + reset | 🔴 必改 |
| `qq-bot.adapter.ts` | 80~86 | `initialize()`: 增加清理旧 client 逻辑 | 🟡 建议改 |
| `qq-bot.adapter.ts` | 88~93 | 增加 `ws_closed` 事件监听 | 🟡 建议改 |
| `bot-instance-manager.service.ts` | 220~280 | `scheduleReconnect()`: 加防重入锁 + 超时保护 | 🔴 必改 |

### 7.2 预计工时

| 修改项 | 预估工时 | 说明 |
|:------|:--------|:-----|
| SDK 层改造 | 1~2 小时 | 移除重连 + 新增 reset/forceRefreshToken |
| Adapter 层改造 | 0.5~1 小时 | 修改 reconnect + 事件监听 |
| Manager 层改造 | 1~2 小时 | 防重入锁 + 超时保护 |
| 测试验证 | 2~4 小时 | 单元测试 + 集成测试 + 压力测试 |
| **合计** | **4.5~9 小时** | |

---

> **版本历史**
> 
> | 版本 | 日期 | 修改人 | 变更说明 |
> |:----|:----|:-------|:---------|
> | v1.0 | 2026-05-07 | - | 初始版本，完成问题分析与修复方案 |
