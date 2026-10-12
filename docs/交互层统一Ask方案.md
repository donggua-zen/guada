# 交互层统一 Ask 方案（审批 / 询问 / 迭代暂停）

> 状态:已实施完成
> 日期:2026-08-29
> 范围:后端(backend-ts)+ 前端(frontend)。新架构,零兼容(旧 approval 体系整体移除)。
> 取代:docs/design/approval-flow.md(工具审批 v1.9 体系)
>
> **修订 2026-10-05：移除第三种 kind `'continue'`（迭代暂停）。**
> 触发：核实 [zai-org/ZCode](https://github.com/zai-org/ZCode) 后确认其**主交互循环不设轮次上限**
> （`runRegularTurnLoop` 是 `while(true)`，仅由用户中止或"模型不再调用工具"退出；
> `error_max_turns` 等值只有类型声明、无任何生产者），而本项目的"最大工具调用轮次"上限
> 会打断长任务，故一并砍掉——上限、暂停、设置项、UI 全部移除。
> 保留的是机制本身：`kind` 词表现为 `'approval' | 'ask'`，`ask`/`requestApproval` 服务、
> `SessionCards` 卡片、无超时等待原语均不变（审批与未来的 ask_user 工具继续使用）。
> 注：ZCode 用**不打断的提醒**代替上限——同一工具+同一入参连续调用 3 次注入一条
> "别重复调用"提醒（`model-anomaly.ts`），另有工具调用总量提醒、每回合最多 3 条。
> 本项目暂未引入，如需防护卡死循环可后续对齐。

## 一、需求(定稿)

1. **无超时**彻底废弃 fail-closed 自动拒绝。交互只有三种终结——用户应答、用户停止(abort)、重启丢表(应答端点 404,不做兜底)。
2. **工具自主发起两个动作**`ask`(询问:多问题、单选/多选、自定义回复)与 `requestApproval`(审批便捷方法)。
3. **审批是 ask 的特例**预置单问题(同意/拒绝)+ 支持自定义回复(语义=拒绝+用户文本反馈给模型)。
4. ~~**迭代暂停统一进 Ask**(决策确认):max_iterations 卡 = 系统发起的 ask(kind='continue'),删除 iteration_paused 事件与 /continue 端点。~~
   → **已于 2026-10-05 随轮次上限一并移除**（见头部修订说明；ZCode 主循环不设上限）。

## 二、核心数据模型

```ts
interface AskOption { label: string; description?: string }
interface AskQuestion { id: string; question: string; detail?: string;
                        options: AskOption[]; multiSelect?: boolean } // 缺省单选
interface AskAnswerItem { id: string; selected: string[]; custom?: string }
type AskKind = 'approval' | 'ask';   // 'continue' 已于 2026-10-05 移除
interface AskRequest { kind; title?; toolCallId?; toolName?; questions: AskQuestion[] }
```

DSH 对照:`AskUserQuestionItem`(user-questions/src/types.ts:35-50)同构;差异:DSH 审批与提问是两个并行服务(approval waterfall / question provider),本项目按需求统一为一个 AskService,审批即预置问题的 ask;DSH question 无持久审计,本项目统一带 ask/asked|answered 审计对。

## 三、架构与数据流

```
工具 handler / 引擎(深层,经 DI 注入 AskService)
  └─ askService.ask(session, request, abortSignal?)
       ├─ appendAskAsked → JSONL ask/asked(审计,先入库后发事件)
       ├─ publishStream → ask_requested 帧(eventBuffer 可重放 + SSE 直投,prevSeq 组装)
       ├─ InteractionWaitService.waitForAnswers(requestId) ←─┐
       │ (无超时,仅与 abortSignal 竞速;abort → cancel + cancelled 审计/帧 + AskDeniedError)
       └─ appendAskAnswered → JSONL ask/answered(每次 asked 必有 answered,cancelled 标记)
         publishStream → ask_resolved 帧(多窗口同步收卡;答案不广播) ──┘
                                                    │
前端卡片(输入区上方,SessionCards.vue) │
  └─ 点击选项/填写自定义回复 → POST /chat/respond │
       { sessionId, requestId, answers } ─────────────┘
         (无等待者 404;answers 与 questions 校验不符 400)
```

- **拒绝/取消反馈模型**`AskDeniedError { outcome:'rejected'|'cancelled', feedback? }` 由
  ToolExecutor catch 特判——isError tool-result content = `feedback || message`,自定义回复直达模型。
- **审批 = ask 特例**`requestApproval(session, {toolCallId, toolName, detail, abortSignal})`
  = 预置问题「是否同意?」(同意/拒绝)+ 解释器:同意→返回;拒绝→抛 AskDeniedError('rejected');
  自定义→抛 AskDeniedError('rejected', feedback=用户文本)。
- **执行许可审批**（命令策略 / 工作区外文件写入）= requestCommandApproval / requestWriteApproval
  （命令卡四选项：本次允许 / **放通此类·本项目** / **放通此类·全局** / 拒绝——「放通此类」把服务端
  推导出的前缀规则写进 `policy.yaml`；文件写入卡三选项：本次允许 / 本会话内始终允许该路径 / 拒绝；
  两处均无人应答 fail-closed）。
  ~~**沙盒提权** = 插件侧组合:parseEscalationArgs/assertStrictlyWider + requestApproval + one-shot 放宽~~
  → **已移除**(2026-10)：模型不能自我提权，能力放宽只由用户在审批卡上授予，或用户自行切换档位。
- ~~**迭代暂停** = 引擎发起 kind='continue' 的 ask(继续执行/停止);停止/自定义/取消 → user_cancel。~~
  → **已移除**(2026-10-05，随轮次上限)。

## 四、端点与事件词表

| | 新(本方案) | 旧(已删除) |
|---|---|---|
| 应答端点 | `POST /chat/respond {sessionId, requestId, answers}` | ~~POST /chat/approve~~、~~POST /chat/stream/:id/continue~~ |
| 流帧 | `ask_requested {requestId, kind, title?, toolCallId?, toolName?, questions}`、`ask_resolved {requestId, outcome}` | ~~approval_requested~~、~~iteration_paused~~ |
| SSE method | `stream/ask_requested`、`stream/ask_resolved` | ~~stream/approval_requested~~、~~stream/iteration_paused~~ |
| 审计事件 | `ask/asked {requestId, kind, title?, questions}`、`ask/answered {requestId, answers?, cancelled?}` | ~~approval/asked~~、~~approval/decided~~ |
| 等待原语 | InteractionWaitService(单 kind,无 timer) | ~~ApprovalWaitService(decision+signal 双 kind+timer)~~ |
| 超时 | **无** | ~~ESCALATION_TIMEOUT_MS / expiresAt / fail-closed~~ |

## 五、前端统一询问卡(SessionCards.vue)

- 头部:kind 徽标(approval=需要审批 / ask=需要你的输入)+ title + 工具名 chips。
  ~~continue=已达到最大轮次~~(2026-10-05 随轮次上限移除)。
- 问题分页 `i/N`:**单选点选即自动翻页**(末页提交);**多选勾选后点"下一步/提交"**。
- 选项按钮 A/B/C…(label 即答案);末位固定"请输入自定义回复"→ 切换输入框(单选与 selected 互斥,多选附加)。
- 提交:`apiService.respond(sessionId, requestId, answers)`(按问题单顺序逐 id 对应);卡片由 ask_resolved 清除。
- store:`SessionState.pendingAsk`(单槽,会话内工具串行天然互斥);projector:ask_requested→set、
  ask_resolved/tool_calls_response/turn_end→清。

> **布局修订 2026-10-05（用户评审驱动，对齐 ZCode）**：卡片是会话级底部 dock（`ChatPanel` 的
> `.chat-input-area`，sticky 贴底）的一员——**待答期间整块输入区隐藏、卡片全宽顶替其位置**：
> 编辑提示条 / `ChatInput` / `WorkingDirBar` 三件同时 `display:none`（`v-show` 保持挂载，
> 草稿与编辑器状态不丢；对齐 ZCode `ConversationComposer` 的 `display:none + aria-hidden` 做法），
> 输入区不做"变暗/禁用"。卡片限高 `min(60vh, 32rem)` 内部滚动（对齐 ZCode 对话框
> `max-h-[min(72dvh,42rem)]`），保证弹窗永不超出视口。**自定义回复仍走卡片内输入框**，
> 不接 composer（"composer 输入 = 自定义回复"是后续议题，见用户 2026-10-05 备注）。
> 附带：计划审批（ExitPlanMode）**不在卡内渲染计划正文**——计划正文在流内计划卡
> （随消息滚动），完整文档从那里打开工作区计划面板；卡片只留问题与选项。

> **交互修订 2026-10-05（第二轮，用户评审驱动，对齐 ZCode 对话框截图的防误触版）**：
> 取代上面"单选点选即翻页/提交、末位选项点开自定义输入框"的旧交互——
> - **单击选项 = 仅选中**（不提交、不翻页；单选点选即覆盖选中并清空自定义输入；多选切换勾选）；
>   **双击选项 = 选中并提交**（防误触），也可点常驻的「提交」。
> - **自定义回复行常驻**（编号接在选项后，如 `3. 输入你的回答…`）：直接输入即作答，无需先点开；
>   单选与选项互斥、多选为附加，清空即撤销；输入框内回车 = 主操作。
> - **翻页只走右上箭头** `‹ i/N ›`（单页为禁用态）+ 中间页主按钮「下一步」；选项编号 A/B/C → 1./2.。
> - **页脚常驻**：「忽略」+ 主操作，附键盘提示「使用上下键移动选取，回车提交」（**不写 Tab**：
>   用户指出 Tab 与上下键实际行为不同——Tab 只移焦点、上下键移动选取，混在一句话里有歧义）。
> - **键盘 = 移动选取框，不是移动焦点**（2026-10-05 用户实测 ZCode 后校正；ZCode 文案"回车或空格选中"
>   的"选中"实为**直接提交**，其上下键移动的是选取框）：
>   **上下键移动即选**（单选：移到选项行即选中该行，移到输入行只落焦点、不改选取；多选只移动光标，
>   空格再勾选）；**回车 = 提交**（末页提交/中间页下一步；当前题没有任何选取与自定义输入时空转，防误触，
>   输入法组合中的回车不算）；Tab/空格保留按钮原生行为。~~焦点样式与选取样式分离但都走主色：
>   选取 = 主色描边 + 浅底，光标 = 仅主色描边（细一档，不叠环）。~~（2026-10-08 删除焦点描边，见下）
> - **焦点接管**（同日用户报障"按上下键/Tab 没反应"后补齐）：卡片出现与翻页后**自动把焦点交给首个选项**
>   （仅当焦点无主——body/已失效——或仍停在即将隐藏的输入区时接管，不抢用户别处的焦点）；键处理挂在**整卡**上
>   （焦点在页脚/分页器上也能落回列表）。报障根因有两条：卡片出现时焦点还在 body（键自然没反应），
>   且全局 `* { outline: none !important }` 禁用了原生焦点环（焦点动了也看不见）→ 卡片**自绘焦点指示**
>   （用 box-shadow/边框色，不能用 outline，会被全局 `!important` 盖掉）。
>   **变量纪律**：卡片样式只用 `--gd-*`，不得直接引用 `--el-*`（`--el-*` 由 `style.css` 从 `--gd-*` 桥接；
>   如 `--el-color-primary-light-9` 的对应物是 `--gd-color-primary-100`）。
> - **「忽略」= 不回答并停止当前轮**：复用停止按钮的取消路径
>   （`ChatPanel.abortResponse` → `POST /chat/stream/:id/stop`）。后端只有"用户停止"能终结一次待答
>   （`AskDeniedError('cancelled')`），不存在"dismiss 后仍等待"的语义；而待答期间输入区已隐藏，
>   这也是用户此刻唯一的停止入口。
> - **计划审批卡不显示工具名徽标**（2026-10-05 用户要求）：标题已说明来意，`ExitPlanMode`
>   对用户是噪音；其它工具的询问/审批卡仍保留工具名便于辨认。

> **焦点样式修订 2026-10-08（用户报障：聚焦边框被误读为"已选择"）**：删除卡片自绘的焦点描边
> （`.ask-option:focus` / `.ask-option-input:focus-within` 的主色边框）——**主色边框只表示选中**
> （`.ask-option-active`：主色描边 + 浅底）。旧规则下自动聚焦首个选项（见上"焦点接管"）会让
> 无默认选择时首行也描主色边，与选中只差底色，故被误读。自动聚焦保留（键处理挂在整卡上，
> 焦点在卡外则键盘失灵），只是焦点不再绘制：单选上下键移动即选、选中态自带反馈，
> 输入行靠光标与输入后的选中态反馈；分页器与「忽略/提交」按钮的焦点 box-shadow 不变。
> 全局 `* { outline: none !important }` 仍禁原生焦点环，此处刻意不再自绘（多选为未启用能力，
> 将来启用需另配不与选中撞色的光标指示）。

## 六、验证(2026-08-29)

- 后端 `tsc --noEmit` 0 错;全量测试除 5 个已知存量/环境失败外全绿
  (新增 ask.service 6 用例 + interaction-wait 3 用例 + respond 端点 7 用例;引擎 19/19)
- 旧词残留 grep 为 0:expiresAt/ESCALATION_TIMEOUT/approval_requested/iteration_paused/
  approval/asked/ApprovalDeniedError/waitForDecision/pauseId/approvalId 全部清除
- 前端 vitest 37 通过(含 ask_requested/ask_resolved 折叠用例);vue-tsc 24 个存量错误,基线不变
