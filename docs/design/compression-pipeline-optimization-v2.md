# 压缩管线优化方案 v2 — 五问调查与改造路径

> 调查日期：2026-08-31
> 调查范围：`backend-ts/src/modules/chat/compaction/*`、`jsonl-session-context.ts`、`common/persistence/*`、`agent-engine.service.ts`
> 参照系：`D:\AI\work\public\deepseek-harness`（下称 DSH）
> 结论：5 条问题**全部成立**，其中第 4 条附带一个被单元测试掩盖的**确凿 bug（P0）**。

---

## 0. 结论速览

| # | 问题 | 判定 | 根因 | 严重度 |
|---|------|------|------|--------|
| 1 | 原地处理却不复用，失效缓存上游重建 | 成立 | 压缩产物未回传；`refreshAfterCompaction()` = 全量失效 + 全量重建 | 中（每步循环 O(n) 重建） |
| 2 | 层级复杂，各层直接操作 messageStore | 成立 | 写入边界分散在 5 处；`appendPrune/appendCompact` 不返回 revision，违反自身版本号契约 | 中（架构债，阻塞 1 的优化） |
| 3 | shadowedMessageIds 离散 ids 浪费 | 成立 | 语义是连续前缀，折叠只用最后一个 id（`replayer.ts:216-220`） | 低-中（存储/重放/元数据三重浪费） |
| 4 | 二级用一级后结果 → 前缀缓存失效 | 成立，**且更严重** | 内容层：确实用裁剪后内容；**测量层：`afterPrune` 命中 contentId 级过期缓存，返回裁剪前数值 → 一级后几乎必然级联二级** | **P0（bug）** |
| 5 | 1/2 级触发与目标阈值一致 | 成立 | `targetRatio` 同时承担"prune 后验收线"与"保留预算"两个语义；DSH 拆成 threshold(验收) + retain(预算) | 中（过度压缩 + 无收敛闭环） |

---

## 1. 问题一：原地处理却不复用，上游失效重建

### 现状证据

```
compression-engine.ts:272-273   tr.content = newContent          // 就地改写（消息对象来自快照 view）
compaction.service.ts:156        const refreshed = await ds.refreshAfterCompaction()
jsonl-session-context.ts:634-638 snapshot = null
                                 tokenMeter.invalidate(sessionId)  // 全会话块缓存清空
                                 return this.getHistory()          // → buildSnapshot 全量重建
agent-engine.service.ts:457      let historyMessages = await sessionContext.getHistory()  // 又一次全量重建
```

`buildSnapshot`（`jsonl-session-context.ts:255-278`）的三段成本：
1. `messageStore.loadContext` —— store 有 ReplayState 缓存 + `applyToCache` 增量折叠，命中时接近 O(1)；
2. `transformPipeline.run(rawMessages)` —— **O(n) 全量对象拷贝与变换**（图片投影 / reasoning 策略）；
3. `estimatePerMessage` —— **O(n) 全量 tiktoken 计数**，因为上一步 `invalidate()` 把**全部**块缓存清空了。

### 浪费在哪

- 引擎在内存里已经算出全部关键结果：`prunedTokens`（逐条影子价格，`compression-engine.ts:260-269`）、`boundary`、`summaryTokens`（`:357-359`）、摘要文本。这些**全部丢弃**。
- `invalidate()` 是会话级全清：真正被改写的块通常只有个位数，其余 99% 的块内容未变却被迫重新计数。
- 每轮 agent 循环（每次工具往返）只要发生一次压缩，就付一次 O(n) 全量重建。

### 优化方案（P1）

**1.1 压缩产物回传，做增量快照更新**

`CompactionResult` 增补：`prunedTokenDelta`、`prunedContentIds`、`boundary`、`summaryTokens`、`summaryMessageId`。
`refreshAfterCompaction(outcome)` 接收产物，复用会话已有的 `appendToSnapshot` 增量机制：

```ts
// prune 增量：view 对象已被引擎就地改写，只需修正 token 派生值与块缓存
perMessageTokens[i] -= prunedTokens[i]      // 精确，无需重算
prefixTokens = 重算前缀和                    // O(n) 纯加法，零 tiktoken
tokenMeter.invalidateBlocks(sessionId, prunedContentIds)   // 细粒度失效，替代全清

// compact 增量：视图结构变更（前缀删除 + 摘要置头）
view.splice(0, boundary, summaryMsg)
perMessageTokens.splice(0, boundary, summaryTokens)        // summaryTokens 引擎已算
prefixTokens = 重算前缀和
```

