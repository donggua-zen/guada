<template>
  <div class="flex flex-col h-full" style="position: relative;">
    <!-- 聊天头部 -->
    <ChatHeader :sidebar-visible="sidebarVisible" :title="currentSession?.title || ''"
      @toggle-sidebar="emit('update:sidebarVisible', !sidebarVisible)" @select-more-option="handleMoreSelect" />

    <!-- 消息内容区域 -->
    <div class="flex-1 overflow-hidden w-full items-center" ref="messagesContainerRef">
      <template v-if="!isLoading && activeMessages.length === 0">
        <!-- 欢迎页 -->
        <div class="flex items-center justify-center h-full min-h-[500px] py-10 px-5">
          <div class="max-w-[600px] w-full text-center p-10 rounded-2xl animate-fade-in-up">
            <!-- 头像区域 -->
            <div class="relative inline-block mb-5">
              <div
                class="w-24 h-24 rounded-full  flex items-center justify-center mx-auto relative overflow-hidden p-0 animate-bounce-in">
                <Avatar v-if="currentSession" :src="currentSession.character.avatar_url" round />
                <div v-else class="text-4xl text-white">?</div>
              </div>
              <div class="absolute bottom-1 right-1 w-5 h-5 bg-green-500 border-2 border-white rounded-full"></div>
            </div>

            <!-- 标题和描述 -->
            <div class="mb-8">
              <h1 class="text-3xl font-bold mb-4 text-[var(--color-primary)]">
                {{ currentSession?.character.title || '' }}
              </h1>
              <h2 class="text-lg font-normal text-gray-600 leading-relaxed">
                {{ currentSession?.character.description || '' }}
              </h2>

              <!-- 角色设定 -->
              <div v-if="currentSession?.settings?.system_prompt"
                class="mt-6 p-5 bg-gray-50 rounded-xl border-l-4 border-[var(--color-primary)] text-left">
                <h3 class="text-base font-semibold text-gray-800 mb-2">角色设定</h3>
                <p class="text-sm text-gray-600 leading-6">{{ currentSession?.settings.system_prompt }}</p>
              </div>
            </div>
          </div>
        </div>
      </template>
      <template v-else-if="authStore.isAuthenticated">
        <ScrollContainer ref="scrollContainerRef" :auto-scroll="true" @scroll="handleScroll"
          @is-at-bottom-change="handleIsAtBottomChange">
          <div class="flex flex-col items-center px-[20px] max-w-[1000px] mx-auto pb-35">
            <div class="w-full" v-for="(pair, index) in messagePairs" :key="pair[0].id"
              :style="{ minHeight: index < messagePairs.length - 1 ? '0' : placeholder }">
              <MessageItem v-for="message in pair" :ref="(el) => setItemRef(el, message.id)" :key="message.id"
                :message="message" :avatar="message.role == 'user' ? userAvater : currentSession?.avatar_url"
                :is-last="message.index == activeMessages.length - 1"
                :allow-generate="!isStreaming && allowReSendMessage(message, message.index ?? 0, activeMessages)"
                @delete="deleteMessage" @edit="editMessage" @copy="copyMessage" @generate="generateResponse"
                @regenerate="regenerateResponse" @render-complete="handleRenderComplete" @switch="switchContent" />
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
          maxMemoryLength: currentSession?.settings?.max_memory_length || null
        }" :files="inputMessage.files" :streaming="isStreaming" :session-id="currentSessionId"
          @config-change="handleConfigChange" @send="handleSendMessage" @abort="abortResponse"
          @toggle-thinking="toggleDeepThinking" @tokens-statistic="handleTokensStatistic" />
      </div>
      <!-- <div class="ai-disclaimer text-xs text-gray-400 text-center mt-2">内容由 AI 生成，仅供参考</div> -->

    </div>
    <!-- Tokens 统计模态框 -->
    <TokenStatisticsModal v-model:show="showTokenModal" :currentSessionId="currentSession?.id" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUpdate, reactive, shallowRef, h, defineAsyncComponent, type Ref, type ComputedRef, type ComponentPublicInstance } from "vue";
import { apiService } from "../services/ApiService";
import { usePopup } from "@/composables/usePopup";
import { useDebounceFn, useThrottleFn } from "@vueuse/core";
import { useSessionStore } from "../stores/session";
import { useAuthStore } from "../stores/auth"
import { pairMessages, getCurrentTurns, allowReSendMessage } from "@/utils/messageUtils"
import { useStreamResponse } from "@/composables/useStreamResponse"
import type { Session } from '@/types/session';

