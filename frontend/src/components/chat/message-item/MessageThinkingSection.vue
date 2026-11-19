<template>
  <div class="process-section thinking-section">
    <!-- 标题行：与工具调用行同构的单行步骤（图标 + 动作文案 + 摘要 + 箭头） -->
    <div
      class="thinking-row group thinking-section__header flex items-center text-sm text-(--gd-color-text-subtle) cursor-pointer min-w-0"
      :class="{ 'gd-run-shimmer': isThinking }"
      @click.stop="handleToggle">
      <ThinkingIcon :active="isThinking" class="thinking-icon w-4 h-4 shrink-0" />
      <div class="ml-2 min-w-0 flex-1 flex items-center overflow-hidden">
        <span class="shrink-0">{{ isThinking ? t('chat.turn.thinkingActive') : t('chat.turn.thinkingDone') }}</span>
        <!-- 摘要：思考内容最后一行，仅思考中实时跟随；结束后只剩「已思考 + 时长」 -->
        <span v-if="isThinking && previewText" class="text-sm ml-2 truncate">{{ previewText }}</span>
        <span v-if="thinkingDuration" class="shrink-0 text-xs text-(--gd-color-text-subtlest) ml-2">
          {{ formattedDuration }}
        </span>
      </div>
      <!-- 展开箭头：闭合朝右、展开朝下；hover 时显示，展开后持续显示 -->
      <ChevronDown12Regular class="w-4 h-4 shrink-0 ml-2 text-(--gd-color-text-subtlest) transition-all duration-200"
        :class="isExpanded ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 -rotate-90'" />
    </div>

    <!-- 内容区：仅展开时渲染；折叠态为纯单行步骤，与工具行完全一致 -->
    <div v-if="isExpanded" class="thinking-section__content-wrapper text-sm">
      <div class="thinking-content">
      <MarkdownContent @click="handleContentClick" class="flex-1 markdown-text text-(--gd-color-text-subtlest)"
        :content="reasoningContent" :streaming="isThinking" />
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ChevronDown12Regular } from '@vicons/fluent';
import ThinkingIcon from '@/components/icons/ThinkingIcon.vue';
import MarkdownContent from '../../ui/MarkdownContent.vue';
import { formatDuration, getThinkingPreview } from '../../../utils/messageUtils';
import { useElapsedTicker } from '../../../composables/useElapsedTicker';
import { getDisclosure, setDisclosure } from '@/utils/disclosureState';

const { t } = useI18n();

const props = defineProps<{
  reasoningContent: string;
  isThinking: boolean;
  thinkingDurationMs: number | null | undefined;
  /** 思考跳动锚点（epoch ms，流式期间展示层秒表用） */
  thinkingStartedAt?: number | null;
  /**
   * 展开状态的持久键（由 TurnItem 传入 `<turnId>\0<itemId>`）。
   * 有值时写入模块级 disclosureState，回合被有界窗口回收、重新挂载后仍保持展开；
   * 无值时退回组件本地状态（其他宿主行为不变）。
   */
  persistKey?: string;
}>();

const emit = defineEmits<{
  click: [];
}>();

const localExpanded = ref(false);

/**
 * 展开态：有持久键时以模块级状态表为准（跨回合回收保持），否则用组件本地 ref。
 * 状态表只存「用户点过」的值，undefined 表示回到默认收起。
 */
const isExpanded = computed<boolean>(() => {
  if (!props.persistKey) return localExpanded.value;
  return getDisclosure(props.persistKey) ?? false;
});

const handleToggle = () => {
  if (props.persistKey) {
    setDisclosure(props.persistKey, !isExpanded.value);
    return;
  }
  localExpanded.value = !localExpanded.value;
};

/**
 * 思考区内容点击。
 *
 * 原先这里是 `@click.stop`，会把整个事件停在这一层——而 markdown 链接的点击
 * 由 document 级委托（useMarkdown.installLinkClickHandler）接管，被 stop 后
 * 思考区里的链接点了完全没反应。因此：命中链接时不停播、也不把点击当作
 * "展开/收起" 冒泡出去；其余点击保持原有语义（停播 + 通知父层）。
 */
const handleContentClick = (event: MouseEvent) => {
  const target = event.target as HTMLElement | null;
  if (target && typeof target.closest === "function" && target.closest("a[data-url]")) {
    return;
  }
  event.stopPropagation();
  emit("click");
};

/** 摘要：思考内容最后一行（按行拆分取最后一行，从行首显示、结尾截断） */
const previewText = computed(() => getThinkingPreview(props.reasoningContent));

// 展示层秒表：进行中从锚点跳动，结束后显示服务端 timing 派生的权威时长
const { elapsedMs: thinkingDuration } = useElapsedTicker(
  () => props.thinkingStartedAt,
  () => props.isThinking,
  () => props.thinkingDurationMs,
);

const formattedDuration = computed(() => {
  return formatDuration(thinkingDuration.value);
});
</script>

<style scoped>
.thinking-section {
  border-radius: 8px;
  animation: fadeIn 0.3s ease;
}

.thinking-section__header {
  user-select: none;
}

/* 与工具展开卡片（tool-result-inline）完全一致的容器样式（微透明表面底色）；
   margin-left 22px = 图标 16px + 标题间距 6px，让详情块缩进与标题文字对齐、错开图标 */
.thinking-section__content-wrapper {
  margin-top: 4px;
  margin-left: 22px;
  padding: 8px 12px;
  border: 1px solid var(--gd-color-border);
  border-radius: 4px;
  background: color-mix(in srgb, var(--gd-color-surface) 80%, transparent);
  /* 长思考不再撑满整屏：限高后框内自滚动。
     column-reverse 让滚动原点落在底部 = 纯 CSS 自动贴底（流式增高时新内容始终可见，
     用户上滚阅读不被拽回）；内容只占顶部时盒子按内容收缩，无副作用 */
  max-height: 300px;
  overflow-y: auto;
  display: flex;
  flex-direction: column-reverse;
}

/* 只过渡文字色：避免扫光类移除时整行背景从实色淡出造成闪底。 */
.thinking-row {
  transition: color 0.2s ease;
}

/* 行悬停高亮：整行文字提亮（-webkit-text-fill-color 继承到子文本）。
   波纹文案自身声明 transparent 填充，优先于继承值，水波纹不受影响。 */
.thinking-row:not(.gd-run-shimmer):hover {
  -webkit-text-fill-color: var(--gd-color-text);
}

.thinking-row:hover .thinking-icon {
  color: var(--gd-color-text);
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
