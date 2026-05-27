<template>
  <!-- 消息内容区域 -->
  <div class="flex-1 overflow-hidden w-full items-center" ref="messagesContainerRef">
    <template v-if="!isLoading && activeMessages.length === 0">
      <!-- 欢迎页 -->
      <WelcomeScreen :session="currentSession" />
    </template>
    <template v-else-if="authStore.isAuthenticated">
      <ScrollContainer ref="scrollContainerRef" class="max-h-full chat-scroll-container"
        :auto-scroll="needScrollToBottom" @scroll="handleScroll">
        <div class="px-5 max-w-205 mx-auto">
          <MessageItem v-for="(message, index) in activeMessages" :key="message.id" :message="message"
            v-memo="[message.id, message.contents, message.currentTurnsId, message.state?.isStreaming, message.state?.isThinking, lastUserMessageIndex]"
            :avatar="message.role == 'user' ? userAvater : currentSession?.avatarUrl"
            :is-last="index === activeMessages.length - 1"
            :allow-generate="!isStreaming && index === lastUserMessageIndex" @delete="deleteMessage" @edit="editMessage"
            @copy="copyMessage" @generate="generateResponse" @regenerate="regenerateResponse"
            @continue="continueResponse" @switch="switchContent" />
          <!-- <div class="min-h-60"></div> -->

          <!-- 压缩中状态显示 -->
          <div v-if="sessionStore.sessionIsCompressing(currentSession?.id || '')"
            class="w-full py-8 flex flex-col items-center justify-center text-gray-500">
            <el-icon class="is-loading mb-2" size="24">
              <LoadingOutlined />
            </el-icon>
            <span class="text-sm">正在优化对话历史，请稍候...</span>
          </div>
        </div>
      </ScrollContainer>

      <!-- 回到底部悬浮按钮 -->
      <ScrollToBottomButton :show="showScrollToBottomBtn" :is-streaming="shouldButtonBreathe"
        @click="handleScrollToBottomClick" />
    </template>
  </div>

  <!-- 输入区域 -->
  <div class="pb-6 w-full px-5 max-w-205 flex flex-col items-start mx-auto">
    <!-- 编辑模式提示条 -->
    <div v-if="editMode"
      class="bg-gray-200 -mb-1.5 w-full  flex items-center px-4 pt-2 pb-5 rounded-tl-xl rounded-tr-xl">
      <span class="flex-1 text-sm mr-10">正在编辑消息</span>
      <el-button size="small" @click="exitEditMode" class="cancel-edit-btn" plain>
        取消编辑
      </el-button>
    </div>

    <div class="w-full flex items-center" style="margin-top: -10px;z-index: 9;">
      <ChatInput v-model:value="inputMessage.content" v-model:files="inputMessage.files"
        :session-id="currentSession?.id" :config="chatInputConfig" :streaming="isStreaming"
        @config-change="handleConfigChange" @send="handleSendMessage" @abort="abortResponse" />
    </div>
    <!-- <div class="ai-disclaimer text-xs text-gray-400 text-center mt-2">内容由 AI 生成，仅供参考</div> -->

  </div>

</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted, type Ref, h } from "vue";
import { apiService } from "../../services/ApiService";
import { usePopup } from "@/composables/usePopup";
import { useDebounceFn } from "@vueuse/core";
import { useSessionStore } from "../../stores/session";
import { useAuthStore } from "../../stores/auth"
import { getCurrentTurns } from "@/utils/messageUtils"
import { useStreamResponse } from "@/composables/useStreamResponse"
import type { InputMessageState, Session } from '@/types/session';

// 导入新创建的 composables
import { useSessionChat } from '@/composables/useSessionChat'
import { useMessageOperations } from '@/composables/useMessageOperations'

// 组件导入
import MessageItem from "./MessageItem.vue";
import { Avatar, ChatInput, ScrollContainer, ScrollToBottomButton } from "../ui";
import WelcomeScreen from './WelcomeScreen.vue';
import { LoadingOutlined } from '@vicons/antd'


// 常量定义
const MAX_REGENERATE_VERSIONS = 5

