import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useStorage } from '@vueuse/core'
import { apiService } from '@/services/ApiService'
import type { ProjectGroup, SessionGroup } from '@/types/session'

/**
 * 未分组的默认分组 ID（虚拟 ID，不对应后端实体）
 */
export const UNGROUPED_ID = '__ungrouped__'

/** 目录模式「通用」虚拟桶 ID（与后端 GENERAL_PROJECT_GROUP_ID 协议一致） */
export const GENERAL_PROJECT_GROUP_ID = '__general__'

/** 侧栏分组模式：手工分组（默认）/ 按工作目录 */
export type SidebarGroupingMode = 'group' | 'workspace'

/** localStorage 中分组折叠状态的 key */
const STORAGE_KEY = 'sessionGroupExpanded'

function saveExpandedState(map: Map<string, boolean>) {
  const obj: Record<string, boolean> = {}
  map.forEach((v, k) => { obj[k] = v })
  localStorage.setItem(STORAGE_KEY, JSON.stringify(obj))
}

function loadExpandedState(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  } catch {
    return {}
  }
}

/**
 * 会话分组 Store
 * 仅管理分组元数据（列表、展开状态），会话数据由 sessionStore 统一管理
 */
export const useSessionGroupStore = defineStore('sessionGroup', () => {
  // ========== 状态 ==========

  /** 分组列表 */
  const groups = ref<SessionGroup[]>([])

  /** 是否已加载过分组列表 */
  const hasLoaded = ref(false)

  /** 分组展开状态 Map<groupId, boolean> */
  const expandedState = ref<Map<string, boolean>>(new Map())

  /** 分组加载状态 */
  const isLoadingGroups = ref(false)

  /** 当前正在加载更多的分组 ID */
  const loadingMoreGroupId = ref<string | null>(null)

  /**
   * 侧栏分组模式（localStorage 持久化，默认保持现有「普通分组」）。
   * 目录模式的实体由后端物化，前端只持有渲染用的投影。
   */
  const groupingMode = useStorage<SidebarGroupingMode>('sidebarGroupingMode', 'group')

  /** 目录分组列表（含末尾虚拟「通用」桶） */
  const projectGroups = ref<ProjectGroup[]>([])

  /** 目录分组是否已加载 */
  const projectGroupsLoaded = ref(false)

  // ========== 计算属性 ==========

  /** 排序后的目录分组（「通用」桶 sortOrder 为最大值，天然在最后） */
  const sortedProjectGroups = computed((): ProjectGroup[] => {
    return [...projectGroups.value].sort((a, b) => a.sortOrder - b.sortOrder)
  })

  /** 排序后的分组列表 */
  const sortedGroups = computed((): SessionGroup[] => {
    return [...groups.value].sort((a, b) => a.sortOrder - b.sortOrder)
  })

  /** 获取分组的展开状态 */
  const isExpanded = (groupId: string): boolean => {
    return expandedState.value.get(groupId) ?? true
  }

  // ========== Actions ==========

  /**
   * 加载分组列表（已加载过则不再重复请求）
   */
  const loadGroups = async (): Promise<void> => {
    // 如果已经加载过且已有数据，直接复用
    if (hasLoaded.value && groups.value.length > 0) {
      return
    }
    isLoadingGroups.value = true
    try {
      const data = await apiService.fetchSessionGroups()
      groups.value = data || []
      hasLoaded.value = true

      // 从 localStorage 恢复折叠状态，不存在的分组默认展开
      const saved = loadExpandedState()
      for (const group of data || []) {
        expandedState.value.set(group.id, saved[group.id] ?? true)
      }
      // 未分组也恢复折叠状态
      expandedState.value.set(UNGROUPED_ID, saved[UNGROUPED_ID] ?? true)
    } catch (error) {
      console.error('加载会话分组失败:', error)
    } finally {
      isLoadingGroups.value = false
    }
  }

  /**
   * 直接设置分组列表（从侧边栏批量接口获取，无需额外请求）
   */
  const setGroups = (data: SessionGroup[]): void => {
    groups.value = data || []
    hasLoaded.value = true

    const saved = loadExpandedState()
    for (const group of data || []) {
      expandedState.value.set(group.id, saved[group.id] ?? true)
    }
    expandedState.value.set(UNGROUPED_ID, saved[UNGROUPED_ID] ?? true)
  }

  /**
   * 切换分组展开/折叠状态
   */
  const toggleExpand = (groupId: string): void => {
    const current = expandedState.value.get(groupId) ?? true
    expandedState.value.set(groupId, !current)
    saveExpandedState(expandedState.value)
  }

  /**
   * 设置分组展开状态
   */
  const setExpand = (groupId: string, expanded: boolean): void => {
    expandedState.value.set(groupId, expanded)
    saveExpandedState(expandedState.value)
  }

  /**
   * 创建分组
   */
  const createGroup = async (name: string): Promise<SessionGroup | null> => {
    try {
      const group = await apiService.createSessionGroup({ name })
      groups.value.push(group)
      // 新分组默认展开
      expandedState.value.set(group.id, true)
      saveExpandedState(expandedState.value)
      return group
    } catch (error) {
      console.error('创建分组失败:', error)
      return null
    }
  }

  /**
   * 更新分组名称
   */
  const updateGroup = async (groupId: string, name: string): Promise<boolean> => {
    try {
      const updated = await apiService.updateSessionGroup(groupId, { name })
      const index = groups.value.findIndex(g => g.id === groupId)
      if (index !== -1) {
        groups.value[index] = updated
      }
      return true
    } catch (error) {
      console.error('更新分组失败:', error)
      return false
    }
  }

  /**
   * 删除分组
   */
  const deleteGroup = async (groupId: string): Promise<boolean> => {
    try {
      await apiService.deleteSessionGroup(groupId)
      groups.value = groups.value.filter(g => g.id !== groupId)
      expandedState.value.delete(groupId)
      saveExpandedState(expandedState.value)
      return true
    } catch (error) {
      console.error('删除分组失败:', error)
      return false
    }
  }

  /**
   * 调整分组顺序
   */
  const reorderGroups = async (orderedIds: string[]): Promise<boolean> => {
    try {
      await apiService.reorderSessionGroups(orderedIds)
      // 更新本地排序
      const newGroups: SessionGroup[] = []
      for (const id of orderedIds) {
        const group = groups.value.find(g => g.id === id)
        if (group) {
          newGroups.push({ ...group, sortOrder: newGroups.length })
        }
      }
      groups.value = newGroups
      return true
    } catch (error) {
      console.error('调整分组顺序失败:', error)
      return false
    }
  }

  /**
   * 归档本分组：归档组内全部对话（流式输出中的跳过），分组行保留。
   * 返回成功归档的 id，供调用方清理本地会话缓存。
   */
  const archiveGroup = async (groupId: string): Promise<{
    success: boolean
    archived: number
    skipped: number
    sessionIds: string[]
    error?: unknown
  }> => {
    try {
      const result = await apiService.archiveSessionGroup(groupId)
      return {
        success: true,
        archived: result.archived,
        skipped: result.skipped,
        sessionIds: result.sessionIds || [],
      }
    } catch (error) {
      console.error('归档分组失败:', error)
      return { success: false, archived: 0, skipped: 0, sessionIds: [], error }
    }
  }

  /**
   * 设置加载更多状态
   */
  const setLoadingMore = (groupId: string | null): void => {
    loadingMoreGroupId.value = groupId
  }

  // ========== 目录分组（按工作目录） ==========

  /**
   * 设置目录分组投影（来自侧栏目录模式接口）。
   * 末尾追加虚拟「通用」桶；它的名称留空，由组件按 i18n 渲染。
   */
  const setProjectGroups = (
    data: Array<Omit<ProjectGroup, 'kind'>>,
  ): void => {
    const saved = loadExpandedState()
    const list: ProjectGroup[] = (data || []).map((g) => ({
      ...g,
      kind: 'workspace' as const,
    }))
    list.push({
      id: GENERAL_PROJECT_GROUP_ID,
      name: '',
      path: null,
      pathKey: null,
      sortOrder: Number.MAX_SAFE_INTEGER,
      isOverridden: false,
      kind: 'general',
    })
    projectGroups.value = list
    projectGroupsLoaded.value = true
    for (const group of list) {
      expandedState.value.set(group.id, saved[group.id] ?? true)
    }
  }

  /** 重命名目录分组（只改显示名，不改磁盘目录） */
  const renameProjectGroup = async (
    groupId: string,
    name: string,
  ): Promise<boolean> => {
    try {
      const updated = await apiService.renameProjectGroup(groupId, name)
      const index = projectGroups.value.findIndex((g) => g.id === groupId)
      if (index !== -1) {
        projectGroups.value[index] = {
          ...projectGroups.value[index],
          ...updated,
          kind: 'workspace',
        }
      }
      return true
    } catch (error) {
      console.error('重命名目录分组失败:', error)
      return false
    }
  }

  /** 调整目录分组顺序（「通用」桶固定末尾，不参与排序） */
  const reorderProjectGroups = async (orderedIds: string[]): Promise<boolean> => {
    try {
      await apiService.reorderProjectGroups(orderedIds)
      const general = projectGroups.value.find((g) => g.kind === 'general')
      const reordered: ProjectGroup[] = []
      orderedIds.forEach((id, index) => {
        const group = projectGroups.value.find((g) => g.id === id)
        if (group) reordered.push({ ...group, sortOrder: index })
      })
      if (general) {
        reordered.push({ ...general, sortOrder: reordered.length })
      }
      projectGroups.value = reordered
      return true
    } catch (error) {
      console.error('调整目录分组顺序失败:', error)
      return false
    }
  }

  /**
   * 删除项目：删除其下全部对话并移除分组行（工作目录与文件保留）。
   * 返回 sessionIds 供调用方精确清理会话缓存；失败时回传原始错误，
   * 调用方可用 `getApiErrorStatus(error) === 409` 区分「流式输出中」。
   */
  const deleteProjectGroup = async (
    groupId: string,
  ): Promise<{
    success: boolean
    deleted: number
    sessionIds: string[]
    error?: unknown
  }> => {
    try {
      const result = await apiService.deleteProjectGroup(groupId)
      projectGroups.value = projectGroups.value.filter((g) => g.id !== groupId)
      expandedState.value.delete(groupId)
      saveExpandedState(expandedState.value)
      return {
        success: true,
        deleted: result.deleted,
        sessionIds: result.sessionIds || [],
      }
    } catch (error) {
      console.error('删除项目失败:', error)
      return { success: false, deleted: 0, sessionIds: [], error }
    }
  }

  /**
   * 手动注册项目目录（侧栏快捷入口）。
   * 同路径已注册时为幂等成功，调用方随后重拉侧栏即可。
   */
  const createProjectGroup = async (
    projectPath: string,
  ): Promise<{ success: boolean; group?: ProjectGroup; error?: unknown }> => {
    try {
      const group = await apiService.createProjectGroup(projectPath)
      return { success: true, group }
    } catch (error) {
      console.error('创建项目失败:', error)
      return { success: false, error }
    }
  }

  /** 归档项目：归档其下全部对话（流式输出中的跳过） */  const archiveProjectGroup = async (
    groupId: string,
  ): Promise<{
    success: boolean
    archived: number
    skipped: number
    sessionIds: string[]
    error?: unknown
  }> => {
    try {
      const result = await apiService.archiveProjectGroup(groupId)
      return {
        success: true,
        archived: result.archived,
        skipped: result.skipped,
        sessionIds: result.sessionIds || [],
      }
    } catch (error) {
      console.error('归档项目失败:', error)
      return { success: false, archived: 0, skipped: 0, sessionIds: [], error }
    }
  }

  return {
    // 状态
    groups,
    hasLoaded,
    expandedState,
    isLoadingGroups,
    loadingMoreGroupId,
    groupingMode,
    projectGroups,
    projectGroupsLoaded,

    // 计算属性
    sortedGroups,
    sortedProjectGroups,
    isExpanded,

    // Actions
    loadGroups,
    setGroups,
    toggleExpand,
    setExpand,
    createGroup,
    updateGroup,
    deleteGroup,
    reorderGroups,
    archiveGroup,
    setLoadingMore,
    setProjectGroups,
    renameProjectGroup,
    reorderProjectGroups,
    deleteProjectGroup,
    createProjectGroup,
    archiveProjectGroup,
  }
})
