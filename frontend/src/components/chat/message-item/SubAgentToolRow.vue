<template>
  <GdTooltip class="block" :content="clickable ? t('chat.toolCalls.openSubAgentPanel') : ''" placement="top">
    <div class="group flex items-center text-sm min-w-0 rounded-md -mx-1.5 px-1.5 py-0.5 transition-colors duration-200"
      :class="clickable ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-white/5' : ''" @click.stop="onClick">
      <!-- 子智能体行：图标 + 「子智能体」+ 名称（同标签色加粗）+ · + 任务摘要。
           标签与名称统一用过程组标题的深灰（非主题色），任务摘要用浅灰（同组标题的
           args 文案）；整行即卡片内容（无工具头部/折叠箭头），点击打开子代理面板。 -->
      <el-icon class="shrink-0 text-gray-500" :class="{ 'is-failed': failed }" size="16">
        <Bot20Regular />
      </el-icon>
      <span class="shrink-0 ml-1.5 text-gray-600 dark:text-gray-400">{{ t('chat.toolCalls.subAgentLabel') }}</span>
      <span v-if="displayName" class="shrink-0 ml-1.5 font-medium text-gray-600 dark:text-gray-400">{{ displayName }}</span>
      <template v-if="task">
        <span v-if="displayName" class="shrink-0 ml-1 text-gray-400 dark:text-gray-500">·</span>
        <span class="truncate min-w-0 ml-1 text-gray-400 dark:text-gray-500"
          :class="{ 'is-shimmer': executing && !failed, 'is-failed': failed }">{{ task }}</span>
      </template>
      <!-- 子代理列表「详情」入口（hover 显现）：打开本会话子代理列表面板
           （活跃 + 已结束回放），对标工作流卡片的详情按钮 -->
      <GdTooltip v-if="openSubagentList" :content="t('chat.workspace.subagentListTab')" placement="top" class="shrink-0 ml-2">
        <button class="open-list-btn" @click.stop="onOpenList">
          <el-icon :size="14">
            <PeopleTeam20Regular />
          </el-icon>
        </button>
      </GdTooltip>
    </div>
  </GdTooltip>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue';
import { ElIcon } from 'element-plus';
import { useI18n } from 'vue-i18n';
import { Bot20Regular, PeopleTeam20Regular } from '@vicons/fluent';
import { parse as partialParse } from 'partial-json';
import GdTooltip from '@/components/ui/GdTooltip.vue';
import { getToolArgs, type ToolCall } from '@/utils/toolDisplay';
import type { SubAgentLink } from '@/utils/subAgentLink';

const props = defineProps<{
  /** 工具调用（取 args.name / args.task；流式期间为半截 JSON） */
  tool: ToolCall;
  /** 会话关联（resolveSubAgentLink 结果）；有 name 时优先于 args.name */
  link?: SubAgentLink | null;
  /** 工具执行中（流式 / 等待子代理跑完）：任务摘要走 shimmer */
  executing?: boolean;
  /** 失败（error / rejected）：图标与任务摘要转红 */
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

const onClick = (): void => {
  if (props.clickable) emit('open');
};

/** 子代理列表面板入口（ChatPage provide；无 provide 的宿主不渲染按钮） */
const openSubagentList = inject<((sessionId?: string) => void) | null>(
  'workspace:openSubagentList',
  null,
);

const onOpenList = (): void => {
  openSubagentList?.();
};
</script>

<style scoped>
/* 「详情」入口：hover 显现（与行内其它交互同节奏，不占常态视觉） */
.open-list-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--gd-color-text-gray);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease, color 0.15s ease;
}
/* 「详情」入口：hover 显现（行根节点带 tailwind 的 group 标记类） */
.group:hover .open-list-btn {
  opacity: 1;
}
.open-list-btn:hover {
  color: var(--gd-color-text);
}

/* 失败态：图标/摘要转红（标签与名称保持中性灰——它们是子代理身份，不随状态变色） */
.is-failed {
  color: #f56c6c;
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
