# DeepSeek Harness 轨迹功能源码分析与迁移记录（dsh → GuaDa）

> 分析对象：`D:\AI\work\public\deepseek-harness`（dsh）的轨迹能力。全部结论经本仓库源码核验（file:line 可回溯），
> 并据此产出迁移实施方案（见 §5）。旧文档 `model-trajectory-migration-analysis.md` 已删除，本文为其替代。

---

## 1. dsh 轨迹功能是什么

一句话：**轨迹 = 权威 JSONL 会话日志本身**（每次模型调用全过程都在日志里，无独立 trace 旁路文件）+ **纯消费者台账查看器**（turn-aware event ledger）。

数据流：

```
agent-loop 写事件 → Session 内存 append-only log（单一事实源，LLM 历史派生）
  → session-persistence-jsonl 落盘 → api-session-controller 推送事件窗口
  → ui-conversation Definition 引擎客户端折叠 → TrajectorySnapshot → 台账 UI
```

关键定位（ui-trajectory/package.json:4 自述）："pure-consumer plugin registering into the conversation ViewMap (no service)"。
dsh 的 `session.md` 原文：日志是 "the single source of truth；Message history is derived from this log"。

## 2. 数据层事件模型（packages/core/session/src/types.ts:261）

核心 12 类事件（`SessionEventMap`，types.ts:261-365）：

| 事件 | 作用 | 关键载荷 |
|---|---|---|
| turn/start / turn/end | 回合括号 | turn 号；end 带 reason |
| **step/start / step/end** | **一次模型调用 + 它请求的工具执行**（types.ts:278 原文） | 裸 {turn, step}；agent-loop finally 强制收口 |
| user/message | 用户/注入消息（surface） | source 携带 provenance（plugin/skill/model/tool） |
| assistant/chunk | 原始流 chunk（含 terminal finish chunk——finishReason 保留在 chunk 原文） | StreamChunk |
| assistant/message | 组装消息（surface） | usage + interrupted |
| tool/call / tool/result | 工具调用（原始 arguments 串）/ 结果（error + 工具私有 meta）（surface） | sourceEventSeqs=[callSeq] |
| **request/header** | 请求侧快照：EpochHeader（config + system + tools **全文**） | reason: initial/resume/change/series；结构等价去重 |
| **request/context** | 路由元数据（provider/model/contextWindow） | 仅变更时写 |
| session/end-seed | fork/resume 继承前缀分界 | 载荷为空，位置即时序承载语义 |

- 事件结构 `{type, seq, time, data, ignorable?}`；`surfaceOp`/`sourceEventSeqs` 是**类型级约束**，只允许出现在 surface 事件（user/message | assistant/message | tool/result）上（types.ts:455-467）。
- 插件经 `declare module` 合并扩展事件词汇（compaction、session/title、llm/retry…）；完整已知集合为生成式目录 `KNOWN_SESSION_EVENT_TYPES`（known-event-types.ts:22-74，52 类）+ `docs/persistence-catalog.md`。
- 前向兼容 fail-closed：`ignorable: true` 可被旧读者跳过；未标记的未知类型必须拒绝重建（storage-contract.ts:66-101 `validateStoredEvents`）。
- **注入（transient）落 surface**：agent.inject 的注入以完整 user/message 事件落盘，`Message.source` 携带 provenance（agent.ts:139-141→292）。
- **辅助调用走同一日志**：`session/title`、`session/title-llm-request`（**全量输入**，session-title-llm/src/index.ts:264）、`compaction/summary`（带 usage/provider/model）、`llm/retry`（llm-retry:188）；wire 请求带 `GenerateOptions.purpose` 标记。
- **媒体预算替换不落盘**：每次请求从持久化消息重推导（attachment/request-projection.ts）。

## 3. 写入端纪律（packages/core/agent-loop/src/agent.ts）