// 组件导入
import MessageItem from "./MessageItem.vue";
import ChatHeader from "./ChatHeader.vue";
import { Avatar, ChatInput, ScrollContainer, ScrollToBottomButton } from "./ui";
// 异步组件导入
const TokenStatisticsModal = defineAsyncComponent(() => import("./TokenStatisticsModal.vue"));

// UI 组件导入

// 常量定义
const MAX_REGENERATE_VERSIONS = 5

// 弹出层工具
const { confirm, editText, toast, notify } = usePopup();
const authStore = useAuthStore()
const sessionStore = useSessionStore();

// 初始化流式响应处理器
const streamHandler = useStreamResponse(sessionStore, apiService)



// 响应式数据 - 类型化
const scrollContainerRef = ref<any>(null);
const messagesContainerRef = ref<HTMLElement | null>(null);
const currentSessionId = ref<string | null>(null);
const showTokenModal = ref(false);
// 使用 shallowRef 减少响应式开销，存储消息项组件实例
const itemRefs = shallowRef<Record<string, ComponentPublicInstance | null>>({}); 
const isLoading = ref(false)
const autoScrollToBottom = ref(false);
const autoScrollToBottomSet = ref(-1);
const placeholder = ref("auto");
// 回到底部按钮相关状态
const showScrollToBottomBtn = ref(false);

// 编辑模式状态（简化）
const editMode = ref<{ message: any; inputMessage: { content: string; files: any[]; isWaiting?: boolean } } | null>(null); // null 表示非编辑模式，{ message, inputMessage } 表示编辑模式

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


const userAvater = computed(() => authStore.user?.avatar_url);

const currentModelName = computed(() => {
  if (!currentSession.value?.model) return "请选择对话模型";
  return currentSession.value.model.model_name.split("/").pop() || "unknown";
});

const isStreaming = computed(() => {
  const sessionId = currentSessionId.value;
  return sessionId ? sessionStore.sessionIsStreaming(sessionId) : false;
});

// 按钮是否应该显示呼吸动画（与 isStreaming 解耦，避免隐藏时冲突）
const shouldButtonBreathe = ref(false)

const inputMessage = computed({
  get: () => {
    const sessionId = currentSessionId.value;
    return sessionId ? sessionStore.getInputMessage(sessionId) || { content: "", files: [], isWaiting: false } : { content: "", files: [], isWaiting: false };
  },
  set: (value: { content: string; files: any[]; isWaiting?: boolean }) => {
    const sessionId = currentSessionId.value;
    if (sessionId) {
      sessionStore.setInputMessage(sessionId, value);
    }
  }
});

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
    return currentSession.value?.settings?.thinking_enabled;
  },
  set(value: boolean) {
    if (currentSession.value?.settings) {
      currentSession.value.settings["thinking_enabled"] = value;
      currentSession.value.updated_at = new Date().toISOString();
    }
  }
});

const currentModelId = computed({
  get() {
    return currentSession.value?.model_id ?? null;
  },
  set(value: string | null) {
    if (currentSession.value) {
      // 如果值为 null，使用空字符串作为后备（符合 Session 类型定义）
      currentSession.value.model_id = value || '';
      currentSession.value.updated_at = new Date().toISOString();
      debouncedSaveSession();
    }
  }
});


// 防抖函数
// const debouncedUpdatedSession = useDebounceFn(updateSessionLastMessage, 1000);
const debouncedSwitchContent = useDebounceFn(
  (messageId, turns_id) => apiService.updateMessage(messageId, {
    current_turns_id: turns_id,
  }),
  300
);
const debouncedSaveSession = useDebounceFn(() => {
  emit("save-settings");
}, 200);

const handleConfigChange = (config: any) => {
  if (!currentSession.value) return;
  if (typeof config.modelId !== 'undefined')
    currentSession.value.model_id = config.modelId;
  if (typeof config.maxMemoryLength !== 'undefined')
    currentSession.value.settings.max_memory_length = config.maxMemoryLength;
  emit("save-settings");
};

// 滚动相关工具函数（需要在 watch 之前定义）
const debouncedResetScrollFlag = useDebounceFn(() => {
  autoScrollToBottomSet.value = -1
}, 100);

/**
 * 处理滚动到底部状态变化
 * @param {boolean} isAtBottom - 是否在底部
 */
