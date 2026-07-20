<template>
    <div class="flex flex-col gap-3">
        <!-- 搜索 + 筛选栏 -->
        <div class="flex items-center gap-2">
            <el-input v-model="searchKeyword" placeholder="搜索归档会话..." clearable size="small"
                class="flex-1 min-w-40" @keyup.enter="handleSearch" @clear="handleSearch">
                <template #prefix>
                    <Search16Regular class="w-4 h-4 text-gray-400" />
                </template>
            </el-input>
            <el-select v-model="filterGroupId" placeholder="全部分组" size="small" clearable
                style="width: 128px; flex-shrink: 0" @change="handleSearch">
                <el-option label="全部分组" :value="''" />
                <el-option v-for="g in sessionGroupStore.sortedGroups" :key="g.id" :label="g.name" :value="g.id" />
                <el-option label="任务列表（未分组）" :value="UNGROUPED_ID" />
            </el-select>
            <el-button size="small" :loading="isLoading" @click="loadArchivedSessions" circle>
                <el-icon class="w-4 h-4">
                    <ArrowClockwise20Regular />
                </el-icon>
            </el-button>
        </div>

        <!-- 批量操作栏 -->
        <div v-if="archivedSessions.length > 0" class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-3">
                <el-checkbox v-model="selectAll" @change="handleSelectAll">全选</el-checkbox>
                <span class="text-xs text-gray-400" v-if="selectedIds.size > 0">已选 {{ selectedIds.size }} 项</span>
            </div>
            <el-button type="primary" size="small" :disabled="selectedIds.size === 0" :loading="batchLoading"
                @click="handleBatchUnarchive">
                批量取消归档
            </el-button>
        </div>

        <!-- 加载中 -->
        <div v-if="isLoading" class="flex items-center justify-center py-10 text-gray-400">
            <el-icon class="animate-spin text-2xl mr-2">
                <Loading />
            </el-icon>
            <span class="text-sm">加载中...</span>
        </div>

        <!-- 归档会话列表（扁平） -->
        <template v-else-if="archivedSessions.length > 0">
            <div class="rounded-lg border border-gray-100 dark:border-gray-700/40 overflow-hidden">
                <div v-for="(session, idx) in archivedSessions" :key="session.id"
                    class="flex items-center gap-2 px-3 py-2 transition-colors duration-150 hover:bg-(--color-sidebar-bg-hover)"
                    :class="idx < archivedSessions.length - 1 ? 'border-b border-gray-50 dark:border-gray-700/30' : ''">
                    <el-checkbox :model-value="selectedIds.has(session.id)"
                        @change="(val: boolean) => toggleSelect(session.id, val)" />
                    <span class="flex-1 truncate text-sm text-(--color-text)">{{ session.title }}</span>
                    <span class="text-xs text-gray-400 shrink-0">{{ formatLastActive(session.lastActiveAt || session.updatedAt) }}</span>
                    <div class="action-btn p-1 rounded cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20"
                        title="取消归档" @click="handleUnarchive(session)">
                        <el-icon class="w-3.5 h-3.5 text-blue-500">
                            <ArrowUndo20Regular />
                        </el-icon>
                    </div>
                </div>
            </div>

            <!-- 分页 -->
            <div v-if="total > pageSize" class="flex justify-center pt-2">
                <el-pagination v-model:current-page="currentPage" :page-size="pageSize" :total="total"
                    layout="prev, pager, next" size="small" @current-change="handlePageChange" />
            </div>
        </template>

        <!-- 空状态 -->
        <div v-else class="flex flex-col items-center justify-center py-12 text-gray-400">
            <Archive20Regular class="w-10 h-10 mb-3 opacity-30" />
            <span class="text-sm">{{ hasSearched ? '未找到匹配的归档会话' : '暂无已归档的会话' }}</span>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { Archive20Regular, ArrowUndo20Regular, ArrowClockwise20Regular, Search16Regular } from '@vicons/fluent'
import { Loading } from '@element-plus/icons-vue'
import { useDebounceFn } from '@vueuse/core'
import { apiService } from '@/services/ApiService'
import { useSessionGroupStore } from '@/stores/sessionGroup'
import { useSessionStore } from '@/stores/session'
import { UNGROUPED_ID } from '@/stores/session'
import { usePopup } from '@/composables/usePopup'
import type { Session } from '@/types/session'

const sessionGroupStore = useSessionGroupStore()
const sessionStore = useSessionStore()
const { toast, confirm } = usePopup()

