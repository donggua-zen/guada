import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { ProjectGroup } from '@/types/session'
import { resolveProjectBucketId } from '@/utils/projectGroupBucket'

// 只桩掉后端调用：ApiService 真实模块加载期会读 localStorage，node 测试环境没有它。
vi.mock('@/services/ApiService', () => ({
  apiService: {
    fetchProjectGroups: vi.fn(async () => []),
    updateProjectGroup: vi.fn(),
    createProjectGroup: vi.fn(),
    reorderProjectGroups: vi.fn(),
    deleteProjectGroup: vi.fn(),
    archiveProjectGroup: vi.fn(),
    fetchSessionGroups: vi.fn(async () => []),
  },
}))

import { useSessionGroupStore, GENERAL_PROJECT_GROUP_ID } from './sessionGroup'

// 折叠态走 localStorage 持久化；node 测试环境没有可用的实现（Node 自带的
// localStorage 在无 --localstorage-file 时不可写），这里提供最小内存实现。
const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => void storage.set(key, value),
  removeItem: (key: string) => void storage.delete(key),
  clear: () => storage.clear(),
})

/**
 * 目录分组增量写入（upsertProjectGroup）。
 *
 * 回归场景：新建会话时选了一个侧栏里还不存在的目录，后端在创建时写时注册了
 * project_groups 并把分组随响应回带；前端若不补进 projectGroups，
 * resolveProjectBucketId 匹配不到 pathKey，会话会先落进「通用」桶，
 * 直到刷新（整表 loadSessions）才归位。
 */
const makeGroup = (over: Partial<ProjectGroup> = {}): ProjectGroup => ({
  id: 'pg-alpha',
  name: 'alpha',
  path: 'D:\\AI\\alpha',
  pathKey: 'd:/ai/alpha',
  sortOrder: 0,
  isOverridden: false,
  icon: null,
  kind: 'workspace',
  ...over,
})

/** 模拟 loadSessions 写入的首屏分组（末尾已带虚拟「通用」桶） */
const seedGroups = () => {
  const store = useSessionGroupStore()
  store.setProjectGroups([
    {
      id: 'pg-beta',
      name: 'beta',
      path: 'D:\\AI\\beta',
      pathKey: 'd:/ai/beta',
      sortOrder: 0,
      isOverridden: false,
      icon: null,
    },
  ])
  return store
}

describe('sessionGroupStore.upsertProjectGroup', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('新分组插在「通用」之前，并让会话立即归入该桶（本次 bug 的回归断言）', () => {
    const store = seedGroups()

    store.upsertProjectGroup(makeGroup())

    const ids = store.projectGroups.map((g) => g.id)
    expect(ids).toEqual(['pg-beta', 'pg-alpha', GENERAL_PROJECT_GROUP_ID])
    // 关键：会话不再落「通用」
    expect(
      resolveProjectBucketId({ workspaceKey: 'd:/ai/alpha' }, store.projectGroups),
    ).toBe('pg-alpha')
  })

  it('同 id 重复写入不产生重复项，且保留本地顺序与折叠态', () => {
    const store = seedGroups()
    store.upsertProjectGroup(makeGroup({ sortOrder: 0 }))
    store.toggleExpand('pg-alpha')
    expect(store.isExpanded('pg-alpha')).toBe(false)

    // 后端再次回带（例如另一个窗口也用了同一目录），携带新的显示名/图标与不同 position
    store.upsertProjectGroup(
      makeGroup({
        name: '改过的名字',
        icon: 'rocket',
        isOverridden: true,
        sortOrder: 99,
      }),
    )

    expect(store.projectGroups.filter((g) => g.id === 'pg-alpha')).toHaveLength(1)
    const merged = store.projectGroups.find((g) => g.id === 'pg-alpha')!
    expect(merged.name).toBe('改过的名字')
    expect(merged.icon).toBe('rocket')
    // 顺序由本地维护，不被增量写入打乱
    expect(merged.sortOrder).toBe(0)
    expect(store.isExpanded('pg-alpha')).toBe(false)
  })

  it('虚拟「通用」桶被忽略', () => {
    const store = seedGroups()
    const before = store.projectGroups.map((g) => g.id)

    store.upsertProjectGroup(
      makeGroup({ id: GENERAL_PROJECT_GROUP_ID, kind: 'general', pathKey: null }),
    )

    expect(store.projectGroups.map((g) => g.id)).toEqual(before)
  })

  it('分组缓存尚未加载（无「通用」桶）时补写并合成通用桶', () => {
    const store = useSessionGroupStore()
    expect(store.projectGroups).toHaveLength(0)

    store.upsertProjectGroup(makeGroup())

    expect(store.projectGroups.map((g) => g.id)).toEqual([
      'pg-alpha',
      GENERAL_PROJECT_GROUP_ID,
    ])
  })

  it('新分组默认展开，且不覆盖已有折叠态', () => {
    const store = seedGroups()

    store.upsertProjectGroup(makeGroup())
    expect(store.isExpanded('pg-alpha')).toBe(true)
  })
})
