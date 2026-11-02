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
          
            <Lightbulb24Regular class="text-gray-500 dark:text-gray-400 size-4" />
          
          <div class="flex flex-col">
            <span>{{ t('chat.input.planModeLabel') }}</span>
            <span class="text-xs text-gray-400 dark:text-gray-500">{{ t('chat.input.planModeDesc') }}</span>
          </div>
        </div>
        
          <Checkmark16Regular v-if="planEnabled" class="text-gray-500 dark:text-gray-400 size-4" />
        
      </div>

      <!-- 分隔线：上面是正交的协作开关，下面是三选一的安全档位，不是同一个组 -->
      <div class="rm-divider" role="separator"></div>

      <div v-for="opt in options" :key="opt.value"
        class="rm-item flex items-center justify-between px-1.5 py-1.5 cursor-pointer transition-all text-sm rounded-(--gd-size-dialog-rounded-radius)"
        :class="{ 'rm-item--danger': opt.danger }"
        @click="handleSelect(opt.value)">
        <div class="flex items-center space-x-2">
          
            <component class="size-4" :class="opt.danger ? 'text-red-500' : 'text-gray-500 dark:text-gray-400'" :is="opt.icon" />
          
          <div class="flex flex-col">
            <span :class="opt.danger ? 'text-red-500 font-medium' : ''">{{ opt.label }}</span>
            <span class="text-xs text-gray-400 dark:text-gray-500">{{ opt.desc }}</span>
          </div>
        </div>
        
          <Checkmark16Regular v-if="currentValue === opt.value" class="size-4 shrink-0" :class="opt.danger ? 'text-red-500' : 'text-gray-500 dark:text-gray-400'" />
        
      </div>
    </div>
  </GdPopover>
</template>

<script setup lang="ts">
import { computed, onMounted, type Component } from 'vue'

import { useI18n } from 'vue-i18n'
import { ShieldLock20Regular, ClipboardTask20Regular, ShieldError16Regular, Checkmark16Regular, Lightbulb24Regular } from '@vicons/fluent'
import GdPopover from '../../ui/GdPopover.vue'
import { useCapabilitiesStore } from '@/stores/capabilities'

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
 * 后端平台与可选档位。Windows 后端不提供 read-only（shell 只有命令白名单，
 * 不是真正的只读沙盒）；平台必须以后端能力端点为准，客户端平台在
 * 手机浏览器/Web 访问 Windows 后端时不可靠。
 */
const capabilities = useCapabilitiesStore()

onMounted(() => {
  void capabilities.ensureLoaded()
})

const options = computed<RunModeOption[]>(() => {
  const all: RunModeOption[] = [
    {
      value: 'read-only',
      label: t('chat.input.runModeReadOnly'),
      desc: t('chat.input.runModeReadOnlyDesc'),
      icon: ClipboardTask20Regular,
    },
    {
      value: 'workspace-write',
      label: t('chat.input.runModeWorkspaceWrite'),
      desc: capabilities.isWindows
        ? t('chat.input.runModeWorkspaceWriteDescWin')
        : t('chat.input.runModeWorkspaceWriteDesc'),
      icon: ShieldLock20Regular,
    },
    { value: 'danger-full-access', label: t('chat.input.runModeFullAccess'), desc: t('chat.input.runModeFullAccessDesc'), icon: ShieldError16Regular, danger: true },
  ]
  return all.filter((opt) => capabilities.isSupported(opt.value))
})

function handleSelect(mode: string) {
  if (!capabilities.isSupported(mode)) return
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
