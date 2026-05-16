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
        <div class="flex flex-col items-center px-5 max-w-205 mx-auto">
          <MessageItem v-for="(message, index) in activeMessages" :key="message.id" :message="message"
            v-memo="[message.id, message.contents, message.currentTurnsId, message.state?.isStreaming, message.state?.isThinking]"
            :avatar="message.role == 'user' ? userAvater : currentSession?.avatarUrl"
            :is-last="index === activeMessages.length - 1"
            :allow-generate="!isStreaming && allowReSendMessage(message, index, activeMessages)" @delete="deleteMessage"
            @edit="editMessage" @copy="copyMessage" @generate="generateResponse" @regenerate="regenerateResponse"
            @switch="switchContent" />
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
  <div class="pb-6 w-full px-5  max-w-205 flex flex-col items-center mx-auto"
    _style="position: absolute; left: 50%; transform: translateX(-50%);bottom: 0;">
    <!-- 编辑模式提示条 -->
    <div v-if="editMode" class="w-full mb-[-0.2rem]">
      <div
        class="edit-mode-banner pt-1 pb-3.5 px-2 bg-gray-50 dark:bg-[#2a2c30] border border-gray-300 dark:border-[#383a40] rounded-lg">
        <span class="edit-mode-icon">📝</span>
        <span class="edit-mode-text">正在编辑消息</span>
        <el-button size="small" @click="exitEditMode" class="cancel-edit-btn">
          取消
        </el-button>
      </div>
    </div>

    <div class="w-full flex items-center" style="margin-top: -10px;z-index: 9;">
      <ChatInput v-model:value="inputMessage.content"
        :config="chatInputConfig" :files="inputMessage.files" :streaming="isStreaming"
        @config-change="handleConfigChange" @send="handleSendMessage" @abort="abortResponse"
        @toggle-thinking="toggleDeepThinking" />
    </div>
    <!-- <div class="ai-disclaimer text-xs text-gray-400 text-center mt-2">内容由 AI 生成，仅供参考</div> -->

  </div>

</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, type Ref, h } from "vue";
import { apiService } from "../../services/ApiService";
import { usePopup } from "@/composables/usePopup";
import { useDebounceFn } from "@vueuse/core";
import { useSessionStore } from "../../stores/session";
import { useAuthStore } from "../../stores/auth"
import { getCurrentTurns, allowReSendMessage } from "@/utils/messageUtils"
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

// 使用 useMessageOperations composable
const {
  inputMessage,
  editMode,
  exitEditMode,
  sendNewMessage,
  sendEditMessage,
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
watch(() => isStreaming.value, (newVal) => {
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
  knowledgeBaseIds: inputMessage.value?.knowledgeBaseIds || currentSession.value?.settings?.referencedKbs || []
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

  debouncedSaveSession();
};

// 防抖函数
const debouncedSaveSession = useDebounceFn(() => {
  emit("save-settings");
}, 100);

// 监听器
watch(() => props.session?.id, async (newSessionId: string | undefined, oldSessionId: string | undefined) => {
  await handleSessionChange(newSessionId ?? null, oldSessionId ?? null);
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

// 生命周期和初始化
onMounted(() => {
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

// 流式响应处理（委托给 composable 处理）
async function handleStreamResponse(
  streamingSessionId: string,
  userMessageId: string,
  regenerationMode: any = null,
  assistantMessageId: string | null = null
) {
  try {
    await streamHandler.processStream(
      streamingSessionId,
      userMessageId,
      regenerationMode,
      assistantMessageId
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
 */
async function handleSendMessage(payload?: InputMessageState) {
  const data = payload;
  if (!data || (!data.content?.trim() && !data.files.length) || isStreaming.value) return;

  try {
    const { content, files, knowledgeBaseIds } = data;
    let message: any;

    // 如果是编辑模式，使用重新发送逻辑
    if (editMode.value && editMode.value.message) {
      message = await sendEditMessage(content, files, knowledgeBaseIds);
    } else {
      // 否则发送新消息
      message = await sendNewMessage(content, files, null, knowledgeBaseIds);
    }

    // 统一处理发送后的滚动和流式响应
    await nextTick();
    immediateScrollToBottom();
    if (message.sessionId) {
      handleStreamResponse(message.sessionId, message.id);
    }
  } catch (error: any) {
    notify.error("消息发送失败", error.message);
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
    const turns_id = message.contents[i].turns_id
    if (!versions.includes(turns_id)) {
      versions.push(turns_id)
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
      handleStreamResponse(message.sessionId, message.parentId, "multi_version", message.id);
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

const toggleDeepThinking = () => {
  debouncedSaveSession();
};

// 将方法暴露给父组件
defineExpose({
  sendMessage: handleSendMessage,
  loadMessages,
  activeMessages,
  scrollToMessage,
  getScrollElement: () => scrollContainerRef.value?.getScrollElement?.() || null  // 提供获取滚动元素的方法
})

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
  will-change: width;

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

.edit-mode-icon {
  font-size: 18px;
  flex-shrink: 0;
}

.edit-mode-text {
  flex: 1;
  color: #606266;
  font-size: 14px;
  font-weight: 500;
}

.dark .edit-mode-text {
  color: oklch(80% 0.02 250);
  /* 暗色模式下的文本颜色 */
}

/* 取消编辑按钮样式 */
.cancel-edit-btn {
  background: transparent;
  border: 1px solid #f56c6c;
  color: #f56c6c;
  font-size: 13px;
  padding: 5px 12px;
  border-radius: 4px;
  transition: all 0.2s ease;
  cursor: pointer;
}

.cancel-edit-btn:hover {
  background: #f56c6c;
  color: white;
  border-color: #f56c6c;
  transform: translateY(-1px);
  box-shadow: 0 2px 6px rgba(245, 108, 108, 0.2);
}

.cancel-edit-btn:active {
  transform: translateY(0);
  box-shadow: 0 1px 3px rgba(245, 108, 108, 0.15);
}
</style>
