# 压缩管线设计 — 现状修复与 DSH 对齐

> 版本：1.4 | 日期：2026-08-26 | 状态：已实施（统一 LLM seam：撤销过度封装，重试回归 agent 层）

---

## 1. 背景

本项目在整体重构中（流式协议、持久化层抽象），压缩管线在两次重构
（`80a81b8c` 流式协议重构、`074a8325` 持久化层抽象）中**整体断裂**：
主链路只保留了"一级裁剪（prune）"和"手工触发"，**二级 LLM 摘要、DB 摘要历史、
压缩事件推送、插件缓存失效事件**全部断掉。

本设计文档记录：
1. 断裂点清单与修复方式
2. 与 deepseek-harness（DSH）压缩管线的对比与对齐点
3. 已实施的对齐改造
4. 消息传入统一（全数据输入）与消息级遮蔽（v1.2）
5. 钩子插件化：压缩与记忆同步统一事件接入（v1.2）

---

## 2. 断裂点与修复（阶段 0：止血）

| # | 断裂点 | 表现 | 修复 |
|---|--------|------|------|
| A | 二级摘要断链 | `jsonl-session-context.compress()` 调 `CompressionEngine.execute()` 不传 `summaryProvider`，`execute()` 因 `无 summaryProvider` 恒提前返回，`compaction/*` 事件永不写入 | 新增 `LLMSummaryProvider`（包装 `LLMService.completions`），摘要模型 = `resolveCompressionModel` 配置优先，回退会话当前模型；`compress()` 按 summaryMode 构建并注入 |
| B | 影子记忆轮次空跑 | `onBeforeCompaction`（记忆保存 LLM 轮次）在每次 `shouldCompress` 通过时都执行，即使最终只做 prune | `onBeforeCompaction` 移入 `CompressionEngine.execute()`，**仅在确认需要二级压缩后**调用 |
| C | DB 摘要历史无写入 | `SessionContextStateRepository.create` 无调用，MemoPanel 压缩历史恒空、`strategy` 恒 `"none"` | `compress()` 在 `compacted=true` 时写 `contextStateRepo.create`（摘要/遮蔽游标/统计） |
| D | 压缩事件推送断链 | `STREAM_COMPRESSION_START/ERROR` 前后端均为死类型，无 SSE 通知 | 新增 `CompressionStartEvent/CompressionErrorEvent` 到 `SessionStreamEvent` 联合，`mapStreamMethod` 补映射，agent-engine 压缩前后 yield；前端 `streamProjector` 消费（置/清 `isCompressing`） |
| E | 插件缓存失效事件丢失 | `memory.compacted` 无人 emit，memory/todo/universal-tools 三插件监听空转 | `compress()` 在压缩完成后 emit `memory.compacted`（`memory.pre_compact` 一并恢复） |
| F | 死代码 | 死三元 `'gpt-4o'`、`CompressionEngine.shouldCompress()` 无人调用、`interfaces.ts` 的 `ICompressionStrategy`/`COMPRESSION_STRATEGY_TOKEN`/旧 `CompressionConfig` 等 | 全部清理；`interfaces.ts` 收敛为 `TokenBreakdown`/`calcTotalTokens` + 存储 re-export |
| G | 前端两套展示格式 | ChatPanel 旧 `metadata.hidden && compactInfo` 分支（新数据永不走）vs 新 `kind='event'`/`role='event'` | 删除旧分支与 `CompactedPlaceholder` 引用，统一走 `EventCard` |
| H | 5 个 PoC 脚本对不上新 API | `poc-jsonl-*.ts` import/函数签名全部脱节，非 jest 用例不被执行 | 删除，以 `test/chat/compression-engine.spec.ts`（11 例）取代 |

---

## 3. 与 DSH 压缩管线对比

### 3.1 DSH 架构（deepseek-harness）

```
packages/compaction/           能力缝合层（独立可选能力，对话循环零压缩逻辑）
├── compaction/                Service Definition：抽象 CompactionEngine + 事件类型
├── compaction-basic/          Service Provider：触发监听 + 两级执行 + 事务
├── compaction-tool-result-pruner/  免模型本地截断
└── command-compact/           Consumer：/compact 人类命令
packages/llm/token-meter/      独立 TokenMeter（usage 优先 + 固定启发式 4字符/token）
```

核心机制：
- **三种触发**：压力（`agent/pre-step`，threshold = window × 0.8）、
  上下文溢出恢复（`agent/request-error` 中识别 CONTEXT_WINDOW_EXCEEDED → 强制压缩 → retry）、手动 `/compact`
- **两级执行**：ToolResultPruner（确定性本地截断，预算 8192/4096/1024）→ 重测 → 仍超则 LLM 摘要
- **保留策略**：`retainTokens = window × retainRatio(0.16)` 尾部预算 + tool-pairing 平衡切点（不切断 tool-call/result 配对）
- **结构化摘要**：`COMPACTION_INSTRUCTION` 固定 Markdown 结构 + 增量合并旧 `<compacted-summary>` 检查点 + KV 缓存友好前缀
- **收敛不变量**：摘要必须严格小于被遮蔽内容，超限在 retries 内重压
- **持久化**：原始日志全保留（确定性重放），摘要以 `user/message` + `surfaceOp replace` 遮蔽；`compaction/start→summary→user/message→end` 括号即日志锁，孤儿 start 可检测

