<template>
  <div class="flex flex-col h-full" style="position: relative;">
    <!-- 聊天头部 -->
    <ChatHeader :sidebar-visible="sidebarVisible" :title="currentSession?.title || ''" :has-more-options="true"
      @toggle-sidebar="emit('update:sidebarVisible', !sidebarVisible)" @select-more-option="handleMoreSelect" />

    <!-- 消息内容区域 -->
    <div class="flex-1 overflow-hidden w-full items-center" ref="messagesContainerRef">
      <template v-if="!isLoading && activeMessages.length === 0">
        <!-- 欢迎页 -->
        <div class="flex items-center justify-center h-full min-h-125 py-10 px-5">
          <div class="max-w-150 w-full text-center p-10 rounded-2xl animate-fade-in-up">
            <!-- 头像区域 -->
            <div class="relative inline-block mb-5">
              <div
                class="w-24 h-24 rounded-full  flex items-center justify-center mx-auto relative overflow-hidden p-0 animate-bounce-in">
                <Avatar v-if="currentSession" :src="currentSession.character.avatarUrl" round />
                <div v-else class="text-4xl text-white">?</div>
              </div>
              <div class="absolute bottom-1 right-1 w-5 h-5 bg-green-500 border-2 border-white rounded-full"></div>
            </div>

            <!-- 标题和描述 -->
            <div class="mb-8">
              <h1 class="text-3xl font-bold mb-4 text-(--color-primary)">
                {{ currentSession?.character.title || '' }}
              </h1>
              <h2 class="text-lg font-normal text-gray-600 leading-relaxed">
                {{ currentSession?.character.description || '' }}
              </h2>

              <!-- 角色设定 -->
              <div v-if="currentSession?.settings?.systemPrompt"
                class="mt-6 p-5 bg-gray-50 rounded-xl border-l-4 border-(--color-primary) text-left">
                <h3 class="text-base font-semibold text-gray-800 mb-2">角色设定</h3>
                <p class="text-sm text-gray-600 leading-6">{{ currentSession?.settings.systemPrompt }}</p>
              </div>
            </div>
          </div>
        </div>
      </template>
      <template v-else-if="authStore.isAuthenticated">
        <ScrollContainer ref="scrollContainerRef" :auto-scroll="true" @scroll="handleScroll">
          <div class="flex flex-col items-center px-5 max-w-250 mx-auto pb-35">
            <div class="w-full last:min-h-60" v-for="(pair, index) in messagePairs" :key="pair[0].id">
              <MessageItem v-for="message in pair" :key="message.id" :message="message"
                :avatar="message.role == 'user' ? userAvater : currentSession?.avatarUrl"
                :is-last="message.index == activeMessages.length - 1"
                :allow-generate="!isStreaming && allowReSendMessage(message, message.index ?? 0, activeMessages)"
                @delete="deleteMessage" @edit="editMessage" @copy="copyMessage" @generate="generateResponse"
                @regenerate="regenerateResponse" @switch="switchContent" />
            </div>
          </div>
        </ScrollContainer>

        <!-- 回到底部悬浮按钮 -->
        <ScrollToBottomButton :show="showScrollToBottomBtn" :is-streaming="shouldButtonBreathe"
          @click="handleScrollToBottomClick" />
      </template>
    </div>

    <!-- 输入区域 -->
    <div class="px-5 pb-2.5 pt-2 w-full flex flex-col items-center" style="position: absolute; bottom: 0;">
      <!-- 编辑模式提示条 -->
      <div v-if="editMode" class="w-full max-w-[960px] mb-[-0.6rem]">
        <div class="edit-mode-banner">
          <span class="edit-mode-icon">📝</span>
          <span class="edit-mode-text">正在编辑消息</span>
          <el-button size="small" @click="exitEditMode" class="cancel-edit-btn">
            取消
          </el-button>
        </div>
      </div>

      <div class="w-full flex items-center max-w-[960px]">
        <ChatInput v-model:value="inputMessage.content" v-model:thinking-enabled="thinkingEnabled" :config="{
          modelId: currentModelId,
          maxMemoryLength: currentSession?.settings?.maxMemoryLength || null,
          knowledgeBaseIds: inputMessage?.knowledgeBaseIds || currentSession?.settings?.referencedKbs || []
        }" :files="inputMessage.files" :streaming="isStreaming" @config-change="handleConfigChange"
          @send="handleSendMessage" @abort="abortResponse" @toggle-thinking="toggleDeepThinking" />
      </div>
      <!-- <div class="ai-disclaimer text-xs text-gray-400 text-center mt-2">内容由 AI 生成，仅供参考</div> -->

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, type Ref } from "vue";
import { apiService } from "../services/ApiService";
import { usePopup } from "@/composables/usePopup";
import { useDebounceFn } from "@vueuse/core";
import { useSessionStore } from "../stores/session";
import { useAuthStore } from "../stores/auth"
import { pairMessages, getCurrentTurns, allowReSendMessage } from "@/utils/messageUtils"
import { useStreamResponse } from "@/composables/useStreamResponse"
import type { InputMessageState, Session } from '@/types/session';

