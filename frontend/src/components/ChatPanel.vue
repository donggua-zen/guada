<template>
  <div class="flex flex-col h-full">
    <!-- 聊天头部 -->
    <div class="chat-header">
      <template v-if="!loaclSidebarVisible">
        <n-button text @click="loaclSidebarVisible = true">
          <template #icon>
            <n-icon size="22">
              <FormatListBulletedSharp />
            </n-icon>
          </template>
        </n-button>
        <span class="ml-4"></span>
      </template>
      <span>{{ chatTitle }}</span>
      <n-divider vertical />
      <n-button tertiary round size="small" icon-placement="left" @click="handleSwitchModelClick">{{ currentModelName }}
        <template #icon>
          <n-icon size="18">
            <SettingsTwotone />
          </n-icon>
        </template>
      </n-button>

      <div class="flex items-center flex-1 justify-end">
        <n-button class="clear-chat-btn" title="清空聊天记录" @click="clearChat" text>
          <template #icon>
            <n-icon size="24">
              <DeleteTwotone />
            </n-icon>
          </template>
        </n-button>

        <!-- <n-button class="settings-btn ml-2" title="设置" @click="handleSettingsClick" text>
          <template #icon>
            <n-icon size="24">
              <SettingsApplicationsTwotone />
            </n-icon>
          </template>
        </n-button> -->
      </div>
    </div>

    <!-- 消息内容区域 -->
    <div class="messages-container" ref="messagesContainer">
      <template v-if="activeMessages.length === 0">
        <!-- 欢迎页 -->
        <div class="flex items-center justify-center h-full min-h-[500px] py-10 px-5">
          <div class="max-w-[600px] w-full text-center p-10 rounded-2xl animate-fade-in-up">
            <!-- 头像区域 -->
            <div class="relative inline-block mb-5">
              <div
                class="w-24 h-24 rounded-full bg-gradient-to-br from-[#667eea] to-[var(--primary-color)] flex items-center justify-center mx-auto relative overflow-hidden p-0 animate-bounce-in">
                <Avatar v-if="currentSession" :src="currentSession.avatar_url" round />
                <div v-else class="text-4xl text-white">?</div>
              </div>
              <div class="absolute bottom-1 right-1 w-5 h-5 bg-green-500 border-2 border-white rounded-full"></div>
            </div>

            <!-- 标题和描述 -->
            <div class="mb-8">
              <h1
                class="text-3xl font-bold text-gray-800 mb-4 bg-gradient-to-br from-[#667eea] to-[var(--primary-color)] bg-clip-text text-transparent">
                {{ currentSession.title }}
              </h1>
              <h2 class="text-lg font-normal text-gray-600 leading-relaxed">
                {{ currentSession.description }}
              </h2>

              <!-- 角色设定 -->
              <div v-if="currentSession.system_prompt"
                class="mt-6 p-5 bg-gray-50 rounded-xl border-l-4 border-[var(--primary-color)] text-left">
                <h3 class="text-base font-semibold text-gray-800 mb-2">角色设定</h3>
                <p class="text-sm text-gray-600 leading-6">{{ currentSession.system_prompt }}</p>
              </div>
            </div>
          </div>
        </div>
      </template>
      <template v-else>
        <ScrollContainer ref="scrollContainerRef" :auto-scroll="true" :smooth-scroll="!isStreaming"
          @scroll-state-change="handleScrollStateChange">
          <div class="flex flex-col items-center px-[20px]" style="max-width: 900px;margin: 0 auto;">
            <MessageItem v-for="(message, index) in activeMessages" :ref="(el) => setItemRef(el, message.id)"
              :key="message.id" :message="message" :avatar="currentSession.avatar_url"
              :is-last="index === activeMessages.length - 1" @delete="deleteMessage" @edit="editMessage"
              @copy="copyMessage" @generate="generateResponse" @regenerate="regenerateResponse" @switch="switchContent"
              @renderComplete="handleRenderComplete" />
          </div>
        </ScrollContainer>
        <!-- 消息列表 -->

      </template>
    </div>

    <!-- 输入区域 -->
    <div class="input-container">
      <ChatInput v-model:value="inputMessage.text" :files="inputMessage.files" :streaming="isStreaming"
        @send="sendMessage" @abort="abortResponse" @image-upload="handleImageUpload" @web-search="handleWebSearch"
        @tokens-statistic="handleTokensStatistic" />
    </div>

    <!-- Tokens统计模态框 -->
    <TokenStatisticsModal v-model:show="showTokenModal" :currentSessionId="currentSession.id" />
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUpdate, reactive } from "vue";
import { store } from "../store/store";
import { apiService } from "../services/ApiService"
import { usePopup } from "@/composables/usePopup";
import { useDebounceFn } from '@vueuse/core'

