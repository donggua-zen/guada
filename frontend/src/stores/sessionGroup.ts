import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { apiService } from '@/services/ApiService'
import type { SessionGroup } from '@/types/session'

/**
 * 未分组的默认分组ID（虚拟ID，不对应后端实体）
 */
export const UNGROUPED_ID = '__ungrouped__'

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

  /** 当前正在加载更多的分组ID */
  const loadingMoreGroupId = ref<string | null>(null)

  // ========== 计算属性 ==========

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

      // 初始化展开状态（默认展开）
      for (const group of data || []) {
        if (!expandedState.value.has(group.id)) {
          expandedState.value.set(group.id, true)
        }
      }
    } catch (error) {
      console.error('加载会话分组失败:', error)
    } finally {
      isLoadingGroups.value = false
    }
  }

  /**
   * 切换分组展开/折叠状态
   */
  const toggleExpand = (groupId: string): void => {
    const current = expandedState.value.get(groupId) ?? true
    expandedState.value.set(groupId, !current)
  }

  /**
   * 设置分组展开状态
   */
  const setExpand = (groupId: string, expanded: boolean): void => {
    expandedState.value.set(groupId, expanded)
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
   * 设置加载更多状态
   */
  const setLoadingMore = (groupId: string | null): void => {
    loadingMoreGroupId.value = groupId
  }

  return {
    // 状态
    groups,
    hasLoaded,
    expandedState,
    isLoadingGroups,
    loadingMoreGroupId,

    // 计算属性
    sortedGroups,
    isExpanded,

    // Actions
    loadGroups,
    toggleExpand,
    setExpand,
    createGroup,
    updateGroup,
    deleteGroup,
    reorderGroups,
    setLoadingMore,
  }
})
