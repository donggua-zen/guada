/**
 * 工作目录选择模式的推断（纯函数，便于单测）。
 *
 * 「上次选择」在 `workspaceStore` 里按 `{ mode, path }` 记忆：
 * - `auto`   → 不指定目录，后端生成随机 `WORK-日期-XXXX`
 * - `public` → 公共目录（`<baseDir>/public`）
 * - `custom` → 用户自选的真实目录
 *
 * 模式只由路径本身决定，三个入口（新建页工具栏 / 定时任务编辑器 / 侧栏分组「+」）
 * 都走这一份推断，避免各自复制分支后判定口径漂移。
 */

export type WorkspaceChoiceMode = 'auto' | 'public' | 'custom'

export interface WorkspaceChoice {
  mode: WorkspaceChoiceMode
  path: string | null
}

/**
 * 由目标路径推断选择模式。
 *
 * @param workspacePath 目标工作目录；null = 自动创建
 * @param publicPath 当前公共目录绝对路径（baseDir 未就绪时为 null）
 */
export function resolveWorkspaceChoiceMode(
  workspacePath: string | null,
  publicPath: string | null,
): WorkspaceChoiceMode {
  if (workspacePath === null) return 'auto'
  if (publicPath && workspacePath === publicPath) return 'public'
  return 'custom'
}
