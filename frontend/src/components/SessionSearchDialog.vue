<template>
  <el-dialog v-model="dialogVisible" width="520px" :close-on-click-modal="true" :show-close="false"
    append-to-body class="session-search-dialog" @open="handleOpen">
    <!-- 搜索输入 -->
    <div class="flex items-center gap-2 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
      <Search16Regular class="w-4 h-4 text-gray-400 shrink-0" />
      <input ref="inputRef" v-model="keyword" type="text" placeholder="搜索会话标题或内容..."
        class="flex-1 bg-transparent outline-none text-sm text-(--color-text) placeholder-gray-400"
        @keyup.enter="doSearch" @keyup.esc="dialogVisible = false" />
      <span v-if="isSearching" class="text-xs text-gray-400">搜索中...</span>
    </div>

    <!-- 搜索结果 -->
    <div ref="resultsScrollRef" class="max-h-80 overflow-y-auto py-1" @scroll="handleScroll">
      <!-- 加载状态 -->
      <div v-if="isSearching && searchResults.length === 0" class="flex flex-col items-center justify-center py-10 text-gray-400">
        <el-icon class="animate-spin text-2xl mb-2">
          <Loading />
        </el-icon>
        <span class="text-xs">搜索中...</span>
      </div>

      <!-- 结果列表 -->
      <template v-else-if="searchResults.length > 0">
        <div v-for="group in groupedResults" :key="group.id" class="mb-1">
          <!-- 分组标题 -->
          <div class="px-4 py-1 text-xs font-medium text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-800/50">
            {{ group.name }}
          </div>
          <!-- 分组内会话 -->
          <div v-for="session in group.sessions" :key="session.id"
            class="flex flex-col gap-0.5 px-4 py-2 mx-1 rounded-md cursor-pointer transition-colors duration-150 hover:bg-(--color-sidebar-bg-hover)"
            @click="handleSelectSession(session)">
            <div class="flex items-center gap-2">
              <div class="w-1.5 h-1.5 rounded-full bg-gray-400 opacity-50 shrink-0" />
              <span class="flex-1 truncate text-sm text-(--color-text)" v-html="highlightText(session.title, keyword)">
              </span>
              <span v-if="session.matchType === 'content'"
                class="text-xs text-blue-400 shrink-0 px-1 rounded bg-blue-50 dark:bg-blue-900/30">内容</span>
              <span class="text-xs text-gray-400 shrink-0">{{ formatLastActive(session.lastActiveAt || session.updatedAt) }}</span>
            </div>
            <!-- 内容匹配片段 -->
            <div v-if="session.matchSnippet" class="ml-3.5 text-xs text-gray-500 dark:text-gray-400 truncate"
              v-html="formatSnippet(session.matchSnippet)">
            </div>
          </div>
        </div>

        <!-- 加载更多 -->
        <div v-if="isLoadingMore" class="flex items-center justify-center py-3 text-gray-400">
          <el-icon class="animate-spin text-sm mr-1"><Loading /></el-icon>
          <span class="text-xs">加载中...</span>
        </div>
        <div v-else-if="hasMore" class="flex items-center justify-center py-3 text-gray-400">
          <button class="text-xs hover:text-(--color-text) transition-colors" @click="loadMore">加载更多</button>
        </div>
      </template>

      <!-- 空状态 -->
      <div v-else-if="hasSearched" class="flex flex-col items-center justify-center py-10 text-gray-400">
        <Search16Regular class="w-8 h-8 mb-2 opacity-40" />
        <span class="text-xs">未找到匹配的会话</span>
      </div>

      <!-- 初始状态 -->
      <div v-else class="flex flex-col items-center justify-center py-10 text-gray-400">
        <Search16Regular class="w-8 h-8 mb-2 opacity-30" />
        <span class="text-xs">输入关键词搜索会话</span>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { Search16Regular } from '@vicons/fluent'
import { Loading } from '@element-plus/icons-vue'
import { useDebounceFn } from '@vueuse/core'
import { apiService } from '@/services/ApiService'
import { useSessionGroupStore } from '@/stores/sessionGroup'
import { UNGROUPED_ID } from '@/stores/session'
import type { SearchSessionResult } from '@/types/session'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const router = useRouter()
const sessionGroupStore = useSessionGroupStore()

const dialogVisible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
})

