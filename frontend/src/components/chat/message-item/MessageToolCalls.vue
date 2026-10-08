<template>
  <div class="process-section tool-calls-section space-y-2">
    <div class="" v-for="(tool, toolIndex) in toolCalls" :key="toolIndex">
      <!-- 循环展示每个工具调用 -->
      <!-- 通用工具头部：状态图标 + 状态文案 + 参数摘要 + 折叠开关。
           独立渲染行（计划卡等）不渲染——整行只有卡片，状态由卡片头部徽标表达。 -->
      <div v-if="!standaloneRows[toolIndex]"
        class="group flex items-center text-sm text-gray-700 dark:text-[#8b8d95] cursor-pointer font-medium transition-colors duration-200 min-w-0"
        @click.stop="toggleExpand(toolIndex)">
        <el-icon v-if="tool.outcome === 'error' || tool.outcome === 'rejected'" class="shrink-0" size="16"
          style="color: #f56c6c;">
          <component :is="getToolIcon(tool)" />
        </el-icon>
        <el-icon v-else-if="tool.outcome === 'aborted'" class="shrink-0" size="16" style="color: #c0c4cc;">
          <component :is="getToolIcon(tool)" />
        </el-icon>
        <el-icon v-else class="shrink-0" size="16" :class="{ 'shimmer-icon': isToolExecuting(tool, toolIndex) }">
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
        <!-- 子代理工具：打开对应子代理会话的面板（点击不触发行展开；
             无 provide 的宿主如 BotSessionDialog 下不渲染） -->
        <GdTooltip v-if="subAgentLinks[toolIndex]"
          :content="t('chat.toolCalls.openSubAgentPanel')" placement="top"
          class="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <span class="open-subagent-btn" @click.stop="openSubAgentPanel(toolIndex)">
            <el-icon size="14">
              <PanelRightExpand20Filled />
            </el-icon>
          </span>
        </GdTooltip>
        <!-- 展开箭头：闭合朝右、展开朝下；hover 时显示，展开后持续显示 -->
        <el-icon class="shrink-0 ml-2 text-gray-400 transition-opacity duration-200"
          :class="isExpanded(toolIndex) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'" size="12">
          <ChevronDown12Regular :class="{ '-rotate-90': !isExpanded(toolIndex) }"
            class="transition-transform duration-200" />
        </el-icon>
      </div>

      <!-- 内联结果区（默认闭合，点击展开后显示；统一卡片容器区分展开内容）。
           独立渲染工具行（计划卡等）不套这层外框——卡片自带边框，避免双边框；
           同时整行只有卡片（见 .is-plain 清掉的 22px 左缩进）。 -->
      <div v-if="isExpanded(toolIndex)" class="tool-result-inline"
        :class="{ 'is-plain': standaloneRows[toolIndex] }">
        <!-- 仅失败时显示状态提示（成功/无响应不显示状态文案，直接展示结果或留空）；
             独立渲染行不显示——其失败/拒绝状态由卡片头部徽标承担 -->
        <div v-if="!standaloneRows[toolIndex] && (tool.outcome === 'error' || tool.outcome === 'rejected')"
          class="flex items-center text-xs text-gray-500 dark:text-gray-400 mb-1.5">
          <el-icon size="14" style="color:#f56c6c">
            <ErrorCircle16Regular />
          </el-icon>
          <span class="ml-1.5">{{ t('chat.toolCalls.resultFailed') }}</span>
        </div>

        <!-- 定制渲染：按 renderer 声明（后端 display.renderer / 内置映射）优先展示参数 -->
        <ToolCustomView v-if="rendererInfos[toolIndex]" :info="rendererInfos[toolIndex]!"
          :response="getToolResponses(toolIndex)" :is-error="tool.outcome === 'error'"
          :executing="isToolExecuting(tool, toolIndex)" :session-id="props.sessionId"
          :pending-approval="isPendingApproval(tool)" :status="planCardStatus(toolIndex)" />

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
import { computed, ref, watch, inject } from 'vue';
import { ElIcon } from 'element-plus';
import { useI18n } from 'vue-i18n';
import { ErrorCircle16Regular, ChevronDown12Regular, PanelRightExpand20Filled } from '@vicons/fluent';
import { parse as partialParse } from 'partial-json';
import {
  type ToolCall,
  type ToolRendererInfo,
  type PlanCardStatus,
  getToolConfig, getToolIcon,
  getToolArgs, getArgsText,
  getToolRenderer, getRendererArgs,
  isStandaloneRendererKind, isStandaloneTool,
  resolvePlanCardStatus,
} from '@/utils/toolDisplay';
import { countDiffLines } from '@/utils/diff';
import { extractResultContent } from '@/utils/toolResult';
import { resolveSubAgentLink, findToolResponse } from '@/utils/subAgentLink';
import type { ToolCallResponseEntry } from '@/types/message';
import GdTooltip from '@/components/ui/GdTooltip.vue';
import ToolCustomView from './tool-renderers/ToolCustomView.vue';
import { useSessionStore } from '@/stores/session';

