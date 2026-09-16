# Agent 循环上下文快照缓存优化方案

> **实施状态**P0-a（S0 继承改造 + command 清理 + 死参数删除）与 **P0-b（S1' + S1 快照层 + S2 失效契约 + S3 预算后缀和）均已完成**（2026-08-30）。
> `tsc --noEmit` 零错误；`test/chat` + `test/agent-engine` **15 套件 132 用例全绿**（含新增快照失效契约测试：revision 复用 / 写入重建 / append 增量 / transformKey 切换重建）。
> 全量测试的既有失败（workspace-watcher TS2554 / browser / skills）与本方案无关。
> 剩余：P1（S4 invalidateBlocks 精确失效、S5 管线惰性复制）、P2（指标埋点、token 账本持久化）——均非必需。
> 后续设计（同日）：DSH 式 envelope/surface 分离方案见 `docs/dsh-style-request-envelope-plan.md`（system 独立字段、getMessages 收敛、user_prompt 保留前导不落库）。

> 目标：消除每轮 agent 循环对消息视图的重复投影与重复变换，把「每轮 O(n) 重算 ×N 次」降为「按 seq 增量的 O(Δ) 更新」。
> 相关文档：`message-pipeline-normalization-plan.md`（L0/L1 分层契约）、`agent-engine.md`（循环结构）

---

## 一、现状诊断

### 1.1 循环结构

`agent-engine.service.ts:439` 起 `do…while`（条件闭合于 `:732`），单轮步骤：

```
PRE_STEP 钩子 (:449) → getMessages (:457) → buildCompletionParams (:477)
  → streamWithRetry (:476) → assembler.toMessage (:576) → appendMessages (:592)
  → executeToolsAndBuildParts (:686) → TURN_STOPPING (:722)
```

### 1.2 一轮内的上下文重算点

所有路径最终都汇入 `JsonlSessionContext.loadVisibleMessages`（`:180`）：

```ts
private async loadVisibleMessages: Promise<Message[]> {
  const rawMessages = await this.messageStore.loadContext({ sessionId, keepReasoningContent });
  return this.transformPipeline.run(rawMessages, transformCtx); // 199
}
```

单次调用的开销构成：

| 环节 | 位置 | 成本 |
|---|---|---|
| `loadContext` → `getState` | `jsonl-message.service.ts:341` | state 缓存命中，**廉价** |
| `deriveMessages(state)` | `replayer.ts:506-517` | **O(n) 全量遍历投影**（每次重建数组） |
| `transformPipeline.run` ×3 步 | `message-transform.pipeline.ts:144` | **3×O(n) map + 3n 个新对象** |

即单次 ≈ **4n 次遍历 + 3n 次对象分配**。

一轮内的调用次数：

| # | 调用点 | 说明 |
|---|---|---|
| 1 | `compaction.service.ts:70` `ds.getTokenCount` | PRE_STEP 阈值检查，每轮必跑 |
| 2 | `agent-engine.service.ts:457` `getMessages` | 钩子后重读，每轮必跑 |
| 3 | `compaction.service.ts:89` `ds.getTokenCount` | 压缩触发，**与 #1 输入完全相同** |
| 4 | `compaction.service.ts:124` `ds.getHistory` | 引擎唯一数据源 |
| 5 | `compaction.service.ts:153` `refreshAfterCompaction` | 先 `tokenMeter.invalidate` 清空块缓存，再重读 |
| 6 | `compaction.service.ts:234` `ds.getTokenCount` | 缓存刚被 #5 清空，全部 tiktoken 重算 |
| 7 | `agent-engine.service.ts:457` `getMessages` | 又一次 |

> **确凿浪费**`compaction-coordinator.service.ts:64-74` 的 `onPreStep` 返回 `void`，把 `maybeCompress` 已经算好的 `outcome.messages`（`compaction.service.ts:159` 返回的刷新后列表）**直接丢弃**引擎随即全量重算一遍。

### 1.2.1 `deriveMessages` 的过滤条件还剩下多少必要性

`deriveMessages`（`replayer.ts:506-517`）做两件事，逐一核对 fold 侧：

