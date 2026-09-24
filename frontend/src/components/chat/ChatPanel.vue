<template>
  <!-- 消息+输入 区域容器 -->
  <div class="flex-1 overflow-hidden w-full relative">
    <ScrollContainer ref="scrollContainerRef" class="h-full chat-scroll-container transition-opacity duration-300 px-5"
      :auto-scroll="needScrollToBottom" @scroll="handleScroll">
      <!-- 消息行：flex row（消息列 + 避让占位列）；占位在滚动内容右端 = 滚动条左侧 -->
      <div class="scroll-inner">
        <div class="scroll-main">
          <!-- 初始加载时的骨架屏：仅在消息为空时显示 -->
          <div class="chat-messages chat-column w-full mx-auto pt-5 pb-5 flex-1">
            <template v-if="showSkeleton">
              <div class="absolute inset-0 z-1 overflow-hidden">
                <div class="px-5 chat-column mx-auto h-full flex flex-col py-10 ">
                  <MessageSkeleton :count="2" />
                </div>
              </div>
            </template>
            <template v-else>
              <template v-if="currentSessionId && activeTurns.length === 0 && currentSession?.agent">
                <!-- 欢迎页 -->
                <WelcomeScreen :session="currentSession" class="flex-1" />
              </template>
              <template v-else>
                <!-- 加载更多历史消息指示器 -->
                <Transition name="fade-slide">
                  <div v-if="isLoadingMore" class="w-full py-4 flex items-center justify-center text-gray-400">
                    <el-icon class="is-loading mr-2" size="16">
                      <LoadingOutlined />
                    </el-icon>
                    <span class="text-xs">{{ t('chat.panel.loadingHistory') }}</span>
                  </div>
                </Transition>

                <!-- 没有更多消息提示 -->
                <Transition name="fade-slide">
                  <div v-if="!isLoadingMore && !hasMoreMessages && activeTurns.length > MESSAGES_PAGE_SIZE"
                    class="w-full py-4 text-center text-gray-400 text-xs">
                    {{ t('chat.panel.noMoreMessages') }}
                  </div>
                </Transition>

                <template v-for="(turn, index) in visibleTurns" :key="turn.id">
                  <!-- 事件类消息外壳（turn.kind='event'，compaction/command 等）：渲染专门事件卡片 -->
                  <EventCard v-if="turn.kind === 'event'" :event="turn" />
                  <TurnItem v-else :class="{ 'opacity-0': showSkeleton, 'opacity-100': !showSkeleton }"
                    :turn="turn" :avatar="userAvater"
                    :agent-name="currentSession?.agent?.name"
                    :agent-avatar="currentSession?.agent?.avatarUrl" :is-last="index === visibleTurns.length - 1"
                    :allow-generate="!isStreaming && index === lastUserMessageIndex"
                    :animate-in="animateIds.includes(turn.id)" @delete="deleteTurnMessage" @edit="editMessage"
                    @copy="copyMessage" @generate="generateResponse" @regenerate="regenerateResponse"
                    @branch="branchFromTurn"
                    :session-id="currentSessionId || undefined" />                </template>
                <!-- <div class="min-h-60"></div> -->

                <!-- 流式输出状态指示 -->
              </template>
            </template>
          </div>
          <!-- 输入区域：sticky 底部；放入 scroll-main（消息列统一避让，不再独立占位）。
               只读模式（子代理会话）仍渲染：输入区承载停止按钮（流式时可停），
               内部功能（编辑器/配置入口/发送）由 ChatInput 的 readonly 禁用矩阵收口。 -->
          <div class="chat-input-area sticky bottom-0 left-0 right-0 z-30 pb-2" style="margin-top: auto;">
            <!-- 底部渐变遮罩：输入区上方（滚动区底部）；宽=输入区(=scroll-main 避让) -->
            <div v-if="!hasWallpaper" class="chat-bottom-fade chat-column mx-auto"></div>
            <div class="chat-column mx-auto flex flex-col items-start relative" style="z-index: 1;">

              <!-- 排队消息抽屉：比输入框窄，避开圆角，微透明毛玻璃 -->
              <Transition name="queue-drawer">
                <div v-if="queueLength > 0"
                  class="queue-drawer bg-(--gd-color-surface)/80 backdrop-blur-xl rounded-(--gd-size-dialog-rounded-radius) w-[calc(100%-48px)] margin-auto px-0.5 py-0.5 border-radius-6px mx-auto mb-2">
                  <QueuedMessages :queue="messageQueue" @edit="handleEditQueued" @remove="handleRemoveQueued" />
                </div>
              </Transition>

              <!-- 会话级全局卡：审批卡 / 暂停卡（对齐 DSH：sessionId 唯一锚点，不挂回合） -->
              <SessionCards :session-id="currentSessionId || undefined" />

              <!-- 编辑模式提示条 -->
              <div v-if="editMode" class="max-w-full w-full flex px-4">
                <div
                  class="max-w-full w-full flex items-center px-4 py-1.5 rounded-tl-xl rounded-tr-xl bg-(--gd-color-sidebar-bg-active) backdrop-blur-xl">
                  <span class="flex-1 text-sm mr-10 text-gray-700 dark:text-[#c5c7cc]">{{ t('chat.panel.editingMessage')
                    }}</span>
                  <el-button size="small" @click="exitEditMode" class="cancel-edit-btn" plain>
                    {{ t('common.cancel') }}
                  </el-button>
                </div>
              </div>

              <!-- 输入区上方状态行：TODO 胶囊 + 回到底部，并排居中。
                   绝对定位浮层，不占布局高度（见 .composer-status-row 样式注释）。
                   位于避让过侧边栏的 .chat-column 内 → 开侧边栏时与输入框同轴居中。 -->
              <div class="composer-status-row">
                <FloatingTodoBar :session-id="currentSessionId || undefined" />
                <!-- 0 宽插槽：按钮在插槽内绝对定位，插槽本身不占宽度。
                     行的居中因此只由胶囊决定 → 按钮出现/消失（到达或离开底部）不再把胶囊横移
                     （实测 18px：胶囊与图标一起跳，与"到底部时图标动了"的现象一致）。 -->
                <div class="scroll-btn-slot">
                  <ScrollToBottomButton :show="showScrollToBottomBtn" @click="handleScrollToBottomClick" />
                </div>
              </div>

              <div class="w-full flex items-center relative">

                <ChatInput ref="chatInputRef" v-model:value="inputMessage.content" v-model:files="inputMessage.files"
                  :session-id="effectiveSessionId" :agent-id="props.session?.agentId || ''"
                  :config="chatInputConfig" :streaming="isStreaming" :readonly="readonly" mode="chat"
                  :uploader="chatAttachmentUploader"
                  :backdrop="hasWallpaper" @config-change="handleConfigChange" @send="handleSendMessage"
                  @abort="abortResponse">
                  <template #right-actions-before>
                    <!-- 上下文使用率：圆形进度条 -->
                    <GdTooltip :content="contextTooltip" placement="top">
                      <button ref="contextRingRef" class="context-ring-btn"
                        :class="{ 'is-open': memoPanelVisible }" @click.stop="toggleMemoPanel">
                        <svg class="context-ring" width="16" height="16" viewBox="0 0 36 36">
                          <circle class="ring-bg" cx="18" cy="18" r="15" fill="none" stroke-width="3.5" />
                          <circle class="ring-fg" cx="18" cy="18" r="15" fill="none" stroke-width="3.5" :stroke="ringColor"
                            :stroke-dasharray="ringCircumference" :stroke-dashoffset="ringDashOffset" stroke-linecap="round"
                            transform="rotate(-90 18 18)" />
                        </svg>
                      </button>
                    </GdTooltip>
                  </template>
                </ChatInput>
              </div>

              <!-- 工作目录条：输入框底部外侧（边框容器外）；只读（子代理）不渲染 -->
              <WorkingDirBar v-if="!props.readonly && effectiveSessionId" class="mt-1"
                :session-id="effectiveSessionId" :attachments="props.session?.settings?.attachments"
                @attachments-change="handleAttachmentsChange" />
            </div>
          </div>
        </div>
        <!-- 避让占位（asideReserve）：消息列让位的唯一来源——占位归占位；
             面板本体恒为浮层（chat-aside absolute），与此处无关 -->
        <div class="aside-bleed-col"
          :style="{ flexBasis: ((props.asideReserve || 0) > 0 ? ((props.asideReserve || 0) + ASIDE_GAP - 20) : 0) + 'px' }">
        </div>
      </div>
    </ScrollContainer>

    <!-- 右侧 aside 槽位（工作区概览）：不随消息滚动；有占位时落在避让空位上，
         默认融入背景（视觉原语 style.css --gd-overview-panel-*）；
         无占位（临时展开）悬浮于消息上方，回退卡片底色保证可读 -->
    <Transition name="aside-fade">
      <div v-if="(props.asideWidth || 0) > 0" class="chat-aside"
        :class="{ 'chat-aside--floating': !(props.asideReserve || 0) }"
        :style="{ width: (props.asideWidth || 0) + 'px', right: asideRight + 'px' }">
        <slot name="aside" />
      </div>
    </Transition>
  </div>
  <!-- 记忆管理弹窗（非模态，锚定上下文使用率圆环） -->
  <GdPopover :show="memoPanelVisible" @update:show="memoPanelVisible = $event" :anchor-el="contextRingRef"
    :width="373" max-height="65vh" :pause-auto-close="memoOverlayActive">
    <template #header>
      <div class="flex items-center px-1 pb-2 pt-1">
        <span class="text-sm font-semibold text-gray-800 dark:text-gray-200">{{ t('chat.panel.memoryManagement')
          }}</span>
      </div>
    </template>
    <div class="p-3 pt-1">
      <MemoPanel v-if="currentSessionId" :session-id="currentSessionId"
        @overlay-active="memoOverlayActive = $event" @close="memoPanelVisible = false" />
    </div>
  </GdPopover>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted, defineAsyncComponent, provide } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