```
turn/start :264 → 每步 step/start :288 → user/message :292（surfaceOp:'append'）
  → assistant/chunk :368（chunkSeqs 累积）
  → assistant/message :418（usage + surfaceOp:'append' + sourceEventSeqs:chunkSeqs；abort 前缀 :376 interrupted:true）
  → tool/call :264 / tool/result :282（tool-calls.ts；中止补桩 appendSkippedToolCall :250-260）
  → step/end :301（finally）→ turn/end :328（finally，带 TurnEndReason）
```

- usage 流：adapter 流 → BlockAssembler（usage/finish chunk 聚糖，assembler.ts:85-90）→ assistant/message.usage。
- request/header :507-518：**每 step 组装当前 header 与基线做结构等价比较**（headerEquals，request-header.ts:44-54，纯字段逐项比较，非哈希）；无基线 → initial/resume；变化 → change + startsSeries；系列边界未变 → series；**未变化不写事件**。
- request/context :521-531：provider/model/contextWindow 与 `session.requestContext()` 不同才写。
- 重试：`llm/retry` 事件（llm-retry/src/index.ts:188）。

## 4. 持久化纪律（packages/session/session-persistence-jsonl）

seq 连续硬校验（gap=损坏，format.ts:440-453）/ torn-tail 截断 + zstd 残尾抢救（index.ts:499-503、608-630）/
zstd 帧 + 打包 chunk 行（逻辑物理解耦，chunk-rows.ts；打包收益为 "~56×" envelope 开销比）/ 写失败回滚 truncate 防重复 seq（index.ts:838-876）/
materialize 用 link()+unlink()（EEXIST 防并发覆盖，:709-749）+ 目录 fsync / stat-read-stat 稳定读（:535-552）/
200ms 写后批攒（storage.ts:34）/ 单写者 tracker / fail-closed 版本拒绝。

## 5. 查看器本体（packages/client/ui-trajectory，dsh 轨迹查看器）

- **纯消费者 view target**：六组 Definition + view builder 注册进 ui-conversation 引擎；数据来自 api-session-controller **推送的事件窗口**，不依赖 session-projection / session-query（inject 列表无二者）。
- `TrajectorySnapshot` {eventNodes, eventLocations, requests, callSchemas, partial, runningCalls}（trajectory-contract.ts:62-70）。
- **核心配对算法**（trajectory-snapshot-builder.ts:44-56）：按 **(turn, step)** 把 request/header 配到 assistant 请求；缺失时回退"最近且 seq 更早"的 header；promptChange 只挂首个请求（consumedPromptChanges）；callSchemas 按 callId 从当时 header 抓取（header.seq < call anchorSeq）。
- RequestView 契约（ui-conversation/request-inspection.ts:88-137）：`RequestViewBase`（startSeq/startedAt/completedAt/status/error/errorCode/requestConfig/usage/resultSeq）+ AssistantRequestView（turn/step/prompt/promptChange/retry/maxRetries/retryDelayMs）+ CompactionRequestView（replacementSeq/summary/rawOutput）。
- 中断语义：chunk 证据合成 interrupted assistant 节点（seq=boundary-0.9）；未闭合 tool/call → runningCalls；session-end 仍在跑的 compaction → error；turn-end 错误归拢该回合最后一个请求。
- UI：两列台账（Turn 分组 + **Request N 边界按钮** + kind 单元格：system/user/context/compacted/message/tool/subtool）+ 详情面板（SYSTEM: system-prompt/tools/diff；REQUEST: overview/options/usage/timing 含 TTFT；RECORD: input/output/source/schema）+ 客户端本地搜索索引（substring AND，按需重解析 markdown）+ Chrome-Network 风格 Timeline + @tanstack/react-virtual 虚拟化（固定行高模型、零高 Request 边界行并入内容行、锚底、"Load earlier history" 分页、挂载有界 ≤160 行）。
- e2e 契约：prepend 锚定漂移 ≤2px、流式期间 ≤5 次 scrollTo、图片与 Chat 共享 URL、2100 行冷开性能。

## 6. GuaDa 现状对照（已核验）

