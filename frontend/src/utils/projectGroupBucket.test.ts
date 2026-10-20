import { describe, expect, it } from 'vitest'
import type { ProjectGroup, Session } from '../types/session'
import {
  GENERAL_PROJECT_GROUP_ID,
  isSortableProjectGroup,
  resolveProjectBucketId,
} from './projectGroupBucket'

/**
 * 目录桶归属解析。
 *
 * 关键约束：前端**不归一化路径**——键完全来自后端下发的 workspaceKey。
 * 因此这里锁的是「匹配语义」，而不是路径算法；路径归一化的正确性由
 * 后端 workspace-key.util.spec.ts 覆盖。
 */
const group = (over: Partial<ProjectGroup>): ProjectGroup => ({
  id: 'pg-1',
  name: 'alpha',
  path: 'D:\\AI\\alpha',
  pathKey: 'd:/ai/alpha',
  sortOrder: 0,
  isOverridden: false,
  kind: 'workspace',
  ...over,
})

const session = (workspaceKey?: string | null): Pick<Session, 'workspaceKey'> => ({
  workspaceKey,
})

describe('resolveProjectBucketId', () => {
  const groups: ProjectGroup[] = [
    group({ id: 'pg-1', pathKey: 'd:/ai/alpha' }),
    group({ id: 'pg-2', pathKey: 'd:/ai/beta', name: 'beta' }),
  ]

  it('按后端 key 精确匹配到分组', () => {
    expect(resolveProjectBucketId(session('d:/ai/alpha'), groups)).toBe('pg-1')
    expect(resolveProjectBucketId(session('d:/ai/beta'), groups)).toBe('pg-2')
  })

  it('空键 / 未注册目录 → 通用', () => {
    expect(resolveProjectBucketId(session(null), groups)).toBe(GENERAL_PROJECT_GROUP_ID)
    expect(resolveProjectBucketId(session(undefined), groups)).toBe(GENERAL_PROJECT_GROUP_ID)
    expect(resolveProjectBucketId(session('d:/ai/unregistered'), groups)).toBe(
      GENERAL_PROJECT_GROUP_ID,
    )
  })

  it('大小写差异不自行归一（键以后端为准）', () => {
    // 后端在 win32 已统一小写；前端若自行 lower 反而会掩盖后端 bug
    expect(resolveProjectBucketId(session('D:/AI/alpha'), groups)).toBe(
      GENERAL_PROJECT_GROUP_ID,
    )
  })

  it('虚拟通用桶不参与精确匹配', () => {
    const withGeneral: ProjectGroup[] = [
      ...groups,
      group({ id: GENERAL_PROJECT_GROUP_ID, pathKey: null, kind: 'general', name: '' }),
    ]
    expect(resolveProjectBucketId(session('d:/ai/alpha'), withGeneral)).toBe('pg-1')
    expect(resolveProjectBucketId(session(null), withGeneral)).toBe(
      GENERAL_PROJECT_GROUP_ID,
    )
  })
})

describe('isSortableProjectGroup', () => {
  it('只有真实目录分组可排序，通用桶固定末尾', () => {
    expect(isSortableProjectGroup(group({ kind: 'workspace' }))).toBe(true)
    expect(isSortableProjectGroup(group({ kind: 'general' }))).toBe(false)
  })
})
