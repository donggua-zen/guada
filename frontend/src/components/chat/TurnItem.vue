<template>
  <div class="turn-wrapper last:min-h-[60vh]" :class="{ 'turn-wrapper--last': isLast, 'animate-in': animateIn }"
    :data-message-id="user?.messageId">
    <!-- ============================================ -->
    <!-- User 部分 -->
    <!-- ============================================ -->
    <div v-if="user" class="user-section">
      <div class="message-item__wrapper">
        <div class="message-item__card">
          <!-- 用户文本 -->
          <div class="message-item__text break-all whitespace-pre-wrap">
            <template v-if="isSystemMessage">
              <div class="system-message-header">
                <el-icon size="14" class="system-message-icon">
                  <Alert16Regular />
                </el-icon>
                <span class="system-message-label">{{ systemMessageLabel }}</span>
              </div>
              <div class="system-message-divider" />
              <div class="system-message-body">
                <span v-html="userContent"></span>
              </div>
            </template>
            <!-- P5b：通知类（process_monitor/sub_agent）不显示文本气泡，仅折叠按钮 -->
            <span v-else-if="!isNotificationUser" v-html="renderSkillBadges(userContent)"></span>
          </div>
          <!-- P5b：通知类折叠区（极简显示，可展开看全文；内容为剥离 <system_reminder> 标签后的全文） -->
          <div v-if="isNotificationUser && notificationText" class="user-reminder">
            <div class="user-reminder__row">
              <button type="button" class="user-reminder__toggle" @click="reminderExpanded = !reminderExpanded">
                <el-icon size="12">
                  <ChevronDown12Regular v-if="!reminderExpanded" class="user-reminder__arrow" />
                  <ChevronDown12Regular v-else class="user-reminder__arrow is-expanded" />
                </el-icon>
                <span class="user-reminder__label">
                  {{ reminderExpanded ? t('chat.turn.collapseOutput') : notificationLabel }}
                </span>
              </button>
              <!-- 子代理结果通知：直接点进派生子代理的会话（source.subSessionId 由后端结构化携带，
                   实时与回放两条路径都透传，刷新后仍在） -->
              <GdTooltip v-if="notificationSubSessionId && openSubAgentSession"
                :content="t('chat.toolCalls.openSubAgentPanel')" placement="top">
                <span class="open-subagent-btn" @click="openNotificationSubAgent">
                  <el-icon size="14">
                    <PanelRightExpand20Filled />
                  </el-icon>
                </span>
              </GdTooltip>
            </div>
            <div v-if="reminderExpanded" class="user-reminder__body">{{ notificationText }}</div>
          </div>
        </div>
        <!-- 知识库引用 chips（kb-ref 块明细，历史数据回退 metadata.referencedKbs） -->
        <div class="knowledge-base flex flex-wrap gap-2 mt-3 ml-auto"
          v-if="referencedKbs.length > 0">
          <div v-for="kb in referencedKbs" :key="kb.id">
            <div
              class="knowledge-base-item rounded-md px-2 py-1 bg-gray-100 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 text-xs flex items-center gap-1">
              <MenuBookOutlined class="w-4 h-4" />
              {{ kb.name }}
            </div>
          </div>
        </div>
        <!-- 文件列表 -->
        <div class="file-list flex flex-wrap gap-2 mt-3 ml-auto" v-if="(userFiles?.length ?? 0) > 0">
          <FileItem v-for="file, index in userFiles" :key="file.id || index" :name="file.name"
            :type="isVisionImageMediaType(file.type) ? 'image' : 'file'"
            :ext="file.ext" :size="file.size"
            :preview-url="toResourceUrl(file.previewUrl || file.url)"
            :clickable="isVisionImageMediaType(file.type)"
            @click="handleImageClick(file)"></FileItem>
        </div>
        <!-- 用户操作按钮 -->
        <MessageActions :is-assistant="false" :is-last="false" :allow-generate="allowGenerate"
          :time-full="userTime.full" :time-friendly="userTime.firendly"
          @copy="emit('copy', userView)" @generate="emit('generate', props.turn)" @edit="emit('edit', userView)"
          @delete="emit('delete', props.turn)" />
      </div>
    </div>

    <!-- ============================================ -->
    <!-- 事件类消息（role='event'：command/compaction 等），位置=消息顺序 -->
    <!-- ============================================ -->
    <template v-for="evt in events" :key="evt.messageId">
      <EventCard class="mt-1" :event="evt" />
    </template>

    <!-- ============================================ -->
    <!-- Assistant 部分（有回复时） -->
    <!-- ============================================ -->
    <template v-if="activeBlocks.length > 0">
      <div class="assistant-section">
        <div class="text-xs text-gray-400 mb-3">
          <div class="flex items-center">
            <div class="mr-5 flex items-center">
              <Avatar class="w-6 h-6 mr-2.5 relative top-0" :src="agentAvatar || modelAvatarPath" :round="false"
                type="assistant" :name="displayName"></Avatar>
              <span class="text-[1.3em] text-gray-700 dark:text-gray-300 font-medium leading-tight mr-2">{{
                displayName }}</span>
              <span v-if="currentModelName && currentModelName !== 'unknown'" class="text-[1em] text-gray-400 mt-0.5">{{
                currentModelName }}</span>
            </div>
          </div>
        </div>
        <div class="message-item__card">
          <!-- 展示分组：content / think / tool -->
          <template v-for="(group, groupIndex) in displayGroups" :key="group.id">
            <template v-if="group.type === 'content'">
              <template v-for="item in group.items" :key="item.id">
                <MarkdownContent class="message-item__text markdown-text" :content="item.content || ''" />
              </template>
            </template>
            <div v-else class="process-group">
              <!-- 分组标题 -->
              <div v-if="group.isCollapsible" class="process-group__header text-[14px] group"
                :class="{ 'shimmer-text': isLastActive(groupIndex), 'text-gray-600 dark:text-gray-400': !isLastActive(groupIndex) }"
                @click="toggleGroup(isLastActive(groupIndex) ? 'last-active' : group.id)">
                <template v-for="(parts, _) in [getGroupTitleParts(group, isLastActive(groupIndex))]" :key="_">
                  <span class="relative w-3.75 h-3.75 shrink-0 flex items-center justify-center">
                    <!-- <span class="block w-1 h-1 rounded-3xl bg-gray-400 dark:bg-gray-700/50" v-if="!isLastActive(groupIndex)"></span> -->
                    <component :is="parts.icon" v-if="!isGroupExpanded(group.id)"
                      class="absolute inset-0 w-3.75 h-3.75 transition-opacity duration-200 group-hover:opacity-0 text-gray-500" />
                    <ChevronDown12Regular class="absolute inset-0 w-3.75 h-3.75 transition-all duration-200"
                      :class="isGroupExpanded(group.id) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
                      :style="isGroupExpanded(group.id) ? {} : { transform: 'rotate(-90deg)' }" />
                  </span>
                  <span class="shrink-0 font-medium ml-1.5">{{ parts.action }}</span>
                  <span v-if="parts.args" class="text-sm truncate ml-1.5"
                    :class="{ 'text-gray-400 dark:text-gray-400': !isLastActive(groupIndex) }">{{ parts.args }}</span>
                </template>
              </div>
              <!-- 分组内容 -->
              <div class="process-group__collapsible"
                :class="{ 'is-expanded': isGroupContentVisible(groupIndex, group) }">
                <div class="process-group__body">
                  <div class="process-group__body-scroll space-y-2"
                    :class="{ 'py-2': group.isCollapsible, 'no-mask': !group.isCollapsible && !isLastActive(groupIndex) }"
                    :ref="isLastActive(groupIndex) ? setActiveBodyRef : undefined"
                    @scroll="isLastActive(groupIndex) ? onActiveBodyScroll($event) : undefined">
                    <template v-for="item in group.items" :key="item.id">
                      <MessageThinkingSection v-if="item.type === 'think'"
                        :reasoning-content="item.reasoningContent || ''"
                        :is-thinking="item.source.state?.isThinking || false"
                        :thinking-duration-ms="item.source.thinkingDurationMs"
                        :thinking-started-at="item.source.thinkingStartedAt"
                        :auto-expand="isGroupContentVisible(groupIndex, group) && isSingleStepGroup(group)" />
                      <MessageToolCalls v-if="item.type === 'tool'" :tool-calls="item.toolCalls || []"
                        :tool-responses="item.toolResponses"
                        :is-streaming="streamingState.isStreaming" :session-id="props.sessionId"
                        :auto-expand="isGroupContentVisible(groupIndex, group) && isSingleStepGroup(group)" />
                    </template>
                  </div>
                </div>
              </div>
            </div>
          </template>


          <!-- Token 消耗 -->
          <div v-if="tokenUsage && !streamingState.isStreaming" class="token-usage-section mt-2 flex">
            <div class="flex items-center gap-3 text-xs text-gray-400">
              <el-icon size="13" class="text-gray-400">
                <InsightsTwotone />
              </el-icon>
              <span class="text-gray-500">Tokens:</span>
              <span class="token-item">
                <span class="text-gray-400 dark:text-gray-300 text-xs">Prompt</span>&nbsp;<span
                  class="text-gray-500 dark:text-gray-300">{{ formatTokenNumber(tokenUsage.promptTokens) }}</span>
              </span>
              <span class="token-item">
                <span class="text-gray-400 dark:text-gray-300">Completion</span>&nbsp;<span
                  class="text-gray-500 dark:text-gray-300">{{ formatTokenNumber(tokenUsage.completionTokens) }}</span>
              </span>
              <span class="token-item">
                <span class="text-gray-400 dark:text-gray-300">Total</span>&nbsp;<span
                  class="text-gray-500 dark:text-gray-300">{{
                    formatTokenNumber(tokenUsage.totalTokens) }}</span>
              </span>
            </div>
          </div>
        </div>

        <!-- 文件变更摘要 -->
        <FileChangesBar v-if="!streamingState.isStreaming && fileChanges.length > 0" :changes="fileChanges"
          @open-diff="openDiffDialog" />
      </div>
    </template>

    <!-- 回合级状态提示：独立于 assistant 块门渲染。
     LLM 在产出任何内容前即报错（如 402 / 网络错误）时回合内无 assistant 块，
     若在门内则错误提示永不显示。finishReason/errorDetail
     来自 turn.metadata（streamProjector.turn_end 写入，持久化后同样可用）。 -->
    <template v-if="assistantMetadata?.finishReason">
      <!-- 错误提示 -->
      <el-alert v-if="assistantMetadata.finishReason === 'error'" :title="t('chat.turn.apiError')" type="error"
        :closable="false" class="mt-2">
        {{ assistantMetadata.errorDetail }}
      </el-alert>

      <!-- 超时提示 -->
      <el-alert v-if="assistantMetadata.finishReason === 'timeout'" :title="t('chat.turn.requestTimeout')"
        type="warning" :closable="false" class="mt-2">
        {{ assistantMetadata.errorDetail || t('chat.turn.serverNoResponse') }}
      </el-alert>

      <!-- 限流提示（文字说明，无继续按钮——用户自行继续） -->
      <el-alert v-if="assistantMetadata.finishReason === 'rate_limited'"
        :title="t('chat.turn.rateLimitedPaused')" type="warning" :closable="false" class="mt-2">
        {{ assistantMetadata.errorDetail || t('chat.turn.rateLimitedPaused') }}
      </el-alert>

      <!-- 用户终止提示 -->
      <div v-if="assistantMetadata.finishReason === 'user_cancel'"
        class="mt-2 text-sm text-gray-400 dark:text-gray-500">
        {{ t('chat.turn.manuallyTerminated') }}
      </div>
    </template>

    <!-- 操作按钮：移到门外、置于状态提示之后——控制条永远在最下方。
         控制条（复制/再生/编辑/删除/时间）不依赖 assistant 消息存在，流结束即显示；
         仅复制按钮与 assistant 消息相关（无消息时复制空内容即可）。 -->
    <MessageActions v-if="!streamingState.isStreaming" :is-assistant="true" :is-last="isLast"
      :allow-generate="false" :time-full="assistantTime.full"
      :time-friendly="assistantTime.firendly" :duration-text="durationText" @copy="emit('copy', activeBlock)"
      @regenerate="emit('regenerate', props.turn)" @edit="emit('edit', activeBlock)"
      @delete="emit('delete', props.turn)" @branch="emit('branch', props.turn)" />

    <!-- 流式期间：思考中（点阵动画 + 轮播文案）/ 重试中状态（retry 为回合级瞬态 turn.state.retry，不落库） -->
    <div v-if="streamingState.isStreaming" class="mt-5 flex items-center gap-2 text-xs text-gray-400">
      <span v-if="retryState" class="text-amber-500 dark:text-amber-400">{{ retryState.message }}</span>
      <ThinkingStatus v-else :duration-text="durationText" />
    </div>
    <!-- 图片预览 -->
    <el-image-viewer v-if="showImageViewer" v-model:visible="showImageViewer" :url-list="previewList"
      :initial-index="currentPreViewIndex" @close="showImageViewer = false" :teleported="true" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick, inject } from "vue";