**已有（dsh 同款纪律）**：24 类 EventType 的 append-only JSONL + seq 连续/torn-tail/20MB 分卷/快照恢复/compaction 括号/turn-delete 遮蔽；统一 LLM seam（llm.service.ts:121 completions）+ purpose 标记 + usage 统一观测进 SQLite 账本；envelope 事件已预留（persistence/types.ts:24、Envelope :589-595、replayer 分支 :197-199）但**无写入者**；replayer fail-open（default: break）→ 新增 log-only 事件对旧读者零风险；closeToolPairing 补桩落库（surface≈wire）。

**缺口**：① 无调用级括号（只有 turn 级）② envelope 无写入者（systemText/tools/model 不落盘）③ 调用级 usage/finishReason/耗时不在日志 ④ 前端无轨迹查看器（无虚拟列表库）⑤ 辅助调用日志无痕 ⑥ 瞬态提醒 runtime-only。

## 7. 迁移实施方案（已批准，实施中）

### 总体决策

1. **JSONL 即轨迹**：不建独立 trace 文件；轨迹面板 = 事件日志的投影。
2. **三个新事件**（全部 log-only）：`envelope` 激活（对齐 request/header 语义）；`step/start`/`step/end` 显式括号——让辅助调用与失败尝试留痕、消除边界猜测、给调用级元数据锚点。
3. **IN 区不重建**：台账即 surface 时间线 + Request 边界行；媒体占位用 mediaOverlay 标注。
4. **OUT 区零新增**：assistant/message + tool/result 按 step 的 seq 区间归属。
5. **查看器形态对齐 dsh ui-trajectory**（台账 + Request 边界 + 详情面板三页签 + 搜索）；数据源走 GuaDa 惯例 REST 拉式投影。

### 分期

- **P0**：删除旧文档；本文档落盘。
- **P1 数据层**（~600 行 TS）：types.ts 增 `step/start|end` + StepStartData/StepEndData；`chat/step-recorder.ts`（幂等收口 + StepUnclosed 兜底 + 失败不阻断）；jsonl-session-context `appendEnvelopeIfNeeded`（每 step 一次对比：引用短路 → 字段级比较，未变不写；对比亚毫秒级，dsh 同款）；agent-engine 主循环插桩（builder 后 beginStep，closeToolPairing 后/空消息/overflow-continue 三路收口）；辅助调用 6 处 withStepBracket（fullInput 全量）；media-budget 增 omittedRefs → builder 映射 mediaOverlay；replayer 零改动。
- **P2 投影+REST**（~400 行 TS）：`modules/trajectory/trajectory.service.ts` 单遍重放（surface + envelope + step 栈 → IN=prevStepEnd+1..stepStart 切片 + transient；OUT=step 区间切片；requestId 分组重试；旧会话 steps:[]）+ `GET /api/v1/sessions/:sessionId/trajectory?limit=200`。
- **P3 前端台账核心**（~1000 行 Vue）：TrajectoryPanel/Ledger/DetailPanel/Cell + useTrajectory + trajectory.api；挂 ChatPage aside 页签行（:172-209）常显化；i18n trajectory 域；--gd-trajectory-* 配色。
- **P4 完整体验**（~600 行 Vue）：@tanstack/vue-virtual 虚拟化（零高边界行并组/锚底/行 key 稳定）；REQUEST timing 页签（TTFT，块级计时已有）；SYSTEM diff；子代理跳转（subagent_link）；Timeline 概览条可选。

### 与 dsh 的刻意差异

| 点 | dsh | GuaDa 取舍 | 理由 |
|---|---|---|---|
| 注入落盘 | surface user/message + source 溯源 | runtime-only，verbatim 随 step/start 记录 | GuaDa turn-reminder 每轮重收集，persist 变体已单独落库，进 surface 会污染历史 |
| finishReason | finish chunk 原文（assistant/chunk） | 放 step/end | GuaDa 不存 token 流；辅助调用无 assistant 消息 |
| usage 位置 | assistant/message.usage | step/end 统一 | 同上 |
| 重试 | llm/retry 事件 | attemptIndex + requestId 分组 | GuaDa 重试在 seam 内部，无需新事件 |
| 辅助调用 | 独立事件类型 | step 事件 + source 字段 | 复用既有 purpose，事件词汇更省 |
| 查看器数据源 | Definition 引擎推式 | REST 拉式投影 | 对齐 GuaDa 前端惯例（streamProjector/replayer） |