const { t } = useI18n()
import { apiService } from "../../services/ApiService";
import { usePopup } from "@/composables/usePopup";
import { useDebounceFn } from "@vueuse/core";
import { useSessionStore } from "../../stores/session";
import { useAuthStore } from "../../stores/auth"
import { useLayoutStore } from "@/stores/layout"
import { streamReceiver } from "@/services/modules/StreamReceiver"
import {
  applyLiveChunk,
  foldEvents,
  takeStash as takeProjectorStash,
} from "@/services/modules/streamProjector"
import type { InputMessageState, Session, QueuedMessage } from '@/types/session';
import type { Agent } from '@/types/agent';

// 导入新创建的 composables
import { useSessionChat } from '@/composables/useSessionChat'
import { useMessageOperations, toPayloadFileRefs } from '@/composables/useMessageOperations'
import { useSessionTokenStats, applyContextStatsFromEvents } from '@/composables/useSessionTokenStats'
import { isHiddenBlock, toUserMessageView, collectReferencedKbs } from '@/utils/messageUtils'

// 组件导入
import TurnItem from "./TurnItem.vue";
import EventCard from "./EventCard.vue";
import FloatingTodoBar from "./FloatingTodoBar.vue";
import MessageSkeleton from "./MessageSkeleton.vue";
import { ChatInput, ScrollContainer, ScrollToBottomButton } from "../ui";
import WelcomeScreen from './WelcomeScreen.vue';
import QueuedMessages from './QueuedMessages.vue';
import SessionCards from './SessionCards.vue';
import WorkingDirBar from './workspace/WorkingDirBar.vue';
const MemoPanel = defineAsyncComponent(() => import("./MemoPanel.vue"));
import { LoadingOutlined } from '@vicons/antd'
import GdTooltip from '../ui/GdTooltip.vue';
import GdPopover from '@/components/ui/GdPopover.vue'


// 弹出层工具
const { confirm, editText, toast, notify } = usePopup();
const authStore = useAuthStore()
const sessionStore = useSessionStore();
const layoutStore = useLayoutStore();
const router = useRouter();

// 有壁纸时隐藏底部渐变遮罩（壁纸已有视觉层次，不透明遮罩会像补丁）
const hasWallpaper = computed(() => !!layoutStore.wallpaperUrl);

// 新发送消息动画追踪：只有通过 handleSendMessage 发送的消息才播放入场动画
const animateIds = ref<string[]>([]);
let expectingNewMessage = false;


// 记忆管理弹窗显隐（非模态 popover，锚定上下文圆环按钮）
const memoPanelVisible = ref(false);
const contextRingRef = ref<HTMLElement | null>(null);
// 面板内子弹窗/确认框打开期间，冻结 popover 的"点击外部/Esc 关闭"
const memoOverlayActive = ref(false);

/** 上下文圆环点击：切换记忆管理弹窗；只读模式（子代理会话）仅展示占用，不允许打开编辑 */
const toggleMemoPanel = () => {
  if (props.readonly) return;
  memoPanelVisible.value = !memoPanelVisible.value;
};

// 上下文使用率：圆形进度条
const ringPercent = computed(() => {
  if (!sharedTokenStats.value) return 0;
  return Math.round(sharedTokenStats.value.percentage);
});

const ringCircumference = 2 * Math.PI * 15; // r=15

const ringDashOffset = computed(() => {
  const pct = ringPercent.value;
  return ringCircumference * (1 - pct / 100);
});

const ringColor = computed(() => {
  const pct = ringPercent.value;
  if (pct >= 80) return '#f56c6c';
  if (pct >= 60) return '#e6a23c';
  return '#67c23a';
});

const contextTooltip = computed(() => {
  if (!sharedTokenStats.value) return t('chat.panel.contextUsage');
  const pct = ringPercent.value;
  return t('chat.panel.contextUsagePercent', { pct });
});

// Props & Emits - 类型化
const props = defineProps<{
  session: Session | null;
  sessionId?: string;      // 外部传入的会话 ID（优先级高于 session.id）
  readonly?: boolean;      // 只读模式（子 Agent）
  hideHeader?: boolean;    // 隐藏头部（子 Agent）
  /** 浮层面板视觉宽（px，0 = 不渲染）；恒为浮层渲染，与占位解耦 */
  asideWidth?: number;
  /** 避让占位宽（px，0 = 不占位）：消息列让位的唯一来源，与浮层面板各管各的 */
  asideReserve?: number;
}>();

const emit = defineEmits<{
  'update:session': [session: Session]
  openSettings: []
  'save-settings': []
  'select-agent': [agent: Agent]  // 切换智能体
  /** 工作目录条（输入框下方）：附加远程目录绑定变更，转发给 ChatPage 持久化 */
  'attachments-change': [attachments: Record<string, string[]>]
  /** 滚动容器可用内容宽变化（决策 aside 显隐用），单位 px（已扣除 padding） */
  'container-resize': [contentWidth: number]
}>();

