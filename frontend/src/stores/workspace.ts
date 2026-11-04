// stores/workspace.ts
import { defineStore } from 'pinia'
import { useStorage } from '@vueuse/core'
import { ref, computed } from 'vue'
import { apiService } from '@/services/ApiService'
import {
  resolveWorkspaceChoiceMode,
  type WorkspaceChoice,
  type WorkspaceChoiceMode,
} from '@/utils/workspaceChoice'

export type { WorkspaceChoice, WorkspaceChoiceMode }

const MAX_RECENT = 10

export const useWorkspaceStore = defineStore('workspace', () => {
  const recentWorkspaces = useStorage<string[]>('recentWorkspaces', [])
  const lastChoice = useStorage<WorkspaceChoice | null>('lastWorkspaceChoice', null, undefined, {
    serializer: {
      read: (v) => {
        if (!v) return null
        try { return JSON.parse(v) as WorkspaceChoice } catch { return null }
      },
      write: (v) => JSON.stringify(v),
    },
  })
  const baseDir = ref<string | null>(null)

  const recentList = computed(() => recentWorkspaces.value)

  function addRecent(path: string) {
    if (!path) return
    const trimmed = path.trim()
    if (!trimmed) return
    const list = recentWorkspaces.value.filter((p) => p !== trimmed)
    list.unshift(trimmed)
    if (list.length > MAX_RECENT) list.length = MAX_RECENT
    recentWorkspaces.value = list
  }

  function removeRecent(path: string) {
    recentWorkspaces.value = recentWorkspaces.value.filter((p) => p !== path)
  }

  let baseDirPromise: Promise<string | null> | null = null

  async function ensureBaseDir(): Promise<string | null> {
    if (baseDir.value) return baseDir.value
    if (baseDirPromise) return baseDirPromise
    baseDirPromise = (async () => {
      try {
        const response = await apiService.fetchWorkspaceBaseDir()
        baseDir.value = response.workspaceBaseDir
        return baseDir.value
      } catch (e) {
        console.error('Failed to fetch workspace base dir:', e)
        return null
      } finally {
        baseDirPromise = null
      }
    })()
    return baseDirPromise
  }

  function getPublicPath(): string | null {
    if (!baseDir.value) return null
    const normalized = baseDir.value.replace(/\\/g, '/')
    return normalized.endsWith('/') ? normalized + 'public' : normalized + '/public'
  }

  /**
   * 记录「上次选择」。
   * 每次都赋新对象（而不是就地改字段），新建页据此 watch 到变化后重新套用目录 ——
   * 侧栏「+」重复点同一分组时 URL 不变，只能靠 store 变化驱动。
   */
  function setLastChoice(mode: WorkspaceChoiceMode, path: string | null) {
    lastChoice.value = { mode, path }
  }

  function getLastChoice(): WorkspaceChoice | null {
    return lastChoice.value
  }

  /**
   * 按目标路径记录「上次选择」：推断模式 + 记入最近列表。
   * 新建页工具栏、定时任务编辑器、侧栏分组「+」三个入口共用，避免各自复制推断分支。
   */
  function applyChoice(workspacePath: string | null) {
    setLastChoice(resolveWorkspaceChoiceMode(workspacePath, getPublicPath()), workspacePath)
    if (workspacePath) addRecent(workspacePath)
  }

  return {
    recentList,
    baseDir,
    lastChoice,
    addRecent,
    removeRecent,
    ensureBaseDir,
    getPublicPath,
    setLastChoice,
    getLastChoice,
    applyChoice,
  }
})
