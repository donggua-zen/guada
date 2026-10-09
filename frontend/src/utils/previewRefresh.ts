/**
 * 预览面板对「文件变更版本号变化」的处置决策（纯函数，便于单测）。
 *
 * 版本号由 workspaceTree.fileChangeVersions 维护（SSE change 事件递增），
 * 经 WorkspaceSidebar 以 content-version prop 下发到各 FilePreviewPanel。
 */

export type PreviewRefreshAction = 'ignore' | 'conflict' | 'stale' | 'refresh'

export interface PreviewRefreshInput {
  /** 面板是否已加载过内容：未加载时激活会重新拉取，版本变化无需处理 */
  hasLoaded: boolean
  newVersion: number
  oldVersion: number
  saveStatus: 'saved' | 'saving' | 'unsaved'
  isActive: boolean
}

export function decidePreviewRefresh(input: PreviewRefreshInput): PreviewRefreshAction {
  // 尚未加载过内容：激活时会走 loadFilePreview 拿到最新内容，此处无需动作
  if (!input.hasLoaded) return 'ignore'
  // 未增长（含会话切换后版本号整体重置）：忽略
  if (input.newVersion <= input.oldVersion) return 'ignore'
  // 有未保存编辑 + 外部文件变化：只标冲突，不覆盖编辑内容
  if (input.saveStatus === 'unsaved') return 'conflict'
  // 非激活面板（DOM 仍在，仅 CSS 隐藏）：延迟到重新激活时刷新
  if (!input.isActive) return 'stale'
  return 'refresh'
}
