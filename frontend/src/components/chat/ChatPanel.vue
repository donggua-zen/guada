<template>
  <!-- 消息+输入 区域容器 -->
  <div class="flex-1 overflow-hidden w-full relative">
    <ScrollContainer ref="scrollContainerRef" class="h-full chat-scroll-container transition-opacity duration-300 px-5"
      :auto-scroll="needScrollToBottom" @scroll="handleScroll">
      <!-- 初始加载时的骨架屏：仅在消息为空时显示 -->
      <div class="chat-messages max-w-186 w-full mx-auto pt-5 flex-1">
        <template v-if="showSkeleton">
          <div class="absolute inset-0 z-1 overflow-hidden">
            <div class="px-5 max-w-186 mx-auto h-full flex flex-col py-10 ">
              <MessageSkeleton :count="2" />
            </div>
          </div>
        </template>
        <template v-else>
          <template v-if="currentSessionId && activeMessages.length === 0 && currentSession?.character">
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
              <div v-if="!isLoadingMore && !hasMoreMessages && activeMessages.length > MESSAGES_PAGE_SIZE"
                class="w-full py-4 text-center text-gray-400 text-xs">
                {{ t('chat.panel.noMoreMessages') }}
              </div>
            </Transition>

            <TurnItem :class="{ 'opacity-0': showSkeleton, 'opacity-100': !showSkeleton }"
              v-for="(turn, index) in visibleTurns" :key="turn.user.id" :turn="turn" :avatar="userAvater"
              :character-name="currentSession?.character?.title"
              :character-avatar="currentSession?.character?.avatarUrl" :is-last="index === visibleTurns.length - 1"
              :allow-generate="!isStreaming && index === lastUserMessageIndex"
              :animate-in="animateIds.includes(turn.user.id)"
              @delete="deleteMessage"
              @edit="editMessage" @copy="copyMessage" @generate="generateResponse" @regenerate="regenerateResponse"
              @continue="continueResponse" @switch="switchContent" />
            <!-- <div class="min-h-60"></div> -->

            <!-- 压缩中状态显示 -->
            <div v-if="sessionStore.sessionIsCompressing(currentSession?.id || '')"
              class="w-full py-8 flex flex-col items-center justify-center text-gray-500">
              <el-icon class="is-loading mb-2" size="24">
                <LoadingOutlined />
              </el-icon>
              <span class="text-sm">{{ t('chat.panel.compressing') }}</span>
            </div>

            <!-- 流式输出状态指示 -->
          </template>
        </template>
      </div>
      <!-- 输入区域 - sticky 底部 -->
      <div class="chat-input-area sticky bottom-0 left-0 right-0 z-30 pb-2">
        <!-- 底部渐变遮罩：撑满滚动区域宽度，位于输入框上方，被输入框遮挡 -->
        <div class="chat-bottom-fade"></div>
        <div class="max-w-186 mx-auto flex flex-col items-start relative" style="z-index: 1;">

          <!-- 排队消息抽屉：比输入框窄，避开圆角，微透明毛玻璃 -->
          <Transition name="queue-drawer">
            <div v-if="queueLength > 0"
              class="queue-drawer bg-(--color-surface)/80 backdrop-blur-xl rounded-(--size-dialog-rounded-radius) w-[calc(100%-48px)] margin-auto px-0.5 py-0.5 border-radius-6px mx-auto mb-2">
              <QueuedMessages :queue="messageQueue" @edit="handleEditQueued" @remove="handleRemoveQueued" />
            </div>
          </Transition>

          <!-- 编辑模式提示条 -->
          <div v-if="editMode" class="max-w-full w-full flex px-4">
            <div
              class="max-w-full w-full flex items-center px-4 py-1.5 rounded-tl-xl rounded-tr-xl bg-gray-200/80 dark:bg-[#2a2a2a]/80 backdrop-blur-xl">
              <span class="flex-1 text-sm mr-10 text-gray-700 dark:text-[#c5c7cc]">{{ t('chat.panel.editingMessage') }}</span>
              <el-button size="small" @click="exitEditMode" class="cancel-edit-btn" plain>
                {{ t('common.cancel') }}
              </el-button>
            </div>
          </div>

          <!-- 子代理面板（编辑模式时隐藏） -->
          <AgentPanel v-if="!editMode" :agent-tabs="props.agentTabs" :active-tab-id="props.activeTabId"
            @switch="emit('switch-agent', $event)" />

          <!-- 附加连接胶囊（AgentPanel 下方，输入框上方） -->
          <ConnectionChips
            v-if="!editMode"
            :connections="selectedConnections"
            @remove="toggleConnection"
          />

          <div class="w-full flex items-center relative">

            <ChatInput ref="chatInputRef" v-model:value="inputMessage.content" v-model:files="inputMessage.files"
              :session-id="effectiveSessionId" :character-id="props.session?.characterId || ''"
              :config="chatInputConfig" :streaming="isStreaming" :readonly="readonly" mode="chat"
              @config-change="handleConfigChange" @send="handleSendMessage" @abort="abortResponse">
              <template #right-actions-before>
                <!-- 上下文使用率：圆形进度条 -->
                <LTooltip :content="contextTooltip" placement="top">
                  <button class="context-ring-btn" @click="memoPanelVisible = true">
                    <svg class="context-ring" width="16" height="16" viewBox="0 0 36 36">
                      <circle class="ring-bg" cx="18" cy="18" r="15" fill="none" stroke-width="3.5" />
                      <circle class="ring-fg" cx="18" cy="18" r="15" fill="none" stroke-width="3.5" :stroke="ringColor"
                        :stroke-dasharray="ringCircumference" :stroke-dashoffset="ringDashOffset" stroke-linecap="round"
                        transform="rotate(-90 18 18)" />
                    </svg>
                  </button>
                </LTooltip>
              </template>
            </ChatInput>
          </div>
        </div>
      </div>
    </ScrollContainer>

    <!-- 回到底部悬浮按钮 -->
    <ScrollToBottomButton :show="showScrollToBottomBtn" :is-streaming="shouldButtonBreathe"
      @click="handleScrollToBottomClick" />
  </div>
  <!-- 记忆管理弹窗 -->
  <el-dialog v-model="memoPanelVisible" :title="t('chat.panel.memoryManagement')" width="560px" :close-on-click-modal="false" destroy-on-close
    class="memo-panel-dialog" append-to-body>
    <MemoPanel v-if="currentSessionId" :session-id="currentSessionId" />
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted, defineAsyncComponent, provide } from "vue";
import { useI18n } from "vue-i18n";
const { t } = useI18n()
import { apiService } from "../../services/ApiService";
import { usePopup } from "@/composables/usePopup";
import { useDebounceFn } from "@vueuse/core";
import { useSessionStore } from "../../stores/session";
import { useAuthStore } from "../../stores/auth"
import { getCurrentTurns } from "@/utils/messageUtils"
import { useStreamResponse } from "@/composables/useStreamResponse"
import type { InputMessageState, Session, QueuedMessage } from '@/types/session';
import type { Character } from '@/types/character';

