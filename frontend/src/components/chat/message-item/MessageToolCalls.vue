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
          <!-- diff 类工具的增删行数徽章 -->
          <span v-if="rendererStat(toolIndex)" class="ml-2 shrink-0 font-mono text-xs flex items-center gap-1.5">
            <span v-if="rendererStat(toolIndex)!.added" style="color: var(--el-color-success)">+{{ rendererStat(toolIndex)!.added }}</span>
            <span v-if="rendererStat(toolIndex)!.removed" style="color: var(--el-color-danger)">−{{ rendererStat(toolIndex)!.removed }}</span>
          </span>
        </div>
        <!-- 展开箭头：闭合朝右、展开朝下；hover 时显示，展开后持续显示 -->
        <el-icon class="shrink-0 ml-2 text-gray-400 transition-opacity duration-200"
          :class="isExpanded(toolIndex) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'" size="12">
          <ChevronDown12Regular :class="{ '-rotate-90': !isExpanded(toolIndex) }"
            class="transition-transform duration-200" />
        </el-icon>
      </div>

      <!-- 内联结果区（默认闭合，点击展开后显示；统一卡片容器区分展开内容） -->
      <div v-if="isExpanded(toolIndex)" class="tool-result-inline">
        <!-- 仅失败时显示状态提示（成功/无响应不显示状态文案，直接展示结果或留空） -->
        <div v-if="tool.outcome === 'error' || tool.outcome === 'rejected'"
          class="flex items-center text-xs text-gray-500 dark:text-gray-400 mb-1.5">
          <el-icon size="13" style="color:#f56c6c">
            <ErrorCircle16Regular />
          </el-icon>
          <span class="ml-1.5">{{ t('chat.toolCalls.resultFailed') }}</span>
        </div>

        <!-- 定制渲染：按 renderer 声明（后端 display.renderer / 内置映射）优先展示参数 -->
        <ToolCustomView v-if="rendererInfos[toolIndex]" :info="rendererInfos[toolIndex]!"
          :response="getToolResponses(toolIndex)" :is-error="tool.outcome === 'error'"
          :executing="isToolExecuting(tool, toolIndex)" />

        <!-- 通用展示（无 renderer 声明）：输入 / 输出 两段式 -->
        <div v-else class="io-layout">
          <div class="io-section">
            <span class="io-label">{{ t('chat.toolCalls.inputLabel') }}</span>
            <pre class="io-content">{{ formatToolArgs(tool) }}</pre>
          </div>
          <template v-if="getToolResponses(toolIndex)">
            <div class="io-divider" role="separator"></div>
            <div class="io-section">
              <span class="io-label">{{ t('chat.toolCalls.outputLabel') }}</span>
              <pre class="io-content">{{ formatToolResponse(getToolResponses(toolIndex)) }}</pre>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElIcon } from 'element-plus';
import { useI18n } from 'vue-i18n';
import { ErrorCircle16Regular, ChevronDown12Regular } from '@vicons/fluent';
import { parse as partialParse } from 'partial-json';
import {
  type ToolCall,
  type ToolRendererInfo,
  getToolConfig, getToolIcon,
  getToolArgs, getArgsText,
  getToolRenderer, getRendererArgs,
} from '@/utils/toolDisplay';
import { countDiffLines } from '@/utils/diff';
import { extractResultContent } from '@/utils/toolResult';
import ToolCustomView from './tool-renderers/ToolCustomView.vue';

const props = defineProps<{
  toolCalls: ToolCall[];
  toolResponses?: any[];
  isStreaming?: boolean;
  sessionId?: string;
  /** 所在分组可见且仅含本步骤时由父级置真：展开分组即展开全部调用（单步骤分组免二次点击） */
  autoExpand?: boolean;
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

// ── 展开/闭合（默认闭合，点击展开；单步骤分组由 autoExpand 跟随分组展开）──

const expandedIndexes = ref<Set<number>>(new Set());

watch(() => props.autoExpand, (auto) => {
  expandedIndexes.value = auto
    ? new Set(props.toolCalls.map((_, i) => i))
    : new Set();
}, { immediate: true });

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

// ── 定制渲染（renderer 声明：后端 display.renderer 优先，内置映射兜底） ──

const rendererInfos = computed<(ToolRendererInfo | null)[]>(() =>
  props.toolCalls.map((tool) => {
    const renderer = getToolRenderer(tool);
    if (!renderer) return null;
    const args = getRendererArgs(tool, renderer);
    if (!args) return null;
    // diff 两侧均为空无内容可展示，回退通用渲染
    if (renderer.kind === 'diff' && !args.oldValue && !args.newValue) return null;
    const info: ToolRendererInfo = { kind: renderer.kind, args };
    if (renderer.kind === 'diff') {
      info.stat = countDiffLines(args.oldValue ?? '', args.newValue ?? '');
    }
    return info;
  }),
);

const rendererStat = (index: number): ToolRendererInfo['stat'] | undefined => {
  return rendererInfos.value[index]?.stat;
};

// ── 参数 / 结果格式化 ──

/** 输入段：参数 pretty-print（流式部分 JSON 经 partial-json 容错解析） */
const formatToolArgs = (tool: ToolCall): string => {
  const args = getToolArgs(tool);
  if (args === undefined || args === null) return '';
  if (typeof args === 'string') {
    try {
      return JSON.stringify(partialParse(args), null, 2);
    } catch {
      return args;
    }
  }
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
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
</script>

<style scoped>
/* 内联结果区：统一卡片容器（边框 + 圆角 + 微透明表面底色）区分展开内容与正文；
   margin-left 21px = 工具图标 15px + 标题间距 6px，让详情块缩进与标题文字对齐、错开图标。
   横向内边距抽成 --tool-card-pad-x：内部各视图的滚动区用等量负边距抵消，
   让滚动条贴住卡片右边框，而不是被内边距顶开、悬空在中间。 */
.tool-result-inline {
  --tool-card-pad-x: 12px;
  margin-top: 4px;
  margin-left: 21px;
  padding: 4px var(--tool-card-pad-x);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  /* 微微透明：透出下方正文一点底色，视觉更轻 */
  background: color-mix(in srgb, var(--gd-color-surface) 80%, transparent);
}

/* 通用展示：输入 / 输出 两段式 */
.io-layout {
  max-height: 240px;
  overflow-y: auto;
  overflow-x: hidden;
  /* 满铺到卡片内缘：滚动条贴右边框（正文留白改由 .io-content 承担） */
  margin-right: calc(-1 * var(--tool-card-pad-x));
}

.io-section {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 5px 0;
}

.io-label {
  flex-shrink: 0;
  width: 3em;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  user-select: none;
}

.io-divider {
  border-top: 1px solid var(--el-border-color-lighter);
  /* 与 .io-content 的右侧留白对齐，分割线不顶到卡片边框 */
  margin-right: var(--tool-card-pad-x);
}

.io-content {
  flex: 1;
  min-width: 0;
  margin: 0;
  /* 滚动区已满铺，右侧留白收在正文上（保证换行位置与改动前一致） */
  padding-right: var(--tool-card-pad-x);
  font-size: 12px;
  color: var(--el-text-color-regular);
}

.tool-result-inline pre {
  white-space: pre-wrap;
  word-break: break-word;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  margin: 0;
  line-height: 1.5;
}
</style>
