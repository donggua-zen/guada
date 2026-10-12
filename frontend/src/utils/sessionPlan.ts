/**
 * 计划历史（计划模式产物）：列表刷新、生成中草稿、打开计划面板。
 *
 * 计划身份 = 提交它的 ExitPlanMode toolCallId；列表由后端从**转录**构建
 * （`GET /sessions/:id/plans`，含待审/已批/被拒状态与正文），不依赖文件系统——
 * `.guada/plans/<sessionId>/<planId>.md` 只是落盘副本（文件树可见 + 压缩后重注入）。
 *
 * 动态 import ApiService：本模块被 streamProjector 调用（plan_mode_changed / turn_end
 * 触发刷新），静态导入会构成 streamProjector → ApiService → streamProjector 循环，
 * 动态导入把依赖推迟到调用时（与 browserViewport.loadBrowserSettings 同一手法）。
 */
import { nextTick } from 'vue'
import { useSessionStore } from '@/stores/session'
import { useTabStore } from '@/stores/tab'
import { getRendererArgs, getToolArgs, getToolRenderer, resolvePlanCardStatus, type PlanCardStatus, type ToolCall } from '@/utils/toolDisplay'
import type { SessionPlanItem } from '@/types/session'

/** 同会话在途请求：并发调用复用同一个 Promise，不重复打接口 */
const inFlight = new Map<string, Promise<SessionPlanItem[] | undefined>>()

/**
 * 拉取并缓存计划列表（最近在前）。
 * 失败静默——消费方按空列表处理，不打断交互。
 * 同会话并发调用合并为一次请求：批准计划时 plan_mode_changed 与 turn_end 会在同一回合
 * 各触发一次刷新，多个窗口同时收到同一帧时也一样；后到者复用先到者的结果。
 * 合并窗口只覆盖"请求在途"这段时间，不引入 TTL——面板打开/手动刷新始终能拿到新数据。
 */
export function refreshSessionPlans(
    sessionId: string,
): Promise<SessionPlanItem[] | undefined> {
    if (!sessionId) return Promise.resolve(undefined)
    const pending = inFlight.get(sessionId)
    if (pending) return pending
    const task = fetchAndCachePlans(sessionId).finally(() => {
        inFlight.delete(sessionId)
    })
    inFlight.set(sessionId, task)
    return task
}

/** 实际拉取并写缓存；失败静默返回 undefined（不 reject，保证在途 Promise 可被后续调用安全复用） */
async function fetchAndCachePlans(
    sessionId: string,
): Promise<SessionPlanItem[] | undefined> {
    try {
        const { apiService } = await import('@/services/ApiService')
        const { plans } = await apiService.fetchSessionPlans(sessionId)
        useSessionStore().setSessionPlans(sessionId, plans)
        return plans
    } catch {
        return undefined
    }
}

/**
 * 打开计划面板（右侧工作区标签）：先把工作区侧栏打开，再刷新缓存，最后打开/激活面板标签。
 *
 * 必须显式打开侧栏：侧栏是 `v-if="workspaceVisible && mainSession"`，而 workspaceVisible
 * 按会话存、默认 false——关着的时候"打开标签"只改了 tab store，界面上什么都没发生，
 * 用户看到的就是点了没反应。仓内其它从聊天区开侧栏的入口都是这个序列
 * （workspacePreview.previewFile / ChatPage 子代理 / TurnItem diff / OverviewPanel git）。
 * 侧栏是懒挂载，从关到开要多等一帧，否则 openPlanTab 落进还没渲染的侧栏。
 *
 * 面板常驻可开（有无计划都可进入，空态提示"暂无计划"）。
 */
export async function openSessionPlanPanel(sessionId: string): Promise<void> {
    if (!sessionId) return
    // 动态 import 布局 store：它静态依赖 useTheme（模块级读 window.matchMedia），
    // 静态导入会把 window 依赖带进本模块的所有消费方，也直接打挂 node 环境的纯函数单测
    const { useLayoutStore } = await import('@/stores/layout')
    const layoutStore = useLayoutStore()
    const wasVisible = layoutStore.workspaceVisible
    layoutStore.setWorkspaceVisible(true)
    await refreshSessionPlans(sessionId)
    if (!wasVisible) await nextTick()
    useTabStore().openPlanTab(sessionId)
}

