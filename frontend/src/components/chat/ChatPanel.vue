<template>
  <!-- 消息+输入 区域容器 -->
  <div class="flex-1 overflow-hidden w-full relative">
    <ScrollContainer ref="scrollContainerRef" class="h-full chat-scroll-container transition-opacity duration-300 px-5"
      :auto-scroll="isFollowingScroll" @scroll="handleScroll" @near-top="handleNearTop"
      @following-change="handleFollowingChange" @content-resize="handleContentResizeForScrollRestore">
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
                  <!-- 懒挂载占位：未进入视口附近的回合只占高度，不创建组件树。
                       接近视口时由 v-lazy-turn 挂载并保留，避免 30 回合一次性 mount 阻塞主线程。 -->
                  <div v-if="!isTurnMounted(turn)" v-lazy-turn="turn.id" class="turn-placeholder"
                    :data-turn-id="turn.id" :style="{ height: `${estimatedTurnHeight(turn)}px` }">
                    <div class="turn-placeholder__skeleton">
                      <div class="turn-placeholder__line" style="width: 38%" />
                      <div class="turn-placeholder__line" style="width: 62%" />
                    </div>
                  </div>
                  <!-- 事件类消息外壳（turn.kind='event'，compaction/command 等）：渲染专门事件卡片。
                       尾部外边距与普通回合同款（25px）——状态胶囊是不占布局高度的浮层，末尾事件卡
                       没有这层留白会被它盖住（实测重叠 14px；补 25px 后实测净空 11px）。
                       刻意不加 last:min-h-[60vh]：那是整段对话末尾的呼吸位，短小的事件卡套上会
                       留一大片空白（用户反馈）。 -->
                  <div v-else-if="turn.kind === 'event'" class="event-turn" :data-turn-id="turn.id">
                    <EventCard :event="turn" />
                  </div>
                  <TurnItem v-else :data-turn-id="turn.id" :class="{ 'opacity-0': showSkeleton, 'opacity-100': !showSkeleton }"
                    :turn="turn" :avatar="userAvater"
                    :agent-name="currentSession?.agent?.name"
                    :agent-avatar="currentSession?.agent?.avatarUrl" :is-last="index === visibleTurns.length - 1"
                    :allow-generate="!isStreaming && index === lastUserMessageIndex"
                    :animate-in="animateIds.includes(turn.id)" @delete="deleteTurnMessage" @edit="editMessage"
                    @copy="copyMessage" @generate="generateResponse" @regenerate="regenerateResponse"
                    @branch="branchFromTurn"
                    :branching="branchingTurnId === turn.id" :branch-disabled="disableBranch || branchingTurnId !== null"
                    :session-id="currentSessionId || undefined" />                </template>
                <!-- <div class="min-h-60"></div> -->

                <!-- 流式输出状态指示 -->
              </template>
            </template>
          </div>
          <!-- 输入区域：sticky 底部；放入 scroll-main（消息列统一避让，不再独立占位）。
               只读模式（子代理会话）仍渲染：输入区承载停止按钮（流式时可停），
               内部功能（编辑器/配置入口/发送）由 ChatInput 的 readonly 禁用矩阵收口。
               审批/询问卡待答时，输入区三件（编辑提示条 / ChatInput / 工作目录条）整体隐藏，
               由 SessionCards 顶替其位置（见 hasPendingAsk 注释）。 -->
          <div class="chat-input-area sticky bottom-0 left-0 right-0 z-30 pb-2" style="margin-top: auto;">
            <!-- 底部渐变遮罩：输入区上方（滚动区底部）；宽=输入区(=scroll-main 避让) -->
            <div v-if="!hasWallpaper" class="chat-bottom-fade chat-column mx-auto"></div>
            <div class="chat-column mx-auto flex flex-col items-start relative" style="z-index: 1;">

              <!-- 排队消息抽屉：比输入框窄，避开圆角，微透明毛玻璃 -->
              <Transition name="queue-drawer">
                <div v-if="queueLength > 0"
                  class="queue-drawer bg-(--gd-color-surface)/80 backdrop-blur-xl rounded-(--gd-size-dialog-rounded-radius) w-[calc(100%-48px)] margin-auto px-0.5 py-0.5 border-radius-6px mx-auto mb-2">
                  <QueuedMessages :queue="messageQueue" :paused-reason="queuePausedReason"
                    :promoting-id="queuePromotionId" :can-move-up="canMoveQueuedUp"
                    :can-move-down="canMoveQueuedDown" @edit="handleEditQueued" @remove="handleRemoveQueued"
                    @retry="handleRetryQueued" @continue="handleContinueQueue" @pause="handlePauseQueue"
                    @send-now="handleSendNow" @move="handleMoveQueued" />
                </div>
              </Transition>

              <!-- 会话级全局卡：审批卡 / 询问卡（对齐 DSH：sessionId 唯一锚点，不挂回合）。
                   卡片「忽略」= 不回答并停止当前轮 → 复用停止按钮的取消路径（后端仅有
                   "用户停止"能终结一次待答；此刻输入区已隐藏，这也是唯一的停止入口） -->
              <SessionCards :session-id="currentSessionId || undefined" @ignore="abortResponse" />

              <!-- 编辑模式提示条（弹窗待答时随输入区一并隐藏：圆角外形依附输入框，单独留下不成形） -->
              <div v-if="editMode && !hasPendingAsk" class="max-w-full w-full flex px-4">
                <div
                  class="max-w-full w-full flex items-center px-4 py-1.5 rounded-tl-xl rounded-tr-xl bg-(--gd-color-sidebar-bg-active) backdrop-blur-xl">
                  <span class="flex-1 text-sm mr-10 text-gray-700 dark:text-[#c5c7cc]">{{ t('chat.panel.editingMessage')
                    }}</span>
                  <el-button size="small" @click="exitEditMode" class="cancel-edit-btn" plain>
                    {{ t('common.cancel') }}
                  </el-button>
                </div>
              </div>

              <!-- 输入区上方状态行：运行时状态胶囊（待办 / 后台进程 / 子代理）+ 回到底部，并排居中。
                   绝对定位浮层，不占布局高度（见 .composer-status-row 样式注释）。
                   位于避让过侧边栏的 .chat-column 内 → 开侧边栏时与输入框同轴居中。
                   子代理段数据由 ChatPage 经 props 下传（含已冻结项，胶囊内部只取活跃项）。 -->
              <div class="composer-status-row">
                <ComposerStatusBar v-if="!props.readonly"
                  :session-id="currentSessionId || undefined" :sub-sessions="props.subSessions" />
                <!-- 0 宽插槽：按钮在插槽内绝对定位，插槽本身不占宽度。
                     行的居中因此只由胶囊决定 → 按钮出现/消失（到达或离开底部）不再把胶囊横移
                     （实测 18px：胶囊与图标一起跳，与"到底部时图标动了"的现象一致）。
                     三段全空（无胶囊）时按钮是行内唯一元素，由 :has() 那条规则把它自身摆到中轴上；
                     否则插槽锚点居中而按钮画在锚点右侧，会整体偏右半个身位（14px）。 -->
                <div class="scroll-btn-slot">
                  <ScrollToBottomButton :show="showScrollToBottomBtn" @click="handleScrollToBottomClick" />
                </div>
              </div>

              <!-- 弹窗待答时 v-show 隐藏：保持挂载，草稿与编辑器内部状态不丢；
                   display:none 同时退出视觉与可访问树（对齐 ZCode 的 composer 隐藏做法） -->
              <div v-show="!hasPendingAsk" class="w-full flex items-center relative">

                <ChatInput ref="chatInputRef" :key="composerKey" v-model:value="inputMessage.content" v-model:files="inputMessage.files"
                  :session-id="effectiveSessionId" :agent-id="props.session?.agentId || ''"
                  :config="chatInputConfig" :streaming="isStreaming" :readonly="readonly" mode="chat"
                  :config-locked="configLocked"
                  :readonly-placeholder="readonlyPlaceholder"
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

              <!-- 工作目录条：输入框底部外侧（边框容器外）；只读（子代理）不渲染；弹窗待答时随输入区隐藏；
                   工作区全屏时 ChatPanel 被 Teleport 进 430px 宽的悬浮面板，这一条会占掉整行高度（路径换行），直接隐藏 -->
              <WorkingDirBar v-if="!props.readonly && effectiveSessionId && !hasPendingAsk && !inFloatingPanel"
                class="mt-1"
                :session-id="effectiveSessionId"
                :attachments="(props.session?.settings?.attachments as Record<string, string[]> | undefined)"
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
import { ref, computed, watch, nextTick, onMounted, onUnmounted, defineAsyncComponent, type VNode, type Directive } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
const { t } = useI18n()
import { apiService } from "../../services/ApiService";
import { usePopup } from "@/composables/usePopup";
import { useSessionStore } from "../../stores/session";
import { useAuthStore } from "../../stores/auth"
import { useLayoutStore } from "@/stores/layout"
import { useCapabilitiesStore } from "@/stores/capabilities"
import { streamReceiver } from "@/services/modules/StreamReceiver"
import { writeTextToClipboard } from "@/utils/clipboard"
import { SESSION_RESYNC_EVENT } from "@/utils/sessionResync"
import {
  applyLiveChunk,
  foldEvents,
  takeStash as takeProjectorStash,
} from "@/services/modules/streamProjector"
import type { InputMessageState, Session, QueuedMessage, QueuePauseReason } from '@/types/session';
import type { Agent } from '@/types/agent';
import type { Turn, TurnContent, MessageBundle } from '@/types/message';

// 导入新创建的 composables
import { useSessionChat } from '@/composables/useSessionChat'
import { useSessionEvents } from '@/composables/useSessionEvents'
import type { ChatSettingsOverride, ChatStreamParams, ChatStreamResponse } from '@/services/modules/ChatStreamService'
import {
  buildChatSessionScrollMemoryKey,
  clampScrollTop,
  loadChatSessionScrollMemory,
  saveChatSessionScrollMemory,
  shouldRetryScrollMemoryRestore,
  type ChatSessionScrollMemoryState,
} from '@/composables/chatSessionScrollMemory'
import { useMessageOperations, toPayloadFileRefs } from '@/composables/useMessageOperations'
import { useSessionSettingsSync } from '@/composables/useSessionSettingsSync'
import { useSessionTokenStats, applyContextStatsFromEvents } from '@/composables/useSessionTokenStats'
import { isHiddenBlock, toUserMessageView, collectReferencedKbs } from '@/utils/messageUtils'
import { getErrorMessage, getApiErrorStatus } from '@/utils/errorMessage'
import { perfStart, traceSessionOpen, endSessionOpenTrace } from '@/utils/perf'
import {
  parseLocalSlashCommand,
  type LocalSlashCommand,
} from '@/utils/localSlashCommand'
import type { SnipData } from './workspace/FilePreviewPanel.vue'