```ts
for (const node of state.messages) {
  const m = node.message;
  if (m.role === 'event') {
    if (m.metadata?.eventType !== 'compaction') continue; // 过滤 A
  }
  if (m.metadata?.shadowed === true) continue; // 过滤 B
  out.push(m);
}
```

**过滤 B（`shadowed`）已是死代码。** `compaction/summary` 在 fold 时做的是**物理删除**而非打标：

```ts
state.messages.splice(0, endIdx + 1, { seq, turnId, message: summaryMsg }); // replayer.ts:253
```

被遮蔽节点当场从 `state.messages` 移除，摘要节点顶替到头部。既然数组里已无 shadowed 节点，读取时再判一次纯属冗余。同理 `turn/delete` 也是物理 `filter`（`:159`）。

**过滤 A（`event`）不是死代码，但它是设计错误。** `command/run`（`:275`）和 `command/done`（`:292`）会把 `role='event'` 的节点 `push` 进 `state.messages`。这些命令事件对 LLM 视图毫无意义，却混进了 LLM surface，导致每次投影都要过滤一遍。

更关键的是：**`deriveTurns` 全仓未实现**（`function deriveTurns` 零匹配，只有 `replayer.ts:11`、`types.ts:8` 等注释在反复提及，`jsonl-message.service.ts:8` 的 `getDisplayTurns` likewise 只存在于注释）。也就是说，这些 command 节点在 persistence 层**没有任何消费者**——被 fold 进来、又在投影时被过滤掉，是纯粹的空转。

结论：**不是"投影时要不要过滤"的问题，而是"这些东西根本不该进 `state.messages`"**。`state.messages` 的语义就是可视消息序列，`seq`/`turnId` 只是归属与排序标签，不是另一层数据。

### 1.2.2 `loadContext` 的遗留参数

| 参数 | 定义 | 调用方 | 结论 |
|---|---|---|---|
| `anchorTurnId` | `message-store.interface.ts:29` | **无** | 死参数，删除 |
| `lastCompactedTurnId` | `:32` | **无**（且 fold 侧从未实现） | 死参数，删除 |
| `maxMessages` | `:30` | `session.service.ts:507` 传 `2` | **在用，保留** |

`anchorTurnId` 的实现本身就有 bug：注释写「只加载到此轮次为止（含该轮次）」，代码却是 `messages.findIndex(m => m.id === params.anchorTurnId)`——拿**消息 id** 去比对**轮次 id**语义从未成立过。无人调用是唯一合理的解释。

`maxMessages` 服务于会话标题生成（"取最近 2 条消息总结标题"）。它目前走的是 `loadContext` → 全量 `deriveMessages` → `slice(-2)`：**为了拿 2 条消息，对一个长会话做了完整的 O(n) 投影**。这是被折叠在主链路之外的另一处浪费，S0 落地后会顺带变成 O(1)。

### 1.3 次生问题

1. **`getTokenCount` 双次全量估算**（`jsonl-session-context.ts:440-453`）：
   先 `estimateFullRequestTokens(view)`，命中锚点后再算 `estimateFullRequestTokens(view.slice(0, anchor.index+1))`。块级缓存（`token-meter.service.ts:24`）挡住了 tiktoken，但两次 O(块数) 遍历照旧。

2. **压缩预算循环内逐条估算**（`compression-engine.ts:303-312`）：
   ```ts
   for (let i = messages.length - 1; i >= 0; i--) {
     const msgTokens = await this.tokenMeter.estimateMessages(sessionId, modelName, [messages[i]]);
   ```
   循环内 n 次函数调用 + 每次新建单元素数组。等价于 O(n) 次调用拿一个本可一次算完的后缀和。

3. **`invalidate` 粒度过粗**（`token-meter.service.ts:31` 删除整个会话 Map）：
   `refreshAfterCompaction` 全量清空，紧接着 #6 又全量统计——刚建好的缓存被自己清掉。

4. **`getMessages` 尾部数组复制**（`:204`）：
   `[...this.preludeParts, ...(await this.loadVisibleMessages)]` 每轮新建大数组。

