import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

/**
 * 插件页二级视图（已安装 / 市场 / SkillHub）与地址栏 query 双向同步。
 *
 * 一级 tab 已经占用 route.params.tab，二级只能落 query；
 * 默认视图不写 query，避免地址栏常驻一个 `?view=installed`。
 *
 * 多 tab 共用同一个 `view` query，切换一级 tab 时新组件往往先带着旧 tab 的
 * `?view=...` 挂载（路由 replace 是异步的）。因此这里必须：
 * - tabName：只认当前一级 tab 的 query，切换瞬间忽略旧 tab 的值；
 * - allowedViews：不属于本 tab 的值一律回落到默认视图（例如 Skills 的
 *   `skillhub` 落到 MCP 页时不能变成“两个二级 tab 都没选中”）。
 */
export function usePluginViewQuery(
    defaultView = 'installed',
    allowedViews?: readonly string[],
    tabName?: string,
) {
    const route = useRoute()
    const router = useRouter()

    const readQuery = (): string | undefined => {
        const raw = route.query.view
        const value = Array.isArray(raw) ? raw[0] : raw
        return typeof value === 'string' && value ? value : undefined
    }

    const isAllowed = (value: string): boolean =>
        !allowedViews || allowedViews.includes(value)

    /** 一级 tab 是否已经是本页；切换瞬间新组件会先看到旧 tab */
    const isActiveTab = (): boolean => {
        if (!tabName) return true
        const current = Array.isArray(route.params.tab)
            ? route.params.tab[0]
            : route.params.tab
        return current === tabName
    }

    const initialQuery = readQuery()
    const view = ref(
        initialQuery && isAllowed(initialQuery) && isActiveTab()
            ? initialQuery
            : defaultView,
    )

    watch(view, (value) => {
        if (!isActiveTab()) return
        if (readQuery() === value) return
        router.replace({ query: { ...route.query, view: value === defaultView ? undefined : value } })
    })

    // 浏览器前进/后退或一级 tab 切换清掉 query → 回到对应视图
    watch(() => route.query.view, () => {
        if (!isActiveTab()) return
        const value = readQuery()
        const next = value && isAllowed(value) ? value : defaultView
        if (next !== view.value) view.value = next
    })

    // 地址与界面不一致时补写一次（例如上一个 tab 残留的 view 参数已被清掉）。
    // 切换尚未落定（tab 不匹配）时不要补写，否则会用旧 tab 的路径覆盖正在进行的导航。
    if (isActiveTab() && (readQuery() || defaultView) !== view.value) {
        void router.replace({ query: { ...route.query, view: view.value === defaultView ? undefined : view.value } })
    }

    return view
}