import { ElAlert, ElIcon, ElImageViewer, ElButton } from "element-plus";
import { useI18n } from "vue-i18n";
import { InsightsTwotone, MenuBookOutlined } from "@vicons/material";
import { Alert16Regular, BrainCircuit20Regular, Wrench24Filled, ChevronDown12Regular, PanelRightExpand20Filled } from "@vicons/fluent";
import { Loading } from "@element-plus/icons-vue";
import { FileItem, Avatar } from "../ui";
import { formatTime } from '../../utils';
import { toResourceUrl } from '../../utils/url';
import { isVisionImageMediaType } from '@/utils/media-type';
import { groupContentsForDisplay, type DisplayGroup, type DisplayItem, toUserMessageView, collectReferencedKbs } from '@/utils/messageUtils';
import type { Turn, MessageContent, TurnContent } from '@/types/message';
import { getToolConfig, getToolIcon, resolveToolName as _resolveToolName, getArgsText, countSteps, DEFAULT_CONFIG, type ToolCall } from '@/utils/toolDisplay';
import { getModelDisplayName, getModelAvatarPath } from '@/utils/modelUtils';
import { usePopup } from "../../composables/usePopup";
import MessageThinkingSection from './message-item/MessageThinkingSection.vue';
import ThinkingStatus from './ThinkingStatus.vue';
import MessageToolCalls from './message-item/MessageToolCalls.vue';
import GdTooltip from '@/components/ui/GdTooltip.vue';
import MessageActions from './message-item/MessageActions.vue';
import FileChangesBar from './message-item/FileChangesBar.vue';
import EventCard from './EventCard.vue';
import { useFileChanges, type FileChangeEntry } from '@/composables/useFileChanges';
import { useElapsedTicker } from '@/composables/useElapsedTicker';
import { apiService } from '@/services/ApiService';
import { useTabStore } from '@/stores/tab';
import { useLayoutStore } from '@/stores/layout';
import { isHiddenBlock, stripSystemReminder, getThinkingPreview } from '@/utils/messageUtils';

