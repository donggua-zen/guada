// stores/workspace.ts
import { defineStore } from 'pinia'
import { useStorage } from '@vueuse/core'
import { computed } from 'vue'

const MAX_RECENT = 10

export const useWorkspaceStore = defineStore('workspace', () => {
  const recentWorkspaces = useStorage<string[]>('recentWorkspaces', [])

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

  return {
    recentList,
    addRecent,
    removeRecent,
  }
})
