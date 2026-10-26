/**
 * 会话配置保存队列（输入区调整的唯一发布出口）。
 *
 * 设计要点：
 * - 按 sessionId 隔离：切换会话不会把 A 的待保存快照写到 B；
 * - 快照在 schedule 时克隆：在途期间继续修改不会污染已发出的请求；
 * - 在途合并：同一会话最多一个 PUT，期间的新变更只更新 pending，结束后自动发最新值；
 * - revision 守卫：旧响应到达时若已有更新的本地变更，不覆盖本地 store；
 * - 立即保存（不设防抖定时器）：模型/档位/沙箱都是离散操作，也避免移动端后台
 *   把定时器节流导致“改了但没发出去”；
 * - 发送前用 flushSession 等待落盘；失败时保留 pending，下一次变更或发送重试。
 */
import { ElMessage } from 'element-plus'
import { apiService } from '@/services/ApiService'
import { useSessionStore } from '@/stores/session'
import { t } from '@/locales'
import { getApiErrorStatus } from '@/utils/errorMessage'
import type { SessionSettings } from '@/types/session'

export interface SessionSettingsSavePayload {
  modelId?: string | null
  settings?: SessionSettings
}

interface PendingSave {
  payload: SessionSettingsSavePayload
  revision: number
}

/** 待发送快照（每个会话只保留最新一份） */
const pending = new Map<string, PendingSave>()
/** 在途 PUT（每个会话最多一个） */
const inFlight = new Map<string, Promise<void>>()
/** 本地变更代际：用于判断 PUT 响应是否已落后于本地状态 */
const revisions = new Map<string, number>()
/** 已提示过保存失败的会话：同一轮失败只提示一次，成功或新变更后复位 */
const errorNotified = new Set<string>()

const FLUSH_MAX_ATTEMPTS = 2

function clonePayload(payload: SessionSettingsSavePayload): SessionSettingsSavePayload {
  const snapshot: SessionSettingsSavePayload = {}
  if (Object.prototype.hasOwnProperty.call(payload, 'modelId')) {
    // 显式 null 表示清空绑定，必须保留
    snapshot.modelId = payload.modelId
  }
  if (payload.settings !== undefined) {
    snapshot.settings = cloneSettings(payload.settings)
  }
  return snapshot
}

/** settings 是开放字典（未来插件可能写入非常规值）：优先结构化克隆，失败退回 JSON 克隆 */
function cloneSettings(settings: SessionSettings): SessionSettings {
  try {
    return structuredClone(settings)
  } catch {
    return JSON.parse(JSON.stringify(settings)) as SessionSettings
  }
}

function notifySaveFailedOnce(sessionId: string): void {
  if (errorNotified.has(sessionId)) return
  errorNotified.add(sessionId)
  ElMessage.error(t('common.saveFailed'))
}


/**
 * 排空某会话的保存队列。调用方不等待时（scheduleSave）用 void 调用；
 * flushSession 会等待返回的 promise。
 */
function drain(sessionId: string): Promise<void> {
  const running = inFlight.get(sessionId)
  if (running) return running

  const task = (async () => {
    while (pending.has(sessionId)) {
      const entry = pending.get(sessionId)!
      pending.delete(sessionId)

      try {
        const updated = await apiService.updateSession(sessionId, entry.payload)
        if (!updated) continue

        // 期间有更新的本地变更 → 不覆盖本地，循环继续发最新快照
        if ((revisions.get(sessionId) ?? 0) === entry.revision) {
          // merge 而非替换：保留侧栏 isStreaming 等前端注入字段
          useSessionStore().mergeSession(updated)
          errorNotified.delete(sessionId)
        }
      } catch (error) {
        if (getApiErrorStatus(error) === 404) {
          // 会话已删除：丢弃待保存项，避免对已删除会话无限重试
          pending.delete(sessionId)
          revisions.delete(sessionId)
          return
        }

        // 失败请求的字段必须并入后续快照：否则“先改模型失败、再改档位成功”
        // 会让模型变更只停留在本地，后端仍是旧值。
        const newer = pending.get(sessionId)
        if (newer) {
          newer.payload = { ...entry.payload, ...newer.payload }
        } else {
          pending.set(sessionId, entry)
        }
        notifySaveFailedOnce(sessionId)
        return
      }
    }
  })()

  inFlight.set(sessionId, task)
  void task.finally(() => {
    if (inFlight.get(sessionId) === task) inFlight.delete(sessionId)
  })
  return task
}

/**
 * 记录一次本地配置变更并立即尝试保存。
 *
 * settings 必须是“调用时刻”的完整快照（composable 内部会 structuredClone），
 * 不能传响应式对象引用。
 */
function scheduleSave(sessionId: string, payload: SessionSettingsSavePayload): void {
  if (!sessionId) return
  if (payload.modelId === undefined && payload.settings === undefined) return

  const revision = (revisions.get(sessionId) ?? 0) + 1
  revisions.set(sessionId, revision)
  // 同一会话的待保存项按字段合并：后一次只改档位时，不能把前一次待发的 modelId 冲掉
  const previous = pending.get(sessionId)
  const incoming = clonePayload(payload)
  pending.set(sessionId, {
    payload: previous ? { ...previous.payload, ...incoming } : incoming,
    revision,
  })
  // 失败提示按会话只发一次，成功后再复位，避免离线连续调整时刷屏
  void drain(sessionId)
}

/**
 * 等待某会话的待保存配置落盘。
 *
 * 失败时最多重试一次就放行：发送链路有回合级 settingsOverride 兜底，
 * 不能因为持久化失败把用户的消息卡住。
 */
async function flushSession(sessionId: string): Promise<void> {
  if (!sessionId) return

  let attempts = 0
  while (
    attempts < FLUSH_MAX_ATTEMPTS &&
    (pending.has(sessionId) || inFlight.has(sessionId))
  ) {
    attempts += 1
    await (inFlight.get(sessionId) ?? drain(sessionId))

    // 保存失败会保留 pending 且已不在途：本轮不再无限重试
    if (pending.has(sessionId) && !inFlight.has(sessionId)) {
      if (attempts >= FLUSH_MAX_ATTEMPTS) break
    }
  }
}

/** 等待全部会话的待保存配置（页面隐藏/卸载前的最佳努力） */
async function flushAll(): Promise<void> {
  const ids = new Set([...pending.keys(), ...inFlight.keys()])
  await Promise.all([...ids].map((id) => flushSession(id)))
}

export function useSessionSettingsSync() {
  return { scheduleSave, flushSession, flushAll }
}

/** 仅测试使用：清空模块级队列，避免用例之间互相污染 */
export function __resetSessionSettingsSyncForTests(): void {
  pending.clear()
  inFlight.clear()
  revisions.clear()
  errorNotified.clear()
}
