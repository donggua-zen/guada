<template>
  <div v-if="hasSubAgents" class="session-agent-list">
    <!-- 头部 -->
    <div class="shrink-0 flex items-center justify-between px-2">
      <h3 class="text-sm font-normal text-gray-500 dark:text-[#8b8d95] whitespace-nowrap mx-2">
        子任务
      </h3>
      <span class="text-xs text-gray-400 dark:text-[#6b6d73] mr-2">
        {{ allTabs.length }} 个
      </span>
    </div>

    <!-- 任务列表 -->
    <div class="agent-items overflow-y-auto py-2" style="max-height: 200px;">
      <div v-for="tab in allTabs" :key="tab.id"
        class="agent-item px-2 py-1.5 flex items-center gap-2 cursor-pointer transition-all duration-200" :class="{
          'bg-gray-100 dark:bg-[#2a2c30]': tab.id === activeTabId,
          'hover:bg-gray-100 dark:hover:bg-[#2a2c30]': tab.id !== activeTabId
        }" @click="$emit('switch', tab.id)">
        <!-- 名称 -->
        <span class="text-xs text-gray-600 dark:text-[#8b8d95] truncate flex-1" :title="tab.name">
          {{ tab.name }}
        </span>

        <!-- 运行中指示器 -->
        <el-icon v-if="tab.status === 'running'" size="12" class="text-blue-500 is-loading shrink-0">
          <Loading />
        </el-icon>
      </div>
    </div>
    <div class="border-b border-gray-100 dark:border-[#2e3035] mx-4 mt-3"></div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Loading } from '@element-plus/icons-vue';

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

const allTabs = computed(() => {
  return props.agentTabs || [];
});

const hasSubAgents = computed(() => allTabs.value.length > 1);
</script>

<style scoped>
.agent-items {
  scrollbar-width: thin;
}

.agent-items::-webkit-scrollbar {
  width: 4px;
}

.agent-items::-webkit-scrollbar-thumb {
  background-color: rgba(0, 0, 0, 0.1);
  border-radius: 4px;
}

.dark .agent-items::-webkit-scrollbar-thumb {
  background-color: rgba(255, 255, 255, 0.1);
}

.agent-item {
  border-radius: 4px;
  margin: 0 4px;
}
</style>
