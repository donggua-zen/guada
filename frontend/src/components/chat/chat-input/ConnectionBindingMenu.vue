<template>
  <!-- 远程连接绑定清单（共享组件）：✓ 为已绑定，点击 toggle 不关闭；空态引导去设置页。
       连接清单来自 remoteWorkspaceStore；加载时机由宿主负责（弹层打开/挂载时 ensureConnections） -->
  <div class="flex flex-col gap-0.5">
    <template v-if="options.length > 0">
      <div v-for="opt in options" :key="opt.id"
        class="flex items-center gap-1.25 px-2 py-1 rounded-md cursor-pointer transition-all duration-150 hover:bg-(--gd-color-sidebar-bg-hover)"
        @click="emit('toggle', opt.id)">
        <el-icon size="18" class="shrink-0 text-(--gd-color-text-gray) dark:text-(--gd-color-text-disabled)">
          <component :is="opt.kind === 'docker' ? Cube16Regular : Cloud16Regular" />
        </el-icon>
        <div class="flex-1 flex flex-col gap-0.5 min-w-0">
          <div class="flex items-baseline gap-1.5 min-w-0">
            <span class="text-sm font-medium text-(--gd-color-text) dark:text-[#e5e7eb] whitespace-nowrap shrink-0 max-w-30 overflow-hidden text-ellipsis">{{ opt.name }}</span>
            <span class="text-xs text-[#999] dark:text-[#6b7280] whitespace-nowrap overflow-hidden text-ellipsis">{{ opt.description }}</span>
          </div>
          <span v-if="opt.path" class="text-xs text-[#999] dark:text-[#6b7280] whitespace-nowrap overflow-hidden text-ellipsis"
            :title="opt.path">
            <el-icon size="12" class="align-[-1px] mr-0.5"><Folder16Regular /></el-icon>{{ opt.path }}
          </span>
        </div>
        <el-icon v-if="attachedIds.includes(opt.id)" size="14" class="shrink-0 text-(--el-color-primary)">
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
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { ElIcon } from 'element-plus'
import { Checkmark16Filled, Cloud16Regular, Cube16Regular, Folder16Regular } from '@vicons/fluent'
import { useRemoteWorkspaceStore } from '@/stores/remoteWorkspace'

defineProps<{
  /** 当前已绑定的连接 ID（勾选态渲染源） */
  attachedIds: string[]
}>()

const emit = defineEmits<{
  /** 绑定切换（多选语义，写回由宿主负责：经各自上行链路持久化） */
  toggle: [connectionId: string]
  /** 空态行点击：即将跳转设置页（宿主借此收起自身弹层） */
  'open-settings': []
}>()

const { t } = useI18n()
const router = useRouter()
const remoteWorkspaceStore = useRemoteWorkspaceStore()

const options = computed(() => remoteWorkspaceStore.connectionOptions)

/** 空态行：跳转设置页"远程工作区"创建连接，并通知宿主收起弹层 */
function goToConnectionSettings(): void {
  emit('open-settings')
  void router.replace({ name: 'SystemSettings', params: { tab: 'connections' } })
}
</script>
