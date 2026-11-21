<template>
  <div data-gd-slot="message" class="turn-wrapper last:min-h-[60vh]"
    :class="{ 'turn-wrapper--last': isLast, 'animate-in': animateIn, 'turn-wrapper--no-cv': !contentVisibilityEnabled, 'turn-wrapper--eager-groups': !lazyGroupsEnabled }"
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
            <template v-if="isSystemMessage || isCoordinatorTurn">
              <div class="system-message-header">
                <Alert16Regular class="system-message-icon w-3.5 h-3.5" />
                <span class="system-message-label">{{ isCoordinatorTurn ? coordinatorLabel : systemMessageLabel }}</span>
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
              <BookOpen16Regular class="w-4 h-4" />
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
        <!-- 用户操作按钮：协调者消息不是人类输入，不提供复制/重新生成/删除/分支 -->
        <MessageActions v-if="!isCoordinatorTurn" :is-assistant="false" :is-last="false" :allow-generate="allowGenerate"
          :time-full="userTime.full" :time-friendly="userTime.firendly"
          @copy="emit('copy', userView)" @generate="emit('generate', props.turn)"
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
    <!-- Assistant 部分（有可渲染内容时） -->
    <!-- ============================================ -->
    <template v-if="hasAssistantDisplay">
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
                <MarkdownContent class="message-item__text markdown-text" :content="item.content || ''"
          :streaming="streamingState.isStreaming" />
              </template>
            </template>
            <div v-else class="process-group">
              <!-- 分组标题 -->
              <!-- text-sm（Tailwind v4 = 14px/20px 行盒）：原先的 text-[14px] 只给字号，
                   行盒继承 html{line-height:1.5} = 21px（奇数），图标居中余量会随容器奇偶变半像素 -->
              <div v-if="group.isCollapsible" class="process-group__header text-sm group"
                :class="{ 'gd-run-shimmer': isGroupBusy(groupIndex), 'text-(--gd-color-text-subtle)': !isGroupBusy(groupIndex) }"
                @click="toggleGroup(groupIndex, group)">
                <template v-for="(parts, _) in [getGroupTitleParts(group, isGroupBusy(groupIndex), isGroupExpanded(groupIndex, group))]" :key="_">
                  <!-- 图标盒 16px（偶数）：20px 行盒内居中余量 2px 整数；奇数盒会得到 X.5px 余量 -->
                  <span class="relative w-4 h-4 shrink-0 flex items-center justify-center">
                    <!-- <span class="block w-1 h-1 rounded-3xl bg-gray-400 dark:bg-gray-700/50" v-if="!isGroupBusy(groupIndex)"></span> -->
                    <component :is="parts.icon" v-if="!isGroupExpanded(groupIndex, group)"
                      v-bind="parts.icon === ThinkingIcon ? { active: isGroupBusy(groupIndex) } : {}"
                      class="group-header-icon absolute inset-0 w-4 h-4 transition-opacity duration-200 group-hover:opacity-0 text-(--gd-color-text-subtle)" />
                    <ChevronDown12Regular class="absolute inset-0 w-4 h-4 transition-all duration-200"
                      :class="isGroupExpanded(groupIndex, group) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
                      :style="isGroupExpanded(groupIndex, group) ? {} : { transform: 'rotate(-90deg)' }" />
                  </span>
                  <!-- 文字起点对齐内部行：图标 16px + ml-2（工具行/思考行同为 ml-2，标题不能短一档） -->
                  <span class="shrink-0 ml-2">{{ parts.action }}</span>
                  <!-- 文件类工具：文件名 chip（扩展名图标 + basename，hover 全路径）+ 目录串（次要色，优先截断） -->
                  <template v-if="parts.file">
                    <span class="group-file-chip inline-flex min-w-0 max-w-full items-center gap-1 ml-2"
                      :class="{ 'is-openable': canOpenGroupFile(parts) }"
                      v-tooltip="parts.file.fullPath" @click="onGroupFileClick(parts, $event)">
                      <img :src="getFileIcon(parts.file.fileName)" class="w-4 h-4 shrink-0" alt="" />
                      <span class="group-file-chip__name min-w-0 truncate text-(--gd-color-text)">{{ parts.file.fileName }}</span>
                    </span>
                    <span v-if="parts.file.dirPath" class="min-w-0 truncate ml-1.5 text-sm shrink-[2] text-(--gd-color-text-subtlest)"
                      v-tooltip="parts.file.fullPath">{{ parts.file.dirPath }}</span>
                  </template>
                  <!-- 其余工具：单行参数摘要 -->
                  <span v-else-if="parts.args" class="text-sm truncate ml-2"
                    :class="{ 'text-(--gd-color-text-subtle)': !isGroupBusy(groupIndex) }">{{ parts.args }}</span>
                </template>
              </div>
              <!-- 分组内容 -->
              <div class="process-group__collapsible"
                :class="{
                  'is-expanded': isGroupContentVisible(groupIndex, group),
                  'no-transition': isGroupInstant(group),
                }">
                <div class="process-group__body">
                  <div v-if="isGroupBodyMounted(groupIndex, group)" class="process-group__body-scroll space-y-2"
                    :class="{ 'py-2': group.isCollapsible, 'no-mask': !group.isCollapsible }">
                    <template v-for="item in group.items" :key="item.id">
                      <MessageThinkingSection v-if="item.type === 'think'"
                        :reasoning-content="item.reasoningContent || ''"
                        :is-thinking="item.source.state?.isThinking || false"
                        :thinking-duration-ms="item.source.thinkingDurationMs"
                        :thinking-started-at="item.source.thinkingStartedAt"
                        :persist-key="disclosureKeyOf(props.turn.id, item.id)" />
                      <MessageToolCalls v-if="item.type === 'tool'"
                        :tool-calls="item.toolCalls || []"
                        :tool-responses="item.toolResponses"
                        :is-streaming="streamingState.isStreaming" :session-id="props.sessionId"
                        :persist-key="disclosureKeyOf(props.turn.id, item.id)" />
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
      <!-- 错误提示（network_error 为新归一化原因；历史遗留的 terminated 裸错误走 errorAlertKind 兜底） -->
      <GdAlert v-if="errorAlertKind === 'network'" :title="t('chat.turn.networkError')" type="warning" class="mt-2">
        <div>{{ t('chat.turn.networkErrorHint') }}</div>
        <div v-if="assistantMetadata.errorDetail" class="mt-1 text-xs text-(--gd-color-text-gray)">
          {{ assistantMetadata.errorDetail }}
        </div>
      </GdAlert>

      <GdAlert v-else-if="assistantMetadata.finishReason === 'error'" :title="t('chat.turn.apiError')" type="error" class="mt-2">
        {{ assistantMetadata.errorDetail }}
      </GdAlert>

      <!-- 超时提示 -->
      <GdAlert v-if="assistantMetadata.finishReason === 'timeout'" :title="t('chat.turn.requestTimeout')"
        type="warning" class="mt-2">
        {{ assistantMetadata.errorDetail || t('chat.turn.serverNoResponse') }}
      </GdAlert>

      <!-- 限流提示（文字说明，无继续按钮——用户自行继续） -->
      <GdAlert v-if="assistantMetadata.finishReason === 'rate_limited'"
        :title="t('chat.turn.rateLimitedPaused')" type="warning" class="mt-2">
        {{ assistantMetadata.errorDetail || t('chat.turn.rateLimitedPaused') }}
      </GdAlert>

      <!-- 用户终止提示 -->
      <div v-if="assistantMetadata.finishReason === 'user_cancel'"
        class="mt-2 text-sm text-(--gd-color-text-gray)">
        {{ t('chat.turn.manuallyTerminated') }}
      </div>

      <!-- 中断收尾提示：冷加载/自愈把停在中断点的回合闭合（工具配对已补齐），
           而不是失败——用户需要知道"这条回复是被打断的，可以继续" -->
      <div v-if="assistantMetadata.finishReason === 'interrupted'"
        class="mt-2 text-sm text-(--gd-color-text-gray)">
        {{ t('chat.turn.interruptedRecovered') }}
      </div>
    </template>

    <!-- 操作按钮：移到门外、置于状态提示之后——控制条永远在最下方。
         控制条（复制/再生/编辑/删除/时间）不依赖 assistant 消息存在，流结束即显示；
         仅复制按钮与 assistant 消息相关（无消息时复制空内容即可）。 -->
    <MessageActions v-if="!streamingState.isStreaming" :is-assistant="true" :is-last="isLast"
      :allow-generate="false" :time-full="assistantTime.full" :time-friendly="assistantTime.firendly"
      :duration-ms="durationMs" :token-usage="tokenUsage" @copy="emit('copy', activeBlock)"
      @regenerate="emit('regenerate', props.turn)"
      @delete="emit('delete', props.turn)" @branch="emit('branch', props.turn)"
      :branching="branching" :branch-disabled="branchDisabled" />

    <!-- 流式期间：思考中（点阵动画 + 轮播文案）/ 重试中状态（retry 为回合级瞬态 turn.state.retry，不落库） -->
    <div v-if="streamingState.isStreaming" class="mt-5 flex items-center gap-2 text-xs text-gray-400">
      <span v-if="retryState" class="text-amber-500 dark:text-amber-400">{{ retryState.message }}</span>
      <ThinkingStatus v-else :duration-text="durationText" />
    </div>
    <!-- 图片预览 -->
    <GdImageViewer :visible="showImageViewer" :urls="previewList"
      :initial-index="currentPreViewIndex" @update:visible="showImageViewer = $event" @close="showImageViewer = false" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, nextTick, onBeforeUnmount, inject, type Component } from "vue";
