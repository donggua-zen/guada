<template>
  <!-- 远程目录（附加工作目录）：工具条独立按钮（新建页 / 定时任务编辑框共用）。
       未选 = 图标 + 「远程目录」；选 1 个 = 「远程目录：连接名」；
       选多个 = 「远程目录：首个连接名」+ 数量徽章（一眼看出选了哪些、有没有选错，不必点开核对）；
       连接清单未到位时名称位置显示微光骨架占位（避免闪原始连接 ID）；
       hover 提示完整名单；弹窗 = 各远程连接的勾选清单（点击切换绑定，✓ 为已绑定） -->
  <GdTooltip :content="tooltipContent" placement="top">
    <el-button ref="buttonRef" class="workspace-btn mr-0.5" text @click.stop="togglePopover">
      <el-icon size="18">
        <Cloud24Regular />
      </el-icon>
      <span v-if="attachedCount === 0" class="text-xs font-medium">{{ t('chat.toolbar.remoteDir') }}</span>
      <template v-else>
        <span class="text-xs font-medium">{{ t('chat.toolbar.remoteDirPrefix') }}</span>
        <span v-if="nameLoading" class="rdb-skeleton" aria-hidden="true"></span>
        <span v-else class="text-xs font-medium max-w-32 truncate">{{ firstAttachedName }}</span>
      </template>
      <span v-if="attachedCount > 1" class="remote-count">{{ attachedCount }}</span>
      <el-icon size="16" class="ml-0.5">
        <ChevronUpDown16Regular />
      </el-icon>
    </el-button>
  </GdTooltip>

  <GdPopover :show="popoverVisible" @update:show="popoverVisible = $event" :width="300" :max-height="400"
    :anchor-el="buttonRef?.$el ?? null">
    <div class="flex flex-col gap-0.5">
      <!-- 已删除但仍被绑定的连接：连接清单里查不到，单独列出以便解除
           （否则这条绑定会一直跟着草稿/会话，用户无从察觉） -->
      <template v-if="missingBindingIds.length > 0">
        <div v-for="id in missingBindingIds" :key="id"
          class="flex items-center gap-1.25 px-2 py-1 rounded-md cursor-pointer transition-all duration-150 hover:bg-(--gd-color-sidebar-bg-hover)"
          @click="toggle(id)">
          <el-icon size="18" class="shrink-0 text-(--gd-color-text-gray) dark:text-(--gd-color-text-disabled)">
            <Cloud16Regular />
          </el-icon>
          <div class="flex-1 flex flex-col gap-0.5 min-w-0">
            <span class="text-sm font-medium text-(--gd-color-text) dark:text-[#e5e7eb] whitespace-nowrap overflow-hidden text-ellipsis">
              {{ t('chat.workspace.unknownConnection') }}
            </span>
            <span class="text-xs text-[#999] dark:text-[#6b7280] whitespace-nowrap overflow-hidden text-ellipsis">{{ id }}</span>
          </div>
          <el-icon size="14" class="shrink-0 text-(--el-color-primary)">
            <Checkmark16Filled />
          </el-icon>
        </div>
        <div class="h-px bg-[#eee] dark:bg-white/8 mx-2 my-1.5"></div>
      </template>

      <!-- 远程连接清单（共享组件：✓ 为已绑定，点击 toggle 不关闭；空态引导去设置页） -->
      <ConnectionBindingMenu :attached-ids="attachedIds" @toggle="toggle" />
    </div>
  </GdPopover>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElButton, ElIcon } from 'element-plus'
import { Checkmark16Filled, ChevronUpDown16Regular, Cloud16Regular, Cloud24Regular } from '@vicons/fluent'
import GdPopover from '../../ui/GdPopover.vue'
import GdTooltip from '../../ui/GdTooltip.vue'
import ConnectionBindingMenu from './ConnectionBindingMenu.vue'
import { SSH_CONNECTION_ATTACHMENT_TYPE } from '@/constants'
import { toggleConnectionBinding, useRemoteWorkspaceStore } from '@/stores/remoteWorkspace'
import { formatRemoteDirNames, resolveRemoteDirNames } from '@/utils/remoteDirDisplay'

const props = defineProps<{
  /** 当前附件绑定（settings.attachments）；本组件只回传切换后的整包，持久化由宿主负责 */
  attachments?: Record<string, string[]>
}>()