const isLoading = ref(false)
const batchLoading = ref(false)
const archivedSessions = ref<Session[]>([])
const selectedIds = ref<Set<string>>(new Set())

const selectAll = ref(false)
const searchKeyword = ref('')
const filterGroupId = ref('')
const currentPage = ref(1)
const pageSize = 20
const total = ref(0)
const hasSearched = ref(false)

const loadArchivedSessions = async () => {
    isLoading.value = true
    try {
        const skip = (currentPage.value - 1) * pageSize
        const groupId = filterGroupId.value === '' ? undefined
            : filterGroupId.value === UNGROUPED_ID ? null
            : filterGroupId.value
        const data = await apiService.fetchArchivedSessions(skip, pageSize, searchKeyword.value.trim() || undefined, groupId)
        archivedSessions.value = data.items || []
        total.value = data.total || 0
        hasSearched.value = !!(searchKeyword.value.trim() || filterGroupId.value)
    } catch (error) {
        console.error('加载归档会话失败:', error)
        toast.error('加载归档会话失败')
    } finally {
        isLoading.value = false
    }
}

const handleSearch = () => {
    currentPage.value = 1
    selectedIds.value = new Set()
    selectAll.value = false
    loadArchivedSessions()
}

const debouncedSearch = useDebounceFn(handleSearch, 300)
watch(searchKeyword, () => {
    if (searchKeyword.value) {
        debouncedSearch()
    } else {
        handleSearch()
    }
})

const handlePageChange = () => {
    selectedIds.value = new Set()
    selectAll.value = false
    loadArchivedSessions()
}

const toggleSelect = (sessionId: string, checked: boolean) => {
    if (checked) {
        selectedIds.value.add(sessionId)
    } else {
        selectedIds.value.delete(sessionId)
    }
    selectedIds.value = new Set(selectedIds.value)
    selectAll.value = archivedSessions.value.length > 0 && selectedIds.value.size === archivedSessions.value.length
}

const handleSelectAll = (checked: boolean) => {
    if (checked) {
        selectedIds.value = new Set(archivedSessions.value.map(s => s.id))
    } else {
        selectedIds.value = new Set()
    }
}

const handleUnarchive = async (session: Session) => {
    try {
        const result = await apiService.archiveSession(session.id, false)
        if (result.success && result.session) {
            sessionStore.setSession(result.session)
            // 移除后如果当前页空了且不是第一页，回到上一页
            if (archivedSessions.value.length === 1 && currentPage.value > 1) {
                currentPage.value--
            }
            await loadArchivedSessions()
            toast.success('已取消归档')
        }
    } catch (error) {
        console.error('取消归档失败:', error)
        toast.error('取消归档失败')
    }
}

const handleBatchUnarchive = async () => {
    if (selectedIds.value.size === 0) return

    const confirmed = await confirm('批量取消归档', `确定要将选中的 ${selectedIds.value.size} 个会话取消归档吗？`, {
        type: 'info',
        confirmText: '确定',
        cancelText: '取消'
    })
    if (!confirmed) return

    batchLoading.value = true
    try {
        const ids = Array.from(selectedIds.value)
        const result = await apiService.batchArchiveSessions(ids, false)

        for (const id of ids) {
            if (!result.skipped.includes(id)) {
                try {
                    const session = await apiService.fetchSession(id)
                    sessionStore.setSession(session)
                } catch {
                    // ignore
                }
            }
        }

        selectedIds.value = new Set()
        selectAll.value = false
        await loadArchivedSessions()

        if (result.skipped.length > 0) {
            toast.warning(`已取消归档，其中 ${result.skipped.length} 个会话因正在流式输出被跳过`)
        } else {
            toast.success('批量取消归档成功')
        }
    } catch (error) {
        console.error('批量取消归档失败:', error)
        toast.error('批量取消归档失败')
    } finally {
        batchLoading.value = false
    }
}

function formatLastActive(dateStr: string | null | undefined): string {
    if (!dateStr) return ''
    const diff = Date.now() - new Date(dateStr).getTime()
    const minutes = Math.floor(diff / 60000)
    if (minutes < 1) return '刚刚'
    if (minutes < 60) return `${minutes}min`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h`
    const days = Math.floor(hours / 24)
    if (days < 30) return `${days}d`
    const months = Math.floor(days / 30)
    if (months < 12) return `${months}m`
    return '更早'
}

onMounted(() => {
    sessionGroupStore.loadGroups()
    loadArchivedSessions()
})
</script>

<style scoped>
.action-btn {
    transition: background-color 0.2s ease;
}
</style>
