# SSE 事件体系与断点续传方案(定稿)

> 状态:定稿待实施
> 日期:2026-08-23
> 目标:全局 SSE 常驻(按 userId 广播,多窗口共享),删除 catchup,流式增量统一走 SSE;续传游标复用入库 seq,不引入新号体系。

---

## 一、目标与约束

- 全局 SSE 常驻(应用启动即连接,按 **userId** 广播,多窗口共享)
- **删除 catchup**,增量统一走 SSE
- 事件体系清晰分层:**全局状态**与**会话内容**互不污染
- 续传游标**复用入库 seq**,不引入新号体系(不做空洞)

---

## 二、事件体系分层(核心结构)

全局 SSE 通道里承载**两层性质不同的事件**:

| 层 | 事件 | 是否带续传游标 | 消费者 |
|---|---|---|---|
| **全局会话事件层** | `session/created`、`deleted`、`renamed`、`updated`、`stream_status_changed`、`subagent/*` | ❌ 无 seq(一次性状态/通知) | 侧边栏、会话列表、多窗口状态、ChatPage 订阅触发 |
| **会话级流内事件层** | `stream/turn_start`、`stream/user_message`、think、text、tool_call、finish、`stream/turn_end` | ✅ 带 `prevSeq`(续传游标) | 已打开会话的内容渲染 |

**判断准则**:"这个事件是否参与断点续传?"参与 → 会话级流内层;不参与 → 全局会话事件层。

---

## 三、续传游标:复用入库 seq + chunk 带 prevSeq

### 3.1 事实前提

- **入库事件**(语义事件):`turn/start`、`user/message`、`assistant/message`、`tool/result`、`turn/finish` —— 写 JSONL,带 **per-session 单调 seq**
- **流内增量 chunk**:think/text/tool_call/finish —— **不入库**,广播时携带 **`prevSeq` = 广播那一刻该会话最后一条已入库事件的 seq**
- **契约(先入库后发事件)**:事件先落库、再广播,保证 `prevSeq` 精确指向已入库的最后一条

### 3.2 为什么能成立(不区分 chunk 内部)

因为 chunk 不入库,`lastSeq` **永远不会落在 chunk 区间中间**,只有两种可能:

```
chunk 区间:  [user/message 入库] → think/text/finish(不入库) → [assistant/message 入库]
                   seq=2            prevSeq=2                   seq=3(回合结束才入库)
```

| lastSeq | 含义 | 该区间 chunk |
|---|---|---|
| 2(chunk 前的入库) | 回合未 finish,区间未入库 | **全补**(prevSeq=2 ≥ lastSeq=2) |
| 3(chunk 后的入库) | 回合已 finish,已合并入库 | **全不补**(prevSeq=2 < lastSeq=3) |

区间内 chunk 要么全补要么全不补,**没有"补一半"场景**,不需区分内部顺序;chunk 先后顺序由 eventBuffer 数组顺序保证。

---

## 四、SSE 事件结构(定稿)

### 4.1 当前结构(现状)

```
UnifiedEvent(信封)
├── id: string          ← generateEventId()(参考 DSH rpcId,续传/去重 token)
├── method: string      ← "stream/turn_start"、"stream/text"、"session/created"...
├── timestamp: string
├── source?: string     ← 发起者 clientId(多窗口过滤自身)
└── payload: {
    sessionId: string,  ← 会话级帧带、全局帧不带
    ...EventChunk       ← agent 引擎 chunk 字段展开进 payload
  }
```

关键点:
- `method` 在信封上(mapStreamMethod 把 `chunk.type` → `stream/xxx`);`chunk.type` 原值也在 payload 里
- `sessionId` 在 payload,不在信封
- 信封的 `id` 是 token,不是入库 seq,不能当续传游标

### 4.2 修改后结构(定稿)

```
UnifiedEvent(信封)                     ← 不变
├── id: string
├── method: string                     ← 不变
├── timestamp / source                 ← 不变
└── payload: {
    sessionId: string,
    prevSeq?: number,                  ← 新增:广播时该会话最后一条已入库事件的 seq(仅流内事件带)
    type: "text", messageId, contentId, content, ...
  }
```

**字段位置决策**:

| 考量 | 结论 |
|---|---|
| 放 payload 与 sessionId 并列 | ✅ `prevSeq` 是会话级游标,与 `sessionId` 同级;全局事件(CRUD/subagent)不该有它 |
| 可选性 | payload 宽槽,`prevSeq?: number` 自然表达"仅流内事件带、全局帧不带" |
| 前端消费点 | `StreamEventHub.route` 已解析 `payload.sessionId`,顺手读 `payload.prevSeq` 最顺 |
| 注入点 | `emitStream` 里 `{ sessionId, prevSeq, ...chunk }` 一行注入,不碰信封 |
| 不放信封(id 旁) | 信封 `id` 是传输层去重 token,`prevSeq` 是业务会话级续传游标,职责不同;`sessionId` 已下放 payload,同级字段应保持一致 |
| 不放 EventChunk | `EventChunk` 是 agent 引擎业务事件块,不知道也不关心"入库游标";`prevSeq` 是传输/补发层概念,应在 chat-runner 广播处注入 |

**命名**:统一叫 `prevSeq`(前一个入库 seq),不叫 `seq`——它表达"我在 seq=X 之后、seq=Y 之前",而不是"我自己的号"(chunk 没有自己的入库号)。

---

## 五、前端 StreamEventHub:邮箱 + 订阅

### 5.1 结构(每个会话一个"邮箱")

