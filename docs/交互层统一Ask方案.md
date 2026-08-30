# 交互层统一 Ask 方案（审批 / 询问 / 迭代暂停）

> 状态:已实施完成
> 日期:2026-08-29
> 范围:后端(backend-ts)+ 前端(frontend)。新架构,零兼容(旧 approval 体系整体移除)。
> 取代:docs/design/approval-flow.md(工具审批 v1.9 体系)

## 一、需求(定稿)

1. **无超时**:彻底废弃 fail-closed 自动拒绝。交互只有三种终结——用户应答、用户停止(abort)、重启丢表(应答端点 404,不做兜底)。
2. **工具自主发起两个动作**:`ask()`(询问:多问题、单选/多选、自定义回复)与 `requestApproval()`(审批便捷方法)。
3. **审批是 ask 的特例**:预置单问题(同意/拒绝)+ 支持自定义回复(语义=拒绝+用户文本反馈给模型)。
4. **迭代暂停统一进 Ask**(决策确认):max_iterations 卡 = 系统发起的 ask(kind='continue'),删除 iteration_paused 事件与 /continue 端点。

## 二、核心数据模型(对齐 DSH user-questions)

```ts
interface AskOption { label: string; description?: string }
interface AskQuestion { id: string; question: string; detail?: string;
                        options: AskOption[]; multiSelect?: boolean }  // 缺省单选
interface AskAnswerItem { id: string; selected: string[]; custom?: string }
type AskKind = 'approval' | 'ask' | 'continue';
interface AskRequest { kind; title?; toolCallId?; toolName?; questions: AskQuestion[] }
```

DSH 对照:`AskUserQuestionItem`(user-questions/src/types.ts:35-50)同构;差异:DSH 审批与提问是两个并行服务(approval waterfall / question provider),本项目按需求统一为一个 AskService,审批即预置问题的 ask;DSH question 无持久审计,本项目统一带 ask/asked|answered 审计对。

## 三、架构与数据流

```
工具 handler / 引擎(深层,经 DI 注入 AskService)
  └─ askService.ask(session, request, abortSignal?)
       ├─ appendAskAsked      → JSONL ask/asked(审计,先入库后发事件)
       ├─ publishStream       → ask_requested 帧(eventBuffer 可重放 + SSE 直投,prevSeq 组装)
       ├─ InteractionWaitService.waitForAnswers(requestId)   ←─┐
       │    (无超时,仅与 abortSignal 竞速;abort → cancel + cancelled 审计/帧 + AskDeniedError)
       └─ appendAskAnswered   → JSONL ask/answered(每次 asked 必有 answered,cancelled 标记)
         publishStream       → ask_resolved 帧(多窗口同步收卡;答案不广播) ──┘
                                                    │
前端卡片(输入区上方,SessionCards.vue)                 │
  └─ 点击选项/填写自定义回复 → POST /chat/respond      │
       { sessionId, requestId, answers } ─────────────┘
         (无等待者 404;answers 与 questions 校验不符 400)
```

- **拒绝/取消反馈模型**:`AskDeniedError { outcome:'rejected'|'cancelled', feedback? }` 由
  ToolExecutor catch 特判——isError tool-result content = `feedback || message`,自定义回复直达模型。
- **审批 = ask 特例**:`requestApproval(session, {toolCallId, toolName, detail, abortSignal})`
  = 预置问题「是否同意?」(同意/拒绝)+ 解释器:同意→返回;拒绝→抛 AskDeniedError('rejected');
  自定义→抛 AskDeniedError('rejected', feedback=用户文本)。
- **沙盒提权** = 插件侧组合:parseEscalationArgs/modeOfRunMode/assertStrictlyWider
  (sandbox-policy.ts 纯函数)+ requestApproval(detail=提权请求)+ sandboxForMode 放行(one-shot)。
- **迭代暂停** = 引擎发起 kind='continue' 的 ask(继续执行/停止);停止/自定义/取消 → user_cancel。

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

- 头部:kind 徽标(approval=需要审批 / ask=需要你的输入 / continue=已达到最大轮次)+ title + 工具名 chips。
- 问题分页 `i/N`:**单选点选即自动翻页**(末页提交);**多选勾选后点"下一步/提交"**。
- 选项按钮 A/B/C…(label 即答案);末位固定"请输入自定义回复"→ 切换输入框(单选与 selected 互斥,多选附加)。
- 提交:`apiService.respond(sessionId, requestId, answers)`(按问题单顺序逐 id 对应);卡片由 ask_resolved 清除。
- store:`SessionState.pendingAsk`(单槽,会话内工具串行天然互斥);projector:ask_requested→set、
  ask_resolved/tool_calls_response/turn_end→清。

## 六、验证(2026-08-29)

- 后端 `tsc --noEmit` 0 错;全量测试除 5 个已知存量/环境失败外全绿
  (新增 ask.service 6 用例 + interaction-wait 3 用例 + respond 端点 7 用例;引擎 19/19)
- 旧词残留 grep 为 0:expiresAt/ESCALATION_TIMEOUT/approval_requested/iteration_paused/
  approval/asked/ApprovalDeniedError/waitForDecision/pauseId/approvalId 全部清除
- 前端 vitest 37 通过(含 ask_requested/ask_resolved 折叠用例);vue-tsc 24 个存量错误,基线不变
