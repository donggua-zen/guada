<template>
  <div class="-mb-4 pb-5 pt-2 px-2 w-full flex justify-start gap-1 bg-(--gd-color-secondary-surface) rounded-t-(--gd-size-rounded-radius)">
    <!-- 工作目录按钮 -->
    <el-button ref="workspaceButtonRef" class="workspace-btn mr-0.5" @click.stop="openWorkspaceDialog" text>
      <el-icon size="18">
        <FolderOpen24Regular />
      </el-icon>
      <span class="text-xs font-medium">
        {{ t('chat.toolbar.workspace', { path: displayWorkspacePath }) }}
      </span>
      <el-icon size="16" class="ml-0.5">
        <ChevronUpDown16Regular />
      </el-icon>
    </el-button>

    <!-- 远程目录（附加工作目录）：独立按钮，已选后收起文案只留图标 + 数量角标 -->
    <RemoteDirButton :attachments="config?.attachments"
      @update:attachments="emit('config-change', { attachments: $event })" />

    <!-- 分组选择按钮 -->
    <el-button ref="groupButtonRef" class="workspace-btn mr-0.5" @click.stop="openGroupSelector" text>
      <span class="text-xs font-medium">
        {{ t('chat.toolbar.group', { name: selectedGroupName }) }}
      </span>
      <el-icon size="16" class="ml-0.5">
        <ChevronUpDown16Regular />
      </el-icon>
    </el-button>

    <!-- 外部自定义按钮 -->
    <slot name="actions" />

    <div class="flex-1"></div>
  </div>

  <!-- 工作目录选择弹窗（纯本地目录：远程附加目录已拆为独立的 RemoteDirButton） -->
  <WorkspaceSelectorPopover v-model:visible="workspacePopoverVisible" :anchor-el="workspaceButtonRef?.$el ?? null"
    :current-workspace-path="config?.workspacePath || null" :public-path="publicPath" @select="handleWorkspaceSelect" />

  <!-- 分组选择弹窗 -->
  <GdPopover :show="groupSelectorVisible" @update:show="groupSelectorVisible = $event" :width="280"
    :anchor-el="groupButtonRef?.$el" :max-height="400">
    <div class="flex flex-col gap-0.5">
      <div v-for="g in groupSelectorOptions" :key="g.value"
        class="flex items-center gap-1.25 px-2 py-1 rounded-(--gd-size-dialog-rounded-radius) cursor-pointer transition-all duration-150"
        :class="selectedGroupId === g.value
          ? 'bg-(--gd-color-sidebar-bg-active) hover:bg-(--gd-color-sidebar-bg-active)'
          : 'hover:bg-(--gd-color-sidebar-bg-hover)'"
        @click="selectGroup(g.value)">
        <el-icon size="18" class="shrink-0 text-(--gd-color-text-gray) dark:text-(--gd-color-text-disabled)">
          <Folder20Regular />
        </el-icon>
        <span class="flex-1 text-sm font-medium text-(--gd-color-text) dark:text-[#e5e7eb]">{{ g.label }}</span>
        <el-icon v-if="selectedGroupId === g.value" size="14" class="shrink-0 text-(--el-color-primary)">
          <Checkmark16Filled />
        </el-icon>
      </div>
    </div>
  </GdPopover>

</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { FolderOpen24Regular, ChevronUpDown16Regular, Folder20Regular, Checkmark16Filled } from '@vicons/fluent'
import WorkspaceSelectorPopover from './WorkspaceSelectorPopover.vue'
import RemoteDirButton from './RemoteDirButton.vue'
import GdPopover from '../../ui/GdPopover.vue'
import { useSessionGroupStore, UNGROUPED_ID } from '@/stores/sessionGroup'
import { useWorkspaceStore } from '@/stores/workspace'

const { t } = useI18n()

const props = defineProps({
  config: { type: Object, default: () => ({}) },
})

/** config-change 载荷：本组件每次只整包下发一个字段（消费方按字段合并） */
type ConfigChangePayload =
  | { groupId: string | null }
  | { workspacePath: string | null }
  | { attachments: Record<string, string[]> }

const emit = defineEmits<{
  (e: 'config-change', payload: ConfigChangePayload): void
}>()

const sessionGroupStore = useSessionGroupStore()
const workspaceStore = useWorkspaceStore()

// 工作目录设置相关（仅需 $el 供弹层锚定，结构化类型收窄组件实例）
const workspaceButtonRef = ref<{ $el: HTMLElement } | null>(null)
const workspacePopoverVisible = ref(false)

// 分组选择相关
const groupSelectorVisible = ref(false)
const groupButtonRef = ref<{ $el: HTMLElement } | null>(null)

// 初始化时加载分组列表
sessionGroupStore.loadGroups()

// 获取基础目录，计算公共目录路径
onMounted(() => {
  workspaceStore.ensureBaseDir()
})

const publicPath = computed(() => workspaceStore.getPublicPath())

const displayWorkspacePath = computed(() => {
  const fullPath = props.config?.workspacePath
  if (!fullPath) return t('chat.toolbar.autoCreate')
  if (publicPath.value && fullPath === publicPath.value) return t('chat.toolbar.publicDir')
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
    label: t('chat.toolbar.taskList'),
    value: UNGROUPED_ID
  })
  return options
})

const selectedGroupName = computed(() => {
  const groupId = props.config?.groupId
  if (groupId === UNGROUPED_ID || groupId === undefined || groupId === null) {
    return t('chat.toolbar.taskList')
  }
  const group = sessionGroupStore.sortedGroups.find(g => g.id === groupId)
  return group?.name || t('chat.toolbar.taskList')
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
  color: var(--gd-color-text);
  cursor: pointer;
  font-size: 14px;
  height: 26px;
  padding: 0 8px;
  display: flex;
  align-items: center;
  transition: all 0.2s;
  border-radius: var(--gd-size-dialog-rounded-radius);
}

.workspace-btn:hover {
  color: var(--gd-color-text);
}
</style>