const { toast } = usePopup();
const { t } = useI18n();

const props = defineProps<{
  turn: Turn;
  isLast: boolean;
  allowGenerate: boolean;
  agentName?: string | null;
  agentAvatar?: string | null;
  animateIn?: boolean;
  sessionId?: string;
}>();

const emit = defineEmits<{
  delete: [turn: Turn]
  /** 用户消息以聚合视图传出（跨块文本+附件，带 id=messageId）；assistant 传块 */
  edit: [block: TurnContent | ReturnType<typeof toUserMessageView> | null]
  copy: [block: TurnContent | ReturnType<typeof toUserMessageView> | null]
  generate: [turn: Turn]
  regenerate: [turn: Turn]
  /** 从该回合（助手消息所在）分支新会话 */
  branch: [turn: Turn]
}>();

// 三层结构（turn → messages → blocks）：从 turn.messages 按消息束拆分。
// user 锚点消息束 + 事件消息束（command/compaction）单独抽离 + 其余消息束（assistant/tool）作为展示源。
// user 锚点：必须是人类真实输入（source.kind='user'）的消息束。
// 后端注入的 hidden user 消息（拦截器/图片/待办/压缩检查点）同 role 但非用户输入，须排除。
// 引用收集派生：仅遍历 messages/blocks 数组结构，不复制块、不读块内容字段——流式期间块
// content 变化不会触发本 computed 重算（text_delta 零额外开销）。
const user = computed(
  () => props.turn.messages?.find((m) => m.role === 'user' && !isHiddenBlock(m)) ?? null,
);
const events = computed(() => props.turn.messages?.filter((m) => m.role === 'event') ?? []);
const activeBlocks = computed(() => {
  const msgs = props.turn.messages?.filter(
    (m) => m.role !== 'user' && m.role !== 'event',
  ) ?? [];
  // 引用收集（flatMap 不复制块），供 displayGroups/useFileChanges 等按块消费的派生层
  return msgs.flatMap((m) => m.blocks);
});