import { useI18n } from "vue-i18n";
import { Alert16Regular, ChevronDown12Regular, BookOpen16Regular } from "@vicons/fluent";
import { ToolGenericIcon } from '@/components/icons/toolIcons';
import ThinkingIcon from '@/components/icons/ThinkingIcon.vue';
import { FileItem, Avatar } from "../ui";
import { formatTime } from '../../utils';
import { toResourceUrl } from '../../utils/url';
import { isVisionImageMediaType } from '@/utils/media-type';
import { groupContentsForDisplay, hasVisibleText, type DisplayGroup, type DisplayItem, toUserMessageView, collectReferencedKbs } from '@/utils/messageUtils';
import type { Turn, MessageContent, TurnContent, FileAttachment } from '@/types/message';
import { getToolConfig, getToolIcon, resolveToolName as _resolveToolName, getArgsText, getArgsDisplay, hasToolAggregate, type ToolCall } from '@/utils/toolDisplay';
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
import { isHiddenBlock, isCoordinatorMessage, getThinkingPreview, formatDuration as formatThinkingDuration } from '@/utils/messageUtils';
import { isJobNoticeSource, isInTurnJobNoticeBundle } from '@/utils/jobNotice';
import { previewFile } from '@/utils/workspacePreview';
import { getToolFileOpenTarget } from '@/utils/toolWorkspace';
import type { FilePathDisplay } from '@/utils/pathDisplay';
import { resolveGroupExpanded, nextGroupExpandOverride, hasUnfinishedSteps, isToolCallExecuting, resolveGroupTitlePhase, estimateGroupLines, shouldMountGroupBody, type GroupExpandOverrides } from './groupExpansion';
import { disclosureKey, getDisclosure, setDisclosure } from '@/utils/disclosureState';
import { getFileIcon } from '@/composables/useFileIcon';
import { perfCount } from '@/utils/perf';