5. **变换管线无条件复制**`imageProjectionStep` 有短路（`supportsImageInput` 时原样返回），但 `reasoningPolicyStep`、`emptyContentCompatStep` 无条件 `messages.map`，对绝大多数历史消息是 no-op 仍分配新对象。

### 1.4 现有缓存盘点

| 缓存 | 位置 | 覆盖到哪一层 |
|---|---|---|
| `stateCache`（Map + 30min TTL，写即 fold） | `jsonl-message.service.ts:56` | 挡住磁盘回放，**挡不住 deriveMessages** |
| `sessionCaches`（contentId → tokens） | `token-meter.service.ts:24` | 挡住 tiktoken，**挡不住遍历** |
| `preludeParts` | `jsonl-session-context.ts:80` | 仅系统提示词 |

**结论**省掉的恰是廉价部分（磁盘 IO、tiktoken），昂贵的部分（投影、变换、遍历）每次都做。缓存层缺在 L1 这一档。

---

## 二、优化方案

### 2.1 核心思路

引入 **上下文快照（ContextSnapshot）**以 `store.getLastProcessedSeq` 为版本号，缓存「投影 + 变换 + token 统计」的完整结果。同一版本号 + 同一变换上下文直接复用；写入时增量更新。

**关键前提**`IMessageStore` 已提供 `getLastProcessedSeq(sessionId)`（`message-store.interface.ts:69`），是天然单调递增的版本号，无需改造存储层。

### 2.2 S0 · 消灭嵌套：`MessageNode extends Message`

> **前版方案的自我修正**本文曾提出在 `ReplayState` 上新增 `llmView: Message[]` 与 `messages` 并行维护，后又否决。两种处理都错在前提——**把 `MessageNode` 当成了与 `Message` 不同的东西**。它不是。`MessageNode` 就是「多带两个标签字段的 `Message`」，仅此而已。

#### 2.2.1 类型改造

```ts
// 现状：为多带两个字段而引入一层嵌套
export interface MessageNode {
  seq: number;
  turnId: string | null;
  message: Message; // ← 这一层是纯粹的间接开销
}

// 改造：继承，MessageNode IS-A Message
export interface MessageNode extends Message {
  seq: number;
  turnId: string | null;
}
```

继承之后：

- `MessageNode[]` 天然可当 `Message[]` 使用，无需任何投影。
- `deriveMessages` 的 `map(n => n.message)` 变成**恒等操作**整个函数**删除**。
- `loadContext` 退化为 `return state.messages`——**O(1)，且不需要维护第二份数据**。

对比前两版方案：

| 方案 | 投影开销 | 是否两份数据 | 一致性风险 |
|---|---|---|---|
| 现状（嵌套 + `deriveMessages`） | 每次读取 O(n) | 否 | 无，但慢 |
| 前版（`llmView` 并行维护） | O(1) | **是** | **有**（漏同步即静默丢消息） |
| **本版（继承）** | **O(1)** | **否** | **无** |

这一版同时拿到了前两版想要的东西：既消灭投影，又不引入需要维护 invariants 的第二份状态。

#### 2.2.2 字段泄漏排查（已验证安全）

继承后 `seq` / `turnId` 会随对象一路走到 adapter。若 adapter 整体 spread 消息对象，多余字段会进 LLM 请求。实测四个 adapter **全部是白名单构造**| adapter | 构造方式 | 整体 spread |
|---|---|---|
| `openai.adapter.ts:270` | `{ role, content }` + 按需补 `reasoning_content` / `tool_calls` | 0 处 |
| `anthropic.adapter.ts:509` | 同上 | 0 处 |
| `gemini.adapter.ts:293` | `{ role, content }` | 0 处 |
| `openai-response.adapter.ts:183` | 同上 | 0 处 |

只取 `msg.role` 与 `msg.content`，**`seq` / `turnId` 不会进入请求体**。

#### 2.2.3 `messages` 的语义澄清

`state.messages` 不是什么「完整 surface」，**它就是可视消息序列**。`seq` / `turnId` 只是贴在消息上的归属与排序标签，不是另一层数据。