// ─── 生成中的计划草稿 ───
// 面板读的 sessionPlans 来自后端对**已落库转录**的解析，而 ExitPlanMode 的参数要等 LLM 流结束、
// assistant 消息落库之后才进转录。所以"正文正在写"这段里，计划正文的唯一副本是消息树里
// tool-call 的半截 arguments（流内卡片预览正是这么渲染的）。这里把它挖出来给面板用：
// 不新增请求、不扩持久化字段、不加接口。

/** 生成中的计划草稿：args 里已能解析出正文、但还没进持久化列表的那一份 */
export interface PlanDraft {
    /** = ExitPlanMode 的 toolCallId（与落库后的 planId 同一个）→ 落库后按同一 id 无缝交接 */
    planId: string
    content: string
    /** args 还没写完（严格 JSON 解析失败）= 正文仍在增长 */
    streaming: boolean
    /** 工具已有终态（中断/失败等）时带出徽标；执行中为 undefined */
    status?: PlanCardStatus
}

/** args 是否已写完。严格 JSON 能解析才算完——partial-json 对半截也成功，不能用它判 */
function isArgsComplete(tool: ToolCall): boolean {
    const raw = getToolArgs(tool)
    if (typeof raw !== 'string') return true
    try {
        JSON.parse(raw)
        return true
    } catch {
        return false
    }
}

/**
 * 纯函数：从工具调用里挑出"尚未落库的计划草稿"。
 * 条件 = plan 渲染器 + 有 toolCallId + 能从 args 解析出非空正文 + planId 不在已落库列表中；
 * 多条命中时取最后一条（最新）。取正文复用渲染器那套解析，与卡片预览同一份结果。
 */
export function pickPlanDraft(
    toolCalls: readonly ToolCall[],
    persistedIds: ReadonlySet<string>,
): PlanDraft | undefined {
    for (let i = toolCalls.length - 1; i >= 0; i--) {
        const tool = toolCalls[i]
        const renderer = getToolRenderer(tool)
        if (renderer?.kind !== 'plan') continue
        const planId = tool.id
        if (!planId || persistedIds.has(planId)) continue
        const content = getRendererArgs(tool, renderer)?.content
        if (!content) continue
        return {
            planId,
            content,
            streaming: !isArgsComplete(tool),
            // 未落库时拿不到工具结果里的 planApproved，只按 outcome 出徽标（中断/失败可见）
            status: resolvePlanCardStatus(tool.outcome, undefined),
        }
    }
    return undefined
}

/** 从会话回合树里按出现顺序收集全部工具调用（toolCalls 挂在块的 metadata 上，与渲染层同源） */
function collectToolCalls(sessionId: string): ToolCall[] {
    const turns = useSessionStore().getTurns(sessionId) ?? []
    const out: ToolCall[] = []
    for (const turn of turns) {
        for (const message of turn.messages ?? []) {
            for (const block of message.blocks ?? []) {
                const list = (block.metadata as { toolCalls?: ToolCall[] } | undefined)?.toolCalls
                if (Array.isArray(list)) out.push(...list)
            }
        }
    }
    return out
}

/**
 * 取该会话"尚未落库"的计划草稿。已落库的一律以持久化列表为准——两边都命中时草稿让位，
 * 所以面板不会出现重复条目，落库瞬间也不会闪空（选中项按同一个 planId 交接）。
 */
export function findPlanDraft(sessionId: string): PlanDraft | undefined {
    if (!sessionId) return undefined
    const persisted = new Set(
        (useSessionStore().sessionPlans(sessionId) ?? []).map((p) => p.planId),
    )
    return pickPlanDraft(collectToolCalls(sessionId), persisted)
}
