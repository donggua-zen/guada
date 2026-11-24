# 接收链路：唯一 receiver 与断点续传

> 前端**发送与接收分离**：发送只调后端发起请求；接收是**全局唯一 receiver**，消费全局
> WebSocket 通道。所有流式事件——自己发起的、其他窗口发起的、刷新后补发的——都进同一条接收链路。

## 一、链路

```
浏览器 ── WebSocket /api/v1/events/ws ── 后端 WsEventsGateway
  C→S: watch/unwatch、open、workspace/watch、ping
  S→C: ready、event(data)、snapshot、ack、pong
        │
        ├─ stream/* 事件          → StreamEventHub.route（去重）→ subscribeAll 扇出
        ├─ 会话/宿主事件           → onSessionEvent(type) 监听器
        ├─ workspace 事件          → WorkspaceWatcherService（按当前会话过滤）
        └─ snapshot               → 兑现 open 请求（历史快照 + 在飞尾部）
        ↑
前端 useSessionEvents（常驻，MainLayout 挂载）
  ├─ subscribeAll → projectChunk（有树直写 / 无树忽略）
  ├─ onSessionEvent → 会话级状态、CRUD、流状态、缺口判定
  └─ 触发历史重载（回前台 / 重连 / 判停 / 日志换代）
```

**per-session 过滤**：内容帧（turn/message/delta/block/usage/finish/压缩细节等）只发给
`watchedSessions` 含该会话的连接；跨会话信号 `ask_requested` / `ask_resolved` /
`workflow_event` / `compression_error` 始终广播。会话与宿主事件（`stream_status_changed`、
CRUD、jobs、bot、队列、todo/goal…）也全量广播。客户端用 `sessionWatchRegistry`（引用计数）
维护期望集合，重连后由 `ready` 触发重放。

唯一消费入口是 `StreamEventHub.subscribeAll`。按会话订阅 / 历史基线那套 API 已不存在。

## 二、三个 seq 概念（务必区分）

| 名称 | 含义 | 用途 |
|---|---|---|
| `logSeq` | 发布时刻**未钳制**的真实落库 seq | 推进已应用水位 `appliedSeq` |
| `baseSeq` | **传输区间基座**（可能被单调钳制） | 重放去重、缺口判定 |
| `chunkSeq` | 同一 `baseSeq` 区间内第 n 个帧（1 起，区间前进时归零） | 与 `baseSeq` 组成去重元组 |

- `baseSeq` 被 `SessionStreamManager.publish` 做 `base = max(raw, 上次 base)` 钳制，用于抵御
  并发 `publishStream` 的乱序。**因此它不代表日志尾**——日志清空/截断后仍停在旧高值。
  需要日志真相时一律用 `logSeq`。
- 去重：同 `streamBootId` 下 `(baseSeq, chunkSeq) <= 游标` 判定为重放，丢弃；`bootId` 变化
  （后端重启）重置游标；缺任一位置字段 fail-open。
- 同区间内 `chunkSeq` 空洞是**合法**的：`cleanupIntermediateEvents` 会删掉已完成的 delta
  （由 `block_end` 携带完整块替代），所以不能用 `chunkSeq` 连续性判断丢帧。

## 三、已应用水位 `appliedSeq`

- 只由**实际应用进树的持久化事件**推进：live 帧的 `logSeq`、增量批的 `endSeq`、事件页的 `endSeq`。
- 写入必须在投影**之后**：投影抛错时 hub 的 try/catch 会吞掉异常，若水位先推进，这条事件
  既没进树、也不会被下次增量取回——静默永久丢失。
- `setAppliedSeq` 取 max（并发路径乱序保护）；整页重建走 `resetAppliedSeq`（可降），
  这是日志回绕后复位水位的唯一出口。
- 补发缺口未清前不推进（见下节）。

## 四、补发覆盖度与缺口

watch 补发的第一帧 `connected` 带 `payload.streamPositions`（各活跃流 `eventBuffer[0]` 的
位置）。若起点 `baseSeq` 越过本地游标 `baseSeq`，说明本次补发没覆盖缺口 → 标记 gap、
冻结水位推进、当前会话改走整页重拉；重拉成功后清除标记。

## 五、历史读取：带内快照（消除往返竞态）

打开 / 强制重拉时，历史页与 live 帧有天然竞态：读页请求在途期间产生的事件既不在页里，
也可能已作为 live 帧被吃掉。解法是把快照与后续事件放进**同一条有序通道**：

```
C→S: { kind:"open", requestId, sessionId, turns }   ← 打开即订阅（隐含 watch）
后端：置 pendingSnapshot（该连接所有帧按序积压）
      → 同步截取活跃流 eventBuffer 的在飞尾部（T0）
      → await 读事件页（T1，得到 endSeq）
S→C: { kind:"snapshot", requestId, payload }        ← 先写快照
      → 排空队列（logSeq < endSeq 的持久化帧丢弃，delta 保留）
      → { kind:"ack", requestId, ok }
      → 后续 live 帧照常
```

同一连接的多个 `open` **串行执行**（`openChain`）：多 pane 同时首次打开不再互相抢占。

- 快照帧类型是裸 `SessionEvent`（`type: "session_snapshot"`），走 `handleEvent` 分发。
- 客户端 `applySessionSnapshot`：事件页替换 `eventLog` → `foldEvents` → 用
  `applyInFlightChunks` 重放 `tail`（`logSeq < endSeq` 跳过）→ 写分页游标/`loaded`/水位。
