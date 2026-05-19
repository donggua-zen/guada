<template>
  <div class="tool-calls-section my-1">
    <div class="flex" v-for="(tool, toolIndex) in toolCalls" :key="toolIndex">
      <!-- 循环展示每个工具调用 -->
      <div
        class="flex items-center text-sm text-gray-700 dark:text-[#8b8d95] cursor-pointer font-medium py-1 transition-colors duration-200 mb-1 min-w-0"
        @click.stop="openSingleToolDialog(toolIndex)">
        <el-icon class="flex-shrink-0" size="15">
          <component :is="getToolIconComponent(tool)" class="text-gray-500" />
        </el-icon>
        <div class="ml-2 truncate text-gray-400 dark:text-gray-500 ">
          <span class="text-gray-700 dark:text-gray-300 font-medium">{{ getActionText(tool) }}</span>
          <span v-if="getArgsText(tool)" class="text-sm ml-2">{{ getArgsText(tool)
          }}</span>
        </div>
      </div>
    </div>
  </div>
  <!-- 单个工具详情对话框 -->
  <ElDialog v-if="keepElement && selectedToolIndex !== null" v-model="showDialog"
    :title="`工具调用详情 #${selectedToolIndex + 1}`" width="700px" :close-on-click-modal="true" destroy-on-close
    :append-to-body="true" class="tool-dialog" @closed="keepElement = false">
    <div class="tool-dialog-content">
      <!-- 加载状态 -->
      <div v-if="isLoadingDetails" class="flex items-center justify-center py-8">
        <el-icon size="24" class="animate-spin text-blue-500 mr-2">
          <Loading />
        </el-icon>
        <span class="text-gray-500">加载工具详情中...</span>
      </div>
      <div v-else-if="selectedTool" class="tool-call-detail">
        <div class="flex items-center gap-2 mb-3 pb-2 border-b border-gray-200 dark:border-gray-700">
          <el-icon size="18" class="text-blue-500">
            <component :is="getToolIconComponent(selectedTool)" />
          </el-icon>
          <span class="text-base font-semibold text-gray-800 dark:text-gray-200">
            {{ getDisplayText(selectedTool) }}
          </span>
          <span class="text-xs text-gray-400 ml-auto">
            #{{ selectedToolIndex + 1 }}
          </span>
        </div>

        <div v-if="selectedTool.arguments || selectedTool.args" class="mb-4">
          <div class="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2 flex items-center">
            <el-icon size="14" class="mr-1">
              <SettingsOutlined />
            </el-icon>
            调用参数
          </div>
          <div class="bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
            <div v-if="isSimpleParams(selectedTool.arguments || selectedTool.args)" class="params-table">
              <div class="param-header py-2 border-b border-gray-200 dark:border-gray-700">
                <span class="param-key text-sm font-semibold text-gray-800 dark:text-gray-200">参数</span>
                <span class="param-value text-sm font-semibold text-gray-800 dark:text-gray-200 ml-4">值</span>
              </div>
              <div v-for="(value, key) in parseParams(selectedTool.arguments || selectedTool.args)" :key="key"
                class="param-row py-2 border-b border-gray-100 dark:border-gray-800 last:border-b-0">
                <span class="param-key text-sm font-medium text-gray-700 dark:text-gray-300">{{ key }}</span>
                <span class="param-value text-sm text-gray-600 dark:text-gray-400 ml-4">{{ formatParamValue(value)
                }}</span>
              </div>
            </div>
            <pre v-else class="text-sm overflow-x-auto text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-all">
                <code>{{ formatToolArgs(selectedTool.arguments || selectedTool.args) }}</code>
              </pre>
          </div>
        </div>

        <div v-if="currentToolResponses && currentToolResponses[selectedToolIndex]" class="mt-4">
          <div class="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2 flex items-center">
            <el-icon size="14" class="mr-1 text-green-500">
              <CheckCircleOutlined />
            </el-icon>
            执行结果
          </div>
          <div class="bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
            <pre class="text-sm overflow-x-auto text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-all">{{
              formatToolResponse(currentToolResponses[selectedToolIndex])
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
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElIcon, ElDialog, ElButton } from 'element-plus';
import { SettingsOutlined, CheckCircleOutlined } from '@vicons/material';
import { Wrench24Filled } from '@vicons/fluent';
// @ts-ignore - icons 组件尚未迁移到 TypeScript
import { Loading } from '@/components/icons';
import { getToolIconByNamespace } from '@/utils/toolIconMapper';
import { apiService } from '@/services/ApiService';
import { usePopup } from '@/composables/usePopup';

interface ToolDisplayInfo {
  action: string;
  args?: string;
  toolName?: string;
  toolType?: string;
  extra?: Record<string, any>;
}

interface ToolCall {
  name?: string;
  arguments?: any;
  args?: any;
  metadata?: {
    displayMessage?: ToolDisplayInfo | string;  // 支持结构化数据或字符串（兼容）
    [key: string]: any;
  };
}

const props = defineProps<{
  toolCalls: ToolCall[];
  toolResponses?: any[];
  isStreaming: boolean;
  contentId?: string;  // 消息内容 ID，用于懒加载完整数据
}>();

const { toast } = usePopup();

const showDialog = ref(false);
const keepElement = ref(false);
const selectedToolIndex = ref<number | null>(null);

// 懒加载状态
const isLoadingDetails = ref(false);
const loadedToolCalls = ref<ToolCall[] | null>(null);
const loadedToolResponses = ref<any[] | null>(null);

const toolCount = computed(() => props.toolCalls?.length || 0);

/**
 * 获取当前选中的工具（优先使用懒加载的完整数据）
 */
const selectedTool = computed(() => {
  if (selectedToolIndex.value === null) {
    return null;
  }
  // 如果已加载完整数据，使用完整数据
  if (loadedToolCalls.value && loadedToolCalls.value[selectedToolIndex.value]) {
    return loadedToolCalls.value[selectedToolIndex.value];
  }
  // 否则使用传入的摘要数据
  if (props.toolCalls) {
    return props.toolCalls[selectedToolIndex.value];
  }
  return null;
});

/**
 * 获取工具响应（优先使用懒加载的完整数据）
 */
const currentToolResponses = computed(() => {
  if (loadedToolResponses.value) {
    return loadedToolResponses.value;
  }
  return props.toolResponses;
});

/**
 * 判断是否需要懒加载（arguments 或 content 为空）
 */
const needsLazyLoad = computed(() => {
  if (!props.contentId) return false;
  // 检查第一个工具调用是否有参数
  const firstTool = props.toolCalls?.[0];
  if (!firstTool) return false;
  // 如果 arguments 和 args 都为空，则需要懒加载
  return !firstTool.arguments && !firstTool.args;
});

/**
 * 加载工具调用详情
 */
async function loadToolDetails() {
  if (!props.contentId || !needsLazyLoad.value) return;
  if (isLoadingDetails.value) return;

  isLoadingDetails.value = true;
  try {
    const result = await apiService.fetchMessageContentToolDetails(
      props.contentId
    );
    loadedToolCalls.value = result.toolCalls || [];
    loadedToolResponses.value = result.toolCallsResponse || [];
  } catch (error: any) {
    console.error('加载工具调用详情失败:', error);
    toast.error('加载工具详情失败');
  } finally {
    isLoadingDetails.value = false;
  }
}

// 监听弹窗打开状态，打开时触发懒加载
watch(showDialog, (newVal) => {
  if (newVal && needsLazyLoad.value) {
    loadToolDetails();
  }
});

/**
 * 根据工具的 namespace 或 toolType 获取对应的图标组件
 */
const getToolIconComponent = (tool: ToolCall) => {
  const displayInfo = tool.metadata?.displayMessage;
  
  if (typeof displayInfo === 'object' && displayInfo !== null) {
    const info = displayInfo as ToolDisplayInfo;
    // 优先使用 toolType（如 edit、search），其次从 toolName 提取 namespace
    const iconType = info.toolType || info.toolName?.split('__')[0];
    return getToolIconByNamespace(iconType);
  }
  
  return Wrench24Filled;
};

/**
 * 获取工具调用的展示文本（支持结构化数据）
 */
const getDisplayText = (tool: ToolCall): string => {
  const displayInfo = tool.metadata?.displayMessage;

  if (!displayInfo) {
    return tool.name || 'Unknown Tool';
  }

  // 如果是结构化数据
  if (typeof displayInfo === 'object' && displayInfo !== null) {
    const info = displayInfo as ToolDisplayInfo;
    // 组合 action 和 args
    if (info.args) {
      return `${info.action} ${info.args}`;
    }
    return info.action;
  }

  // 否则是字符串（兼容旧数据）
  return displayInfo as string;
};

/**
 * 获取动作文本（深色）
 */
const getActionText = (tool: ToolCall): string => {
  const displayInfo = tool.metadata?.displayMessage;

  if (!displayInfo) {
    return tool.name || 'Unknown Tool';
  }

  // 如果是结构化数据，返回 action
  if (typeof displayInfo === 'object' && displayInfo !== null) {
    return (displayInfo as ToolDisplayInfo).action;
  }

  // 否则是字符串（兼容旧数据）
  return displayInfo as string;
};

/**
 * 获取参数文本（灰色）
 */
const getArgsText = (tool: ToolCall): string | undefined => {
  const displayInfo = tool.metadata?.displayMessage;

  // 如果是结构化数据，返回 args
  if (typeof displayInfo === 'object' && displayInfo !== null) {
    return (displayInfo as ToolDisplayInfo).args;
  }

  // 否则没有参数
  return undefined;
};

/**
 * 打开单个工具详情对话框
 */
const openSingleToolDialog = (index: number) => {
  selectedToolIndex.value = index;
  // 重置懒加载数据，避免显示旧数据造成闪烁
  loadedToolCalls.value = null;
  loadedToolResponses.value = null;
  showDialog.value = true;
  keepElement.value = true;
};

const closeDialog = () => {
  showDialog.value = false;
  selectedToolIndex.value = null;
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
  /* 移除每次数据更新都会触发的淡入动画，避免闪烁 */
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
