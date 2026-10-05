/**
 * 计划历史（计划模式产物）：列表刷新与打开计划面板。
 *
 * 计划身份 = 提交它的 ExitPlanMode toolCallId；列表由后端从**转录**构建
 * （`GET /sessions/:id/plans`，含待审/已批/被拒状态与正文），不依赖文件系统——
 * `.guada/plans/<sessionId>/<planId>.md` 只是落盘副本（文件树可见 + 压缩后重注入）。
 *
 * 动态 import ApiService：本模块被 streamProjector 调用（plan_mode_changed / turn_end
 * 触发刷新），静态导入会构成 streamProjector → ApiService → streamProjector 循环，
 * 动态导入把依赖推迟到调用时（与 workspacePreview.loadLinkOpenMode 同一手法）。
 */
import { useSessionStore } from '@/stores/session'
import { useTabStore } from '@/stores/tab'
import type { SessionPlanItem } from '@/types/session'

/**
 * 拉取并缓存计划列表（最近在前）。
 * 失败静默——消费方按空列表处理，不打断交互。
 */
export async function refreshSessionPlans(
    sessionId: string,
): Promise<SessionPlanItem[] | undefined> {
    if (!sessionId) return undefined
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
 * 打开计划面板（右侧工作区标签）：先刷新缓存保证列表最新，再打开/激活面板标签。
 * 面板常驻可开（有无计划都可进入，空态提示"暂无计划"）。
 */
export async function openSessionPlanPanel(sessionId: string): Promise<void> {
    if (!sessionId) return
    await refreshSessionPlans(sessionId)
    useTabStore().openPlanTab(sessionId)
}