唯一让当前代码偏离这个语义的是 **command event 节点**`command/run`（`:275`）、`command/done`（`:292`）会把 `role='event'` 的节点 push 进 `state.messages`，而 LLM 视图并不需要它们。更要紧的是——**`deriveTurns` 全仓未实现**（`function deriveTurns` 零匹配，只有注释在反复提及），所以这些 command 节点在 persistence 层**没有任何消费者**它们被 fold 进来、又在投影时被过滤掉，是纯粹的空转。

处理建议（拆两步，降低风险）：

1. **第一步（随继承一起做）**`loadContext` 保留一次 `filter` 剔除 event 节点。它跑在重建路径上，配合 S1 快照缓存，稳态下不执行。
2. **第二步（独立评估）**让 `command/run` / `command/done` 不再 push 进 `state.messages`，`deriveMessages` 的 event 过滤随之删除。需先确认前端命令展示是否依赖折叠态——若不依赖（事件页本就是读盘独立折叠），这一步可直接做，`loadContext` 即成为真正的 O(1) 恒等返回。

#### 2.2.4 改动面（实测统计）

`MessageNode` 的解包点高度集中，**共约 15 处、两个文件**| 文件 | 改动 |
|---|---|
| `types.ts:274` | 定义改 `extends Message` |
| `replayer.ts:173/223/235` | `n.message.id` → `n.id` |
| `replayer.ts:301-306` | `n.message.role/metadata` → `n.role/n.metadata` |
| `replayer.ts:506-517` | `deriveMessages` **删除** |
| `replayer.ts` 各 push 点 | `{ seq, turnId, message: X }` → `{ ...X, seq, turnId }` |
| `jsonl-message.service.ts:329/345/442` | `.message.content` / `deriveMessages(state)` / `?.message` 相应改写 |

> `{ ...X, seq, turnId }` 是浅拷贝，`content` 数组仍共享引用——与现状一致（现状 `node.message` 也是引用），不引入行为变化。

**其他清理项**（零风险，可并入）：

- 删除 `ContextLoadParams.anchorTurnId` / `lastCompactedTurnId` 死参数。
- 删除 `deriveMessages` 中的 `shadowed` 过滤（死代码，见 1.2.1）。

### 2.3 S1' · `appendMessages` 返回折叠后的新增节点（关键修正）

原 S1 设计里 `appendToSnapshot(added)` 直接拿会话层传入的 `Message` 增量 push——**这是错的，会导致快照与 store 静默漂移**。

`appendMessages` 落库时把 Message 拆成 event data（`jsonl-message.service.ts:467` 起），fold 时再由 `assistantMessageFromData` 重建，而重建**不是原样还原**```ts
// replayer.ts:416-428
const blocks = data.content.map((b) => (b.contentId ? b : { ...b, contentId: cid }));
appendFileBlocks(blocks, cid, data.files); // 追加 file 块
return { ..., metadata: { ...meta }, content: blocks, createdAt: time };
```

它会**补齐 contentId****追加 file 块****用 event.time 覆盖 createdAt**。会话层手里那个原始 `Message` 与 store 里的权威对象并不相同。若拿原始对象增量，快照会缺 file 块、contentId 可能为空，进而导致 token 估算偏差、块级缓存键失效。

**正确做法：让写入方返回权威的折叠结果，消费方只消费不猜测。**

```ts
// jsonl-message.service.ts —— 返回类型 void → Message[]
async appendMessages(sessionId: string, messages: Message[]): Promise<Message[]> {
  const startSeq = await this.getNextSeq(sessionId); // append 前取游标
  // ...构造 events（现状不变）...
  await this.append(sessionId, events);

  // 返回本次实际折叠出的节点（fold 后的权威对象），从尾部回扫，O(k)
  const state = await this.getState(sessionId);
  const out: Message[] = [];
  for (let i = state.messages.length - 1; i >= 0; i--) {
    if (state.messages[i].seq < startSeq) break;
    const m = state.messages[i].message;
    if (m.role !== 'event' || m.metadata?.eventType === 'compaction') out.unshift(m);
  }
  return out;
}
```

