<template>
  <div class="process-section tool-calls-section space-y-2">
    <div class="" v-for="(tool, toolIndex) in toolCalls" :key="toolIndex">
      <!-- 循环展示每个工具调用 -->
      <div
        class="flex items-center text-sm text-gray-700 dark:text-[#8b8d95] cursor-pointer font-medium transition-colors duration-200 min-w-0"
        @click.stop="openSingleToolDialog(toolIndex)">
        <el-icon v-if="tool.outcome === 'error' || tool.outcome === 'rejected'" class="shrink-0" size="15"
          style="color: #f56c6c;">
          <component :is="getToolIcon(tool)" />
        </el-icon>
        <el-icon v-else-if="tool.outcome === 'aborted'" class="shrink-0" size="15" style="color: #c0c4cc;">
          <component :is="getToolIcon(tool)" />
        </el-icon>
        <el-icon v-else class="shrink-0" size="15" :class="{ 'shimmer-icon': isToolExecuting(tool, toolIndex) }">
          <component :is="getToolIcon(tool)" class="text-gray-500" />
        </el-icon>
        <div class="ml-1.5 min-w-0 flex-1 flex items-center text-gray-400 dark:text-gray-500 overflow-hidden">
          <span class="shrink-0"
            :class="tool.outcome === 'aborted' ? 'text-gray-400 dark:text-gray-500 font-medium' : 'text-gray-700 dark:text-gray-300 font-medium'">{{
              getActionText(tool, toolIndex) }}</span>
          <span v-if="getArgsText(tool)" class="text-sm ml-2 truncate">{{ getArgsText(tool) }}</span>
        </div>
      </div>
      <!-- 内联内容区（暂时禁用，待交互方案确定后启用）
      <div v-if="getInlineContent(tool) && isToolExecuting(tool, toolIndex)" class="inline-content-container"
        :class="{ 'inline-content-container--expanded': true }">
        <div class="inline-content-wrapper">
          <div class="border-l ml-1.5 pl-4 border-gray-300 dark:border-gray-700">
            <pre class="inline-content-pre text-xs text-gray-500 dark:text-gray-400 overflow-auto"
              ref="inlineContentRefs">{{ getInlineContent(tool) }}</pre>
          </div>
        </div>
      </div>
      -->
    </div>
  </div>


  <!-- 单个工具详情对话框 -->
  <LDialog v-if="keepElement && selectedToolIndex !== null" v-model="showDialog"
    :title="t('chat.toolCalls.detailTitle', { index: selectedToolIndex + 1 })" width="700px" :close-on-click-modal="true" destroy-on-close
    :append-to-body="true" class="tool-dialog" @closed="keepElement = false">
    <div class="tool-dialog-content">
      <!-- 加载状态 -->
      <div v-if="isLoadingDetails" class="flex items-center justify-center py-8">
        <el-icon size="24" class="animate-spin text-blue-500 mr-2">
          <Loading />
        </el-icon>
        <span class="text-gray-500">{{ t('chat.toolCalls.loadingDetails') }}</span>
      </div>
      <div v-else-if="selectedTool" class="tool-call-detail">
        <div class="flex items-center gap-2 mb-3 pb-2 border-b border-gray-200 dark:border-gray-700">
          <el-icon v-if="isExecuting" size="18" class="text-blue-500">
            <component :is="getToolIcon(selectedTool)" />
          </el-icon>
          <el-icon v-else-if="selectedTool?.outcome === 'error' || selectedTool?.outcome === 'rejected'" size="18"
            style="color:#f56c6c">
            <component :is="getToolIcon(selectedTool)" />
          </el-icon>
          <el-icon v-else size="18" class="text-blue-500">
            <component :is="getToolIcon(selectedTool)" />
          </el-icon>
          <span class="text-base font-semibold text-gray-800 dark:text-gray-200">
            {{ getToolDisplayName(selectedTool) }}
          </span>
          <span class="text-xs text-gray-400 ml-auto">
            #{{ selectedToolIndex + 1 }}
          </span>
        </div>

        <div v-if="getToolArgs(selectedTool)" class="mb-4">
          <div class="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2 flex items-center">
            <el-icon size="14" class="mr-1">
              <SettingsOutlined />
            </el-icon>
            {{ t('chat.toolCalls.callParams') }}
          </div>
          <div class="bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
            <div v-if="isSimpleParams(getToolArgs(selectedTool))" class="params-table">
              <div class="param-header py-2 border-b border-gray-200 dark:border-gray-700">
                <span class="param-key text-sm font-semibold text-gray-800 dark:text-gray-200">{{ t('chat.toolCalls.paramKey') }}</span>
                <span class="param-value text-sm font-semibold text-gray-800 dark:text-gray-200 ml-4">{{ t('chat.toolCalls.paramValue') }}</span>
              </div>
              <div v-for="(value, key) in parseParams(getToolArgs(selectedTool))" :key="key"
                class="param-row py-2 border-b border-gray-100 dark:border-gray-800 last:border-b-0">
                <span class="param-key text-sm font-medium text-gray-700 dark:text-gray-300">{{ key }}</span>
                <span class="param-value text-sm text-gray-600 dark:text-gray-400 ml-4">{{ formatParamValue(value)
                  }}</span>
              </div>
            </div>
            <pre v-else class="text-sm overflow-x-auto text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-all">
                <code>{{ formatToolArgs(getToolArgs(selectedTool)) }}</code>
              </pre>
          </div>
        </div>

        <div v-if="currentToolResponses && currentToolResponses[selectedToolIndex]" class="mt-4">
          <div class="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2 flex items-center">
            <el-icon v-if="selectedTool?.outcome === 'error' || selectedTool?.outcome === 'rejected'" size="14"
              class="mr-1" style="color:#f56c6c">
              <ErrorCircle16Regular />
            </el-icon>
            <el-icon v-else size="14" class="mr-1 text-green-500">
              <CheckCircleOutlined />
            </el-icon>
            <span v-if="selectedTool?.outcome === 'error' || selectedTool?.outcome === 'rejected'">{{ t('chat.toolCalls.resultFailed') }}</span>
            <span v-else>{{ t('chat.toolCalls.resultSuccess') }}</span>
          </div>
          <div class="bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
            <!-- JSON 解码成功且为简单对象 → 表格展示 -->
            <div v-if="isSimpleResult(currentToolResponses[selectedToolIndex])" class="params-table">
              <div class="param-header py-2 border-b border-gray-200 dark:border-gray-700">
                <span class="param-key text-sm font-semibold text-gray-800 dark:text-gray-200">{{ t('chat.toolCalls.fieldKey') }}</span>
                <span class="param-value text-sm font-semibold text-gray-800 dark:text-gray-200 ml-4">{{ t('chat.toolCalls.paramValue') }}</span>
              </div>
              <div v-for="(value, key) in parseResult(currentToolResponses[selectedToolIndex])" :key="key"
                class="param-row py-2 border-b border-gray-100 dark:border-gray-800 last:border-b-0">
                <span class="param-key text-sm font-medium text-gray-700 dark:text-gray-300">{{ key }}</span>
                <span class="param-value text-sm text-gray-600 dark:text-gray-400 ml-4">{{ formatParamValue(value)
                  }}</span>
              </div>
            </div>
            <!-- JSON 解码失败或复杂对象 → pre 展示 -->
            <pre v-else class="text-sm overflow-x-auto text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-all">{{
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
  </LDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElIcon, ElButton } from 'element-plus';
import { useI18n } from 'vue-i18n';
import { SettingsOutlined, CheckCircleOutlined } from '@vicons/material';
import { ErrorCircle16Regular } from '@vicons/fluent';
// @ts-ignore - icons 组件尚未迁移到 TypeScript
import { Loading } from '@/components/icons';
import { parse as partialParse } from 'partial-json';
import { apiService } from '@/services/ApiService';
import { usePopup } from '@/composables/usePopup';
import LDialog from '@/components/ui/LDialog.vue';
import {
  type ToolCall,
  resolveToolName, getToolConfig, getToolIcon,
  formatArgSummary, getToolArgs, getArgsText,
} from '@/utils/toolDisplay';

const props = defineProps<{
  toolCalls: ToolCall[];
  toolResponses?: any[];
  isStreaming?: boolean;
  contentId?: string;
}>();

const { toast } = usePopup();
const { t } = useI18n();

// ── 执行状态 ──

const isExecuting = computed(() => {
  if (props.isStreaming === false) return false;
  if (props.toolResponses && props.toolResponses.length > 0) return false;
  if (props.toolCalls?.some((tc) => tc.outcome)) return false;
  return true;
});

const isToolExecuting = (tool: ToolCall, index: number): boolean => {
  if (tool.outcome) return false;
  if (props.isStreaming === false) return false;
  if (props.toolResponses && props.toolResponses[index]) return false;
  return true;
};

// ── 展示文案 ──

const getActionText = (tool: ToolCall, toolIndex: number): string => {
  const config = getToolConfig(tool);
  const executing = isToolExecuting(tool, toolIndex);
  if (tool.outcome === 'aborted') {
    return `${config.text.completed}（${t('chat.toolCalls.aborted')}）`;
  }
  return executing ? config.text.executing : config.text.completed;
};

const getToolDisplayName = (tool: ToolCall): string => {
  const name = resolveToolName(tool);
  if (tool.name === 'tool_use' && name !== tool.name) {
    return `tool_use.${name}`;
  }
  return tool.name || 'Unknown Tool';
};

// ── 弹窗 & 懒加载 ──

const showDialog = ref(false);
const keepElement = ref(false);
const selectedToolIndex = ref<number | null>(null);
const isLoadingDetails = ref(false);
const loadedToolCalls = ref<ToolCall[] | null>(null);
const loadedToolResponses = ref<any[] | null>(null);

const selectedTool = computed(() => {
  if (selectedToolIndex.value === null) return null;
  if (loadedToolCalls.value && loadedToolCalls.value[selectedToolIndex.value]) {
    return loadedToolCalls.value[selectedToolIndex.value];
  }
  if (props.toolCalls) {
    return props.toolCalls[selectedToolIndex.value];
  }
  return null;
});

const currentToolResponses = computed(() => {
  if (loadedToolResponses.value) return loadedToolResponses.value;
  return props.toolResponses;
});

const needsLazyLoad = computed(() => {
  if (!props.contentId) return false;
  if (isExecuting.value) return false;
  return true;
});

async function loadToolDetails() {
  if (!props.contentId || !needsLazyLoad.value) return;
  if (isLoadingDetails.value) return;

  isLoadingDetails.value = true;
  try {
    const result = await apiService.fetchMessageContentToolDetails(props.contentId);
    loadedToolCalls.value = result.toolCalls || [];
    loadedToolResponses.value = result.toolCallsResponse || [];
  } catch (error: any) {
    console.error('加载工具调用详情失败:', error);
    toast.error(t('chat.toolCalls.loadDetailsFailed'));
  } finally {
    isLoadingDetails.value = false;
  }
}

watch(showDialog, (newVal) => {
  if (newVal && needsLazyLoad.value) {
    loadToolDetails();
  }
});

const openSingleToolDialog = (index: number) => {
  selectedToolIndex.value = index;
  loadedToolCalls.value = null;
  loadedToolResponses.value = null;
  showDialog.value = true;
  keepElement.value = true;
};

const closeDialog = () => {
  showDialog.value = false;
  selectedToolIndex.value = null;
};

// ── 参数 / 结果格式化 ──

const isSimpleParams = (args: any): boolean => {
  try {
    const parsed = typeof args === 'string' ? partialParse(args) : args;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) && Object.keys(parsed).length > 0;
  } catch {
    return false;
  }
};