// 弹出层工具
const { confirm, editText, toast, notify } = usePopup();
const authStore = useAuthStore()
const sessionStore = useSessionStore();

// 初始化流式响应处理器
const streamHandler = useStreamResponse(sessionStore, apiService)

// Props & Emits - 类型化
const props = defineProps<{
  session: Session | null;
  sidebarVisible?: boolean;
}>();

const emit = defineEmits<{
  'update:session': [session: Session]
  openSettings: []
  'update:sidebarVisible': [visible: boolean]
  'save-settings': []
}>();

// 计算属性 - 类型化
const currentSession = computed({
  get: () => props.session,
  set: (session: Session | null) => emit("update:session", session!)
});

const userAvater = computed(() => authStore.user?.avatarUrl);

// 使用 useSessionChat composable
const {
  currentSessionId,
  isLoading,
  hasGeneratedTitle,
  loadSession,
  loadMessages,
  resetTitleFlag,
  generateTitleIfNeeded
} = useSessionChat(sessionStore, apiService)

// 响应式数据
const messagesContainerRef = ref<HTMLElement | null>(null);
const scrollContainerRef = ref<any>(null);
const needScrollToBottom = ref(true);
let scrollTicking = false;
let lastScrollTop = 0;

// SSE 事件监听取消函数
let unsubscribeStreamStarted: (() => void) | null = null;
let unsubscribeStreamFinished: (() => void) | null = null;

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
    needScrollToBottom.value = true;
    scrollContainerRef.value.smoothScrollToBottom()
  }
}

/**
 * 立即滚动到底部
 */
function immediateScrollToBottom() {
  needScrollToBottom.value = true;
  scrollContainerRef.value?.immediateScrollToBottom()
}

/**
 * 处理滚动事件
 */
function handleScroll(event: any) {
  if (scrollTicking) return;
  scrollTicking = true;
  requestAnimationFrame(() => {
    const isAtBottom = scrollContainerRef.value?.isAtBottom;
    if (needScrollToBottom.value && lastScrollTop - event.target.scrollTop > 10 && !isAtBottom) {
      needScrollToBottom.value = false;
    } else if (!needScrollToBottom.value && isAtBottom) {
      needScrollToBottom.value = true;
    }
    lastScrollTop = event.target.scrollTop;
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
    return sessionId ? sessionStore.getMessages(sessionId) || [] : [];
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
  const messages = activeMessages.value;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      return i;
    }
  }
  return -1;
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
  // 模型 ID - 对应 handleConfigChange 中的 config.modelId
  modelId: currentModelId.value,

  // 思考强度 - 对应 handleConfigChange 中的 config.thinkingEffort
  thinkingEffort: currentSession.value?.settings?.thinkingEffort || 'off',

  // 记忆配置开关 - 对应 handleConfigChange 中的 config.memoryEnabled
  memoryEnabled: currentSession.value?.settings?.memoryEnabled,

  // 记忆配置详情 - 对应 handleConfigChange 中的 config.memory
  memory: currentSession.value?.settings?.memory || null,

  // 知识库 IDs - 对应 handleConfigChange 中的 config.knowledgeBaseIds
  knowledgeBaseIds: inputMessage.value?.knowledgeBaseIds || currentSession.value?.settings?.referencedKbs || [],

  // 工作目录路径 - 对应 handleConfigChange 中的 config.workspacePath
  workspacePath: currentSession.value?.workspacePath || null
}));

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

  // 处理记忆配置开关
  if (typeof config.memoryEnabled !== 'undefined') {
    currentSession.value.settings.memoryEnabled = config.memoryEnabled;
    console.log('保存 memoryEnabled 到会话:', config.memoryEnabled);
  }

  // 处理记忆配置详情
  if (typeof config.memory !== 'undefined') {
    if (!currentSession.value.settings.memory) {
      currentSession.value.settings.memory = {};
    }
    currentSession.value.settings.memory = {
      ...currentSession.value.settings.memory,
      ...config.memory
    };
    console.log('保存 memory 配置到会话:', config.memory);
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

  debouncedSaveSession();
};

// 防抖函数
const debouncedSaveSession = useDebounceFn(() => {
  emit("save-settings");
}, 100);