defineSlots<{
  /** 右侧 aside 槽位：渲染于滚动条左侧、不随消息滚动；宽度由 asideWidth 控制 */
  aside?: () => any
}>();

// 计算属性 - 类型化
const currentSession = computed({
  get: () => props.session,
  set: (session: Session | null) => emit("update:session", session!)
});

const userAvater = computed(() => authStore.user?.avatarUrl);
const currentSessionId = ref<string | null>(null);
/** 各会话历史快照最后入库 seq(loadSession 返回,作订阅游标用) */
const lastSeqBySession = new Map<string, number | null>();

// 共享的 Token 统计（环形指示器：事件锚点逆向扫描填充；REST 仅记忆弹窗按需拉取）
const currentSessionIdRef = computed(() => currentSessionId.value);
const { tokenStats: sharedTokenStats } = useSessionTokenStats(currentSessionIdRef);

/**
 * 有效的会话 ID
 * 优先使用 props.sessionId，其次使用 props.session.id
 */
const effectiveSessionId = computed(() => {
  return props.sessionId || props.session?.id || '';
});
const isLoading = ref(true);
// 使用 useSessionChat composable
const {
  hasGeneratedTitle,
  resetTitleFlag,
  generateTitleIfNeeded
} = useSessionChat(sessionStore, apiService)

// 响应式数据
const scrollContainerRef = ref<any>(null);
const chatInputRef = ref<InstanceType<typeof ChatInput> | null>(null);
const needScrollToBottom = ref(true);
let scrollTicking = false;
let lastScrollTop = 0;

// ── 右侧 aside（工作区概览）自适应 ──
// 滚动条恒定 10px（ScrollContainer ::-webkit-scrollbar + scrollbar-gutter），
// 概览 absolute 定位在滚动条左侧；aside 可见即实占空间（避让占位列恒占位）：
// 消息(≤ --gd-chat-column-width)自动在剩余区内居中。
const SCROLLBAR_W = 10;
const ASIDE_GAP = 8;
/** aside 定位：right = 滚动条宽 + 间距（位于滚动条左侧） */
const asideRight = SCROLLBAR_W + ASIDE_GAP;

let chatResizeObserver: ResizeObserver | null = null;

/** 上报滚动容器可视宽（px）——父级据此判断概览显隐 */
function measureChatContainer(): void {
  const el = scrollContainerRef.value?.getScrollElement?.() as HTMLElement | null;
  if (!el) return;
  emit('container-resize', el.clientWidth);
}

watch(scrollContainerRef, (ref) => {
  chatResizeObserver?.disconnect();
  chatResizeObserver = null;
  const el = ref?.getScrollElement?.() as HTMLElement | null;
  if (!el) return;
  chatResizeObserver = new ResizeObserver(measureChatContainer);
  chatResizeObserver.observe(el);
  measureChatContainer();
}, { flush: 'post' });

/**
 * 锁定自动滚动到底部，供子组件通过 inject 调用。
 * 展开思考框/工具调用分组等操作时调用，防止内容高度变化触发自动滚动。
 * 用户下次滚动到底部时自动恢复。
 */
const lockScrollAnchor = () => {
  needScrollToBottom.value = false;
};
provide('lockScrollAnchor', lockScrollAnchor);

// 消息分页加载相关状态
const INITIAL_PAGE_SIZE = 30 // 首次加载消息数量
const MESSAGES_PAGE_SIZE = 15 // 后续每次加载消息数量
const isLoadingMore = ref(false)
const hasMoreMessages = ref(true)
const SCROLL_TOP_THRESHOLD = 80 // 距离顶部多少像素触发加载更多

// 骨架屏智能显示控制
const showSkeleton = ref(false)
let skeletonTimer: ReturnType<typeof setTimeout> | null = null
let skeletonMinDisplayTimer: ReturnType<typeof setTimeout> | null = null
let skeletonShowTime: number = 0 // 记录骨架屏开始显示的时间戳
const SKELETON_MIN_DISPLAY = 500 // 骨架屏最少显示毫秒数

// 会话切换并发守卫：每次 handleSessionChange 递增，await 后检查是否已被新调用取代
let sessionChangeToken = 0



// 使用 useMessageOperations composable
const {
  inputMessage,
  editMode,
  exitEditMode,
  prepareNewMessage,
  enterEditMode
} = useMessageOperations(sessionStore, apiService, currentSessionId)

// isStreaming 需要在滚动逻辑之前定义
const isStreaming = computed(() => {
  const sessionId = currentSessionId.value;
  return sessionId ? sessionStore.sessionIsStreaming(sessionId) : false;
});

// 队列状态
const messageQueue = computed(() => {
  return currentSessionId.value ? sessionStore.getMessageQueue(currentSessionId.value) : [];
});
const queueLength = computed(() => messageQueue.value.length);

// 滚动管理相关状态和方法
const showScrollToBottomBtn = ref(false)

/**
 * 更新滚动按钮显示状态
 *
 * 只跟随滚动位置，与流式状态完全无关：不在底部就显示、贴底就隐藏。
 * 此前用会话级 isStreaming 门控——它由最晚的 stream_status_changed 复位（晚于回合级 turn_end），
 * 会让按钮在回合结束后再滞留百毫秒才消失；而它是 28px 的实占控件，增删会改变 scrollHeight
 * 把上方消息顶跳。
 * 贴底判定与 handleScroll 同式：ScrollContainer 暴露的是滚动元素，不是 isAtBottom 状态
 * （其内部 ref 从未被写入，读它恒为 undefined）。
 */
const updateScrollButtonVisibility = useDebounceFn(() => {
  const scrollElement = scrollContainerRef.value?.getScrollElement?.()
  const isAtBottom = scrollElement
    ? scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight <= 5
    : true

  showScrollToBottomBtn.value = !isAtBottom
}, 100)

/**
 * 平滑滚动到底部
 */
function scrollToBottom() {
  if (scrollContainerRef.value) {
    scrollContainerRef.value.smoothScrollToBottom()
  }
}

/**
 * 立即滚动到底部
 */
function immediateScrollToBottom() {
  scrollContainerRef.value?.immediateScrollToBottom()
}


/**
 * 处理滚动事件
 */
function handleScroll(event: any) {
  // 滚动按钮显隐在 rAF 之外触发：本环境 rAF 可能被节流/不触发（同 FloatingTodoBar 的注释），
  // 而 scrollTicking 守卫会让 rAF 未回调时的后续滚动事件全部被丢弃——若只在 rAF 里更新，
  // 按钮会永不出现。防抖收在 updateScrollButtonVisibility 内部，逐次调用无额外开销。
  updateScrollButtonVisibility();

  if (scrollTicking) return;
  scrollTicking = true;

  requestAnimationFrame(() => {
    // 从 ScrollContainer 的滚动元素获取 scrollTop，确保准确性
    const scrollElement = scrollContainerRef.value?.getScrollElement?.();
    const scrollTop = scrollElement?.scrollTop ?? event.target?.scrollTop ?? 0;
    const isAtBottom =
      scrollElement?.scrollHeight - scrollTop - scrollElement?.clientHeight <= 5;

    // 检测是否滚动到顶部附近，触发加载更多历史消息
    if (
      scrollTop < SCROLL_TOP_THRESHOLD &&
      hasMoreMessages.value &&
      !isLoadingMore.value &&
      currentSessionId.value
    ) {
      // 分页游标：事件页的 nextBeforeSeq（null = 无更早内容）
      const eventCursor =
        sessionStore.getSessionState(currentSessionId.value)?.eventCursor ?? null;
      if (eventCursor != null) {
        // 立即设置标记，防止重复触发
        isLoadingMore.value = true;
        loadMoreMessages(currentSessionId.value, eventCursor);
      }
    }

    // 注意，容器变小导致的滚动不应该视为向上滚动
    if (needScrollToBottom.value && lastScrollTop - scrollTop > 10 && !isAtBottom) {
      needScrollToBottom.value = false;
    } else if (!needScrollToBottom.value && isAtBottom) {
      needScrollToBottom.value = true;
    }
    lastScrollTop = scrollTop;
    updateScrollButtonVisibility();
    scrollTicking = false;
  });
}

