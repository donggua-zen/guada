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

    <!-- 角色选择按钮 -->
    <el-button ref="characterButtonRef" class="workspace-btn" @click.stop="toggleCharacterPopover" text>
      <Avatar v-if="currentCharacter" :src="currentCharacter.avatarUrl" type="assistant"
        :name="currentCharacter.title" class="w-4 h-4 shrink-0 rounded overflow-hidden mr-1" />
      <span class="text-xs font-medium">
        使用角色：{{ currentCharacter?.title || '未选择' }}
      </span>
      <el-icon size="16" class="ml-0.5">
        <ChevronUpDown16Regular />
      </el-icon>
    </el-button>
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

  <!-- 角色选择弹窗 -->
  <CustomPopover :show="characterPopoverVisible" @update:show="characterPopoverVisible = $event" :width="320"
    :anchor-el="characterButtonRef?.$el" :max-height="400">
    <!-- 搜索框：无界样式，仅下边框 -->
    <div class="relative px-1 py-1 mb-1">
      <span class="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-(--color-text-gray) dark:text-(--color-text-disabled)">
        <el-icon size="14"><Search24Regular /></el-icon>
      </span>
      <input v-model="characterSearchQuery" type="text" placeholder="搜索角色..."
        class="character-search-input w-full bg-transparent outline-none text-sm transition-colors" />
    </div>
    <!-- 角色列表 -->
    <div class="flex flex-col gap-0.5">
      <div v-for="char in filteredCharacters" :key="char.id"
        class="flex items-center gap-1.25 px-2 py-1 rounded-(--size-dialog-rounded-radius) cursor-pointer transition-all duration-150"
        :class="char.id === currentCharacterId
          ? 'bg-(--color-sidebar-bg-active) hover:bg-(--color-sidebar-bg-active)'
          : 'hover:bg-(--color-sidebar-bg-hover)'"
        @click="selectCharacter(char.id)">
        <Avatar :src="char.avatarUrl" type="assistant" :name="char.title"
          class="w-5 h-5 shrink-0 rounded overflow-hidden" />
        <div class="flex-1 min-w-0 flex items-baseline gap-1.5">
          <span class="text-sm font-medium text-(--color-text) dark:text-[#e5e7eb] shrink-0">{{ char.title }}</span>
          <span v-if="char.description" class="text-xs text-gray-400 dark:text-[#6b6d75] truncate">{{ char.description }}</span>
        </div>
        <el-icon v-if="char.id === currentCharacterId" size="14" class="shrink-0 text-(--el-color-primary)">
          <Checkmark16Filled />
        </el-icon>
      </div>
      <div v-if="filteredCharacters.length === 0" class="text-center py-4 text-(--color-text-gray) dark:text-[#6b6d75]">
        <p class="text-sm">未找到角色</p>
      </div>
    </div>
  </CustomPopover>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import type { PropType } from 'vue'
import { FolderOpen24Regular, ChevronUpDown16Regular, Folder20Regular, Checkmark16Filled, Search24Regular } from '@vicons/fluent'
import WorkspaceSelectorPopover from './WorkspaceSelectorPopover.vue'
import CustomPopover from '../../ui/CustomPopover.vue'
import { Avatar } from '../../ui'
import { useSessionGroupStore, UNGROUPED_ID } from '@/stores/sessionGroup'
import { useWorkspaceStore } from '@/stores/workspace'
import type { Character } from '@/types/character'

const props = defineProps({
  config: { type: Object, default: () => ({}) },
  characters: { type: Array as PropType<Character[]>, default: () => [] },
  currentCharacterId: { type: String as PropType<string | null>, default: null },
})

const emit = defineEmits<{
  (e: 'config-change', payload: any): void
  (e: 'character-select', characterId: string): void
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
// ========== 角色选择 ==========

const characterButtonRef = ref<any>(null)
const characterPopoverVisible = ref(false)
const characterSearchQuery = ref('')

const currentCharacter = computed(() => {
  return props.characters.find(c => c.id === props.currentCharacterId) || null
})

const filteredCharacters = computed(() => {
  const query = characterSearchQuery.value.trim().toLowerCase()
  if (!query) return props.characters
  return props.characters.filter(c =>
    c.title?.toLowerCase().includes(query) ||
    c.description?.toLowerCase().includes(query)
  )
})

const toggleCharacterPopover = () => {
  characterPopoverVisible.value = !characterPopoverVisible.value
}

const selectCharacter = (characterId: string) => {
  emit('character-select', characterId)
  characterPopoverVisible.value = false
}

// 关闭弹窗时清空搜索
watch(characterPopoverVisible, (val) => {
  if (!val) characterSearchQuery.value = ''
})
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

/* 无界搜索框：仅下边框 */
.character-search-input {
  border: none;
  border-bottom: 1px solid var(--color-input-border);
  border-radius: 0;
  padding: 2px 0 4px 22px;
  color: var(--color-text);
}

.character-search-input::placeholder {
  color: var(--el-text-color-placeholder, #a8abb2);
}

.character-search-input:focus {
  border-bottom-color: var(--el-color-primary);
}
</style>
