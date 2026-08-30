# 接收唯一 receiver 方案

> 目标:前端**发送与接收分离**。发送是发送(独立入口,只调后端),接收是接收(**全局唯一 receiver**,消费全局 SSE 通道)。所有流式事件——无论自己发起、其他窗口发起、刷新后订阅——都进唯一 receiver 处理。

## 一、目标架构

```
┌─ 发送(send):sendMessage(独立,不唯一亦可)
│    新发消息、整轮重答、断点续传
│    → 只做一件事:调后端发起请求(regenerationMode/userMessage 只是参数)
│    → 不处理事件
│
└─ 接收(receive):全局唯一 receiver ✅
     所有流式事件(自己发起的响应 / 其他窗口的流 / 刷新后订阅)
     → 消费全局 SSE → StreamEventHub
     → 会话级:按 sessionId 决定处理或丢弃(切换会话时注销 or 内部过滤)
     → 时序:必须在"历史从后端拉取之后"才处理(依赖 lastSeq 基线)
```

### 接收唯一的三条铁律

1. **唯一入口**:全项目只有一个 receiver 消费 StreamEventHub / SSE 事件,不存在第二条接收链路。
2. **会话级**:receiver 按当前会话工作——当前会话事件处理,非当前会话事件丢弃(切换会话注销或按 sessionId 过滤)。
3. **时序**:receiver 必须等 `loadSession`(HTTP 拉历史)完成、拿到 `lastSeq` 基线之后才处理事件。增量判断依赖 `prevSeq >= lastSeq`,历史未拉取则无法判断"历史已包含 vs 新增量",会重复处理。

## 二、DSH 对照(实证,packages/client)

### DSH 接收唯一(receive)

```
单一 mux SSE 流(所有会话事件聚合)
  └─ 单一 pumpStream 循环(connection.ts L128/178)消费
       └─ onMuxEnvelope
            └─ sessions.handleMuxEnvelope(index.ts:205)   ← 唯一接收分发入口
                 └─ manager.handleMuxEnvelope(L683) 按 frame.type 分发
                      ├─ session/event       → 内容事件
                      ├─ session/subscribed  → 订阅基线(带 lastSeq)
                      └─ ... → session.handleMuxEnvelope(L471)
```

- **订阅归接收**:`session/subscribed` 是 mux 流里的一个帧类型,订阅不是独立入口,与接收是同一个 receive。
- **发送独立**:走独立 RPC(`op: 'send'`),不经过 mux 接收流。
- **历史拉取独立**:打开会话 `open()` → `history({ beforeSeq, maxMessages })` 独立 RPC 拉历史(session.ts L369/386),不是 mux 流回放。

### DSH 的时序(历史拉取 + 邮箱 + 基线)

```
① open() → history RPC 拉历史(得 baseSeq)        ← 从后端拉取对话记录
② 同时 mux 流持续到达新事件 → 进 liveBuffer(邮箱)   ← 事件先缓存,不丢
③ session/subscribed(lastSeq) 帧到达 = 基线信号
④ history 落地后 → 把 liveBuffer 里的事件按 seq 与历史拼接(stitch) → 才处理
```

**DSH 就是"先拉历史,再按基线处理增量"**——`liveBuffer` 等 history 落地才拼接。这印证了本方案铁律③。

## 三、本项目当前状态与差距

### 现状(已部分收敛)

- 后端已合并为**全局单一 SSE 通道**(SessionEventsService → streamEventHub.route)。
- `StreamEventHub`:邮箱模型——事件先 `route` 进 mailbox(不丢),`subscribe(sid, lastSeq, cb)` 返回 `{ initialEvents(prevSeq>=lastSeq), unsubscribe }`。
- `useStreamResponse.subscribeStreamEvents`(L632):先 `streamEventHub.subscribe(sid, lastSeq, cb)`,再按需 `apiService.chat` 触发,事件循环处理。
- `useStreamResponse.processStreamLoop`(L687):唯一事件循环,按事件类型(think/text/tool_call/turn_start/turn_resume/turn_delete…)分发。
- ChatPanel 三个入口(`handleStreamResponse`/`handleStreamResponseWithCreate`/`handleStreamResponseAsSubscriber`)已收敛为 `handleStreamRequest`(一个函数,但**仍被多个场景各自调用**,不满足"接收唯一")。

### 差距(需改造)