// ============================================
// 内部状态
// ============================================
const showImageViewer = ref(false);
const currentPreViewIndex = ref(0);
const expandedGroups = ref<Set<string>>(new Set());

// 从 ChatPanel 注入锁定滚动方法，展开分组时调用
const lockScrollAnchor = inject<() => void>('lockScrollAnchor', () => { });

// 激活分组内容区 ref，用于自动滚动
const activeBodyRef = ref<HTMLElement | null>(null);
// 标记用户是否手动滚动了
let userScrolledAway = false;

// ref 绑定函数
const setActiveBodyRef = (el: Element | { $el: HTMLElement } | null) => {
  activeBodyRef.value = (el as any)?.$el || (el as HTMLElement) || null;
};

// 用户滚动检测：距底部超过 40px 视为手动滚动
const onActiveBodyScroll = (e: Event) => {
  const el = e.target as HTMLElement;
  const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
  userScrolledAway = !atBottom;
};

const toggleGroup = (groupId: string) => {
  const set = expandedGroups.value;
  if (set.has(groupId)) {
    set.delete(groupId);
  } else {
    set.add(groupId);
    if (groupId !== 'last-active') {
      lockScrollAnchor()
    }
  }
};

const isGroupExpanded = (groupId: string): boolean => {
  return expandedGroups.value.has(groupId);
};

/** 分组内容当前是否可见（与模板 collapsible 的 is-expanded 判定保持同一表达式） */
const isGroupContentVisible = (groupIndex: number, group: DisplayGroup): boolean => {
  return isLastActive(groupIndex)
    ? isGroupExpanded('last-active')
    : (!group.isCollapsible || isGroupExpanded(group.id));
};

/**
 * 分组是否只含单个子步骤（单条思考 或 单个工具调用）。
 * 单步骤分组展开时自动展开子项，省去二次点击。
 */
const isSingleStepGroup = (group: DisplayGroup): boolean => {
  if (group.items.length !== 1) return false;
  const item = group.items[0];
  if (item.type === 'think') return true;
  if (item.type === 'tool') return (item.toolCalls?.length ?? 0) === 1;
  return false;
};

// ============================================
// 展示计算
// ============================================
/**
 * 当前回合的全部展示块（assistant + tool 块）。
 * 二级结构天然平铺：事件折叠直接产出块，无需再"合并消息 contents → 拆回扁平块"。
 */
const activeContents = computed<MessageContent[]>(() =>
  (activeBlocks.value ?? []).filter((c) => c != null),
);

/**
 * 编辑/复制锚点块：取最后一条带文本内容的 assistant 块（编辑消息文本语义 = 最终回答块）；
 * 无文本块（纯工具回合）回退到最后一个展示块。
 */
const activeBlock = computed<TurnContent | null>(() => {
  const list = activeBlocks.value;
  if (list.length === 0) return null;
  for (let i = list.length - 1; i >= 0; i--) {
    const b = list[i];
    if (typeof b.content === "string" && b.content) return b;
  }
  return list[list.length - 1];
});