// 导入新创建的 composables
import { useSessionChat } from '@/composables/useSessionChat'
import { useMessageOperations } from '@/composables/useMessageOperations'
import { useSessionTokenStats } from '@/composables/useSessionTokenStats'

// 组件导入
import TurnItem from "./TurnItem.vue";
import MessageSkeleton from "./MessageSkeleton.vue";
import { ChatInput, ScrollContainer, ScrollToBottomButton } from "../ui";
import WelcomeScreen from './WelcomeScreen.vue';
import QueuedMessages from './QueuedMessages.vue';
const MemoPanel = defineAsyncComponent(() => import("./MemoPanel.vue"));
import { LoadingOutlined } from '@vicons/antd'
import AgentPanel from './AgentPanel.vue';
import ConnectionChips from './ConnectionChips.vue';
import type { ConnectionChip } from './ConnectionChips.vue';
import LTooltip from '../ui/LTooltip.vue';


// 常量定义
const MAX_REGENERATE_VERSIONS = 5

// 弹出层工具
const { confirm, editText, toast, notify } = usePopup();
const authStore = useAuthStore()
const sessionStore = useSessionStore();

// 新发送消息动画追踪：只有通过 handleSendMessage 发送的消息才播放入场动画
const animateIds = ref<string[]>([]);
let expectingNewMessage = false;


