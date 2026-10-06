<template>
  <GdPopover :show="visible" @update:show="onMainShowChange" :width="340" :anchor-el="anchorEl"
    :max-height="480">
    <div class="flex flex-col gap-0.5">
      <!-- 最近选择 -->
      <template v-if="recentList.length > 0">
        <div class="text-[11px] font-medium text-[#999] dark:text-[#6b7280] px-2 py-1 select-none">{{ t('chat.input.recent') }}</div>
        <div v-for="path in filteredRecentList" :key="path"
          class="flex items-center gap-1.25 px-2 py-1 rounded-md cursor-pointer transition-all duration-150"
          :class="path === currentWorkspacePath
            ? 'bg-(--gd-color-sidebar-bg-active) hover:bg-(--gd-color-sidebar-bg-active) text-(--gd-color-sidebar-text-active)'
            : 'hover:bg-(--gd-color-sidebar-bg-hover)'"
          @click="handleSelect(path)">
          <el-icon size="18" class="shrink-0 text-(--gd-color-text-gray) dark:text-(--gd-color-text-disabled)">
            <Folder20Regular />
          </el-icon>
          <div class="flex-1 flex items-baseline gap-1.5 min-w-0">
            <span class="text-sm font-medium text-(--gd-color-text) dark:text-[#e5e7eb] whitespace-nowrap shrink-0 max-w-30 overflow-hidden text-ellipsis">{{ getFolderName(path) }}</span>
            <span class="text-xs text-[#999] dark:text-[#6b7280] whitespace-nowrap overflow-hidden text-ellipsis">{{ path }}</span>
          </div>
          <el-icon v-if="path === currentWorkspacePath" size="14" class="shrink-0 text-(--el-color-primary)">
            <Checkmark16Filled />
          </el-icon>
        </div>
        <div class="h-px bg-[#eee] dark:bg-white/8 mx-2 my-1.5"></div>
      </template>

      <!-- 使用公共目录 -->
      <div v-if="publicPath"
        class="flex items-center gap-1.25 px-2 py-1 rounded-md cursor-pointer transition-all duration-150"
        :class="publicPath === currentWorkspacePath
          ? 'bg-(--gd-color-sidebar-bg-active) hover:bg-(--gd-color-sidebar-bg-active)'
          : 'hover:bg-(--gd-color-sidebar-bg-hover)'"
        @click="handleSelect(publicPath)">
        <el-icon size="18" class="shrink-0 text-(--gd-color-text-gray) dark:text-(--gd-color-text-disabled)">
          <PeopleCommunity16Regular />
        </el-icon>
        <div class="flex-1 flex items-baseline gap-1.5 min-w-0">
          <span class="text-sm font-medium text-(--gd-color-text) dark:text-[#e5e7eb] whitespace-nowrap shrink-0">{{ t('chat.input.usePublicDir') }}</span>
          <span class="text-xs text-[#999] dark:text-[#6b7280] whitespace-nowrap overflow-hidden text-ellipsis">{{ publicPath }}</span>
        </div>
        <el-icon v-if="publicPath === currentWorkspacePath" size="14" class="shrink-0 text-(--el-color-primary)">
          <Checkmark16Filled />
        </el-icon>
      </div>

      <!-- 自动创建 -->
      <div class="flex items-center gap-1.25 px-2 py-1 rounded-md cursor-pointer transition-all duration-150"
        :class="!currentWorkspacePath
          ? 'bg-(--gd-color-sidebar-bg-active) hover:bg-(--gd-color-sidebar-bg-active)'
          : 'hover:bg-(--gd-color-sidebar-bg-hover)'"
        @click="handleSelect(null)">
        <el-icon size="18" class="shrink-0 text-(--gd-color-text-gray) dark:text-(--gd-color-text-disabled)">
          <FolderAdd24Regular />
        </el-icon>
        <div class="flex-1 flex items-baseline gap-1.5 min-w-0">
          <span class="text-sm font-medium text-(--gd-color-text) dark:text-[#e5e7eb] whitespace-nowrap shrink-0 max-w-30 overflow-hidden text-ellipsis">{{ t('chat.input.autoCreate') }}</span>
          <span class="text-xs text-[#999] dark:text-[#6b7280] whitespace-nowrap overflow-hidden text-ellipsis">{{ t('chat.input.autoCreateDesc') }}</span>
        </div>
        <el-icon v-if="!currentWorkspacePath" size="14" class="shrink-0 text-(--el-color-primary)">
          <Checkmark16Filled />
        </el-icon>
      </div>

      <!-- 打开文件夹（仅 Electron） -->
      <template v-if="isElectron">
        <div class="flex items-center gap-1.25 px-2 py-1 rounded-md cursor-pointer transition-all duration-150 hover:bg-(--gd-color-sidebar-bg-hover)"
          @click="handleOpenFolder">
          <el-icon size="18" class="shrink-0 text-(--gd-color-text-gray) dark:text-(--gd-color-text-disabled)">
            <Desktop16Regular />
          </el-icon>
          <div class="flex-1 flex items-baseline gap-1.5 min-w-0">
            <span class="text-sm font-medium text-(--gd-color-text) dark:text-[#e5e7eb] whitespace-nowrap">{{ t('chat.input.selectLocalFolder') }}</span>
          </div>
        </div>
      </template>

      <!-- 附加工作目录（远程连接绑定）：一级仅显示已绑定连接（hover 解除，概览窗同款）；
           "添加"触发行 hover 打开二级级联清单（交互对齐 ModelSelectorPanel） -->
      <div class="h-px bg-[#eee] dark:bg-white/8 mx-2 my-1.5"></div>
      <div class="text-[11px] font-medium text-[#999] dark:text-[#6b7280] px-2 py-1 select-none">{{ t('chat.input.attachedDir') }}</div>
      <template v-if="attachedConnections.length > 0">
        <div v-for="conn in attachedConnections" :key="conn.id" class="attached-row flex items-center gap-1.25 px-2 py-1 rounded-md transition-all duration-150 hover:bg-(--gd-color-sidebar-bg-hover)">
          <el-icon size="18" class="shrink-0 text-(--gd-color-text-gray) dark:text-(--gd-color-text-disabled)">
            <Cloud16Regular />
          </el-icon>
          <div class="flex-1 flex flex-col gap-0.5 min-w-0">
            <div class="flex items-baseline gap-1.5 min-w-0">
              <span class="text-sm font-medium text-(--gd-color-text) dark:text-[#e5e7eb] whitespace-nowrap shrink-0 max-w-30 overflow-hidden text-ellipsis">{{ conn.name }}</span>
              <span v-if="conn.description" class="text-xs text-[#999] dark:text-[#6b7280] whitespace-nowrap overflow-hidden text-ellipsis">{{ conn.description }}</span>
            </div>
            <span v-if="conn.path" class="text-xs text-[#999] dark:text-[#6b7280] whitespace-nowrap overflow-hidden text-ellipsis"
              :title="conn.path">
              <el-icon size="11" class="align-[-1px] mr-0.5"><Folder16Regular /></el-icon>{{ conn.path }}
            </span>
          </div>
          <GdTooltip :content="t('chat.workspace.removeAttachedDir')" placement="bottom">
            <button class="attached-remove" @click="emit('toggle-attachment', conn.id)">
              <el-icon :size="10"><Dismiss16Regular /></el-icon>
            </button>
          </GdTooltip>
        </div>
      </template>
      <div ref="addTriggerRef"
        class="flex items-center gap-1.25 px-2 py-1 rounded-md cursor-pointer transition-all duration-150 hover:bg-(--gd-color-sidebar-bg-hover)"
        @mouseenter="openCascade" @mouseleave="scheduleCloseCascade">
        <el-icon size="18" class="shrink-0 text-(--gd-color-text-gray) dark:text-(--gd-color-text-disabled)">
          <Add16Regular />
        </el-icon>
        <span class="flex-1 text-sm text-(--gd-color-text) dark:text-[#e5e7eb]">{{ t('chat.input.addRemoteAttachedDir') }}</span>
        <el-icon size="14" class="shrink-0 text-(--gd-color-text-gray) dark:text-(--gd-color-text-disabled)">
          <ChevronRight24Regular />
        </el-icon>
      </div>
    </div>
  </GdPopover>

  <!-- 级联：远程连接清单（点击 toggle 绑定，不关闭；已绑定显示 ✓）——内容为共享绑定菜单 -->
  <GdPopover :show="cascadeVisible" @update:show="onCascadeShowChange" :width="260" :max-height="300"
    :position="cascadePosition" @mouseenter="cancelCloseCascade" @mouseleave="scheduleCloseCascade">
    <ConnectionBindingMenu :attached-ids="attachedIds" @toggle="emit('toggle-attachment', $event)"
      @open-settings="emit('update:visible', false)" />
  </GdPopover>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElIcon, ElMessage } from 'element-plus'
