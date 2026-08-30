# 合并为单 SSE + 续传 实施方案

> 状态:已实施完成(阶段一~四全部落地;2026-08-29 阶段四清理完成,见 §五 B4 注记)
> 日期:2026-08-22
> 范围:后端(backend-ts)+ 前端(frontend),事件通道合并 + 续传

## 一、目标

将当前**两条 SSE**(全局 `@Sse("sessions")` + 每会话 `POST /chat/stream`)合并为**一条全局 SSE**,流式事件与用户级事件统一承载、按 `method`/`sessionId` 路由;在此通道上实现"中途打开正在流式的会话 → 无缝续传",且**不要求 JSONL 记 chunk**。

## 二、现状盘点(已核实)

| 项 | 现状 |
|---|---|
| 全局 SSE | `GET /events/sessions` → `SessionEventsService`,推送 session_created/deleted/renamed/updated、stream_started/finished、user_message_created、sub_agent_*、todo_updated、heartbeat |
| 流式 SSE | `POST /chat/stream`,信封 `data: {EventChunk}\n\n` + `[DONE]`;每会话一个 `ActiveStream`(eventBuffer + subscribers) |
| 续传机制 | `chat-runner.startStream` 对已有活跃流走 `subscribeToStream(lastContentId)` 从 eventBuffer 重放 |
| 快照 | `fetchSessionMessages` → `{items: Turn[], total}`(无 seq,只有 before/afterMessageId 分页游标) |
| 前端流式 | `useStreamResponse.processStreamLoop` 增量组装,已改为写 store.turns;`handleStreamResponseAsSubscriber` 游标已改为从 turns 计算 |

## 三、架构目标

```
[一条全局 SSE: GET /events/sessions](每用户常驻,复用所有会话)
   │ push: UnifiedEvent { id, method, timestamp, source?, payload }
   │        - stream/*  → 流式事件(带 sessionId)
   │        - session/* → 会话状态(带 sessionId)
   │        - host/* workspace/* subagent/* → 全局(可无 sessionId)
   ▼
[前端 StreamEventHub: 按 method 路由 + 按会话缓冲]
   ├─ stream/* 已打开会话 → 增量组装进 store.turns(useStreamResponse 复用)
   ├─ stream/* 打开中     → 缓冲(liveBuffer),快照+补拉落地后按 contentId 拼接
   ├─ session/* → 会话状态更新
   └─ host/* workspace/* → 全局(无 sessionId,不查会话)

[发起/续传 RPC: POST /chat/stream](立即返回 200,不再持有长连接)
   ├─ 发起模式(overwrite)→ 启动流,事件走全局 SSE
   └─ 打开会话续传 → catchup 补拉 eventBuffer 增量
```

## 四、统一事件信封(参考 DSH)

DSH 启示:**sessionId 不进信封**,下放到 payload 帧内;信封用 `rpcId/method/payload` 分层;method 作事件域判别器;payload 宽槽、业务层二次解析。

```ts
interface UnifiedEvent {
  /** 事件 ID(参考 DSH rpcId):会话级事件作续传/去重游标;全局事件为一次性 token */
  id: string;
  /** 事件域判别器:'stream/*' | 'session/*' | 'host/*' | 'workspace/*' | 'subagent/*' */
  method: string;
  /** 事件时间戳 */
  timestamp: string;
  /** 发起者 clientId(多窗口过滤自身事件,沿用现有 source 语义) */
  source?: string;
  /** 宽槽负载:业务层按 method 二次解析;sessionId 在帧内,全局帧不带 */
  payload: Record<string, any> & { sessionId?: string };
}
```

### method 映射(现有事件 → 新 method)

| 现有事件 | 新 method | 带 sessionId |
|---|---|---|
| 流式 create | `stream/create` | ✅ |
| 流式 update | `stream/update` | ✅ |
| 流式 text / think | `stream/text` / `stream/think` | ✅ |
| 流式 tool_call / tool_calls_response | `stream/tool_call` / `stream/tool_calls_response` | ✅ |
| 流式 finish / turn_end | `stream/finish` / `stream/turn_end` | ✅ |
| 流式 user_message | `stream/user_message` | ✅ |
| 流式 retry | `stream/retry` | ✅ |
| session_created / deleted / renamed / updated | `session/created` `session/deleted` `session/renamed` `session/updated` | ✅ |
| stream_started / stream_finished | `session/stream_started` `session/stream_finished` | ✅ |
| user_message_created | `session/user_message_created` | ✅ |
| sub_agent_create / closed | `subagent/created` / `subagent/closed` | ✅ |
| todo_updated | `session/todo_updated` | ✅ |
| plugins_changed | `host/plugins_changed` | ❌(全局) |
| heartbeat | `heartbeat` | ❌ |

### 预留扩展

- method 命名空间前缀 → 新增域不改信封
- `id` 支持应答 echo → 未来审批/问题类事件(参考 DSH approval/question)
- payload 宽槽 + 二次解析 → 未来加 `seq` 升级为 seq 缝合时信封零改动
- `source` 多窗口过滤

## 五、后端改造点清单