const parseParams = (args: any): Record<string, any> => {
  try {
    return typeof args === 'string' ? partialParse(args) : args;
  } catch {
    return {};
  }
};

const formatParamValue = (value: any): string => {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
};

const formatToolArgs = (args: any): string => {
  if (!args) return '{}';
  try {
    const parsed = typeof args === 'string' ? partialParse(args) : args;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return String(args);
  }
};

const extractResultContent = (response: any): any => {
  if (!response) return null;
  try {
    const parsed = typeof response === 'string' ? partialParse(response) : response;
    if (parsed.content) {
      try {
        const parsedContent = typeof parsed.content === 'string' ? partialParse(parsed.content) : parsed.content;
        // partialParse 会将 "[ ] step1" 等非 JSON 文本误解析为空数组 []
        // 此时回退到原始字符串
        if (Array.isArray(parsedContent) && parsedContent.length === 0) {
          return parsed.content;
        }
        return parsedContent;
      } catch {
        return parsed.content;
      }
    }
    return parsed;
  } catch {
    return null;
  }
};

const formatToolResponse = (response: any): string => {
  if (!response) return t('chat.toolCalls.noResponse');
  const content = extractResultContent(response);
  if (content) {
    if (typeof content === 'string') return content;
    return JSON.stringify(content, null, 2);
  }
  return String(response);
};

const isSimpleResult = (response: any): boolean => {
  const content = extractResultContent(response);
  if (!content) return false;
  return typeof content === 'object' && content !== null && !Array.isArray(content) && Object.keys(content).length > 0;
};

const parseResult = (response: any): Record<string, any> => {
  const content = extractResultContent(response);
  return content && typeof content === 'object' ? content : {};
};
</script>

<style scoped>
.tool-dialog-content {
  line-height: 1.6;
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
  white-space: pre-wrap;
}
</style>
