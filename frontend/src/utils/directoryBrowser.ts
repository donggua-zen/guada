/**
 * 目录浏览器的纯逻辑（路径处理 + 请求守卫），与 DirectoryBrowserDialog.vue 分离。
 *
 * 前端测试约定为 node 环境纯逻辑单测（无 @vue/test-utils），这里照 zcode
 * DirectoryBrowser 的做法把可测部分拆出：createDirectoryBrowserRequestGuard、
 * joinPath / parentPath / isFsRoot。
 */

/** Windows 盘符根（C:\ / C:/）与 POSIX 根（/），均不可再向上一级 */
export function isFsRoot(p: string): boolean {
  if (!p) return false
  if (/^[a-zA-Z]:[\\/]?$/.test(p)) return true
  return p === '/'
}

/** 判断当前路径能否返回上级（空路径 / 根路径不可） */
export function canGoUp(p: string): boolean {
  return !!p && !isFsRoot(p)
}

/** 目录项路径拼接：按 base 中实际使用的分隔符拼接，交给后端 path.resolve 归一 */
export function joinPath(base: string, name: string): string {
  if (!base) return name
  const sep = base.includes('\\') ? '\\' : '/'
  const trimmed = base.replace(/[\\/]+$/, '')
  return `${trimmed}${sep}${name}`
}

/**
 * 上取一级路径。末尾分隔符视为可剥离；
 * 盘符（D:）补回反斜杠成 D:\，剥到空则回 POSIX 根 /。
 */
export function parentPath(p: string): string {
  const normalized = p.replace(/[\\/]+$/, '')
  const idx = Math.max(normalized.lastIndexOf('\\'), normalized.lastIndexOf('/'))
  if (idx < 0) return p
  const parent = normalized.slice(0, idx)
  if (/^[a-zA-Z]:$/.test(parent)) return parent + '\\'
  return parent || '/'
}

/**
 * 请求守卫工厂：每次发起浏览自增代次，调用方持返回的快照比对，
 * 迟到的响应（快速连点目录/切路径时旧请求后到）据此作废。
 */
export function createBrowseRequestGuard() {
  let generation = 0
  return {
    /** 新请求开始，返回该请求的代次快照 */
    begin(): number {
      return ++generation
    },
    /** 响应所属代次是否仍是当前请求（false = 已过期，应丢弃） */
    isCurrent(snapshot: number): boolean {
      return snapshot === generation
    },
  }
}