const props = defineProps<{
  toolCalls: ToolCall[];
  toolResponses?: ToolCallResponseEntry[];
  isStreaming?: boolean;
  sessionId?: string;
  /** 所在分组可见且仅含本步骤时由父级置真：展开分组即展开全部调用（单步骤分组免二次点击） */
  autoExpand?: boolean;
}>();

const { t } = useI18n();
const sessionStore = useSessionStore();

// ── 待审批锚点：会话级交互卡的 toolCallId 命中本行 → 该工具正在等用户批准
//    （参数已定稿、结果未回；plan 视图据此在 executing 期间也放行「查看完整计划」）──

const pendingApprovalToolCallId = computed(
  () => sessionStore.sessionPendingAsk(props.sessionId || '')?.toolCallId,
);
const isPendingApproval = (tool: ToolCall): boolean =>
  !!pendingApprovalToolCallId.value && tool.id === pendingApprovalToolCallId.value;

// ── 子代理跳转（工具行 → 侧边栏工作区打开 subagent 标签）──

/** ChatPage provide；无 provide 的宿主（BotSessionDialog 等）下为 null → 不渲染入口 */
const openSubAgentSession = inject<((subSessionId: string) => void) | null>(
  'workspace:openSubAgentSession',
  null,
);

/** 每行可跳转的子代理会话（null = 该行无唯一目标，不显示按钮） */
const subAgentLinks = computed(() =>
  openSubAgentSession
    ? props.toolCalls.map((tool, index) =>
        resolveSubAgentLink(tool, findToolResponse(tool, index, props.toolResponses)),
      )
    : [],
);

const openSubAgentPanel = (index: number): void => {
  const link = subAgentLinks.value[index];
  if (link) openSubAgentSession?.(link.subSessionId);
};

// ── 执行状态 ──

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
// 例外：独立渲染工具（计划行等，isStandaloneRendererKind）默认展开——正文就是内容本身，
// 模型还在写计划时就要"边写边看"，不该先点一下才可见；用户显式折叠后尊重其选择。

const expandedIndexes = ref<Set<number>>(new Set());
const collapsedIndexes = ref<Set<number>>(new Set());

watch(() => props.autoExpand, (auto) => {
  expandedIndexes.value = auto
    ? new Set(props.toolCalls.map((_, i) => i))
    : new Set();
  collapsedIndexes.value = new Set();
}, { immediate: true });

/** 默认展开的行（独立渲染工具卡：正文即内容，与分组判定共用同一 kind 集合） */
const isDefaultExpandedRow = (index: number): boolean => {
  const kind = rendererInfos.value[index]?.kind;
  return kind !== undefined && isStandaloneRendererKind(kind);
};

const isExpanded = (index: number): boolean => {
  if (expandedIndexes.value.has(index)) return true;
  return isDefaultExpandedRow(index) && !collapsedIndexes.value.has(index);
};

/**
 * 独立渲染行（计划卡等）：整行只有卡片——不渲染通用工具头部（状态文案/参数摘要/折叠箭头），
 * 也不吃结果容器的 22px 左缩进。判定与分组共用 isStandaloneTool（一处集合、两处生效）。
 */
const standaloneRows = computed<boolean[]>(() =>
  props.toolCalls.map((tool) => isStandaloneTool(tool)),
);