- 客户端**不再持有事件邮箱或 stash**——读页期间的帧由服务端按连接缓冲，`snapshot` 帧
  先于排空队列写入同一 WebSocket，顺序由 socket 写入保证。

兜底与边界：

- **WebSocket 是基础设施**：`requestSessionSnapshot` 未连接（含握手未 ready）时先等待
  建连（上限 5s），仍失败则直接抛错——保留 `loaded=false`，由 resync 重试循环 /
  下次打开重试。**没有 HTTP 降级路径**：REST 与 WS 同源同鉴权，WS 不可用时 REST 通常
  也不可用；且快照读与 `GET /events` 最终调用同一个 `getEventPage`。
- **load-more 继续走事件页 HTTP**（`beforeSeq` 之前的旧区间）：新事件只追加在日志头部，
  不会落进旧页；`compaction/*`、`turn/delete` 是追加型事件，已在 `eventLog` 里参与整体
  re-fold。无竞态，无需快照通道。
- **workspace 数据面**同样走该 WebSocket（`workspace/watch` 控制、`kind:"workspace"` 事件），
  控制面保留 `POST /sessions/:id/workspace/watch` 兼容调用。

## 六、增量补拉

| | 接口 | 语义 | 前端 |
|---|---|---|---|
| 增量尾 | `GET /sessions/:id/events/tail?afterSeq&limit` | `seq > afterSeq` 前向增量 | `applyEventsIncremental` 就地并入 |

增量批的回退守卫（任一命中即整页重拉，重拉走上面的快照通道）：

- `no-watermark` / `multiple-open-turns` / `gap-too-large` / `cant-seed-turn-cursor`；
- `log-rewound`：`tailSeq < appliedSeq`，或批尾越过日志尾（日志换代：torn 尾截断后 seq 复用、
  清空记录后重建）。命中时额外清空 hub 去重游标/缺口标记，防止旧代次帧被误判；
- `seq-gap`：批首 ≠ 水位 + 1；`seq-gap-in-batch`：批内 seq 跳号（读路径漏事件）；
- `read-gap`：空批但日志尾超前，重试一次仍空（陈旧索引静默截断）；
- `bad-response` / `fetch-failed` / `apply-failed`。

空批只有 `tailSeq === appliedSeq` 才算追平；否则不推进水位（不能把未返回的事件当成已应用）。

## 七、在飞帧的应用口径

未落盘的 delta 有两个来源，共用 `applyInFlightChunks`：

在飞帧只有**一个来源**：带内快照的 `tail`（服务端在请求时刻截取的事件页之外内容）。
客户端用 `applyInFlightChunks` 统一应用：

- 过滤口径：发布时刻游标（优先 `logSeq`，回退 `baseSeq`）`< endSeq` ⇒ 页内已含 ⇒ 跳过
  （重复应用 delta 会让文本翻倍）；缺游标 fail-open 应用。
- 读页期间新到达的帧不在这里：它们由服务端 `pendingSnapshot` 按连接积压，快照之后按序
  排空，客户端直接走正常的 live 投影。

## 八、清空聊天记录 = 日志换代

`DELETE /sessions/:id/messages` 物理删除会话日志目录（seq 从 0 重建），流式输出中返回
409 `SESSION_STREAMING`。成功后广播 `session_cleared`；其他窗口清空本地树/水位/去重游标
并整页重拉，不长期停留在旧内容。

## 九、验收标准

- [ ] 流式事件消费全项目仅一处（`StreamEventHub.subscribeAll`）。
- [ ] 内容帧只发给 watch 该会话的连接；跨会话信号保持全局广播。
- [ ] 重连后 watch 集合与当前会话快照都能自动恢复。
- [ ] 切换会话时上一会话事件不污染新会话（按 sessionId 路由）。
- [ ] 水位只用 `logSeq` 推进，且在投影成功之后。
- [ ] 打开/重拉历史的快照与后续事件同通道有序，客户端无事件邮箱/stash。
- [ ] 回绕/接缝/批内任一异常都退回整页重拉，不静默应用残缺批。
- [ ] 双端类型检查 0 错误。

## 十、已知残留（TODO）

缺 manifest 级日志代次（`logGeneration`），因此"回绕后日志又长过本地旧水位、且该窗口全程
未触发 resync"检测不到——批首 seq 恰好合法，接缝校验放行，本窗口少应用几条 seq 被复用的
修复事件（典型症状：旧回合缺 `turn/finish` 一直显示进行中）。

触发需四条同时成立：后端 append 中途崩溃留下 torn 尾（`appendEvents` 无 fsync）→ 重启截断
并复用 seq → 该窗口整段时间无 resync（未回前台/未重连/无未闭合回合）→ 其他窗口或设备已把
日志写回旧水位之上。

**影响可逆**：服务端日志完整自洽，仅本地视图过期。浏览器刷新（Pinia 重建 → `appliedSeq`
不持久化 → 整页 fold）或会话状态被 `evictSessionStates` 淘汰（2h / 32 上限）即恢复。

若将来要收口，最低成本做法是 `streamBootId` 变化（= 后端重启，即截断的唯一前提）时清空各
会话水位，让重启后首次 resync 必定整页重拉一次。

## 附：设计沿革

早期设计（`subscribe(sid, lastSeq)` 按会话订阅 + 历史基线 + `StreamReceiver` 类）已被
`subscribeAll` 单入口取代；DSH 的 mux 对照分析见 git 历史。现行实现以本文为准。
