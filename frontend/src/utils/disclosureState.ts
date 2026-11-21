/**
 * 展开/收起状态的跨挂载保持（用户显式操作过才记录）。
 *
 * 为什么需要它：折叠的工具/思考组已改为「收起时不挂载子树」，而回合本身也会被
 * ChatPanel 的有界窗口回收（reclaimTurnWindow）。组件内 ref 在两种卸载后都会丢失，
 * 表现为「展开某个工具行 → 滚远 → 滚回来又收起了」。
 *
 * 设计约束：
 * - **只存用户显式写入的值**，不存派生值：undefined 表示「按运行态派生」，
 *   调用方自行回落到默认值（流式最后一组默认展开、独立工具行默认展开等）；
 * - **必须有界**：按 LRU 淘汰，不能让状态表随会话长度无限增长；
 * - **按回合清理**：回合被删除时清掉它的全部键，避免残留。
 */
import { reactive } from 'vue'

/** 键值上限：一次长会话里被手动展开过的分组/工具行远小于此值 */
export const DISCLOSURE_MAX_ENTRIES = 2000

/** 键分隔符：`<turnId>\0<groupId|itemId>`。用 NUL 避免与 id 内部字符冲突。 */
export const DISCLOSURE_KEY_SEPARATOR = '\u0000'

/** 组装一个稳定的键：回合内组件卸载/重挂后仍能命中同一条记录 */
export function disclosureKey(turnId: string, localId: string): string {
  return `${turnId}${DISCLOSURE_KEY_SEPARATOR}${localId}`
}

/**
 * Map 本身用 reactive 包装：读写走同一份响应式依赖，
 * 组件渲染里读 getDisclosure(key) 会在写入后正确重算。
 */
const state = reactive(new Map<string, boolean>())

/** 读取用户显式写入的值；undefined = 从未操作过，调用方按运行态派生。 */
export function getDisclosure(key: string): boolean | undefined {
  return state.get(key)
}

/**
 * 写入用户选择。写入即触碰（Map 插入序决定淘汰顺序），
 * 超过上限时从最早写入/最久未触碰的条目开始淘汰。
 */
export function setDisclosure(key: string, value: boolean): void {
  state.delete(key)
  state.set(key, value)
  while (state.size > DISCLOSURE_MAX_ENTRIES) {
    const oldest = state.keys().next()
    if (oldest.done) break
    state.delete(oldest.value)
  }
}

/** 清除单个键（如该分组已不存在）。 */
export function clearDisclosure(key: string): void {
  state.delete(key)
}

/** 清除某个回合的全部记录（回合被删除时调用）。 */
export function clearDisclosureForTurn(turnId: string): void {
  const prefix = `${turnId}${DISCLOSURE_KEY_SEPARATOR}`
  for (const key of Array.from(state.keys())) {
    if (key.startsWith(prefix)) state.delete(key)
  }
}

/** 测试与登出等场景用：清空全部。 */
export function resetDisclosureState(): void {
  state.clear()
}

/** 当前条目数（测试与诊断用）。 */
export function disclosureSize(): number {
  return state.size
}