// 监听器
watch(() => props.session?.id, async (newSessionId: string | undefined, oldSessionId: string | undefined) => {
  // setTimeout(() => {
  handleSessionChange(newSessionId ?? null, oldSessionId ?? null);

  // }, 500);
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

// 监听消息变化，智能显示回到底部按钮
watch(() => activeMessages.value.length, () => {
  updateScrollButtonVisibility()
}, { immediate: true });

/**
 * 初始化 SSE 事件监听
 * 接收流开始/结束事件，替代轮询机制
 */
function initSessionEventListeners() {
  // 监听流开始事件（其他客户端发起的流）
  unsubscribeStreamStarted = apiService.onSessionEvent("stream_started", (event) => {
    const { sessionId, payload } = event;

    // 忽略自身发起的流（通过 source/clientId 判断）
    if (payload?.source?.includes(apiService.getClientId())) {
      console.log("[ChatPanel] 忽略自身发起的流事件");
      return;
    }

    // 如果是当前会话，自动订阅流
    if (sessionId === currentSessionId.value && !isStreaming.value) {
      console.log("[ChatPanel] 检测到其他客户端的活跃流，自动订阅");
      // 如果存在 replaceMessageId，先删除本地对应消息避免重复
      if (payload?.replaceMessageId) {
        const messages = sessionStore.getMessages(sessionId);
        const index = messages.findIndex((m: any) => m.id === payload.replaceMessageId);
        if (index !== -1) {
          messages.splice(index, 1);
        }
      }
      subscribeToActiveStream();
    }
  });

  // 监听流结束事件
  unsubscribeStreamFinished = apiService.onSessionEvent("stream_finished", (event) => {
    const { sessionId } = event;
    if (sessionId === currentSessionId.value) {
      console.log("[ChatPanel] 流已结束");
    }
  });
}

/**
 * 清理 SSE 事件监听
 */
function cleanupSessionEventListeners() {
  if (unsubscribeStreamStarted) {
    unsubscribeStreamStarted();
    unsubscribeStreamStarted = null;
  }
  if (unsubscribeStreamFinished) {
    unsubscribeStreamFinished();
    unsubscribeStreamFinished = null;
  }
}

// 生命周期和初始化
onMounted(() => {
  initSessionEventListeners();
});

onUnmounted(() => {
  cleanupSessionEventListeners();
});

/**
 * 处理会话切换
 */
async function handleSessionChange(newSessionId: string | null, oldSessionId: string | null) {
  if (newSessionId === oldSessionId) return;

  isLoading.value = true;
  resetTitleFlag();
  currentSessionId.value = newSessionId;

  if (newSessionId) {
    try {
      lastScrollTop = 0;
      const sessionData = await loadSession(newSessionId);
      currentSession.value = sessionData;
      immediateScrollToBottom();

      // 页面加载时一次性检查活跃流（用于刷新后的初始状态同步）
      await checkActiveStreamOnLoad(newSessionId);

      nextTick(() => {
        if (!currentSession.value)
          return;
        if (inputMessage.value?.isWaiting) {
          currentSession.value.settings.referencedKbs = inputMessage.value.knowledgeBaseIds;
          handleSendMessage(inputMessage.value);
        }
      });
    } catch (error) {
      console.error('加载会话失败:', error);
      notify.error('加载会话失败', error.message);
    } finally {
      isLoading.value = false;
    }
  } else {
    isLoading.value = false;
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
    await streamHandler.processStream(
      streamingSessionId,
      regenerationMode,
      assistantMessageId,
      userMessageId,
    )
  } catch (error) {
    // 错误已在 composable 中处理，这里只负责显示通知
    if ((error as Error).message.includes('SessionBusyError')) {
      notify.warning("会话忙碌", "当前会话正在回复中，请稍后再试")
      return
    }
    if (error.name !== 'AbortError') {
      notify.error("请求错误", error.message)
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
    await streamHandler.processStreamWithCreate(
      streamingSessionId,
      content,
      fileIds,
      replaceMessageId,
      knowledgeBaseIds,
    )
  } catch (error) {
    if ((error as Error).message.includes('SessionBusyError')) {
      notify.warning("会话忙碌", "当前会话正在回复中，请稍后再试")
      return
    }
    if (error.name !== 'AbortError') {
      notify.error("请求错误", error.message)
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
        "删除消息",
        message.role === "user"
          ? "确定要删除这条提问吗？对应的回答也会被删除。此操作不可撤销。"
          : "确定要删除这条回答吗？此操作不可撤销。"
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
      toast.success("消息已删除");
    }
  } catch (error) {
    toast.error("删除失败");
    console.error("删除消息失败:", error);
  }
}

async function editMessage(message: any) {
  try {
    const turns = getCurrentTurns(message)
    const currentContent = turns[turns.length - 1]

    const result = await editText({
      title: "编辑消息",
      defaultValue: currentContent.content || "",
      confirmText: "保存",
      cancelText: "取消"
    }) as string | null;

    if (result != null && currentSessionId.value) {
      currentContent.content = result;
      await apiService.updateMessage(message.id, { content: result });
      sessionStore.updateMessage(currentSessionId.value, message.id, message);
      toast.success("消息已更新");
    } else if (result === null || result === undefined) {
      toast.info("已取消编辑");
    }
  } catch (error) {
    toast.error("更新失败");
    console.error("更新消息失败:", error);
  }
}

async function copyMessage(message: any) {
  try {
    const turns = getCurrentTurns(message)
    const currentContent = turns[turns.length - 1]

    if (currentContent.content) {
      await navigator.clipboard.writeText(currentContent.content);
      toast.success("消息已复制");
    }
  } catch (error) {
    console.error("复制消息失败:", error);
    toast.error("复制失败");
  }
}

/**
 * 处理发送消息
 * 合并消息创建和流式启动为一个原子操作
 */
async function handleSendMessage(payload?: InputMessageState) {
  const data = payload;
  if (!data || (!data.content?.trim() && !data.files.length) || isStreaming.value) return;

  try {
    const { content, files, knowledgeBaseIds } = data;

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

    // 统一处理发送后的滚动
    await nextTick();
    immediateScrollToBottom();

    // 发起流式请求（后端会自动创建消息并启动流）
    if (currentSessionId.value) {
      handleStreamResponseWithCreate(
        currentSessionId.value,
        prepared.content,
        prepared.fileIds,
        replaceMessageId,
        prepared.knowledgeBaseIds,
      );
    }
  } catch (error: any) {
    notify.error("消息发送失败", error.message);
    // 发送失败时由 SSE 事件驱动恢复检测
  }
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
  const versions: string[] = []
  for (let i = 0; i < message.contents.length; i++) {
    const turnsId = message.contents[i].turnsId
    if (!versions.includes(turnsId)) {
      versions.push(turnsId)
    }
  }

  if (versions.length >= MAX_REGENERATE_VERSIONS) {
    toast.error(`暂时最多支持${MAX_REGENERATE_VERSIONS}个回答版本`);
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

function switchContent(message: any, turns_id: string) {
  const targetMessage = activeMessages.value.find((m) => m.id === message.id);
  targetMessage.currentTurnsId = turns_id
  apiService.updateMessage(message.id, { currentTurnsId: turns_id });
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
  handleStreamResponseAsSubscriber(currentSessionId.value);
}

/**
 * 以订阅者身份处理流式响应（不发起新聊天，只观察已有流）
 */
async function handleStreamResponseAsSubscriber(
  streamingSessionId: string,
) {
  try {
    await streamHandler.processStream(
      streamingSessionId,
      'subscribe',
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
});

/**
 * 滚动到指定消息
 */
function scrollToMessage(messageId: string) {
  // 使用外层容器作为滚动上下文
  const container = messagesContainerRef.value

  if (!container) {
    console.warn('[ChatPanel] 未找到滚动容器')
    return
  }

  // 在容器中查找目标消息元素
  const targetElement = container.querySelector(`[data-message-id="${messageId}"]`)
  if (targetElement) {
    targetElement.scrollIntoView({
      behavior: 'smooth',
      block: 'start'  // 滚动到视口顶部
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


/* 为消息列表容器添加更强的隔离 */
:deep(.simplebar-content-wrapper) {
  contain: layout style;
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
</style>