const { t } = useI18n();

/**
 * 离屏回合是否跳过布局/绘制（content-visibility: auto）。
 *
 * 默认开启；`localStorage['gd:turn-cv']='0'` 后刷新可关闭做 A/B 对照
 * （与 gd:lazy-turns 同一套约定）。模块级求值一次——这是构建期开关，
 * 不需要响应式，避免每个回合实例各读一次 localStorage。
 */
const contentVisibilityEnabled = (() => {
  try {
    return localStorage.getItem('gd:turn-cv') !== '0';
  } catch {
    return true;
  }
})();

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

/** 本回合是否是主代理投递的协调者回合（真实回合，但非人类输入） */
const isCoordinatorTurn = computed(() => isCoordinatorMessage(user.value));
/** 协调者回合的标题文案 */
const coordinatorLabel = computed(() => t('chat.turn.coordinatorGuidance', '主代理补充指令'));

/** 回合内事件束：event 角色消息 + 工具边界注入的作业完成通知（role='user'，非回合头）。
 *  排除 user 头（通知头回合的 user 就是通知本身，已由 isNotificationTurn 分支渲染，避免双重）。 */
const events = computed(
  () =>
    props.turn.messages?.filter(
      (m) => m.role === 'event' || (m !== user.value && isInTurnJobNoticeBundle(m)),
    ) ?? [],
);
/**
 * 被 Core Stream Recovery 丢弃的 attempt：只进审计/日志，不进展示流。
 * 实时路径由 finish(stream_recovery_discarded) 打标，历史路径读 assistant metadata。
 */
const isDiscardedBundle = (m: {
  metadata?: Record<string, any>;
}): boolean =>
  m.metadata?.excludedFromContext === true ||
  m.metadata?.streamRecovery?.discarded === true ||
  m.metadata?.streamRecoveryDiscarded === true;
const activeBlocks = computed(() => {
  const msgs = props.turn.messages?.filter(
    (m) => m.role !== 'user' && m.role !== 'event' && !isDiscardedBundle(m),
  ) ?? [];
  // 引用收集（flatMap 不复制块），供 displayGroups/useFileChanges 等按块消费的派生层
  return msgs.flatMap((m) => m.blocks);
});

// ============================================
// 内部状态
// ============================================
const showImageViewer = ref(false);
const currentPreViewIndex = ref(0);

/** 本回合某个分组的稳定键（跨卸载保持） */
const groupKeyOf = (groupId: string): string => disclosureKey(props.turn.id, groupId);

/** 传给子组件的行级键（工具行 / 思考框共用） */
const disclosureKeyOf = (turnId: string, localId: string): string =>
  disclosureKey(turnId, localId);