const emit = defineEmits<{
  /** 绑定变化后的完整 attachments（宿主写回草稿/会话并上行） */
  'update:attachments': [attachments: Record<string, string[]>]
}>()

const { t } = useI18n()
const remoteWorkspaceStore = useRemoteWorkspaceStore()

const buttonRef = ref<{ $el: HTMLElement } | null>(null)
const popoverVisible = ref(false)

/** 已绑定连接 ID（多选语义：同一键下是连接 ID 列表） */
const attachedIds = computed<string[]>(() => props.attachments?.[SSH_CONNECTION_ATTACHMENT_TYPE] ?? [])
const attachedCount = computed(() => attachedIds.value.length)

/** 按钮上的首个连接名（多个时后面再跟数量徽章）。取绑定顺序的第一个，
 *  名称由连接清单解析，过长由 CSS 截断 */
const firstAttachedName = computed(() => {
  const firstId = attachedIds.value[0]
  if (!firstId) return ''
  return resolveRemoteDirNames([firstId], remoteWorkspaceStore.connectionOptions)[0]
})

/** 连接清单是否在首次加载中：此时名称解析不出来，名称位置改用骨架占位（避免闪原始连接 ID）。
 *  加载失败（isLoading 转 false 但 hasLoaded 仍为 false）不再抖骨架，回退显示原始 ID */
const nameLoading = computed(() => !remoteWorkspaceStore.hasLoaded && remoteWorkspaceStore.isLoading)

/** 角标 hover 提示：已选连接名称（超过 3 个折叠计数，避免选十来个时提示条过长） */
const tooltipContent = computed(() => {
  if (attachedCount.value === 0) return ''
  const names = resolveRemoteDirNames(attachedIds.value, remoteWorkspaceStore.connectionOptions)
  const namesText = formatRemoteDirNames(names, (n) => t('chat.toolbar.remoteDirMore', { n }))
  return t('chat.toolbar.remoteDirTooltip', { names: namesText })
})

/** 已删除但绑定仍在的连接 ID（清单加载完成后才判定，避免加载中全被当成"未知连接"） */
const missingBindingIds = computed<string[]>(() => {
  if (!remoteWorkspaceStore.hasLoaded) return []
  const known = new Set(remoteWorkspaceStore.connectionOptions.map((c) => c.id))
  return attachedIds.value.filter((id) => !known.has(id))
})

function togglePopover(): void {
  popoverVisible.value = !popoverVisible.value
}

/** 绑定切换：复用多选语义（保留其他附件类型与其他连接） */
function toggle(connectionId: string): void {
  emit('update:attachments', toggleConnectionBinding(props.attachments, connectionId))
}

// 名称解析（按钮名称与 hover 提示）依赖连接清单：setup 期即发起，让首个渲染帧就是骨架占位
// 而不是"原始 ID → 名称"的跳变；弹窗打开时再兜底刷新（设置页新建连接后无需重进页面）
void remoteWorkspaceStore.ensureConnections()
watch(popoverVisible, (visible) => {
  if (visible) void remoteWorkspaceStore.ensureConnections()
})
</script>

<style scoped>
/* 工具条按钮：与 ChatInputToolbar 的 .workspace-btn 保持一致（scoped 不跨组件，故此处复刻；同 ChatPanel 的做法） */
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

/* 数量徽章：选多个时跟在首个连接名后（总数），告诉用户除展示的那个外还有几个 */
.remote-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 15px;
  height: 15px;
  padding: 0 4px;
  margin-left: 4px;
  border-radius: 999px;
  background: var(--gd-color-sidebar-bg-hover);
  color: var(--gd-color-text-gray);
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  flex-shrink: 0;
}

/* 连接清单加载中的骨架占位：微光扫过（对齐会话页 WorkingDirBar 的 .wdb-attach-skeleton），
   宽度按连接名的大致尺寸给，避免名称位置从"原始 ID"跳到真实名称 */
.rdb-skeleton {
  width: 56px;
  height: 11px;
  border-radius: 3px;
  background: linear-gradient(90deg,
      var(--gd-color-sidebar-bg-hover) 25%,
      var(--gd-color-surface-border) 50%,
      var(--gd-color-sidebar-bg-hover) 75%);
  background-size: 200% 100%;
  animation: rdb-skeleton-sweep 1.2s ease infinite;
  flex-shrink: 0;
}

@keyframes rdb-skeleton-sweep {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
</style>