const handleIsAtBottomChange = useThrottleFn((isAtBottom) => {
  console.log('[ScrollButton] isAtBottom change:', isAtBottom)

  // 如果在底部，立即隐藏按钮（同时停止呼吸动画以避免冲突）
  if (isAtBottom) {
    // 先停止呼吸动画，避免与淡出动画冲突
    shouldButtonBreathe.value = false
    // 然后隐藏按钮
    showScrollToBottomBtn.value = false
    console.log('[ScrollButton] Button hidden immediately due to at bottom')
  }
}, 50)  // ← 减少节流时间到 50ms，更快响应

/**
 * 处理回到底部按钮点击
 */
const handleScrollToBottomClick = () => {
  console.log('[ScrollButton] clicked')
  scrollToBottomSmooth()
}

/**
 * 平滑滚动到底部（优先使用平滑滚动）
 */
function scrollToBottomSmooth() {
  if (scrollContainerRef.value) {
    scrollContainerRef.value.smoothScrollToBottom()

    // 强制设置为自动滚动模式
    nextTick(() => {
      immediateScrollToBottom(true)
    })
  }
}

/**
 * 智能更新回到底部按钮显示状态
 * 在流式输出时，如果用户不在底部，显示按钮
 */
const updateScrollButtonVisibility = useDebounceFn(() => {
  // 检查是否在底部 - 注意：isAtBottom 是 computed，不需要 .value
  const isAtBottom = scrollContainerRef.value?.isAtBottom

  console.log('[ScrollButton] updateScrollButtonVisibility:', {
    isAtBottom,
    isStreaming: isStreaming.value,
    shouldButtonBreathe: shouldButtonBreathe.value,
    showBefore: showScrollToBottomBtn.value,
    hasScrollContainer: !!scrollContainerRef.value,
    hasIsAtBottom: !!scrollContainerRef.value?.isAtBottom
  })

  // 如果在底部，总是隐藏按钮（无延迟）
  if (isAtBottom) {
    showScrollToBottomBtn.value = false
    console.log('[ScrollButton] HIDDEN - at bottom')
    return
  }

  // 不在底部时，只在流式输出期间显示按钮
  if (isStreaming.value) {
    showScrollToBottomBtn.value = true
    // 确保呼吸动画也开启
    shouldButtonBreathe.value = true
    console.log('[ScrollButton] SHOWN - streaming and not at bottom, breathing enabled')
  } else {
    showScrollToBottomBtn.value = false
    console.log('[ScrollButton] HIDDEN - not streaming')
  }
}, 50)  // ← 减少防抖时间到 50ms，更快响应

// 标题生成标记（需要在 handleSessionChange 之前声明）
let hasGeneratedTitle = ref(false);

// 监听器
watch(() => props.session?.id, async (newSessionId: string | undefined, oldSessionId: string | undefined) => {
  await handleSessionChange(newSessionId ?? null, oldSessionId ?? null);
}, { immediate: true });

// 监听流式状态变化，在第一次对话完成后生成标题
watch(() => isStreaming.value, async (newVal, oldVal) => {
  console.log('[ScrollButton] Streaming watch triggered:', { oldVal, newVal })

  // 当流式状态从 true 变为 false 时（即助手回复完成）
  if (oldVal === true && newVal === false) {
    console.log('[ScrollButton] Streaming finished, checking title generation')

    // 检查是否是第一条助手消息
    // const firstAssistantMessage = activeMessages.value.find(m => m.role === 'assistant');

    if (activeMessages.value.length == 2 && !hasGeneratedTitle.value) {
      // 标记已生成标题，避免重复调用
      hasGeneratedTitle.value = true;

      // 调用标题生成 API
      try {
        if (!currentSessionId.value) return;
        const result = await apiService.generateSessionTitle(currentSessionId.value);

        // 如果成功生成了新标题
        if (!result.skipped && result.title) {
          // 更新会话标题
          if (currentSession.value) {
            currentSession.value.title = result.title;

            // 通知用户
            notify.success('标题已更新', `会话标题已自动更新为"${result.title}"`);

            // 同步到 session store
            if (currentSessionId.value) {
              sessionStore.updateSessionTitle(currentSessionId.value, result.title);
            }
          }
        }
      } catch (error) {
        console.error('生成会话标题失败:', error);
        // 不显示错误提示，避免影响用户体验
      }
    }

    // 流式结束，隐藏按钮（已在 updateScrollButtonVisibility 中处理）
    console.log('[ScrollButton] Streaming ended, button will be hidden by updateScrollButtonVisibility')
  }
}, { immediate: true });