/**
 * 分组展开状态的显式覆盖（group.id -> 是否展开，仅用户点击时写入）。
 *
 * 状态存在模块级表里（disclosureState），不放在本组件：回合会被 ChatPanel 的有界窗口
 * 回收成占位，组件卸载后本地 ref 会丢，表现为「展开分组 → 滚远 → 滚回来又收起」。
 * 键带 turnId 前缀，回合删除时可整批清理。
 *
 * 缺省不落状态：由 isGroupExpanded 按运行态派生——流式中的最后一组展开、其余收起。
 */
/** 覆盖表视图：只读 get，避免把整张表交给渲染层 */
const groupExpandOverrides = computed<GroupExpandOverrides>(() => ({
  get: (key: string) => getDisclosure(key),
}));

const isGroupExpanded = (groupIndex: number, group: DisplayGroup): boolean => {
  return resolveGroupExpanded(
    groupExpandOverrides.value,
    groupKeyOf(group.id),
    isLastActive(groupIndex),
  );
};

// ── 折叠组：收起态不挂载子树 ──────────────────────────────────────
/* 旧实现只加 `content-visibility: hidden`：省的是布局与绘制，组件实例、响应式订阅与
   DOM 都还在（实测一个会话 62 个折叠组、内部 2378 个节点）。长会话里这些节点会让
   一次全量布局（窗口最大化/还原）变贵，因此收起态直接不挂载。
   收起动画期间必须保留挂载，否则 0fr 没有可裁剪的内容、动画会当场塌掉。
   A/B 开关：localStorage['gd:lazy-groups']='0' 关闭（回到「常驻挂载」旧行为）。 */

/** 延迟挂载开关（模块级求值一次，与 gd:lazy-turns / gd:turn-cv 同一套约定） */
const lazyGroupsEnabled = (() => {
  try {
    return localStorage.getItem('gd:lazy-groups') !== '0';
  } catch {
    return true;
  }
})();

/** 过渡时长（与 CSS 的 grid-template-rows 保持一致） */
const GROUP_EXPAND_ANIMATION_MS = 150;
/** 动画期额外余量：后台标签页的 transitionend/合成器提交可能晚于过渡时长 */
const ANIMATION_SETTLE_MS = 60;
/** 估算行数超过该值就瞬时展开：大分组正是动画收益最低、单帧最贵的那类 */
const INSTANT_EXPAND_ESTIMATE_LINES = 60;

/** 大分组不播动画（展开和收起都瞬时，行为一致且可预期） */
const isGroupInstant = (group: DisplayGroup): boolean =>
  group.isCollapsible && estimateGroupLines(group.items) > INSTANT_EXPAND_ESTIMATE_LINES;

/**
 * 正在播放展开/收起动画的分组：这段时间内内容必须保持挂载，
 * 动画结束后（GROUP_EXPAND_ANIMATION_MS + 余量）才允许卸载。
 * 语义对齐 zcode 的 TOOL_CONTENT_COLLAPSE_UNMOUNT_DELAY_MS：先让高度动画走完，再摘子树。
 */
const animatingGroupIds = ref<Set<string>>(new Set());
const animatingTimers = new Map<string, ReturnType<typeof setTimeout>>();

function markGroupAnimating(groupId: string): void {
  const next = new Set(animatingGroupIds.value);
  next.add(groupId);
  animatingGroupIds.value = next;
  const prev = animatingTimers.get(groupId);
  if (prev !== undefined) clearTimeout(prev);
  animatingTimers.set(groupId, setTimeout(() => {
    animatingTimers.delete(groupId);
    if (!animatingGroupIds.value.has(groupId)) return;
    const rest = new Set(animatingGroupIds.value);
    rest.delete(groupId);
    animatingGroupIds.value = rest;
  }, GROUP_EXPAND_ANIMATION_MS + ANIMATION_SETTLE_MS));
}

onBeforeUnmount(() => {
  for (const timer of animatingTimers.values()) clearTimeout(timer);
  animatingTimers.clear();
});

/** 分组 body 的子树是否挂载（收起且不在动画中 → 不挂载） */
const isGroupBodyMounted = (groupIndex: number, group: DisplayGroup): boolean => {
  if (!lazyGroupsEnabled) return true;
  return shouldMountGroupBody({
    isCollapsible: group.isCollapsible,
    isExpanded: isGroupContentVisible(groupIndex, group),
    isAnimating: animatingGroupIds.value.has(group.id),
  });
};