| 项 | 现状 | 目标 |
|---|---|---|
| 接收入口 | `processStreamLoop` 在 `handleStreamRequest` 内被多次调用;事件处理与"触发发送"耦合在 `subscribeStreamEvents` 里 | **唯一 receiver**,全局一个消费 StreamEventHub 的实体 |
| 会话级 | `subscribeStreamEvents` 按会话订阅,但每个调用方各自 subscribe | receiver 内部按 sessionId 过滤/注销,当前会话才处理 |
| 时序 | `subscribe(sid, lastSeq)` 天然在 loadSession 后,已满足 | 保持;receiver 显式等历史基线就绪 |
| 发送 | `subscribeStreamEvents` 里 `apiService.chat` 与事件接收混在一起 | 发送独立(sendMessage 只调后端),事件由 receiver 统一收 |

## 四、落地步骤

### 1. 新建全局唯一 receiver(前端核心)

```ts
// frontend/src/services/modules/StreamReceiver.ts
// 全局唯一接收器:消费 StreamEventHub,按当前会话处理事件
class StreamReceiver {
  private activeSessionId: string | null = null;   // 当前会话
  private lastSeqBySession = new Map<string, number>(); // 历史基线游标
  private subscribers = new Map<string, (chunk) => void>(); // 按会话的处理器

  // 会话级:设置当前会话(切换时注销上一个,丢弃非当前会话事件)
  setActiveSession(sessionId: string | null): void;

  // 时序:历史拉取完成后设置基线,才放行该会话事件
  setHistoryBaseline(sessionId: string, lastSeq: number): void;

  // 唯一订阅点:内部调 streamEventHub.subscribe,按 sessionId 过滤
  private onEvent(sessionId: string, chunk: StreamChunk): void;
}

export const streamReceiver = new StreamReceiver();
```

- **消费源**:全局 StreamEventHub(`streamEventHub` 单例)。
- **会话级**:`setActiveSession` 切换时注销上一会话的订阅(方式一);或在 `onEvent` 里 `if (sessionId !== activeSessionId) return`(方式二)。
- **时序**:`setHistoryBaseline(sid, lastSeq)` 记录基线;receiver 对该会话只处理 `prevSeq >= lastSeq` 的增量(历史未拉取时事件进邮箱不处理,与 DSH liveBuffer 同理)。

### 2. 接收唯一化(useStreamResponse)

- `processStreamLoop` 的事件处理部分改为:向唯一 `streamReceiver` 注册当前会话的处理器(一次),由 receiver 统一收事件后调用。
- 删除各场景各自 `streamEventHub.subscribe` 的调用,统一收敛到 receiver 内部唯一 subscribe。
- `subscribeStreamEvents` 的"触发发送"(`apiService.chat`)拆出,归发送侧。

### 3. 发送独立(sendMessage)

```ts
// ChatPanel:发送唯一(或与接收分离)
function sendMessage(sessionId, options: { content?, files?, replaceTurnId?, regenerationMode?, assistantMessageId?, userMessage?, lastSeq? }) {
  // 只调后端发起,不处理事件(事件由唯一 receiver 统一收)
  return apiService.chat({ sessionId, ...options });
}
```

- 新发/重答(regenerationMode=null)/续传(resume)/订阅(subscribe)的参数形态统一,内部只 `apiService.chat`。
- 事件处理完全交给 receiver,发送侧不再订阅、不再处理。

### 4. 时序衔接(loadSession → receiver)

```
打开/切换到会话:
  loadSession(sid) 拉历史 ──► 返回 lastSeq
       │
       └──► streamReceiver.setHistoryBaseline(sid, lastSeq)
            └──► receiver 对该会话开始处理 prevSeq >= lastSeq 的增量
```

- 刷新/多窗口:其他会话或同一会话的活跃流事件先进邮箱,当前会话基线就绪后按 prevSeq>=lastSeq 取出处理。
- 与 DSH 完全一致:先拉历史,再按基线处理增量。

## 五、验收标准

- [ ] 前端 `streamEventHub.subscribe` / SSE 事件消费**全项目仅一处**(唯一 receiver 内部)。
- [ ] 切换会话时,上一会话事件被丢弃/注销,不污染新会话。
- [ ] 历史未拉取完成时,事件不处理(不重复塞入 store);拉取后按 lastSeq 增量正确。
- [ ] 新发/重答/续传/订阅四场景事件都经唯一 receiver 处理,发送侧零事件消费。
- [ ] 后端 tsc 0、前端 vue-tsc 基线一致。