### 风险

envelope 体积（tools 全文，仅变更才写）；中止/断流括号闭合（记录器兜底 + 单测）；长会话性能（P3 content-visibility 先行、P4 虚拟化）；旧会话无 step（空态提示不伪造）。

## 8. 实施记录（2026-11-14 完成）

全部四期已落地，验证基线：backend `jest` 317 套件 / 4147 用例全绿；`tsc --noEmit` 通过；
frontend `vue-tsc` / `vitest` 1044 用例 / `vite build` 全绿；electron `tsc` 通过。

### P1 数据层（实际落点）

- 事件模型：`backend-ts/src/common/persistence/types.ts` — EventType 增 `step/start|step/end`；
  `StepSource`（与 UsageSource 同构 + `plugin:<id>`）、`StepStartData`、`StepEndData`、
  `StepMediaOverlayEntry`；envelope 接口不动（tools 全文，对齐 dsh）。
- 记录器：`backend-ts/src/modules/chat/step-recorder.ts`（新）— `beginStep`/`StepHandle`/
  `withStepBracket`；幂等收口 + StepUnclosed 兜底 + append 失败不阻断主链路；
  envelope 可选依赖（走会话 envelope 的调用才记录）。
- 存储层：`jsonl-message.service.ts` 增 `getEnvelope`/`appendEnvelope`/`appendStepStart`/
  `appendStepEnd`（IMessageStore 接口同步）。
- envelope 去重：`jsonl-session-context.ts` — `appendEnvelopeIfNeeded`（引用短路 → 字段级
  envelopeContentEqual → 变更才写；reason: initial/change；缓存从回放态播种）。
- 主循环：`agent-engine.service.ts` — builder 后 beginStep（transient verbatim）；
  正常/空消息/流异常三路在迭代末统一收口；overflow-continue 与外层 finally 各自兜底收口；
  retry 信号经 noteAttempt 透出 attemptIndex。
- 辅助调用 5 处：压缩摘要（stepWriter 经 options 注入，一个括号覆盖空文本重试序列）、
  标题（title 专用 writer，fullInput 全量）、记忆同步（每轮一括号，fullInput=影子 delta）、
  目标校验（fullInput 全量）、图片识别（ctx.session 注入；不记 fullInput——输入含内联 base64）。
- 媒体占位清单：`media-budget.ts` 增 `omittedRefs`；builder 映射 mediaOverlay 随 requestMedia 带出。

### P2 投影 + REST

- `backend-ts/src/modules/trajectory/`（新模块，已注册 app.module）：
  `trajectory.service.ts`（单遍重放 + step 配对 + unclosed 孤儿卡 + envelopes 历史 +
  limit 截最近 N 卡）、`trajectory.controller.ts`（GET /api/v1/sessions/:id/trajectory?limit=，
  上限 1000 缺省 200）、`trajectory.types.ts`（DTO）。

### P3/P4 前端

- `services/modules/trajectory.api.ts`（已注册 ApiService）+ `composables/useTrajectory.ts`
  （台账行派生：回合/辅助调用分组 + Request 编号 + IN/OUT 区间切片 + 搜索 AND 过滤 + prefix 区）。