// 组件导入
import TurnItem from "./TurnItem.vue";
import EventCard from "./EventCard.vue";
import ComposerStatusBar from "./ComposerStatusBar.vue";
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
// 队列补发：打开会话时若后端已空闲但队列非空（错过终态事件）则补一次消费
const { refreshQueue } = useSessionEvents();
const authStore = useAuthStore()
const sessionStore = useSessionStore();
const capabilities = useCapabilitiesStore();
const { scheduleSave, flushSession } = useSessionSettingsSync();
const layoutStore = useLayoutStore();
const router = useRouter();

// 有壁纸时隐藏底部渐变遮罩（壁纸已有视觉层次，不透明遮罩会像补丁）
const hasWallpaper = computed(() => !!layoutStore.wallpaperUrl);

/**
 * 当前是否渲染在悬浮面板里（工作区全屏 → ChatPage 把本组件 Teleport 进 #floating-chat）。
 * 面板默认宽仅 430px，宽屏下按整行排布的元素要据此收窄或隐藏（如工作目录条）。
 */
const inFloatingPanel = computed(() => layoutStore.workspaceFullscreen);

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
  /** 只读模式占位文案覆盖（Bot 会话等旁路宿主用） */
  readonlyPlaceholder?: string;
  /** 输入编辑器重建 key（Bot 会话按 sessionId+只读态切换，保证占位文案随状态更新） */
  composerKey?: string;
  hideHeader?: boolean;    // 隐藏头部（子 Agent）
  /** 子会话列表（ChatPage 维护，含已冻结项）：输入区运行时胶囊的「子代理」段数据源 */
  subSessions?: Session[];
  /** 浮层面板视觉宽（px，0 = 不渲染）；恒为浮层渲染，与占位解耦 */
  asideWidth?: number;
  /** 避让占位宽（px，0 = 不占位）：消息列让位的唯一来源，与浮层面板各管各的 */
  asideReserve?: number;
  /** 自定义发送处理器（Bot 会话续聊等旁路）；缺省走 /chat/stream */
  sendHandler?: (params: ChatStreamParams) => Promise<ChatStreamResponse>;
  /** 禁用回合分支（Bot 页面避免跳转到主聊天路由） */
  disableBranch?: boolean;
}>();

const emit = defineEmits<{
  openSettings: []
  'select-agent': [agent: Agent]  // 切换智能体
  /** 滚动容器可用内容宽变化（决策 aside 显隐用），单位 px（已扣除 padding） */
  'container-resize': [contentWidth: number]
}>();

defineSlots<{
  /** 右侧 aside 槽位：渲染于滚动条左侧、不随消息滚动；宽度由 asideWidth 控制 */
  aside?: () => VNode[]
}>();

// 计算属性 - 类型化
// 只读视图：配置写入统一走 sessionStore.patchSession/patchSessionSettings，
// 让输入区调整立即进入唯一数据源（而不是隐式修改父组件传入的对象）。
const currentSession = computed(() => props.session);

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

/**
 * 弹窗（审批/询问卡）待答中：隐藏输入区，让卡片占据原输入区位置。
 * 对齐 ZCode：pending 交互期间 composer 整体隐藏但**保持挂载**（草稿/编辑器状态不丢），
 * 而非变暗/禁用——询问时输入框本就没有有效用途（自定义回复走卡片自己的输入框）。
 */
const hasPendingAsk = computed(() =>
  sessionStore.sessionPendingAskQueue(currentSessionId.value || '').length > 0
);
const isLoading = ref(true);
// 使用 useSessionChat composable
const {
  hasGeneratedTitle,
  resetTitleFlag,
  generateTitleIfNeeded
} = useSessionChat(sessionStore, apiService)

// 响应式数据
const scrollContainerRef = ref<InstanceType<typeof ScrollContainer> | null>(null);
const chatInputRef = ref<InstanceType<typeof ChatInput> | null>(null);
/** 跟随态镜像（滚动权状态机在 ScrollContainer 内，经 following-change 事件回传）。 */
const isFollowingScroll = ref(true);
/**
 * 待恢复的会话滚动位置（见下方「会话滚动记忆」）。
 * 声明必须在滚动区函数之前：handleFollowingChange 在用户滚动时要清它，
 * 而该函数会在 setup 完成前（ScrollContainer 的事件）就被调用。
 */
let pendingScrollRestore: { key: string; state: ChatSessionScrollMemoryState } | null = null;
/**
 * 待恢复位置是否已经写入过至少一次。
 * 内容撑高的 content-resize 可能早于首次写入到达，那时 scrollTop 还是「刚换完内容」
 * 的初始值（通常 0），拿它去判定「是否已到位」会把待恢复误清、永久停在顶部。
 * 因此未应用前一律不判定到位。
 */
let scrollRestoreApplied = false;
/**
 * 正在执行「会话滚动位置恢复」。
 * 恢复过程会 setFollowing，触发 following-change；该标记让 handleFollowingChange
 * 区分「恢复自己的程序化改动」与「用户真实滚动」，不靠语句先后顺序。
 */
let applyingScrollRestore = false;

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

// ── 关于对话列的亚像素（决策记录） ──
/* 消息列/输入列上曾有一版 JS 吸附（把居中小数与 sticky 自然位置的小数用 transform
   拉回像素网格），已整体移除，对齐 ZCode 基线：整数设计值 + 浏览器默认渲染
   （未变换元素的盒边与文字基线由绘制期像素吸附保证清晰）。
   原因：a) 模糊的主力是 CSS 整数化修复（行高/图标/边框取整），吸附只覆盖
   居中与 sticky 两类残余；b) 列上常驻 transform 在非整数 dpr（125%/150%）下
   经变换矩阵参与绘制、不做逐元素吸附，实测「调整分辨率后输入区整体发虚」。
   若将来实测出现必须对齐的场景，重引入时必须按设备网格落点
   （dx = round(布局位置 × dpr) / dpr − 布局位置，历史实现见 git 357effa1），
   不要用整 CSS px 网格（125% 下实测发虚）。 */

// ── 滚动锚定：状态机在 ScrollContainer（useScrollAnchor）内 ──
/* 旧实现在这里用「scroll 事件里 scrollTop 回退超 10px」反推用户上滚，并配一个
   provide('lockScrollAnchor') 全局开关——展开思考框时锁住自动贴底、靠用户下次贴底恢复。
   启发式与 ScrollContainer 的 ResizeObserver 无条件贴底存在竞态：内容增高的同一帧里
   用户的上滚会被掩盖，随后的贴底把人拽回底部。现已整体换成显式状态机：
   following = 用户滚动权，只有真实用户输入能改变它，布局/程序化滚动不得改变。
   TurnItem.vue / MessageThinkingSection.vue 里的 inject('lockScrollAnchor') 带 no-op
   默认值，provider 撤掉后自动降级——展开分组不再是「需要锁的例外」，
   它是布局变化，按状态机语义本就动不了 following。 */

// 消息分页加载相关状态
const INITIAL_PAGE_SIZE = 30 // 首次加载消息数量
const MESSAGES_PAGE_SIZE = 15 // 后续每次加载消息数量
const isLoadingMore = ref(false)
const hasMoreMessages = ref(true)

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
/** 队列暂停原因：停止/出错/手动后保留队列但不自动补发，横幅提示用户继续 */
const queuePausedReason = computed<QueuePauseReason | null>(() => {
  return currentSessionId.value ? sessionStore.queuePauseReason(currentSessionId.value) : null;
});
/** 已请求"立即发送"、等待当前回合结束的队列项 */
const queuePromotionId = computed<string | null>(() => {
  return currentSessionId.value ? sessionStore.queuePromotionId(currentSessionId.value) : null;
});

/**
 * 上/下移可用态：与服务端规则一致（running 前缀之后、第一个 failed 之前）。
 * 仅用于按钮禁用态；真正校验在服务端。
 */
function canMoveQueued(id: string, direction: -1 | 1): boolean {
  const queue = messageQueue.value;
  const idx = queue.findIndex(m => m.id === id);
  if (idx < 0 || queue[idx].status !== 'queued') return false;
  let lower = 0;
  while (lower < queue.length && queue[lower].status === 'running') lower++;
  const failedIdx = queue.findIndex(m => m.status === 'failed');
  const upper = failedIdx < 0 ? queue.length : failedIdx;
  const target = idx + direction;
  return (
    idx >= lower &&
    target >= lower &&
    target < upper &&
    queue[target]?.status === 'queued'
  );
}
function canMoveQueuedUp(id: string): boolean {
  return canMoveQueued(id, -1);
}
function canMoveQueuedDown(id: string): boolean {
  return canMoveQueued(id, 1);
}

// 补发开始时复用直接发送的入场动画与滚底；失败则撤销，避免下一个无关回合误触发
watch(
  () => messageQueue.value[0]?.status,
  (status) => {
    if (status === 'running') {
      expectingNewMessage = true;
    } else if (status === 'failed') {
      expectingNewMessage = false;
    }
  },
  { immediate: true },
);

// 滚动管理相关状态和方法（按钮显隐的展示态定义在 visibleTurns 之后）

/**
 * 回到底部（点击输入区上方的悬浮按钮）。
 *
 * 语义是「恢复跟随」而不是「跑一次滚动」：
 * - 只做一次滚动、靠落点事后判回跟随，流式内容继续增长时目标会过期——
 *   平滑动画追的是点击瞬间的 scrollHeight，落点可能距新底部很远，
 *   且动画中间帧会把跟随态按落点重算回 false，贴底路径不再接管。
 * - 因此先置 following=true（后续任何尺寸增长都会继续贴底），再选滚动方式。
 *
 * 滚动方式：流式中底部是移动目标，平滑动画的固定终点天然追不上，用即时跳转；
 * 非流式内容静止，保留平滑动画。
 */
function scrollToBottom() {
  const container = scrollContainerRef.value
  if (!container) return
  // 用户接管：放弃未决的会话位置恢复，避免两套机制抢位置
  pendingScrollRestore = null
  // 清掉残留滚动意图：刚上滚过时 awayFromBottom 仍在 1.2s 有效期内，
  // 会把按钮驱动的滚动重新判成用户上滚，跟随态被中间落点算回 false
  container.clearUserScrollIntent?.()
  container.setFollowing(true)
  if (isStreaming.value) {
    container.immediateScrollToBottom()
  } else {
    container.smoothScrollToBottom()
  }
}

/**
 * 立即滚动到底部
 */
function immediateScrollToBottom() {
  scrollContainerRef.value?.immediateScrollToBottom()
}

