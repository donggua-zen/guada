<template>
  <GdPopover :show="visible" @update:show="$emit('update:visible', $event)" :width="340" :anchor-el="anchorEl"
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

      <!-- 附加工作目录（远程连接绑定，多选 toggle；与主目录单选语义不同，点击不关闭弹层） -->
      <div class="h-px bg-[#eee] dark:bg-white/8 mx-2 my-1.5"></div>
      <div class="text-[11px] font-medium text-[#999] dark:text-[#6b7280] px-2 py-1 select-none">{{ t('chat.input.attachedDir') }}</div>
      <template v-if="connections.length > 0">
        <div v-for="conn in connections" :key="conn.id"
          class="flex items-center gap-1.25 px-2 py-1 rounded-md cursor-pointer transition-all duration-150 hover:bg-(--gd-color-sidebar-bg-hover)"
          @click="emit('toggle-attachment', conn.id)">
          <el-icon size="18" class="shrink-0 text-(--gd-color-text-gray) dark:text-(--gd-color-text-disabled)">
            <Cloud16Regular />
          </el-icon>
          <div class="flex-1 flex items-baseline gap-1.5 min-w-0">
            <span class="text-sm font-medium text-(--gd-color-text) dark:text-[#e5e7eb] whitespace-nowrap shrink-0 max-w-30 overflow-hidden text-ellipsis">{{ conn.name }}</span>
            <span class="text-xs text-[#999] dark:text-[#6b7280] whitespace-nowrap overflow-hidden text-ellipsis">{{ conn.description }}</span>
          </div>
          <el-icon v-if="attachedIds.includes(conn.id)" size="14" class="shrink-0 text-(--el-color-primary)">
            <Checkmark16Filled />
          </el-icon>
        </div>
      </template>
      <div v-else
        class="flex items-center gap-1.25 px-2 py-1 rounded-md cursor-pointer transition-all duration-150 hover:bg-(--gd-color-sidebar-bg-hover)"
        @click="goToConnectionSettings">
        <el-icon size="18" class="shrink-0 text-(--gd-color-text-gray) dark:text-(--gd-color-text-disabled)">
          <Cloud16Regular />
        </el-icon>
        <div class="flex-1 text-sm text-(--gd-color-text-gray) dark:text-[#6b7280]">{{ t('chat.workspace.noConnections') }}</div>
      </div>
    </div>
  </GdPopover>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { ElIcon, ElMessage } from 'element-plus'
import { Folder20Regular, Desktop16Regular, FolderAdd24Regular, Checkmark16Filled, PeopleCommunity16Regular, Cloud16Regular } from '@vicons/fluent'
import GdPopover from '../../ui/GdPopover.vue'
import { useWorkspaceStore } from '@/stores/workspace'
import { apiService } from '@/services/ApiService'
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
const router = useRouter()
const workspaceStore = useWorkspaceStore()
const recentList = computed(() => workspaceStore.recentList)

// ── 附加工作目录：remote-workspace 全局连接清单（弹层首次打开时加载，失败静默为空态） ──
interface RemoteConnectionOption { id: string; name: string; description: string }
const connections = ref<RemoteConnectionOption[]>([])
let connectionsLoaded = false

async function loadConnections(): Promise<void> {
  if (connectionsLoaded) return
  connectionsLoaded = true
  try {
    const list = await apiService.getConnections()
    connections.value = list.map((c) => ({
      id: c.id,
      name: c.name,
      description: `${c.config.username}@${c.config.host}`,
    }))
  } catch {
    connections.value = []
  }
}

watch(() => props.visible, (visible) => {
  if (visible) void loadConnections()
})

/** 当前已绑定的附加目录 ID（勾选态渲染源） */
const attachedIds = computed<string[]>(() => props.currentAttachments?.[SSH_CONNECTION_ATTACHMENT_TYPE] ?? [])

/** 空态行：跳转设置页"远程工作区"创建连接 */
function goToConnectionSettings(): void {
  emit('update:visible', false)
  void router.replace({ name: 'SystemSettings', params: { tab: 'connections' } })
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