// 组件导入
import MessageItem from "./MessageItem.vue";
import Avatar from "./Avatar.vue";
import TokenStatisticsModal from "./TokenStatisticsModal.vue";
import ChatInput from "./ChatInput.vue";
import ScrollContainer from "./ScrollContainer.vue";

// 图标导入
import { DeleteTwotone, SettingsTwotone, ArrowDropDownTwotone, FormatListBulletedSharp } from "@vicons/material";

// UI组件导入
import { NButton, NIcon, NDivider } from "naive-ui";

// 弹出层工具
const { confirm, editText, toast, notify } = usePopup();

// 响应式数据
const scrollContainerRef = ref(null);
const messagesContainer = ref(null);
const currentSessionId = ref(null);
const showTokenModal = ref(false);
const itemRefs = ref({});
const loaclSidebarVisible = computed({
  get() {
    return props.sidebarVisible
  },
  set(value) {
    emit('update:sidebarVisible', value)
  }
})

// Props & Emits
const props = defineProps({
  session: {
    type: Object,
    default: () => ({})
  },
  sidebarVisible: {
    type: Boolean,
    default: true
  }
});

const emit = defineEmits(['update:session', 'openSettings', 'openSwitchModel', 'update:sidebarVisible']);

// 计算属性
const currentSession = computed({
  get: () => props.session,
  set: (session) => emit('update:session', session)
});

const chatTitle = computed(() => props.session?.title || "Loading...");

const currentModelName = computed(() => currentSession.value.model ?
  (currentSession.value.model.model_name.split('/').pop()) : '请选择对话模型');

const isStreaming = computed(() => store.sessionIsStreaming(currentSessionId.value));

const inputMessage = computed({
  get: () => store.getInputMessage(currentSessionId.value) || { text: "", files: [] },
  set: (value) => store.setInputMessage(currentSessionId.value, value)
});

const activeMessages = computed({
  get: () => store.getMessages(currentSessionId.value) || [],
  set: (value) => store.setMessages(currentSessionId.value, value)
});

// 防抖函数
const debouncedUpdatedSession = useDebounceFn(updateSessionLastMessage, 1000);
const debouncedSwitchContent = useDebounceFn(apiService.setMessageCurrentContent, 300);

// 监听器
watch(() => props.session.id, handleSessionChange, { immediate: true });

watch(
  () => activeMessages.value,
  () => {
    debouncedUpdatedSession();
    if (scrollContainerRef.value?.isAtBottom) {
      nextTick(() => {
        if (!isStreaming.value) {
          immediateScrollToBottom();
        }
      });
    }
  },
  { deep: true }
);

// 生命周期
onBeforeUpdate(() => {
  itemRefs.value = {};
});

onMounted(() => {
  // 初始化相关逻辑
});


// 立即滚动到底部（无动画）
function immediateScrollToBottom() {
  scrollContainerRef.value?.immediateScrollToBottom();
}

// 修改平滑滚动函数
function smoothScrollToBottom() {
  scrollContainerRef.value?.smoothScrollToBottom();
}

// 修改 handleRenderComplete
function handleRenderComplete() {
  // 不再需要 nextTick，因为 MutationObserver 会处理
  // if (isStreaming.value && isAtBottom.value) {
  //   smoothScrollToBottom();
  // }
}



// 方法定义
function setItemRef(el, messageId) {
  if (el) itemRefs.value[messageId] = el;
}

function handleSessionChange(newSessionId, oldSessionId) {
  if (newSessionId === oldSessionId) return;

  currentSessionId.value = newSessionId;

  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  }

  if (newSessionId) {
    initializeSessionMessages(newSessionId);
  }

  nextTick(immediateScrollToBottom);
}

async function initializeSessionMessages(sessionId) {
  if (store.getMessages(sessionId).length === 0) {
    const sessionMessages = await apiService.fetchSessionMessages(sessionId);
    store.setMessages(sessionId, sessionMessages.items);
  }
}


function updateSessionLastMessage() {
  if (!activeMessages.value.length) {
    currentSession.value.last_message = null;
    currentSession.value = { ...currentSession.value };
    return;
  }

  const lastMessage = activeMessages.value[activeMessages.value.length - 1];
  if (lastMessage.is_streaming) return;

  const currentContent = getCurrentContent(lastMessage.contents);
  currentSession.value.last_message = {
    content: currentContent.content,
    created_at: currentContent.created_at
  };
  currentSession.value = { ...currentSession.value };
}

function getCurrentIndex(messageContents) {
  if (!messageContents?.length) return 0;
  const currentIndex = messageContents.findIndex(content => content.is_current);
  return currentIndex !== -1 ? currentIndex : 0;
}

