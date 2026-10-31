<template>
  <GdPopover :show="show" :width="240" :max-height="320" :anchor-el="anchorEl"
    @update:show="emit('update:show', $event)">
    <div v-for="agent in agents" :key="agent.id"
      class="flex items-center gap-1.5 px-2 py-1 rounded-md cursor-pointer transition-all duration-150"
      :class="agent.id === currentAgentId
        ? 'bg-(--gd-color-sidebar-bg-active) text-(--gd-color-sidebar-text-active)'
        : 'hover:bg-(--gd-color-sidebar-bg-hover)'"
      @click="handleSelect(agent)">
      <Avatar :src="agent.avatarUrl || undefined" :name="agent.name" type="assistant" :round="false"
        class="w-6 h-6 shrink-0" />
      <span class="flex-1 text-sm text-(--gd-color-text) truncate">{{ agent.name }}</span>
      <el-icon v-if="agent.id === currentAgentId" size="14" class="shrink-0 text-(--el-color-primary)">
        <Checkmark16Filled />
      </el-icon>
    </div>
    <div v-if="agents.length === 0" class="px-2 py-3 text-xs text-(--gd-color-text-gray)">
      {{ t('scheduler.composer.noAgents') }}
    </div>
  </GdPopover>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ElIcon } from 'element-plus'
import { Checkmark16Filled } from '@vicons/fluent'
import GdPopover from '@/components/ui/GdPopover.vue'
import Avatar from '@/components/ui/Avatar.vue'
import type { Agent } from '@/types/agent'

defineProps<{
  show: boolean
  anchorEl: HTMLElement | null
  agents: Agent[]
  currentAgentId: string | null
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  'select': [agent: Agent]
}>()

const { t } = useI18n()

function handleSelect(agent: Agent) {
  emit('select', agent)
  emit('update:show', false)
}
</script>
