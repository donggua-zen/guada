<template>
  <div class="turn-wrapper last:min-h-[60vh]" :class="{ 'turn-wrapper--last': isLast, 'animate-in': animateIn }"
    :data-message-id="user?.messageId">
    <!-- ============================================ -->
    <!-- User 部分 -->
    <!-- ============================================ -->
    <div v-if="user" class="user-section">
      <!-- P5c：通知类回合（process_monitor/sub_agent）渲染为压缩卡同款时间卡片，
           不再占用用户气泡容器（数据不动：role='user' + source.kind 是唯一分流依据） -->
      <EventCard v-if="isNotificationTurn" :event="user" class="w-full" />
      <div v-else class="message-item__wrapper">
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
            <span v-else v-html="renderSkillBadges(userContent)"></span>
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
              <span class="text-[1.3em] text-gray-700 dark:text-gray-300 font-medium leading-5 mr-2">{{
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
              <!-- text-sm（Tailwind v4 = 14px/20px 行盒）：原先的 text-[14px] 只给字号，
                   行盒继承 html{line-height:1.5} = 21px（奇数），图标居中余量会随容器奇偶变半像素 -->
              <div v-if="group.isCollapsible" class="process-group__header text-sm group"
                :class="{ 'shimmer-text': isGroupBusy(groupIndex), 'text-gray-600 dark:text-gray-400': !isGroupBusy(groupIndex) }"
                @click="toggleGroup(groupIndex, group)">
                <template v-for="(parts, _) in [getGroupTitleParts(group, isGroupBusy(groupIndex), isGroupExpanded(groupIndex, group))]" :key="_">
                  <!-- 图标盒 16px（偶数）：20px 行盒内居中余量 2px 整数；奇数盒会得到 X.5px 余量 -->
                  <span class="relative w-4 h-4 shrink-0 flex items-center justify-center">
                    <!-- <span class="block w-1 h-1 rounded-3xl bg-gray-400 dark:bg-gray-700/50" v-if="!isGroupBusy(groupIndex)"></span> -->
                    <component :is="parts.icon" v-if="!isGroupExpanded(groupIndex, group)"
                      class="absolute inset-0 w-4 h-4 transition-opacity duration-200 group-hover:opacity-0 text-gray-500" />
                    <ChevronDown12Regular class="absolute inset-0 w-4 h-4 transition-all duration-200"
                      :class="isGroupExpanded(groupIndex, group) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
                      :style="isGroupExpanded(groupIndex, group) ? {} : { transform: 'rotate(-90deg)' }" />
                  </span>
                  <span class="shrink-0 font-medium ml-1.5">{{ parts.action }}</span>
                  <span v-if="parts.args" class="text-sm truncate ml-1.5"
                    :class="{ 'text-gray-400 dark:text-gray-400': !isGroupBusy(groupIndex) }">{{ parts.args }}</span>
                </template>
              </div>
              <!-- 分组内容 -->
              <div class="process-group__collapsible"
                :class="{ 'is-expanded': isGroupContentVisible(groupIndex, group) }">
                <div class="process-group__body">
                  <div class="process-group__body-scroll space-y-2"
                    :class="{ 'py-2': group.isCollapsible, 'no-mask': !group.isCollapsible }"
                    :ref="isLastActive(groupIndex) ? setActiveBodyRef : undefined"
                    @scroll="isLastActive(groupIndex) ? onActiveBodyScroll($event) : undefined">
                    <template v-for="item in group.items" :key="item.id">
                      <MessageThinkingSection v-if="item.type === 'think'"
                        :reasoning-content="item.reasoningContent || ''"
                        :is-thinking="item.source.state?.isThinking || false"
                        :thinking-duration-ms="item.source.thinkingDurationMs"
                        :thinking-started-at="item.source.thinkingStartedAt" />
                      <MessageToolCalls v-if="item.type === 'tool'" :tool-calls="item.toolCalls || []"
                        :tool-responses="item.toolResponses"
                        :is-streaming="streamingState.isStreaming" :session-id="props.sessionId" />
                    </template>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>

        <!-- 文件变更摘要（文件名 → 文件标签；行其余部分 → 编辑记录标签） -->
        <FileChangesBar v-if="!streamingState.isStreaming && fileChanges.length > 0" :changes="fileChanges"
          @open-diff="openDiffDialog" @open-file="openFilePreview" />
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

      <!-- 中断收尾提示：冷加载/自愈把停在中断点的回合闭合（工具配对已补齐），
           而不是失败——用户需要知道"这条回复是被打断的，可以继续" -->
      <div v-if="assistantMetadata.finishReason === 'interrupted'"
        class="mt-2 text-sm text-gray-400 dark:text-gray-500">
        {{ t('chat.turn.interruptedRecovered') }}
      </div>
    </template>

    <!-- 操作按钮：移到门外、置于状态提示之后——控制条永远在最下方。
         控制条（复制/再生/编辑/删除/时间）不依赖 assistant 消息存在，流结束即显示；
         仅复制按钮与 assistant 消息相关（无消息时复制空内容即可）。 -->
    <MessageActions v-if="!streamingState.isStreaming" :is-assistant="true" :is-last="isLast"
      :allow-generate="false" :time-full="assistantTime.full" :time-friendly="assistantTime.firendly"
      :duration-ms="durationMs" :token-usage="tokenUsage" @copy="emit('copy', activeBlock)"
      @regenerate="emit('regenerate', props.turn)" @edit="emit('edit', activeBlock)"
      @delete="emit('delete', props.turn)" @branch="emit('branch', props.turn)"
      :branching="branching" :branch-disabled="branchDisabled" />

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
import { computed, ref, watch, nextTick, inject, type Component } from "vue";
import { ElAlert, ElIcon, ElImageViewer } from "element-plus";
import { useI18n } from "vue-i18n";
import { MenuBookOutlined } from "@vicons/material";
import { Alert16Regular, BrainCircuit20Regular, Wrench24Filled, ChevronDown12Regular } from "@vicons/fluent";
import { FileItem, Avatar } from "../ui";
import { formatTime } from '../../utils';
import { toResourceUrl } from '../../utils/url';
import { isVisionImageMediaType } from '@/utils/media-type';
import { groupContentsForDisplay, type DisplayGroup, type DisplayItem, toUserMessageView, collectReferencedKbs } from '@/utils/messageUtils';
import type { Turn, MessageContent, TurnContent, FileAttachment } from '@/types/message';
import { getToolConfig, getToolIcon, resolveToolName as _resolveToolName, getArgsText, type ToolCall } from '@/utils/toolDisplay';
import { getModelDisplayName, getModelAvatarPath } from '@/utils/modelUtils';
import MessageThinkingSection from './message-item/MessageThinkingSection.vue';
import ThinkingStatus from './ThinkingStatus.vue';
import MessageToolCalls from './message-item/MessageToolCalls.vue';
import MessageActions from './message-item/MessageActions.vue';
import FileChangesBar from './message-item/FileChangesBar.vue';
import EventCard from './EventCard.vue';
import { useFileChanges, type FileChangeEntry } from '@/composables/useFileChanges';
import { useElapsedTicker } from '@/composables/useElapsedTicker';
import { useTabStore } from '@/stores/tab';
import { useLayoutStore } from '@/stores/layout';
import { isHiddenBlock, getThinkingPreview } from '@/utils/messageUtils';
import { isJobNoticeSource } from '@/utils/jobNotice';
import { previewFile } from '@/utils/workspacePreview';
import { resolveGroupExpanded, nextGroupExpandOverride, hasUnfinishedSteps, isToolCallExecuting, resolveGroupTitlePhase } from './groupExpansion';
import { perfCount, perfStart } from '@/utils/perf';

const { t } = useI18n();

const props = defineProps<{
  turn: Turn;
  isLast: boolean;
  allowGenerate: boolean;
  agentName?: string | null;
  agentAvatar?: string | null;
  animateIn?: boolean;
  sessionId?: string;
  /** 本回合分支进行中（分支按钮转圈） */
  branching?: boolean;
  /** 有任意分支进行中（全部分支按钮禁用，防并发 fork） */
  branchDisabled?: boolean;
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
/**
 * 分组展开状态的显式覆盖（group.id -> 是否展开，仅用户点击时写入）。
 * 缺省不落状态：由 isGroupExpanded 按运行态派生——流式中的最后一组展开、其余收起。
 */
const groupExpandOverrides = ref<Map<string, boolean>>(new Map());

// 从 ChatPanel 注入锁定滚动方法，展开分组时调用
const lockScrollAnchor = inject<() => void>('lockScrollAnchor', () => { });

// 激活分组内容区 ref，用于自动滚动
const activeBodyRef = ref<HTMLElement | null>(null);
// 标记用户是否手动滚动了
let userScrolledAway = false;

// ref 绑定函数
const setActiveBodyRef = (el: Element | { $el: HTMLElement } | null) => {
  activeBodyRef.value =
    (el && "$el" in el ? el.$el : undefined) || (el as HTMLElement) || null;
};

// 用户滚动检测：距底部超过 40px 视为手动滚动
const onActiveBodyScroll = (e: Event) => {
  const el = e.target as HTMLElement;
  const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
  userScrolledAway = !atBottom;
};

/**
 * 分组展开态：显式覆盖优先；无覆盖时按运行态派生——进行中的最后一组默认展开。
 * 回合结束后活动组不再满足 isLastActive，自动回落为收起；
 * 用户手动展开过的组因覆盖存在而保持展开。
 */
const isGroupExpanded = (groupIndex: number, group: DisplayGroup): boolean => {
  return resolveGroupExpanded(groupExpandOverrides.value, group.id, isLastActive(groupIndex));
};

const toggleGroup = (groupIndex: number, group: DisplayGroup) => {
  const expanded = isGroupExpanded(groupIndex, group);
  const active = isLastActive(groupIndex);
  groupExpandOverrides.value.set(group.id, nextGroupExpandOverride(groupExpandOverrides.value, group.id, active));
  if (!expanded && !active) {
    lockScrollAnchor()
  }
};

/** 分组内容当前是否可见（与模板 collapsible 的 is-expanded 判定保持同一表达式） */
const isGroupContentVisible = (groupIndex: number, group: DisplayGroup): boolean => {
  // 不可折叠组（独立渲染工具卡，如计划）永远直接渲染：
  // 不参与进行中分组的展开/收起判定，否则待审批/流式最后一组时又被藏住
  if (!group.isCollapsible) return true;
  return isGroupExpanded(groupIndex, group);
};

/** 分组内的工具步骤数（思考项不计入） */
const countToolSteps = (items: ReadonlyArray<DisplayItem>): number =>
  items.reduce((sum, item) => sum + (item.type === 'tool' ? item.toolCalls?.length ?? 0 : 0), 0);

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

// 点击文件名：在侧边栏以文件标签打开该文件（复用统一预览入口：展开侧栏 + 挂载后开预览标签，
// 同名文件复用同一个预览标签，不会堆标签）。路径原样透传——后端按工作目录解析相对路径。
const openFilePreview = (entry: FileChangeEntry) => {
  void previewFile(entry.filePath);
};

// 激活分组内容更新时自动滚动到底部（用户手动滚动后不干扰）
watch(activeContents, () => {
  perfCount('turnItem.deepWatch');
  if (!streamingState.value.isStreaming) return;
  nextTick(() => {
    const el = activeBodyRef.value;
    if (!el || userScrolledAway) return;
    const span = perfStart('scroll.groupBody');
    try {
      el.scrollTop = el.scrollHeight;
    } finally {
      span?.end();
    }
  });
}, { deep: true });

// 流式过程中最后一组是否为进行中的过程分组（该组默认展开）
const hasActiveGroup = computed(() => {
  if (!streamingState.value.isStreaming) return false;
  const groups = displayGroups.value;
  if (groups.length === 0) return false;
  return groups[groups.length - 1].type === 'process';
});

// 判断当前 group 是否为流式过程中的进行中分组
const isLastActive = (groupIndex: number): boolean => {
  return hasActiveGroup.value && groupIndex === displayGroups.value.length - 1;
};

/**
 * 分组是否忙碌（存在未完成步骤）：标题「正在…」/微光动画按此判定，而非组位置。
 * 工具全部执行完、等待模型下次响应时不算忙碌——标题回落「已执行 N 个步骤」，
 * 但组仍保持展开（默认展开按 isLastActive 位置判定，等待间隙不闪烁收起）。
 */
const isGroupBusy = (groupIndex: number): boolean => {
  if (!streamingState.value.isStreaming) return false;
  const group = displayGroups.value[groupIndex];
  return !!group && hasUnfinishedSteps(group.items, true);
};

/** 分组内仍在执行的工具调用（忙碌步骤） */
const executingCallsOf = (group: DisplayGroup): ToolCall[] =>
  group.items.flatMap((item) =>
    item.type === 'tool'
      ? (item.toolCalls ?? []).filter((tool, i) => isToolCallExecuting(tool, i, item.toolResponses, true))
      : [],
  );

/**
 * 分组标题的当前状态段（正在进行的步骤/思考），配合已执行前缀拼接。
 * 同类型执行中调用 → 聚合文案（如「正在搜索 3 个网页」）；混合 → 通用步骤数。
 */
const getActiveStatusParts = (executing: ToolCall[]): { icon: Component; text: string } => {
  if (executing.length === 0) {
    return { icon: BrainCircuit20Regular, text: t('chat.turn.thinkingActive') };
  }
  const refTool = executing[executing.length - 1] as ToolCall;
  const allSameType = executing.every(tc => _resolveToolName(tc as ToolCall) === _resolveToolName(refTool));
  if (allSameType) {
    const config = getToolConfig(refTool);
    return {
      icon: getToolIcon(refTool),
      text: config.aggregate!.executing.replace('{n}', String(executing.length)),
    };
  }
  return { icon: Wrench24Filled, text: t('chat.turn.executingSteps', { n: executing.length }) };
};

// 统一的分组标题生成：busy=存在未完成步骤，expanded 由调用方传入。
// 展开态只显示「已执行 x 个步骤（有完成项时）+ 当前状态」，不再重复正文摘要（思考预览/工具参数）
const getGroupTitleParts = (group: DisplayGroup, busy: boolean, expanded: boolean) => {
  const toolSteps = countToolSteps(group.items);
  const allToolCalls = group.items.flatMap(i => i.type === 'tool' ? i.toolCalls || [] : []);
  const phase = resolveGroupTitlePhase(group.items, streamingState.value.isStreaming);

  if (expanded) {
    if (busy) {
      const executing = executingCallsOf(group);
      const status = getActiveStatusParts(executing);
      const completedToolSteps = toolSteps - executing.length;
      const action = completedToolSteps > 0
        ? t('chat.turn.executedThenStatus', { m: completedToolSteps }).replace('{status}', status.text)
        : status.text;
      return { icon: status.icon, action, args: '' };
    }
    // 已结束：有工具显示工具步骤总数；纯思考显示思考态
    if (toolSteps > 0) {
      return { icon: Wrench24Filled, action: t('chat.turn.executedSteps', { n: toolSteps }), args: '' };
    }
    return { icon: BrainCircuit20Regular, action: t('chat.turn.thinkingDone'), args: '' };
  }

  // 收起态：工具执行中 → 工具动作/聚合文案 + 参数摘要
  if (phase === 'executing-tools') {
    const executing = executingCallsOf(group);
    const refTool = executing[executing.length - 1] as ToolCall;
    const allExecutingSameType = executing.every(tc => _resolveToolName(tc as ToolCall) === _resolveToolName(refTool));

    // 同类型多调用 → 聚合文案（n=全部调用数，沿用既有收起态口径）；单工具 → 动作 + 参数摘要
    if (allExecutingSameType && allToolCalls.length > 1) {
      const config = getToolConfig(refTool);
      return { icon: getToolIcon(refTool), action: config.aggregate!.executing.replace('{n}', String(allToolCalls.length)), args: '' };
    }
    if (allExecutingSameType && allToolCalls.length === 1) {
      const config = getToolConfig(refTool);
      return { icon: getToolIcon(refTool), action: config.text.executing, args: getArgsText(refTool) || '' };
    }
    return { icon: Wrench24Filled, action: t('chat.turn.executingSteps', { n: executing.length }), args: '' };
  }

  // 收起态：纯思考，或工具已完成、当前正在思考 → 思考摘要（只有这种时候才显示思考）
  if (phase === 'thinking') {
    const thinkItem = group.items.find(i => i.type === 'think' && i.source.state?.isThinking)
      ?? group.items.find(i => i.type === 'think');
    const isThinking = thinkItem?.source.state?.isThinking;
    return {
      icon: BrainCircuit20Regular,
      action: isThinking ? t('chat.turn.thinkingActive') : t('chat.turn.thinkingDone'),
      args: getThinkingPreview(thinkItem?.reasoningContent),
    };
  }

  // 收起 + 非忙碌 + 有工具：completed 聚合文案（等待下次响应的间隙/回合已结束），不显示思考
  const refTool = allToolCalls[allToolCalls.length - 1] as ToolCall;
  const allSameType = allToolCalls.every(tc => _resolveToolName(tc as ToolCall) === _resolveToolName(refTool));

  if (allSameType && allToolCalls.length > 1) {
    const config = getToolConfig(refTool);
    return { icon: getToolIcon(refTool), action: config.aggregate!.completed.replace('{n}', String(allToolCalls.length)), args: '' };
  }

  if (allSameType && allToolCalls.length === 1) {
    const config = getToolConfig(refTool);
    return { icon: getToolIcon(refTool), action: config.text.completed, args: getArgsText(refTool) || '' };
  }

  // 混合工具 — 通用图标
  return { icon: Wrench24Filled, action: t('chat.turn.executedSteps', { n: toolSteps }), args: '' };
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

// P5c：通知类回合（process_monitor/sub_agent）——数据保持 role='user' 不动，
// 渲染分流到 EventCard 时间卡片（压缩卡同款分隔线样式），不占用用户气泡容器。
// 判定统一走 utils/jobNotice（与后端 buildSource 的词表一一对应，有单测兜住）。
const isNotificationTurn = computed(() =>
  isJobNoticeSource(user.value?.source?.kind),
);

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
    (_match, prefix, provider, name, attrsStr) => {
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
 * 审批卡/询问卡为会话级全局卡（SessionCards.vue），不再挂回合（对齐 DSH：sessionId 唯一锚点）。
 */
const assistantMetadata = computed<Record<string, unknown> | null>(() => {
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
  return typeof modelName === "string" && modelName
    ? getModelDisplayName(modelName)
    : "unknown";
});

const displayName = computed(() => {
  return props.agentName || currentModelName.value;
});

const modelAvatarPath = computed(() => {
  const modelName = assistantMetadata.value?.modelName;
  if (typeof modelName !== "string" || !modelName) return undefined;
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

// ============================================
// 图片预览
// ============================================
const previewList = computed(() => {
  const files = userFiles.value || [];
  // 仅可内联的位图进入大图预览（svg/ico 等 image/* 前缀但不渲染的类型排除），
  // 绝对化后取原图 url（无缩略图路径时回退）
  return files
    .filter((f) => isVisionImageMediaType(f.type))
    .map((f) => toResourceUrl(f.url || f.previewUrl));
});

/**
 * 打开大图预览。
 * 按附件对象在「图片子集」里的位置取索引——不能直接用列表下标：
 * 同一条消息现在可以同时有图片和普通文件（类型限制已取消），
 * 用外层下标会让预览取错图、甚至越界。
 */
const handleImageClick = (file: FileAttachment) => {
  const images = (userFiles.value || []).filter((f) => isVisionImageMediaType(f.type));
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

.max-iterations-notice {
  margin-top: 12px;
}
</style>