const toggleExpand = (index: number): void => {
  const nowExpanded = isExpanded(index);
  const nextExpanded = new Set(expandedIndexes.value);
  const nextCollapsed = new Set(collapsedIndexes.value);
  if (nowExpanded) {
    nextExpanded.delete(index);
    nextCollapsed.add(index);
  } else {
    nextExpanded.add(index);
    nextCollapsed.delete(index);
  }
  expandedIndexes.value = nextExpanded;
  collapsedIndexes.value = nextCollapsed;
};

/** 结果直接取后端返回的 toolResponses[index]（无懒加载） */
const getToolResponses = (index: number): ToolCallResponseEntry | undefined => {
  return props.toolResponses && props.toolResponses[index];
};

// ── 定制渲染（renderer 声明：后端 display.renderer 优先，内置映射兜底） ──

const rendererInfos = computed<(ToolRendererInfo | null)[]>(() =>
  props.toolCalls.map((tool) => {
    const renderer = getToolRenderer(tool);
    if (!renderer) return null;
    const args = getRendererArgs(tool, renderer);
    if (!args) {
      // 独立渲染行（计划卡）：参数未到也要把整行交给卡片——卡片自带「生成中」占位。
      // 若在这里 return null，头部已移除、正文又未就绪，会留下一整行空白。
      return isStandaloneRendererKind(renderer.kind)
        ? { kind: renderer.kind, args: {} }
        : null;
    }
    // diff 两侧均为空无内容可展示，回退通用渲染
    if (renderer.kind === 'diff' && !args.oldValue && !args.newValue) return null;
    const info: ToolRendererInfo = { kind: renderer.kind, args };
    if (renderer.kind === 'diff') {
      info.stat = countDiffLines(args.oldValue ?? '', args.newValue ?? '');
    }
    return info;
  }),
);

/** 计划卡终态徽标（批准/拒绝/中断/失败）；undefined = 执行中，卡片显示流式提示 */
const planCardStatus = (index: number): PlanCardStatus | undefined => {
  const tool = props.toolCalls[index];
  if (!tool) return undefined;
  const meta = getToolResponses(index)?.meta;
  const approved = typeof meta?.planApproved === 'boolean' ? meta.planApproved : undefined;
  return resolvePlanCardStatus(tool.outcome, approved);
};

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

const formatToolResponse = (response?: ToolCallResponseEntry): string => {
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
/* 打开子代理面板：与展开箭头同节奏显隐（整行 hover 时出现，故预留位置不引起跳动） */
.open-subagent-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-left: 8px;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  transition: color 0.15s ease;
}

.open-subagent-btn:hover {
  color: var(--el-color-primary);
}

/* 内联结果区：统一卡片容器（边框 + 圆角 + 微透明表面底色）区分展开内容与正文；
   margin-left 22px = 工具图标 16px + 标题间距 6px，让详情块缩进与标题文字对齐、错开图标。
   横向内边距抽成 --tool-card-pad-x：内部各视图的滚动区用等量负边距抵消，
   让滚动条贴住卡片右边框，而不是被内边距顶开、悬空在中间。 */
.tool-result-inline {
  --tool-card-pad-x: 12px;
  margin-top: 4px;
  margin-left: 22px;
  padding: 4px var(--tool-card-pad-x);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  /* 微微透明：透出下方正文一点底色，视觉更轻 */
  background: color-mix(in srgb, var(--gd-color-surface) 80%, transparent);
}

/* 独立渲染工具行（计划卡等）：不套第二层外框与底色——卡片自带边框（ZCode 同款
   "不再套一层通用工具卡"）。--tool-card-pad-x 归零，避免内部视图的负边距把内容
   顶出卡片（该变量本是用来抵消本层横向内边距的）。
   margin 也归零：没有工具头部后，22px 左缩进（= 图标 16px + 间距 6px）失去对齐对象，
   卡片左缘与助手正文左缘对齐；4px 顶距同理（它本是头部与结果之间的间隔）。 */
.tool-result-inline.is-plain {
  --tool-card-pad-x: 0px;
  margin-top: 0;
  margin-left: 0;
  padding: 0;
  border: none;
  border-radius: 0;
  background: none;
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