/**
 * 跟随态变化（滚动权事件，非几何快照）：只更新镜像状态。
 * 按钮显隐统一由 showScrollToBottomBtn computed 派生（定义在 visibleTurns 之后，
 * 避免初始化顺序依赖——watch 注册时会立即求值一次 getter，读到 TDZ 里的
 * visibleTurns 就是 ReferenceError）。
 */
function handleFollowingChange(following: boolean) {
  isFollowingScroll.value = following;
  // 用户重新拿到滚动权就放弃待恢复（别跟用户抢位置）。
  // 但会话恢复自己也会 setFollowing，那不是用户意图——用 applyingScrollRestore
  // 显式排除，不靠调用顺序（否则恢复登记会被自己这一步同步清掉，位置永远停在顶部）。
  if (!following && pendingScrollRestore && !applyingScrollRestore) {
    pendingScrollRestore = null;
  }
}

/** 到顶：按分页游标拉取更早一页（在途标记与游标判定留在本组件）。 */
function handleNearTop() {
  // 懒挂载：先补齐已加载但尚未挂载的回合（小批量 + 锚点补偿），避免把"占位区顶部"误判成历史到顶。
  if (hasUnmountedTurns.value) {
    mountNextUnmountedBatch(8);
    return;
  }
  if (!hasMoreMessages.value || isLoadingMore.value || !currentSessionId.value) return;
  // 分页游标：事件页的 nextBeforeSeq（null = 无更早内容）
  const eventCursor =
    sessionStore.getSessionState(currentSessionId.value)?.eventCursor ?? null;
  if (eventCursor != null) {
    // 立即设置标记，防止重复触发
    isLoadingMore.value = true;
    loadMoreMessages(currentSessionId.value, eventCursor);
  }
}

/**
 * 处理滚动事件
 *
 * 滚动权裁决全部在状态机内完成（ScrollContainer 的 useScrollAnchor），
 * 这里只做展示层同步——按钮显隐是 computed 派生的，无需额外动作。
 */
function handleScroll() {
  // 按钮显隐由 showScrollToBottomBtn（跟随态 + 回合数派生），无需在此写入状态。
  // 保留本函数作为 @scroll 的接线点：ScrollContainer 的 emit 需要监听方。
  // 几何兜底：后台/遮挡时 IntersectionObserver 可能不回调，滚动时按位置补挂占位。
  scheduleMountVisiblePlaceholders()
  // 锚点保持器：滚动后重记视口内第一个回合，作为内容高度变化的参照
  scheduleAnchorRefresh()
}

/**
 * 处理滚动按钮点击
 */
function handleScrollToBottomClick() {
  scrollToBottom()
}

// ── 会话滚动记忆（切走再回来恢复阅读位置，而不是每次强制贴底） ──
// 按 session 记忆绝对 scrollTop + 贴底态；恢复要等内容就位后重试：屏外回合带
// content-visibility，首帧按 contain-intrinsic-size 估算，记忆位置可能超出当时的
// 可滚动范围（被浏览器钳到上限），内容撑高后需再落一次。

function scrollMemoryKeyFor(sessionId: string | null | undefined): string | null {
  if (!sessionId) return null;
  return buildChatSessionScrollMemoryKey(sessionId);
}

/** 离开会话前保存滚动位置与跟随态（须在容器内容被替换之前调用）。 */
function captureScrollMemoryForSession(sessionId: string | null) {
  if (!sessionId) return;
  const metrics = scrollContainerRef.value?.getScrollMetrics?.();
  if (!metrics) return;
  const key = scrollMemoryKeyFor(sessionId);
  if (!key) return;
  saveChatSessionScrollMemory(key, {
    scrollTop: metrics.scrollTop,
    scrollHeight: metrics.contentHeight,
    clientHeight: metrics.viewportHeight,
    wasPinnedToBottom: isFollowingScroll.value,
    updatedAt: Date.now(),
  });
}

/** 会话加载完成后按记忆恢复位置；无记忆（首次打开）保持贴底默认。 */
async function applyScrollRestoreForSession() {
  await nextTick();
  const sessionId = currentSessionId.value;
  if (!sessionId) return;
  const key = scrollMemoryKeyFor(sessionId);
  const container = scrollContainerRef.value;
  if (!key || !container) return;
  traceSessionOpen(sessionId, 'scroll:restore-start');
  const state = loadChatSessionScrollMemory(key);
  if (!state) {
    traceSessionOpen(sessionId, 'scroll:no-memory-bottom');
    pendingScrollRestore = null;
    container.setFollowing(true);
    container.scrollToBottomProgrammatic('auto');
    return;
  }
  // 贴底记忆直接贴底：内容可能已大幅变化，绝对位置无意义；后续内容撑高由
  // 状态机的尺寸增长贴底路径继续跟随，无需恢复重试。
  // 非贴底记忆先取回用户滚动权（读到中间时按钮该出现），再落到记忆位置。
  applyingScrollRestore = true;
  container.setFollowing(state.wasPinnedToBottom);
  // setFollowing(true) 在值未变时不发事件，按钮状态需手动收敛一次
  handleFollowingChange(container.isFollowing());
  if (state.wasPinnedToBottom) {
    applyingScrollRestore = false;
    traceSessionOpen(sessionId, 'scroll:pinned-bottom');
    container.scrollToBottomProgrammatic('auto');
    return;
  }
  // 待恢复登记放在 setFollowing 之后：handleFollowingChange 里「失去跟随权就放弃
  // 待恢复」的分支是给用户中途滚动用的，不能把它自己这步 setFollowing 也算进去。
  // （applyingScrollRestore 已兜住；顺序 + 标记双保险。）
  scrollRestoreApplied = false;
  pendingScrollRestore = { key, state };
  traceSessionOpen(sessionId, 'scroll:restore-apply', {
    top: state.scrollTop,
    height: state.scrollHeight,
  });
  applyPendingScrollRestore();
  applyingScrollRestore = false;
}

function applyPendingScrollRestore() {
  if (!pendingScrollRestore) return;
  const container = scrollContainerRef.value;
  if (!container) return;
  const metrics = container.getScrollMetrics?.();
  if (!metrics) return;
  scrollRestoreApplied = true;
  container.applyScrollTop(clampScrollTop(pendingScrollRestore.state, metrics));
  traceSessionOpen(currentSessionId.value, 'scroll:applied', {
    target: pendingScrollRestore.state.scrollTop,
    contentHeight: metrics.contentHeight,
  });
}

/**
 * 内容尺寸变化时的恢复重试：内容首帧不足（屏外回合仍按 contain-intrinsic-size 估算）
 * 会把目标钳到上限之下，等撑高后补落一次；到位或用户滚动（意图优先）即放弃。
 * 贴底记忆不在此列——后续撑高由状态机的尺寸增长贴底路径继续跟随。
 */
function handleContentResizeForScrollRestore() {
  // 折叠/展开、图片加载、懒挂载等都会改变内容高度：
  // 1) 触发几何兜底，补挂新进入视口附近的占位；
  // 2) 非贴底时把视口锚点钉回原位，避免内容被顶走。
  scheduleMountVisiblePlaceholders()
  scheduleAnchorRestore()
  if (!pendingScrollRestore || isFollowingScroll.value) return;
  // 首次写入之前一律不判定到位：此刻 scrollTop 还是替换内容后的初始值，
  // 拿它比目标只会把待恢复误清掉（切换会话回来停在顶部就是这个原因）。
  if (scrollRestoreApplied) {
    const metrics = scrollContainerRef.value?.getScrollMetrics?.();
    if (metrics && !shouldRetryScrollMemoryRestore(pendingScrollRestore.state, metrics.scrollTop)) {
      pendingScrollRestore = null;
      traceSessionOpen(currentSessionId.value, 'scroll:settled');
      // 恢复完成后以当前视口重新建立锚点，避免沿用恢复前的旧位置
      rememberContentAnchor();
      return;
    }
  }
  traceSessionOpen(currentSessionId.value, 'scroll:retry');
  applyPendingScrollRestore();
}

// （旧扁平 activeMessages computed 已删：回合制重构后 store 的扁平 messages 数组无人写入，
//  该 computed 恒返回 []，曾连带导致 ChatOutline 大纲与首轮标题自动生成双双失效。
//  渲染与对外暴露统一走回合列表 activeTurns / visibleTurns。）

// 直接消费后端 Turn[]（不再打平为扁平消息再按 parentId 归组）
const activeTurns = computed(() => {
  const sessionId = currentSessionId.value;
  return sessionId && !isLoading.value ? sessionStore.getTurns(sessionId) || [] : [];
});

// 从回合中取用户锚点块（role=user 且为人类输入），渲染与操作均基于该块（二级结构：turn → block）
// 后端注入的 hidden user 消息（拦截器/图片/待办/压缩）同 role 但非用户输入，须排除
const userOfTurn = (turn: Turn | undefined): MessageBundle | null =>
  turn?.messages?.find((m) => m.role === 'user' && !isHiddenBlock(m)) ?? null;

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

/**
 * 「回到底部」按钮显隐：跟随态 + 有内容，全部由状态派生。
 * 定义位置必须在 visibleTurns 之后——模板/setter 的注册期求值不会踩 TDZ。
 * 不做防抖：跟随态是由明确输入驱动的离散状态，按钮又是绝对定位浮层，
 * 显隐不改变 scrollHeight，不存在旧实现担心的「按钮增删顶跳消息」问题。
 */
const showScrollToBottomBtn = computed(() =>
  !isFollowingScroll.value && visibleTurns.value.length > 0,
);

// ============================================
// 回合懒挂载：首屏只挂载最后 N 个回合，其余用等高占位；接近视口再挂载并保留（不卸载）。
// 目的：30 回合 × 数千组件一次性 mount 会阻塞主线程 1s+（实测 ~1.4–1.6s）。
// 关闭：localStorage['gd:lazy-turns']='0' 后刷新。
// 安全回退：非贴底滚动记忆、滚到顶要加载更早历史、大纲跳转 → 全量挂载。
// ============================================
const LAZY_TURNS_INITIAL = 8
const LAZY_TURN_ESTIMATE_PX = 800
const LAZY_TURNS_KEY = 'gd:lazy-turns'
const lazyTurnsEnabled = (() => {
  try {
    return localStorage.getItem(LAZY_TURNS_KEY) !== '0'
  } catch {
    return true
  }
})()
const mountedTurnIds = ref<Set<string>>(new Set())
let prevVisibleTurnIds: string[] = []

const isTurnMounted = (turn: Turn): boolean =>
  !lazyTurnsEnabled || mountedTurnIds.value.has(turn.id)

const estimatedTurnHeight = (turn: Turn): number =>
  turn.kind === 'event' ? 160 : LAZY_TURN_ESTIMATE_PX