```
StreamEventHub
  sessions: Map<sessionId, {
    mailbox: HubStreamEvent[]        // 邮箱(滚动窗口,上限 2000)
    subscribers: SessionSubscriber[] // 订阅者
  }>

route(event):                          ← 全局 SSE 收到 stream/* 事件
  事件进该会话邮箱(无订阅者也进,不丢)
  若有订阅者 → 实时推

subscribe(sessionId, lastSeq, onEvent): ← 打开会话时一次调用
  return {
    initialEvents: 邮箱里 prevSeq >= lastSeq 的增量,
    unsubscribe,                        ← 之后实时事件自动调 onEvent
  }
```

### 5.2 打开会话 = 直线两步

```
1. loadSession(sessionId)
     → HTTP 拉历史快照(JSONL 重放)
     → 返回 { items, total, lastSeq }   ← lastSeq = state.lastProcessedSeq
2. subscribe(sessionId, lastSeq, onEvent)
     → 从邮箱取 prevSeq >= lastSeq 的增量
     → 之后实时事件自动 onEvent
```

**为什么没有竞态**:邮箱一直在收(无需 buffering 状态机),订阅在 loadSession 之后、lastSeq 已确定,按 `prevSeq >= lastSeq` 精确切增量。

---

## 六、生命周期事件命名(统一状态改变事件)

全局"会话是否在工作"状态,由 **一个统一状态改变事件** 驱动,取代 start/finish 两个事件。

```
事件名:  stream_status_changed
method:  session/stream_status_changed
payload: {
  sessionId,
  status: "running" | "completed" | "user_cancel" | "error",
  messageId?, replaceMessageId?, session?,   // running 时
  reason?, workspacePath?, sessionType?, error?  // 结束态
}
```

**语义区分**:
- `stream_status_changed`(全局层,session 前缀)→ 侧边栏"正在工作"/会话列表/多窗口状态
- `stream/turn_start`、`stream/turn_end`(会话级流内层,stream/turn 前缀)→ 回合内容渲染

一次状态改变 = 一次广播,前端一个监听按 `status` 分支,不再有"过去式/普通时态"混用、不再有 start/finish 两事件难以区分。

**动机**:现状 `stream.started` 已无触发源(chat-runner L205 规范化时误删),`stream_finished` 正常;同时旧命名 `stream_started`/`stream_finished`(过去式)与 `stream/turn_start`(普通时态)语义难区分、时态不统一 → 统一为一个普通时态的状态改变事件。

---

## 七、多窗口 / 刷新 / 重连

| 场景 | 机制 |
|---|---|
| **其他窗口发起流** | 后端 `stream_status_changed(status=running)` 广播 → 本窗口侧边栏显示"工作中";已打开会话靠订阅实时收到 turn 增量 ✅ |
| **其他窗口结束后** | `stream_status_changed(status=completed)` → 本窗口侧边栏恢复 |
| **刷新页面** | SSE 重连 → 后端**连接时补发 eventBuffer**(含 status 事件 + 活跃流增量)→ 前端入邮箱 → 打开会话时按 lastSeq 过滤取增量 |
| **打开正在流的会话** | loadSession(lastSeq) + subscribe(邮箱增量) → 无缝续上 |

---

## 八、落地改动清单

### 后端

1. `stream.events.ts`:合并 `StreamStartedEvent`/`StreamFinishedEvent` → `StreamStatusChangedEvent`(事件名 `stream.status_changed`,payload 带 status)
2. `unified-event.types.ts`:`SESSION_STREAM_STARTED/FINISHED` → `SESSION_STREAM_STATUS_CHANGED: "session/stream_status_changed"`
3. `chat-runner.service.ts`:三处 `emit("stream.finished")` → `emit("stream.status_changed", { status })`;**新增流开始时 `emit(... { status: "running" })`**;广播 chunk 时注入 `prevSeq`
4. `session-events.service.ts`:`SessionEventType` 改 `"stream_status_changed"`;合并两个 `@OnEvent` + `handleStreamStatusChanged`;`emitStream` 注入 `prevSeq`
5. `shell.plugin.ts` / `skill-source.manager.ts`:监听改为 `stream.status_changed`,按 `status` 分支
6. **入库游标**:落库后更新"当前会话最后入库 seq",广播 chunk 前读取注入 `prevSeq`
7. **`loadSession` 返回 `lastSeq`**(= `state.lastProcessedSeq`,现成,直接暴露)

### 前端

8. `SessionEventsService.ts`:事件类型改 `"stream_status_changed"`
9. `useSessionEvents.ts`:两个监听合并为一个,按 `status` 分支(working 标记、队列消费)
10. `ChatPage.vue`:两个 handler 合并为 `handleStreamStatusChanged`
11. `StreamEventHub.ts`:改"邮箱+订阅"(删 buffering 状态机),subscribe 返回增量 + 实时
12. `ChatPanel.vue` / `useStreamResponse.ts`:打开会话收敛为 loadSession → subscribe;删 catchup/旧包装
13. 注释统一更新(chat-runner L205、ChatPage L243、ChatStreamService L158 等)

---

## 九、验证

- 后端 `tsc --noEmit`:0 错误
- 前端 `vue-tsc --noEmit`:本次文件 0 错误,全量与基线一致
- 事件链路确认:emit → emitStream → SSE → StreamEventHub.route → subscribe 增量消费
- 实测:① 打开正在流会话增量正确;② 多窗口同步;③ 刷新/重连不丢不重;④ 侧边栏"工作中"状态恢复