`agent-engine.service.ts:457` 的 `getHistory()` 随即变为 O(1) 快照命中。

**1.2 TokenMeter 支持块级失效**

`token-meter.service.ts` 增 `invalidateBlocks(sessionId, contentIds: string[])`，替代压缩路径上的 `invalidate(sessionId)` 全清。

**1.3 前置条件**：需先解决 P0（问题 4 的缓存污染），否则增量值算出来是错的。

### 收益

压缩后的那一次循环从「O(n) 变换 + O(n) tiktoken」降为「O(n) 加法」（prefixTokens 重算），长会话下是数量级差异。

---

## 2. 问题二：层级复杂，各层都能直接操作 messageStore

### 现状证据

直接注入 `MESSAGE_STORE_TOKEN` 的位置：

| 文件:行号 | 角色 |
|-----------|------|
| `compaction/compression-engine.ts:117` | 压缩引擎**直接写** `appendPrune` / `appendCompact` |
| `jsonl-session-context.ts:141` | 会话读写 |
| `session.service.ts:44` | 业务层读写 |
| `messages.controller.ts:28` | HTTP 层直读 |
| `session-context.factory.ts:20`、`jsonl-session-context.factory.ts:24` | 工厂注入 |

三处结构性矛盾：

1. **引擎自我定位与实现不符**：`compression-engine.ts:2-7` 注释称"纯计算 + 写入引擎"，实际既做预算决策又直接落库。
2. **写入边界分散**：引擎（压缩写入）与会话（消息写入）各写各的，两侧的 store `ReplayState` 缓存 / 会话 `snapshot` / token 块缓存无法协调 → 只能靠"全量失效"兜底（问题 1 的直接成因）。
3. **版本号契约断裂**：`message-store.interface.ts:70-73` 明确规定
   > revision 由写入方在写入时随返回值原子给出，消费方绝不事后查询 `getLastProcessedSeq`

   但 `appendPrune`（`:142`）与 `appendCompact`（`:154`）返回 `void`，而 `appendMessages` / `addUserMessage` / `beginTurn` / `finalizeTurn` 都返回 revision。**压缩路径是唯一违反该契约的写入口**——这正是问题 1 无法做增量更新的根因之一（拿不到压缩后的 revision，只能作废快照）。

### DSH 对照

DSH 只有一个写入边界：`session`。
- `prune.pruneSession(agent.session)`（`compaction-tool-result-pruner/src/index.ts:136`）
- `session.append(...)`（`compaction-basic` 内）

压缩能力不持有 store，只通过 session API 写；session 的 `replaceGeneration` 递增即驱动投影缓存失效。
更关键的一点：DSH 派生出的 Message 对象是 **deep-frozen**（`session/src/index.ts:720-723` 注释：*"the `Message` objects in it are SHARED and **deep-frozen**"*），prune 通过**新增替换事件节点**（`surfaceOp: {op:'replace', start, end}`）实现，天然产生新的缓存身份；而我们是**就地改写**且 `contentId` 不变，这才埋下问题 4 的缓存污染。

### 优化方案（P2，架构收敛）

```
CompressionEngine  →  纯计算，零 IO，返回 CompactionPlan
                       { prunes: PruneOp[], compact?: CompactOp }
CompactionService  →  编排（决策 + provider 工厂 + 事件）
JsonlSessionContext→  唯一写入边界：ds.applyCompaction(plan) → 写库 + 拿 revision + 增量更新自己的快照/缓存
```

配套：
- `appendPrune` / `appendCompact` 改为返回 `revision`（补齐版本号契约）；
- 引擎去 `IMessageStore` 依赖后可直接单测，不必 mock store；
- `messages.controller.ts:28` 的直读可视情况收敛到会话层（HTTP 层不应触达存储）。

---

## 3. 问题三：shadowedMessageIds 用离散 ids 保存是浪费

### 现状证据

遮蔽范围在生成侧就是**连续前缀**：

- `compression-engine.ts:331` `const shadowedMessages = messages.slice(0, boundary)`

而消费侧只用到**最后一个 id**：

```ts
// replayer.ts:216-220
const shadowSet = new Set(data.shadowedMessageIds ?? []);
let endIdx = -1;
for (let i = 0; i < state.messages.length; i++) {
  if (shadowSet.has(state.messages[i].id)) endIdx = i;   // 只保留最后一个匹配下标
}
// :249  state.messages.splice(0, endIdx + 1, summaryMsg)
```

### 三重成本