const hasUnmountedTurns = computed(() =>
  lazyTurnsEnabled && visibleTurns.value.some((t) => !mountedTurnIds.value.has(t.id)),
)

/** 会话打开（骨架屏隐藏）时初始化挂载窗口；非贴底记忆直接全量，避免恢复位置落在占位区。 */
function resetLazyMountForOpen() {
  const list = visibleTurns.value
  prevVisibleTurnIds = list.map((t) => t.id)
  if (!lazyTurnsEnabled) {
    mountedTurnIds.value = new Set(prevVisibleTurnIds)
    return
  }
  const sessionId = currentSessionId.value
  const key = sessionId ? scrollMemoryKeyFor(sessionId) : null
  const memory = key ? loadChatSessionScrollMemory(key) : null
  if (memory && memory.wasPinnedToBottom === false) {
    mountedTurnIds.value = new Set(prevVisibleTurnIds)
    return
  }
  const start = Math.max(0, list.length - LAZY_TURNS_INITIAL)
  mountedTurnIds.value = new Set(list.slice(start).map((t) => t.id))
}

/** 全量挂载已加载回合（大纲跳转等需要真实 offsetTop 的场景；不做滚动补偿）。 */
function mountAllLoadedTurns() {
  const list = visibleTurns.value
  if (list.length === 0) return
  if (list.every((t) => mountedTurnIds.value.has(t.id))) return
  mountedTurnIds.value = new Set(list.map((t) => t.id))
}

/**
 * 到顶兜底：只挂载紧邻当前窗口的一小批（而不是一次性 20+ 个），
 * 每批用锚点补偿，避免"内容突然被顶出去"。
 */
function mountNextUnmountedBatch(count = 8) {
  const list = visibleTurns.value
  const unmounted = list.filter((t) => !mountedTurnIds.value.has(t.id))
  if (unmounted.length === 0) return
  mountPlaceholders(unmounted.slice(-count).map((t) => t.id))
}

// 新回合（流式追加）自动挂载；删除的回合清理；同一会话内不重置已挂载集合。
watch(() => visibleTurns.value.map((t) => t.id), (ids) => {
  if (!lazyTurnsEnabled) {
    prevVisibleTurnIds = ids
    return
  }
  const prev = new Set(prevVisibleTurnIds)
  const next = new Set(mountedTurnIds.value)
  let changed = false
  for (const id of ids) {
    if (!prev.has(id) && !next.has(id)) {
      next.add(id)
      changed = true
    }
  }
  for (const id of next) {
    if (!ids.includes(id)) {
      next.delete(id)
      changed = true
    }
  }
  prevVisibleTurnIds = ids
  if (changed) mountedTurnIds.value = next
})

// 占位观察：进入视口上下各 800px 即挂载并保留。
let turnObserver: IntersectionObserver | null = null
const lazyPlaceholderEls = new Map<string, HTMLElement>()

interface LazyScrollAnchor {
  id: string
  /** 相对滚动视口顶部的屏幕位置 */
  top: number
}

/** 取视口内第一个回合/占位作为锚点（按 DOM 顺序）。 */
function captureLazyAnchor(root: HTMLElement): LazyScrollAnchor | null {
  const rootRect = root.getBoundingClientRect()
  for (const el of root.querySelectorAll<HTMLElement>('[data-turn-id]')) {
    const rect = el.getBoundingClientRect()
    if (rect.bottom <= rootRect.top) continue
    if (rect.top >= rootRect.bottom) break
    const id = el.dataset.turnId
    if (!id) continue
    return { id, top: rect.top - rootRect.top }
  }
  return null
}

// ── 内容锚点保持器：折叠/展开、图片加载、占位挂载等高度变化时，保持视口内
//    第一个回合/占位的位置不变（非贴底时）。与懒挂载的挂载补偿共用同一套。 ──
interface ContentAnchor extends LazyScrollAnchor {
  /** 记录锚点时的 scrollTop，用于区分用户滚动 */
  scrollTop: number
}

let contentAnchor: ContentAnchor | null = null
let anchorRestoreScheduled = false
let anchorRefreshTimer: ReturnType<typeof setTimeout> | null = null

/** 记录当前视口内第一个回合/占位的屏幕位置。 */
function rememberContentAnchor() {
  const root = scrollContainerRef.value?.getScrollElement?.()
  if (!root) {
    contentAnchor = null
    return
  }
  const anchor = captureLazyAnchor(root)
  contentAnchor = anchor ? { ...anchor, scrollTop: root.scrollTop } : null
}

/** 滚动后短延迟刷新锚点（合并高频 scroll，避免每帧读布局）。 */
function scheduleAnchorRefresh() {
  if (anchorRefreshTimer !== null) return
  anchorRefreshTimer = setTimeout(() => {
    anchorRefreshTimer = null
    rememberContentAnchor()
  }, 16)
}

/** 内容高度变化后，在 nextTick 把锚点钉回原位（非贴底时）。 */
function scheduleAnchorRestore() {
  if (anchorRestoreScheduled) return
  if (!contentAnchor || isFollowingScroll.value || pendingScrollRestore || applyingScrollRestore) return
  anchorRestoreScheduled = true
  nextTick(() => {
    anchorRestoreScheduled = false
    restoreContentAnchor()
  })
}

function restoreContentAnchor() {
  const anchor = contentAnchor
  if (!anchor || isFollowingScroll.value || pendingScrollRestore || applyingScrollRestore || showSkeleton.value) return
  const root = scrollContainerRef.value?.getScrollElement?.()
  if (!root) return
  // 用户已经滚动：旧锚点失效，按新位置重记，不与用户抢滚动权
  if (Math.abs(root.scrollTop - anchor.scrollTop) > 1) {
    rememberContentAnchor()
    return
  }
  const anchorEl = root.querySelector<HTMLElement>(`[data-turn-id="${CSS.escape(anchor.id)}"]`)
  if (!anchorEl) {
    contentAnchor = null
    return
  }
  const rootTop = root.getBoundingClientRect().top
  const currentTop = anchorEl.getBoundingClientRect().top - rootTop
  const delta = currentTop - anchor.top
  if (Math.abs(delta) < 1) return
  scrollContainerRef.value?.markLayoutScroll?.()
  root.scrollTop += delta
  // 回读校正后的位置；若被浏览器钳制（如顶到 0），以实际位置为准
  const afterTop = anchorEl.getBoundingClientRect().top - root.getBoundingClientRect().top
  contentAnchor = {
    id: anchor.id,
    top: Math.abs(afterTop - anchor.top) > 1 ? afterTop : anchor.top,
    scrollTop: root.scrollTop,
  }
}

/**
 * 统一挂载入口：Observer 与滚动几何兜底共用。
 * 挂载前记录视口锚点，挂载后由内容锚点保持器把同一锚点钉回原位。
 */
function mountPlaceholders(ids: string[]) {
  const next = new Set(mountedTurnIds.value)
  let changed = false
  for (const id of ids) {
    if (!next.has(id)) {
      next.add(id)
      changed = true
    }
  }
  if (!changed) return

  if (!isFollowingScroll.value && !pendingScrollRestore) rememberContentAnchor()
  mountedTurnIds.value = next
  scheduleAnchorRestore()
}

/**
 * 几何兜底：不依赖 IntersectionObserver（后台/被遮挡时可能不回调），
 * 滚动或列表刚挂载时直接按占位与滚动视口的相对位置挂载。80ms 合并一次。
 */
let visibleCheckTimer: ReturnType<typeof setTimeout> | null = null
function scheduleMountVisiblePlaceholders() {
  if (!lazyTurnsEnabled || lazyPlaceholderEls.size === 0) return
  if (visibleCheckTimer !== null) return
  visibleCheckTimer = setTimeout(() => {
    visibleCheckTimer = null
    mountVisiblePlaceholders()
  }, 80)
}

function mountVisiblePlaceholders() {
  if (!lazyTurnsEnabled || lazyPlaceholderEls.size === 0) return
  const root = scrollContainerRef.value?.getScrollElement?.()
  if (!root) return
  const rootRect = root.getBoundingClientRect()
  const margin = 800
  const ids: string[] = []
  for (const [id, el] of lazyPlaceholderEls) {
    if (mountedTurnIds.value.has(id)) continue
    const rect = el.getBoundingClientRect()
    if (rect.bottom < rootRect.top - margin || rect.top > rootRect.bottom + margin) continue
    ids.push(id)
  }
  mountPlaceholders(ids)
}

function ensureTurnObserver(): IntersectionObserver | null {
  if (turnObserver) return turnObserver
  if (typeof IntersectionObserver === 'undefined') return null
  const root = scrollContainerRef.value?.getScrollElement?.() ?? null
  if (!root) return null
  turnObserver = new IntersectionObserver((entries) => {
    const ids: string[] = []
    for (const entry of entries) {
      const id = (entry.target as HTMLElement).dataset.turnId
      if (!entry.isIntersecting || !id || mountedTurnIds.value.has(id)) {
        turnObserver?.unobserve(entry.target)
        continue
      }
      ids.push(id)
      turnObserver?.unobserve(entry.target)
    }
    mountPlaceholders(ids)
  }, {
    root,
    rootMargin: '800px 0px',
    threshold: 0,
  })
  return turnObserver
}

const vLazyTurn: Directive<HTMLElement, string> = {
  mounted(el, binding) {
    el.dataset.turnId = binding.value
    lazyPlaceholderEls.set(binding.value, el)
    const observer = ensureTurnObserver()
    if (observer) {
      observer.observe(el)
    } else {
      // 无 IntersectionObserver / 根节点未就绪：退化为立即挂载，避免内容永久空白
      mountedTurnIds.value = new Set([...mountedTurnIds.value, binding.value])
    }
  },
  unmounted(el, binding) {
    turnObserver?.unobserve(el)
    lazyPlaceholderEls.delete(binding.value)
  },
}

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
    // 发消息是明确的「看新回合」意图：即便此前在上滚阅读，也取回跟随——
    // 否则新回复流式增长时内容继续在视野外长高，底部位置不再跟随。
    scrollContainerRef.value?.setFollowing(true);
    immediateScrollToBottom()
  })
});

const currentModelId = computed({
  get() {
    // 会话未绑定时显示智能体默认模型：与后端运行时回退链保持一致
    return currentSession.value?.modelId || currentSession.value?.agent?.modelId || null;
  },
  set(value: string | null) {
    const session = currentSession.value;
    if (!session) return;
    sessionStore.patchSession(session.id, {
      modelId: value,
      // 仅 Bot 会话维护来源标记；Web 会话没有「跟随 Bot 默认」语义
      ...(session.sessionType === 'bot'
        ? { modelSource: value ? 'session' : null }
        : {}),
    });
    scheduleSave(session.id, { modelId: value });
  }
});

