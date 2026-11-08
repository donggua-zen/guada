/**
 * Markdown 预览 iframe 的滚动位置记忆（模块级单例状态）。
 *
 * 预览是 <iframe :srcdoc>，文件内容更新时浏览器整体重建 iframe 文档、滚动归零；
 * 父页面在收到 iframe 上报的滚动位置后记录于此，iframe load 后按 path 校验恢复。
 * 用普通变量而非 ref：滚动是高频事件，不参与渲染，无响应式开销。
 */

export interface MarkdownScrollState {
  /** 保存时的滚动位置 */
  top: number
  /** 保存时的文档滚动高度：内容增删后按比例换算恢复位置 */
  scrollHeight: number
}

let state: { path: string; scroll: MarkdownScrollState } | null = null

/** 记录某文件预览的最后滚动位置（同路径连续滚动覆盖旧值） */
export function recordMarkdownScroll(path: string, scroll: MarkdownScrollState): void {
  state = { path, scroll }
}

/**
 * 取出待恢复的滚动位置：path 匹配才返回（切文件/新面板不回跳），
 * 消费即清空，一次重载只恢复一次。
 */
export function consumeMarkdownScrollRestore(path: string): MarkdownScrollState | null {
  if (!state || state.path !== path) return null
  const scroll = state.scroll
  state = null
  return scroll
}
