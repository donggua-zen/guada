import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

/**
 * 插件页二级视图（已安装 / 市场）与地址栏 query 双向同步。
 *
 * 一级 tab 已经占用 route.params.tab，二级只能落 query；
 * 默认视图不写 query，避免地址栏常驻一个 `?view=installed`。
 */
export function usePluginViewQuery(defaultView = 'installed') {
    const route = useRoute()
    const router = useRouter()

    const readQuery = (): string | undefined => {
        const raw = route.query.view
        const value = Array.isArray(raw) ? raw[0] : raw
        return typeof value === 'string' && value ? value : undefined
    }

    const view = ref(readQuery() || defaultView)

    watch(view, (value) => {
        if (readQuery() === value) return
        router.replace({ query: { ...route.query, view: value === defaultView ? undefined : value } })
    })

    // 浏览器前进/后退改地址 → 回到对应视图
    watch(() => route.query.view, () => {
        const value = readQuery()
        if (value && value !== view.value) view.value = value
    })

    // 地址与界面不一致时补写一次（例如上一个 tab 残留的 view 参数已被清掉），
    // 让「看到的视图」一定能在地址栏里找到
    if ((readQuery() || defaultView) !== view.value) {
        void router.replace({ query: { ...route.query, view: view.value === defaultView ? undefined : view.value } })
    }

    return view
}