用 `seq >= startSeq` 过滤而非按条数取尾部，可自动处理 fold 时被忽略的事件（`user/message` 在回合未开时会 `break` 跳过），返回条数与入参不一致也不会错。

会话层增量据此改写：

```ts
private async appendToSnapshot(added: Message[]): Promise<void> {
  if (!this.snapshot) return;
  const ctx = this.buildTransformCtx;
  const view = this.transformPipeline.run(added, ctx); // added 已是权威对象，可直接变换
  ...
}
```

`appendMessages` 返回类型变化对现有调用方无破坏——忽略返回值即可。

### 2.4 数据结构

> **修订（实施后）**`request` 字段已移除——它是 `view` 的 100% 冗余投影，由缓存层手动同步即双数据源（与被否决的 `llmView` 同构）。：会话只持有对话历史这一份权威数据，完整请求列表（prelude + view）是 `getMessages` **组装时刻的派生表达式**不作为状态存储。代价仅为每次 `getMessages` 一次 O(n) 引用复制（微秒级、零对象分配），换来：快照单一数据源 + `getMessages` 返回新数组（外部修改数组结构天然不影响快照，不可变契约从人肉约定变成结构保证）。

```ts
/** 上下文快照：一轮内可复用的不可变视图（单一数据源 = view） */
export interface ContextSnapshot {
  /** 版本号 = store.getLastProcessedSeq，写入即失效依据 */
  revision: number;
  /** 变换上下文指纹：模型能力变化即重建 */
  transformKey: string;
  /** 变换后的可见消息（不含 prelude）——唯一权威数据 */
  view: readonly Message[];
  /** prelude 的启发式 token（prelude 不变时复用） */
  preludeTokens: number;
  /** 逐消息 token，与 view 同序 —— 供前缀和/后缀和 O(1) 查询 */
  perMessageTokens: readonly number[];
  /** perMessageTokens 的前缀和，prefixTokens[i] = view[0..i] 之和 */
  prefixTokens: readonly number[];
}
```

### 2.5 会话侧实现

在 `JsonlSessionContext` 上增加快照持有与三个入口：

```ts
private snapshot: ContextSnapshot | null = null;

/** 变换上下文指纹：模型能力/思考模式变化时重建 */
private transformKey: string {
  return [
    this.modelConfig.config.inputCapabilities?.includes('image') ? 'img' : 'noimg',
    this.thinkingEffortValue && this.thinkingEffortValue !== 'none' ? 'think' : 'nothink',
    this.modelConfig.provider?.protocol ?? '-',
  ].join('|');
}

/** 取快照：revision 与 transformKey 均未变则复用 */
private async getSnapshot: Promise<ContextSnapshot> {
  const revision = await this.messageStore.getLastProcessedSeq(this.sessionId);
  const key = this.transformKey;
  if (this.snapshot && this.snapshot.revision === revision && this.snapshot.transformKey === key) {
    this.metrics.snapshotHit++;
    return this.snapshot;
  }
  this.metrics.snapshotMiss++;
  this.snapshot = await this.buildSnapshot(revision, key);
  return this.snapshot;
}

/** 全量重建（唯一昂贵路径） */
private async buildSnapshot(revision: number, key: string): Promise<ContextSnapshot> {
  await this.ensureConversationStateLoaded;
  const ctx = this.buildTransformCtx;
  const view = this.transformPipeline.run(
    await this.messageStore.loadContext({ sessionId: this.sessionId, keepReasoningContent: ctx.thinkingMode }),
    ctx,
  );
  const perMessageTokens = await this.tokenMeter.estimatePerMessageTokens(this.sessionId, this.modelName, view);
  return this.assemble(revision, key, view, perMessageTokens);
}

/** 增量更新：appendMessages 后调用，成本 O(Δ) 而非 O(n) */
private async appendToSnapshot(added: Message[]): Promise<void> {
  if (!this.snapshot) return; // 无快照 → 下次 getSnapshot 全量重建
  const ctx = this.buildTransformCtx;
  const addedView = this.transformPipeline.run(added, ctx);
  const addedTokens = await this.tokenMeter.estimatePerMessageTokens(this.sessionId, this.modelName, addedView);
  const view = [...this.snapshot.view, ...addedView];
  const perMessageTokens = [...this.snapshot.perMessageTokens, ...addedTokens];
  this.snapshot = this.assemble(
    await this.messageStore.getLastProcessedSeq(this.sessionId),
    this.snapshot.transformKey, view, perMessageTokens,
  );
}

/** （未实施，可选）外部已算好的列表直接播种（压缩后免一次重建） */
seedSnapshot(view: readonly Message[]): void { … }
```