1. **持久化**：每次压缩把 N 个 id 写进 JSONL 事件，多次压缩累积，永不回收；
2. **重放/折叠**：O(N) 建 Set + O(n) 扫描（本可 O(1) 或单次 findIndex）；
3. **元数据膨胀**：`replayer.ts:241-244` 把整个 id 数组塞进 `compactInfo`，随摘要消息进入视图与前端快照。

### DSH 对照

- 权威态是**位置数组 + 代际**：`SessionSurface { nodes: readonly number[]; replaceGeneration: number }`（`core/session/src/surface.ts:137-142`）；
- 持久化是**区间**：`surfaceOp: { op: 'replace', start, end }`（`surface.ts:151-182`）；
- 离散 `shadowedSeqs` 只写进 log-only 的 `compaction/summary` 事件，作**审计/计价**用，不参与折叠。

### 优化方案（P2，含兼容）

```ts
// 事件（新）
data: {
  endMessageId: string;   // 遮蔽前缀的最后一条消息 id —— 折叠唯一依据
  count: number;          // 被遮蔽条数（前端展示 + 一致性校验）
  // 可选审计：startSeq / endSeq
  summary, summaryMessageId, usage
}
```

- **折叠**：`endIdx = indexOf(endMessageId)`（可维护 `Map<id, idx>` 做到 O(1)），用 `count` 校验 `endIdx + 1 === count`；不一致时告警并回退。
- **向后兼容**：读取时若 `shadowedMessageIds` 存在（历史数据）→ 取末项作为 `endMessageId`、`length` 作为 `count`；写入只写新格式。
- **前端**：`CompactedPlaceholder.vue:12`、`EventCard.vue:65` 只用 `.length` → 改读 `count`；`streamProjector.ts:355` 的逐 id 标记改为按 `endMessageId` 位置折叠（`streamProjector.ts:224/376/399` 同步）。
- **迁移**：无需重写历史 JSONL，双读即可。

---

## 4. 问题四：二级用了一级后的结果 — 且发现 P0 级测量 bug

### 4.1 内容层：确实用了裁剪后的消息（前缀会失配）

`compression-engine.ts` 的执行顺序：

```
:156  pruneToolResults(sessionId, messages, ...)   // 遍历全部 messages，就地改写 tr.content
:199  compactMessages(sessionId, options, ...)     // options.messages 与上面是同一数组
:331  shadowedMessages = messages.slice(0, boundary)
:351  provider.generate({ shadowed: shadowedMessages })   // ← 裁剪后的内容
```

摘要请求 = `system + tools + [裁剪后的遮蔽区] + 指令`，而"上一次主请求"= `system + tools + [未裁剪的遮蔽区 + 保留区]`。
一旦第一条被裁剪的消息出现，其后全部失配 → **摘要请求无法命中 warm prefix cache**（`llm-summary.provider.ts:6-9` 的设计目标落空）。

放大因素：裁剪阈值 `PRUNING_TOOL_RESULT_MAX_LENGTH = 1000` 字符（`compression-engine.ts:29`），而 DSH 是 **8192 字符**（`compaction-tool-result-pruner/src/config.ts:10-14`）。我们的阈值低 8 倍 → 大量 tool-result 被裁剪 → 前缀扰动面极大，且 prune 事件数量膨胀。

### 4.2 测量层：**P0 bug —— `afterPrune` 读到的是裁剪前的数值**

证据链：

1. `replayer.ts` 的 `toolResultFromData`：`contentId = data.messageId`（**非空，稳定**）；
2. `token-meter.service.ts:113-120`：按 `contentId` 缓存块级 token；
3. `token-meter.service.ts:10-11` 注释已写明契约：
   > 任何就地修改消息内容的操作（prune 改写 tool-result）之后必须调用 `invalidate(sessionId)`，否则 contentId 不变但内容已变的块会返回过期估算。
4. `compression-engine.ts:273` `tr.content = newContent` —— **就地改写，contentId 不变**；
5. `compression-engine.ts:161-166` 紧接着 `estimateMessages(messages)` 计算 `afterPrune` → **命中过期缓存，返回裁剪前的 token 数**；
6. 真正的 `invalidate()` 发生在 `compaction.service.ts:156` `refreshAfterCompaction()`，即**引擎 execute 返回之后**——已经太晚。

**后果**：`afterPrune ≈ historyTokens + envelopeDelta`，几乎必然 `> targetTokens`（`:167`）→ **一级裁剪后几乎 100% 级联触发二级摘要**。一级裁剪在"是否需要摘要"这个判据上形同虚设。

