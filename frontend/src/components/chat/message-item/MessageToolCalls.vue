<template>
  <div class="tool-calls-section my-1">
    <div
      class="h-7 inline-flex justify-center items-center text-sm text-gray-700 dark:text-[#8b8d95] cursor-pointer font-medium py-1 transition-colors duration-200 hover:bg-gray-100 dark:hover:bg-[#2a2c30] rounded px-1"
      @click.stop="openDialog">
        <el-icon class="" size="15">
          <Wrench24Filled class="text-gray-500" />
        </el-icon>
        <span class="text-gray-500 ml-2">{{ toolCallTextPrefix }}</span>
        <span v-if="firstToolName" class="mx-1 text-xs text-gray-400">{{ firstToolName }}</span>
        <span v-if="toolCount > 1" class="text-gray-500">等{{ toolCount }}个工具</span>
        <span v-else-if="toolCount === 1 && !isStreaming" class="text-gray-500"></span>
    </div>

    <ElDialog v-if="keepElement" v-model="showDialog" title="工具调用详情" width="700px" :close-on-click-modal="true" destroy-on-close
      :append-to-body="true" class="tool-dialog" @closed="keepElement = false">
      <div class="tool-dialog-content max-h-[60vh] overflow-y-auto">
        <div v-for="(tool, toolIndex) in toolCalls" :key="toolIndex" class="tool-call-detail mb-6 last:mb-0">

          <div class="flex items-center gap-2 mb-3 pb-2 border-b border-gray-200 dark:border-gray-700">
            <el-icon size="18" class="text-blue-500">
              <Wrench24Filled />
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
            <div class="bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
              <div v-if="isSimpleParams(tool.arguments || tool.args)" class="params-table">
                <div class="param-header py-2 border-b border-gray-200 dark:border-gray-700">
                  <span class="param-key text-sm font-semibold text-gray-800 dark:text-gray-200">参数</span>
                  <span class="param-value text-sm font-semibold text-gray-800 dark:text-gray-200 ml-4">值</span>
                </div>
                <div v-for="(value, key) in parseParams(tool.arguments || tool.args)" :key="key" 
                     class="param-row py-2 border-b border-gray-100 dark:border-gray-800 last:border-b-0">
                  <span class="param-key text-sm font-medium text-gray-700 dark:text-gray-300">{{ key }}</span>
                  <span class="param-value text-sm text-gray-600 dark:text-gray-400 ml-4">{{ formatParamValue(value) }}</span>
                </div>
              </div>
              <pre v-else
                class="text-sm overflow-x-auto text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-all">
                <code>{{ formatToolArgs(tool.arguments || tool.args) }}</code>
              </pre>
            </div>
          </div>

          <div v-if="toolResponses && toolResponses[toolIndex]" class="mt-4">
            <div class="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2 flex items-center">
              <el-icon size="14" class="mr-1 text-green-500">
                <CheckCircleOutlined />
              </el-icon>
              执行结果
            </div>
            <div class="bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
              <pre class="text-sm overflow-x-auto text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-all">{{
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
import { SettingsOutlined, CheckCircleOutlined } from '@vicons/material';
import { Wrench24Filled } from '@vicons/fluent';

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
const keepElement = ref(false);

const toolCount = computed(() => props.toolCalls?.length || 0);

const firstToolName = computed(() => {
  if (!props.toolCalls || props.toolCalls.length === 0) return '';
  return props.toolCalls[0].name || '未知工具';
});

const toolCallTextPrefix = computed(() => {
  const count = toolCount.value;
  
  if (count === 0) return '';
  
  return props.isStreaming ? '正在调用' : '已调用';
});

const openDialog = () => {
  showDialog.value = true;
  keepElement.value = true;
};

const closeDialog = () => {
  showDialog.value = false;
};

const isSimpleParams = (args: any): boolean => {
  try {
    const parsed = typeof args === 'string' ? JSON.parse(args) : args;
    // 如果是对象且层级不深,使用表格展示
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) && Object.keys(parsed).length > 0;
  } catch (e) {
    return false;
  }
};

const parseParams = (args: any): Record<string, any> => {
  try {
    return typeof args === 'string' ? JSON.parse(args) : args;
  } catch (e) {
    return {};
  }
};

const formatParamValue = (value: any): string => {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
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
    const content = parsed['content'];
    // 如果 content 是字符串,直接返回;如果是对象,才格式化
    return typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  } catch (e) {
    return String(response);
  }
};
</script>

<style scoped>
@reference "tailwindcss";

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

.params-table {
  display: flex;
  flex-direction: column;
}

.param-header {
  display: flex;
  align-items: baseline;
}

.param-row {
  display: flex;
  align-items: baseline;
}

.param-key {
  min-width: 120px;
  flex-shrink: 0;
}

.param-value {
  flex: 1;
  word-break: break-word;
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