// 导入新创建的 composables
import { useSessionChat } from '@/composables/useSessionChat'
import { useMessageOperations } from '@/composables/useMessageOperations'

// 组件导入
import MessageItem from "./MessageItem.vue";
import ChatHeader from "./ChatHeader.vue";
import { Avatar, ChatInput, ScrollContainer, ScrollToBottomButton } from "./ui";
import ChatMessages from './ChatMessages.vue'
import ChatInputArea from './ChatInputArea.vue'


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
const scrollContainerRef = ref<any>(null);
const showTokenModal = ref(false);

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
  updateScrollButtonVisibility()
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

const messagePairs = computed(() => pairMessages(activeMessages.value));

const thinkingEnabled = computed({
  get() {
    return currentSession.value?.settings?.thinkingEnabled;
  },
  set(value: boolean) {
    if (currentSession.value?.settings) {
      currentSession.value.settings.thinkingEnabled = value;
      currentSession.value.updatedAt = new Date().toISOString();
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


const handleConfigChange = (config: any) => {
  if (!currentSession.value) return;
  if (typeof config.modelId !== 'undefined')
    currentSession.value.modelId = config.modelId;
  if (typeof config.maxMemoryLength !== 'undefined')
    currentSession.value.settings.maxMemoryLength = config.maxMemoryLength;
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
  // 初始化相关逻辑
});

// 更多操作菜单选择处理
function handleMoreSelect(key: string) {
  switch (key) {
    case "clear":
      clearChat();
      break;
    case "export":
      exportChat();
      break;
    case "import":
      importChat();
      break;
  }
}

// 聊天记录导入导出
function exportChat() {
  try {
    if (!currentSession.value) {
      toast.error("当前没有活动的会话");
      return;
    }

    const chatData = {
      session: currentSession.value,
      messages: activeMessages.value,
      exportTime: new Date().toISOString()
    };

    const dataStr = JSON.stringify(chatData, null, 2);
    const dataBlob = new Blob([dataStr], { type: "application/json" });

    const link = document.createElement("a");
    link.href = URL.createObjectURL(dataBlob);
    link.download = `chat-export-${currentSession.value.title || "session"
      }-${new Date().getTime()}.json`;
    link.click();
    URL.revokeObjectURL(link.href);

    toast.success("聊天记录导出成功");
  } catch (error) {
    console.error("导出聊天记录失败:", error);
    toast.error("导出失败");
  }
}

async function importChat() {
  if (!currentSession.value) {
    toast.error("当前没有活动的会话");
    return;
  }

  if (!(await confirm("导入聊天记录", "确定要导入聊天记录吗？这将替换当前的聊天记录。"))) {
    return;
  }
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";

  input.onchange = async (e: Event) => {
    const target = e.target as HTMLInputElement;
    if (!target) return;
    const file = target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const chatData = JSON.parse(text);
      // 这里可以添加数据验证逻辑
      if (!currentSession.value) {
        toast.error("当前没有活动的会话");
        return;
      }
      await apiService.importMessages(currentSession.value.id, chatData.messages);
      toast.success("聊天记录导入成功");
      loadMessages(currentSession.value.id);
    } catch (error) {
      console.error("导入聊天记录失败:", error);
      toast.error("文件格式错误或读取失败");
    }
  };

  input.click();
}

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

async function clearChat() {
  if (await confirm("清空聊天记录", "确定要删除所有聊天记录吗？此操作不可撤销。")) {
    if (currentSessionId.value) {
      await apiService.clearSessionMessages(currentSessionId.value);
      sessionStore.clearSessionState(currentSessionId.value);
    }
    toast.success("聊天记录已清空");
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

function handleTokensStatistic() {
  showTokenModal.value = true;
}

defineExpose({ sendMessage: handleSendMessage })

</script>

<style scoped>
/* 动画定义 */
@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(30px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes bounceIn {
  0% {
    opacity: 0;
    transform: scale(0.3);
  }

  50% {
    opacity: 1;
    transform: scale(1.05);
  }

  70% {
    transform: scale(0.9);
  }

  100% {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes fadeInDown {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.animate-fade-in-up {
  animation: fadeInUp 0.8s ease-out;
}

.animate-bounce-in {
  animation: bounceIn 1s ease-out;
}

.animate-fade-in-down {
  animation: fadeInDown 0.3s ease-out;
}

/* 编辑模式提示条样式 */
.edit-mode-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px 15px 12px;
  background: #fff7e6;
  border: 1px solid #e6a23c;
  border-radius: 6px;
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