**为什么测试没抓到**：`test/chat/compression-engine.spec.ts:118-124` 注入的是**无缓存**的 mock tokenMeter（`estimateMessages` 每次按内容实时计算），缓存污染路径在单测里根本不存在。

### 4.3 优化方案

**P0-1：用影子价格直接修正，零重算**

`pruneToolResults` 已经逐条算出精确的 `prunedTokens`（`:260-261`，且 `estimateTextTokens` 走文本直算、无缓存污染）。把它累加并返回：

```ts
// pruneToolResults 返回 { count, prunedTokenDelta, prunedContentIds }
const afterPrune = historyTokens - prunedTokenDelta + envelopeDelta;   // O(1)，精确
```

同时为 `refreshAfterCompaction` 提供 `prunedContentIds`，做块级精确失效（配合 1.2）。

**P0-2：摘要输入改用未裁剪的遮蔽区（KV 前缀优先）**

调整顺序，让"一次性省 token"让位于"前缀缓存命中"：

```
1. 测量（快照 O(1)），< trigger 则结束
2. 按原始 perMessageTokens 计算候选 boundary（retainBudget）
3. prune 只作用于保留区 [boundary, n)        ← 遮蔽区跳过
4. 重测（影子价格修正）→ < accept 则结束，只落 prune
5. 需要摘要 → 用【未裁剪】的遮蔽区生成摘要     ← 与上次主请求逐字节一致，命中 warm prefix
6. 统一落盘：appendCompact（原始内容已摘要）→ appendPrune（保留区裁剪）
```

理由：遮蔽区反正是要被摘要丢弃的，裁剪它只省这一次摘要请求的 token；而让它保持原样可以与"压缩前最后一次主请求"共享前缀，命中率收益远大于一次性节省。

实施要点：把 prune 的**落盘与改写推迟到摘要之后**（引擎阶段纯计算，最后统一写），与 P2 的"engine 返回 plan、会话统一写入"方向一致。

**P0-3：裁剪阈值对齐 DSH**

`maxLength` 1000 → 8192 字符量级，并纳入 `CompactionConfig.pruning` 按模型路由（`compression-engine.ts:94-102` 已有参数化入口，只是没接配置）。副作用：prune 事件数量大幅下降，前缀扰动面收窄。

---

## 5. 问题五：1/2 级阈值设计（DSH 怎么做的）

### 5.1 DSH 实测（已核实源码）

**一级 pruner —— 无 ratio，只有字符阈值**（`compaction-tool-result-pruner/src/config.ts:10-14`）：
```ts
thresholdChars: 8192, headChars: 4096, tailChars: 1024
```

**二级 —— 三个数值各司其职**（`compaction-basic/src/config.ts:20,23`）：
```ts
const DEFAULT_THRESHOLD_RATIO = 0.8   // 触发 + 压缩后验收
const DEFAULT_RETAIN_RATIO    = 0.16  // 仅作尾部保留预算
```

**门控语义**（`compaction-basic/src/index.ts:303-330`）：
```ts
if (measurement.totalTokens < spec.thresholdTokens) return null   // 触发门
if (prune !== undefined) { prune.pruneSession(agent.session); measurement = meter.measure(...) }
if (measurement.totalTokens < spec.thresholdTokens) return null   // prune 后仍用 threshold 判，不是 retain
for (let attempt = 0; attempt <= spec.compactionRetries; attempt += 1) {
  const range = selectCompactableRange(agent.session, measurement, spec.retainTokens)  // retain 只管保留多少
  if (range === null) { if (result === null) return null; break }
  result = await this.compactRegion(range.start, range.end, agent, signal)
  measurement = meter.measure(agent.session)
  if (measurement.totalTokens < spec.thresholdTokens) return result   // 压到 threshold 以下才收手
}
throw new Error(`compaction still above threshold ...`)   // 压不够 → 显式失败，不默默继续
```

### 5.2 本项目现状

| 参数 | 值 | 承担角色 |
|------|-----|---------|
| `triggerRatio` | 0.8 | 触发门（`:149`） |
| `targetRatio` | 0.5 | ① prune 后验收线（`:167`）② 二级保留预算 `retainBudget`（`:304`） |

**一个 targetRatio 同时扮演两个角色**，与 DSH 的三参数解耦相比有四处后果：

