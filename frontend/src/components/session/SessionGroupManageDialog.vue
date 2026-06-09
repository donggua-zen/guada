<template>
  <el-dialog v-model="dialogVisible" title="分组管理" width="420px" :close-on-click-modal="false"
    destroy-on-close>
    <div class="flex flex-col gap-3">
      <!-- 新建分组 -->
      <div class="flex gap-2">
        <el-input v-model="newGroupName" placeholder="输入新分组名称" maxlength="20" show-word-limit
          @keyup.enter="handleCreateGroup" />
        <el-button type="primary" @click="handleCreateGroup" :disabled="!newGroupName.trim()">
          新建
        </el-button>
      </div>

      <!-- 分组列表（可拖拽排序） -->
      <div class="group-list border border-(--color-border) rounded-lg overflow-hidden">
        <div v-if="groups.length === 0" class="py-8 text-center text-sm text-gray-400">
          暂无自定义分组
        </div>
        <div v-else>
          <draggable v-model="localGroups" item-key="id" handle=".drag-handle"
            @end="onDragEnd" class="divide-y divide-(--color-border)">
            <template #item="{ element, index }">
              <div
                class="group-item flex items-center gap-2 px-3 py-2.5 transition-colors duration-200"
                :class="{ 'bg-(--color-surface)': editingId === element.id }">
                <!-- 拖拽手柄 -->
                <div class="drag-handle cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600">
                  <el-icon class="w-4 h-4">
                    <ReOrderDotsHorizontal20Regular />
                  </el-icon>
                </div>

                <!-- 分组名称（编辑模式） -->
                <template v-if="editingId === element.id">
                  <el-input v-model="editingName" size="small" maxlength="20" class="flex-1"
                    @keyup.enter="saveEdit" @keyup.esc="cancelEdit" />
                  <el-button type="primary" size="small" @click="saveEdit">保存</el-button>
                  <el-button size="small" @click="cancelEdit">取消</el-button>
                </template>

                <!-- 分组名称（展示模式） -->
                <template v-else>
                  <span class="flex-1 text-sm truncate">{{ element.name }}</span>
                  <span class="text-xs text-gray-400">{{ element.sortOrder + 1 }}</span>
                  <div class="flex items-center gap-1">
                    <div class="action-btn p-1 rounded cursor-pointer hover:bg-gray-100 dark:hover:bg-[#2a2c30]"
                      @click="startEdit(element)">
                      <el-icon class="w-3.5 h-3.5 text-gray-500">
                        <Edit16Regular />
                      </el-icon>
                    </div>
                    <div class="action-btn p-1 rounded cursor-pointer hover:bg-red-50 dark:hover:bg-red-900/20"
                      @click="handleDeleteGroup(element)">
                      <el-icon class="w-3.5 h-3.5 text-red-400">
                        <Delete20Regular />
                      </el-icon>
                    </div>
                  </div>
                </template>
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
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import draggable from 'vuedraggable'
import { useSessionGroupStore } from '@/stores/sessionGroup'
import { usePopup } from '@/composables/usePopup'
import { ReOrderDotsHorizontal20Regular, Edit16Regular, Delete20Regular } from '@vicons/fluent'
import type { SessionGroup } from '@/types/session'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'close'): void
}>()

const sessionGroupStore = useSessionGroupStore()
const { toast, confirm } = usePopup()

// 弹窗可见性
const dialogVisible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
})

// 新建分组名称
const newGroupName = ref('')

// 本地分组列表（用于拖拽排序）
const localGroups = ref<SessionGroup[]>([])

// 编辑状态
const editingId = ref<string | null>(null)
const editingName = ref('')

// 从store同步分组列表
const groups = computed(() => sessionGroupStore.sortedGroups)

watch(() => props.modelValue, (visible) => {
  if (visible) {
    localGroups.value = [...groups.value]
  }
})

watch(groups, (newGroups) => {
  localGroups.value = [...newGroups]
}, { deep: true })

/**
 * 创建新分组
 */
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

/**
 * 开始编辑分组名称
 */
const startEdit = (group: SessionGroup) => {
  editingId.value = group.id
  editingName.value = group.name
}

/**
 * 保存编辑
 */
const saveEdit = async () => {
  if (!editingId.value) return
  const name = editingName.value.trim()
  if (!name) {
    toast.error('分组名称不能为空')
    return
  }

  const success = await sessionGroupStore.updateGroup(editingId.value, name)
  if (success) {
    toast.success('分组名称已更新')
    editingId.value = null
  } else {
    toast.error('更新失败')
  }
}

/**
 * 取消编辑
 */
const cancelEdit = () => {
  editingId.value = null
  editingName.value = ''
}

/**
 * 删除分组
 */
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

/**
 * 拖拽排序结束
 */
const onDragEnd = async () => {
  const orderedIds = localGroups.value.map(g => g.id)
  const success = await sessionGroupStore.reorderGroups(orderedIds)
  if (success) {
    toast.success('分组顺序已更新')
  } else {
    toast.error('排序更新失败')
    // 恢复原始顺序
    localGroups.value = [...groups.value]
  }
}
</script>

<style scoped>
.group-list {
  max-height: 320px;
  overflow-y: auto;
}

.group-item:hover {
  background-color: var(--color-sidebar-bg-hover);
}

.drag-handle {
  touch-action: none;
}

.action-btn {
  transition: background-color 0.2s ease;
}
</style>