import { Folder20Regular, Desktop16Regular, FolderAdd24Regular, Checkmark16Filled, PeopleCommunity16Regular, Cloud16Regular, Add16Regular, ChevronRight24Regular, Dismiss16Regular, Folder16Regular } from '@vicons/fluent'
import GdPopover from '../../ui/GdPopover.vue'
import GdTooltip from '../../ui/GdTooltip.vue'
import ConnectionBindingMenu from './ConnectionBindingMenu.vue'
import { useWorkspaceStore } from '@/stores/workspace'
import { useRemoteWorkspaceStore } from '@/stores/remoteWorkspace'
import { SSH_CONNECTION_ATTACHMENT_TYPE } from '@/constants'

const props = defineProps<{
  visible: boolean
  anchorEl: HTMLElement | null
  currentWorkspacePath?: string | null
  publicPath?: string | null
  /** 当前会话已绑定的附加目录（attachments 对象，用于渲染 ✓ 勾选态） */
  currentAttachments?: Record<string, string[]>
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  'select': [workspacePath: string | null]
  /** 附加目录绑定切换（多选语义，父层负责写回 attachments 并经 config-change 上行） */
  'toggle-attachment': [connectionId: string]
}>()

const { t } = useI18n()
const workspaceStore = useWorkspaceStore()
const recentList = computed(() => workspaceStore.recentList)

