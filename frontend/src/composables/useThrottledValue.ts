import { ref, watch, type Ref } from 'vue'
import { useThrottleFn } from '@vueuse/core'

/**
 * 节流展示值：source 变化时最多每 intervalMs 落地一次（首值立即、尾值必达）。
 *
 * 专供**流式长文档预览**。MarkdownContent 对 content 的每次变化都要把整篇 markdown
 * 重新 parse 一遍、再做整棵 HTML 的 DOM diff（见该组件 renderWithDiffDOM），代价与
 * 文档长度成正比；而计划正文在流式期间可能同时出现在流内卡片与工作区计划面板两处，
 * 等于同一份正文每个 token 解析两遍。节流放在"喂给渲染"这一步，解析与 diff 的次数随之被限住。
 *
 * 用 VueUse 的 useThrottleFn：底层是定时器而不是 requestAnimationFrame，后台标签页里
 * rAF 被冻结时尾值仍会落地，不会把半截正文留在屏幕上。**trailing 必须显式传 true**——
 * 它的运行期默认是 `trailing = false`，那样窗口结束后最后一次变更会被直接丢掉，
 * 屏幕上就永远是"少最后一段"的正文（d.ts 里只写了 `trailing?: boolean`，看不出默认值）。
 * 首值无需特殊处理：`shown` 直接以 source 的当前值初始化，且内部 lastExec 初值为 0，
 * 第一次调用必然走 leading 立即落地。
 *
 * 落地节奏（实测语义）：首值立即；之后每 intervalMs 窗口最多落地一次，
 * 每次落地取该窗口内的最新值。所以展示值最多滞后一个窗口，且一定会收敛到最新。
 *
 * 注意：只适合"内容随时间增长"的场景（流式正文）。若同一个位置会整体换成另一份内容
 * （例如面板里切换选中的计划），节流会让用户先看到上一份内容，那种切换要绕开本函数。
 */
export function useThrottledValue(source: () => string, intervalMs = 300): Ref<string> {
    const shown = ref(source())
    const commit = useThrottleFn((value: string) => {
        shown.value = value
    }, intervalMs, true)
    watch(source, (value) => {
        void commit(value)
    })
    return shown
}