/**
 * Bot 会话的模型 / 思考强度 / 知识库统一由 Bot 配置决定：
 * 输入区只展示当前值，不提供自选入口（Web 会话不受影响）。
 */
const configLocked = computed(
  () => currentSession.value?.sessionType === 'bot',
);


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

/** settings 开放字典（索引签名收敛为 unknown）的收窄读取切片，与下方 handleConfigChange 的写回字段一一对应 */
type SessionSettingsView = {
  maxTokensLimit?: number | null
  referencedKbs?: string[]
  sandboxMode?: string
  attachments?: Record<string, string[]>
}

const chatInputConfig = computed(() => {
  // 断言只作用于读取切片，运行时仍是同一个 settings 对象
  const settings = currentSession.value?.settings as SessionSettingsView | undefined;
  return {
    modelId: currentModelId.value,
    // Bot 会话：区分用户显式选择与会话运行时跟随的 Bot/智能体默认模型
    modelSource: currentSession.value?.modelSource ?? null,
    // 未设置 = 会话从未选过档位 → 交给 ChatInput 取菜单默认中间档（不要在这里填 'none'）
    thinkingEffort: currentSession.value?.settings?.thinkingEffort || undefined,
    maxTokensLimit: settings?.maxTokensLimit ?? null,
    knowledgeBaseIds: inputMessage.value?.knowledgeBaseIds || settings?.referencedKbs || [],
    workspacePath: currentSession.value?.workspacePath || null,
    sandboxMode: capabilities.normalize(settings?.sandboxMode),
    // 计划模式读 UI 投影（不是设置直读）：模型经 ExitPlanMode 退出时流帧只更新投影与会话对象，
    // 由下方 watcher 与设置收敛，这里始终取当前生效值。
    planEnabled: currentSessionId.value
      ? sessionStore.sessionPlanEnabled(currentSessionId.value)
      : false,
    attachments: settings?.attachments || {},
  };
});

/**
 * SSE 重连后的状态重同步：本地认为仍在流式、但服务端已结束（息屏期间回合跑完）
 * 时，useSessionEvents 会派发该事件，这里强制重载当前会话历史。
 */
function handleSessionResync(event: Event) {
  const sessionId = (event as CustomEvent<{ sessionId?: string }>).detail?.sessionId
  if (!sessionId || sessionId !== effectiveSessionId.value) return
  const state = sessionStore.getSessionState(sessionId)
  if (!state) return
  // 绕过 loadMessages 的 loaded 缓存门禁，按服务端最新事件重建消息树
  state.loaded = false
  void loadSession(sessionId)
}

onMounted(() => {
  // 附加连接类型由 ChatInput 内部自行加载渲染标签,此处不再维护
  window.addEventListener(SESSION_RESYNC_EVENT, handleSessionResync)
  ensureTurnObserver()
});

onUnmounted(() => {
  window.removeEventListener(SESSION_RESYNC_EVENT, handleSessionResync)
  clearSkeletonTimers();
  chatResizeObserver?.disconnect();
  chatResizeObserver = null;
  turnObserver?.disconnect();
  turnObserver = null;
  if (visibleCheckTimer !== null) {
    clearTimeout(visibleCheckTimer);
    visibleCheckTimer = null;
  }
  if (anchorRefreshTimer !== null) {
    clearTimeout(anchorRefreshTimer);
    anchorRefreshTimer = null;
  }
  contentAnchor = null;
  lazyPlaceholderEls.clear();
});

/**
 * 工作目录条（输入框下方）的附加远程目录绑定变更：与 handleConfigChange 的
 * attachments 分支同构——先写 store（本地立即生效），再把最新 settings 交给保存队列。
 */
const handleAttachmentsChange = (attachments: Record<string, string[]>) => {
  const session = currentSession.value;
  if (!session) return;
  sessionStore.patchSessionSettings(session.id, { attachments });
  const settings = sessionStore.getSession(session.id)?.settings;
  if (settings) scheduleSave(session.id, { settings });
};

/**
 * 处理 ChatInput 配置变更
 * 与 chatInputConfig 计算属性中的字段一一对应
 */
/** ChatInput 配置回传（字段与下方 chatInputConfig 计算属性一一对应） */
interface ChatInputConfigChange {
  modelId?: string | null
  thinkingEffort?: string
  maxTokensLimit?: number | null
  knowledgeBaseIds?: string[]
  workspacePath?: string | null
  sandboxMode?: string
  planEnabled?: boolean
  [key: string]: unknown
}

/**
 * 输入区配置变更的唯一写入口：
 * 1. 立即写 sessionStore（本地发布，所有读同一 store 的视图同步更新）；
 * 2. 把“调用时刻”的字段快照交给保存队列（按 sessionId 隔离、在途合并）。
 *
 * 不再隐式修改父组件传入的 props 对象，也不依赖防抖定时器。
 */
const handleConfigChange = (config: ChatInputConfigChange) => {
  const session = currentSession.value;
  if (!session) return;
  const sessionId = session.id;
  let modelIdChanged = false;
  let settingsChanged = false;

  // 处理模型 ID 变更
  if (typeof config.modelId !== 'undefined') {
    sessionStore.patchSession(sessionId, {
      modelId: config.modelId,
      // 仅 Bot 会话维护来源标记；Web 会话没有「跟随 Bot 默认」语义
      ...(session.sessionType === 'bot'
        ? { modelSource: config.modelId ? 'session' : null }
        : {}),
    });
    modelIdChanged = true;
  }

  // 处理 Token 上限（会话级别独立配置；null = 恢复不限）
  if (typeof config.maxTokensLimit !== 'undefined') {
    sessionStore.patchSessionSettings(sessionId, { maxTokensLimit: config.maxTokensLimit });
    settingsChanged = true;
  }

  // 处理思考强度变更
  if (typeof config.thinkingEffort !== 'undefined') {
    sessionStore.patchSessionSettings(sessionId, { thinkingEffort: config.thinkingEffort });
    settingsChanged = true;
  }

  // 处理知识库选择：inputMessage 是每设备草稿态，settings.referencedKbs 才是跨端同步字段
  if (typeof config.knowledgeBaseIds !== 'undefined') {
    inputMessage.value.knowledgeBaseIds = config.knowledgeBaseIds;
    if (!editMode.value) {
      sessionStore.patchSessionSettings(sessionId, { referencedKbs: config.knowledgeBaseIds });
      settingsChanged = true;
    }
  }

  // 工作目录路径不在 updateSession 白名单内，只做本地展示（与旧行为一致）
  if (typeof config.workspacePath !== 'undefined') {
    sessionStore.patchSession(sessionId, { workspacePath: config.workspacePath });
  }

  // 处理安全模式
  if (typeof config.sandboxMode !== 'undefined') {
    // Windows 后端已取消 read-only：本地乐观更新也收敛，避免 UI 短暂显示已取消档位
    sessionStore.patchSessionSettings(sessionId, { sandboxMode: capabilities.normalize(config.sandboxMode) });
    settingsChanged = true;
  }

  // 处理计划模式（协作状态）：设置是事实源，同时写投影让指示器立即生效
  if (typeof config.planEnabled !== 'undefined') {
    sessionStore.patchSessionSettings(sessionId, { planEnabled: config.planEnabled });
    sessionStore.setSessionPlanEnabled(sessionId, config.planEnabled);
    settingsChanged = true;
  }

  // 处理附加连接
  if (typeof config.attachments !== 'undefined') {
    sessionStore.patchSessionSettings(sessionId, { attachments: config.attachments });
    settingsChanged = true;
  }

  if (!modelIdChanged && !settingsChanged) return;

  const latest = sessionStore.getSession(sessionId);
  scheduleSave(sessionId, {
    ...(modelIdChanged ? { modelId: latest?.modelId ?? config.modelId ?? null } : {}),
    ...(settingsChanged && latest?.settings ? { settings: latest.settings } : {}),
  });
};

// 监听器
watch(() => props.session?.id || props.sessionId, async (newSessionId: string | undefined, oldSessionId: string | undefined) => {
  const newId = newSessionId ?? props.sessionId ?? null;
  const effectiveOldId = oldSessionId ?? null;
  traceSessionOpen(newId, 'panel:watch-fired', { old: effectiveOldId ?? 'none' });
  captureScrollMemoryForSession(effectiveOldId);
  await handleSessionChange(newId, effectiveOldId);
  await applyScrollRestoreForSession();
}, { immediate: true });

/**
 * 计划模式 UI 投影：从会话设置（事实源）单向同步。
 *
 * 覆盖三个来源——会话切换/刷新加载、用户开关（写设置后回流）、模型经 ExitPlanMode 退出
 * （流帧写设置后回流）。收敛成"设置 → 投影"一条方向，避免两处各写一半导致刷新后回退。
 */
watch(
  () => [currentSessionId.value, currentSession.value?.settings?.planEnabled] as const,
  ([id, enabled]) => {
    if (id) sessionStore.setSessionPlanEnabled(id, enabled === true);
  },
  { immediate: true },
);

// 监听流式状态变化，在第一次对话完成后生成标题
watch(() => isStreaming.value, async (newVal, oldVal) => {
  // 当流式状态从 true 变为 false 时（即智能体回复完成）
  if (oldVal === true && newVal === false) {
    // 首轮对话完成：可见回合恰为一个，且有 user 锚点 + 有内容的 assistant 回复
    // （旧扁平模型判 messages.length == 2；回合制后改判回合，语义等价）
    const firstTurn = visibleTurns.value[0];
    const firstExchangeDone =
      visibleTurns.value.length === 1 &&
      !!userOfTurn(firstTurn) &&
      (firstTurn?.messages || []).some(
        (m) => m.role === 'assistant' && m.blocks?.some((b) => b?.content),
      );
    if (firstExchangeDone && !hasGeneratedTitle.value) {
      await generateTitleIfNeeded(currentSessionId.value!, currentSession);
    }
  }
}, { immediate: true });


/**
  * 加载会话配置和消息（首次加载，只加载最近 N 条）
  */