- 组件 `components/chat/trajectory/`：TrajectoryPanel（汇总头 + SYSTEM 开关 + 台账）、
  TrajectoryLedger（双模式：≤100 行普通渲染 sticky 分组头；>100 行 @tanstack/vue-virtual
  动态计量虚拟化——dsh VIRTUALIZATION_THRESHOLD 同思路）、TrajectoryRow（单行三分支）、
  TrajectoryCell（角色徽标 + 单行摘要 + 展开全文 + 复制 + 媒体占位标注 + 子代理跳转 chip）、
  TrajectoryStepDetail（状态/usage/耗时/finishReason/重试/seq 窗口 + TTFT/生成时长/吞吐
  ——块级 timing 随 OUT 区 assistant 块带出）、TrajectorySystemSection（envelope 历史 +
  行级 LCS diff）。
- 挂载：**工作区侧边栏标签页**（`WorkspaceSidebar.vue` 统一标签体系，新增 `trajectory` 标签类型，
  `tabStore.openTrajectoryTab(sessionId, targetSessionId?)`；起始页常驻入口）。子代理跳转 = 打开
  子会话的轨迹标签（`targetSessionId` = 子会话 id）。展开状态存 Panel 层 Map（跨卸载存活）。
  注：曾尝试挂 ChatPage aside 页签行并常显化——改变了用户侧边栏布局，已还原 ChatPage 原状，
  迁移至工作区标签页方案（见 §10）。
- i18n：`locales/{zh-CN,en-US}/trajectory.ts` 新域；`style.css` 增 `--gd-trajectory-*`
  五色系明暗双套。

### 与计划的偏差记录

1. **插件通用 LLM seam（PluginLlmService）未插桩**：该服务是全局服务，调用天然无
   sessionId、无法归属到任何会话日志（v1 跳过；purpose=plugin:\<id\> 仍进 SQLite 账本）。
   后续如需，可扩展 PluginLlmCompleteOptions 让调用方（持有 ctx.session）传会话上下文。
2. **envelope reason 只用 initial/change**：dsh 的 resume/series 标记面向其 loop 实例
   语义；GuaDa 的 envelope 缓存由回放态播种，进程重启自然连续，无需额外标记。
3. **虚拟化阈值双模式**（对齐 dsh）：≤100 行普通渲染保留 sticky 分组头，>100 行虚拟化
   （sticky 在虚拟模式下不生效——translate 定位与 sticky 不兼容，dsh 大台账同样如此）。

### 验证方式（真机）

Electron dev 打开新会话 → 多轮对话（含工具调用/压缩/标题生成/子代理）→ 打开
「调用轨迹」页签：核对 Request 边界行的 usage/耗时/finishReason、IN/OUT 区间切片、
transient 注入行、辅助调用卡（标题/压缩/记忆）、错误路径收口、SYSTEM 快照 diff、
子代理工具行「查看轨迹」跳转。旧会话（轨迹上线前）显示不可用空态。

---

## 9. Token 字段收敛（2026-11-14 完成）

轨迹功能落地后复查发现 token 信息在日志内多处重复。经两框架全面分析（dsh 侧：usage 唯一载体 =
assistant/message.usage、turn/end 裸载荷、无占用快照事件、聚合全在 view 层；GuaDa 侧：枚举全部
消费方后确认多数字段为冗余或死写），按「同一事实只落一次；聚合读侧派生；投影快照认清定位；
锚点对必须有不可重建的理由才落盘」四原则收敛。

### 9.1 两框架对比矩阵