### 3.2 本项目现状（重构后）

```
agent-engine.service.ts        内嵌触发：shouldCompress() → compress()（循环内直接调用）
jsonl-session-context.ts       决策（usageAnchor 启发式）+ 执行编排
compression-engine.ts          后端无关统一引擎（prune → compact）
message-store.interface.ts     appendPrune / appendCompact（compaction 括号事件）
replayer.ts                    compaction/* 折叠（遮蔽回合 + 摘要事件消息）
```

持久化层**已天然对齐 DSH 事件模型**：`message/prune`、`compaction/start|summary|end`
与 DSH 几乎一一对应，replayer 支持遮蔽回放——这是重构保留下来的最大资产。

### 3.3 差距对照表

| 维度 | DSH | 本项目重构后 | 对齐动作 |
|------|-----|-------------|---------|
| 触发解耦 | 钩子事件订阅 | 循环内嵌直接调用 | 已收敛为窄接口（shouldCompress/compress 两方法）；溢出恢复即 request-error 钩子的等价物 |
| 溢出恢复 | context-overflow → 强制压缩 → retry | 无 | **已实施**：`isContextWindowExceeded()` + 主循环 catch 中强制压缩（force）→ 重试（每轮最多一次） |
| Token 计量 | 独立 TokenMeter（usage 优先 + 启发式） | usageAnchor 启发式（jsonl-session-context）+ tiktoken 逐条（engine） | 现状已满足"usage 优先 + 启发式回退"；服务化列为后续演进 |
| 保留策略 | retainRatio 预算 + tool-pairing 切点 | 固定保留最近 3 组 | **已实施**：targetTokens 预算驱动尾部保留 + `toolPairingBalancedBefore`（新 `compaction/tool-pairing.ts`） |
| 摘要 prompt | 结构化 checkpoint + 增量合并 + KV 缓存友好 | 无实现 | **已实施**：`COMPACTION_INSTRUCTION`（中文适配，固定 Markdown 结构 + 增量合并旧 `<compacted-summary>`） |
| 收敛检查 | 摘要 < 被遮蔽 token，超限重压 | 无 | **已实施**：`compactMessages` 收敛校验 + `compactionRetries` |
| 一级裁剪 | 全表面节点预算化 pruner + 影子价格事件 | 只裁剪 tool-result（>1000/头尾500） | **已实施**：`pruning` 参数注入（maxLength/protectedRecent/headTailChars）；影子价格事件列为后续演进 |
| 锁语义 | start-end 日志锁 + 孤儿恢复 | 原子批量写入 + torn-tail 修复（天然无孤儿） | **已实施**：replayer 孤儿括号审计（`openCompactionSeq`，不阻断） |
| 持久化事件模型 | compaction/* + surface replace | compaction/* + 遮蔽回放 ✓ | 已对齐，不重写 |

---

## 4. 已实施的对齐（阶段 1+2）

### 4.1 新文件

| 文件 | 职责 |
|------|------|
| `backend-ts/src/modules/chat/compaction/tool-pairing.ts` | `toolPairingBalancedBefore`：压缩边界不切断未配对的 tool-call/result（本项目回合内已折叠配对，作防御兜底） |
| `backend-ts/src/modules/chat/llm-summary.provider.ts` | `LLMSummaryProvider` 实现 `SummaryProvider` 接口；`COMPACTION_INSTRUCTION` 结构化摘要指令；增量合并旧检查点 |

### 4.2 关键改动

- **`compression-engine.ts`**：`CompressionOptions` 增加 `modelName/summaryMode/onBeforeCompaction/maxSummaryTokens/compactionRetries/force/pruning`；
  `execute()` 修复死三元、force 跳过阈值、onBeforeCompaction 后移到确认二级压缩后；
  `compactMessages()` 保留预算驱动 + tool-pairing + 收敛校验 + 实际 summaryMode；
  新增 `shadowOnly()`（DISABLED 模式直接遮蔽）。
- **`jsonl-session-context.ts`**：注入 `LLMService/SessionContextStateRepository/EventBusService`；
  `compress()` 构建 summaryProvider、emit 插件事件、写 DB 摘要历史。
- **`agent-engine.service.ts`**：压缩前后 yield `compression_start/compression_error`；
  溢出恢复路径（catch 中识别 `isContextWindowExceeded` → force 压缩 → 重试）。
- **`llm-core/utils/retry-on-error.util.ts`**：新增 `isContextWindowExceeded()`（error.code / 消息关键词启发式识别）。
- **`replayer.ts`/`types.ts`**：`ReplayState.openCompactionSeq` 孤儿括号审计。
- **前端**：`streamProjector.ts` 消费压缩事件（置/清 isCompressing）；`ChatPanel.vue` 删旧分支；
  `EventCard.vue` 压缩卡片增强；`event-chunk.types.ts` 前后端同步新增压缩事件类型。

### 4.3 摘要调用设计（对齐 DSH summarizer）

- 摘要模型：`SK_MOD_COMPRESS_MODEL` 配置优先，回退会话当前模型（`resolveCompressionModel`）
- 调用方式（v1.1 起）：`LLMService.completions({ stream: true, temperature: 0.4, maxTokens: 2000, thinkingEffort: none })`
  + `BlockAssembler` 累积（对齐 DSH `ctx.llm.stream()`），捕获 `usage` 记录到 `compaction/summary` 事件
- Prompt：`COMPACTION_INSTRUCTION`（固定 Markdown 结构，中文适配）+ 旧 `<compacted-summary>` 检查点（从历史 compaction 事件提取）→ 增量合并
- 收敛：摘要 token 必须 < 被遮蔽内容 token，超限在 `compactionRetries` 内重压

---

## 5. 后续演进（v1.1 全部实施，对齐 deepseek-harness）

### 5.1 TokenMeter 服务化（`token-meter.service.ts`）

会话级块缓存（按 contentId，LRU 会话上限 200）+ `estimateMessages/estimateTurns/estimatePerMessage/estimateTextTokens` + `invalidate(sessionId)`。
`JsonlSessionContext` 与 `CompressionEngine` 统一经 meter 计量；`loadMessages`/`deleteTurn` 失效缓存
（prune 就地改内容、contentId 不变，必须失效）。`estimatePerMessage` 供上下文占用率/UI 展示扩展。

### 5.2 CompactionCoordinator 解耦（`compaction/compaction-coordinator.service.ts`）

压缩编排从 agent-engine 抽离（循环零压缩逻辑）：
- `maybeCompress(context, { abortSignal, onBeforeCompaction, force, reason })` → `{ events, messages, didRun }`
  （决策 shouldCompress + 执行 compress + 压缩事件收集，事件由调用方 yield 给前端）
- `recoverFromOverflow(context, error, { abortSignal })`：识别上下文溢出错误（`isContextWindowExceeded`）→ force 强制压缩（request-error 钩子等价物）
- agent-engine 保留循环状态（`overflowRecovered` 防死循环）与影子记忆轮次回调
  （`runMemorySaveShadowTurn` 依赖 engine 内部 `executeLLMStream`/`toolOrchestrator`，不移动）

### 5.3 compaction/prune 影子价格事件

`MessagePruneData` 加可选 `prunedTokens`（被裁剪内容的估算 token，原 − 新），经 `appendPrune`
透传落盘。供 token 计量消费方减去被遮蔽价格（对齐 DSH compaction/prune；本项目扩展 `message/prune`
数据而非新增事件类型，schema 表面最小）。

### 5.4 KV 缓存友好摘要前缀 + 流式调用

机制（已核实 DSH `summarizer.ts`/`region.ts`）：摘要调用是**压缩事务内的一次性直接 LLM 调用**
（不起新 agent 循环、不利用主循环）；复用目标是**压缩前最后一次主请求**的 prefix cache——
head-anchored 压缩使 `system + tools + 被压缩区域` = 上次请求真前缀；retained 不参与摘要请求。

本项目实现：
- `SummaryProvider.generate(SummaryInput) → SummaryResult { summary, usage? }`，
  `SummaryInput = { allMessages, shadowed, shadowedMessageIds }`
- `LLMSummaryProvider` 构造可选 `prefix: { prelude, tools }` + `resolveShadowed(ids)`（主请求消息解析）：
  请求 = `[...preludeParts, ...主请求遮蔽消息(逐字节一致), COMPACTION_INSTRUCTION]` + 相同 tools
  → 命中 warm prefix cache；无 prefix / 解析为空时回退"序列化单 user 消息"方案（不破坏现有路径）
- `resolveShadowed` 用 `context.history`（主请求实际发送的对象）按 ID 过滤——prune 改写
  tool-result / 非 thinking 移除 reasoning 后仍与主请求一致；store 派生仅作回退
- usage（流式累积）透传 `compaction/summary` 事件（`CompactionSummaryData.usage`）

---

## 6. 测试

`test/chat/compression-engine.spec.ts`（v1.1 扩至 15 例）：
- 触发判断（triggerRatio 跳过 / force 绕过）
- 一级裁剪（只裁剪超长 tool-result、保护最近 3 条）
- 二级摘要（summaryProvider 调用 + appendCompact 实际 mode；onBeforeCompaction 仅二级触发；
  无 provider 空跑保护；DISABLED 直接遮蔽；收敛校验重试）
- `toolPairingBalancedBefore`（未配对 tool-call 不单独遮蔽 / 配对完整不影响边界）
- `LLMSummaryProvider`（回退模式提取旧检查点；KV 前缀模式 = prelude + 主请求遮蔽区 + 指令 + tools；
  空区域占位；流式 usage 捕获）
- `TokenMeterService`（会话级块缓存 + invalidate；estimateTurns 可见性过滤）

全部 73 例改动相关模块测试通过（chat/persistence/database/events/agent-engine/utils）。

---

## 7. v1.2：消息传入统一 + 消息级遮蔽 + 钩子插件化

### 7.1 消息传入机制（对齐 DSH 单一数据源 + 统一派生）

**DSH 机制**（已核实源码）：
- 单一事实源：append-only 日志，消息入日志时 `deepFreeze`（不可变）
- 唯一投影规则：请求侧 `deriveMessages` 与压缩侧 `deriveEventMessage` 共用**同一个纯函数**，
  返回**同一批冻结对象引用** → 逐字节一致（`surface.ts:83-114`）
- 请求零过滤零改写：`buildRequest` 直接把派生结果放进 `request.messages`（`agent.ts:507`）
- 缓存只是快照加速：`derivedNodes` 水位 + `replaceGeneration` 失效，不是另一条派生路径

**本项目**：
- JSONL 事件 + replayer `deriveThreeTier` 统一派生（`loadContext`/`getTurns` 同源）——已具备单一数据源
- 唯一实质偏差：`context.loadMessages` 在 `loadContext` 之上做 **reasoning 策略处理 + KIMI 空填充**（请求侧特有），
  而压缩侧用 store turns 估算 → token 估算与请求实际有偏差

**修正（全数据输入）**：`CompressionEngine.execute` 不再读 store，改为接收 `options.messages`
（= `context.history`，请求消息列表，与主请求逐字节一致）：
- 触发估算 / 保留预算 / 收敛校验 / 摘要输入全部基于 messages（TokenMeter）
- 遮蔽范围 = messages 前缀（head-anchored + token 预算）
- 摘要输入即请求消息本身 → 删除 provider 的 `resolveShadowed` 双轨
- 引擎成为纯计算 + 写引擎（只经 `appendPrune`/`appendCompact` 写入），最利插件化与测试

**附带修复——摘要进入 LLM 上下文**：此前 `loadContext` 过滤全部 `role='event'`，导致压缩摘要
从不进入 LLM 上下文（DSH 是把摘要作为可见节点注入的）。现放行 `eventType='compaction'` 的摘要
事件消息 → 摘要进入请求列表，旧检查点亦可从请求列表提取（`extractPreviousSummary` 闭环）。

### 7.2 消息级遮蔽（对齐 DSH surface 节点级）

- `shadowedMessageIds` 语义从 turnId 改为 **messageId**
- `replayer` compaction/summary：展示链路标记 `metadata.shadowed=true`（保留原文）、
  LLM 链路从 `turn.messages` 移除；**旧数据兼容**（id 先按 turnId 匹配、再按 messageId 兜底）
- `loadContext` 过滤 `metadata.shadowed` 消息
- 前端 `turnsToFrontend` 跳过 shadowed 消息（组件零改动，由 compaction 摘要事件卡概括）
- `tool-pairing` 重写为消息级（切点前最后消息含未闭合 tool-call → 前移）

### 7.3 钩子插件化（压缩与记忆同步统一事件接入）

**机制**（对齐 DSH agent/pre-step · agent/request-error）：
- `EventBusService` 扩展 `waterfall`（串行 await 监听器，首个非 undefined 接管/短路，错误 fail-open）
  与 `emitAsync`（串行 await 全部，供记忆同步等待）
- 新 `types/agent-hooks.contract.ts`：`AGENT_HOOKS`（PRE_STEP / REQUEST_ERROR / BEFORE_COMPACTION / AFTER_COMPACTION）
  + `PreStepDecision` / `RequestErrorAction` / `emitStream` 回传回调
- **依赖方向反转**：agent-engine 只发钩子、零压缩/记忆知情；能力作为订阅者接入

```
agent-engine（循环零压缩逻辑）
  ├─ waterfall(PRE_STEP, { sessionContext, abortSignal, emitStream }, fallback=enter(historyMessages))
  │     → CompactionCoordinatorService.onPreStep：压力压缩 → 返回 enter(压缩后消息) 或 undefined 旁路
  ├─ waterfall(REQUEST_ERROR, { error, ... }, fallback=undefined)
  │     → CompactionCoordinatorService.onRequestError：溢出识别 → force 压缩 → { kind: 'retry' } 或 undefined
  └─ emitStream：压缩 start/error 经回调缓冲，agent-engine 在钩子返回后统一 yield（保持 SSE 协议不变）
CompactionCoordinatorService
  └─ 确认二级压缩后 emitAsync(BEFORE_COMPACTION, {...})
        → MemorySyncService.onBeforeCompaction：summaryMode=MEMORY_SYNC 时执行影子轮次（LLM 记忆保存）
```

**共享能力抽取**：
- `LlmStreamRunnerService`：从 agent-engine 抽出 `executeLLMStream`（重试壳），主循环与记忆同步共用
- `MemorySyncService`：`runMemorySaveShadowTurn` 整体移入（依赖 LlmStreamRunner + ToolOrchestrator），
  订阅 `compaction.before`；`session.service` 手动路径改调 `coordinator.maybeCompress`（同一事件机制）

**状态管理**：溢出重试计数在 coordinator（每会话 Map，上限 1，压力解除时重置）——`overflowRecovered`
从 agent-engine 移出；手动路径（HTTP 端点）无 emitStream，`maybeCompress` 缺省 no-op 回传。

### 7.4 新增/改动文件（v1.2）

| 文件 | 变更 |
|------|------|
| `compression-engine.ts` | 全数据输入（options.messages），消息级遮蔽，删除 store 读取 |
| `compaction/tool-pairing.ts` | 重写为消息级 |
| `replayer.ts` / `jsonl-message.service.ts` | 消息级遮蔽 + 旧数据兼容；loadContext 放行 compaction 摘要事件消息 + 过滤 shadowed |
| `event-bus.service.ts` | 新增 `waterfall` / `emitAsync` |
| `types/agent-hooks.contract.ts` | 新增：事件契约（AGENT_HOOKS + 载荷/决策类型） |
| `llm-stream-runner.service.ts` | 新增：LLM 流式请求执行器（重试壳） |
| `compaction/compaction-coordinator.service.ts` | 改为 @OnEvent 订阅 PRE_STEP/REQUEST_ERROR；emitStream 回传；溢出计数内置 |
| `memory-sync.service.ts` | 新增：订阅 BEFORE_COMPACTION，影子轮次移入 |
| `agent-engine.service.ts` | 只发钩子；删除压缩编排/影子轮次/overflowRecovered |
| `session.service.ts` | 手动路径改调 coordinator |
| `message.api.ts`（前端） | turnsToFrontend 跳过 shadowed 消息 |

### 7.5 测试（v1.2）

- `compression-engine.spec.ts`：引擎全数据输入（getTurns 不参与）、消息级遮蔽（shadowedMessageIds=消息 id）、
  tool-pairing 消息级、prune 就地改写
- `compaction-coordinator.spec.ts`（新增 8 例）：PRE_STEP 接管/旁路/失败 fail-open；REQUEST_ERROR 溢出
  retry/上限防死循环/非溢出旁路；BEFORE_COMPACTION emitAsync 串行通知
- `replayer.spec.ts` / `replayer-prune.spec.ts`：消息级遮蔽 + 旧数据兼容
- 全部 88 例改动相关模块测试通过（chat/persistence/database/events/agent-engine/utils）

---

## 8. v1.3：压缩彻底解耦（CompactionDataSource + CompactionService）

### 8.1 目标与结果

ISessionContext 不再承载任何压缩语义（对齐 DSH：Session 无压缩方法）——压缩成为
完全自包含、可插拔的能力：决策 + 编排 + Provider 工厂 + 持久化 + 插件事件全部内聚于压缩侧。

### 8.2 接口与职责归位

```
ISessionContext（删除 shouldCompress / compress / getMemoryConfig）
  会话职责：消息、token 计量（usageAnchor）、窗口、设置合并（含压缩配置合并解析）
JsonlSessionContext implements ISessionContext, CompactionDataSource
  新增数据源方法：getCompressionConfig / getPrelude / getTools / refreshAfterCompaction
CompactionService（新，压缩编排）
  决策 shouldCompress(ds) + 编排 compress(ds, opts)：pre_compact 事件 → 摘要 Provider 工厂
  （压缩模型解析 SK_MOD_COMPRESS_MODEL 移入）→ CompressionEngine.execute → 
  refreshAfterCompaction（会话侧恢复）→ DB 压缩历史 → memory.compacted
CompactionCoordinatorService
  依赖收窄：ComActionService + 注册钩子；会话经 CompactionDataSource 窄接口操作（内部窄化）
MemorySyncService：订阅 compaction.before（payload 携带全量 ISessionContext，影子轮次需要）
```

### 8.3 关键设计点

- **窄接口**：`CompactionDataSource`（compaction/types.ts）——getMessages（含 prelude，压缩后返回）、
  getHistory（引擎输入）、getModelConfig（压缩模型回退）、getTokenCount、getEffectiveContextWindow、
  getCompressionConfig（合并后配置）、getPrelude/getTools（KV 前缀）、refreshAfterCompaction（会话恢复）
- **DIP**：coordinator/ComActionService 只依赖窄接口，不感知 ISessionContext；
  钩子 payload 保持全量（与 DSH { agent, ... } 一致），内部窄化使用
- **会话侧保留**：refreshAfterCompaction（缓存失效+重载是会话状态职责）、设置合并（session>character>全局）

### 8.4 文件变更（v1.3）

| 文件 | 变更 |
|------|------|
| `compaction/types.ts` | 新增：CompactionConfig + CompactionDataSource |
| `compaction/compaction.service.ts` | 新增：压缩编排（从 context.compress 整体移植） |
| `jsonl-session-context.ts` | implements CompactionDataSource；删除 shouldCompress/compress/getMemoryConfig/Provider 构建/模型解析；依赖瘦身（-4） |
| `session-context.ts` | 删除 3 压缩方法 + MemoryConfig 类型 |
| `compaction-coordinator.service.ts` | 依赖收窄为 CompactionService；BEFORE_COMPACTION 保持全量 payload |
| `chat.module.ts` | 注册 CompactionService |
| `compaction-coordinator.spec.ts` | 更新（CompactionService mock） |
| `compaction-service.spec.ts` | 新增（决策/skip/编排/DISABLED/模型解析） |

### 8.5 测试

全部 93 例改动相关模块测试通过（chat/persistence/database/events/agent-engine/utils），
其中 compaction-service.spec 8 例 + compaction-coordinator.spec 8 例。

---

## 9. v1.4：统一 LLM seam（撤销过度封装，重试回归 agent 层）

### 9.1 问题与裁决

v1.2 曾把 agent-engine 私有 `executeLLMStream`（重试壳）抽为 `LlmStreamRunnerService`，
动机是"主循环与影子轮次共用"。审查后判定**前提不成立**：

- **影子轮次不需要重试**：它是失败容忍的辅助调用（记忆没保存只是继续压缩），重试退避反而拖慢压缩（记忆同步是同步等待的）
- **摘要调用不需要重试**：对齐 DSH——`summarizeWithLlm` 单次 `ctx.llm.stream`，压缩的"重试"是收敛循环（compactionRetries，再压缩），不是请求重试
- **DSH 的重试只在 agent 层**：`retryPolicy` 请求级构造、`agent/request-error` 钩子执行；`ctx.llm` 是无重试的低层 seam

裁决：**LLMService.completions 就是唯一 LLM seam**（本项目已有的 ctx.llm 等价物），
通用重试服务（LlmRequestService/LlmStreamRunnerService）是过度封装，撤销。

### 9.2 最终 LLM 调用形态

```
LLMService.completions                    ← 唯一 seam（路由/序列化/流式/超时/purpose）
  ├─ 主对话循环：SessionLlmRequestBuilder 组装 → agent-engine 私有 streamWithRetry
  │      （重试 5 次 + retry 信号 yield → SSE；对齐 DSH retryPolicy 在 agent 层）
  ├─ 影子轮次：SessionLlmRequestBuilder 组装 → 单次 completions（无重试，fail-open）
  └─ 压缩摘要：自组装 + purpose:'compaction' → 单次 completions（无重试，对齐 DSH）
```

### 9.3 文件变更（v1.4）

| 文件 | 变更 |
|------|------|
| `session-llm-request.builder.ts` | 新增：无状态组装 `buildCompletionParams(ctx, {...}) → LLMCompletionParams`（三次组装收敛一处） |
| `agent-engine.service.ts` | 私有 `streamWithRetry(params)`（重试壳回归 agent 层）；组装走 builder |
| `memory-sync.service.ts` | 影子轮次单次 completions（无重试）；组装走 builder |
| `llm-summary.provider.ts` | 摘要调用加 `purpose: 'compaction'`（单次不变） |
| `llm.types.ts` | `LLMCompletionParams.purpose?`（adapter 天然透传） |
| 删除 | `llm-stream-runner.service.ts`、`llm-request.service.ts` |
| `chat.module.ts` | 移除两个服务注册（agent-engine/memory-sync 直接依赖 LLMService，经 LlmCoreModule） |

### 9.4 收益

- 少两个服务（组件面减小）；重试语义清晰归位（agent 循环局部）
- 所有 LLM 请求收敛到 LLMService 一个 seam + 一个组装器，调用形态统一
- 影子/摘要调用不再承担无关的重试延迟；purpose 标记为未来 adapter 级优化留口

### 9.5 测试

全部 93 例改动相关模块测试通过（agent-engine.spec 构造 mock 恢复为直接 LLMService）。

## 10. v1.5：记忆形态改为 MEMORY.md 索引（取消记忆工具）

记忆侧从"专用工具 + 双文件（factual.md / memos）"改为 **MEMORY.md 索引 + 明细文件**，
写入统一走文件工具。压缩管线本身（触发、裁剪、摘要、档位）不变，本版只换记忆的载体与写入路径。
完整设计见 [../memory.md](../memory.md)。

### 10.1 问题与裁决

| 问题 | 现状 | v1.5 裁决 |
|------|------|-----------|
| 记忆不可见/不可编辑 | `.guada/memory/factual.md` 由专用工具读写，格式自由 | 索引化：`MEMORY.md`（AI 与用户都可直接编辑），明细按需读取 |
| 注入预算与实际不符 | 注入截断按 3000 字符算 factual，容量警告却把 memo 正文全部计入 → 实测 87% 占用被报成 "272% 记忆已满、无法显示" | 删除容量核算（整块逻辑随工具一起删）；预算改为"索引前 200 行" |
| 写后注入不刷新 | 插件 LRU 缓存只由 `memory.compacted` 失效，前台工具写入后索引长期是旧的 | 删除插件侧缓存，每次构建直读文件 |
| 影子轮次锁死专用插件 | `setToolScope("memory")` 匹配插件粒度，删除插件后会静默空转 | 改锁 `file` 插件 + 新增**路径牢笼**（`setPathJail`）收窄到记忆目录 |
| 记忆可写的边界与沙箱冲突 | 原记忆工具全文无 `getSandboxMode` 检查，绕过沙箱 | 牢笼显式声明优先于 `read-only`（保持"记忆始终可写"），牢笼内忽略提权参数以免唤起审批 |

### 10.2 关键设计点

- **prompt-only 工具包**：`memory` 工具包不再注册任何工具，只注册 VOLATILE 提示词；toolkit id
  保留，智能体层 `toolkits_deny` / 功能开关卡片零迁移。
- **索引注入**：读 `MEMORY.md` 前 200 行 + 常驻维护指南（格式、排序、瘦身、分类目录惯例）；
  超限追加一行"N 行仅前 200 行可见"。无缓存 → 记忆改动下一回合可见（systemText 每回合构建一次）。
- **路径牢笼**：`setPathJail(root)` 与 `setToolScope` 正交，收口在 `FilePlugin.resolvePath`
  （读类工具没有沙箱约束，不能只挂在写校验上），并在 `glob`（绝对/`..` pattern）、
  `resolveTarget`（远程工作目录）上补齐逃逸面。包含性判断抽出 `WorkspaceService.isPathWithin`。
- **只收窄不改变路径语义**：相对路径仍按工作目录解析——牢笼只决定落点是否允许，
  因此影子指令显式要求用绝对路径。
- **旧布局懒迁移**：索引缺失且探测到 `memory/factual.md` / `memos/*.md` 时复制进新树并生成
  无摘要索引行（`wx` 写入防并发覆盖），原文件不删。
- **影子轮次前缀不变式**：请求前缀（system + tools + 完整 surface）必须与主请求逐字节一致以复用
  provider warm prefix cache（见 [../summary-prefix-cache-plan.md](../summary-prefix-cache-plan.md) §3），
  因此工具范围/牢笼只在**执行期**收窄，不过滤工具定义、不改写 system。牢笼信息只作为 novel 后缀出现。
- **影子轮次日志**：`<workspace>/.guada/logs/compression.jsonl` 改为**追加式真 JSONL**（每次运行一行，
  超 5MB 轮转 `.1`）。此前 `writeFileSync` 覆盖写且按工作区共用单一路径，多会话互相抹记录、只留最后一次。
- **子智能体跳过影子轮次**：子代理走同一条 `PRE_STEP → CompactionCoordinator → BEFORE_COMPACTION` 链路，
  此前压缩时也会跑记忆维护并写进自己的隔离目录，但那份记忆在 run 结束后无人再读（短任务）。
  现在 `onBeforeCompaction` 按 `sessionType === "sub_agent"` 直接返回；隔离路径与索引注入保持不变。

### 10.3 文件变更（v1.5）

| 文件 | 变更 |
|------|------|
| `common/utils/memory-path.util.ts` | 新增：记忆目录/索引路径单一真相（插件注入与牢笼根共用），`MEMORY_INDEX_MAX_LINES = 200` |
| `builtins/memory.plugin.ts` | 重写：1862 行（含 1331 空行）→ 约 230 行；删工具/缓存/容量核算/事件订阅，新增索引注入、维护指南、旧布局迁移 |
| `chat/memory-sync.service.ts` | `setToolScope("file")` + `setPathJail(memoryDir)`，双开关 finally 恢复；指令改写为文件工具语义 + 绝对路径要求 |
| `chat/session-context.ts` / `jsonl-session-context.ts` | 新增瞬态 `setPathJail/getPathJail` |
| `builtins/file.plugin.ts` | 牢笼执行：`resolvePath` 越界拒绝、`glob` pattern 约束与默认基准、远程目标拒绝、`validateWritePath` 牢笼优先、`resolveWriteEscalation` 牢笼内直接返回 |
| `common/services/workspace.service.ts` | 抽出 `isPathWithin(target, roots)`，`isSafeWritePath` 改为委托 |
| `plugins.controller.ts` | tool-displays 补 `memory` legacy 映射（历史会话的工具调用块仍正确渲染） |
| `memory.lang.*.json` | 语义改为索引形态；4 个 display 键保留供 legacy 映射解析 |

### 10.4 测试（v1.5）

新增 3 个 spec（42 例）：`file-plugin-jail.spec.ts`（越界/绝对路径/`..`/远程/glob pattern/
牢笼优先写/无牢笼时沙箱行为不变/isPathWithin 边界）、`memory.plugin.spec.ts`（200 行截断、
超限提示、CRLF、子智能体隔离路径、迁移幂等与不覆盖手写索引）、
`memory-sync.service.spec.ts`（非 MEMORY_SYNC 零调用、作用域与牢笼的设置/恢复、
指令语义、工具执行、fail-open、中止）。全量 119 套件 / 1552 例通过。

## 11. v1.6：禁用压缩前影子轮次（预设改 FAST，代码全保留）

动机：影子轮次会在二级摘要**之前**串行插入最多 5 轮 LLM 调用（拉长压缩耗时），且其交互不入库、
不发 SSE，只能靠 `.guada/logs/compression.jsonl` 审计——审计面与压缩延迟都不划算。
长期记忆改由模型在普通回合里用文件工具自行维护（索引与维护指南每回合注入，见
[../memory.md](../memory.md)）。

### 11.1 关键事实（决策依据）

`SummaryMode` 在引擎里唯一的分支是 `DISABLED`（`compression-engine.ts` 决定"无 provider 时是否允许
压缩"）；`FAST` 与 `MEMORY_SYNC` 共用同一个 `summaryProvider`、同一套摘要 prompt 与保留比例，
`mode` 只被写进 compaction 事件、全仓无读取方（前端 `MemoPanel` 只看由摘要文本推导的
`cleaningStrategy`）。因此把档位预设指向 `FAST` 就等于"照常摘要、不跑影子轮次"，且 `FAST`
在引擎测试里本就按这个语义使用。

### 11.2 改动

| 位置 | 变更 |
|------|------|
| `compaction/compression-tiers.ts` | CONSERVATIVE / AGGRESSIVE 两档 `summaryMode` → `FAST`；预设表上方写明这是**开关点**与重新启用方式 |
| `compaction/compression-engine.ts` | `SummaryMode.DEFAULT` 由 `MEMORY_SYNC` 重指 `FAST`（堵住 `?? DEFAULT` 兜底意外重新拉起影子轮次）；枚举值 `MEMORY_SYNC` 保留（JSONL 事件与旧智能体配置兼容） |
| `frontend/src/locales/{zh-CN,en-US}/agents.ts` | 两档 `tierDesc` 去掉"摘要前先同步记忆"；`tip2` 改为"长期记忆由模型在对话中自行维护"；`compressionTierHint`/`tip1` 的"摘要方式"改为"是否摘要" |
| `test/chat/compression-tiers.spec.ts` | 两档断言改 `FAST`，新增"两档都不再触发影子轮次"的禁用意图契约 |
| `test/chat/jsonl-session-context.spec.ts` | aggressive / 缺省预设的 `summaryMode` 断言改 `'fast'` |

### 11.3 保留与后果

- **保留休眠**：`MemorySyncService`、`BEFORE_COMPACTION` 管线、`setToolScope`/`setPathJail`、
  `FilePlugin` 牢笼、`compression.jsonl` 日志与相关 spec 全部未删（约 450 行不可达代码 + 2 个仍跑的
  spec）。重新启用 = 把两档改回 `MEMORY_SYNC`。
- **收益**：压缩路径少最多 5 轮 LLM；此后记忆写入只可能来自普通回合，天然是 SSE + JSONL + UI 里
  可见的工具调用（审计问题随之消失）；主会话与子代理行为一致。
- **代价**：失去"压缩前最后一次兜底扫描"。"何时写"后来由 §11.4 的提示词时机信号（任务结束检查点、
  换线程前同步）部分补上，但仍是模型自觉——拖延即可能随压缩丢失信息。
- **观察（未做）**：禁用后两档区别只剩保留比例（40% vs 20%），触发阈值同为 0.9，"保守/激进"与
  "摘要方式"维度都已消失，后续若要真简化可考虑收敛档位。

### 11.4 记忆侧补齐（v1.6 后续）

禁用强制整理后，记忆侧改为"提示词纪律 + 写入时确定性守卫"两件套（细节见 [../memory.md](../memory.md)）：

- **协议纪律**（提示词）：索引四分类 `user/feedback/project/reference`、`feedback` 与 `project`
  明细文件要求 `Why:` / `How to apply:`、**何时写**（任务结束跑一次策展检查点、换线程前同步一次）、
  **不要写什么**（仓库/git 已记录的内容、会腐坏的当前状态、多条并行 project 笔记、密钥值）。
- **上限守卫**（代码）：`FilePlugin.evaluateMemoryIndexCap` 在 `write`/`edit` 本地分支的锁内判定，
  超硬上限（200 行 / 25KB）且变长的写入被拒绝并给出瘦身指引，**缩小/持平永远放行**；超软上限
  （150 行 / 20KB）只附提醒。行数口径 `countIndexLines`（忽略末尾换行）与注入截断共用，
  修掉了"200 行 + 末尾换行被算成 201 行"的误报。
- **诚实边界**：守卫只覆盖文件工具的 `write`/`edit` 本地分支（shell/远端/文件 API 通道绕过），
  且索引的**格式**仍无校验——体积确定性强制、内容靠纪律。
