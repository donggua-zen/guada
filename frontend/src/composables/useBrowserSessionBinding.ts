import { watch, toValue, onScopeDispose, type MaybeRefOrGetter } from 'vue'
import { useBrowserWebviewStore } from '@/stores/browserWebview'

/**
 * 把「用户正在看的会话」绑定到 browserWebview store 的 currentSessionId。
 *
 * 必须是 immediate：ChatPage 卸载后重新挂载（设置页/插件页/智能体页返回、路由守卫
 * 重建）时 sessionsMap 往往已有该会话对象（左侧栏列表早就 load 过），mainSession 在
 * setup 首帧就非空 —— 非 immediate 的 watch 永远等不到「变化」，currentSessionId 会
 * 一直停在卸载时写下的 null。此时 sessionWebviews 恒为空：
 *   - BrowserWebviewLayer 的同步 watch 拿不到新窗口 → 侧栏标签栏永远不出现浏览器标签
 *   - syncBrowserTabs 的会话门禁判定归属不符 → 直接 return
 *   - handleCreateWebview 的自动展开/自动选中同样比对失败
 * 而 webview 渲染走的是 allWebviews（不过滤会话），于是「网页正常打开、AI 正常操作，
 * 侧栏却没有标签」，切一次会话才恢复。
 *
 * 只监听 id、不监听会话对象：mergeSession 会就地更新已有对象，若监听对象则每次
 * session_updated 都会触发一次 setCurrentSession（顺带清空 activeWindowId / previewRect）。
 */
export function useBrowserSessionBinding(
  sessionId: MaybeRefOrGetter<string | null | undefined>,
): void {
  const store = useBrowserWebviewStore()

  watch(
    () => toValue(sessionId) ?? null,
    (id) => store.setCurrentSession(id),
    { immediate: true },
  )

  // 组件卸载等价于「不再有正在看的会话」：清掉标记，避免离开聊天页后仍命中自动预览等条件
  onScopeDispose(() => store.setCurrentSession(null))
}