const displayGroups = computed<DisplayGroup[]>(() => {
  return groupContentsForDisplay(activeContents.value);
});

// 文件变更记录
const { fileChanges } = useFileChanges(activeContents);

const layoutStore = useLayoutStore();
const tabStore = useTabStore();

// 点击 diff：改为在侧边栏以「编辑记录」标签展示（不再弹窗）
const openDiffDialog = (entry: FileChangeEntry) => {
  layoutStore.setWorkspaceVisible(true);
  nextTick(() => tabStore.openDiffTab(entry, props.turn.id));
};

// 激活分组内容更新时自动滚动到底部（用户手动滚动后不干扰）
watch(activeContents, () => {
  if (!streamingState.value.isStreaming) return;
  nextTick(() => {
    const el = activeBodyRef.value;
    if (!el || userScrolledAway) return;
    el.scrollTop = el.scrollHeight;
  });
}, { deep: true });

// 流式过程中最后一组且需折叠为标题行
const isLastActiveGroup = computed(() => {
  if (!streamingState.value.isStreaming) return null;
  const groups = displayGroups.value;
  if (groups.length === 0) return null;
  const lastGroup = groups[groups.length - 1];
  return lastGroup.type === 'process' ? 'last-active' : null;
});

// 判断当前 group 是否为流式过程中需特殊处理的最后一组
const isLastActive = (groupIndex: number): boolean => {
  if (!isLastActiveGroup.value) return false;
  return groupIndex === displayGroups.value.length - 1;
};
// 统一的分组标题生成：active=true 时显示"正在"，active=false 时显示"已"
// 内部自行判断展开状态，返回 { icon, action, args }
const getGroupTitleParts = (group: DisplayGroup, active: boolean) => {
  const groupId = active ? 'last-active' : group.id;
  const expanded = isGroupExpanded(groupId);
  const items = active ? group.items.slice(-1) : group.items;
  const steps = countSteps(group.items);
  if (expanded) {
    if (active) {
      const currentItemSteps = countSteps(items);
      const completedSteps = steps - currentItemSteps;
      return { icon: Wrench24Filled, action: completedSteps ? t('chat.turn.executingStepsWithCompleted', { n: currentItemSteps, m: completedSteps }) : t('chat.turn.executingSteps', { n: currentItemSteps }), args: '' };
    }
    return { icon: Wrench24Filled, action: t('chat.turn.executedSteps', { n: steps }), args: '' };
  }
  const toolItems = items.filter(i => i.type === 'tool');
  const allToolCalls = toolItems.flatMap(i => i.toolCalls || []);

  // 纯思考（无工具）：摘要为思考内容最后一行，思考中实时跟随、结束后保留
  if (allToolCalls.length === 0) {
    const thinkItem = items.find(i => i.type === 'think');
    const isThinking = thinkItem?.source.state?.isThinking;
    return {
      icon: BrainCircuit20Regular,
      action: isThinking ? t('chat.turn.thinkingActive') : t('chat.turn.thinkingDone'),
      args: getThinkingPreview(thinkItem?.reasoningContent),
    };
  }

  // 判断是否所有工具同类型
  const refTool = allToolCalls[allToolCalls.length - 1] as ToolCall;
  const allSameType = allToolCalls.every(tc => _resolveToolName(tc as ToolCall) === _resolveToolName(refTool));

  if (allSameType && allToolCalls.length > 1) {
    const config = getToolConfig(refTool);
    const agg = config.aggregate || DEFAULT_CONFIG.aggregate!;
    const text = active ? agg.executing : agg.completed;
    return { icon: getToolIcon(refTool), action: text.replace('{n}', String(allToolCalls.length)), args: '' };
  }

  if (allSameType && allToolCalls.length === 1) {
    const config = getToolConfig(refTool);
    const args = getArgsText(refTool);
    return { icon: getToolIcon(refTool), action: active ? config.text.executing : config.text.completed, args: args || '' };
  }

  // 混合工具 — 通用图标
  return { icon: Wrench24Filled, action: active ? t('chat.turn.executingSteps', { n: countSteps(items) }) : t('chat.turn.executedSteps', { n: steps }), args: '' };
};
// ============================================
const userContent = computed(() => {
  const bundle = user.value;
  if (!bundle) return '';
  // 跨块聚合文本（用户消息可能含多个 text 块 + image/file 块，文本块 content 拼接）
  // 注入块不入正文：origin='system'（系统提示，对用户不可见）与 kb-ref（KB 引用，chips 单独渲染）
  return bundle.blocks
    .filter((b) => !b.origin && !b.kbRefs)
    .map((b) => b.content || '')
    .filter((t) => t.length > 0)
    .join('\n');
});
// KB 引用 chips 数据源：kb-ref 块明细优先，历史数据回退 metadata（归一化见 collectReferencedKbs）
const referencedKbs = computed(() => collectReferencedKbs(user.value));
// 跨块聚合附件（所有 image/file 块的 files 并集，供文件列表渲染）
const userFiles = computed(() => {
  const bundle = user.value;
  if (!bundle) return [];
  return bundle.blocks.flatMap((b) => b.files ?? []);
});
// 用户消息视图（跨块聚合文本+附件，供复制/编辑等旧消费方按单对象访问）
const userView = computed(() => toUserMessageView(user.value));