const toggleGroup = (groupIndex: number, group: DisplayGroup) => {
  const active = isLastActive(groupIndex);
  const key = groupKeyOf(group.id);
  const next = nextGroupExpandOverride(groupExpandOverrides.value, key, active);
  setDisclosure(key, next);
  // 收起时必须让内容多留一会儿：动画结束前摘掉子树，0fr 会当场塌掉。
  // 展开不需要（内容本来就要挂载）。
  if (!next && !isGroupInstant(group)) markGroupAnimating(group.id);
  // 归因：点击次数 vs ChatPanel 的 chat.contentResize（每次尺寸变化 = 一帧重排）
  perfCount('turn.expand');
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

/**
 * 聚合模板安全替换：只有模板里真的含 {n} 才替换。
 * 插件只配 text、未配 aggregate 时，兜底模板可能不含占位符（如「正在执行个步骤」），
 * 此时返回 null，由调用方回落到通用步骤文案。
 */
const formatAggregateText = (template: string | undefined, n: number): string | null =>
  template?.includes('{n}') ? template.replace('{n}', String(n)) : null;

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
    if (hasVisibleText(b.content)) return b;
  }
  return list[list.length - 1];
});

const displayGroups = computed<DisplayGroup[]>(() => {
  return groupContentsForDisplay(activeContents.value);
});

/**
 * assistant 区是否有可渲染内容。
 *
 * 用分组结果而不是 activeBlocks.length 判定：上游会在正文前注入只含空格的
 * message item（GPT6 每轮都有），它会被 flattenSingleContent 过滤掉、不产生任何
 * 分组；若仍按块数开门，就会留下一个只有头像和空卡片的 assistant 区。
 */
const hasAssistantDisplay = computed(() => displayGroups.value.length > 0);

// 文件变更记录
const { fileChanges } = useFileChanges(activeContents);

const layoutStore = useLayoutStore();
const tabStore = useTabStore();

/** ChatPage provide；无工作区侧边栏的宿主（Bot 会话面板等）下为 null → 文件名不可点 */
const openWorkspaceFile = inject<((filePath: string) => void) | null>(
  'workspace:openFile',
  null,
);

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

// 流式贴底由外层 ScrollContainer/useScrollAnchor 的 ResizeObserver 负责（高度信号）；
// 本组件内容区没有独立滚动盒（max-height 已取消），不再本地 follow。

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
    return { icon: ThinkingIcon, text: t('chat.turn.thinkingActive') };
  }
  const refTool = executing[executing.length - 1] as ToolCall;
  const allSameType = executing.every(tc => _resolveToolName(tc as ToolCall) === _resolveToolName(refTool));
  if (allSameType) {
    const config = getToolConfig(refTool);
    const aggregateText = formatAggregateText(config.aggregate?.executing, executing.length);
    // 插件声明了带 {n} 的聚合模板时，即使只有 1 个也显示带数量的文案
    // （如「正在执行1条命令」「正在读取1个文件」）；未声明聚合的工具保留自己的
    // 动作文案（如 job_read 的「正在读取作业输出」），避免落到通用兜底「正在执行1个步骤」。
    // 多个执行中工具则优先聚合/通用步骤数。思考不走这里（executing 为空 → 正在思考…）。
    const text = executing.length > 1
      ? (aggregateText || t('chat.turn.executingSteps', { n: executing.length }))
      : ((hasToolAggregate(refTool) ? aggregateText : '')
        || config.text.executing
        || aggregateText
        || t('chat.turn.executingSteps', { n: 1 }));
    return { icon: getToolIcon(refTool), text };
  }
  return { icon: ToolGenericIcon, text: t('chat.turn.executingSteps', { n: executing.length }) };
};

/**
 * 分组内思考时长文案（多段思考按块级 timing 累加）。
 * 权威时长由 reasoning block_end 派生，未到时返回空串——标题只显示「已思考」，
 * 不补近似值（避免与 block_end 的累加逻辑冲突）。
 */
const thinkingDurationText = (group: DisplayGroup): string => {
  let totalMs = 0;
  for (const item of group.items) {
    if (item.type === 'think') totalMs += item.source.thinkingDurationMs ?? 0;
  }
  return totalMs > 0 ? formatThinkingDuration(totalMs) : '';
};

/** 分组标题展示片段；fileTool/fileOpenable 供收起态文件名打开工作区文件 */
interface GroupTitleParts {
  icon: Component;
  action: string;
  args: string;
  file?: FilePathDisplay | null;
  fileTool?: ToolCall;
  fileOpenable?: boolean;
}

