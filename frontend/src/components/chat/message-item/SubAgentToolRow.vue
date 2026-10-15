<template>
  <div class="subagent-block">
    <!-- 子智能体行：图标 + 「子智能体」+ 名称 + · + 任务摘要。
         名称与任务摘要是**两个各自独立**的可点链接（都打开同一个子代理面板）：视觉上它们
         颜色不同、本就是两段，hover 只提亮被指向的那一段；中间分隔符 · 不可点也不变色。
         整行不给背景色、不加整行提示——行内交互只留这两段文字（列表入口在输入框状态栏与侧栏）。 -->
    <div class="flex items-center text-sm min-w-0">
      <el-icon class="shrink-0 text-gray-500" :class="{ 'is-failed': failed }" size="16">
        <Bot20Regular />
      </el-icon>
      <span class="shrink-0 ml-1.5 text-gray-600 dark:text-gray-400">{{ t('chat.toolCalls.subAgentLabel') }}</span>
      <span v-if="displayName" class="sa-link shrink-0 ml-1.5 font-medium text-gray-600 dark:text-gray-400"
        :class="{ 'is-clickable': clickable }" @click.stop="onClick">{{ displayName }}</span>
      <span v-if="displayName && task" class="shrink-0 mx-1 text-gray-400 dark:text-gray-500">·</span>
      <span v-if="task" class="sa-link truncate min-w-0 text-gray-400 dark:text-gray-500"
        :class="{ 'is-clickable': clickable, 'is-shimmer': executing && !failed }"
        @click.stop="onClick">{{ task }}</span>
    </div>

    <!-- 失败原因：子代理是独立渲染行（standaloneRows），既不套通用失败横幅、也走不到
         「输入/输出」区（见 MessageToolCalls 的互斥分支），原因没有别的 DOM 承载。
         且校验类失败时 link 为空（子会话都没建起来）→ 文字不可点、面板无从打开，
         这里就是唯一能看到原因的入口。原因文本本身即说明，不再加标题行。 -->
    <pre v-if="failed && failureReason" class="sa-error-pre">{{ failureReason }}</pre>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { ElIcon } from 'element-plus';
import { useI18n } from 'vue-i18n';
import { Bot20Regular } from '@vicons/fluent';
import { parse as partialParse } from 'partial-json';
import { getToolArgs, type ToolCall } from '@/utils/toolDisplay';
import { resolveSubAgentFailure } from '@/utils/subAgentFailure';
import type { SubAgentLink } from '@/utils/subAgentLink';
import type { ToolCallResponseEntry } from '@/types/message';

const props = defineProps<{
  /** 工具调用（取 args.name / args.task；流式期间为半截 JSON） */
  tool: ToolCall;
  /** 会话关联（resolveSubAgentLink 结果）；有 name 时优先于 args.name */
  link?: SubAgentLink | null;
  /** 工具结果（失败原因的载体；无结果时为空） */
  response?: ToolCallResponseEntry;
  /** 工具执行中（流式 / 等待子代理跑完）：任务摘要走 shimmer */
  executing?: boolean;
  /** 失败（error / rejected）：图标转红 + 展示原因块 */
  failed?: boolean;
  /** 有面板入口且已解析出唯一目标会话才可点 */
  clickable?: boolean;
}>();

const emit = defineEmits<{ (e: 'open'): void }>();

const { t } = useI18n();

/** 参数对象（getToolArgs 可能返回原始 JSON 字符串，流式期间还是半截 JSON） */
const args = computed<Record<string, unknown>>(() => {
  const raw = getToolArgs(props.tool);
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = partialParse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return raw;
});

/** 名称：link.name（后端 meta/流事件，权威）优先，回落 args.name（流式早期即可用） */
const displayName = computed(() => {
  const fromLink = props.link?.name;
  if (fromLink) return fromLink;
  const name = args.value.name;
  return typeof name === 'string' ? name : '';
});

/** 任务摘要：取 task 首个非空行（多行任务只展示首行，CSS 截断超长） */
const task = computed(() => {
  const value = args.value.task;
  if (typeof value !== 'string') return '';
  return value.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
});

/** 失败原因（从工具结果正文剥出「人话」）；取不到则整块不渲染 */
const failureReason = computed(() =>
  props.failed ? resolveSubAgentFailure(props.response) : undefined,
);

/** 点击名称/任务摘要 → 打开该子代理会话面板（无唯一目标会话时不可点） */
const onClick = (): void => {
  if (props.clickable) emit('open');
};
</script>

<style scoped>
/* 名称 / 任务摘要各自是可点链接（都打开同一个子代理面板）：
   hover 只提亮被指向的那一段，不加背景色、不影响整行。
   两段颜色本就不同、视觉上各自独立，统一变色会让人以为它们是一个整体。 */
.sa-link.is-clickable {
  cursor: pointer;
}

.sa-link.is-clickable:hover {
  color: var(--el-text-color-regular);
}

/* 失败原因块：红色微底等宽正文，视觉对齐工作流卡的 .wf-card-error；
   缩进 22px = 图标 16px + 间距 6px，与工具卡详情区缩进规则一致。 */
.sa-error-pre {
  margin: 4px 0 0 22px;
  padding: 6px 8px;
  max-height: 120px;
  overflow-y: auto;
  border-radius: 5px;
  background: color-mix(in srgb, var(--gd-color-danger) 8%, transparent);
  color: var(--gd-color-danger);
  font-family: var(--font-mono, "SF Mono", Consolas, monospace);
  font-size: 12px;
  line-height: 18px;
  /* 原因可选中复制（用户常要拿去搜索/贴给模型）；长行折行 + 限高内滚，不撑爆对话流 */
  white-space: pre-wrap;
  word-break: break-word;
}

/* 失败态：图标转红（标签/名称/任务摘要保持中性灰——它们是子代理身份与上下文，
   不随状态变色；原因由下方 .sa-error-pre 承载） */
.is-failed {
  color: var(--gd-color-danger);
}

/* 运行中波纹（与 TurnItem/MessageThinkingSection 的 shimmer-text 同款视觉；
   scoped 下 keyframes 由编译器重命名，不与其它组件冲突） */
.is-shimmer {
  background: linear-gradient(90deg,
      var(--gd-shimmer-base, #a8aab3) 0%,
      var(--gd-shimmer-base, #a8aab3) 25%,
      var(--gd-shimmer-highlight, #ffffff) 50%,
      var(--gd-shimmer-base, #a8aab3) 75%,
      var(--gd-shimmer-base, #a8aab3) 100%);
  background-size: 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: subagent-shimmer-slide 1.5s linear infinite;
}

@keyframes subagent-shimmer-slide {
  0% {
    background-position: 100% 0;
  }

  100% {
    background-position: -100% 0;
  }
}
</style>
