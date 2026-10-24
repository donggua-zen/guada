# DSH 的「切换」与多端同步实现

> 对象：`D:\AI\work\public\deepseek-harness`（0.1.2-alpha.5）
> 截图里其实是**两个完全不同的切换器**：左边 `Grok / DashScope` 是 dsh-image-gen 的「生图 Provider 胶囊」，右边 `deepseek-official/deepseek-flash` 是 DSH 原生的「会话模型选择器」。二者同步机制不同，但底座相同。

---

## 1. 一张图看懂

```
┌──────────────── 浏览器客户端 A ────────────────┐      ┌──────── 浏览器客户端 B ────────┐
│ ModelSelect (会话模型)      ProviderPill (生图) │      │ 同样的组件，各自持有投影/订阅   │
│   │ useSyncExternalStore       │ scope.subscribe │      │                                │
└───┼────────────────────────────┼────────────────┘      └───────────┬────────────────────┘
    │ ① unary RPC                │ ② unary RPC                        │
    │ session.selectModel        │ settings.set                       │
    ▼                            ▼                                    │
┌────────────────────────── Host（单一事实源） ───────────────────────┴────────────────────┐
│ ③ session.append('model/selection')  → 会话事件日志（持久、带 seq）                      │
│ ④ settings 文件写入                 → settings.yaml（image-generation.provider）          │
│                                                                                          │
│ ⑤ 事件扇出                                                                                │
│    · session/event  ──→ 每个 follow 该会话的客户端（按 seq 保序、无空洞）                 │
│    · settings/document-updated / credentials/reference-updated / llm/adapters-updated     │
│                      ──→ 每个已连接客户端的 forwarded-event 流（广播）                    │
└──────────────────────────────────────────────────────────────────────────────────────────┘
    │ WebSocket mux（一条物理连接，多路逻辑流）                    ▲
    └──────────────────────────────────────────────────────────────┘
```

一句话：**所有"切换"都是写 Host；客户端只是投影。同步不是客户端之间互相同步，而是 Host 把同一条事件/设置变更扇出给所有订阅者。**

---

## 2. 右边：会话模型选择器（`deepseek-official/deepseek-flash`）

### 2.1 组件与状态

代码：`packages/client/ui-model-selection/`

- 组件 `ModelSelect.tsx` 挂在 composer 的 `conversation.input.model` 槽位；
- 用 `useSyncExternalStore(directory.subscribe, directory.getSnapshot)` 读一个**每会话单例** `ModelDirectory`；
- `ModelDirectory.syncInputs()` 合成两个输入：
  1. **Host 共享模型目录**（`catalog`）：provider 分组、模型、推理档位、routable 集合；
  2. **会话投影** `modelSelection`：`current = projected.next ?? catalog.default`。

```ts
// directory.ts
const projected = modelSelectionProjection(this.projected.getSnapshot())
const current = projected.next ?? catalog.value.default
```

`projected.next` 是"下一次请求要用的选择"，来自会话日志的投影，不是浏览器本地状态。

### 2.2 点一下发生了什么

```
ModelSelect.onSelect
  → directory.select({provider, model, reasoningEffort})
  → remote.session.selectModel({ sessionId, provider, model, reasoningEffort })   // unary RPC
      Host: commands.selectModel()
        → ctx.llm.resolveCallConfig()          // 校验该路由确实可用
        → agents.selectForNextRequest(agent, selected)
             → agent.session.append('model/selection', selected)   // ★ 写会话日志
        → agentDefaultModel.saveSelection(selected)                // ★ 同时存为新会话默认
  → 返回 { selected }
```

关键点：
- **切换是会话事件，不是 UI 状态**。`model/selection` 是一条持久事件，重放日志即可恢复；
- 投影定义 `model-selection-projection.ts`：
  - 收到 `model/selection` → `pending = selection`；
  - 收到 `request/header` → `lastUsed = 真正发出的模型`，若与 pending 相同则清空 pending；
  - 对外视图 `next = pending ?? lastUsed`；