| 维度 | dsh | GuaDa（收敛前） | 判定 |
|---|---|---|---|
| provider usage 载体 | assistant/message.usage 唯一（agent.ts:418-427） | 主循环双写（assistant/message + step/end）+ SQLite 账本 | 日志内双写 → 收敛 |
| 回合级聚合 | turn/end 裸 {turn, reason}；view 层 deriveTurnTokenUsage/addUsage | turn/finish 落盘聚合（前端 TurnItem 实际自行聚合，turn.metadata.usage 为死写） | 冗余 → 删 |
| 占用快照事件 | 无；占用 = TokenMeter.measure 纯函数（锚点时刻表面价存内存 fold，可从日志重建） | context/stats 每请求一份 + turn/finish 一份 | context/stats = 拉式架构的投影快照（dsh 等价物 contextPressure projection + projection-cache），保留；turn/finish 份 = 同值冗余，删 |
| 占用计算核心 | measure: provider anchor + signed heuristic delta | computeTokenAccounting **已同构**（usage 锚点 / compaction 锚点 / 启发式回退三路径） | 已对齐，不动 |
| 压缩纠正锚点 | 不需要（fold 可重建） | compaction/end 的 usedTokens+heuristicTokens 锚点对 | 保留——折叠态不含被遮蔽区 token 记账，此锚点对不可从日志重建（结构性差异） |
| 影子价格 | shadowedTokenCount + O(1) 投影减法 | prune 系 prunedTokens | 同构，保留（唯一记录） |
| 前端占用环 | projection 推送 | useSessionTokenStats（SSE + 冷启动事件扫描） | 架构等价；锚点多源收敛为单源 |
| 账本 | telemetry 镜像不聚合；SQLite FTS 无 token 列 | _meta.db model_usage（purpose 维度） | 已裁决保留（聚合索引） |

### 9.2 实施内容

1. **主循环 step/end 不再写 usage**（agent-engine 收口处删字段；StepEndData 注释明确
   「仅辅助调用写」）。trajectory.service 投影合成：`step/end.usage ?? 括号内 assistant 消息
   metadata.usage`（单遍扫描顺带收集）——轨迹面板 usage 显示不受影响。
2. **turn/finish 瘦身**：TurnFinishData/TurnFinish 删 usage 聚合与 usedTokens/effectiveContextWindow/
   totalContextWindow/outputReserveTokens/messageCount/breakdown；保留 turnId/finishReason/
   totalDurationMs/errorDetail/modelName（回合事实）。finalizeTurnInternal/importTurnsInternal
   同步；finalizeTurn caller 不再预计算 getContextStats。
3. **导入路径占用锚点迁移**：Claude 导入等 importTurns 路径原先只靠 turn/finish.usedTokens
   承载占用——收敛为循环结束后统一写一条 context/stats（usedTokens 口径不变：provider 真值
   优先回退 surface 启发式；effectiveContextWindow 来自 opts）。
4. **前端消费方适配**：streamProjector turn/finish 分支删 usage 透传（旧日志字段刻意不读）；
   useSessionTokenStats 冷启动锚点源收敛为 context/stats（主）+ compaction/end（压缩后）。
5. **保留项（防止未来误删）**：context/stats 常规写入（投影快照，环形指示器实时+冷启动主锚点）；
   compaction/end 锚点对 + recordContextAnchor 修正锚点（computeTokenAccounting 依赖）；
   影子价格；账本；turn_end SSE 的 usage 直通（运行时通道不落盘，无漂移风险）。

### 9.3 明确不做

- meter fold 不移进 replayer（需要 token 估算进折叠核心 + 前端改 projection 拉取，回归风险高，
  收益仅省一个锚点对）。
- 不动账本与 SSE 运行时直通。

---

## 10. 挂载位置修正（2026-11-14，用户反馈）

用户反馈 aside 页签常显化改变了侧边栏布局。已 `git checkout` 完整还原 `ChatPage.vue`，
轨迹改为**工作区侧边栏标签页**：

- `usePreviewTabCache.ts`：UnifiedTab 类型增 `'trajectory'` + `targetSessionId?` 字段。
- `tab.ts`：`openTrajectoryTab(sessionId, targetSessionId?)`（key = `trajectory:<sessionId>`，
  每会话唯一；子代理跳转传 `targetSessionId` = 子会话 id）。
- `WorkspaceSidebar.vue`：标签图标（DataUsage20Regular）/ 标题（`chat.workspace.trajectoryTab`）/
  内容面板（`targetSessionId ?? sessionId`）/ 起始页入口（WorkspaceStartPage 增 `open-trajectory`）
  / 子代理跳转处理（`onOpenSubTrajectory` → 打开子会话轨迹标签）。
- `TrajectoryModule` 补 `imports: [AuthModule]`（AuthGuard 依赖 JwtService——与 usage/goal 模块同款）。

