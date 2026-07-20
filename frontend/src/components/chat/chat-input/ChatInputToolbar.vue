<template>
  <div class="mt-2 w-full flex justify-start px-1 gap-1">
    <!-- 运行模式按钮 -->
    <el-button ref="runModeButtonRef" class="workspace-btn mr-0.5" @click.stop="toggleRunModePopover" text>
      <el-icon size="16">
        <component :is="runModeIcon" class="text-gray-600" />
      </el-icon>
      <span class="text-xs font-medium">
        {{ runModeLabel }}
      </span>
    </el-button>

    <!-- 运行模式弹窗 -->
    <RunModePopover v-model:visible="runModePopoverVisible" :anchor-el="runModeButtonRef?.$el"
      :current-value="currentRunMode" @select="handleRunModeChange" />

    <!-- 工作目录按钮（仅创建模式） -->
    <el-button v-if="mode == 'create'" ref="workspaceButtonRef" class="workspace-btn mr-0.5" @click.stop="openWorkspaceDialog" text>
      <el-icon size="18">
        <FolderOpen24Regular />
      </el-icon>
      <template v-if="mode == 'create'">
        <span class="text-xs font-medium">
          工作目录：{{ displayWorkspacePath }}
        </span>
        <el-icon size="16" class="ml-0.5">
          <ChevronUpDown16Regular />
        </el-icon>
      </template>
      <template v-else>
        <span class="text-xs font-medium">{{ displayWorkspacePath }}</span>
      </template>
    </el-button>

    <!-- 分组选择按钮（仅创建模式） -->
    <template v-if="mode == 'create'">
      <el-button ref="groupButtonRef" class="workspace-btn mr-0.5" @click.stop="openGroupSelector" text>
        <span class="text-xs font-medium">
          分组：{{ selectedGroupName }}
        </span>
        <el-icon size="16" class="ml-0.5">
          <ChevronUpDown16Regular />
        </el-icon>
      </el-button>
    </template>

    <!-- 外部自定义按钮 -->
    <slot name="actions" />
  </div>

  <!-- 工作目录选择弹窗 -->
  <WorkspaceSelectorPopover v-model:visible="workspacePopoverVisible" :anchor-el="workspaceButtonRef?.$el"
    :current-workspace-path="config?.workspacePath || null" @select="handleWorkspaceSelect" />

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
import { ref, computed } from 'vue'
import { FolderOpen24Regular, ChevronUpDown16Regular, Folder20Regular, Checkmark16Filled, DrinkCoffee16Regular, ClipboardTask24Regular } from '@vicons/fluent'
import WorkspaceSelectorPopover from './WorkspaceSelectorPopover.vue'
import RunModePopover from './RunModePopover.vue'
import { useSessionGroupStore, UNGROUPED_ID } from '@/stores/sessionGroup'
import { useWorkspaceStore } from '@/stores/workspace'

const props = defineProps<{
  mode: string
  config: any
}>()

const emit = defineEmits<{
  (e: 'config-change', payload: any): void
  (e: 'toggle-workspace-pane'): void
}>()

const sessionGroupStore = useSessionGroupStore()
const workspaceStore = useWorkspaceStore()

// 工作目录设置相关
const workspaceButtonRef = ref<any>(null)
const workspacePopoverVisible = ref(false)

// 运行模式相关
const runModeButtonRef = ref<any>(null)
const runModePopoverVisible = ref(false)

const currentRunMode = computed(() => props.config?.runMode || 'normal')

const runModeLabel = computed(() => {
  return currentRunMode.value === 'plan' ? '计划模式' : '工作模式'
})

const runModeIcon = computed(() => {
  return currentRunMode.value === 'plan' ? ClipboardTask24Regular : DrinkCoffee16Regular
})

const toggleRunModePopover = () => {
  runModePopoverVisible.value = !runModePopoverVisible.value
}

const handleRunModeChange = (mode: string) => {
  emit('config-change', { runMode: mode })
}

// 分组选择相关
const groupSelectorVisible = ref(false)
const groupButtonRef = ref<any>(null)

// 初始化时加载分组列表
sessionGroupStore.loadGroups()

// 只显示工作目录的最后一级
const displayWorkspacePath = computed(() => {
  const fullPath = props.config?.workspacePath
  if (!fullPath) return props.mode === 'create' ? '自动创建' : '打开工作目录'
  const normalized = fullPath.replace(/\\/g, '/')
  const segments = normalized.split('/').filter(Boolean)
  return segments[segments.length - 1] || fullPath
})

/**
 * 分组选择选项（包含虚拟的未分组）
 */
const groupSelectorOptions = computed(() => {
  const options = sessionGroupStore.sortedGroups.map(g => ({
    label: g.name,
    value: g.id
  }))
  // 始终添加未分组选项
  options.unshift({
    label: '任务列表',
    value: UNGROUPED_ID
  })
  return options
})

/**
 * 当前选中的分组名称
 */
const selectedGroupName = computed(() => {
  const groupId = props.config?.groupId
  if (groupId === UNGROUPED_ID || groupId === undefined || groupId === null) {
    return '任务列表'
  }
  const group = sessionGroupStore.sortedGroups.find(g => g.id === groupId)
  return group?.name || '任务列表'
})

/**
 * 当前选中的分组ID
 */
const selectedGroupId = computed(() => {
  return props.config?.groupId || UNGROUPED_ID
})

/**
 * 打开分组选择弹窗
 */
const openGroupSelector = () => {
  groupSelectorVisible.value = true
}

/**
 * 选择分组
 */
const selectGroup = (groupId: string) => {
  const groupIdToSet = groupId === UNGROUPED_ID ? null : groupId
  emit('config-change', { groupId: groupIdToSet })
  groupSelectorVisible.value = false
}

/**
 * 打开工作目录设置弹窗
 */
const openWorkspaceDialog = () => {
  // 对话模式下仅触发窗格切换事件，由父组件控制显隐
  if (props.mode === 'chat') {
    emit('toggle-workspace-pane')
    return
  }
  // 创建模式下切换工作目录选择弹窗
  workspacePopoverVisible.value = !workspacePopoverVisible.value
}

/**
 * 应用工作目录选择
 */
const handleWorkspaceSelect = (workspacePath: string | null) => {
  if (workspacePath) {
    workspaceStore.addRecent(workspacePath)
  }
  emit('config-change', { workspacePath })
}
</script>

<style scoped>
/* 工作目录/分组按钮 */
.workspace-btn {
  color: #888;
  cursor: pointer;
  font-size: 14px;
  height: 22px;
  padding: 0 3px;
  display: flex;
  align-items: center;
  transition: all 0.2s;
}
</style>