/**
 * 处理滚动按钮点击
 */
function handleScrollToBottomClick() {
  scrollToBottom()
}

// 滚动按钮显隐只由滚动事件驱动（updateScrollButtonVisibility 在 handleScroll 中触发）；
// 不再监听 isStreaming——流式状态与按钮无关。

const activeMessages = computed({
  get: () => {
    const sessionId = currentSessionId.value;
    return sessionId && !isLoading.value ? sessionStore.getMessages(sessionId) || [] : [];
  },
  set: (value: any[]) => {
    const sessionId = currentSessionId.value;
    if (sessionId) {
      sessionStore.setMessages(sessionId, value);
    }
  }
});

// 直接消费后端 Turn[]（不再打平为扁平消息再按 parentId 归组）
const activeTurns = computed(() => {
  const sessionId = currentSessionId.value;
  return sessionId && !isLoading.value ? sessionStore.getTurns(sessionId) || [] : [];
});

// 从回合中取用户锚点块（role=user 且为人类输入），渲染与操作均基于该块（二级结构：turn → block）
// 后端注入的 hidden user 消息（拦截器/图片/待办/压缩）同 role 但非用户输入，须排除
const userOfTurn = (turn: any): any =>
  turn?.messages?.find((m: any) => m.role === 'user' && !isHiddenBlock(m)) ?? null;

// 最后一条 user 消息的索引，避免每轮 v-for 重复计算
const lastUserMessageIndex = computed(() => {
  const turns = visibleTurns.value;
  for (let i = turns.length - 1; i >= 0; i--) {
    if (userOfTurn(turns[i])) {
      return i;
    }
  }
  return -1;
});

// ============================================
// 回合列表：直接消费后端 Turn[]（无需按 parentId 归组）
// ============================================
const turns = computed(() => activeTurns.value);


// 过滤：保留含 user 锚点消息的回合 + 事件类消息外壳（kind='event'，无 user 锚点也能显示）
const visibleTurns = computed(() =>
  turns.value.filter((t) => userOfTurn(t) || t.kind === 'event'),
);

// 监听轮次变化：仅 handleSendMessage 发送的新消息才标记动画
watch(() => visibleTurns.value.length, (newLen, oldLen) => {
  if (!expectingNewMessage || newLen <= (oldLen || 0)) return;
  const lastTurn = visibleTurns.value[visibleTurns.value.length - 1];
  if (!lastTurn) return;
  const newId = lastTurn.id;
  animateIds.value = [...animateIds.value, newId];
  setTimeout(() => {
    animateIds.value = animateIds.value.filter(id => id !== newId);
  }, 600);
  expectingNewMessage = false;
  nextTick(() => {
    immediateScrollToBottom()
  })
});

const currentModelId = computed({
  get() {
    return currentSession.value?.modelId ?? null;
  },
  set(value: string | null) {
    if (currentSession.value) {
      currentSession.value.modelId = value || '';
      currentSession.value.updatedAt = new Date().toISOString();
      debouncedSaveSession();
    }
  }
});


// ========== ChatInput 配置管理 ==========

/**
 * ChatInput 组件的配置对象（计算属性）
 * 与 handleConfigChange 中的处理逻辑一一对应，方便对照维护
 */
/**
 * 聊天附件上传器：注入给 ChatInput，让「点发送」时的上传能带上真实进度、
 * 并在失败时把状态留在附件卡片上（而不是上传了却看不见、失败就整条消息没了）。
 * 实现只有一处——ApiService.uploadFile（axios onUploadProgress）。
 */
const chatAttachmentUploader = {
  upload: (sessionId: string, file: File, onProgress?: (percent: number) => void) =>
    apiService.uploadFile(sessionId, file, onProgress),
};

const chatInputConfig = computed(() => ({
  modelId: currentModelId.value,
  // 未设置 = 会话从未选过档位 → 交给 ChatInput 取菜单默认中间档（不要在这里填 'none'）
  thinkingEffort: currentSession.value?.settings?.thinkingEffort || undefined,
  maxTokensLimit: currentSession.value?.settings?.maxTokensLimit ?? null,
  knowledgeBaseIds: inputMessage.value?.knowledgeBaseIds || currentSession.value?.settings?.referencedKbs || [],
  workspacePath: currentSession.value?.workspacePath || null,
  sandboxMode: currentSession.value?.settings?.sandboxMode || 'workspace-write',
  attachments: currentSession.value?.settings?.attachments || {},
}));

onMounted(() => {
  // 附加连接类型由 ChatInput 内部自行加载渲染标签,此处不再维护
});

onUnmounted(() => {
  clearSkeletonTimers();
});

/**
 * 工作目录条（输入框下方）的附加远程目录绑定变更：向上转发给 ChatPage
 * （写 mainSession.settings.attachments 并 PUT /sessions/:id 持久化）
 */
const handleAttachmentsChange = (attachments: Record<string, string[]>) => {
  emit("attachments-change", attachments);
};

/**
 * 处理 ChatInput 配置变更
 * 与 chatInputConfig 计算属性中的字段一一对应
 */
const handleConfigChange = (config: any) => {
  if (!currentSession.value) return;

  // 处理模型 ID 变更
  if (typeof config.modelId !== 'undefined') {
    currentSession.value.modelId = config.modelId;
  }

  // 处理 Token 上限（会话级别独立配置）
  if (typeof config.maxTokensLimit !== 'undefined') {
    currentSession.value.settings.maxTokensLimit = config.maxTokensLimit;
  }

  // 处理思考强度变更
  if (typeof config.thinkingEffort !== 'undefined') {
    currentSession.value.settings.thinkingEffort = config.thinkingEffort;
  }

  // 处理知识库选择
  if (typeof config.knowledgeBaseIds !== 'undefined') {
    inputMessage.value.knowledgeBaseIds = config.knowledgeBaseIds;
    if (!editMode.value) {
      currentSession.value.settings.referencedKbs = config.knowledgeBaseIds;
    }
  }

  // 处理工作目录路径
  if (typeof config.workspacePath !== 'undefined') {
    currentSession.value.workspacePath = config.workspacePath;
    console.log('保存 workspacePath 到会话:', config.workspacePath);
  }

  // 处理安全模式
  if (typeof config.sandboxMode !== 'undefined') {
    currentSession.value.settings.sandboxMode = config.sandboxMode;
  }

  // 处理附加连接
  if (typeof config.attachments !== 'undefined') {
    currentSession.value.settings.attachments = config.attachments;
  }

  debouncedSaveSession();
};

