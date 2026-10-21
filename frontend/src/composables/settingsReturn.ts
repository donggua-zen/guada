/**
 * 设置页「返回应用」目标记忆。
 *
 * 进入设置页前记下当前应用内路由，返回时原样恢复（会话 ID、Tab、查询参数），
 * 而不是固定跳到新建会话页。存 sessionStorage：设置页内刷新仍可返回，
 * 关闭窗口/标签即清空，不影响应用启动落点。
 */
const STORAGE_KEY = 'settingsReturnPath'

function getSessionStorage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

export function rememberSettingsReturnPath(fullPath: string): void {
  if (!fullPath) return
  getSessionStorage()?.setItem(STORAGE_KEY, fullPath)
}

export function getSettingsReturnPath(): string | null {
  const path = getSessionStorage()?.getItem(STORAGE_KEY)
  if (!path) return null
  // 防御：返回目标绝不能是设置页自身，否则会形成导航循环
  return path === '/setting' || path.startsWith('/setting/') ? null : path
}
