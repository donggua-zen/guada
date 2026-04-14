<template>
  <div class="tool-calls-section">
    <div
      class="inline-block justify-center items-center text-sm text-gray-700 cursor-pointer font-medium my-1 py-1 transition-colors duration-200 hover:bg-gray-100 rounded px-1"
      @click.stop="openDialog">
      <div class="flex items-center">
        <el-icon class="" size="14">
          <BuildTwotone />
        </el-icon>
        <span class="text-gray-500 ml-2">{{ toolCallText }}</span>
      </div>
    </div>

    <ElDialog v-model="showDialog" title="工具调用详情" width="700px" :close-on-click-modal="true" destroy-on-close
      :append-to-body="true" class="tool-dialog">
      <div class="tool-dialog-content max-h-[60vh] overflow-y-auto">
        <div v-for="(tool, toolIndex) in toolCalls" :key="toolIndex" class="tool-call-detail mb-6 last:mb-0">

          <div class="flex items-center gap-2 mb-3 pb-2 border-b border-gray-200 dark:border-gray-700">
            <el-icon size="18" class="text-blue-500">
              <BuildTwotone />
            </el-icon>
            <span class="text-base font-semibold text-gray-800 dark:text-gray-200">
              {{ tool.name || 'Unknown Tool' }}
            </span>
            <span class="text-xs text-gray-400 ml-auto">
              调用 #{{ (toolIndex as number) + 1 }}
            </span>
          </div>

          <div v-if="tool.arguments || tool.args" class="mb-4">
            <div class="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2 flex items-center">
              <el-icon size="14" class="mr-1">
                <SettingsOutlined />
              </el-icon>
              调用参数
            </div>
            <pre
              class="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-3 text-sm overflow-x-auto text-gray-700 dark:text-gray-300">
              <code>{{ formatToolArgs(tool.arguments || tool.args) }}</code>
            </pre>
          </div>

          <div v-if="toolResponses && toolResponses[toolIndex]" class="mt-4">
            <div class="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2 flex items-center">
              <el-icon size="14" class="mr-1 text-green-500">
                <CheckCircleOutlined />
              </el-icon>
              执行结果
            </div>
            <div class="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
              <pre class="text-sm overflow-x-auto text-green-800 dark:text-green-300">{{
                formatToolResponse(toolResponses[toolIndex])
              }}</pre>
            </div>
          </div>
        </div>
      </div>

      <template #footer>
        <span class="dialog-footer">
          <el-button @click="closeDialog">关闭</el-button>
        </span>
      </template>
    </ElDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElIcon, ElDialog, ElButton } from 'element-plus';
import { BuildTwotone, SettingsOutlined, CheckCircleOutlined } from '@vicons/material';

interface ToolCall {
  name?: string;
  arguments?: any;
  args?: any;
}

const props = defineProps<{
  toolCalls: ToolCall[];
  toolResponses?: any[];
  isStreaming: boolean;
}>();

const showDialog = ref(false);

const toolCount = computed(() => props.toolCalls?.length || 0);

const toolCallText = computed(() => {
  if (props.isStreaming) {
    return `正在调用${toolCount.value}个工具`;
  }
  return `已调用${toolCount.value}个工具`;
});

const openDialog = () => {
  showDialog.value = true;
};

const closeDialog = () => {
  showDialog.value = false;
};

const formatToolArgs = (args: any): string => {
  if (!args) return '{}';
  try {
    const parsed = typeof args === 'string' ? JSON.parse(args) : args;
    return JSON.stringify(parsed, null, 2);
  } catch (e) {
    return String(args);
  }
};

const formatToolResponse = (response: any): string => {
  if (!response) return '无响应';
  try {
    const parsed = typeof response === 'string' ? JSON.parse(response) : response;
    return JSON.stringify(parsed['content'], null, 2);
  } catch (e) {
    return String(response);
  }
};
</script>

<style scoped>
@reference "tailwindcss";

.tool-calls-section {
  display: inline-block;
}

.tool-dialog-content {
  line-height: 1.6;
}

.tool-call-detail {
  animation: fadeIn 0.3s ease;
}

.tool-call-detail pre {
  white-space: pre-wrap;
  word-break: break-word;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
}

.tool-call-detail code {
  font-size: 13px;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(-5px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