// 记忆管理弹窗显隐
const memoPanelVisible = ref(false);

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
  agentTabs?: { id: string; name: string; status: 'running' | 'completed' | 'error'; loaded?: boolean; avatarUrl?: string }[];
  activeTabId?: string;
}>();

const emit = defineEmits<{
  'update:session': [session: Session]
  openSettings: []
  'save-settings': []
  'select-character': [character: Character]  // 切换角色
  'switch-agent': [tabId: string]
}>();

// 计算属性 - 类型化
const currentSession = computed({
  get: () => props.session,
  set: (session: Session | null) => emit("update:session", session!)
});

const userAvater = computed(() => authStore.user?.avatarUrl);
const currentSessionId = ref<string | null>(null);

// 共享的 Token 统计（useSessionTokenStats 自动监听流状态刷新）
const currentSessionIdRef = computed(() => currentSessionId.value);
const { tokenStats: sharedTokenStats, fetchTokenStats } = useSessionTokenStats(currentSessionIdRef);

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
const shouldButtonBreathe = ref(false)

/**
 * 更新滚动按钮显示状态
 */
const updateScrollButtonVisibility = useDebounceFn(() => {
  const isAtBottom = scrollContainerRef.value?.isAtBottom

  if (isAtBottom) {
    showScrollToBottomBtn.value = false
    shouldButtonBreathe.value = false
    return
  }

  if (isStreaming.value) {
    showScrollToBottomBtn.value = true
    shouldButtonBreathe.value = true
  } else {
    showScrollToBottomBtn.value = false
  }
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
      const earliestId = sessionStore.getEarliestMessageId(currentSessionId.value);
      if (earliestId) {
        // 立即设置标记，防止重复触发
        isLoadingMore.value = true;
        loadMoreMessages(currentSessionId.value, earliestId);
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

// 监听流式状态变化
watch(() => isStreaming.value, (newVal, oldVal) => {
  shouldButtonBreathe.value = newVal
  updateScrollButtonVisibility()
}, { immediate: true })

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

// 最后一条 user 消息的索引，避免每轮 v-for 重复计算
const lastUserMessageIndex = computed(() => {
  const turns = visibleTurns.value;
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].user) {
      return i;
    }
  }
  return -1;
});

// ============================================
// 轮次分组：将扁平消息列表按 user 消息分组
// ============================================
const turns = computed(() => {
  const map: Record<string, { user: any; assistants: any[] }> = {};
  const order: string[] = [];
  for (const msg of activeMessages.value) {
    if (msg.role === 'user') {
      map[msg.id] = { user: msg, assistants: [] };
      order.push(msg.id);
    } else if (msg.role === 'assistant' && msg.parentId) {
      if (!map[msg.parentId]) {
        map[msg.parentId] = { user: null, assistants: [] };
        order.push(msg.parentId);
      }
      map[msg.parentId].assistants.push(msg);
    }
  }
  return order.map((id) => map[id]);
});


// 过滤：只保留有 user 消息的组
const visibleTurns = computed(() =>
  turns.value.filter((t) => t.user),
);