// P5b：通知类消息（process_monitor/sub_agent）——只含 <system_reminder> 块，
// 前端剥离标签后折叠极简显示（点击展开看全文），不混入用户消息气泡。
const reminderExpanded = ref(false);
const isNotificationUser = computed(() => {
  const kind = user.value?.source?.kind;
  return kind === 'process_monitor' || kind === 'sub_agent';
});
const notificationText = computed(() => {
  if (!isNotificationUser.value) return '';
  return stripSystemReminder(userContent.value ?? '');
});
// 折叠按钮文案按来源区分：进程输出 / 子代理结果
const notificationLabel = computed(() => {
  return user.value?.source?.kind === 'process_monitor'
    ? t('chat.turn.viewProcessOutput')
    : t('chat.turn.viewSubagentResult');
});

/** 子代理结果通知目标会话（仅 kind='sub_agent' 有；process_monitor 不参与跳转） */
const notificationSubSessionId = computed(() => {
  const source = user.value?.source;
  if (source?.kind !== 'sub_agent') return '';
  return typeof source.subSessionId === 'string' ? source.subSessionId : '';
});

/** 打开子代理面板（ChatPage provide；无 provide 的宿主如 BotSessionDialog 下为 null → 不渲染入口） */
const openSubAgentSession = inject<((subSessionId: string) => void) | null>(
  'workspace:openSubAgentSession',
  null,
);

const openNotificationSubAgent = (): void => {
  if (notificationSubSessionId.value) {
    openSubAgentSession?.(notificationSubSessionId.value);
  }
};

const userTime = computed(() => {
  return {
    firendly: formatTime(user.value?.createdAt || '', 'friendly'),
    full: formatTime(user.value?.createdAt || '', 'full'),
  };
});

const isSystemMessage = computed(() => {
  const meta = user.value?.metadata;
  const type = meta?.type;
  return type && type !== 'client';
});

const systemMessageLabel = computed(() => {
  const meta = user.value?.metadata;
  const type = meta?.type || '';
  const name = meta?.subAgentName || '';
  switch (type) {
    case 'scheduler': return t('chat.turn.systemMessageScheduler');
    case 'sub_agent': return t('chat.turn.systemMessageSubAgent');
    default: return t('chat.turn.systemMessage');
  }
});

const renderSkillBadges = (text: string): string => {
  if (!text) return text;
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped.replace(
    /\[([\/@])([a-zA-Z][\w\-\/]*):([\w-]+)((?:\s+\w+="[^"]*")*)\s*\]/g,
    (match, prefix, provider, name, attrsStr) => {
      const attrs: Record<string, string> = { label: '' };
      if (attrsStr) {
        const attrRegex = /(\w+)="([^"]*)"/g;
        let m: RegExpExecArray | null;
        while ((m = attrRegex.exec(attrsStr)) !== null) {
          attrs[m[1]] = m[2];
        }
      }
      const displayText = attrs.label || `${prefix}${name}`;
      const dataAttrs = Object.entries(attrs)
        .filter(([k]) => k !== 'label')
        .map(([k, v]) => ` data-${k}="${v}"`)
        .join('');
      return `<span data-type="command" data-provider-id="${provider}" data-name="${name}" data-label="${attrs.label || ''}" data-trigger="${prefix}"${dataAttrs} class="command-badge" style="color: var(--el-color-primary);">${displayText}</span>`;
    }
  );
};

// ============================================
// Assistant 部分
// ============================================
/**
 * 回合级元信息（Turn/Message/ContentBlock 模型下，回合的结束原因等元数据统一在 turn.metadata）：
 * - 历史：replayer turn/finish 折叠合并（finishReason/errorDetail/usage/modelName）
 * - 流式：turn_start 写 modelName、turn_end 写 finishReason/errorDetail/usage
 * 流式瞬态（重试提示等）为回合级 turn.state，不挂消息 metadata（v1.9 迁移）。
 * 审批卡/暂停卡为会话级全局卡（SessionCards.vue），不再挂回合（对齐 DSH：sessionId 唯一锚点）。
 */
const assistantMetadata = computed<Record<string, any> | null>(() => {
  const turnMeta = props.turn?.metadata || {};
  return {
    ...turnMeta,
  };
});

const streamingState = computed(() => ({
  // 回合级工作态：turn_start 置位、turn_end 复位（turn.state.isWorking，
  // 纯前端瞬态视图态）。历史加载的回合无此字段 = 非工作态。
  isStreaming: props.turn?.state?.isWorking ?? false,
}));

// LLM 流重试瞬态（回合级 turn.state.retry，retry 事件标记，重试成功输出/turn_end 清除）
const retryState = computed<{
  message?: string;
} | null>(() => {
  const retry = props.turn?.state?.retry;
  return retry?.message ? { message: retry.message } : null;
});