// 统一的分组标题生成：busy=存在未完成步骤，expanded 由调用方传入。
// 展开态只显示「已执行 x 个步骤（有完成项时）+ 当前状态」，不再重复正文摘要（思考预览/工具参数）
const getGroupTitleParts = (group: DisplayGroup, busy: boolean, expanded: boolean): GroupTitleParts => {
  const toolSteps = countToolSteps(group.items);
  const allToolCalls = group.items.flatMap(i => i.type === 'tool' ? i.toolCalls || [] : []);
  const phase = resolveGroupTitlePhase(group.items, streamingState.value.isStreaming);

  if (expanded) {
    if (busy) {
      const executing = executingCallsOf(group);
      const status = getActiveStatusParts(executing);
      const completedToolSteps = toolSteps - executing.length;
      // 状态段为空时只保留已执行前缀，绝不拼出「已执行N个步骤,」这种悬空分隔符。
      // 注意：status 必须作为插值参数传给 t()——vue-i18n 会把未传值的 {status}
      // 插成空串（模板只剩逗号），事后 .replace('{status}', …) 是找不到占位符的。
      const fallback = completedToolSteps > 0
        ? t('chat.turn.executedSteps', { n: completedToolSteps })
        : t('chat.turn.executingSteps', { n: Math.max(executing.length, 1) });
      const action = status.text
        ? (completedToolSteps > 0
          ? t('chat.turn.executedThenStatus', { m: completedToolSteps, status: status.text })
          : status.text)
        : fallback;
      return { icon: status.icon, action, args: '' };
    }
    // 已结束：有工具显示工具步骤总数；纯思考显示思考态
    if (toolSteps > 0) {
      return { icon: ToolGenericIcon, action: t('chat.turn.executedSteps', { n: toolSteps }), args: '' };
    }
    return { icon: ThinkingIcon, action: t('chat.turn.thinkingDone'), args: '' };
  }

  // 收起态：工具执行中 → 工具动作/聚合文案 + 参数摘要
  if (phase === 'executing-tools') {
    const executing = executingCallsOf(group);
    const refTool = executing[executing.length - 1] as ToolCall;
    const allExecutingSameType = executing.every(tc => _resolveToolName(tc as ToolCall) === _resolveToolName(refTool));

    // 同类型多调用 → 聚合文案（n=全部调用数，沿用既有收起态口径）；单工具 → 动作 + 参数摘要
    if (allExecutingSameType && allToolCalls.length > 1) {
      const config = getToolConfig(refTool);
      return {
        icon: getToolIcon(refTool),
        action: formatAggregateText(config.aggregate?.executing, allToolCalls.length)
          ?? t('chat.turn.executingSteps', { n: allToolCalls.length }),
        args: '',
      };
    }
    if (allExecutingSameType && allToolCalls.length === 1) {
      const config = getToolConfig(refTool);
      return {
        icon: getToolIcon(refTool),
        action: config.text.executing || t('chat.turn.executingSteps', { n: 1 }),
        args: getArgsText(refTool) || '',
        file: getArgsDisplay(refTool)?.file ?? null,
        fileTool: refTool,
        fileOpenable: false,
      };
    }
    return { icon: ToolGenericIcon, action: t('chat.turn.executingSteps', { n: executing.length }), args: '' };
  }

  // 收起态：纯思考，或工具已完成、当前正在思考 → 思考态（只有这种时候才显示思考）
  if (phase === 'thinking') {
    const thinkItem = group.items.find(i => i.type === 'think' && i.source.state?.isThinking)
      ?? group.items.find(i => i.type === 'think');
    const isThinking = thinkItem?.source.state?.isThinking;
    return {
      icon: ThinkingIcon,
      action: isThinking ? t('chat.turn.thinkingActive') : t('chat.turn.thinkingDone'),
      // 思考中实时跟最后一行摘要；结束后只显示时长，不再透出内容
      args: isThinking ? getThinkingPreview(thinkItem?.reasoningContent) : thinkingDurationText(group),
    };
  }

  // 收起 + 非忙碌 + 有工具：completed 聚合文案（等待下次响应的间隙/回合已结束），不显示思考
  const refTool = allToolCalls[allToolCalls.length - 1] as ToolCall;
  const allSameType = allToolCalls.every(tc => _resolveToolName(tc as ToolCall) === _resolveToolName(refTool));

  if (allSameType && allToolCalls.length > 1) {
    const config = getToolConfig(refTool);
    return {
      icon: getToolIcon(refTool),
      action: formatAggregateText(config.aggregate?.completed, allToolCalls.length)
        ?? t('chat.turn.executedSteps', { n: allToolCalls.length }),
      args: '',
    };
  }

  if (allSameType && allToolCalls.length === 1) {
    const config = getToolConfig(refTool);
    return {
      icon: getToolIcon(refTool),
      action: config.text.completed || t('chat.turn.executedSteps', { n: 1 }),
      args: getArgsText(refTool) || '',
      file: getArgsDisplay(refTool)?.file ?? null,
      fileTool: refTool,
      fileOpenable: true,
    };
  }

  // 混合工具 — 通用图标
  return { icon: ToolGenericIcon, action: t('chat.turn.executedSteps', { n: toolSteps }), args: '' };
};