// 监听轮次变化：仅 handleSendMessage 发送的新消息才标记动画
watch(() => visibleTurns.value.length, (newLen, oldLen) => {
  if (!expectingNewMessage || newLen <= (oldLen || 0)) return;
  const lastTurn = visibleTurns.value[visibleTurns.value.length - 1];
  if (!lastTurn?.user) return;
  const newId = lastTurn.user.id;
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
const chatInputConfig = computed(() => ({
  modelId: currentModelId.value,
  thinkingEffort: currentSession.value?.settings?.thinkingEffort || 'none',
  maxTokensLimit: currentSession.value?.settings?.maxTokensLimit ?? null,
  knowledgeBaseIds: inputMessage.value?.knowledgeBaseIds || currentSession.value?.settings?.referencedKbs || [],
  workspacePath: currentSession.value?.workspacePath || null,
  runMode: currentSession.value?.settings?.runMode || 'normal',
  connectionIds: currentSession.value?.settings?.connectionIds || [],
}));

// ── 附加连接管理 ──
const allConnections = ref<any[]>([]);
const selectedConnectionIds = computed<string[]>(() => {
  const ids = currentSession.value?.settings?.connectionIds;
  if (ids && Array.isArray(ids) && ids.length > 0) {
    console.log('[ConnectionChips] session.settings.connectionIds:', ids);
  }
  return ids || [];
});
const selectedConnections = computed<ConnectionChip[]>(() => {
  return allConnections.value
    .filter(c => selectedConnectionIds.value.includes(c.id))
    .map(c => ({ id: c.id, name: c.name, scheme: c.scheme, config: c.config }));
});

async function loadConnections() {
  try {
    allConnections.value = await apiService.getWorkspaceConnections();
  } catch (e) {
    console.error('Failed to load connections:', e);
  }
}

function toggleConnection(connId: string) {
  if (!currentSession.value) return;
  const ids = [...(currentSession.value.settings?.connectionIds || [])];
  const idx = ids.indexOf(connId);
  if (idx === -1) {
    ids.push(connId);
  } else {
    ids.splice(idx, 1);
  }
  if (!currentSession.value.settings) currentSession.value.settings = {};
  currentSession.value.settings.connectionIds = ids;
  debouncedSaveSession();
}

onMounted(() => {
  loadConnections();
});

onUnmounted(() => {
  clearSkeletonTimers();
});

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

  // 处理运行模式
  if (typeof config.runMode !== 'undefined') {
    currentSession.value.settings.runMode = config.runMode;
  }

  // 处理附加连接
  if (typeof config.connectionIds !== 'undefined') {
    currentSession.value.settings.connectionIds = config.connectionIds;
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
  // 当流式状态从 true 变为 false 时（即助手回复完成）
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
}

/**
 * 加载会话消息
 * @param sessionId - 会话 ID
 * @param options - 加载选项
 *   - isInitial: 是否为首次加载（加载最近 N 条）
 *   - beforeMessageId: 加载此 ID 之前（更早）的消息
 */
async function loadMessages(
  sessionId: string,
  options: { isInitial?: boolean; beforeMessageId?: string } = {},
) {
  const isInitial = options.isInitial ?? true;

  // 初始加载会替换整个消息数组（setMessages），流式输出期间执行会丢失正在输出的消息
  // 加载更多仅 prepend 到头部，与流式的 push/findIndex 互不干扰
  if (isInitial) {
    const sessionState = sessionStore.getSessionState(sessionId);
    if (sessionState.isStreaming) {
      return;
    }
  }

  if (!isInitial) {
    isLoadingMore.value = true;
  }

  try {
    const requestOptions: any = {};
    if (isInitial) {
      // 首次加载：加载最近 INITIAL_PAGE_SIZE 条
      requestOptions.limit = INITIAL_PAGE_SIZE;
    } else if (options.beforeMessageId) {
      // 加载更多：加载指定 ID 之前的更早消息
      requestOptions.limit = MESSAGES_PAGE_SIZE;
      requestOptions.beforeMessageId = options.beforeMessageId;
    }

    const sessionMessages = await apiService.fetchSessionMessages(
      sessionId,
      requestOptions,
    );

    // 处理历史消息的思考时长回填
    sessionMessages.items.forEach(
      (message: { id: string; contents: any[] }) => {
        if (message.contents && Array.isArray(message.contents)) {
          message.contents.forEach((content) => {
            if (content.meta_data?.thinking_duration_ms) {
              content.thinking_duration_ms =
                content.meta_data.thinking_duration_ms;
            }
          });
        }
      },
    );

    if (isInitial) {
      // 首次加载：替换消息列表
      activeMessages.value = sessionMessages.items;
      const pageSize = isInitial ? INITIAL_PAGE_SIZE : MESSAGES_PAGE_SIZE;
      hasMoreMessages.value = sessionMessages.items.length >= pageSize;
    } else {
      // 加载更多：prepend 到列表前部
      if (sessionMessages.items.length > 0) {
        // 记录当前滚动位置（内容高度）
        const scrollElement = scrollContainerRef.value?.getScrollElement?.();
        const oldScrollHeight = scrollElement?.scrollHeight || 0;

        sessionStore.prependMessages(sessionId, sessionMessages.items);

        // 恢复滚动位置，避免跳到顶部
        nextTick(() => {
          const newScrollHeight = scrollElement?.scrollHeight || 0;
          const heightDiff = newScrollHeight - oldScrollHeight;
          if (scrollElement && heightDiff > 0) {
            scrollElement.scrollTop = heightDiff;
          }
        });
      }
      const pageSize = isInitial ? INITIAL_PAGE_SIZE : MESSAGES_PAGE_SIZE;
      hasMoreMessages.value = sessionMessages.items.length >= pageSize;
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
 * @param beforeMessageId - 从此 ID 之前开始加载
 */
async function loadMoreMessages(sessionId: string, beforeMessageId: string) {
  await loadMessages(sessionId, { isInitial: false, beforeMessageId });
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
    // Ensure connections are loaded (in case onMounted already passed)
    if (allConnections.value.length === 0) {
      await loadConnections();
      if (token !== sessionChangeToken) return;
    }
    await loadSession(newSessionId);
    if (token !== sessionChangeToken) return;
    // 页面加载时一次性检查活跃流（用于刷新后的初始状态同步）
    await checkActiveStreamOnLoad(newSessionId);
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

/**
 * 页面加载时一次性检查活跃流
 * 用于刷新后的初始状态同步，后续通过 SSE 事件驱动
 */
async function checkActiveStreamOnLoad(sessionId: string) {
  try {
    const status = await apiService.getStreamStatus(sessionId);
    if (status.isRunning) {
      await subscribeToActiveStream();
    }
  } catch (error) {
    console.error('初始流状态检查失败:', error);
  }
}

// 流式响应处理（委托给 composable 处理，用于 regenerate / continue）
async function handleStreamResponse(
  streamingSessionId: string,
  regenerationMode: any = null,
  assistantMessageId: string | null = null,
  userMessageId?: string | null,
) {
  try {
    const handler = useStreamResponse(sessionStore, apiService)
    await handler.processStream(
      streamingSessionId,
      regenerationMode,
      assistantMessageId,
      userMessageId,
    )
  } catch (error) {
    // 错误已在 composable 中处理，这里只负责显示通知
    if ((error as Error).message.includes('SessionBusyError')) {
      notify.warning(t('chat.panel.sessionBusy'), t('chat.panel.sessionBusyDesc'))
      return
    }
    if (error.name !== 'AbortError') {
      notify.error(t('common.error.unknown'), error.message)
      console.error("请求错误:", error)
    }
  }
}

/**
 * 合并消息创建和流式响应处理
 * 后端会在启动流时自动创建消息
 */
async function handleStreamResponseWithCreate(
  streamingSessionId: string,
  content: string,
  fileIds: string[],
  replaceMessageId: string | null = null,
  knowledgeBaseIds?: string[],
) {
  try {
    const handler = useStreamResponse(sessionStore, apiService)
    await handler.processStreamWithCreate(
      streamingSessionId,
      content,
      fileIds,
      replaceMessageId,
      knowledgeBaseIds,
    )
  } catch (error) {
    if ((error as Error).message.includes('SessionBusyError')) {
      notify.warning(t('chat.panel.sessionBusy'), t('chat.panel.sessionBusyDesc'))
      return
    }
    if (error.name !== 'AbortError') {
      notify.error(t('common.error.unknown'), error.message)
    }
  }
}

// 消息操作方法
function abortResponse() {
  if (currentSessionId.value) {
    apiService.cancelResponse(currentSessionId.value);
  }
}

async function deleteMessage(message: any) {
  try {
    if (
      await confirm(
        t('chat.panel.deleteMessageTitle'),
        message.role === "user"
          ? t('chat.panel.deleteUserMessageDesc')
          : t('chat.panel.deleteAssistantMessageDesc')
      )
    ) {
      await apiService.deleteMessage(message.id);
      if (message.role === "user") {
        const assistantMessage = activeMessages.value.find((msg) => msg.parentId === message.id);
        if (assistantMessage && currentSessionId.value) {
          sessionStore.deleteMessage(currentSessionId.value, assistantMessage.id);
        }
      }
      if (currentSessionId.value) {
        sessionStore.deleteMessage(currentSessionId.value, message.id);
      }
      toast.success(t('common.deleteSuccess'));
    }
  } catch (error) {
    toast.error(t('common.error.deleteFailed'));
    console.error("删除消息失败:", error);
  }
}

async function editMessage(message: any) {
  try {
    const turns = getCurrentTurns(message)
    const currentContent = turns[turns.length - 1]

    const result = await editText({
      title: t('chat.panel.editMessageTitle'),
      defaultValue: currentContent.content || "",
      confirmText: t('common.save'),
      cancelText: t('common.cancel')
    }) as string | null;

    if (result != null && currentSessionId.value) {
      currentContent.content = result;
      await apiService.updateMessage(message.id, { content: result });
      sessionStore.updateMessage(currentSessionId.value, message.id, message);
      toast.success(t('common.updateSuccess'));
    } else if (result === null || result === undefined) {
      toast.info(t('chat.panel.editCancelled'));
    }
  } catch (error) {
    toast.error(t('common.error.operationFailed'));
    console.error("更新消息失败:", error);
  }
}

async function copyMessage(message: any) {
  try {
    const turns = getCurrentTurns(message)
    const currentContent = turns[turns.length - 1]

    if (currentContent.content) {
      await navigator.clipboard.writeText(currentContent.content);
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
        files: prepared.updatedFiles.filter((f: any) => f.id),
        knowledgeBaseIds: prepared.knowledgeBaseIds,
      });
      return;
    }

    // 准备消息数据（上传文件等）
    const prepared = await prepareNewMessage(content, files, null, knowledgeBaseIds);

    // 如果是编辑模式，需要处理替换逻辑
    let replaceMessageId: string | undefined = undefined;
    if (editMode.value && editMode.value.message && currentSessionId.value) {
      const rid = editMode.value.message.id;
      replaceMessageId = rid;
      const sid = currentSessionId.value;
      // 删除旧消息及其回答
      sessionStore.deleteMessage(sid, rid);
      const assistantMessage = sessionStore
        .getMessages(sid)
        .find((msg: any) => msg.parentId === rid);
      if (assistantMessage) {
        sessionStore.deleteMessage(sid, assistantMessage.id);
      }
      exitEditMode();
    }

    // 发起流式请求（后端会自动创建消息并启动流）
    if (currentSessionId.value) {
      expectingNewMessage = true;
      handleStreamResponseWithCreate(
        currentSessionId.value,
        prepared.content,
        prepared.fileIds,
        replaceMessageId,
        prepared.knowledgeBaseIds,
      );
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
 */
function generateResponse(message: any) {
  enterEditMode(message)
}

/**
 * 重新生成响应（多版本）
 */
function regenerateResponse(message: any) {
  // 新模型：统计同 parentId 的兄弟 assistant 消息数量
  const parentId = message.parentId;
  const existingVersions = activeMessages.value.filter(
    (m) => m.parentId === parentId && m.role === "assistant"
  );

  if (existingVersions.length >= MAX_REGENERATE_VERSIONS) {
    toast.error(t('chat.panel.maxVersionsExceeded'));
    return;
  }

  const assistantMessage = activeMessages.value.find(m => m.id === message.id);
  if (assistantMessage) {
    assistantMessage.state = { isStreaming: true };
  }

  nextTick(() => {
    immediateScrollToBottom();
    if (message.sessionId) {
      // multi_version 模式需要传递 userMessageId（通过 parentId 获取）
      const userMessageId = message.parentId || null;
      handleStreamResponse(message.sessionId, "multi_version", message.id, userMessageId);
    }
  });
}

/**
 * 从断点继续执行（恢复工具调用）
 */
function continueResponse(message: any) {
  const assistantMessage = activeMessages.value.find(m => m.id === message.id);
  if (assistantMessage) {
    assistantMessage.state = { isStreaming: true };
  }

  nextTick(() => {
    immediateScrollToBottom();
    if (message.sessionId) {
      // resume 模式需要传递 userMessageId（通过 parentId 获取）
      const userMessageId = message.parentId || null;
      handleStreamResponse(message.sessionId, "resume", message.id, userMessageId);
    }
  });
}

function switchContent(message: any, versionId: string) {
  // 新模型：找到用户消息，更新 currentVersionId
  const userMessage = activeMessages.value.find((m) => m.role === "user" && m.currentVersionId === message.id);
  if (userMessage && currentSessionId.value) {
    userMessage.currentVersionId = versionId;
    apiService.updateMessage(userMessage.id, { currentVersionId: versionId });
    sessionStore.updateMessage(currentSessionId.value, userMessage.id, userMessage);
  }
  nextTick(() => {
    immediateScrollToBottom();
  });
}



/**
 * 订阅活跃流
 * 当检测到会话有正在进行的流式输出时调用（如刷新页面后重连或多窗口打开）
 */
async function subscribeToActiveStream() {
  if (!currentSessionId.value || isStreaming.value) return;

  // 设置流式状态
  sessionStore.setSessionIsStreaming(currentSessionId.value, true);

  // 以订阅模式启动流式响应（用于刷新重连/多窗口观察）
  // 不能 await：该 Promise 会持续到整个 SSE 流结束，否则页面加载态无法结束。
  void handleStreamResponseAsSubscriber(currentSessionId.value);
}

/**
 * 以订阅者身份处理流式响应（不发起新聊天，只观察已有流）
 */
async function handleStreamResponseAsSubscriber(
  streamingSessionId: string,
) {
  try {
    // 从后往前查找最后一个有 contents 的消息，用于后端过滤已完成的 content
    // 注意：最后一条消息可能是刚创建的空助手消息（contents 为空），
    // 此时需要向前回溯，否则 lastContentId 为 null 会导致整个 eventBuffer 被重放，
    // 包括 user_message 事件，从而造成用户消息重复。
    const messages = sessionStore.getMessages(streamingSessionId);
    let lastContentId: string | null = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].contents?.length > 0) {
        lastContentId = messages[i].contents[messages[i].contents.length - 1].id;
        break;
      }
    }

    const handler = useStreamResponse(sessionStore, apiService)
    await handler.processStream(
      streamingSessionId,
      'subscribe',
      null,
      null,
      lastContentId,
    );
  } catch (error) {
    // 订阅模式下无活跃流的错误可以静默忽略
    if ((error as Error).message?.includes("NO_ACTIVE_STREAM")) {
      sessionStore.setSessionIsStreaming(streamingSessionId, false);
      return;
    }
    if ((error as Error).name !== "AbortError") {
      console.error("订阅流失败:", error);
    }
  }
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
  if (targetElement) {
    // 使用容器级滚动，避免 scrollIntoView 导致整个页面位移
    const targetTop = targetElement.offsetTop
    container.scrollTo({
      top: targetTop,
      behavior: 'smooth'
    })
  } else {
    console.warn(`[ChatPanel] 未找到消息元素: ${messageId}`)
  }
}

</script>

<style scoped>
.chat-scroll-container {
  will-change: transform;
  transform: translateZ(0);
  contain: layout style paint;
}

.queue-drawer {
  border: 1px solid var(--color-surface-border);
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

/* 底部渐变遮罩：底部25px完全隐藏，上方渐变过渡 */
.chat-bottom-fade {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 48px;
  pointer-events: none;
  background: linear-gradient(to top, var(--color-bg, #ffffff) 25px, transparent 48px);
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

.context-ring-btn:hover {
  background: var(--color-sidebar-bg-hover);
}

.context-ring .ring-bg {
  stroke: var(--color-text-disabled);
  opacity: 0.3;
}

.context-ring .ring-fg {
  transition: stroke-dashoffset 0.3s ease, stroke 0.3s ease;
}
</style>