// 监听消息变化，智能显示回到底部按钮
watch(() => activeMessages.value.length, () => {
  console.log('[ScrollButton] Message count changed:', activeMessages.value.length)
  updateScrollButtonVisibility()
}, { immediate: true });

// 监听流式状态变化，控制按钮显示和呼吸动画
watch(() => isStreaming.value, (newVal) => {
  console.log('[ScrollButton] Streaming state changed:', newVal)
  // 更新呼吸动画状态
  shouldButtonBreathe.value = newVal
  // 流式状态变化时立即更新按钮状态
  updateScrollButtonVisibility()
}, { immediate: true });


// 生命周期
onBeforeUpdate(() => {
  itemRefs.value = {};
});

onMounted(() => {
  // 初始化相关逻辑
});

// 滚动功能
function immediateScrollToBottom(persistent = false) {
  autoScrollToBottom.value = persistent
  autoScrollToBottomSet.value = persistent ? 1 : 0
  debouncedResetScrollFlag();

  scrollContainerRef.value?.immediateScrollToBottom();
}

const handleRenderComplete = () => {
  if (autoScrollToBottom.value) {
    nextTick(() => {
      console.log("handleRenderComplete2")
      immediateScrollToBottom(true);
    });
  }

  // 渲染完成后更新按钮状态
  nextTick(() => {
    updateScrollButtonVisibility()
  })
}

const handleScroll = (_event: any) => {
  if (scrollContainerRef.value) {
    if (scrollContainerRef.value.isAtBottom) {
      if (autoScrollToBottomSet.value >= 0) {
        autoScrollToBottom.value = autoScrollToBottomSet.value === 1
        // autoScrollToBottomSet.value = -1
        return
      }
      autoScrollToBottom.value = true
    } else {
      autoScrollToBottom.value = false
    }
  }
}

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
      // debouncedUpdatedSession();
    } catch (error) {
      console.error("导入聊天记录失败:", error);
      toast.error("文件格式错误或读取失败");
    }
  };

  input.click();
}

/**
 * 设置消息项引用
 */
function setItemRef(el: any, messageId: string) {
  if (el) itemRefs.value[messageId] = el;
}

/**
 * 处理会话切换
 */
