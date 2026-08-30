import { computed, ref, toValue, watchEffect } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

/**
 * 流式期间展示层秒表：从 startedAt 锚点起跳动显示已耗时。
 *
 * 纯展示层实现——数据模型不持有任何定时器句柄（替代旧版散落在
 * 投影器/消息模型里的 100ms setInterval 方案）：
 * - active 为 true：每 intervalMs 跳动一次，返回 now - startedAt
 * - active 变 false：停止跳动，返回 finalDurationMs（服务端块级 timing 派生的权威值）
 *
 * @param startedAt 跳动锚点（epoch ms；本地收包时钟即可）
 * @param active    是否进行中（如思考态 isThinking）
 * @param finalDurationMs 结束后的权威时长（服务端 timing 派生）
 */
export function useElapsedTicker(
  startedAt: MaybeRefOrGetter<number | null | undefined>,
  active: MaybeRefOrGetter<boolean>,
  finalDurationMs?: MaybeRefOrGetter<number | null | undefined>,
  intervalMs = 200,
) {
  const now = ref(Date.now())

  // 仅在 active 期间持有定时器；watchEffect 随组件作用域自动清理
  watchEffect((onCleanup) => {
    if (!toValue(active)) return
    now.value = Date.now()
    const timer = setInterval(() => {
      now.value = Date.now()
    }, intervalMs)
    onCleanup(() => clearInterval(timer))
  })

  /** 展示值（ms）：进行中 → 锚点起跳动；结束 → 权威时长 */
  const elapsedMs = computed<number | null>(() => {
    if (!toValue(active)) {
      return toValue(finalDurationMs) ?? null
    }
    const start = toValue(startedAt)
    if (start == null) return null
    return Math.max(0, now.value - start)
  })

  return { elapsedMs }
}
