<template>
  <div class="mt-2 w-full flex justify-start px-1 gap-1">
    <!-- 工作目录按钮 -->
    <el-button ref="workspaceButtonRef" class="workspace-btn mr-0.5" @click.stop="openWorkspaceDialog" text>
      <el-icon size="18">
        <FolderOpen24Regular />
      </el-icon>
      <span class="text-xs font-medium">
        工作目录：{{ displayWorkspacePath }}
      </span>
      <el-icon size="16" class="ml-0.5">
        <ChevronUpDown16Regular />
      </el-icon>
    </el-button>

    <!-- 分组选择按钮 -->
    <el-button ref="groupButtonRef" class="workspace-btn mr-0.5" @click.stop="openGroupSelector" text>
      <span class="text-xs font-medium">
        分组：{{ selectedGroupName }}
      </span>
      <el-icon size="16" class="ml-0.5">
        <ChevronUpDown16Regular />
      </el-icon>
    </el-button>

    <!-- 外部自定义按钮 -->
    <slot name="actions" />
  </div>

  <!-- 工作目录选择弹窗 -->
  <WorkspaceSelectorPopover v-model:visible="workspacePopoverVisible" :anchor-el="workspaceButtonRef?.$el"
    :current-workspace-path="config?.workspacePath || null" :public-path="publicPath" @select="handleWorkspaceSelect" />

  <!-- 分组选择弹窗 -->
  <el-dialog v-model="groupSelectorVisible" title="请选择分组" width="360px" :close-on-click-modal="false">
    <div class="space-y-1 py-2">
      <div v-for="g in groupSelectorOptions" :key="g.value"
        class="flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-200 text-sm"
        :class="selectedGroupId === g.value ? 'bg-(--color-sidebar-bg-active) text-(--color-sidebar-text-active)' : 'text-(--color-text-gray) hover:bg-(--color-sidebar-bg-hover) hover:text-(--color-sidebar-text-hover)'"
        @click="selectGroup(g.value)">
        <el-icon class="w-4 h-4">
          <Folder20Regular />
        </el-icon>
        <span class="flex-1">{{ g.label }}</span>
        <el-icon v-if="selectedGroupId === g.value" class="w-4 h-4">
          <Checkmark16Filled />
        </el-icon>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { FolderOpen24Regular, ChevronUpDown16Regular, Folder20Regular, Checkmark16Filled } from '@vicons/fluent'
import WorkspaceSelectorPopover from './WorkspaceSelectorPopover.vue'
import { useSessionGroupStore, UNGROUPED_ID } from '@/stores/sessionGroup'
import { useWorkspaceStore } from '@/stores/workspace'

const props = defineProps<{
  config: any
}>()

const emit = defineEmits<{
  (e: 'config-change', payload: any): void
}>()

const sessionGroupStore = useSessionGroupStore()
const workspaceStore = useWorkspaceStore()

// 工作目录设置相关
const workspaceButtonRef = ref<any>(null)
const workspacePopoverVisible = ref(false)

// 分组选择相关
const groupSelectorVisible = ref(false)
const groupButtonRef = ref<any>(null)

// 初始化时加载分组列表
sessionGroupStore.loadGroups()

// 获取基础目录，计算公共目录路径
onMounted(() => {
  workspaceStore.ensureBaseDir()
})

const publicPath = computed(() => workspaceStore.getPublicPath())

const displayWorkspacePath = computed(() => {
  const fullPath = props.config?.workspacePath
  if (!fullPath) return '自动创建'
  if (publicPath.value && fullPath === publicPath.value) return '公共目录'
  const normalized = fullPath.replace(/\\/g, '/')
  const segments = normalized.split('/').filter(Boolean)
  return segments[segments.length - 1] || fullPath
})

const groupSelectorOptions = computed(() => {
  const options = sessionGroupStore.sortedGroups.map(g => ({
    label: g.name,
    value: g.id
  }))
  options.unshift({
    label: '任务列表',
    value: UNGROUPED_ID
  })
  return options
})

const selectedGroupName = computed(() => {
  const groupId = props.config?.groupId
  if (groupId === UNGROUPED_ID || groupId === undefined || groupId === null) {
    return '任务列表'
  }
  const group = sessionGroupStore.sortedGroups.find(g => g.id === groupId)
  return group?.name || '任务列表'
})

const selectedGroupId = computed(() => {
  return props.config?.groupId || UNGROUPED_ID
})

const openGroupSelector = () => {
  groupSelectorVisible.value = true
}

const selectGroup = (groupId: string) => {
  const groupIdToSet = groupId === UNGROUPED_ID ? null : groupId
  emit('config-change', { groupId: groupIdToSet })
  groupSelectorVisible.value = false
}

const openWorkspaceDialog = () => {
  workspacePopoverVisible.value = !workspacePopoverVisible.value
}

const handleWorkspaceSelect = (workspacePath: string | null) => {
  // 判断选择类型并记录
  let mode: 'auto' | 'public' | 'custom'
  if (workspacePath === null) {
    mode = 'auto'
  } else if (publicPath.value && workspacePath === publicPath.value) {
    mode = 'public'
  } else {
    mode = 'custom'
  }
  workspaceStore.setLastChoice(mode, workspacePath)

  if (workspacePath) {
    workspaceStore.addRecent(workspacePath)
  }
  emit('config-change', { workspacePath })
}
</script>

<style scoped>
.workspace-btn {
  color: var(--color-text-gray);
  cursor: pointer;
  font-size: 14px;
  height: 22px;
  padding: 0 3px;
  display: flex;
  align-items: center;
  transition: all 0.2s;
}

.workspace-btn:hover {
  color: var(--color-text);
}
</style>
