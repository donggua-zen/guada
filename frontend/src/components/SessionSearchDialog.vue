<template>
  <GdDialog v-model="dialogVisible" size="sm" :close-on-click-modal="true" :show-close="false"
    append-to-body class="session-search-dialog" @open="handleOpen">
    <!-- 搜索输入 -->
    <div class="flex items-center gap-2 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
      <Search16Regular class="w-4 h-4 text-gray-400 shrink-0" />
      <input ref="inputRef" v-model="keyword" type="text" :placeholder="t('session.search.placeholder')"
        class="flex-1 bg-transparent outline-none text-sm text-(--gd-color-text) placeholder-gray-400"
        @keyup.enter="doSearch" @keyup.esc="dialogVisible = false" />
      <span v-if="isSearching" class="text-xs text-gray-400">{{ t('session.search.searching') }}</span>
    </div>

    <!-- 搜索结果 -->
    <div ref="resultsScrollRef" class="max-h-80 overflow-y-auto py-1">
      <!-- 扫描中（尚无结果） -->
      <div v-if="isSearching && searchResults.length === 0" class="flex flex-col items-center justify-center py-10 text-gray-400">
        <el-icon class="animate-spin text-2xl mb-2">
          <Loading />
        </el-icon>
        <span class="text-xs">{{ scanningText }}</span>
      </div>

      <!-- 结果列表 -->
      <template v-else-if="searchResults.length > 0">
        <div v-for="group in groupedResults" :key="group.id" class="mb-1">
          <!-- 分组标题 -->
          <div class="px-4 py-1 flex items-center gap-1.5 text-xs font-medium text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-800/50">
            <GroupIcon :icon="group.icon" class="w-3.5 h-3.5 shrink-0 text-(--gd-color-primary)" />
            <span>{{ group.name }}</span>
          </div>
          <!-- 分组内会话 -->
          <div v-for="session in group.sessions" :key="session.id"
            class="flex flex-col gap-0.5 px-4 py-2 mx-1 rounded-md cursor-pointer transition-colors duration-150 hover:bg-(--gd-color-sidebar-bg-hover)"
            @click="handleSelectSession(session)">
            <div class="flex items-center gap-2">
              <div class="w-1.5 h-1.5 rounded-full bg-gray-400 opacity-50 shrink-0" />
              <span class="flex-1 truncate text-sm text-(--gd-color-text)" v-html="highlightText(session.title, keyword)">
              </span>
              <span v-if="session.matchType === 'content'"
                class="text-xs text-blue-400 shrink-0 px-1 rounded bg-blue-50 dark:bg-blue-900/30">{{ t('session.search.contentMatch') }}</span>
              <span class="text-xs text-gray-400 shrink-0">{{ formatLastActive(session.lastActiveAt || session.updatedAt) }}</span>
            </div>
            <!-- 内容匹配片段 -->
            <div v-if="session.matchSnippet" class="ml-3.5 text-xs text-gray-500 dark:text-gray-400 truncate"
              v-html="formatSnippet(session.matchSnippet)">
            </div>
          </div>
        </div>

        <!-- 扫描进度（已有部分结果，继续扫描中） -->
        <div v-if="isSearching" class="flex items-center justify-center py-3 text-gray-400">
          <el-icon class="animate-spin text-sm mr-1"><Loading /></el-icon>
          <span class="text-xs">{{ scanningText }}</span>
        </div>
      </template>

      <!-- 空状态 -->
      <div v-else-if="hasSearched && !isSearching" class="flex flex-col items-center justify-center py-10 text-gray-400">
        <Search16Regular class="w-8 h-8 mb-2 opacity-40" />
        <span class="text-xs">{{ t('session.search.noResults') }}</span>
      </div>

      <!-- 初始状态 -->
      <div v-else-if="!isSearching" class="flex flex-col items-center justify-center py-10 text-gray-400">
        <Search16Regular class="w-8 h-8 mb-2 opacity-30" />
        <span class="text-xs">{{ t('session.search.initial') }}</span>
      </div>
    </div>
  </GdDialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { Search16Regular } from '@vicons/fluent'
import { Loading } from '@element-plus/icons-vue'
import { useDebounceFn } from '@vueuse/core'
import { apiService } from '@/services/ApiService'
import { GENERAL_PROJECT_GROUP_ID, useSessionGroupStore } from '@/stores/sessionGroup'
import { UNGROUPED_ID } from '@/stores/session'
import { resolveProjectBucketId } from '@/utils/projectGroupBucket'
import type { SearchSessionResult } from '@/types/session'
import GdDialog from '@/components/ui/GdDialog.vue'
import GroupIcon from '@/components/session/GroupIcon.vue'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const { t } = useI18n()
const router = useRouter()
const sessionGroupStore = useSessionGroupStore()

/** 渐进扫描轮次间隔（ms）：让出渲染，逐批出结果 */
const SCAN_LOOP_INTERVAL_MS = 50

const dialogVisible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
})

