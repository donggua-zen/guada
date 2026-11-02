<template>
  <!-- 远程连接绑定清单（共享组件）：✓ 为已绑定，点击 toggle 不关闭；空态引导去设置页。
       连接清单来自 remoteWorkspaceStore；加载时机由宿主负责（弹层打开/挂载时 ensureConnections） -->
  <div class="flex flex-col gap-0.5">
    <template v-if="options.length > 0">
      <div v-for="opt in options" :key="opt.id"
        class="flex items-center gap-1.25 px-2 py-1 rounded-md cursor-pointer transition-all duration-150 hover:bg-(--gd-color-sidebar-bg-hover)"
        @click="emit('toggle', opt.id)">
        
          <component class="shrink-0 text-(--gd-color-text-gray) dark:text-(--gd-color-text-disabled) w-4.5 h-4.5"  :is="opt.kind === 'docker' ? Cube16Regular : opt.kind === 'wsl' ? Desktop16Regular : Cloud16Regular" />
        
        <div class="flex-1 flex flex-col gap-0.5 min-w-0">
          <div class="flex items-baseline gap-1.5 min-w-0">
            <span class="text-sm font-medium text-(--gd-color-text) dark:text-[#e5e7eb] whitespace-nowrap shrink-0 max-w-30 overflow-hidden text-ellipsis">{{ opt.name }}</span>
            <span class="text-xs text-[#999] dark:text-[#6b7280] whitespace-nowrap overflow-hidden text-ellipsis">{{ opt.description }}</span>
          </div>
          <span v-if="opt.path" class="text-xs text-[#999] dark:text-[#6b7280] whitespace-nowrap overflow-hidden text-ellipsis"
            :title="opt.path">
            <Folder16Regular class="align-[-1px] mr-0.5 w-3 h-3"  />{{ opt.path }}
          </span>
        </div>
        
          <Checkmark16Filled v-if="attachedIds.includes(opt.id)" class="shrink-0 text-(--gd-color-primary) w-3.5 h-3.5"  />
        
      </div>
    </template>
    <div v-else
      class="flex items-center gap-1.25 px-2 py-1 rounded-md cursor-pointer transition-all duration-150 hover:bg-(--gd-color-sidebar-bg-hover)"
      @click="goToConnectionSettings">
      
        <Cloud16Regular class="shrink-0 text-(--gd-color-text-gray) dark:text-(--gd-color-text-disabled) w-4.5 h-4.5"  />
      
      <div class="flex-1 text-sm text-(--gd-color-text-gray) dark:text-[#6b7280]">{{ t('chat.workspace.noConnections') }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { Checkmark16Filled, Cloud16Regular, Cube16Regular, Desktop16Regular, Folder16Regular } from '@vicons/fluent'
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