const inputRef = ref<HTMLInputElement | null>(null)
const resultsScrollRef = ref<HTMLElement | null>(null)
const keyword = ref('')
const isSearching = ref(false)
const hasSearched = ref(false)
const searchResults = ref<SearchSessionResult[]>([])
const nextCursor = ref<string | null>(null)
const hasMore = ref(false)
const isLoadingMore = ref(false)

/** 搜索结果按分组归类，仅展示有结果的分组 */
const groupedResults = computed(() => {
  const groups = [...sessionGroupStore.sortedGroups]
  groups.push({
    id: UNGROUPED_ID,
    name: '任务列表',
    userId: '',
    sortOrder: groups.length,
    createdAt: '',
    updatedAt: '',
  })

  const result: { id: string; name: string; sessions: SearchSessionResult[] }[] = []
  for (const group of groups) {
    const targetGroupId = group.id === UNGROUPED_ID ? null : group.id
    const sessions = searchResults.value.filter(s => (s.groupId || null) === targetGroupId)
    if (sessions.length > 0) {
      result.push({ id: group.id, name: group.name, sessions })
    }
  }
  return result
})

const doSearch = async () => {
  const trimmed = keyword.value.trim()
  if (!trimmed) {
    searchResults.value = []
    hasSearched.value = false
    nextCursor.value = null
    hasMore.value = false
    return
  }

  isSearching.value = true
  hasSearched.value = false
  try {
    const data = await apiService.searchSessions(trimmed)
    searchResults.value = data.items || []
    nextCursor.value = data.nextCursor
    hasMore.value = data.hasMore
    hasSearched.value = true
  } catch (error) {
    console.error('搜索会话失败:', error)
    searchResults.value = []
    hasSearched.value = true
  } finally {
    isSearching.value = false
  }
}

const debouncedSearch = useDebounceFn(doSearch, 300)

watch(keyword, () => {
  if (keyword.value.trim()) {
    debouncedSearch()
  } else {
    searchResults.value = []
    hasSearched.value = false
    nextCursor.value = null
    hasMore.value = false
  }
})

const loadMore = async () => {
  if (!hasMore.value || !nextCursor.value || isLoadingMore.value) return

  isLoadingMore.value = true
  try {
    const data = await apiService.searchSessions(keyword.value.trim(), nextCursor.value)
    searchResults.value = [...searchResults.value, ...(data.items || [])]
    nextCursor.value = data.nextCursor
    hasMore.value = data.hasMore
  } catch (error) {
    console.error('加载更多失败:', error)
  } finally {
    isLoadingMore.value = false
  }
}

/** 滚动到底部自动加载 */
const handleScroll = () => {
  const el = resultsScrollRef.value
  if (!el || !hasMore.value || isLoadingMore.value) return
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 30) {
    loadMore()
  }
}

const handleSelectSession = (session: SearchSessionResult) => {
  router.replace({ name: 'Chat', params: { sessionId: session.id } })
  dialogVisible.value = false
}

const handleOpen = () => {
  nextTick(() => {
    inputRef.value?.focus()
  })
}

watch(dialogVisible, (visible) => {
  if (!visible) {
    keyword.value = ''
    searchResults.value = []
    hasSearched.value = false
    nextCursor.value = null
    hasMore.value = false
  }
})

/** 高亮匹配文本 */
function highlightText(text: string, query: string): string {
  if (!query || !text) return text
  try {
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    const escapedKeyword = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return escaped.replace(new RegExp(`(${escapedKeyword})`, 'gi'),
      '<mark class="bg-yellow-200 dark:bg-yellow-700 px-0.5 rounded">$1</mark>')
  } catch {
    return text
  }
}

/** 格式化 snippet — 将 FTS5 的 【】 标记转为高亮 */
function formatSnippet(snippet: string): string {
  if (!snippet) return ''
  const escaped = snippet
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return escaped
    .replace(/【/g, '<mark class="bg-yellow-200 dark:bg-yellow-700 px-0.5 rounded">')
    .replace(/】/g, '</mark>')
}

/** 格式化最后活跃时间 */
function formatLastActive(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}m`
  return '更早'
}
</script>

<style scoped>
.session-search-dialog :deep(.el-dialog__body) {
  padding: 0;
}

.session-search-dialog :deep(.el-dialog__header) {
  display: none;
}
</style>
