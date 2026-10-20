<template>
    <div class="flex flex-col gap-3">
        <!-- 目录模式提示：手工分组在该模式下不生效 -->
        <div v-if="sessionGroupStore.groupingMode === 'workspace'"
            class="text-xs text-amber-600 dark:text-amber-400 px-1 leading-relaxed">
            当前侧栏为「按目录」分组，手工分组不生效；切换到「分组」模式后可继续使用。
        </div>
        <!-- 新建分组 -->
        <div class="flex gap-2">
            <el-input v-model="newGroupName" placeholder="输入新分组名称" maxlength="20" show-word-limit
                @keyup.enter="handleCreateGroup" />
            <el-button type="primary" @click="handleCreateGroup" :disabled="!newGroupName.trim()">
                新建
            </el-button>
        </div>

        <!-- 分组列表（可拖拽排序） -->
        <div class="group-list border border-(--gd-color-border) rounded-lg overflow-hidden">
            <div v-if="groups.length === 0" class="py-8 text-center text-sm text-gray-400">
                暂无自定义分组
            </div>
            <div v-else>
                <draggable v-model="localGroups" item-key="id" handle=".drag-handle"
                    @end="onDragEnd" class="divide-y divide-(--gd-color-border)">
                    <template #item="{ element }">
                        <div
                            class="group-item flex items-center gap-2 px-3 py-2.5 transition-colors duration-200">
                            <!-- 拖拽手柄 -->
                            <div
                                class="drag-handle cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600">
                                <el-icon class="w-4 h-4">
                                    <ReOrderDotsHorizontal20Regular />
                                </el-icon>
                            </div>

                            <!-- 图标 + 名称 -->
                            <GroupIcon :icon="element.icon" class="w-4 h-4 shrink-0 text-(--gd-color-primary)" />
                            <span class="flex-1 text-sm truncate">{{ element.name }}</span>
                            <span class="text-xs text-gray-400">{{ element.sortOrder + 1 }}</span>
                            <div class="flex items-center gap-1">
                                <div
                                    class="action-btn p-1 rounded cursor-pointer hover:bg-gray-100 dark:hover:bg-[#2a2c30]"
                                    @click="startEdit(element)">
                                    <el-icon class="w-3.5 h-3.5 text-gray-500">
                                        <Edit16Regular />
                                    </el-icon>
                                </div>
                                <div
                                    class="action-btn p-1 rounded cursor-pointer hover:bg-red-50 dark:hover:bg-red-900/20"
                                    @click="handleDeleteGroup(element)">
                                    <el-icon class="w-3.5 h-3.5 text-red-400">
                                        <Delete20Regular />
                                    </el-icon>
                                </div>
                            </div>
                        </div>
                    </template>
                </draggable>
            </div>
        </div>

        <!-- 提示信息 -->
        <div class="text-xs text-gray-400 leading-relaxed">
            <p>提示：</p>
            <ul class="list-disc list-inside mt-1 space-y-0.5">
                <li>拖拽可调整分组顺序</li>
                <li>删除分组后，该分组下的会话将自动归入"任务列表"</li>
                <li>"任务列表"为默认分组，不可删除或重命名</li>
            </ul>
        </div>

        <!-- 分组编辑弹窗（名称 + 图标） -->
        <GroupEditDialog v-model="editVisible" kind="group" :group="editGroup" />
    </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import draggable from 'vuedraggable'
import { useSessionGroupStore } from '@/stores/sessionGroup'
import { usePopup } from '@/composables/usePopup'
import { ReOrderDotsHorizontal20Regular, Edit16Regular, Delete20Regular } from '@vicons/fluent'
import GroupEditDialog from '@/components/session/GroupEditDialog.vue'
import GroupIcon from '@/components/session/GroupIcon.vue'
import type { SessionGroup } from '@/types/session'

const sessionGroupStore = useSessionGroupStore()
const { toast, confirm } = usePopup()

const newGroupName = ref('')
const localGroups = ref<SessionGroup[]>([])
const editVisible = ref(false)
const editGroup = ref<SessionGroup | null>(null)

const groups = computed(() => sessionGroupStore.sortedGroups)

watch(groups, (newGroups) => {
    localGroups.value = [...newGroups]
}, { deep: true, immediate: true })

const handleCreateGroup = async () => {
    const name = newGroupName.value.trim()
    if (!name) return
    const group = await sessionGroupStore.createGroup(name)
    if (group) {
        toast.success('分组创建成功')
        newGroupName.value = ''
    } else {
        toast.error('分组创建失败')
    }
}

const startEdit = (group: SessionGroup) => {
    editGroup.value = group
    editVisible.value = true
}

const handleDeleteGroup = async (group: SessionGroup) => {
    const confirmed = await confirm('删除分组', `确定要删除分组 "${group.name}" 吗？该分组下的会话将自动归入未分组。`, {
        type: 'warning',
        confirmText: '删除',
        cancelText: '取消'
    })
    if (confirmed) {
        const success = await sessionGroupStore.deleteGroup(group.id)
        if (success) {
            toast.success('分组已删除')
        } else {
            toast.error('删除失败')
        }
    }
}

const onDragEnd = async () => {
    const orderedIds = localGroups.value.map(g => g.id)
    const success = await sessionGroupStore.reorderGroups(orderedIds)
    if (success) {
        toast.success('分组顺序已更新')
    } else {
        toast.error('排序更新失败')
        localGroups.value = [...groups.value]
    }
}
</script>

<style scoped>
.group-list {
    max-height: 500px;
    overflow-y: auto;
}

.group-item:hover {
    background-color: var(--gd-color-sidebar-bg-hover);
}

.drag-handle {
    touch-action: none;
}

.action-btn {
    transition: background-color 0.2s ease;
}
</style>
