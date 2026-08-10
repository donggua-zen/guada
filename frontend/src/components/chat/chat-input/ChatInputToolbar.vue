<template>
  <div class="-mt-4 pt-5 pb-2 px-2 w-full flex justify-start gap-1 bg-(--color-sidebar-bg) rounded-b-(--size-dialog-rounded-radius)">
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

    <div class="flex-1"></div>
  </div>

  <!-- 工作目录选择弹窗 -->
  <WorkspaceSelectorPopover v-model:visible="workspacePopoverVisible" :anchor-el="workspaceButtonRef?.$el"
    :current-workspace-path="config?.workspacePath || null" :public-path="publicPath" @select="handleWorkspaceSelect" />

  <!-- 分组选择弹窗 -->
  <CustomPopover :show="groupSelectorVisible" @update:show="groupSelectorVisible = $event" :width="280"
    :anchor-el="groupButtonRef?.$el" :max-height="400">
    <div class="flex flex-col gap-0.5">
      <div v-for="g in groupSelectorOptions" :key="g.value"
        class="flex items-center gap-1.25 px-2 py-1 rounded-(--size-dialog-rounded-radius) cursor-pointer transition-all duration-150"
        :class="selectedGroupId === g.value
          ? 'bg-(--color-sidebar-bg-active) hover:bg-(--color-sidebar-bg-active)'
          : 'hover:bg-(--color-sidebar-bg-hover)'"
        @click="selectGroup(g.value)">
        <el-icon size="18" class="shrink-0 text-(--color-text-gray) dark:text-(--color-text-disabled)">
          <Folder20Regular />
        </el-icon>
        <span class="flex-1 text-sm font-medium text-(--color-text) dark:text-[#e5e7eb]">{{ g.label }}</span>
        <el-icon v-if="selectedGroupId === g.value" size="14" class="shrink-0 text-(--el-color-primary)">
          <Checkmark16Filled />
        </el-icon>
      </div>
    </div>
  </CustomPopover>

</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { FolderOpen24Regular, ChevronUpDown16Regular, Folder20Regular, Checkmark16Filled } from '@vicons/fluent'
import WorkspaceSelectorPopover from './WorkspaceSelectorPopover.vue'
import CustomPopover from '../../ui/CustomPopover.vue'
import { useSessionGroupStore, UNGROUPED_ID } from '@/stores/sessionGroup'
import { useWorkspaceStore } from '@/stores/workspace'

const props = defineProps({
  config: { type: Object, default: () => ({}) },
})

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
  groupSelectorVisible.value = !groupSelectorVisible.value
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
  color: var(--color-text);
  cursor: pointer;
  font-size: 14px;
  height: 26px;
  padding: 0 8px;
  display: flex;
  align-items: center;
  transition: all 0.2s;
  border-radius: var(--size-dialog-rounded-radius);
}

.workspace-btn:hover {
  color: var(--color-text);
}
</style>
