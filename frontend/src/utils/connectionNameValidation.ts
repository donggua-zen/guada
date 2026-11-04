/**
 * 远程工作区连接名称校验（纯函数，便于单测）。
 *
 * 判重使用 trim 后的名称，并与后端提交前归一化保持一致；编辑态按 id 排除自身，
 * 避免「未改名的现有连接」被误判为重名。
 */

export interface ConnectionNameRef {
  id: string
  name: string
}

export type ConnectionNameError = 'required' | 'taken' | null

export function normalizeConnectionName(name: unknown): string {
  return String(name ?? '').trim()
}

export function validateConnectionName(
  name: unknown,
  connections: ConnectionNameRef[],
  editingId: string | null = null,
): ConnectionNameError {
  const normalized = normalizeConnectionName(name)
  if (!normalized) return 'required'
  const taken = (connections || []).some(
    (conn) => conn.id !== editingId && normalizeConnectionName(conn.name) === normalized,
  )
  return taken ? 'taken' : null
}
