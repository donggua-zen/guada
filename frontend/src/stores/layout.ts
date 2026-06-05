// stores/layout.ts
import { defineStore } from 'pinia'
import { useStorage } from '@vueuse/core'

/**
 * 全局布局状态 Store
 * 管理侧边栏、工作目录等跨页面共享的布局状态
 */
export const useLayoutStore = defineStore('layout', () => {
  // 侧边栏可见性（持久化到 localStorage）
  const sidebarVisible = useStorage('sidebarVisible', true)

  // 工作目录可见性（持久化）
  const workspaceVisible = useStorage('workspaceVisible', false)

  // 工作目录分割比例（持久化，默认 pane1=75%, pane2=25%）
  const workspaceSplitSize = useStorage('workspaceSplitSize', 75)

  /**
   * 切换侧边栏显示/隐藏
   */
  const toggleSidebar = (): void => {
    sidebarVisible.value = !sidebarVisible.value
  }

  /**
   * 设置侧边栏显隐状态
   */
  const setSidebarVisible = (visible: boolean): void => {
    sidebarVisible.value = visible
  }

  /**
   * 切换工作目录显示/隐藏
   */
  const toggleWorkspace = (): void => {
    workspaceVisible.value = !workspaceVisible.value
  }

  /**
   * 设置工作目录分割比例
   */
  const setWorkspaceSplitSize = (size: number): void => {
    workspaceSplitSize.value = size
  }

  return {
    sidebarVisible,
    workspaceVisible,
    workspaceSplitSize,
    toggleSidebar,
    setSidebarVisible,
    toggleWorkspace,
    setWorkspaceSplitSize
  }
})