async function loadSession(sessionId: string) {
  await loadMessages(sessionId, { isInitial: true });
  traceSessionOpen(sessionId, 'panel:load-messages-done');
  // 上下文占用：逆向扫描事件日志最后一个锚点（turn/finish / compaction/end 等）填充环形指示器。
  // 无锚点 → 显示 0，绝不访问 token-stats（唯一 REST 入口 = 记忆弹窗打开时按需拉取 breakdown）。
  const eventLog = sessionStore.getSessionState(sessionId).eventLog || [];
  const statsSpan = perfStart('session.contextStats');
  try {
    applyContextStatsFromEvents(sessionId, eventLog);
  } finally {
    statsSpan?.end({ events: eventLog.length });
    traceSessionOpen(sessionId, 'panel:context-stats-done');
  }
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
    traceSessionOpen(sessionId, 'panel:cache-gate', {
      loaded: sessionState.loaded === true ? 1 : 0,
      turns: sessionState.turns?.length ?? 0,
      events: sessionState.eventLog?.length ?? 0,
    });
    if (sessionState.loaded === true) {
      // 恢复本会话自己的分页状态(组件级单例 ref 会残留上一个会话的值)
      hasMoreMessages.value = sessionState.turnsHasMore ?? true;
      traceSessionOpen(sessionId, 'panel:cache-hit');
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

    const fetchSpan = perfStart('replay.fetch');
    const page = await apiService.fetchSessionEvents(sessionId, {
      beforeSeq: isInitial ? undefined : options.beforeSeq,
      turns: isInitial ? INITIAL_PAGE_SIZE : MESSAGES_PAGE_SIZE,
    });
    fetchSpan?.end({ initial: isInitial ? 1 : 0, events: page.events.length });

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
    foldEvents(sessionStore, sessionId, sessionState.eventLog, isInitial ? 'initial' : 'load-more');

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
    const stashSpan = perfStart('replay.stashApply');
    let appliedStash = 0;
    for (const chunk of projectorStash) {
      const prevSeq = (chunk as { prevSeq?: number }).prevSeq;
      if (typeof prevSeq === "number" && prevSeq < endSeq) continue;
      applyLiveChunk(sessionStore, sessionId, chunk);
      appliedStash += 1;
    }
    stashSpan?.end({ events: appliedStash });

    hasMoreMessages.value = page.hasMore;
    // 分页游标状态按会话记忆(切会话回来时恢复)
    sessionStore.getSessionState(sessionId).turnsHasMore = page.hasMore;

    // 标记会话内容已缓存(二次打开不再向后端拉取)
    if (isInitial) {
      sessionStore.getSessionState(sessionId).loaded = true;
    } else if (page.events.length > 0) {
      // 恢复滚动位置，避免跳到顶部（rebuild 替换整树，需补偿高度差）
      nextTick(() => {
        const el = scrollContainerRef.value?.getScrollElement?.();
        const newScrollHeight = el?.scrollHeight || 0;
        const heightDiff = newScrollHeight - oldScrollHeight;
        if (el && heightDiff > 0) {
          // 程序化补偿，必须先声明为布局滚动：否则 scroll 事件会被判成
          // 「未经登记的上滚」而解除跟随（用户本来贴在底部读历史）。
          scrollContainerRef.value?.markLayoutScroll?.();
          el.scrollTop = heightDiff;
        }
      });
    }
  } catch (error) {
    console.error('加载消息失败:', error);
    notify.error('加载消息失败', getErrorMessage(error));
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
  traceSessionOpen(currentSessionId.value, 'panel:skeleton-hide-scheduled', { elapsed, remaining })
  // 还未满 500ms，延迟剩余时间后再隐藏
  skeletonMinDisplayTimer = setTimeout(() => {
    showSkeleton.value = false
    skeletonMinDisplayTimer = null
  }, remaining)

}

// 骨架屏隐藏 = 消息列表开始挂载（模板 v-if/v-else 互斥，列表此时才创建）。
// 骨架屏出现 = 旧列表开始卸载。两个方向都测，切换慢时先分清是卸旧还是挂新。
// nextTick 定位 flush 完成，双 rAF 定位首次绘制——这段就是用户感知的「打开耗时」。
watch(showSkeleton, (visible, prevVisible) => {
  if (visible && !prevVisible) {
    // 旧会话列表开始卸载：清掉旧锚点，避免高度变化时跨会话校正
    contentAnchor = null
    const sessionId = currentSessionId.value
    traceSessionOpen(sessionId, 'panel:list-unmount-start')
    const unmountSpan = perfStart('session.listUnmount')
    nextTick(() => {
      traceSessionOpen(sessionId, 'panel:list-unmounted')
      unmountSpan?.end()
    })
    return
  }
  if (visible || !prevVisible) return
  // 骨架屏隐藏前确定本轮初始挂载窗口（懒挂载）
  resetLazyMountForOpen()
  const sessionId = currentSessionId.value
  traceSessionOpen(sessionId, 'panel:skeleton-hidden', {
    turns: activeTurns.value.length,
    visibleTurns: visibleTurns.value.length,
    mounted: mountedTurnIds.value.size,
  })
  // 挂载耗时以 nextTick（patch 完成）为准，后台标签页 rAF 暂停也不会丢账；
  // 首次绘制单独记 session.listPainted（double rAF，250ms 兜底）。
  const mountSpan = perfStart('session.listMount')
  const paintedSpan = perfStart('session.listPainted')
  nextTick(() => {
    traceSessionOpen(sessionId, 'panel:list-patched', {
      turns: activeTurns.value.length,
      visibleTurns: visibleTurns.value.length,
      mounted: mountedTurnIds.value.size,
    })
    mountSpan?.end({ turns: visibleTurns.value.length, mounted: mountedTurnIds.value.size })
    // 几何兜底：Observer 被后台节流/HMR 未生效时，至少把视口附近的占位补挂上
    mountVisiblePlaceholders()
    // 会话滚动恢复未完成时先不建锚点，等 restore settle 后再记
    if (!pendingScrollRestore) rememberContentAnchor()
    setTimeout(() => {
      mountVisiblePlaceholders()
      if (!pendingScrollRestore) rememberContentAnchor()
    }, 300)
    let painted = false
    const finishPaint = () => {
      if (painted) return
      painted = true
      traceSessionOpen(sessionId, 'panel:list-painted')
      paintedSpan?.end({ turns: visibleTurns.value.length })
      endSessionOpenTrace(sessionId)
    }
    requestAnimationFrame(() => requestAnimationFrame(finishPaint))
    setTimeout(finishPaint, 250)
  })
})

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
  traceSessionOpen(newSessionId, 'panel:start');
  try {
    currentSessionId.value = newSessionId;
    // 打开会话:直接拉历史快照(loadSession 返回 lastSeq 作为订阅游标)。
    // StreamEventHub 邮箱常驻收事件,无需 startBuffering——订阅时按 prevSeq >= lastSeq 取增量。
    await loadSession(newSessionId);
    if (token !== sessionChangeToken) return;
    traceSessionOpen(newSessionId, 'panel:load-done');

    // 队列补拉：后端队列在会话打开时可能与本地投影不同步（后台消费/刷新），
    // 以服务端快照为准；不再由前端触发发送。
    void refreshQueue(newSessionId);

    nextTick(() => {
      if (token !== sessionChangeToken) return;
      if (!currentSession.value)
        return;
      if (inputMessage.value?.isWaiting) {
        sessionStore.patchSessionSettings(currentSession.value.id, {
          referencedKbs: inputMessage.value.knowledgeBaseIds,
        });
        handleSendMessage(inputMessage.value);
      }
    });
  } catch (error) {
    if (token !== sessionChangeToken) return;
    console.error('加载会话失败:', error);
    notify.error('加载会话失败', getErrorMessage(error));
  } finally {
    if (token !== sessionChangeToken) return;
    isLoading.value = false;
    traceSessionOpen(newSessionId, 'panel:loading-false');
    stopSkeletonDisplay();
  }
}

// 消息操作方法
function abortResponse() {
  if (currentSessionId.value) {
    apiService.cancelResponse(currentSessionId.value);
  }
}

async function deleteTurnMessage(turn: Turn) {
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
// 分支中（branchingTurnId 非 null）：该回合分支按钮转圈、其余禁用——后端 fork 无进度
// 事件（附件目录整树拷贝可能秒级），禁用 + 守卫双保险防并发 fork 出两个分支
const branchingTurnId = ref<string | null>(null);

async function branchFromTurn(turn: Turn) {
  if (props.disableBranch) return;
  if (!currentSessionId.value || !turn?.id) return;
  const confirmed = await confirm(
    t('chat.panel.branchConfirmTitle'),
    t('chat.panel.branchConfirmDesc'),
  );
  if (!confirmed) return;
  if (branchingTurnId.value) return;
  branchingTurnId.value = turn.id;
  try {
    const newSession = await apiService.branchSession(currentSessionId.value, {
      turnId: turn.id,
    });
    sessionStore.setSession(newSession);
    toast.success(t('chat.panel.branchSuccess'));
    router.replace({ name: 'Chat', params: { sessionId: newSession.id } });
  } catch (error) {
    toast.error(getErrorMessage(error) || t('chat.panel.branchFailed'));
    console.error("分支会话失败:", error);
  } finally {
    branchingTurnId.value = null;
  }
}

type MessageActionTarget = TurnContent | ReturnType<typeof toUserMessageView> | null

async function editMessage(block: MessageActionTarget) {
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
      // 块对象即回合树内的响应式引用,就地改写即已更新 UI;
      // 持久化走 updateMessage API(按消息级 messageId 回传,块继承自所属消息)。
      // (旧版还调 sessionStore.updateMessage 改扁平数组,回合制后恒空、从未生效,已清除)
      block.content = result;
      await apiService.updateMessage(currentSessionId.value, block.messageId, { content: result });
      toast.success(t('common.updateSuccess'));
    } else if (result === null || result === undefined) {
      toast.info(t('chat.panel.editCancelled'));
    }
  } catch (error) {
    toast.error(t('common.error.operationFailed'));
    console.error("更新消息失败:", error);
  }
}

async function copyMessage(block: MessageActionTarget) {
  try {
    // 无 assistant 块（如立即报错无任何产出）→ 复制空内容
    if (!block) {
      await writeTextToClipboard("");
      return;
    }

    if (block.content) {
      const ok = await writeTextToClipboard(block.content);
      if (ok) toast.success(t('common.copySuccess'));
      else toast.error(t('common.copyFailed'));
    }
  } catch (error) {
    console.error("复制消息失败:", error);
    toast.error(t('common.copyFailed'));
  }
}

/**
 * 发送本地斜杠命令（当前仅 /compact、/compress）。
 *
 * 执行逻辑只留在后端：这里仍走统一的 `/chat/stream` 入口，由后端在落库/建流前识别
 * 本地命令并转手动压缩。前端只负责前置门控（流式中/附件）、输入恢复与结果提示，
 * 保证"命令文本不落库、不进 LLM"的定义只有后端一处（也便于未来命令插件化）。
 */