| # | 文件 | 改动 |
|---|---|---|
| B5 | `common/events/stream.events.ts` 或新增类型文件 | 新增 `UnifiedEvent` 类型 + `method` 常量映射 |
| B1 | `session-events.service.ts` | 新增 `emitStream(userId, sessionId, chunk)`:构造 `UnifiedEvent{method:"stream/*", payload:{sessionId, ...chunk}}`,push 到该 user 的所有 `userSubscribers` subject |
| B3 | `chat.controller.ts` 或 `messages.controller.ts` | 新增 catch-up 端点 `GET /sessions/:id/stream/catchup?lastContentId=xxx` → 返回 eventBuffer 中 lastContentId 之后的事件 `{events: EventChunk[]}` |
| B2 | `chat.controller.ts` `@Post("stream")` | 移除 SSE 头与 callbacks 写入;startStream 成功后立即 `200 {ok:true}`(事件改由 emitStream 广播) |
| B4 | `chat-runner.service.ts` | ~~写 eventBuffer(保留,供补拉)+ 调 emitStream(实时广播)~~ **阶段四已清理(2026-08-29)**:单发布入口 `streamManager.publish()` 一次调用完成 eventBuffer 缓存 + 进程内订阅者扇出 + SSE 直投(经 `setStreamRelay` 回调推给 SessionEventsService,避免循环 DI);`emitStream` 私有化为 `pushStreamToUser` 仅作 relay 消费端。对齐 DSH 单一 push 点(缓冲即投递管道的一部分,非并行通道) |

**关键**:eventBuffer(补拉面)与全局 SSE(广播面)并存,职责分离——阶段四后两者在 `publish()` 内部合一,生产者无感知。

> **approval_requested 可重放注记(2026-08-29)**:审批事件原先只走 emitStream(不进 eventBuffer、无 prevSeq,前端邮箱对无 prevSeq 事件丢弃)→ 审批等待中刷新页面审批卡丢失。现经 EventBus relay 后改走 `streamManager.publish`(带 prevSeq、进 buffer),SSE 重连补发恢复审批卡——与 DSH pendingApprovals 注册表重连以同一 rpcId 重放 approval/requested 同构。

## 六、前端改造点清单

| # | 文件 | 改动 |
|---|---|---|
| F2 | 新增 `src/services/modules/StreamEventHub.ts`(或并入 store) | `Map<sessionId, {buffer: EventChunk[], lastContentId}>`;收到 stream/* 按会话入缓冲并通知订阅者;打开期间缓冲,快照后消费 |
| F1 | `SessionEventsService.ts` | 增强:按 method 分发;新增 `onStreamEvent(sessionId, callback)`,内部按 payload.sessionId 路由;保留既有按 type 监听(兼容) |
| F3 | `useStreamResponse.ts` | `processStreamLoop` 由"for await apiService.chat()"改为订阅 hub 的按会话事件流;增量组装逻辑全部复用(handleNewMessage/handleText/…/handleTurnEnd 已写 store.turns) |
| F4 | `ChatStreamService.ts` | 简化为只发"发起/订阅/取消"RPC,删除 SSE 解析 |
| F5 | `ChatPanel.vue` | 打开会话 = 快照 setTurns + 检测活跃流 + catchup 补拉 + 消费 hub 缓冲续流(复用已改好的 lastContentId 从 turns 计算) |

## 七、续传设计(无 seq、JSONL 不记 chunk)

### 打开会话时序

```
① 快照:  fetchSessionMessages → setTurns(items)   (JSONL 已落库完整消息)
② 活跃流检测: catchup 为空 = 无活跃流,结束
③ 补拉:  catchup(lastContentId=快照最后contentId) → eventBuffer 中之后的事件
④ 应用:  增量组装进 store.turns(create 按 parentId 定位回合/按 messageId 去重)
⑤ 续流:  全局 SSE stream/* → hub 路由 → 增量组装
```

### 竞态处理

- 快照落地前到达的实时事件 → StreamEventHub 按会话缓冲(参考 DSH liveBuffer)
- 快照 + 补拉落地后消费缓冲,按 contentId 拼接(≤ 已应用丢弃、> 追加)

### 兜底保证

| 场景 | 兜底 |
|---|---|
| 流结束再打开 | eventBuffer 清理,但 JSONL 已有完整消息 → 纯快照 |
| 极端长流错过 eventBuffer 窗口 | 流结束后快照兜底 |
| 打开瞬间实时事件 | hub 缓冲 + 游标拼接 |

## 八、迁移路径(分阶段,可回滚)

1. **阶段一(纯后端,不破坏现状)**:加 B5 信封 + B1 emitStream,流式事件**同时**写 HTTP 回调与 emitStream(双写,验证广播)✅
2. **阶段二(加补拉)**:加 B3 catchup 端点,前端新打开路径试走"快照+catchup+hub"(仍保留 /chat/stream 长连接对照)✅(补拉最终以 SSE 连接补发 eventBuffer 实现,catchup HTTP 端点未启用)
3. **阶段三(切换)**:B2 /chat/stream 降级 RPC + 前端 F1-F5 切到全局 SSE,删除旧长连接解析✅
4. **阶段四(清理)**:移除双写与旧代码,验证多窗口同步/中途打开续传/断线重连✅(2026-08-29:双写合并为 `streamManager.publish()` 单发布入口,详见 §五 B4)

## 九、验证矩阵

| 场景 | 预期 |
|---|---|
| 单会话流式 | 全局 SSE 收到 stream/*,前端正常增量渲染 |
| 中途打开正在流的会话 | 快照 + 补拉 + 续流,无缝、不重复 |
| 多窗口同会话 | 同一事件广播到所有窗口,同步渲染 |
| 断线重连 | EventSource 自动重连 + hub 缓冲补齐 |
| 流结束后打开 | 纯快照,无残留 |