对外接口改为从快照取值，签名不变（getMessages 为派生表达式，见 2.4 修订）：

```ts
async getMessages: Promise<Message[]> {
  // 单一数据源：完整请求 = [...prelude, ...view]，组装时刻派生，返回新数组
  return [...this.preludeParts, ...((await this.getSnapshot).view as Message[])];
}
async getHistory: Promise<Message[]> {
  return (await this.getSnapshot).view; // 只读共享引用
}
async getTokenCount: Promise<number> {
  const snap = await this.getSnapshot;
  // 锚点校正：前缀和 O(1) 取值，不再二次遍历
  const total = snap.preludeTokens + snap.prefixTokens[snap.prefixTokens.length - 1];
  const anchor = this.findUsageAnchor(snap.view);
  if (anchor && anchor.model === this.currentModelName) {
    const atAnchor = snap.preludeTokens + snap.prefixTokens[anchor.index];
    return Math.max(0, anchor.promptTokens + (total - atAnchor));
  }
  return total;
}
```

### 2.6 失效契约（关键）

| 写入路径 | 策略 | 理由 |
|---|---|---|
| `appendMessages` | **增量** `appendToSnapshot` | 高频、纯追加，前缀不变 |
| `appendCompact` / `appendPrune` | **失效**（`snapshot = null`） | 改写历史，结构变化 |
| `deleteTurn` / `replaceTurn` | **失效** | 低频，正确性优先 |
| 模型/思考模式切换 | **失效**（transformKey 变化自动命中） | 已内建于 `getSnapshot` 比对 |
| 压缩完成 `refreshAfterCompaction` | **失效重建** | 压缩改写内容，保守失效（实施时未做 seedSnapshot 播种，重建即兜底） |

> 保守原则：除 `appendMessages` 外一律全量失效。宁可多一次 O(n)，不可错一次。

### 2.7 配套改造

**S0b · 清理死参数与冗余过滤**

- `ContextLoadParams` 删除 `anchorTurnId`、`lastCompactedTurnId`（均无调用方，前者实现还有 id 语义 bug）。
- `maxMessages` **保留**（`session.service.ts:507` 标题生成在用）。
- `loadContext` 移除 `anchorTurnId` 分支；`deriveMessages` 从生产链路摘除，降级为测试 oracle。

> 若希望标题生成语义更直白，可另开 `getRecentMessages(sessionId, n)` 替代 `maxMessages` 参数，属可选重构，非性能必需。

**S2 · 压缩后状态恢复**
`refreshAfterCompaction` 失效快照 + token 缓存，紧随的 `getMessages` 触发一次重建（压缩轮第 2 次也是最后一次重算），此后一轮内全部命中。

**S3 · 压缩预算改后缀和**
`compression-engine.ts:303` 的逐条循环改用快照的 `perMessageTokens` 从尾累加：

```ts
const t = snap.perMessageTokens;
let retainTokens = 0, boundary = messages.length;
for (let i = messages.length - 1; i >= 0; i--) {
  if (retainTokens + t[i] > retainBudget) break;
  retainTokens += t[i];
  boundary = i;
}
```
n 次函数调用 + n 个临时数组 → n 次加法。

**S4 · `invalidate` 精确化**
`token-meter.service.ts` 增加 `invalidateBlocks(sessionId, contentIds)`，压缩时只清被遮蔽消息与被 prune 改写块的 contentId，替代 `refreshAfterCompaction` 里的全量清空。

**S5 · 变换管线惰性复制**
`reasoningPolicyStep` / `emptyContentCompatStep` 先 `some` 探测，无变更则返回原数组引用，避免无条件 map。

