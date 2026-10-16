/**
 * 按会话记忆滚动位置（对齐参考实现 zcode 的 packages/ui/src/lib/chatSessionScrollMemory.ts）。
 *
 * 目的：会话切走再切回、或刷新页面后重建 ChatPanel 时，恢复用户原来的阅读位置——
 * 贴底态继续贴底，读到中间就回到中间，而不是每次都强制滚到最新消息。
 *
 * 存的是**绝对 scrollTop**（配 scrollHeight/clientHeight 供钳制），不是「距底距离」：
 * 首次访问没有记忆 → 贴底；有记忆且当初非贴底 → 按绝对值恢复并在内容不足时按上限收。
 * 同一会话在多个面板（主区 + 浮窗）共享一条记忆，互相覆盖属已知的轻微代价。
 */

export interface ChatSessionScrollMemoryState {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  /** 离开时的跟随态：true 表示下次恢复应直接贴底（内容可能已大幅变化，绝对位置无意义）。 */
  wasPinnedToBottom: boolean
  updatedAt: number
}

/** 记忆条数上限：超出按 LRU 淘汰最早写入/最久未访问的条目。 */
export const CHAT_SCROLL_MEMORY_MAX_ENTRIES = 200

const memory = new Map<string, ChatSessionScrollMemoryState>()

/**
 * 记忆键 = 会话 ID。
 *
 * 会话 ID 本身全局唯一，故不叠加工作区路径：保存发生在会话切换的瞬间，
 * 此时能读到的会话对象可能已经是「切过去」的那个（props 先变、组件内 ID 后变），
 * 叠加工作区会让同一个会话在不同时刻算出两个键、记忆静默失效。
 * 若将来出现「同一会话跨工作区复用」的真实场景，再回来把工作区加进键。
 */
export function buildChatSessionScrollMemoryKey(sessionId: string): string {
  return sessionId
}

/** 写入即触碰：Map 的插入序决定淘汰顺序，重复 set 会把条目移到末尾。 */
export function saveChatSessionScrollMemory(
  key: string,
  state: ChatSessionScrollMemoryState,
): void {
  memory.delete(key)
  memory.set(key, state)
  while (memory.size > CHAT_SCROLL_MEMORY_MAX_ENTRIES) {
    const oldest = memory.keys().next()
    if (oldest.done) break
    memory.delete(oldest.value)
  }
}

/** 读取即触碰（LRU）：把命中的条目移到 Map 末尾再返回。 */
export function loadChatSessionScrollMemory(key: string): ChatSessionScrollMemoryState | null {
  const state = memory.get(key)
  if (!state) return null
  memory.delete(key)
  memory.set(key, state)
  return state
}

export function clearChatSessionScrollMemory(key: string): void {
  memory.delete(key)
}

/** 测试与登出等场景用：清空全部记忆。 */
export function resetChatSessionScrollMemory(): void {
  memory.clear()
}

export interface ScrollMetricsLike {
  scrollTop: number
  viewportHeight: number
  contentHeight: number
}

/** 恢复目标钳制：内容比记忆时更短时收到可滚动上限，避免把位置顶到非法值。 */
export function clampScrollTop(state: ChatSessionScrollMemoryState, metrics: ScrollMetricsLike): number {
  const maxScrollTop = Math.max(metrics.contentHeight - metrics.viewportHeight, 0)
  return Math.min(Math.max(state.scrollTop, 0), maxScrollTop)
}

/** 恢复容差：与目标差在此范围内视为已到达（亚像素与钳制误差）。 */
export const SCROLL_MEMORY_RESTORE_TOLERANCE_PX = 4

/**
 * 会话恢复是否还需要重试。
 * 内容首帧不足（屏外回合仍按 contain-intrinsic-size 估算、高度未展开）时，
 * clampScrollTop 会把目标压到小于记忆值，此时不能算已恢复；待内容撑高后重试。
 */
export function shouldRetryScrollMemoryRestore(
  state: ChatSessionScrollMemoryState,
  currentTop: number,
): boolean {
  if (state.wasPinnedToBottom) return false
  const target = state.scrollTop
  if (target <= 0) return false
  return target - currentTop > SCROLL_MEMORY_RESTORE_TOLERANCE_PX
}
