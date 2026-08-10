<template>
  <div v-if="hasSubAgents" class="max-w-full w-full flex px-4">
    <div class="agent-panel w-full" :class="{ 'is-expanded': isExpanded }">
      <!-- Header bar (clickable to toggle) -->
      <div class="agent-panel-header" @click="isExpanded = !isExpanded">
        <span class="flex-1 text-xs text-gray-500 dark:text-[#8b8d95] truncate">
          <template v-if="!isExpanded">
            {{ t('chat.agent.subAgentCount', { count: subAgentCount }) }}<span v-if="runningCount > 0">{{ t('chat.agent.subAgentRunning', { count: runningCount }) }}</span>
          </template>
          <template v-else>{{ t('chat.agent.subAgent') }}</template>
        </span>
        <svg class="shrink-0 text-gray-400 dark:text-[#6b6d73] transition-transform duration-200"
          :class="{ 'rotate-180': isExpanded }" width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </div>
      <!-- Expandable agent list -->
      <div class="agent-panel-list-wrapper">
        <div class="agent-panel-list">
          <div v-for="tab in allTabs" :key="tab.id" class="agent-panel-item"
            :class="{ 'is-active': tab.id === activeTabId }" @click="$emit('switch', tab.id)">
            <img v-if="tab.avatarUrl" :src="tab.avatarUrl" class="w-5 h-5 rounded-full shrink-0 object-cover"
              alt="" />
            <span class="flex-1 text-xs truncate"
              :class="tab.id === activeTabId ? 'text-gray-900 dark:text-white font-medium' : 'text-gray-600 dark:text-[#8b8d95]'"
              :title="tab.name">{{ tab.name }}</span>
            <el-icon v-if="tab.status === 'running'" size="12" class="text-blue-500 is-loading shrink-0">
              <Loading />
            </el-icon>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { Loading } from '@element-plus/icons-vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

interface AgentTab {
  id: string;
  name: string;
  status: 'running' | 'completed' | 'error';
  loaded?: boolean;
  avatarUrl?: string;
}

const props = defineProps<{
  agentTabs?: AgentTab[];
  activeTabId?: string;
}>();

defineEmits<{
  switch: [tabId: string];
}>();

const isExpanded = ref(false);

const allTabs = computed(() => props.agentTabs || []);

const hasSubAgents = computed(() => allTabs.value.length > 1);

const subAgentCount = computed(() => Math.max(0, allTabs.value.length - 1));

const runningCount = computed(() =>
  allTabs.value.filter(t => t.id !== 'main' && t.status === 'running').length,
);
</script>

<style scoped>
.agent-panel {
  border-radius: var(--size-dialog-rounded-radius) var(--size-dialog-rounded-radius) 0 0;
  background: rgba(229, 231, 235, 0.8);
  backdrop-filter: blur(20px) saturate(1.5);
  -webkit-backdrop-filter: blur(20px) saturate(1.5);
  overflow: hidden;
}

.dark .agent-panel {
  background: rgba(42, 42, 42, 0.8);
  -webkit-backdrop-filter: blur(20px) saturate(1.5);
  backdrop-filter: blur(20px) saturate(1.5);
}

.agent-panel-header {
  display: flex;
  align-items: center;
  padding: 8px 16px 4px;
  cursor: pointer;
  transition: background 0.15s;
}

.agent-panel-header:hover {
  background: rgba(0, 0, 0, 0.03);
}

.dark .agent-panel-header:hover {
  background: rgba(255, 255, 255, 0.04);
}

.agent-panel-list-wrapper {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.25s ease;
}

.agent-panel.is-expanded .agent-panel-list-wrapper {
  max-height: 300px;
}

.agent-panel-list {
  padding: 0 8px 8px;
  max-height: 240px;
  overflow-y: auto;
  scrollbar-width: thin;
}

.agent-panel-list::-webkit-scrollbar {
  width: 4px;
}

.agent-panel-list::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.15);
  border-radius: 2px;
}

.dark .agent-panel-list::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
}

.agent-panel-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: calc(var(--size-dialog-rounded-radius)/2);
  cursor: pointer;
  transition: background 0.15s;
  margin-top: 2px;
}

.agent-panel-item:hover {
  background: rgba(0, 0, 0, 0.04);
}

.dark .agent-panel-item:hover {
  background: rgba(255, 255, 255, 0.05);
}

.agent-panel-item.is-active {
  background: rgba(0, 0, 0, 0.06);
}

.dark .agent-panel-item.is-active {
  background: rgba(255, 255, 255, 0.08);
}
</style>
