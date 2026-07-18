<template>
    <div class="flex flex-col gap-3">
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

        <!-- 归档会话列表（按分组归类） -->
        <template v-else-if="archivedSessions.length > 0">
            <div v-for="group in groupedResults" :key="group.id" class="mb-3">
                <!-- 分组标题 -->
                <div class="flex items-center gap-1.5 px-1 mb-1 text-xs font-medium text-gray-400 dark:text-gray-500">
                    <span>{{ group.name }}</span>
                    <span class="text-gray-300 dark:text-gray-600">{{ group.sessions.length }}</span>
                </div>
                <!-- 分组内会话 -->
                <div class="rounded-lg border border-gray-100 dark:border-gray-700/40 overflow-hidden">
                    <div v-for="(session, idx) in group.sessions" :key="session.id"
                        class="flex items-center gap-2 px-3 py-2 transition-colors duration-150 hover:bg-(--color-sidebar-bg-hover)"
                        :class="idx < group.sessions.length - 1 ? 'border-b border-gray-50 dark:border-gray-700/30' : ''">
                        <el-checkbox :model-value="selectedIds.has(session.id)"
                            @change="(val: boolean) => toggleSelect(session.id, val)" />
                        <div class="w-1.5 h-1.5 rounded-full bg-gray-400 opacity-50 shrink-0" />
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
            </div>
        </template>

        <!-- 空状态 -->
        <div v-else class="flex flex-col items-center justify-center py-12 text-gray-400">
            <Archive20Regular class="w-10 h-10 mb-3 opacity-30" />
            <span class="text-sm">暂无已归档的会话</span>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Archive20Regular, ArrowUndo20Regular } from '@vicons/fluent'
import { Loading } from '@element-plus/icons-vue'
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

/** 归档会话按分组归类，仅展示有结果的分组 */
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

    const result: { id: string; name: string; sessions: Session[] }[] = []
    for (const group of groups) {
        const targetGroupId = group.id === UNGROUPED_ID ? null : group.id
        const sessions = archivedSessions.value.filter(s => (s.groupId || null) === targetGroupId)
        if (sessions.length > 0) {
            result.push({ id: group.id, name: group.name, sessions })
        }
    }
    return result
})

const loadArchivedSessions = async () => {
    isLoading.value = true
    try {
        const data = await apiService.fetchArchivedSessions(0, 200)
        archivedSessions.value = data.items || []
    } catch (error) {
        console.error('加载归档会话失败:', error)
        toast.error('加载归档会话失败')
    } finally {
        isLoading.value = false
    }
}

const toggleSelect = (sessionId: string, checked: boolean) => {
    if (checked) {
        selectedIds.value.add(sessionId)
    } else {
        selectedIds.value.delete(sessionId)
    }
    // 触发响应式更新
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

/** 单条取消归档 */
const handleUnarchive = async (session: Session) => {
    try {
        const result = await apiService.archiveSession(session.id, false)
        if (result.success && result.session) {
            // 将会话重新加入 sessionStore（后端已更新 lastActiveAt）
            sessionStore.setSession(result.session)
            // 从归档列表移除
            archivedSessions.value = archivedSessions.value.filter(s => s.id !== session.id)
            selectedIds.value.delete(session.id)
            selectedIds.value = new Set(selectedIds.value)
            toast.success('已取消归档')
        }
    } catch (error) {
        console.error('取消归档失败:', error)
        toast.error('取消归档失败')
    }
}

/** 批量取消归档 */
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

        // 逐个查询取消归档后的会话并加入 sessionStore
        for (const id of ids) {
            if (!result.skipped.includes(id)) {
                try {
                    const session = await apiService.fetchSession(id)
                    sessionStore.setSession(session)
                } catch {
                    // 忽略单个查询失败
                }
            }
        }

        // 从归档列表移除成功取消归档的会话
        const skippedSet = new Set(result.skipped)
        archivedSessions.value = archivedSessions.value.filter(s => !ids.includes(s.id) || skippedSet.has(s.id))
        selectedIds.value = new Set()
        selectAll.value = false

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