> ⚠️ 风险：惰性复制会让 `view` 与 store 缓存共享对象引用，与现有「管线在副本上执行、不污染 store 缓存态」的注释相悖。启用 S5 必须同时确立**快照不可变契约**下游只读，`appendMessages` 传入的是新建对象而非快照对象。建议在 dev 环境对 `view`/`request` 做 `Object.freeze` 做断言。S5 收益（减少 GC）小于 S1，可延后到 P1 并单独验证。

---

## 三、收益估算

设 n = 可见消息数，k = 单轮新增消息数（通常 1~3）。

| 场景 | 现状 | S0 后 | S0+S1+S1' 后 |
|---|---|---|---|
| 常态轮（无压缩） | 2×（1n 投影 + 3n 变换）= 8n | 2×3n = 6n | **O(k)** 增量 |
| 压缩轮 | 7×4n = 28n | 7×3n = 21n | 2 次重建 = 6n |
| `getTokenCount` | 2 次 O(块数) 遍历 | 同左 | O(1) 前缀和 |
| 压缩预算 | O(n) 次函数调用 | 同左 | O(n) 次加法 |
| 每轮对象分配 | 6n 个新对象 | 6n | 约 3k 个 |

**分层收益**- **S0 单独**消掉每次读取 1n 的投影遍历与 1 个 n 长数组分配，压缩轮 28n→21n（-25%）。约 15 处改动、2 个文件，无一致性风险。
- **S0+S1+S1'**稳态下每轮成本 = 新增消息的变换量 O(k)，**与历史长度 n 完全解耦**。长对话从「越聊越慢」变成「每轮成本恒定」——这是本项目最关键的收益，因为 n 会随对话持续单调增长。

以 n=500、100 轮循环且中途压缩 5 次估算：遍历量从约 `95×4×500 + 5×28×500 ≈ 26 万次` 降至约 `95×k + 10×3×500 ≈ 1.7 万次`（k≈2），对象分配同比例下降。

---

## 四、风险与对策

| 风险 | 对策 |
|---|---|
| 快照与 store 不一致（并发写） | 版本号即 `getLastProcessedSeq`，外部写入后 seq 必变，下次读取自动重建；种子快照写入时同步记录当前 seq |
| 下游就地修改污染快照 | `view` 为只读共享引用（消费方只读）；`getMessages` 每次返回新数组（派生表达式），外部修改数组结构天然不影响快照 |
| 内存多持有一份引用 | 实际更省：`request` 数组原本每轮新建，现在复用；`perMessageTokens`/`prefixTokens` 为 number 数组，n×8B×2，n=500 时约 8KB，可忽略 |
| 增量路径算错导致上下文错乱 | **增量源必须是 `appendMessages` 返回的 fold 后权威对象**（S1'），不可使用会话层手里的原始 `Message`——fold 会补 contentId、追加 file 块、覆写 createdAt。单测覆盖「连续 append 与全量重建结果逐字段一致」 |
| 模型切换未触发重建 | `transformKey` 纳入 `supportsImageInput`/`thinkingMode`/`protocol`，切换即失效 |
| 尾部回扫取新增节点时漏判 | 用 `seq >= startSeq` 判定而非按条数取尾部，可容忍 fold 时跳过事件（如回合未开的 `user/message`） |
| `prune` 就地改块使已缓存 token 过期 | 已有 `tokenMeter.invalidate` 机制覆盖，S4 会做精确化 |
| S0 继承后 `seq`/`turnId` 泄漏进 LLM 请求 | 已实测：四个 adapter 全部白名单构造（`{role, content}`），零处 `...msg` spread，字段不会外泄。新增 adapter 需在 spec 中加断言守住此约束 |
| S0 浅拷贝导致引用相等断言失败 | `{...X, seq, turnId}` 与现状 `node.message`（引用）语义一致，`content` 数组仍共享；若某处依赖对象引用相等需改用 `id` 比对 |

---

## 五、实施计划

### P0-a（类型改造，改动集中，无一致性风险）

