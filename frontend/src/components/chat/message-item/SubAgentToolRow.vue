<template>
  <!-- 子代理行：身份色头像 + 同色代理名 + 弱化任务描述。
       对齐参考项目的三段式层级——不再用「灰色图标 + 灰标签 + 灰名称 + 灰摘要」把整行压平，
       也不加卡片外框：辨识度来自头像与身份色，行本身保持轻量、可融入消息流。
       名称与任务摘要仍是**两个各自独立**的可点链接（都打开同一个子代理面板），
       hover 只作用于被指向的那一段，身份色不被通用 hover 前景色冲掉。 -->
  <div class="subagent-block">
    <div class="sa-row" role="group" :aria-label="rowLabel">
      <SubAgentFace :done="done" :failed="isFailed" :running="running" />

      <span v-if="identityName" class="sa-link sa-identity" :class="{ 'is-clickable': clickable }"
        v-tooltip="identityName" @click.stop="onClick">{{ identityName }}</span>
      <span v-if="task" class="sa-link sa-task"
        :class="{ 'is-clickable': clickable, 'is-shimmer': running }"
        v-tooltip="taskFull" @click.stop="onClick">{{ task }}</span>
    </div>

    <!-- 失败原因：子代理是独立渲染行（standaloneRows），既不套通用失败横幅、也走不到
         「输入/输出」区（见 MessageToolCalls 的互斥分支），原因没有别的 DOM 承载。
         且校验类失败时 link 为空（子会话都没建起来）→ 文字不可点、面板无从打开，
         这里就是唯一能看到原因的入口。原因文本本身即说明，不再加标题行。 -->
    <pre v-if="isFailed && failureReason" class="sa-error-pre">{{ failureReason }}</pre>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import { useI18n } from 'vue-i18n';
import { parse as partialParse } from 'partial-json';
import { getToolArgs, type ToolCall } from '@/utils/toolDisplay';
import { resolveSubAgentFailure } from '@/utils/subAgentFailure';
import type { SubAgentLink } from '@/utils/subAgentLink';
import type { ToolCallResponseEntry } from '@/types/message';
import SubAgentFace from './SubAgentFace.vue';

