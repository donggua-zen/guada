/**
 * 工作流运行进度数据层（会话级缓存 + 单一常驻订阅）
 *
 * 数据双源（方案 B，进度不落 JSONL）：REST 快照（GET sessions/:id/workflow/runs）
 * 为基线，workflow_event SSE 为实时增量；两源喂 services/modules/workflowRuns.ts
 * 的同一 reducer，按 run 内 seq 幂等收敛到同一 WorkflowRunState。
 *
 * 为什么上收到 store（而不是各消费方各拉一次）：
 * - 消费方不止面板：对话流内在 workflow_run 工具调用处原地渲染的卡片随回合树条件渲染、
 *   数量不定，要求"事件到达即推进"——订阅不能随某个面板的挂载启停
 *   （同 BrowserWebviewLayer 收口 browser store→tabStore 同步的教训）。
 * - 基线合并必须按 lastSeq 防回退（事件先到、快照后到是刷新时的常态），
 *   单点实现才不会有多种合并口径。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { apiService } from '@/services/ApiService'
import { applyWorkflowEvent, sortWorkflowRuns } from '@/services/modules/workflowRuns'
import { streamEventHub, type HubStreamEvent } from '@/services/modules/StreamEventHub'
import type { WorkflowRunState } from '@/types/stream/workflow.types'

/** run-end 后补拉基线的去抖：终态归档与 result 只在快照里（run-end 事件不携带 result） */
const RESULT_REFRESH_DELAY_MS = 300

export const useWorkflowRunsStore = defineStore('workflowRuns', () => {
  /** 按会话缓存的 run 列表（响应式：内联卡片 computed 直接读） */
  const runsBySession = ref<Record<string, WorkflowRunState[]>>({})
  /**
   * 已落地过 REST 基线的会话（ensureLoaded 幂等 + 外部观察加载状态）。
   * 卡片侧不需要它做回退判定：绑不到 run 时卡片自己按工具结果出终态（见内联卡片）。
   */
  const loadedSessions = ref<Set<string>>(new Set())
  /** 基线请求在途（审阅面板加载态判定用） */
  const pendingSessions = ref<Set<string>>(new Set())

  /** 在途基线请求（同会话去重：多次 ensureLoaded 共享一次请求） */
  const inFlight = new Map<string, Promise<void>>()
  /** run-end 后的补拉定时器（会话 → timer） */
  const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>()
  let unsubscribe: (() => void) | null = null

  function sessionRuns(sessionId: string): WorkflowRunState[] {
    return (runsBySession.value[sessionId] ??= [])
  }

  // ── 订阅（懒建、常驻：建立后不随消费方卸载撤销）──

  function ensureSubscribed(): void {
    if (unsubscribe) return
    unsubscribe = streamEventHub.subscribeAll(onStreamEvent)
  }

  function onStreamEvent(chunk: HubStreamEvent): void {
    if (chunk.type !== 'workflow_event') return;
    const sessionId = chunk.sessionId;
    if (!sessionId) return;
    // 原位应用（响应式 mutation 驱动 computed 重排）。未加载会话也照收：局部态可能缺
    // 前半段事件，但 REST 基线必然带不低于它的 lastSeq（服务端快照先更新后广播），
    // 基线落地时按 lastSeq 规则整体修正。
    const applied = applyWorkflowEvent(sessionRuns(sessionId), chunk.event)
    if (applied && chunk.event.kind === 'run-end') scheduleResultRefresh(sessionId)
  }

  // ── 基线加载 / 合并 ──

  /**
   * 基线合并：快照按 lastSeq 取高者（事件先到时不能回退已推进的本地态）；
   * 只覆盖快照里明确有值的字段——旧归档缺字段（如 toolCallId）时保留本地已推进的值。
   */
  function mergeBaseline(sessionId: string, incoming: WorkflowRunState[]): void {
    const list = sessionRuns(sessionId)
    for (const snap of incoming) {
      const existing = list.find((r) => r.runId === snap.runId)
      if (!existing) {
        list.push(snap)
        continue
      }
      if (snap.lastSeq < existing.lastSeq) continue
      for (const [key, value] of Object.entries(snap)) {
        if (value !== undefined) {
          (existing as unknown as Record<string, unknown>)[key] = value
        }
      }
    }
  }

  function startLoad(sessionId: string): Promise<void> {
    pendingSessions.value.add(sessionId)
    const promise = apiService
      .getWorkflowRuns(sessionId)
      .then((res) => {
        mergeBaseline(sessionId, res.runs || [])
      })
      .catch(() => {
        // 端点不可用（旧后端/无运行记录）→ 静默置空；仍标记已加载，避免加载态永久停留
      })
      .finally(() => {
        pendingSessions.value.delete(sessionId)
        loadedSessions.value.add(sessionId)
        inFlight.delete(sessionId)
      })
    inFlight.set(sessionId, promise)
    return promise
  }

  /** 确保会话基线已加载（幂等：已加载或在途直接返回） */
  function ensureLoaded(sessionId: string): Promise<void> {
    ensureSubscribed()
    if (!sessionId || loadedSessions.value.has(sessionId)) return Promise.resolve()
    return inFlight.get(sessionId) ?? startLoad(sessionId)
  }

  /** 强制重取基线（run-end 补拉 result / 手动刷新） */
  function refresh(sessionId: string): Promise<void> {
    ensureSubscribed()
    if (!sessionId) return Promise.resolve()
    return inFlight.get(sessionId) ?? startLoad(sessionId)
  }

  function scheduleResultRefresh(sessionId: string): void {
    const timer = refreshTimers.get(sessionId)
    if (timer !== undefined) clearTimeout(timer)
    refreshTimers.set(
      sessionId,
      setTimeout(() => {
        refreshTimers.delete(sessionId)
        void refresh(sessionId)
      }, RESULT_REFRESH_DELAY_MS),
    )
  }

  // ── 读取 ──

  /** 会话的 run 列表（运行中在前、完成后按结束时间倒序） */
  function getSessionRuns(sessionId: string): WorkflowRunState[] {
    return sortWorkflowRuns(runsBySession.value[sessionId] ?? [])
  }

  /** 按触发它的工具调用 id 找 run（内联卡片绑定用；toolCallId 全局唯一，跨会话查找） */
  function findRunByToolCallId(toolCallId: string): WorkflowRunState | null {
    if (!toolCallId) return null
    for (const list of Object.values(runsBySession.value)) {
      const hit = list.find((r) => r.toolCallId === toolCallId)
      if (hit) return hit
    }
    return null
  }

  function isLoaded(sessionId: string): boolean {
    return loadedSessions.value.has(sessionId)
  }

  function isPending(sessionId: string): boolean {
    return pendingSessions.value.has(sessionId)
  }

  /** 会话删除/清空记录时清理缓存（避免陈旧 run 悬挂） */
  function clearSession(sessionId: string): void {
    delete runsBySession.value[sessionId]
    loadedSessions.value.delete(sessionId)
    pendingSessions.value.delete(sessionId)
    const timer = refreshTimers.get(sessionId)
    if (timer !== undefined) {
      clearTimeout(timer)
      refreshTimers.delete(sessionId)
    }
  }

  return {
    ensureLoaded,
    refresh,
    getSessionRuns,
    findRunByToolCallId,
    isLoaded,
    isPending,
    clearSession,
  }
})