// 防抖函数
const debouncedSaveSession = useDebounceFn(() => {
  emit("save-settings");
}, 100);

// 监听器
watch(() => props.session?.id || props.sessionId, async (newSessionId: string | undefined, oldSessionId: string | undefined) => {
  const newId = newSessionId ?? props.sessionId ?? null;
  const effectiveOldId = oldSessionId ?? null;
  await handleSessionChange(newId, effectiveOldId);
  needScrollToBottom.value = true;
}, { immediate: true });

// 监听流式状态变化，在第一次对话完成后生成标题
watch(() => isStreaming.value, async (newVal, oldVal) => {
  // 当流式状态从 true 变为 false 时（即智能体回复完成）
  if (oldVal === true && newVal === false) {
    if (activeMessages.value.length == 2 && !hasGeneratedTitle.value) {
      await generateTitleIfNeeded(currentSessionId.value!, activeMessages.value, currentSession);
    }
  }
}, { immediate: true });


/**
  * 加载会话配置和消息（首次加载，只加载最近 N 条）
  */
async function loadSession(sessionId: string) {
  await loadMessages(sessionId, { isInitial: true });
  // 上下文占用：逆向扫描事件日志最后一个锚点（turn/finish / compaction/end 等）填充环形指示器。
  // 无锚点 → 显示 0，绝不访问 token-stats（唯一 REST 入口 = 记忆弹窗打开时按需拉取 breakdown）。
  const eventLog = sessionStore.getSessionState(sessionId).eventLog || [];
  applyContextStatsFromEvents(sessionId, eventLog);
}

/**
 * 加载会话消息（前端自折叠：拉事件页 → foldEvents 重建树）
 * @param sessionId - 会话 ID
 * @param options - 加载选项
 *   - isInitial: 是否为首次加载（拉最近 N 个回合的事件页）
 *   - beforeSeq: 加载此 seq 之前（更早）的事件页（load-more）
 */
async function loadMessages(
  sessionId: string,
  options: { isInitial?: boolean; beforeSeq?: number } = {},
) {
  const isInitial = options.isInitial ?? true;

  // 缓存门禁:有缓存(loaded)直接用——live 事件本就直接应用到缓存,无缓存一律拉历史
  // (与是否流式无关;树为空时 fold 重建无物可丢),拉取后按 seq 补齐本地暂存再建缓存。
  // (旧版曾按 isStreaming 短路不拉历史,导致"流式中打开无缓存会话"永远空白,已移除)
  if (isInitial) {
    const sessionState = sessionStore.getSessionState(sessionId);
    if (sessionState.loaded === true) {
      // 恢复本会话自己的分页状态(组件级单例 ref 会残留上一个会话的值)
      hasMoreMessages.value = sessionState.turnsHasMore ?? true;
      return;
    }
  }

  if (!isInitial) {
    isLoadingMore.value = true;
  }

  try {
    const sessionState = sessionStore.getSessionState(sessionId);
    // 记录 load-more 前的滚动位置（内容高度），rebuild 后恢复
    const scrollElement = scrollContainerRef.value?.getScrollElement?.();
    const oldScrollHeight = !isInitial ? scrollElement?.scrollHeight || 0 : 0;

    const page = await apiService.fetchSessionEvents(sessionId, {
      beforeSeq: isInitial ? undefined : options.beforeSeq,
      turns: isInitial ? INITIAL_PAGE_SIZE : MESSAGES_PAGE_SIZE,
    });

    // 事件数组：初始替换 / load-more 前插（live 终态事件已由 applyLiveChunk 追加进 eventLog）
    const prevLog = sessionState.eventLog || [];
    sessionState.eventLog = isInitial
      ? [...page.events]
      : [...page.events, ...prevLog];

    // 记录历史快照最后入库 seq,作订阅游标(订阅时按 prevSeq >= lastSeq 取增量)
    if (isInitial) {
      lastSeqBySession.set(sessionId, page.endSeq ?? null);
      // 时序:历史拉取完成后,通知唯一 receiver 设置基线,
      // receiver 对该会话才处理 prevSeq >= lastSeq 的增量(历史未拉取前不处理)
      streamReceiver.setHistoryBaseline(sessionId, page.endSeq ?? 0);
    }

    // 折叠：清树后全量重建（eventLog 含 live 终态事件，re-fold 天然保留实时尾部）
    foldEvents(sessionStore, sessionId, sessionState.eventLog);

    // 分页游标：下一页 = 页首前一 seq（null = 无更早内容）
    sessionState.eventCursor = page.nextBeforeSeq;

    // 消费暂存:把"无缓存期间暂存的事件"按 seq 对齐后应用进 store。
    // prevSeq 是"先入库后发事件"的入库游标:prevSeq < endSeq 的事件必已包含在历史页内
    // (跳过,防重复);prevSeq == endSeq 的事件发布于快照末尾之后、不在快照内——
    // 在飞 chunk 恰属此类(chunk 不入库,prevSeq == 最后在库事件 seq),必须应用,
    // 否则刷新后已流出的增量丢失、只能等 finish 重建。边界上重复应用的已入库事件
    // (user_message 等)由 projector 按 messageId/turnId 幂等吸收。prevSeq 缺失照旧应用(fail-open)。
    const endSeq = page.endSeq ?? 0;
    const projectorStash = takeProjectorStash(sessionId);
    for (const chunk of projectorStash) {
      const prevSeq = (chunk as { prevSeq?: number }).prevSeq;
      if (typeof prevSeq === "number" && prevSeq < endSeq) continue;
      applyLiveChunk(sessionStore, sessionId, chunk);
    }

    hasMoreMessages.value = page.hasMore;
    // 分页游标状态按会话记忆(切会话回来时恢复)
    sessionStore.getSessionState(sessionId).turnsHasMore = page.hasMore;

    // 标记会话内容已缓存(二次打开不再向后端拉取)
    if (isInitial) {
      sessionStore.getSessionState(sessionId).loaded = true;
    } else if (page.events.length > 0) {
      // 恢复滚动位置，避免跳到顶部（rebuild 替换整树，需补偿高度差）
      nextTick(() => {
        const newScrollHeight = scrollElement?.scrollHeight || 0;
        const heightDiff = newScrollHeight - oldScrollHeight;
        if (scrollElement && heightDiff > 0) {
          scrollElement.scrollTop = heightDiff;
        }
      });
    }
  } catch (error: any) {
    console.error('加载消息失败:', error);
    notify.error('加载消息失败', error.message);
  } finally {
    isLoadingMore.value = false;
  }
}

/**
 * 加载更多历史消息
 * @param sessionId - 会话 ID
 * @param beforeSeq - 从此 seq 之前（更早）加载
 */
async function loadMoreMessages(sessionId: string, beforeSeq: number) {
  await loadMessages(sessionId, { isInitial: false, beforeSeq });
}
/**
 * 处理会话切换
 */
/**
 * 清理骨架屏定时器
 */
function clearSkeletonTimers() {
  if (skeletonTimer) {
    clearTimeout(skeletonTimer)
    skeletonTimer = null
  }
  if (skeletonMinDisplayTimer) {
    clearTimeout(skeletonMinDisplayTimer)
    skeletonMinDisplayTimer = null
  }
}

/**
 * 启动骨架屏延迟显示逻辑
 * 200ms 内加载完成则不显示，超过 200ms 则显示且至少保持 500ms
 */