async function sendLocalSlashCommand(
  command: LocalSlashCommand,
  fileCount: number,
  originalContent: string,
) {
  const sessionId = currentSessionId.value;
  if (!sessionId) return;
  // 命令被拒绝时把文本放回输入框（ChatInput.sendMessage 会在 emit 后同步清空编辑器）。
  // nextTick 确保恢复发生在清空之后，否则会被紧随其后的 clearContent 覆盖。
  const restoreInput = () => {
    void nextTick(() => {
      if (!inputMessage.value.content) {
        inputMessage.value.content = originalContent;
      }
    });
  };
  if (fileCount > 0) {
    toast.warning(t('chat.command.attachmentsNotSupported'));
    restoreInput();
    return;
  }
  if (isStreaming.value || sessionStore.sessionIsCompressing(sessionId)) {
    toast.warning(t('chat.memo.streamingWarning'));
    restoreInput();
    return;
  }
  try {
    // 统一入口：后端 ChatController 在写用户消息前识别并执行本地命令。
    // 命中时响应体带 localCommand，且不会产生 user/message 或对话回合。
    const res = await apiService.chat({
      sessionId,
      userMessage: { content: originalContent },
    });
    if (res?.localCommand) {
      toast.success(t('chat.memo.compressStarted'));
      return;
    }
    // 理论上不会走到：后端词表未同步（前端识别为命令、后端按普通消息处理）。
    // 此时已正常建流，交给 SSE 驱动，不额外提示。
    console.warn(
      `[local-command] backend did not intercept /${command.name}`,
    );
  } catch (error) {
    const msg = getErrorMessage(error);
    if (
      getApiErrorStatus(error) === 409 ||
      msg.includes('busy') ||
      msg.includes('STREAMING')
    ) {
      toast.warning(t('chat.memo.streamingWarning'));
    } else {
      toast.error(msg || t('chat.memo.compressFailed'));
    }
    restoreInput();
  }
}

/**
 * 输入区当前配置的回合级快照（发送/重答共用）。
 *
 * 后端 normalizeTurnSettingsOverride 会再校验一次；这里只负责“把 UI 当前值带过去”，
 * 保证改完设置立刻发送时本回合一定按输入区显示值执行。
 */
function buildSettingsOverride(sid: string): ChatSettingsOverride {
  const session = currentSession.value;
  const settings = session?.settings as SessionSettingsView | undefined;
  const rawSandboxMode = settings?.sandboxMode;
  const sandboxMode =
    rawSandboxMode === undefined
      ? undefined
      : capabilities.normalize(rawSandboxMode);
  const thinkingEffort = session?.settings?.thinkingEffort;
  const maxTokensLimit = settings?.maxTokensLimit;
  // 会话未绑定时带智能体默认模型，保证本回合与输入区显示一致
  const modelId = session?.modelId || session?.agent?.modelId;

  return {
    ...(modelId ? { modelId } : {}),
    ...(typeof thinkingEffort === 'string' ? { thinkingEffort } : {}),
    // null = 用户显式恢复“不限”，必须进入覆盖，否则后端会沿用旧的持久化上限
    ...(typeof maxTokensLimit === 'number' || maxTokensLimit === null
      ? { maxTokensLimit }
      : {}),
    ...(sandboxMode ? { sandboxMode } : {}),
    planEnabled: sessionStore.sessionPlanEnabled(sid),
  };
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

    // 本地斜杠命令（/compact）：控制指令，直接执行，不进消息队列、不发模型。
    // 必须在"流式入队"之前拦截——否则命令会被当成普通文本排队，流结束后再发给模型。
    const localCommand = parseLocalSlashCommand(content);
    if (localCommand) {
      await sendLocalSlashCommand(localCommand, files.length, content);
      return;
    }

    // 全局默认对话模型已移除：会话已加载且会话/智能体都无模型时，先让用户选择；
    // session 仍为 null 表示详情未就绪，不拦（后端会按持久化会话解析）。
    const session = currentSession.value;
    if (session && !session.modelId && !session.agent?.modelId) {
      toast.warning(t('chat.panel.modelRequired'));
      return;
    }

    // 准备消息数据（上传文件等）
    const prepared = await prepareNewMessage(content, files, null, knowledgeBaseIds);

    // 如果是编辑模式，需要处理替换逻辑
    // replaceTurnId 已由 enterEditMode 定位好(回合外壳 id=turnId),直接使用,无需反查。
    // 整轮删除完全由 replaceTurnId 触发后端 turn/delete + 新建回合——旧版在这里
    // 前端删除「该回合的扁平消息」(getMessages+deleteMessage),回合制后该数组恒空,
    // 循环从未执行过,已按死代码清除。
    let replaceTurnId: string | undefined = undefined;
    if (editMode.value && editMode.value.turnId && currentSessionId.value) {
      replaceTurnId = editMode.value.turnId;
      exitEditMode();
    }

    // 发起流式请求（后端会自动创建消息并启动流）
    // 发送链路独立:只调 apiService.chat 发起,不订阅、不处理事件;
    // 发送后的事件由常驻接收链路(唯一 receiver)消费。
    if (currentSessionId.value) {
      const sid = currentSessionId.value;
      // 入队/直发都带冻结快照：后端忙碌时随队列项保存，空闲时只影响本回合。
      const settingsOverride = buildSettingsOverride(sid);

      // 发送前先等配置落盘：避免“改完模型立刻发送”仍读到旧持久化值。
      // 保存失败不阻塞发送——本回合有 settingsOverride 兜底。
      await flushSession(sid);

      // 已知本会话在流式中：不要用 pending 覆盖 running，也不触发"新消息"动画
      const alreadyStreaming = sessionStore.sessionIsStreaming(sid);
      expectingNewMessage = !alreadyStreaming;
      if (!alreadyStreaming) {
        sessionStore.setStreamStatus(sid, "pending");
      }
      const payload: ChatStreamParams = {
        sessionId: sid,
        userMessage: {
          content: prepared.content,
          files: prepared.files,
          replaceTurnId,
          knowledgeBaseIds: prepared.knowledgeBaseIds,
        },
        ...(Object.keys(settingsOverride).length > 0
          ? { settingsOverride }
          : {}),
      };
      const response = props.sendHandler
        ? await props.sendHandler(payload)
        : await apiService.chat(payload);

      // 后端判定忙碌：已进入服务端队列，本窗口撤销 pending/入场动画，
      // 并以快照为准（queue_updated 可能晚于 HTTP 响应到达）。
      if (response?.queued) {
        expectingNewMessage = false;
        if (
          !alreadyStreaming &&
          sessionStore.peekStreamStatus(sid) === "pending"
        ) {
          sessionStore.setStreamStatus(sid, "idle");
        }
        void refreshQueue(sid);
      }
    }
  } catch (error) {
    notify.error(t('chat.panel.sendMessageFailed'), getErrorMessage(error));
    // 发送失败时由 SSE 事件驱动恢复检测
  }
}

/** 队列操作统一错误提示（409/404 时以服务端快照为准） */
function reportQueueError(error: unknown) {
  notify.error(t('chat.queue.operationFailed'), getErrorMessage(error));
}

/**
 * 撤回排队消息。
 * 409 = 已被其他窗口/回合启动：刷新快照，提示用户。
 */
async function handleRemoveQueued(id: string) {
  if (!currentSessionId.value) return;
  const sid = currentSessionId.value;
  try {
    const snapshot = await apiService.removeSessionQueueItem(sid, id);
    sessionStore.applyQueueSnapshot(sid, snapshot);
  } catch (error) {
    void refreshQueue(sid);
    reportQueueError(error);
  }
}

/**
 * 编辑排队消息：先服务端撤回，再回填输入框。
 * 撤回失败（已开始发送）时不回填，避免同一内容被发两次。
 */
async function handleEditQueued(item: QueuedMessage) {
  if (!currentSessionId.value) return;
  const sid = currentSessionId.value;
  try {
    const snapshot = await apiService.removeSessionQueueItem(sid, item.id);
    sessionStore.applyQueueSnapshot(sid, snapshot);
  } catch (error) {
    void refreshQueue(sid);
    reportQueueError(error);
    return;
  }

  const inputMsg = {
    content: item.content,
    files: item.files,
    knowledgeBaseIds: item.knowledgeBaseIds,
    isWaiting: false,
  };
  // 排队时正在编辑上一轮：回填时一并恢复编辑模式，否则重发会退化成新回合
  if (item.replaceTurnId) {
    editMode.value = { turnId: item.replaceTurnId, inputMessage: inputMsg };
  }
  inputMessage.value = inputMsg;
}

/** 失败项重试 = 立即发送（后端把 failed 恢复为 queued 并提升到队首） */
async function handleRetryQueued(id: string) {
  await handleSendNow(id);
}

/** 用户显式继续：解除服务端暂停并恢复消费 */
async function handleContinueQueue() {
  if (!currentSessionId.value) return;
  const sid = currentSessionId.value;
  try {
    const snapshot = await apiService.resumeSessionQueue(sid);
    sessionStore.applyQueueSnapshot(sid, snapshot);
  } catch (error) {
    reportQueueError(error);
  }
}

/** 手动暂停：只影响后续自动消费，不打断当前回合 */
async function handlePauseQueue() {
  if (!currentSessionId.value) return;
  const sid = currentSessionId.value;
  try {
    const snapshot = await apiService.pauseSessionQueue(sid);
    sessionStore.applyQueueSnapshot(sid, snapshot);
  } catch (error) {
    reportQueueError(error);
  }
}

/** 队列排序：可移动区间由服务端校验（running 之后、failed 之前） */
async function handleMoveQueued(id: string, direction: -1 | 1) {
  if (!currentSessionId.value) return;
  const sid = currentSessionId.value;
  try {
    const snapshot = await apiService.reorderSessionQueue(sid, id, direction);
    sessionStore.applyQueueSnapshot(sid, snapshot);
  } catch (error) {
    reportQueueError(error);
  }
}

/**
 * 立即发送：服务端负责提升目标；当前回合运行时会先停止，
 * 终态后优先发送该条（前端不再维护 promotion 状态）。
 */
async function handleSendNow(id: string) {
  if (!currentSessionId.value) return;
  const sid = currentSessionId.value;
  const item = messageQueue.value.find(m => m.id === id);
  if (!item || item.status === 'running') return;
  try {
    const snapshot = await apiService.sendSessionQueueItemNow(sid, id);
    sessionStore.applyQueueSnapshot(sid, snapshot);
  } catch (error) {
    void refreshQueue(sid);
    reportQueueError(error);
  }
}

/**
 * 进入编辑模式以重新生成消息
 * TurnItem 已直接传入整轮 turn(渲染链路传递,零反查),
 * enterEditMode 直接用 turn.id 作为被编辑回合外壳 id。
 */