function getCurrentContent(messageContents) {
  const index = getCurrentIndex(messageContents);
  return messageContents[index];
}

async function handleStreamResponse(streamingSessionId, userMessageId, regenerationMode = null, assistantMessageId = null) {
  store.setSessionIsStreaming(streamingSessionId, true);

  let message = null;
  let assistantMessageIdResult = null;
  let contentIndex = 0;

  try {
    let responseContent = "";
    let isThinking = false;
    let thinkingContent = "";

    for await (const response of apiService.chat(
      streamingSessionId,
      userMessageId,
      regenerationMode,
      assistantMessageId,
      false
    )) {
      if (response.error) {
        handleStreamError(response, assistantMessageIdResult);
        break;
      }

      if (response.message_id && response.content_id) {
        ({ message, contentIndex } = handleNewMessage(response, streamingSessionId, userMessageId));
        assistantMessageIdResult = response.message_id;
        continue;
      }

      if (response.reasoning_content) {
        ({ isThinking, thinkingContent } = handleThinkingContent(response, message, contentIndex, isThinking, thinkingContent));
        continue;
      }

      if (isThinking) {
        isThinking = false;
        itemRefs.value[message.id]?.stopThinking();
      }

      if (response.content && contentIndex !== undefined) {
        responseContent = handleContentResponse(response, message, contentIndex, responseContent);
      }
    }
  } catch (error) {
    handleStreamCatchError(error, message, contentIndex, assistantMessageIdResult);
  } finally {
    cleanupStreaming(streamingSessionId, message);
  }
}

/**
 * 处理新消息的创建或更新
 * 
 * 当从服务器接收到新的响应时，此函数负责处理消息的创建或更新。
 * 如果消息已存在，则向现有消息添加新的内容项；如果消息不存在，则创建新消息。
 * 
 * @param {Object} response - 服务器响应对象
 * @param {string} response.message_id - 消息ID
 * @param {string} response.content_id - 内容ID
 * @param {string} sessionId - 当前会话ID
 * @param {string} userMessageId - 用户消息ID，作为新助手消息的父ID
 * @returns {Object} 包含消息对象和内容索引的对象
 * @returns {Object} return.message - 消息对象（现有或新建）
 * @returns {number} return.contentIndex - 内容在消息内容数组中的索引
 */
function handleNewMessage(response, sessionId, userMessageId) {
  const { message_id, content_id } = response;
  currentSession.value.updated_at = new Date().toISOString();

  const existingMessage = activeMessages.value.find(msg => msg.id === message_id);

  if (existingMessage) {
    existingMessage.contents.forEach(item => item.is_current = false);
    existingMessage.contents.push({
      id: content_id,
      content: "",
      reasoning_content: null,
      meta_data: {},
      is_current: true,
      created_at: new Date().toISOString(),
    });
    existingMessage.is_streaming = true;
    return {
      message: existingMessage,
      contentIndex: existingMessage.contents.length - 1
    };
  } else {
    const newMessage = reactive({
      id: message_id,
      role: "assistant",
      contents: [{
        id: content_id,
        content: "",
        reasoning_content: null,
        meta_data: {},
        is_current: true,
        created_at: new Date().toISOString(),
      }],
      parent_id: userMessageId,
      is_streaming: true,
      created_at: new Date().toISOString(),
    });
    store.addMessage(sessionId, newMessage);
    return {
      message: newMessage,
      contentIndex: 0
    };
  }
}

function handleThinkingContent(response, message, contentIndex, isThinking, thinkingContent) {
  if (!isThinking) {
    isThinking = true;
    itemRefs.value[message.id]?.startThinking();
  }
  thinkingContent += response.reasoning_content;
  message.contents[contentIndex].reasoning_content = thinkingContent;
  return { isThinking, thinkingContent };
}

function handleContentResponse(response, message, contentIndex, currentContent) {
  const newContent = currentContent + response.content;
  message.contents[contentIndex].content = newContent;
  return newContent;
}

function handleStreamError(response, assistantMessageId) {
  console.error("Error in stream:", response.error);
  if (assistantMessageId) {
    // 错误信息已保存在message.meta_data中
  } else {
    notify.error("Error in stream", response.error);
  }
}

function handleStreamCatchError(error, message, contentIndex, assistantMessageId) {
  if (error.name !== "AbortError") {
    console.error("Error during streaming:", error);
    if (message && contentIndex !== undefined) {
      message.contents[contentIndex].content = error.message;
    }
    if (!assistantMessageId) {
      notify.error("请求错误", error.message);
    }
  }
}