// ── 附加工作目录：remote-workspace 全局连接清单（store 共享，设置页新建后自动可见；
//    弹层打开时确保已加载，失败静默为空态） ──
interface RemoteConnectionOption { id: string; name: string; description: string; path?: string }
const remoteWorkspaceStore = useRemoteWorkspaceStore()

watch(() => props.visible, (visible) => {
  if (visible) void remoteWorkspaceStore.ensureConnections()
  else cascadeVisible.value = false
})

/** 当前已绑定的附加目录 ID（勾选态渲染源） */
const attachedIds = computed<string[]>(() => props.currentAttachments?.[SSH_CONNECTION_ATTACHMENT_TYPE] ?? [])

/** 已绑定连接的展示信息（连接清单未加载/已删连接时回退显示 ID） */
const attachedConnections = computed<RemoteConnectionOption[]>(() =>
  attachedIds.value.map((id) =>
    remoteWorkspaceStore.connectionOptions.find((c) => c.id === id) ?? { id, name: id, description: '' },
  ),
)

// ── 二级级联（"添加远程附加工作目录"触发行 hover 弹出，交互对齐 ModelSelectorPanel）──
const addTriggerRef = ref<HTMLElement | null>(null)
const cascadeVisible = ref(false)
const cascadePosition = ref<{ left: number; top: number } | null>(null)
let cascadeCloseTimer: ReturnType<typeof setTimeout> | null = null

function openCascade(): void {
  if (cascadeCloseTimer) {
    clearTimeout(cascadeCloseTimer)
    cascadeCloseTimer = null
  }
  if (cascadeVisible.value) return
  // 先按触发行坐标算首选位置再显示（右侧优先，空间不足放左侧），避免先出现在默认位置再跳变。
  // 视口边界收缩交给 GdPopover 按实测尺寸做（用假定高度收缩会把矮菜单顶到视口边缘）
  if (addTriggerRef.value) {
    const rect = addTriggerRef.value.getBoundingClientRect()
    const menuWidth = 260
    const gap = 5
    const spaceRight = window.innerWidth - rect.right
    const showOnRight = spaceRight >= menuWidth + gap || spaceRight >= rect.left
    cascadePosition.value = {
      left: showOnRight ? rect.right + gap : rect.left - menuWidth - gap,
      top: rect.top,
    }
  }
  cascadeVisible.value = true
}

function onCascadeShowChange(val: boolean): void {
  if (!val) cascadeVisible.value = false
}

function scheduleCloseCascade(): void {
  if (cascadeCloseTimer) clearTimeout(cascadeCloseTimer)
  cascadeCloseTimer = setTimeout(() => {
    cascadeVisible.value = false
  }, 200)
}

function cancelCloseCascade(): void {
  if (cascadeCloseTimer) {
    clearTimeout(cascadeCloseTimer)
    cascadeCloseTimer = null
  }
}

/** 主弹窗关闭保护：级联可见时不响应外部点击关闭（先收级联） */
function onMainShowChange(val: boolean): void {
  if (!val && cascadeVisible.value) return
  emit('update:visible', val)
}

// 过滤掉公共目录，避免与固定入口重复
const filteredRecentList = computed(() => {
  if (!publicPath.value) return recentList.value
  return recentList.value.filter((p: string) => p !== publicPath.value)
})

const isElectron = typeof window !== 'undefined' && !!window.electronAPI

const publicPath = computed(() => props.publicPath || null)

function getFolderName(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const segments = normalized.split('/').filter(Boolean)
  return segments[segments.length - 1] || path
}

function handleSelect(path: string | null) {
  emit('select', path)
  emit('update:visible', false)
}

async function handleOpenFolder() {
  if (!isElectron || !window.electronAPI?.selectFolder) return
  try {
    const selectedPath = await window.electronAPI.selectFolder()
    if (selectedPath) {
      emit('select', selectedPath)
    }
  } catch (error) {
    console.error('选择文件夹失败:', error)
    ElMessage.error(t('chat.input.selectFolderFailed'))
  } finally {
    emit('update:visible', false)
  }
}
</script>

<style scoped>
/* 已绑定附加目录行的解除按钮：hover 行时显现（对齐概览窗附加目录行样式） */
.attached-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--gd-color-text-gray);
  cursor: pointer;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s, background 0.15s, color 0.15s;
}
.attached-row:hover .attached-remove {
  opacity: 1;
}
.attached-remove:hover {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}
</style>
