<template>
  <div class="process-section tool-calls-section space-y-2">
    <div class="" v-for="(tool, toolIndex) in toolCalls" :key="toolIndex">
      <!-- 循环展示每个工具调用 -->
      <div
        class="group flex items-center text-sm text-gray-700 dark:text-[#8b8d95] cursor-pointer font-medium transition-colors duration-200 min-w-0"
        @click.stop="toggleExpand(toolIndex)">
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
        <!-- 展开箭头：闭合朝右、展开朝下；hover 时显示，展开后持续显示 -->
        <el-icon class="shrink-0 ml-2 text-gray-400 transition-opacity duration-200"
          :class="isExpanded(toolIndex) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'" size="12">
          <ChevronDown12Regular :class="{ '-rotate-90': !isExpanded(toolIndex) }"
            class="transition-transform duration-200" />
        </el-icon>
      </div>

      <!-- 内联结果区（默认闭合，点击展开后显示结果） -->
      <div v-if="isExpanded(toolIndex)"
        class="tool-result-inline border-l ml-1.75 pl-4 border-gray-300 dark:border-gray-700">
        <!-- 仅失败时显示状态提示（成功/无响应不显示状态文案，直接展示结果或留空） -->
        <div v-if="tool.outcome === 'error' || tool.outcome === 'rejected'"
          class="flex items-center text-xs text-gray-500 dark:text-gray-400 mb-1.5">
          <el-icon size="13" style="color:#f56c6c">
            <ErrorCircle16Regular />
          </el-icon>
          <span class="ml-1.5">{{ t('chat.toolCalls.resultFailed') }}</span>
        </div>

        <!-- 结果内容 -->
        <div v-if="getToolResponses(toolIndex)">
          <!-- JSON 解码成功且为简单对象 → 表格展示 -->
          <div v-if="isSimpleResult(getToolResponses(toolIndex))" class="params-table">
            <div class="param-header py-1.5 border-b border-gray-200 dark:border-gray-700">
              <span class="param-key text-xs font-semibold text-gray-800 dark:text-gray-200">{{ t('chat.toolCalls.fieldKey') }}</span>
              <span class="param-value text-xs font-semibold text-gray-800 dark:text-gray-200 ml-4">{{ t('chat.toolCalls.paramValue') }}</span>
            </div>
            <div v-for="(value, key) in parseResult(getToolResponses(toolIndex))" :key="key"
              class="param-row py-1.5 border-b border-gray-100 dark:border-gray-800 last:border-b-0">
              <span class="param-key text-xs font-medium text-gray-700 dark:text-gray-300">{{ key }}</span>
              <span class="param-value text-xs text-gray-600 dark:text-gray-400 ml-4">{{ formatParamValue(value) }}</span>
            </div>
          </div>
          <!-- JSON 解码失败或复杂对象 → pre 展示（依赖 pre-wrap + break-all 换行，无需横向滚动） -->
          <pre v-else class="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-all">{{
            formatToolResponse(getToolResponses(toolIndex))
          }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElIcon } from 'element-plus';
import { useI18n } from 'vue-i18n';
import { ErrorCircle16Regular, ChevronDown12Regular } from '@vicons/fluent';
import { parse as partialParse } from 'partial-json';
import {
  type ToolCall,
  getToolConfig, getToolIcon,
  getToolArgs, getArgsText,
} from '@/utils/toolDisplay';

const props = defineProps<{
  toolCalls: ToolCall[];
  toolResponses?: any[];
  isStreaming?: boolean;
  sessionId?: string;
}>();

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

// ── 展开/闭合（默认闭合，点击展开）──

const expandedIndexes = ref<Set<number>>(new Set());

const isExpanded = (index: number): boolean => expandedIndexes.value.has(index);

const toggleExpand = (index: number): void => {
  const next = new Set(expandedIndexes.value);
  if (next.has(index)) {
    next.delete(index);
  } else {
    next.add(index);
  }
  expandedIndexes.value = next;
};

/** 结果直接取后端返回的 toolResponses[index]（无懒加载） */
const getToolResponses = (index: number): any => {
  return props.toolResponses && props.toolResponses[index];
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
/* 内联结果区：与思考块一致（缩进线由模板 border-l/ml/pl 提供） */
/* 展开后限制最大高度 + 内部滚动；overflow-x hidden 防止展开瞬间因内容超宽短暂出现横向滚动条 */
.tool-result-inline {
  max-height: 240px;
  overflow-y: auto;
  overflow-x: hidden;
}

.tool-result-inline pre {
  white-space: pre-wrap;
  word-break: break-word;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  margin: 0;
  line-height: 1.5;
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