const currentModelName = computed(() => {
  const modelName = assistantMetadata.value?.modelName;
  return modelName ? getModelDisplayName(modelName) : "unknown";
});

const displayName = computed(() => {
  return props.agentName || currentModelName.value;
});

const modelAvatarPath = computed(() => {
  const modelName = assistantMetadata.value?.modelName;
  if (!modelName) return undefined;
  const parts = modelName.split("/");
  const providerName = parts.length > 1 ? parts[0] : undefined;
  return getModelAvatarPath(modelName, providerName) || undefined;
});

const assistantTime = computed(() => {
  const cache = activeContents.value;
  if (cache.length === 0) {
    return { firendly: '', full: '' };
  }
  return {
    firendly: formatTime(cache[0]?.createdAt || '', 'friendly'),
    full: formatTime(cache[0]?.createdAt || '', 'full'),
  };
});

/**
 * 工作时长（ms）：单一来源，两态取值由秒表统一切换——
 * - 流式期间：从 turn.state.startedAt 锚点跳动（本地时钟，纯展示；
 *   此刻服务端耗时尚未产生，metadata.totalDurationMs 为 undefined）
 * - 回合结束：自动切到服务端落库真值 turn.metadata.totalDurationMs
 *   （SSE turn_end 与历史事件页 turn/finish 同源 → 刷新后仍可展示）
 */
const { elapsedMs: durationMs } = useElapsedTicker(
  () => props.turn?.state?.startedAt ?? null,
  () => streamingState.value.isStreaming,
  () => props.turn?.metadata?.totalDurationMs ?? null,
);

const formatDuration = (ms: number): string => {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rest = Math.floor(s % 60);
  return `${m}m ${rest}s`;
};

const durationText = computed(() => {
  const ms = durationMs.value;
  if (ms === null || ms === undefined) return null;
  return formatDuration(ms);
});

const tokenUsage = computed(() => {
  if (!props.turn.messages || props.turn.messages.length === 0) return null;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalTokens = 0;
  // usage 已在折叠器写入 assistant bundle.metadata（消息级，不再逐块求和）
  for (const m of props.turn.messages) {
    const usage = m.metadata?.usage;
    if (usage) {
      totalPromptTokens += usage.promptTokens || 0;
      totalCompletionTokens += usage.completionTokens || 0;
      totalTokens += usage.totalTokens || 0;
    }
  }
  if (totalTokens === 0) return null;
  return { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens, totalTokens };
});

const formatTokenNumber = (num: number | null): string => {
  if (!num && num !== 0) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return num.toString();
};

// ============================================
// 图片预览
// ============================================
const previewList = computed(() => {
  const files = userFiles.value || [];
  // 仅可内联的位图进入大图预览（svg/ico 等 image/* 前缀但不渲染的类型排除），
  // 绝对化后取原图 url（无缩略图路径时回退）
  return files
    .filter((f: any) => isVisionImageMediaType(f.type))
    .map((f: any) => toResourceUrl(f.url || f.previewUrl));
});

/**
 * 打开大图预览。
 * 按附件对象在「图片子集」里的位置取索引——不能直接用列表下标：
 * 同一条消息现在可以同时有图片和普通文件（类型限制已取消），
 * 用外层下标会让预览取错图、甚至越界。
 */
const handleImageClick = (file: any) => {
  const images = (userFiles.value || []).filter((f: any) => isVisionImageMediaType(f.type));
  const index = images.indexOf(file);
  if (index < 0) return;
  currentPreViewIndex.value = index;
  showImageViewer.value = true;
};

</script>

<style scoped>
.turn-wrapper {
  width: 100%;
  margin-top: 20px;
  margin-bottom: 25px;
  /* 屏外消息跳过 layout/paint：重排成本与历史长度解耦（对齐 Qoder 的 MessageScrollerItem）。
     contain-intrinsic-size 的 auto 关键字在元素渲染过后记住真实高度，800px 只是首次
     渲染前的占位估算（实测本应用回合高度 800~2700，中位数约 1700）。
     content-visibility 附带 paint 包含会裁剪越界后代，而 .message-actions 有 ±4px
     光学位移（translate-x-1），故用「content-box + 4px 内边距 - 4px 外边距」把裁剪
     边界外扩 4px，内容位置与换行宽度保持原样 */
  box-sizing: content-box;
  padding-inline: 4px;
  margin-inline: -4px;
  content-visibility: auto;
  contain-intrinsic-size: auto 800px;
  transition: opacity 0.3s ease;
}

.turn-wrapper.animate-in {
  animation: turn-enter 0.4s cubic-bezier(0.22, 1, 0.36, 1);
}

@keyframes turn-enter {
  from {
    opacity: 0;
    transform: translateY(120px) scale(0.95);
  }

  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}


/* 消息卡片 */
.message-item__card {
  font-size: var(--gd-size-text-base);
  max-width: 100%;
}

