<template>
  <div
    class="agent-tab-bar flex items-center gap-1 px-4 py-1 bg-gray-50 dark:bg-[#1c1d20] border-b border-gray-200 dark:border-[#2a2c30] overflow-x-auto"
  >
    <div
      v-for="tab in tabs"
      :key="tab.id"
      class="agent-tab flex items-center gap-1.5 px-3 py-1.5 rounded-lg cursor-pointer text-sm whitespace-nowrap select-none transition-all"
      :class="{
        'bg-white dark:bg-[#2a2c30] text-gray-900 dark:text-[#e8e9ed] shadow-sm': tab.id === activeTab,
        'text-gray-500 dark:text-[#8b8d95] hover:bg-gray-100 dark:hover:bg-[#25262a]': tab.id !== activeTab,
      }"
      @click="$emit('switch', tab.id)"
    >
      <!-- 运行状态指示器 -->
      <el-icon
        v-if="tab.status === 'running'"
        class="is-loading text-blue-500"
        size="12"
      >
        <Loading />
      </el-icon>
      <span
        v-else-if="tab.status === 'completed'"
        class="w-3 h-3 rounded-full bg-green-500"
      />
      <span
        v-else
        class="w-3 h-3 rounded-full bg-red-500"
      />

      <span>{{ tab.name }}</span>

      <!-- 关闭按钮（仅子 Agent） -->
      <el-icon
        v-if="tab.id !== 'main'"
        size="14"
        class="ml-1 rounded hover:bg-gray-200 dark:hover:bg-[#3a3c40] p-0.5"
        @click.stop="$emit('close', tab.id)"
      >
        <Close />
      </el-icon>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Loading, Close } from '@element-plus/icons-vue';

/**
 * Agent Tab 数据接口
 */
export interface AgentTab {
  id: string;
  name: string;
  status: 'running' | 'completed' | 'error';
  loaded?: boolean;
}

defineProps<{
  tabs: AgentTab[];
  activeTab: string;
}>();

defineEmits<{
  switch: [tabId: string];
  close: [tabId: string];
}>();
</script>