const props = defineProps<{
  /** 工具调用（取 args.name / args.task；流式期间为半截 JSON） */
  tool: ToolCall;
  /** 会话关联（resolveSubAgentLink 结果）；有 name 时优先于 args.name */
  link?: SubAgentLink | null;
  /** 工具结果（失败原因的载体；无结果时为空） */
  response?: ToolCallResponseEntry;
  /** 工具执行中（流式 / 等待子代理跑完）：任务摘要走 shimmer */
  executing?: boolean;
  /** 失败（error / rejected）：头像转红 + 展示原因块 */
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

/** 名称：link.name（后端 meta/流事件，权威）优先，回落 args.name（流式早期即可用）。
    两者都还没有时（流刚开始）用「子智能体」占位，避免只画一张脸的空行。 */
const displayName = computed(() => {
  const fromLink = props.link?.name;
  if (fromLink) return fromLink;
  const name = args.value.name;
  return typeof name === 'string' ? name : '';
});

const identityName = computed(() => displayName.value || t('chat.toolCalls.subAgentLabel'));

/** 任务摘要：取 task 首个非空行（多行任务只展示首行，CSS 截断超长） */
const task = computed(() => {
  const value = args.value.task;
  if (typeof value !== 'string') return '';
  return value.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
});

/** 完整任务文本：供 v-tooltip 展示被截断的全文 */
const taskFull = computed(() => {
  const value = args.value.task;
  return typeof value === 'string' ? value.trim() : '';
});

/** 后端 settle() 即时下发的终态；早于整批 tool_calls_response 到达 */
const streamedStatus = computed(() => props.tool.subAgentStatus);

/** 失败：工具结果失败，或结算事件先到 */
const isFailed = computed(
  () => props.failed || streamedStatus.value === 'error',
);

/** 完成徽标：结算事件优先；否则沿用「有结果且不是后台 job」的旧判定。 */
const done = computed(() => {
  if (isFailed.value) return false;
  if (streamedStatus.value === 'completed') return true;
  if (props.executing || props.tool.outcome === 'aborted') return false;
  if (props.response?.meta?.jobId) return false;
  return props.tool.outcome === 'success' || !!props.response;
});

/** 运行中：等整批结果期间，先完成的子代理立即停止动画 */
const running = computed(
  () => !!props.executing && !isFailed.value && streamedStatus.value !== 'completed',
);

const rowLabel = computed(() =>
  [t('chat.toolCalls.subAgentLabel'), displayName.value, task.value].filter(Boolean).join(' · '),
);

/** 失败原因：优先解析工具结果正文；结果还没到时用结算事件里的错误摘要兜底 */
const failureReason = computed(() => {
  if (!isFailed.value) return undefined;
  return resolveSubAgentFailure(props.response) ?? props.tool.subAgentError;
});

/** 点击名称/任务摘要 → 打开该子代理会话面板（无唯一目标会话时不可点） */
const onClick = (): void => {
  if (props.clickable) emit('open');
};
</script>

<style scoped>
/* 身份色：跟随主题主色（粉色）。头像用原色；名称在亮色下用主题自带的深粉档
   （primary-950，彩度比混黑更高，不会发灰发黑），暗色直接用原色。
   任务描述从正文色派生，比名称更低一档，形成「脸/名 → 描述」两级层级。 */
.subagent-block {
  --sa-identity-face: var(--gd-color-primary);
  --sa-identity: var(--gd-color-primary-950);
  --sa-task: color-mix(in srgb, var(--gd-color-text) 55%, transparent);
  min-width: 0;
}

html.dark .subagent-block {
  --sa-identity: var(--gd-color-primary);
  --sa-task: color-mix(in srgb, var(--gd-color-text) 42%, transparent);
}

/* 行布局与分组标题对齐：标题是「16px 图标 + 6px 间距」→ 文字落在 22px。
   头像不再靠 2px 左边距避让徽标，直接从行左缘起排，与其它图标同列。 */
.sa-row {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  min-width: 0;
  font-size: 14px;
  line-height: 1.5;
  text-align: left;
}

/* 名称是身份段：固定不收缩、超长省略，避免长任务名把描述挤出可视区 */
.sa-identity {
  flex-shrink: 0;
  max-width: 180px;
  overflow: hidden;
  color: var(--sa-identity);
  font-weight: 400;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sa-task {
  /* 名称与描述之间比图标间距多 2px，回到 8px */
  margin-left: 2px;
  min-width: 0;
  overflow: hidden;
  color: var(--sa-task);
  font-weight: 400;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 名称 / 任务摘要各自是可点链接（都打开同一个子代理面板）：
   hover 只作用于被指向的那一段，不加背景色、不影响整行。
   身份段只提亮并加细下划线，保留原色相，避免被通用前景色冲成灰字。 */
.sa-link.is-clickable {
  cursor: pointer;
}

.sa-identity.is-clickable:hover {
  filter: brightness(1.15);
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, currentColor 45%, transparent);
  text-underline-offset: 3px;
}

.sa-task.is-clickable:hover {
  color: var(--gd-color-text);
}

/* 失败原因块：红色微底等宽正文，视觉对齐工作流卡的 .wf-card-error；
   缩进 24px = 头像 16px + 行间距 8px，与工具卡详情区缩进规则一致。 */
.sa-error-pre {
  margin: 4px 0 0 24px;
  padding: 6px 8px;
  max-height: 120px;
  overflow-y: auto;
  border-radius: 5px;
  background: color-mix(in srgb, var(--gd-color-danger) 8%, transparent);
  color: var(--gd-color-danger);
  font-family: var(--gd-font-mono, "SF Mono", Consolas, monospace);
  font-size: 12px;
  line-height: 18px;
  /* 原因可选中复制（用户常要拿去搜索/贴给模型）；长行折行 + 限高内滚，不撑爆对话流 */
  white-space: pre-wrap;
  word-break: break-word;
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

@media (prefers-reduced-motion: reduce) {
  .is-shimmer {
    animation: none;
  }
}
</style>