- 因此"选了但还没发请求"和"已经用上了"是两个可区分的状态；
- 同时调用 `agentDefaultModel.saveSelection()` → 新会话默认模型也变了（写 `agent-default-model` 设置）。

**实测（本机 2026-10-20）**：在会话 `session-b79892db…` 里把模型切到 V4-Pro 再切回 V4-Flash，会话日志（zstd JSONL）里正好多出两条事件：

```json
{"type":"model/selection","seq":532,"data":{"provider":"deepseek-official","model":"deepseek-v4-pro","reasoningEffort":"high"}}
{"type":"model/selection","seq":533,"data":{"provider":"deepseek-official","model":"deepseek-v4-flash","reasoningEffort":"high"}}
```

同时 `~/.dsh/settings.yaml` 的 `agent-default-model` 也随最后一次选择更新。**两次切换 = 两条事件 + 两次默认设置重写**；未发请求，所以没有新的 `request/header`。

---

## 3. 左边：生图 Provider 胶囊（`Grok / DashScope`）

代码：`dsh-image-gen/src/client/provider-pill.tsx`

- 它是**插件设置**的快捷入口，不是会话级状态；
- 读：`scope.getSnapshot()` + `scope.subscribe(...)`（0.1.7 走 `configForms`，旧 host 走 `settingsScope`）；
- 写：

```ts
void writeSetting(props.scope, 'provider', provider, t('writeRejected'))
// → scope.set('provider', value) → Host settings.set
```

- Host 把 `image-generation.provider` 写进 `settings.yaml`，然后发出 `settings/document-updated`；
- 所有已连接客户端都收到这个 forwarded event，插件的 settings scope 刷新 → 胶囊和设置卡同时更新。

所以：
- **生图 Provider 是全局默认**：在 A 端切换，B 端胶囊立刻变，所有会话都受影响；
- 单次工具调用仍可用 `provider` 参数临时覆盖（`generate_image(provider: 'openai')`），不写设置。

---

## 4. 多端同步的底座

### 4.1 一条 WebSocket，多路逻辑流

`packages/api/gateway/src/stream-server.ts` + `src/client/stream-client.ts`

- 浏览器与 Host 之间只有**一条物理 WebSocket**（`/api/...` upgrade）；
- 每条逻辑流用 `streamId` 复用这条连接：`open / item / end / error / cancel`；
- Host 侧 `RemoteStreamMuxServer` 维护 `Map<streamId, ActiveStream>`，支持心跳（ping/pong，连续 2 次丢失即断）、取消、批量关闭；
- 好处：一个页面可以同时订阅会话事件、设置事件、工具流，不会开一堆连接。

### 4.2 会话同步：snapshot + 无空洞事件流

`packages/api/session-controller/src/history.ts` 的 `follow()`：

```
客户端打开会话
  ← snapshot: header + records + cursor + projections(基线)
  ← event(seq=n+1)
  ← event(seq=n+2)
  ...
```

实现要点：
- Host `ctx.on('session/event', { global: true })` 监听所有会话追加事件，只转发 `session.id === target` 的；
- 以 `cursor` 为起点，**seq 必须连续**：`item.seq < expected` 丢弃，`item.seq !== expected` 直接报 `session event stream skipped seq`（宁可重连也不静默丢更新）；
- 客户端断线重连会重新拿 snapshot（含最新投影），因此不会出现"半旧半新"；
- `connection/reset` 会重置目录/目录缓存并重新拉取。

### 4.3 全局事件：allowlist 广播

`packages/api/remotes/src/remote-events.ts` 维护一张**允许跨端转发的事件表**：

```ts
{ event: 'settings/document-updated', mode: 'emit' },
{ event: 'credentials/reference-updated', mode: 'emit' },
{ event: 'llm/adapters-updated', mode: 'emit' },
{ event: 'api-session/added' / 'removed' / 'status' / 'activity', mode: 'emit' },
{ event: 'commands/change', mode: 'emit' },
...
```