function generateResponse(turn: Turn) {
  const user = (turn?.messages || []).find(
    (m) => m.role === "user" && !isHiddenBlock(m),
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
function regenerateResponse(turn: Turn) {
  const session = currentSession.value;
  if (session && !session.modelId && !session.agent?.modelId) {
    toast.warning(t('chat.panel.modelRequired'));
    return;
  }
  const user = (turn?.messages || []).find(
    (m) => m.role === "user" && !isHiddenBlock(m),
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

  nextTick(async () => {
    // 重答同「发消息」：取回跟随并贴底（新回合从底部重新长起）
    scrollContainerRef.value?.setFollowing(true);
    immediateScrollToBottom();
    const sid = currentSessionId.value;
    if (!sid) return;

    // 发送链路独立:只调发起接口(重答=replaceTurnId 触发 turn/delete+新建),
    // 不订阅、不处理事件;事件由常驻接收链路(唯一 receiver)消费。
    // 与普通发送一致：先 flush 配置，再带回合级快照，避免“改完模型马上重答”仍用旧值。
    // Bot 会话必须走 sendHandler（/bot-admin/sessions/:id/messages），否则会绕过 Bot 侧
    // 的 agent/model enrich，行为与正常发送不一致。
    const settingsOverride = buildSettingsOverride(sid);
    sessionStore.setStreamStatus(sid, "pending");
    await flushSession(sid);
    const payload: ChatStreamParams = {
      sessionId: sid,
      userMessage: {
        content: userContent,
        files,
        replaceTurnId,
        knowledgeBaseIds,
      },
      ...(Object.keys(settingsOverride).length > 0 ? { settingsOverride } : {}),
    };
    if (props.sendHandler) {
      await props.sendHandler(payload);
    } else {
      await apiService.chat(payload);
    }
  });
}

// 将方法暴露给父组件
// （旧 subscribeToActiveStream 已删：接收唯一链路是 useSessionEvents 的
//   streamReceiver.subscribeAll——常驻、按 sessionId 路由，本组件无需再"订阅活跃流"）
defineExpose({
  sendMessage: handleSendMessage,
  loadMessages,
  visibleTurns,
  scrollToMessage,
  getScrollElement: () => scrollContainerRef.value?.getScrollElement?.() || null, // 提供获取滚动元素的方法
  insertText: (text: string) => chatInputRef.value?.insertText(text),
  insertBadge: (data: SnipData) => chatInputRef.value?.insertBadge(data),
});

/**
 * 滚动到指定消息（大纲/引用跳转）。
 *
 * 点击大纲是明确的「离开底部去读历史」用户导航，必须登记用户意图：否则状态机
 * 把它当程序化滚动（保持原有 following），跳转途中的内容撑高就被当成「新内容」
 * 贴回底部——远距离跳转被立刻撤销；近距离因为不触发高度变化，侥幸正常。
 *
 * 落点校正做有界多轮：屏外回合带 content-visibility，真实高度要等进入视口才展开，
 * 且每新展开一行都会再把目标推走一次，单轮校正不足以收敛。
 */
const SCROLL_TO_MESSAGE_MAX_CORRECTIONS = 4

async function scrollToMessage(messageId: string) {
  // 大纲跳转是明确的导航：挂载/滚动期间不要让旧锚点做补偿
  contentAnchor = null
  // 懒挂载下目标回合可能还是占位：先全量挂载，保证锚点元素存在且 offsetTop 为真实高度。
  const targetTurn = visibleTurns.value.find((t) =>
    (t.messages ?? []).some((m) => m.messageId === messageId),
  )
  if (lazyTurnsEnabled && targetTurn && !mountedTurnIds.value.has(targetTurn.id)) {
    mountAllLoadedTurns()
    await nextTick()
  }

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

  const anchor = scrollContainerRef.value
  // 目标相对容器顶部的实测偏移；跳转落地后用它校正（屏外回合展开会推走目标）
  const driftToTarget = () =>
    targetElement.getBoundingClientRect().top - container.getBoundingClientRect().top

  // 先取走滚动权，再用容器级滚动（避免 scrollIntoView 导致整个页面位移）。
  // 消息锚点元素是 TurnItem 根 div（HTMLElement），offsetTop 仅存在于 HTMLElement 上
  anchor?.markUserIntent?.('awayFromBottom')
  container.scrollTo({ top: (targetElement as HTMLElement).offsetTop, behavior: 'smooth' })

  let corrections = 0
  const correct = () => {
    const drift = driftToTarget()
    if (Math.abs(drift) <= 2) return
    if (corrections >= SCROLL_TO_MESSAGE_MAX_CORRECTIONS) return
    corrections += 1
    anchor?.markUserIntent?.('awayFromBottom')
    container.scrollBy({ top: drift, behavior: 'smooth' })
    // 每轮等滚动再次停稳后重测，直到落在容差内或用尽轮次
    container.addEventListener('scrollend', correct, { once: true })
  }
  container.addEventListener('scrollend', correct, { once: true })
}

</script>

<style scoped>
/* translateZ(0)/will-change 的用途是滚动性能与 sticky 跟手（让滚动容器独立成层，
   相关经验见 CODELY.md「滚动容器强制合成」），不是像素对齐手段——像素对齐走
   CSS 整数设计值，勿删亦勿仿此做法去做对齐 */
.chat-scroll-container {
  will-change: transform;
  transform: translateZ(0);
  contain: layout style paint;
  transition: opacity 0.3s ease;
}

/* 懒挂载占位：只占高度，不创建组件树；进入视口附近后替换为 TurnItem。
   顶部两条 shimmer 线条明确表示“还在加载”，避免被误认为内容缺失。 */
.turn-placeholder {
  width: 100%;
  box-sizing: border-box;
  pointer-events: none;
  padding-top: 10px;
}

.turn-placeholder__skeleton {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.turn-placeholder__line {
  height: 12px;
  border-radius: 6px;
  background: linear-gradient(90deg,
      rgba(127, 127, 127, 0.08) 0%,
      rgba(127, 127, 127, 0.2) 50%,
      rgba(127, 127, 127, 0.08) 100%);
  background-size: 200% 100%;
  animation: turn-placeholder-shimmer 1.4s linear infinite;
}

@keyframes turn-placeholder-shimmer {
  0% {
    background-position: 200% 0;
  }

  100% {
    background-position: -200% 0;
  }
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
   原先写 Tailwind 的 max-w-186，类名即尺寸——改名/换刻度就静默失效，故收成本语义类。
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

/* 底部渐变遮罩：位于输入区底部，遮罩滚动区底部消息渐隐；
   containing block = chat-input-area（现位于 scroll-main 内 = 已避让的列），
   故 left-0 right-0 宽度天然 = 消息列宽（随避让让出）。
   56px 实心区需盖住输入框下方的工作目录条（约 36px），否则滚动消息会从条后漏出。
   注意不要给本元素负 bottom 让它画出 sticky 盒外：实测负 bottom 会让 sticky
   退回主线程更新，滚动时输入区抖动 8px。
   "输入区底边那半行会漏出滚动消息"的问题不在这里兜——已由设备像素吸附从根上消除
   （卡片底边距吸附到设备网格 → 滚动口底边落在设备像素整数上 → 不存在半行，
   见 style.css 的 .content-card / utils/devicePixelGrid.ts 与亚像素留档文档）。 */
.chat-bottom-fade {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 76px;
  pointer-events: none;
  background: var(--gd-color-bg);
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
   本行继承输入区的小数位置（输入区 sticky bottom-0，滚到底时落到由内容高度决定的
   自然位置），该小数随浏览器绘制期像素吸附处理，不再用 JS 修正（见 script 顶部的
   决策记录；原先挂在状态行上的 will-change: transform 已随 JS 吸附一并移除——
   常驻合成层多一层栅格/显存开销，且在合成 sticky 内叠加变换层会放大重采样模糊）。
   注意：图标自身的半像素是另一回事——「容器尺寸 − 图标尺寸 = 奇数」会让居中余量为半像素
   （16px 容器放 13px 图标 → 上下各 1.5px），这是几何问题，应按尺寸取偶数修
   （见 ComposerStatusBar / EventCard 的注释），不要靠这里兜。 */
.composer-status-row {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(100% + 6px);
  display: flex;
  align-items: center;
  justify-content: center;
  /* 不用 gap：gap 计入行的内容宽（胶囊 + gap + 插槽 0），居中后胶囊被左移 gap/2 = 4px，
     按钮显隐时行宽 0↔8 的变化还会让胶囊跟着横移同样距离。
     与按钮的 8px 间距改由按钮自身的 margin-left 提供（插槽 0 宽、按钮绝对定位，
     两者都不参与行的居中计算）→ 胶囊恒居中且位置恒定。 */
  /* 两侧各预留 36px（8px 间距 + 28px 回到底部按钮）：胶囊被限制在内容盒内，
     按钮绝对定位后的右缘正好落在行边界，不再撑出 .scroll-container（overflow:auto）
     的横向可滚动区。全局 border-box 下 width:100% 的内容宽 = 行宽 − 72px。 */
  padding-inline: 36px;
  width: 100%;
  pointer-events: none;
}

.composer-status-row > :deep(*) {
  pointer-events: auto;
}

/* 回到底部按钮的 0 宽插槽：按钮在插槽内绝对定位（与胶囊的间距由按钮的 margin 提供），
   插槽自身不占宽度 → 按钮显隐不参与行的居中计算，胶囊与图标的横向位置恒定。
   否则按钮消失（到达底部）会让「胶囊+按钮」整组重新居中，把胶囊横移 18px。
   插槽锚点落在行中轴（0 宽项被居中），按钮画在锚点右侧，故无胶囊时要由下面那条
   :has() 把按钮左移半个身位。 */
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
  /* 与胶囊的 8px 间距（行已不用 gap，见 .composer-status-row 注释） */
  margin-left: 8px;
}

/* 无运行时胶囊时，按钮是状态行里唯一可见的元素：插槽锚点被居中在行中轴，而按钮画在锚点
   右侧 → 不修正就整体偏右 14px（半个按钮宽，28 / 2）。左移半个身位让它自身居中。
   有胶囊时这条不生效，间距仍是上面的 8px（:has 匹配 ComposerStatusBar 的根节点，
   三段全空时该节点不渲染）。 */
.composer-status-row:not(:has(.composer-status-bar)) .scroll-btn-slot > :deep(*) {
  margin-left: -14px;
}

/* 事件回合外壳（compaction/command 等事件卡）：
   尾部外边距对齐 .turn-wrapper 的 margin-bottom——浮层状态胶囊（absolute，不占布局高度）
   会盖住末尾没有留白的事件卡（实测重叠 14px）；补 25px 后实测净空 11px，不加 60vh 预留
   （那是整段对话末尾的呼吸位，事件卡套上会留大片空白）。 */
.event-turn {
  width: 100%;
  margin-bottom: 25px;
}
</style>