function startSkeletonDelay() {
  clearSkeletonTimers()
  showSkeleton.value = true
  skeletonShowTime = Date.now() // 记录开始显示的时间戳
}

/**
 * 结束骨架屏显示（遵守最少显示时长）
 * 从开始显示时计时，确保至少显示 500ms
 */
function stopSkeletonDisplay() {
  if (skeletonTimer) {
    clearTimeout(skeletonTimer)
    skeletonTimer = null
  }

  if (!showSkeleton.value) {
    // 骨架屏未显示，直接保持隐藏
    return
  }

  const elapsed = Date.now() - skeletonShowTime
  const remaining = Math.max(SKELETON_MIN_DISPLAY - elapsed, 100)
  console.log('Skeleton remaining time:', remaining, 'ms')
  // 还未满 500ms，延迟剩余时间后再隐藏
  skeletonMinDisplayTimer = setTimeout(() => {
    showSkeleton.value = false
    skeletonMinDisplayTimer = null
  }, remaining)

}

async function handleSessionChange(newSessionId: string | null, oldSessionId: string | null) {
  if (newSessionId === oldSessionId) return;

  resetTitleFlag();
  // 接收唯一链路是 useSessionEvents 的 streamReceiver.subscribeAll（常驻、按 sessionId 路由），
  // 本组件不再触碰 receiver 的 activeSession 指针——多实例（中央 + 侧边栏子代理）并存时互不干扰。
  if (newSessionId === null) {
    currentSessionId.value = null;
    return;
  }
  const token = ++sessionChangeToken;
  isLoading.value = true;
  startSkeletonDelay();
  try {
    lastScrollTop = 0;
    currentSessionId.value = newSessionId;
    // 打开会话:直接拉历史快照(loadSession 返回 lastSeq 作为订阅游标)。
    // StreamEventHub 邮箱常驻收事件,无需 startBuffering——订阅时按 prevSeq >= lastSeq 取增量。
    await loadSession(newSessionId);
    if (token !== sessionChangeToken) return;
    // 打开会话后一次性尝试订阅活跃流(刷新/多窗口同步;无活跃流时 subscribe 模式自行结束)
    await subscribeToActiveStream(newSessionId);
    if (token !== sessionChangeToken) return;

    nextTick(() => {
      if (token !== sessionChangeToken) return;
      if (!currentSession.value)
        return;
      if (inputMessage.value?.isWaiting) {
        currentSession.value.settings.referencedKbs = inputMessage.value.knowledgeBaseIds;
        handleSendMessage(inputMessage.value);
      }
    });
  } catch (error) {
    if (token !== sessionChangeToken) return;
    console.error('加载会话失败:', error);
    notify.error('加载会话失败', error.message);
  } finally {
    if (token !== sessionChangeToken) return;
    isLoading.value = false;
    stopSkeletonDisplay();
  }
}

// 消息操作方法
function abortResponse() {
  if (currentSessionId.value) {
    apiService.cancelResponse(currentSessionId.value);
  }
}

async function deleteTurnMessage(turn: any) {
  try {
    if (
      await confirm(
        t('chat.panel.deleteTurnTitle'),
        t('chat.panel.deleteTurnDesc')
      )
    ) {
      if (currentSessionId.value) {
        // 删除本轮对话：按回合 id 整轮遮蔽（前端 turn 结构直接消费）
        const turnId = turn?.id;
        await apiService.deleteTurn(currentSessionId.value, turnId);
        sessionStore.deleteTurnById(currentSessionId.value, turnId);
        toast.success(t('common.deleteSuccess'));
      }
    }
  } catch (error) {
    toast.error(t('common.error.deleteFailed'));
    console.error("删除本轮对话失败:", error);
  }
}

// 分支会话：以该回合（助手消息所在，必为完整一轮）为节点，复制出新会话并跳转过去
// 分支只复制主对话（工作流、子代理等历史不跟随），故先弹窗告知该取舍
async function branchFromTurn(turn: any) {
  if (!currentSessionId.value || !turn?.id) return;
  const confirmed = await confirm(
    t('chat.panel.branchConfirmTitle'),
    t('chat.panel.branchConfirmDesc'),
  );
  if (!confirmed) return;
  try {
    const newSession = await apiService.branchSession(currentSessionId.value, {
      turnId: turn.id,
    });
    sessionStore.setSession(newSession);
    toast.success(t('chat.panel.branchSuccess'));
    router.replace({ name: 'Chat', params: { sessionId: newSession.id } });
  } catch (error: any) {
    toast.error(error?.message || t('chat.panel.branchFailed'));
    console.error("分支会话失败:", error);
  }
}

async function editMessage(block: any) {
  try {
    // 无 assistant 块（如立即报错无任何产出）→ 无可编辑内容，提前返回
    if (!block) {
      toast.info(t('chat.panel.editCancelled'));
      return;
    }

    const result = await editText({
      title: t('chat.panel.editMessageTitle'),
      defaultValue: block.content || "",
      confirmText: t('common.save'),
      cancelText: t('common.cancel')
    }) as string | null;

    if (result != null && currentSessionId.value) {
      block.content = result;
      // 按消息级 messageId 回传（块继承自所属消息）
      await apiService.updateMessage(currentSessionId.value, block.messageId, { content: result });
      sessionStore.updateMessage(currentSessionId.value, block.messageId, block);
      toast.success(t('common.updateSuccess'));
    } else if (result === null || result === undefined) {
      toast.info(t('chat.panel.editCancelled'));
    }
  } catch (error) {
    toast.error(t('common.error.operationFailed'));
    console.error("更新消息失败:", error);
  }
}

async function copyMessage(block: any) {
  try {
    // 无 assistant 块（如立即报错无任何产出）→ 复制空内容
    if (!block) {
      await navigator.clipboard.writeText("");
      return;
    }

    if (block.content) {
      await navigator.clipboard.writeText(block.content);
      toast.success(t('common.copySuccess'));
    }
  } catch (error) {
    console.error("复制消息失败:", error);
    toast.error(t('common.copyFailed'));
  }
}

/**
 * 处理发送消息
 * 合并消息创建和流式启动为一个原子操作
 */
async function handleSendMessage(payload?: InputMessageState) {
  // 只读模式（子代理会话）防御性拦截：发送按钮已禁用、Enter 已拦，
  // 此处兜住队列回填/isWaiting 自动发送等旁路。
  if (props.readonly) return;
  const data = payload;
  if (!data || (!data.content?.trim() && !data.files.length)) return;

  try {
    const { content, files, knowledgeBaseIds } = data;

    // 流式进行中：消息入队，等 stream_finished 后自动消费
    if (currentSessionId.value && isStreaming.value) {
      const sid = currentSessionId.value;
      const prepared = await prepareNewMessage(content, files, null, knowledgeBaseIds);
      sessionStore.enqueueMessage(sid, {
        content: prepared.content,
        files: prepared.files,
        knowledgeBaseIds: prepared.knowledgeBaseIds,
      });
      return;
    }

    // 准备消息数据（上传文件等）
    const prepared = await prepareNewMessage(content, files, null, knowledgeBaseIds);

    // 如果是编辑模式，需要处理替换逻辑
    // replaceTurnId 已由 enterEditMode 定位好(回合外壳 id=turnId),直接使用,无需反查。
    let replaceTurnId: string | undefined = undefined;
    if (editMode.value && editMode.value.turnId && currentSessionId.value) {
      replaceTurnId = editMode.value.turnId;
      const rid = editMode.value.message?.id;
      const sid = currentSessionId.value;
      // 删除该回合（user 及其 assistant 一并移除），随后由 replaceTurnId 触发后端 turn/delete + 新建回合
      const roundMessages = sessionStore
        .getMessages(sid)
        .filter((msg: any) => msg.id === rid || msg.parentId === rid);
      for (const rm of roundMessages) {
        sessionStore.deleteMessage(sid, rm.id);
      }
      exitEditMode();
    }

    // 发起流式请求（后端会自动创建消息并启动流）
    // 发送链路独立:只调 apiService.chat 发起,不订阅、不处理事件;
    // 发送后的事件由常驻接收链路(唯一 receiver)消费。
    if (currentSessionId.value) {
      expectingNewMessage = true;
      sessionStore.setStreamStatus(currentSessionId.value, "pending");
      await apiService.chat({
        sessionId: currentSessionId.value,
        userMessage: {
          content: prepared.content,
          files: prepared.files,
          replaceTurnId,
          knowledgeBaseIds: prepared.knowledgeBaseIds,
        },
      });
    }
  } catch (error: any) {
    notify.error(t('chat.panel.sendMessageFailed'), error.message);
    // 发送失败时由 SSE 事件驱动恢复检测
  }
}

