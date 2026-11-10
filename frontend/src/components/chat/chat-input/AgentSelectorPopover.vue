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
      <!-- 插件智能体徽标 -->
      <span v-if="agent.pluginId"
        class="shrink-0 inline-flex items-center px-1 py-0.5 text-[10px] leading-none rounded border border-purple-300 dark:border-purple-700 bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300"
        :title="t('agents.list.pluginAgentTip', { plugin: agent.pluginId })">
        {{ t('agents.list.pluginAgentBadge') }}
      </span>

        <Checkmark16Filled v-if="agent.id === currentAgentId" class="shrink-0 text-(--gd-color-primary) w-3.5 h-3.5"  />
      
    </div>
    <div v-if="agents.length === 0" class="px-2 py-3 text-xs text-(--gd-color-text-gray)">
      {{ t('scheduler.composer.noAgents') }}
    </div>
  </GdPopover>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

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