1. **过度触发摘要**：prune 后验收线是 0.5 而非 0.8。常见情况是 prune 把 0.85 降到 0.6——DSH 到此收手，我们继续走 LLM 摘要。叠加 4.2 的测量 bug，实际是**每次压力压缩都走摘要**。
2. **压缩过于频繁**：保留 50% 意味着压缩后距 80% 只有 30% 空间；DSH 保留 16%，间隔 64%。**我们的压缩频率约为 DSH 的 2 倍以上**，每次都是真金白银 + 上下文信息损失。
3. **无收敛闭环**：压缩后不重测、不重试、不报错。若压缩后仍 ≥ 0.8（`envelopeDelta` 大时可能，如超长 system/tools），下一步 `pre_step` 会**再压一次** → 逐步摘要风暴。自动路径完全没有保护（`compaction-coordinator.service.ts:52` 的 `MAX_OVERFLOW_RETRIES=1` 只覆盖溢出路径）。
4. **`maxSummaryTokens` 固定 2000**（`compaction.service.ts:149,199`），不随窗口缩放（DSH 默认 8192 且可按 `modelPolicies` 路由）。

### 5.3 优化方案（P1）

把三个语义拆开，默认值向 DSH 看齐：

| 参数 | 建议默认 | 角色 |
|------|---------|------|
| `compressionTriggerRatio` | 0.8 | 触发门 |
| `compressionAcceptRatio` | 0.8 | prune 后验收 + 压缩后验收（可与 trigger 同源，语义独立） |
| `compressionRetainRatio` | 0.16 ~ 0.2 | 仅保留预算（选区用） |
| `maxSummaryTokens` | 随窗口缩放（≈ 窗口 × 0.06，下限 2000） | 摘要输出上限 |

配套闭环（对齐 DSH `index.ts:313-330`）：

```ts
// 压缩后重测 → 未达 accept 则循环重试 → 仍超则告警并抑制
for (let attempt = 0; attempt <= compactionRetries; attempt++) {
  await compactOnce();
  const after = measure();                 // 增量测量，O(1)
  if (after < acceptTokens) return result;
}
logger.warn('[compress] 压缩后仍超阈值，抑制本轮，避免逐步摘要风暴');
```

注意 DSH 最终选择 **throw**；我们建议先 warn + 抑制（避免把已有会话打断），稳定后再评估是否改为显式失败。

---

## 6. 实施路线

### P0（止血，改动面小、收益最大）

| 项 | 改动 |
|----|------|
| P0-1 | `pruneToolResults` 返回 `prunedTokenDelta` / `prunedContentIds`；`afterPrune` 用影子价格修正（替代重算） |
| P0-1b | `TokenMeterService.invalidateBlocks(sessionId, contentIds)` |
| P0-2 | 摘要输入改用未裁剪遮蔽区；prune 落盘推迟到摘要之后 |
| P0-3 | 裁剪阈值 1000 → 8192，接入 `CompactionConfig.pruning` |
| 测试 | `compression-engine.spec.ts` 的 mock tokenMeter 改为**带缓存**的 fake，新增用例：*"prune 后 afterPrune 应反映裁剪，且不触发二级"* |

### P1（复用与阈值）

| 项 | 改动 |
|----|------|
| 1.1 | `CompactionResult` 回传产物；`refreshAfterCompaction(outcome)` 增量更新快照 |
| 1.2 | `appendPrune` / `appendCompact` 返回 `revision`，补齐版本号契约 |
| 5.3 | 阈值三分（trigger / accept / retain）+ 压缩后重测闭环 + maxSummaryTokens 缩放 |

### P2（架构收敛）

| 项 | 改动 |
|----|------|
| 2 | `CompressionEngine` 去 `IMessageStore` 依赖，返回 `CompactionPlan`；会话统一执行写入并同步自身缓存 |
| 3 | `shadowedMessageIds` → `{ endMessageId, count }`（事件 + compactInfo + 前端三处同步，双读兼容） |

### 回归清单

后端：`test/chat/compression-engine.spec.ts`、`compaction-service.spec.ts`、`compaction-coordinator.spec.ts`、`replayer-prune.spec.ts`、`session-replay.service.spec.ts`
前端：`frontend/src/services/modules/streamProjector.test.ts`、`CompactedPlaceholder.vue`、`EventCard.vue`

---

## 7. 一句话总结

四个"浪费"（问题 1/3）与两个"失当"（问题 2/5）之上，藏着一个真 bug：**一级裁剪后的 token 复测命中了未失效的 contentId 缓存，导致裁剪效果从未被计入判据，二级摘要几乎每次都被触发**。先修它，其余优化才有测量的地基。