/**
 * 处理队列消息撤回
 */
function handleRemoveQueued(id: string) {
  if (currentSessionId.value) {
    sessionStore.removeQueuedMessage(currentSessionId.value, id);
  }
}

/**
 * 处理队列消息编辑
 */
function handleEditQueued(item: QueuedMessage) {
  if (!currentSessionId.value) return;
  inputMessage.value = {
    content: item.content,
    files: item.files,
    knowledgeBaseIds: item.knowledgeBaseIds,
    isWaiting: false,
  };
  sessionStore.removeQueuedMessage(currentSessionId.value, item.id);
}

/**
 * 进入编辑模式以重新生成消息
 * TurnItem 已直接传入整轮 turn(渲染链路传递,零反查),
 * enterEditMode 直接用 turn.id 作为被编辑回合外壳 id。
 */
function generateResponse(turn: any) {
  const user = (turn?.messages || []).find(
    (m: any) => m.role === "user" && !isHiddenBlock(m),
  );
  if (!user) return;
  // 用户消息束 → 编辑视图（跨块聚合文本/附件），enterEditMode 消费
  enterEditMode(toUserMessageView(user), turn.id)
}

/**
 * 重新生成响应（整轮次重答：删除旧轮次 + 正常回答流程，overwrite 模式）
 * TurnItem 已直接传入整轮 turn,用户块与回合外壳 id 均从 turn 直接取(零反查),
 * replaceTurnId = turn.id 触发后端 turn/delete 旧轮次 + 新建回合。
 */
function regenerateResponse(turn: any) {
  const user = (turn?.messages || []).find(
    (m: any) => m.role === "user" && !isHiddenBlock(m),
  );
  if (!user) return;
  // 用户消息束 → 可见视图：跨块聚合可见正文/附件；注入块（origin='system' 系统提示、
  // kb-ref KB 引用）不入正文——重答只重发用户原始输入，系统注入由后端按当前模式重新派生
  const view = toUserMessageView(user);
  if (!view) return;
  const userContent = view.content;
  const files = toPayloadFileRefs(view.files || []);
  // KB 引用重发：kb-ref 块是唯一事实源（与 chips/编辑回填同源），历史数据回退 metadata
  const knowledgeBaseIds = collectReferencedKbs(user).map((kb) => kb.id);

  const replaceTurnId = turn.id;

  nextTick(() => {
    immediateScrollToBottom();
    if (currentSessionId.value) {
      // 发送链路独立:只调 apiService.chat 发起(重答=replaceTurnId 触发 turn/delete+新建),
      // 不订阅、不处理事件;事件由常驻接收链路(唯一 receiver)消费。
      sessionStore.setStreamStatus(currentSessionId.value, "pending");
      apiService.chat({
        sessionId: currentSessionId.value,
        userMessage: {
          content: userContent,
          files,
          replaceTurnId,
          knowledgeBaseIds,
        },
      });
    }
  });
}

/**
 * 订阅活跃流
 * 当检测到会话有正在进行的流式输出时调用（如刷新页面后重连或多窗口打开）
 */
async function subscribeToActiveStream(sessionId?: string) {
  const sid = sessionId || currentSessionId.value;
  if (!sid || isStreaming.value) return;

  // 常驻接收链路(useSessionEvents 的 streamReceiver.subscribeAll)已消费所有会话事件
  // (按 sessionId 路由 → projectChunk 写缓存/暂存),无需再启动 processStream('subscribe') 事件循环,
  // 也不再盲置 isStreaming=true —— isStreaming 由后端 stream_status_changed 实际流状态驱动。
  void sid;
}

// 将方法暴露给父组件
defineExpose({
  sendMessage: handleSendMessage,
  loadMessages,
  activeMessages,
  scrollToMessage,
  subscribeToActiveStream,
  getScrollElement: () => scrollContainerRef.value?.getScrollElement?.() || null, // 提供获取滚动元素的方法
  insertText: (text: string) => chatInputRef.value?.insertText(text),
  insertBadge: (data: any) => chatInputRef.value?.insertBadge(data),
});

/**
 * 滚动到指定消息
 */
function scrollToMessage(messageId: string) {
  // 使用外层容器作为滚动上下文
  const container = scrollContainerRef.value?.getScrollElement?.() || null;

  if (!container) {
    console.warn('[ChatPanel] 未找到滚动容器')
    return
  }

  // 在容器中查找目标消息元素
  const targetElement = container.querySelector(`[data-message-id="${messageId}"]`)
  if (!targetElement) {
    console.warn(`[ChatPanel] 未找到消息元素: ${messageId}`)
    return
  }

  // 用容器级滚动，避免 scrollIntoView 导致整个页面位移
  container.scrollTo({ top: targetElement.offsetTop, behavior: 'smooth' })

  // 屏外回合带 content-visibility，跳转途中它们才按真实高度展开，落点会偏；
  // 滚动结束后按实测位置校正一次
  const correct = () => {
    const drift =
      targetElement.getBoundingClientRect().top - container.getBoundingClientRect().top
    if (Math.abs(drift) > 2) container.scrollBy({ top: drift, behavior: 'smooth' })
  }
  container.addEventListener('scrollend', correct, { once: true })
}

</script>

<style scoped>
.chat-scroll-container {
  will-change: transform;
  transform: translateZ(0);
  contain: layout style paint;
  transition: opacity 0.3s ease;
}

/* 消息行：flex row；撑满剩余高度（flex:1 0 auto），消息列拉伸对齐 */
.scroll-inner {
  display: flex;
  align-items: stretch;
  flex: 1 0 auto;
  min-width: 0;
}

/* 消息列：basis = 目标宽（不塌零），shrink 权重小 → 几乎不缩；
   空间不足时负空间几乎全由占位承担，占位缩到 0 后消息才缩。
   position:relative 让 absolute 骨架屏相对消息列宽（随避让让出） */
.scroll-main {
  position: relative;
  flex: 1 1 var(--gd-chat-column-width);
  min-width: 0;
  display: flex;
  flex-direction: column;
}

