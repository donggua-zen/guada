import type { ProjectGroup, Session } from '../types/session'

/** 目录模式「通用」虚拟桶 ID（与后端协议常量一致） */
export const GENERAL_PROJECT_GROUP_ID = '__general__'

/**
 * 解析会话所属的目录分组 id。
 *
 * 归属键由后端下发：`session.workspaceKey`（归一化派生列）与
 * `group.pathKey` 是同一个口径，因此前端**不做任何路径归一化**，
 * 从根上避免两端处理不一致导致会话落错桶。
 *
 * 未匹配（空路径 / 未注册目录 / 自动生成目录 / public）→ 「通用」。
 */
export function resolveProjectBucketId(
  session: Pick<Session, 'workspaceKey'>,
  groups: readonly ProjectGroup[],
): string {
  const key = session.workspaceKey || null
  if (!key) return GENERAL_PROJECT_GROUP_ID
  const group = groups.find(
    (g) => g.kind === 'workspace' && g.pathKey === key,
  )
  return group?.id ?? GENERAL_PROJECT_GROUP_ID
}

/** 目录分组是否参与拖拽排序（虚拟「通用」桶固定末尾） */
export function isSortableProjectGroup(
  group: Pick<ProjectGroup, 'kind'>,
): boolean {
  return group.kind === 'workspace'
}
