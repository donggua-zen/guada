<template>
  <GdPopover :show="visible" @update:show="$emit('update:visible', $event)" :width="260" :anchor-el="anchorEl">
    <template #header>
    </template>
    <div class="popover-content space-y-0.5">
      <!-- 计划模式：与三个安全档位正交的独立开关（协作状态），故不属于下面的单选组——
           它是勾选项，勾上 = 已开启。放在最前，因为"先规划再动手"是它前面的一步。 -->
      <div
        class="rm-item flex items-center justify-between px-1.5 py-1.5 cursor-pointer transition-all text-sm rounded-(--gd-size-dialog-rounded-radius)"
        @click="handleTogglePlan">
        <div class="flex items-center space-x-2">
          <el-icon size="16" class="text-gray-500 dark:text-gray-400">
            <Lightbulb24Regular />
          </el-icon>
          <div class="flex flex-col">
            <span>{{ t('chat.input.planModeLabel') }}</span>
            <span class="text-xs text-gray-400 dark:text-gray-500">{{ t('chat.input.planModeDesc') }}</span>
          </div>
        </div>
        <el-icon v-if="planEnabled" size="16" class="text-gray-500 dark:text-gray-400">
          <Checkmark16Regular />
        </el-icon>
      </div>

      <!-- 分隔线：上面是正交的协作开关，下面是三选一的安全档位，不是同一个组 -->
      <div class="rm-divider" role="separator"></div>

      <div v-for="opt in options" :key="opt.value"
        class="rm-item flex items-center justify-between px-1.5 py-1.5 cursor-pointer transition-all text-sm rounded-(--gd-size-dialog-rounded-radius)"
        :class="{ 'rm-item--danger': opt.danger }"
        @click="handleSelect(opt.value)">
        <div class="flex items-center space-x-2">
          <el-icon size="16" :class="opt.danger ? 'text-red-500' : 'text-gray-500 dark:text-gray-400'">
            <component :is="opt.icon" />
          </el-icon>
          <div class="flex flex-col">
            <span :class="opt.danger ? 'text-red-500 font-medium' : ''">{{ opt.label }}</span>
            <span class="text-xs text-gray-400 dark:text-gray-500">{{ opt.desc }}</span>
          </div>
        </div>
        <el-icon v-if="currentValue === opt.value" size="16"
          :class="opt.danger ? 'text-red-500' : 'text-gray-500 dark:text-gray-400'">
          <Checkmark16Regular />
        </el-icon>
      </div>
    </div>
  </GdPopover>
</template>

<script setup lang="ts">
import { computed, type Component } from 'vue'
import { ElIcon } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { ShieldLock20Regular, ClipboardTask20Regular, ShieldError16Regular, Checkmark16Regular, Lightbulb24Regular } from '@vicons/fluent'
import GdPopover from '../../ui/GdPopover.vue'

const { t } = useI18n()

interface RunModeOption {
  value: string
  label: string
  desc: string
  icon: Component
  danger?: boolean
}

defineProps<{
  visible: boolean
  anchorEl: HTMLElement | null
  currentValue: string
  /** 计划模式是否开启（正交于 currentValue，故单独一项、单独出勾） */
  planEnabled: boolean
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  'select': [mode: string]
  'toggle-plan': []
}>()

/**
 * 当前平台。Windows 上 shell 没有 OS 沙盒（由命令策略层接管：只读白名单 + 审批），
 * 档位描述必须说清真实语义，否则用户以为"工作区可写"仍限制命令写入路径。
 * 非 Electron 环境（浏览器 dev）用 navigator.platform 兜底判 Windows。
 */
const isWindows = computed(() => {
  const electronPlatform = window.electronAPI?.platform
  if (typeof electronPlatform === 'string') return electronPlatform === 'win32'
  return typeof navigator !== 'undefined' && navigator.platform.startsWith('Win')
})

const options = computed<RunModeOption[]>(() => [
  {
    value: 'read-only',
    label: t('chat.input.runModeReadOnly'),
    desc: isWindows.value ? t('chat.input.runModeReadOnlyDescWin') : t('chat.input.runModeReadOnlyDesc'),
    icon: ClipboardTask20Regular,
  },
  {
    value: 'workspace-write',
    label: t('chat.input.runModeWorkspaceWrite'),
    desc: isWindows.value ? t('chat.input.runModeWorkspaceWriteDescWin') : t('chat.input.runModeWorkspaceWriteDesc'),
    icon: ShieldLock20Regular,
  },
  { value: 'danger-full-access', label: t('chat.input.runModeFullAccess'), desc: t('chat.input.runModeFullAccessDesc'), icon: ShieldError16Regular, danger: true },
])

function handleSelect(mode: string) {
  emit('select', mode)
  emit('update:visible', false)
}

function handleTogglePlan() {
  emit('toggle-plan')
  emit('update:visible', false)
}
</script>

<style scoped>
.popover-content {
  padding: 0;
}

.rm-item:hover {
  background: var(--gd-color-sidebar-bg-hover);
}

.rm-item--danger:hover {
  background: rgba(239, 68, 68, 0.08);
}

.rm-divider {
  height: 1px;
  margin: 4px 0;
  background: var(--gd-color-surface-border);
}
</style>