/* 对话列宽度：唯一真相是 --gd-chat-column-width（style.css）。
   原先写 Tailwind 的 max-w-186，浮动小窗要靠 :deep(.max-w-186) 反选才能覆盖，
   类名即尺寸——改名/换刻度就静默失效，故收成本语义类。
   JS 侧镜像见 ChatPage.vue 的 MSG_MAX_WIDTH，改 token 时同步。 */
.chat-column {
  max-width: var(--gd-chat-column-width);
}

/* 避让占位（消息行右端 = 滚动条左侧）：shrink 权重极大（100×268）
   优先承担压缩；flex-basis 0↔268 过渡 */
.aside-bleed-col {
  flex-grow: 0;
  flex-shrink: 100;
  min-width: 0;
  transition: flex-basis 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

/* 输入区在 scroll-main 内（消息列统一避让，无需独立占位） */

/* aside 进出场：淡入淡出 + 滑移（缩放/右移） */
.aside-fade-enter-active,
.aside-fade-leave-active {
  transition: opacity 0.35s ease, transform 0.35s cubic-bezier(0.4, 0, 0.2, 1);
  transform-origin: top right;
}

.aside-fade-enter-from,
.aside-fade-leave-to {
  opacity: 0;
  transform: scale(0.92) translateX(8px);
}

/* 分栏拖拽豁免：GdSplitpanes 拖拽时用
   .lite-splitpanes--resizing * { transition: none !important } 屏蔽概览/避让过渡，
   用更高特异性 + important 豁免，保证拖拽时概览显隐与避让占位也有动画 */
.lite-splitpanes--resizing .chat-aside {
  transition: opacity 0.35s ease, transform 0.35s cubic-bezier(0.4, 0, 0.2, 1) !important;
}

/* 避让占位（flex-basis 变化）拖拽时同样豁免 */
.lite-splitpanes--resizing .aside-bleed-col {
  transition: flex-basis 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
}

/* 右侧 aside（工作区概览）：恒为浮层——absolute 定位、不随消息滚动；
   有占位时恰好落在避让空位上（视觉像停靠），无占位时悬浮于消息上方 */
/* 右侧 aside（工作区概览）：恒为浮层——absolute 定位，不随消息滚动；
   卡片观感（底色/描边/圆角/投影）由面板自身（.overview-panel）提供，宿主只管定位。
   高度随内容自适应（不撑满槽位）；top 与消息区顶部对齐 */
.chat-aside {
  position: absolute;
  top: 12px;
  z-index: 20;
}

/* 临时展开（无避让占位）悬浮于消息上方：回退卡片底色保证可读。
   常驻停靠态默认融入背景；卡片视觉原语见 style.css --gd-overview-panel-* */
.chat-aside--floating :deep(.overview-panel) {
  background: var(--gd-color-dialog-bg, var(--gd-color-surface));
  border-color: var(--gd-color-surface-border);
  box-shadow: var(--gd-overview-panel-shadow);
}

.chat-aside :deep(> *) {
  width: 100%;
}

.queue-drawer {
  border: 1px solid var(--gd-color-surface-border);
}

/* 抽屉过渡动画 */
.queue-drawer-enter-active,
.queue-drawer-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
}

.queue-drawer-enter-from,
.queue-drawer-leave-to {
  opacity: 0;
  max-height: 0;
  margin-bottom: 0;
  padding-top: 0;
  padding-bottom: 0;
}

.queue-drawer-enter-to,
.queue-drawer-leave-from {
  opacity: 1;
  max-height: 400px;
}

/* 底部渐变遮罩：位于输入区底部（bottom:0），遮罩滚动区底部消息渐隐；
   containing block = chat-input-area（现位于 scroll-main 内 = 已避让的列），
   故 left-0 right-0 宽度天然 = 消息列宽（随避让让出） */
.chat-bottom-fade {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  /* 56px 实心区需盖住输入框下方的工作目录条（约 36px），否则滚动消息会从条后漏出 */
  height: 76px;
  pointer-events: none;
  background: linear-gradient(to top, var(--gd-color-bg) 56px, transparent 76px);
}

/* 加载指示器淡入淡出 */
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: all 0.25s ease;
}

.fade-slide-enter-from,
.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}


/* 为消息列表容器添加更强的隔离 */
:deep(.scroll-container > div) {
  min-height: 100%;
  display: flex;
  flex-direction: column;
}

/* 确保消息项也使用隔离 */
:deep(.message-item) {
  contain: layout style;
}

/* 编辑模式提示条样式 */
.edit-mode-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  box-shadow: 0 2px 8px rgba(230, 162, 60, 0.1);
  transition: all 0.3s ease;
}

.edit-mode-banner:hover {
  box-shadow: 0 3px 12px rgba(230, 162, 60, 0.15);
}

/* 工具栏按钮：与 ChatInputToolbar 保持样式一致 */
.workspace-btn {
  color: #888;
  cursor: pointer;
  font-size: 14px;
  height: 22px;
  padding: 0 3px;
  display: flex;
  align-items: center;
  transition: all 0.2s;
}

/* 圆形进度条按钮 */
.context-ring-btn {
  display: flex;
  align-items: center;
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  transition: background 0.2s;
  outline: none;
}

.context-ring-btn:hover,
.context-ring-btn.is-open {
  background: var(--gd-color-sidebar-bg-hover);
}

.context-ring .ring-bg {
  stroke: var(--gd-color-text-disabled);
  opacity: 0.3;
}

.context-ring .ring-fg {
  transition: stroke-dashoffset 0.3s ease, stroke 0.3s ease;
}

/* 输入区上方状态行：TODO 胶囊与回到底部按钮并排居中。
   浮层而非流内元素——两者都是按状态增删的 28px 控件（胶囊随待办项、按钮随是否贴底），
   参与布局会让该行在 0↔34px 之间跳变，直接改变 scrollHeight 把上方消息顶跳。
   包含块 = .chat-column（已 relative），left/right:0 宽度等同原 width:100%。
   pointer-events 收口：浮层空白区透传点击，子控件自身可点。
   will-change: transform 不为动效：把本行提升为合成层，让浏览器有机会把渲染吸附到设备像素网格，
   缓解本行继承的小数位置（输入区是 sticky bottom-0，滚到最底部时落到由内容高度决定的自然位置，
   实测带 0.5px 小数；滚动中途则贴视口底、为整数）。
   注意：图标自身的半像素是另一回事——「容器尺寸 − 图标尺寸 = 奇数」会让居中余量为半像素
   （16px 容器放 13px 图标 → 上下各 1.5px），这是几何问题，应按尺寸取偶数修
   （见 FloatingTodoBar / EventCard 的注释），不要靠这里兜。
   本行吸附是尽力而为（实测有时生效、有时仍差半个像素），不是根治手段。 */
.composer-status-row {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(100% + 6px);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  pointer-events: none;
  will-change: transform;
}

.composer-status-row > :deep(*) {
  pointer-events: auto;
}

/* 回到底部按钮的 0 宽插槽：按钮在插槽内绝对定位（与胶囊的间距由行的 gap 提供），
   插槽自身不占宽度 → 按钮显隐不参与行的居中计算，胶囊与图标的横向位置恒定。
   否则按钮消失（到达底部）会让「胶囊+按钮」整组重新居中，把胶囊横移 18px。 */
.scroll-btn-slot {
  position: relative;
  flex: 0 0 auto;
  width: 0;
  height: 28px;
}

.scroll-btn-slot > :deep(*) {
  position: absolute;
  top: 0;
  left: 0;
}
</style>
