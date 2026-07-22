// stores/workspace.ts
import { defineStore } from 'pinia'
import { useStorage } from '@vueuse/core'
import { ref, computed } from 'vue'
import { apiService } from '@/services/ApiService'

const MAX_RECENT = 10

export type WorkspaceChoiceMode = 'auto' | 'public' | 'custom'

export interface WorkspaceChoice {
  mode: WorkspaceChoiceMode
  path: string | null
}

export const useWorkspaceStore = defineStore('workspace', () => {
  const recentWorkspaces = useStorage<string[]>('recentWorkspaces', [])
  const lastChoice = useStorage<WorkspaceChoice | null>('lastWorkspaceChoice', null)
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

  async function ensureBaseDir(): Promise<string | null> {
    if (baseDir.value) return baseDir.value
    try {
      const response = await apiService.fetchWorkspaceBaseDir()
      baseDir.value = response.workspaceBaseDir
      return baseDir.value
    } catch (e) {
      console.error('Failed to fetch workspace base dir:', e)
      return null
    }
  }

  function getPublicPath(): string | null {
    if (!baseDir.value) return null
    const normalized = baseDir.value.replace(/\\/g, '/')
    return normalized.endsWith('/') ? normalized + 'public' : normalized + '/public'
  }

  function setLastChoice(mode: WorkspaceChoiceMode, path: string | null) {
    lastChoice.value = { mode, path }
  }

  function getLastChoice(): WorkspaceChoice | null {
    return lastChoice.value
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
  }
})