async function handleSessionChange(newSessionId: string | null, oldSessionId: string | null) {
  if (newSessionId === oldSessionId) return;
  isLoading.value = true;
  updatePlaceholder(null);
  hasGeneratedTitle.value = false; // 重置标题生成标记
  currentSessionId.value = newSessionId;
  if (newSessionId) {
    try {
      // 获取会话配置
      const sessionData = await apiService.fetchSession(newSessionId);
      currentSession.value = sessionData;

      // 加载消息
      await loadMessages(newSessionId);

      nextTick(() => {
        immediateScrollToBottom();
        if (inputMessage.value && 'isWaiting' in inputMessage.value && inputMessage.value.isWaiting) {
          handleSendMessage();
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
 * 加载会话消息
 */
async function loadMessages(sessionId: string) {
  if (sessionStore.getMessages(sessionId).length === 0) {
    const sessionMessages = await apiService.fetchSessionMessages(sessionId);

    // 处理历史消息，从 meta_data 中回填 thinking_duration_ms
    sessionMessages.items.forEach(message => {
      if (message.contents && Array.isArray(message.contents)) {
        message.contents.forEach(content => {
          // 如果 meta_data 中有思考时长，则使用后端保存的值（覆盖可能存在的旧值）
          if (content.meta_data?.thinking_duration_ms) {
            content.thinking_duration_ms = content.meta_data.thinking_duration_ms;
          }
          // 初始化 state，防止未定义错误
          if (!content.state) {
            content.state = {
              is_streaming: false,
              is_thinking: false,
            };
          }
        });
      }
    });

    // 使用 shallowRef 优化大对象
    sessionStore.setMessages(sessionId, sessionMessages.items);
  }
}

// 注意：getCurrentTurns, allowReSendMessage 已直接从 utils/messageUtils 导入
// 不需要包装函数，直接使用即可



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
    // debouncedUpdatedSession();
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
        const assistantMessage = activeMessages.value.find((msg) => msg.parent_id === message.id);
        if (assistantMessage && currentSessionId.value) {
          sessionStore.deleteMessage(currentSessionId.value, assistantMessage.id);
        }
      }
      if (currentSessionId.value) {
        sessionStore.deleteMessage(currentSessionId.value, message.id);
      }
      delete itemRefs.value[message.id];
      toast.success("消息已删除");
    }
  } catch (error) {
    toast.error("删除失败");
    console.error("删除消息失败:", error);
  }
}

async function editMessage(message: any) {
  try {
    // 使用 getCurrentTurns 获取当前版本的内容数组，取最后一个作为编辑对象
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
      // debouncedUpdatedSession();
      toast.success("消息已更新");
    } else if (result === null || result === undefined) {
      // 用户取消了编辑
      toast.info("已取消编辑");
    }
  } catch (error) {
    toast.error("更新失败");
    console.error("更新消息失败:", error);
  }
}

async function copyMessage(message: any) {
  try {
    // 使用 getCurrentTurns 获取当前版本的内容数组，取最后一个作为复制对象
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
 * 更新占位符元素的最小高度
 */
function updatePlaceholder(userMessageId: string | null) {
  // 常量定义：消息高度阈值比例（超过 1/3 视口时触发调整）
  const MESSAGE_HEIGHT_THRESHOLD_RATIO = 1 / 3;
  // 最大占位符倍数（不超过容器高度的 3 倍）
  const MAX_PLACEHOLDER_MULTIPLIER = 3;

  try {
    // 空值处理：重置为自动高度
    if (!userMessageId) {
      placeholder.value = "auto";
      return;
    }

    // 使用 requestAnimationFrame 批量 DOM 操作，避免布局抖动
    requestAnimationFrame(() => {
      const userMessageRef = itemRefs.value[userMessageId];

      // 改进错误处理：元素不存在时降级为自动高度
      if (!userMessageRef) {
        console.warn(`Component ref for userMessageId ${userMessageId} not found`, userMessageRef);
        placeholder.value = "auto";
        return;
      }

      // 使用组件暴露的 el 属性（而不是 $el，因为 $el 可能是 Text Node）
      const userMessageElement = (userMessageRef as any).el;
      
      // 详细的调试日志
      console.log('[updatePlaceholder]', {
        messageId: userMessageId,
        hasRef: !!userMessageRef,
        hasEl: !!userMessageElement,
        elType: userMessageElement?.constructor?.name,
        nodeType: userMessageElement?.nodeType,
        nodeName: userMessageElement?.nodeName,
        element: userMessageElement
      });
      
      if (!userMessageElement) {
        console.warn(`Element (el) for userMessageId ${userMessageId} is null/undefined`);
        placeholder.value = "auto";
        return;
      }

      // 确保是 Element 类型（不是 Text Node、Comment Node 等）
      if (!(userMessageElement instanceof Element)) {
        console.warn(`el is not an Element type for userMessageId ${userMessageId}, got:`, userMessageElement?.nodeType, userMessageElement?.nodeName);
        placeholder.value = "auto";
        return;
      }

      // 批量读取 DOM 属性（只触发一次重排）
      if (!messagesContainerRef.value) {
        console.warn('messagesContainerRef not available');
        placeholder.value = "auto";
        return;
      }
      const containerRect = messagesContainerRef.value.getBoundingClientRect();
      const style = window.getComputedStyle(userMessageElement);
      const userElHeight = parseFloat(style.height)
        + parseFloat(style.marginTop)
        + parseFloat(style.marginBottom);

      // 动态计算最小高度
      let baseMinHeight = containerRect.height - 140;

      if (userElHeight > containerRect.height * MESSAGE_HEIGHT_THRESHOLD_RATIO) {
        baseMinHeight += (userElHeight - containerRect.height * MESSAGE_HEIGHT_THRESHOLD_RATIO);
      }

      // 限制最大值，防止布局错乱
      const maxHeight = containerRect.height * MAX_PLACEHOLDER_MULTIPLIER;
      placeholder.value = Math.min(baseMinHeight, maxHeight) + "px";
    });

  } catch (error) {
    console.error("Error updating placeholder:", error);
    // 错误时降级为自动高度
    placeholder.value = "auto";
  }
}

/**
 * 发送新消息
 */
async function sendNewMessage(
  sessionId: string,
  text: string,
  files: any[],
  replaceMessageId: string | null = null
) {
  // 过滤出含有file.file的有效文件
  const filesWithContent = files.filter((file) => file.file);

  // 批量上传文件
  const uploadPromises = filesWithContent.map((file) =>
    apiService.uploadFile(sessionId, file.file)
  );

  // 等待所有文件上传完成
  const uploadResults = await Promise.all(uploadPromises);

  // 处理上传结果
  const updatedFiles = [...files]; // 创建副本避免修改原数组
  uploadResults.forEach((response, index) => {
    try {
      // 更新对应文件的信息
      const fileIndex = files.indexOf(filesWithContent[index]);
      if (fileIndex !== -1) {
        updatedFiles[fileIndex] = {
          ...updatedFiles[fileIndex],
          ...response
        };
        // 移除原始文件对象以节省内存
        delete updatedFiles[fileIndex].file;
        delete updatedFiles[fileIndex].content;
      }
    } catch (error) {
      console.error(`文件 ${index} 处理失败:`, error);
    }
  });

  const response = await apiService.createMessage(sessionId, text, updatedFiles, replaceMessageId);
  const message = reactive({ ...response, files: updatedFiles });
  if (replaceMessageId) {
    sessionStore.deleteMessage(sessionId, replaceMessageId);
    const assistantMessage = activeMessages.value.find((msg) => msg.parent_id === replaceMessageId);
    if (assistantMessage) {
      sessionStore.deleteMessage(sessionId, assistantMessage.id);
    }
  }
  activeMessages.value.push(message);
  // debouncedUpdatedSession();
  await nextTick();
  updatePlaceholder(message.id);
  await nextTick();
  requestAnimationFrame(() => {
    immediateScrollToBottom();
  });
  // autoScrollToBottom.value = false;
  return message;
}

/**
 * 处理发送消息
 */
async function handleSendMessage() {
  const data = inputMessage.value;
  if ((!data.content?.trim() && !data.files.length) || isStreaming.value) return;

  try {
    const { content, files } = data;

    // 如果是编辑模式，使用重新发送逻辑
    if (editMode.value && editMode.value.message) {
      await sendEditMessage(content, files);
      return;
    }

    // 否则发送新消息
    if (!currentSession.value) {
      notify.error("发送失败", "当前没有活动的会话");
      return;
    }

    const message = await sendNewMessage(currentSession.value.id, content, files);
    inputMessage.value = { content: "", files: [], isWaiting: false };
    if (currentSessionId.value) {
      handleStreamResponse(currentSessionId.value, message.id);
    }
  } catch (error: any) {
    notify.error("消息发送失败", error.message);
  }
}

/**
 * 退出编辑模式
 */
function exitEditMode() {
  editMode.value = null;
  inputMessage.value = { content: "", files: [], isWaiting: false };
}

/**
 * 发送编辑后的消息
 */
async function sendEditMessage(text: string, files: any[]) {
  if (!editMode.value || !currentSession.value) return;

  try {
    const message = await sendNewMessage(
      currentSession.value.id,
      text,
      files,
      editMode.value.message.id
    );

    // 退出编辑模式
    exitEditMode();

    // 开始流式响应
    if (currentSessionId.value) {
      handleStreamResponse(currentSessionId.value, message.id);
    }
  } catch (error: any) {
    notify.error("消息发送失败", error.message);
  }
}

/**
 * 进入编辑模式以重新生成消息
 */
function generateResponse(message: any) {
  // 进入编辑模式
  editMode.value = {
    message: message,
    inputMessage: {
      content: message.contents[0].content,
      files: message.files || [],
      isWaiting: false
    }
  }

  // 将消息内容设置到输入框
  inputMessage.value = editMode.value.inputMessage

  // 滚动到底部以便用户看到输入框
  nextTick(() => {
    immediateScrollToBottom();
  });
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
    assistantMessage.state = { is_streaming: true };
  }

  updatePlaceholder(message.parent_id);
  nextTick(() => {
    immediateScrollToBottom();
    if (currentSessionId.value) {
      handleStreamResponse(currentSessionId.value, message.parent_id, "multi_version", message.id);
    }
  });
}

function switchContent(message: any, turns_id: string) {
  const targetMessage = activeMessages.value.find((m) => m.id === message.id);
  targetMessage.current_turns_id = turns_id
  debouncedSwitchContent(message.id, turns_id);
  nextTick(() => {
    console.log("debouncedSwitchContent immediateScrollToBottom");
    immediateScrollToBottom();
  });
  // debouncedUpdatedSession();
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