function cleanupStreaming(sessionId, message) {
  store.setSessionIsStreaming(sessionId, false);
  if (message) {
    message.is_streaming = false;
    itemRefs.value[message.id]?.stopThinking();
  }
}

async function handleSendUserMessage(data) {
  try {
    const { text, files } = data;
    const response = await apiService.createMessage(currentSessionId.value, text);
    const messageId = response.id;

    const message = reactive({ ...response, files });
    activeMessages.value.push(message);
    nextTick(() => {
      immediateScrollToBottom();
    });
    // 并行上传文件
    const uploadPromises = files.map(file =>
      apiService.uploadFile(messageId, file.file)
    );
    await Promise.all(uploadPromises);

    handleStreamResponse(currentSessionId.value, messageId);
  } catch (error) {
    notify.error("消息发送失败", error.message);
  }
}

async function sendMessage() {
  const message = inputMessage.value;
  if ((!message.text?.trim() && !message.files.length) || isStreaming.value) return;

  inputMessage.value = { text: "", files: [] };
  await handleSendUserMessage(message);
}

function abortResponse() {
  apiService.cancelResponse(currentSessionId.value);
}

async function clearChat() {
  if (await confirm("清空聊天记录", "确定要删除所有聊天记录吗？此操作不可撤销。")) {
    await apiService.clearSessionMessages(currentSessionId.value);
    store.clearSessionState(currentSessionId.value);
    toast.success("聊天记录已清空");
  }
}

const handleSwitchModelClick = (modelId) => {
  emit("openSwitchModel", modelId);
};

function handleSettingsClick() {
  emit("openSettings");
}

async function deleteMessage(message) {
  try {
    if (await confirm("删除消息", "确定要删除这条消息吗？此操作不可撤销。")) {
      await apiService.deleteMessage(message.id);
      store.deleteMessage(currentSessionId.value, message.id);
      toast.success("消息已删除");
    }
  } catch (error) {
    toast.error("删除失败");
    console.error("删除消息失败:", error);
  }
}

async function editMessage(message) {
  try {
    const index = getCurrentIndex(message.contents);
    const result = await editText({
      title: "编辑消息",
      defaultValue: message.contents[index].content,
      confirmText: "保存",
      cancelText: "取消",
    });

    if (result) {
      message.contents[index].content = result;
      await apiService.updateMessage(message.id, result);
      store.updateMessage(currentSessionId.value, message.id, message);
      toast.success("消息已更新");
    }
  } catch (error) {
    toast.error("更新失败");
    console.error("更新消息失败:", error);
  }
}

async function copyMessage(message) {
  try {
    await navigator.clipboard.writeText(getCurrentContent(message.contents).content);
    toast.success("消息已复制");
  } catch (error) {
    console.error("复制消息失败:", error);
    toast.error("复制失败");
  }
}

function generateResponse(message) {
  handleStreamResponse(currentSessionId.value, message.id, 'overwrite');
}

function regenerateResponse(message) {
  if (message.contents.length >= 5) {
    toast.error("暂时最多支持5个回答版本");
    return;
  }
  handleStreamResponse(currentSessionId.value, message.parent_id, 'multi_version', message.id);
}

function switchContent(message, content) {
  const targetMessage = activeMessages.value.find(m => m.id === message.id);
  targetMessage.contents.forEach(item => {
    item.is_current = item.id === content.id;
  });
  debouncedSwitchContent(message.id, content.id);
}

// function handleRenderComplete() {
//   if (isStreaming.value && isAtBottom.value) {
//     nextTick(smoothScrollToBottom);
//   }
// }

function handleWebSearch() {
  console.log("网络搜索功能");
}

function handleImageUpload() {
  console.log("图片上传功能");
}

function handleTokensStatistic() {
  showTokenModal.value = true;
}
</script>

<style scoped>
.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 60px;
  font-size: 18px;
  font-weight: 600;
  border-bottom: 1px solid rgba(21, 23, 28, .1);
  border-radius: 0;
  margin: 0 40px;
}

.clear-chat-btn {
  background: none;
  border: none;
  color: #777;
  cursor: pointer;
  font-size: 16px;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  transition: all 0.2s;
}

.clear-chat-btn:hover {
  background-color: #ffebee;
  color: #ff3b30;
}

.messages-container {
  flex: 1;
  overflow-y: hidden;
  width: 100%;
  align-items: center;
}

.input-container {
  padding: 0 20px 20px 20px;
  display: flex;
  justify-content: center;
  width: 100%;
}

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

.animate-fade-in-up {
  animation: fadeInUp 0.8s ease-out;
}

.animate-bounce-in {
  animation: bounceIn 1s ease-out;
}
</style>