/** 收起态分组标题文件名：可打开时阻止冒泡开预览，否则让点击展开分组 */
const canOpenGroupFile = (parts: GroupTitleParts): boolean =>
  !!parts.fileOpenable &&
  !!parts.fileTool &&
  !!openWorkspaceFile &&
  !!getToolFileOpenTarget(parts.fileTool);

const onGroupFileClick = (parts: GroupTitleParts, event: MouseEvent): void => {
  if (!parts.fileOpenable || !parts.fileTool || !openWorkspaceFile) return;
  const target = getToolFileOpenTarget(parts.fileTool);
  if (!target) return;
  event.stopPropagation();
  openWorkspaceFile(target.path);
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

/** metadata.type 的旧系统消息词表；bot/bot-admin 等来源不应命中（它们只是消息来源标识） */
const SYSTEM_MESSAGE_TYPES = new Set(['scheduler', 'sub_agent', 'system']);

const isSystemMessage = computed(() => {
  const type = user.value?.metadata?.type;
  return typeof type === 'string' && SYSTEM_MESSAGE_TYPES.has(type);
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
      return `<span data-type="command" data-provider-id="${provider}" data-name="${name}" data-label="${attrs.label || ''}" data-trigger="${prefix}"${dataAttrs} class="command-badge" style="color: var(--gd-color-primary);">${displayText}</span>`;
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

// 错误卡片形态：网络中断类（新 finishReason=network_error，或历史遗留的裸传输错误
// errorDetail="terminated"/UND_ERR_*）显示友好提示，其余走通用 API 错误卡
const errorAlertKind = computed<"network" | "generic">(() => {
  const meta = assistantMetadata.value;
  if (!meta) return "generic";
  if (meta.finishReason === "network_error") return "network";
  const detail = String(meta.errorDetail ?? "");
  return /^terminated$|^fetch failed$|ECONNRESET|UND_ERR_SOCKET/i.test(detail)
    ? "network"
    : "generic";
});

const streamingState = computed(() => ({
  // 回合级工作态：turn_start 置位、turn_end 复位（turn.state.isWorking，
  // 纯前端瞬态视图态）。历史加载的回合无此字段 = 非工作态。
  isStreaming: props.turn?.state?.isWorking ?? false,
}));

// LLM 流重试瞬态（回合级 turn.state.retry，retry 事件标记，重试成功输出/turn_end 清除）
const retryState = computed<{
  message?: string;
  attempt?: string;
  source?: string;
} | null>(() => {
  const retry = props.turn?.state?.retry;
  if (!retry) return null;
  const sourceLabel =
    retry.retrySource === 'stream_recovery'
      ? '流中断恢复'
      : retry.retrySource === 'output_continuation'
        ? '继续生成'
        : retry.retrySource === 'transport'
          ? '网络重试'
          : '重试';
  const attempt = `${retry.retryAttempt}/${retry.retryMaxAttempts}`;
  return {
    message:
      retry.message ||
      `${sourceLabel}，正在重试 ${attempt}...`,
    attempt,
    source: retry.retrySource,
  };
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
    if (isDiscardedBundle(m)) continue;
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
  /* 离屏回合跳过布局与绘制 —— **只在拖拽/缩放期间生效**（见文件末尾的 gd-resizing 规则）。
     ------------------------------------------------------------------
     为什么不是常驻：`content-visibility: auto` 下，向上滚动经过「从未渲染过」的回合时，
     它们按 `contain-intrinsic-size` 的估算值参与布局（本应用回合中位数 ~1700px），
     真正进入视口后撑开，把视口里的内容整体顶走 —— 表现为向上滚动时内容跳动。
     实测（40 个约 1700px 的回合，滚到底后向上滚 3000px）：
       - 无 content-visibility：scrollHeight 恒定 3556，零跳动；
       - 固定 800px 估算：scrollHeight 19297 → 6554（变化 12743px）；
       - `auto 800px`：与固定估算完全相同（19297 → 6554）。
     `auto` 关键字只能让「渲染过」的元素记住真实尺寸，对从未渲染的元素无效，
     因此无法解决向上滚动场景。

     为什么拖拽期间可以：拖拽分割条/缩放窗口时用户不会同时滚动，估算值不会被看到；
     而这些操作恰恰是「每帧重绘视口外内容」代价最贵的时刻。把降级限定在那一刻，
     既拿到性能收益，又完全避开滚动跳动。

     实现见本文件末尾的 `html.gd-resizing .turn-wrapper` 规则。 */
  box-sizing: content-box;
  padding-inline: 4px;
  margin-inline: -4px;
  transition: opacity 0.3s ease;
}

.turn-wrapper.animate-in {
  animation: turn-enter 0.4s cubic-bezier(0.22, 1, 0.36, 1);
}

/* 拖拽/缩放**真正产生位移**后：视口外回合跳过布局与绘制。
   ------------------------------------------------------------------
   devtools trace 实测拖拽分割条时，聊天滚动内容的绘制区高度是视口的 3.8 倍
   （1129×5312，视口 1392），Paint 中位 8.5ms/帧，是帧预算里最大的单项，
   且成本随会话长度线性增长。降级后视口外回合不再参与绘制。

   **两个前提，缺一不可**：

   1. **必须挂 gd-resizing-moved，不能挂 gd-resizing**。
      cv 会改变布局高度，若在 pointerdown 就启用，用户只是按住还没拖动时内容就会塌陷。
      实测按住不动一圈 40 回合（每个真实高度约 1486px）：
        scrollHeight 60245 → 35469（少 24776px），可见内容整轮后退。

   2. **必须由 turnHeightFreeze 预先冻结每个回合的真实高度**（写内联
      contain-intrinsic-size，见 composables/turnHeightFreeze.ts）。
      cv 隐含 `contain: layout`，会阻止子元素 margin 折叠出父元素——即使不改宽度，
      同一个回合在 cv 开/关两态下高度也不同。实测 40 回合：
        只挂 cv：scrollHeight 20728 → 30562（涨 9834px），可见内容跳走
        先冻结再挂 cv：heightDelta = 0、可见回合与滚动位置都不变
      代价是一次全量读高度（300 回合约 1.3ms），只在手势产生位移时执行一次。

   为什么用固定估算作兜底而非 `auto`：`auto` 只对「cv 生效期间渲染过」的元素记忆
   尺寸，首次进入 cv 状态时无效；内联冻结值优先于此处的 800px，此值只服务于
   拖拽期间新挂载的回合。

   A/B 对照：localStorage['gd:turn-cv']='0' 时 .turn-wrapper--no-cv 命中 :not() 被排除。 */
html.gd-resizing-moved .turn-wrapper:not(.turn-wrapper--no-cv) {
  content-visibility: auto;
  contain-intrinsic-size: 800px;
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
  color: var(--gd-color-warning);
}

.system-message-label {
  font-size: 12px;
  color: var(--gd-color-text-gray);
  font-weight: 500;
}

.system-message-divider {
  height: 1px;
  background-color: var(--gd-color-border);
  margin: 8px 0;
}

.system-message-body {
  font-size: 14px;
  color: var(--gd-color-text);
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
  /* 只过渡文字色：过渡背景会在扫光类移除时把整行背景从实色淡出造成闪底 */
  transition: color 0.2s ease;
  user-select: none;
}

:deep(.process-group__body .process-section:last-child .process-timeline) {
  display: none;
}

/* 行悬停高亮：整行文字提亮（text-fill 可继承，子文本随之变亮）。
   忙碌态由 gd-run-shimmer 自身声明透明填充，波纹不受影响，故排除该状态。 */
.process-group__header:not(.gd-run-shimmer):hover {
  color: var(--gd-color-text);
  -webkit-text-fill-color: var(--gd-color-text);
}

.process-group__header:not(.gd-run-shimmer):hover .group-header-icon {
  color: var(--gd-color-text);
}

/* grid-template-rows 是布局属性，过渡期间每帧都要重排到滚动容器：300ms/60Hz ≈ 18 帧。
   收到 150ms（≈9 帧）；更大的分组交给 .no-transition 直接瞬时，别为动画付逐帧重排。 */
.process-group__collapsible {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.15s cubic-bezier(0.4, 0, 0.2, 1);
}

.process-group__collapsible.is-expanded {
  grid-template-rows: 1fr;
}

/* 大分组瞬时展开/收起：单帧重排代价与内容体积成正比，逐帧动画收益趋零 */
.process-group__collapsible.no-transition {
  transition: none;
}

.process-group__body {
  min-height: 0;
  overflow: hidden;
}

/* 折叠态不再需要 content-visibility：内容本身已经不挂载（isGroupBodyMounted）。
   这条规则只在 A/B 开关（gd:lazy-groups=0）关闭延迟挂载时生效——那时子树常驻，
   仍需让它退出布局与绘制。
   这里不加 contain：body 已经 overflow:hidden，再加 contain 只会给子卡片弹层新增包含块。 */
.turn-wrapper--eager-groups .process-group__body {
  content-visibility: hidden;
}

.turn-wrapper--eager-groups .process-group__collapsible.is-expanded .process-group__body {
  content-visibility: visible;
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
/* 收起态分组标题：仅本地、已完成工具的文件名可点；hover 用主题色 + 下划线提示 */
.group-file-chip.is-openable {
  cursor: pointer;
}

.group-file-chip.is-openable:hover .group-file-chip__name {
  color: var(--gd-color-primary);
  text-decoration: underline;
  text-underline-offset: 2px;
}
</style>