/* 用户消息气泡 */
.user-section {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.user-section .message-item__card {

  background-color: var(--gd-color-bubble-user-bg);

  color: var(--gd-color-bubble-user-text);

  padding: 5px 12px;

  border-radius: 16px;

  border: 1px solid var(--gd-color-bubble-user-border);

}

.user-section .message-item__wrapper {
  align-items: flex-end;
  max-width: 80%;
}

/* P5：process_monitor 通知折叠区（居左、灰色极简） */
.user-reminder {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  margin-top: 4px;
  max-width: 100%;
}
/* 折叠按钮与"打开子代理面板"同行（后者仅子代理结果通知出现） */
.user-reminder__row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
/* 打开子代理面板：与工具行的同名入口保持同一视觉/交互 */
.open-subagent-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-tertiary, #999);
  cursor: pointer;
  transition: color 0.15s ease;
}
.open-subagent-btn:hover {
  color: var(--el-color-primary);
}
.user-reminder__toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border: 1px solid var(--color-border-tertiary, #e0e0e0);
  border-radius: 999px;
  background: transparent;
  color: var(--color-text-tertiary, #999);
  font-size: 12px;
  cursor: pointer;
  transition: color 0.2s ease, border-color 0.2s ease;
}
.user-reminder__toggle:hover {
  color: var(--color-text-secondary, #666);
  border-color: var(--color-border-secondary, #bbb);
}
.user-reminder__arrow {
  transition: transform 0.2s ease;
}
.user-reminder__arrow.is-expanded {
  transform: rotate(180deg);
}
.user-reminder__body {
  margin-top: 4px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--gd-color-surface, #f5f5f5);
  color: var(--color-text-secondary, #666);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 320px;
  overflow-y: auto;
}

/* 助手消息气泡 */
.assistant-section {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.assistant-section .message-item__card {
  background: var(--gd-color-bubble-assitant-bg);
  color: var(--gd-color-bubble-assitant-text);
  margin-right: auto;
  width: 100%;
  padding: 0;
  box-shadow: none;
  border: none;
}

.assistant-section .message-item__wrapper {
  align-items: flex-start;
  width: 100%;
}

/* 消息文本：字号/行高取自 markdown.css 的 --gd-md-* 体系（唯一旋钮 --gd-md-font-size），
   用户气泡与助手正文共用，避免同一份文字有两处尺寸真相 */
.message-item__text {
  font-size: var(--gd-md-font-size);
  line-height: var(--gd-md-line-height);
  color: inherit;
  max-width: 100%;
  vertical-align: middle;
}

.user-section .message-item__text {
  margin: 0;
}

.assistant-section .message-item__text {
  margin-bottom: 8px;
}

.message-item__wrapper {
  padding: 8px 0;
}

/* 系统消息 */
.system-message-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.system-message-icon {
  color: var(--el-color-warning);
}

.system-message-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  font-weight: 500;
}

.system-message-divider {
  height: 1px;
  background-color: var(--el-border-color-lighter);
  margin: 8px 0;
}

.system-message-body {
  font-size: 14px;
  color: var(--el-text-color-regular);
}

/* 中间处理过程分组 */
.process-group {
  margin: 16px 0;
}

.process-group:first-child {
  margin-top: 0;
}

.process-group__header {
  display: flex;
  align-items: center;
  max-width: 100%;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.2s ease;
  user-select: none;
}

:deep(.process-group__body .process-section:last-child .process-timeline) {
  display: none;
}

.process-group__header:hover {
  color: var(--el-text-color-primary);
}

.process-group__title {
  line-height: 1.4;
  min-width: 0;
}

/* 流式过程中的文字波纹效果（action + args 一起波纹） */
.shimmer-text {
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
  animation: shimmer-slide 1.5s linear infinite;
}

@keyframes shimmer-slide {
  0% {
    background-position: 100% 0;
  }

  100% {
    background-position: -100% 0;
  }
}

.process-group__collapsible {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.process-group__collapsible.is-expanded {
  grid-template-rows: 1fr;
}

.process-group__body {
  min-height: 0;
  overflow: hidden;
}

.process-group__body-scroll {
  overflow-y: auto;
  overflow-x: hidden;
  /* max-height: 400px; */
  /* 真实遮罩渐变（不叠加背景色，壁纸不受影响） */
  -webkit-mask-image: linear-gradient(to bottom,
      transparent 0,
      black 16px,
      black calc(100% - 16px),
      transparent 100%);
  mask-image: linear-gradient(to bottom,
      transparent 0,
      black 16px,
      black calc(100% - 16px),
      transparent 100%);
}

/* 不可折叠的分组（单项内容）不需要遮罩和滚动限制 */
.process-group__body-scroll.no-mask {
  -webkit-mask-image: none;
  mask-image: none;
  max-height: none;
  overflow: visible;
}

/* 知识库 */
.knowledge-base-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

/* Token 消耗 */
.token-usage-section {
  padding: 4px 0;
  animation: fadeIn 0.3s ease;
}

.dark .token-usage-section {
  opacity: 0.8;
}

.token-item {
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  white-space: nowrap;
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

.max-iterations-notice {
  margin-top: 12px;
}
</style>