const inputRef = ref<HTMLInputElement | null>(null)
const keyword = ref('')
const isSearching = ref(false)
const hasSearched = ref(false)
const searchResults = ref<SearchSessionResult[]>([])
const nextCursor = ref<string | null>(null)
const hasMore = ref(false)
const progress = ref<{ scanned: number; total: number } | null>(null)
/**
 * 搜索代次：每次新搜索/清空/关闭弹窗自增，
 * 在途扫描循环据此作废（快速连续输入时旧结果不追加、旧循环终止）
 */
let searchGen = 0

/** 搜索结果按当前分组模式归类，仅展示有结果的分组 */
const groupedResults = computed(() => {
  const result: { id: string; name: string; icon?: string | null; sessions: SearchSessionResult[] }[] = []

  // 目录模式：按工作目录桶归类（键由后端下发，未注册目录归「通用」）
  if (sessionGroupStore.groupingMode === 'workspace') {
    const buckets = [
      ...sessionGroupStore.sortedProjectGroups
        .filter((g) => g.kind === 'workspace')
        .map((g) => ({ id: g.id, name: g.name, icon: g.icon })),
      { id: GENERAL_PROJECT_GROUP_ID, name: t('ui.sidebar.projectGeneral'), icon: null },
    ]
    for (const bucket of buckets) {
      const sessions = searchResults.value.filter(
        (s) => resolveProjectBucketId(s, sessionGroupStore.projectGroups) === bucket.id,
      )
      if (sessions.length > 0) {
        result.push({ ...bucket, sessions })
      }
    }
    return result
  }

  const groups = [...sessionGroupStore.sortedGroups]
  groups.push({
    id: UNGROUPED_ID,
    name: t('session.search.ungrouped'),
    sortOrder: groups.length,
    createdAt: '',
    updatedAt: '',
  })

  for (const group of groups) {
    const targetGroupId = group.id === UNGROUPED_ID ? null : group.id
    const sessions = searchResults.value.filter(s => (s.groupId || null) === targetGroupId)
    if (sessions.length > 0) {
      result.push({ id: group.id, name: group.name, icon: group.icon, sessions })
    }
  }
  return result
})

const scanningText = computed(() => {
  const p = progress.value
  if (p && p.total > 0) return t('session.search.scanning', { scanned: p.scanned, total: p.total })
  return t('session.search.searching')
})

const resetResults = () => {
  searchResults.value = []
  hasSearched.value = false
  nextCursor.value = null
  hasMore.value = false
  progress.value = null
}

const appendResults = (items: SearchSessionResult[]) => {
  if (!items?.length) return
  const seen = new Set(searchResults.value.map(s => s.id))
  for (const item of items) {
    if (!seen.has(item.id)) {
      seen.add(item.id)
      searchResults.value.push(item)
    }
  }
}

const doSearch = async () => {
  const trimmed = keyword.value.trim()
  const gen = ++searchGen
  resetResults()
  if (!trimmed) {
    isSearching.value = false
    return
  }

  isSearching.value = true
  try {
    // 首批：标题命中先行 + 扫描清单规模（progress.total）
    const data = await apiService.searchSessions(trimmed)
    if (gen !== searchGen) return
    appendResults(data.items || [])
    nextCursor.value = data.nextCursor
    hasMore.value = data.hasMore
    if (data.progress) progress.value = data.progress
    hasSearched.value = true

    // 渐进扫描：自动连续拉批直到扫完 / 关键词变化 / 弹窗关闭（VSCode 式逐会话出结果）
    while (hasMore.value && nextCursor.value && gen === searchGen && dialogVisible.value) {
      await new Promise(resolve => setTimeout(resolve, SCAN_LOOP_INTERVAL_MS))
      if (gen !== searchGen || !dialogVisible.value) return
      const batch = await apiService.searchSessions(trimmed, nextCursor.value)
      if (gen !== searchGen) return
      appendResults(batch.items || [])
      nextCursor.value = batch.nextCursor
      hasMore.value = batch.hasMore
      if (batch.progress) progress.value = batch.progress
    }
  } catch (error) {
    console.error('搜索会话失败:', error)
    hasSearched.value = true
  } finally {
    if (gen === searchGen) isSearching.value = false
  }
}

const debouncedSearch = useDebounceFn(doSearch, 300)

watch(keyword, () => {
  if (keyword.value.trim()) {
    debouncedSearch()
  } else {
    searchGen++
    resetResults()
    isSearching.value = false
  }
})

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
    searchGen++
    keyword.value = ''
    resetResults()
    isSearching.value = false
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

/** 格式化 snippet — 将后端搜索的 【】 标记转为高亮 */
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
  if (minutes < 1) return t('session.search.timeNow')
  if (minutes < 60) return t('session.search.timeMin', { n: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('session.search.timeHour', { n: hours })
  const days = Math.floor(hours / 24)
  if (days < 30) return t('session.search.timeDay', { n: days })
  const months = Math.floor(days / 30)
  if (months < 12) return t('session.search.timeMonth', { n: months })
  return t('session.search.timeEarlier')
}
</script>

<style scoped>
/* GdDialog scoped styles handle dialog body/header — no :deep overrides needed */
</style>