1. **S0** `MessageNode extends Message`：改定义 + 约 15 处解包点（`replayer.ts`、`jsonl-message.service.ts`），删除 `deriveMessages`，`loadContext` 改为直接返回 `state.messages`。
2. 删除 `ContextLoadParams.anchorTurnId` / `lastCompactedTurnId` 死参数及其分支。
3. 删除 `deriveMessages` 中的 `shadowed` 死代码过滤。

> 已完成字段泄漏排查（四个 adapter 均白名单构造）。不涉及会话层与压缩层，可独立验证独立上线。

### P0-b（核心收益，需整体联调）

4. **S1'** `appendMessages` 返回 fold 后的新增节点（**必须先于快照层落地**否则增量会用错对象）。
5. **S1 快照层**`ContextSnapshot` + `getSnapshot`/`buildSnapshot`/`appendToSnapshot`/`seedSnapshot`，`getMessages`/`getHistory`/`getTokenCount` 改走快照。
6. **S2 失效契约**`appendMessages` 增量；compact/prune/delete 失效；`refreshAfterCompaction` 播种。
7. **S3** 压缩预算后缀和。

### P1

7. **S4** `invalidateBlocks` 精确失效。
8. **S5** 管线惰性复制（需先落地不可变契约与 freeze 断言）。

### P2

9. 快照指标埋点（hit/miss）接入日志，观察真实命中率。
10. 跨会话 token 账本持久化（压缩历史 UI 复用）。
11. **（可选）** 2.2.3 第二步：确认前端不依赖折叠态中的 command 节点后，让 `command/run` / `command/done` 不再 push 进 `state.messages`，`loadContext` 成为真正的 O(1) 恒等返回。

---

## 六、验证方式

**单测**（沿用现有 spec 文件）

- `replayer.spec.ts` / `jsonl-message.service.spec.ts`（S0 相关）：
  - `MessageNode` 可直接赋给 `Message` 类型（编译期由 `extends` 保证）
  - `loadContext` 返回序列与改造前 `deriveMessages` 结果**逐字段 deep equal**（行为等价性回归）
  - **字段泄漏守卫**`loadContext` 结果喂给四个 adapter，断言请求体 `JSON.stringify` 中**不含** `seq` / `turnId`（防止未来 adapter 改成整体 spread 时静默泄漏）
- `jsonl-message.service.spec.ts`（**S1' 的防线，最高优先级**）：
  - `appendMessages` 返回值与随后 `loadContext` 全量结果的**尾部逐字段 deep equal**（确保增量源是权威对象）
  - assistant 消息返回值中 `contentId` 已补齐、`file` 块已追加——即**保留会话层原始 Message 所没有的加工**
  - 回合未开时 append（`user/message` 被 fold 跳过）返回值不含该条，不抛错
  - 连续多次 append，返回值序列与全量重建完全一致
- `jsonl-session-context.spec.ts`：
  - 同一 revision 连续 `getMessages` 只触发一次 `loadContext`（spy 计数）
  - `appendMessages` 后快照增量结果与全量重建**逐字段 deep equal**
  - `transformKey` 变化后强制重建
  - `appendCompact`/`deleteTurn` 后快照失效
- `compaction.service.spec.ts`：压缩后 `refreshAfterCompaction` 播种，紧接着的 `getMessages` 命中快照（0 次 `loadContext`）
- `compaction-coordinator.spec.ts`：压缩轮 `loadContext` 总调用次数 ≤ 2
- `message-transform.pipeline.spec.ts`：惰性复制（S5）下 no-op 时返回同一数组引用

**基准**

构造 500 条消息的会话，跑 100 轮循环（含 5 次强制压缩），对比优化前后的：

- `loadContext` 调用次数（应 ≈ 轮次数，而非 2~7 倍）
- 进程 CPU time 与 `process.memoryUsage.heapUsed` 峰值
- 端到端 wall clock（长对话场景）

**回归**

现有 `test/chat/*` 与 `test/agent-engine/*` 全绿，重点看压缩相关用例的 token 数断言是否漂移（前缀和算法需与逐条累加结果完全一致）。