- Host 启动时把这些 Cordis 事件接到一个队列（`remoteEventSource`）；
- Gateway 为**每个客户端**开一条 forwarded-event 流（`REMOTE_EVENT_STREAM_ENDPOINT`），首帧返回 `clientId`，之后广播 `emit` 帧；
- 客户端 `ctx.remote.$on(event, listener)` 注册到这条流上；
- 模型目录因此会在 `settings/document-updated` / `credentials/reference-updated` / `llm/adapters-updated` 时自动刷新——**换 Key、加 Provider、改设置，所有端的模型列表一起变**。

### 4.4 同步语义速查

| 操作 | 作用域 | 同步范围 | 持久化 |
| --- | --- | --- | --- |
| 右栏切换模型 | **会话级**（+ 新会话默认） | 同一会话的所有客户端实时同步；其它会话不受影响，但其"新会话默认"会变 | 会话日志 `model/selection` + `agent-default-model` 设置 |
| 左侧生图 Provider | **全局设置** | 所有客户端、所有会话 | `settings.yaml` → `image-generation.provider` |
| 修改模型 Key | 全局凭证 | 所有客户端（`credentials/reference-updated`） | `~/.dsh/.credentials.yaml` |
| 新增/删除 Provider | 全局设置 | 所有客户端（`settings/document-updated`） | `settings.yaml` |
| 会话消息/工具流 | 会话级 | 该会话的所有客户端 | 会话日志（seq） |

> 注意："多端"= **多个客户端连到同一个 Host**。同一个 Host 被局域网另一台设备打开也会同步；两个独立的 DSH 进程各自读同一份 `$DSH_HOME` **不会**实时互相同步（文件层竞争，不属于支持用法）。

---

## 5. 为什么这样设计（而不是客户端互推）

1. **单一写者**：只有 Host 写会话日志和设置，天然避免多端并发写冲突；
2. **可恢复**：会话是 append-only + seq，客户端断线重连拿快照即可，不需要 CRDT/OT；
3. **可审计**：`model/selection` 是事件，能重放、能解释"这一轮为什么用这个模型"；
4. **双向入口一致**：`/model` 弹窗和 composer 座位共用同一个 `ModelDirectory`，不会出现两个入口各说各话；
5. **插件零成本接入**：插件只声明 settings 命名空间并 `scope.subscribe`，就自动获得跨端同步。

---

## 6. 关键代码地图

| 关注点 | 文件 |
| --- | --- |
| 模型选择 UI | `packages/client/ui-model-selection/src/client/ModelSelect.tsx` |
| 每会话共享目录 | `.../src/client/directory.ts`、`service.ts` |
| 模型目录刷新 | `.../src/client/catalog.ts` |
| 选择 RPC | `packages/api/session-controller/src/commands.ts`（`selectModel`） |
| 写入会话事件 | `packages/api/session-controller/src/agent.ts`（`selectForNextRequest`） |
| 投影定义 | `packages/api/session-controller/src/model-selection-projection.ts` |
| 会话事件流 | `packages/api/session-controller/src/history.ts`（`follow`） |
| WebSocket 多路复用 | `packages/api/gateway/src/stream-server.ts`、`src/client/stream-client.ts` |
| 事件广播 allowlist | `packages/api/remotes/src/remote-events.ts`、`src/index.ts` |
| 客户端事件订阅 | `packages/api/gateway/src/client/remote-events.ts` |
| 生图胶囊 | `dsh-image-gen/src/client/provider-pill.tsx`、`settings-write.ts` |

---

## 7. 如果要在 GuaDa 复刻

GuaDa 已有 SSE + JSONL 事件溯源，底座其实更接近"单写者 + 事件流"，可以按同样语义补齐：

1. **切换 = 追加事件 / 写设置**，不要把选择只放在前端 Pinia；
2. SSE 广播时带 **seq**，客户端丢弃旧 seq、发现空洞就重连并拉全量快照；
3. 设置类变更（模型 Key、生图 Provider）单独发一个全局事件，前端订阅后刷新所有依赖视图；
4. 保持"一个会话一个订阅、多端各自投影"的模型，避免客户端互推；
5. 区分**会话级选择**与**全局默认**：会话级写事件，默认写设置，两者都要广播。
