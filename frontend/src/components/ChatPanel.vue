<template>
  <div class="flex flex-col h-full">
    <!-- 聊天头部 -->
    <div class="chat-header">
      <span id="chat-title">{{ chatTitle }}</span>

      <div class="flex items-center flex-1 justify-end">
        <n-button class="clear-chat-btn" title="清空聊天记录" @click="clearChat" text>
          <template #icon>
            <n-icon size="24">
              <DeleteTwotone />
            </n-icon>
          </template>
        </n-button>

        <n-button class="settings-btn ml-2" title="设置" @click="handleSettingsClick" text>
          <template #icon>
            <n-icon size="24">
              <SettingsApplicationsTwotone />
            </n-icon>
          </template>
        </n-button>
      </div>
    </div>
    <div class="messages-container" ref="messagesContainer">
      <template v-if="activeMessages.length === 0">
        <!-- 欢迎页使用Tailwind CSS重写 -->
        <div class="flex items-center justify-center h-full min-h-[500px] py-10 px-5">
          <div class="max-w-[600px] w-full text-center bg-white p-10 rounded-2xl animate-fade-in-up">
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

              <!-- 详细设置（如果有的话） -->
              <div v-if="currentSession.system_prompt"
                class="mt-6 p-5 bg-gray-50 rounded-xl border-l-4 border-[var(--primary-color)] text-left">
                <h3 class="text-base font-semibold text-gray-800 mb-2">角色设定</h3>
                <p class="text-sm text-gray-600 leading-6">{{ currentSession.system_prompt }}</p>
              </div>
            </div>

            <!-- 交互提示（注释部分保留结构） -->
            <!-- <div class="interaction-hints">
                  <div class="hint-item">
                    <div class="hint-icon">
                      <i class="fas fa-comment-dots"></i>
                    </div>
                    <span>开始对话，了解我的能力</span>
                  </div>
                  <div class="hint-item">
                    <div class="hint-icon">
                      <i class="fas fa-lightbulb"></i>
                    </div>
                    <span>我擅长回答各种问题并提供帮助</span>
                  </div>
                </div> -->

            <!-- 开始对话按钮（注释部分保留结构） -->
            <!-- <div class="start-conversation">
                  <button class="start-btn" @click="focusInput">
                    <i class="fas fa-paper-plane"></i>
                    开始对话
                  </button>
                </div> -->
          </div>
        </div>
      </template>
      <template v-else>
        <!-- 消息容器 -->
        <SimpleBar :options="scrollbarOptions" :timeout="4000" style="width:100%;height: 100%;padding: 25px 0;"
          ref="simpleBarRef" @scroll="handleScroll">
          <div class="flex flex-col items-center px-[20px]" style="max-width: 900px;margin: 0 auto;">
            <MessageItem v-for="(message, index) in activeMessages" :ref="(el) => setItemRef(el, message.id)"
              :key="message.id" :message="message" :avatar="currentSession.avatar_url"
              :is-last="index === activeMessages.length - 1" @delete="deleteMessage" @edit="editMessage"
              @copy="copyMessage" @generate="generateResponse" @regenerate="regenerateResponse"
              @switch="switchContent" />
          </div>
        </SimpleBar>
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
import { ref, computed, watch, nextTick, onMounted, onBeforeUpdate, reactive, createApp } from "vue";
import { store } from "../store/store";
import MessageItem from "./MessageItem.vue";
import { apiService } from "../services/ApiService"
import Avatar from "./Avatar.vue";
// import PopupService from "../services/PopupService";
import { usePopup } from "@/composables/usePopup";
import TokenStatisticsModal from "./TokenStatisticsModal.vue";
import ChatInput from "./ChatInput.vue";
import {
  DeleteTwotone,
  SettingsApplicationsTwotone,
} from "@vicons/material";
import {
  useDebounceFn,    // 函数防抖
  // useDebounce,      // 值防抖
  // debouncedWatch,   // 防抖的watch
  // useThrottleFn,    // 函数节流
  // useThrottle,      // 值节流
} from '@vueuse/core'

// import {
//   Brain,
// } from "@vicons/font-awesome";

// 导入 naive-ui 组件
import { NButton, NIcon } from "naive-ui";

const { confirm, editText, toast, prompt, notify } = usePopup();

const emit = defineEmits(['update:session']);

const scrollbarOptions = ref({
  autoHide: true,
  // forceVisible: true,
  timeout: 4000
})

const simpleBarRef = ref(null);
const messagesContainer = ref(null);
const currentSessionId = ref(null);

// Tokens统计相关
const showTokenModal = ref(false);


// 替换原有的分散状态
const inputMessage = computed({
  get: () => store.getInputMessage(currentSessionId.value) || '',
  set: (value) => store.setInputMessage(currentSessionId.value, value)
});

const props = defineProps({
  session: {
    type: Object,
    default: () => ({})
  },
});

const currentSession = computed({
  get: () => props.session,
  set: (session) => {
    emit('update:session', session);
  }
});



watch(() => props.session.id, async (sessionId) => {
  if (sessionId === currentSessionId.value)
    return;
  currentSessionId.value = sessionId;
  if (messagesContainer.value)
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  if (sessionId) {
    if (store.getMessages(sessionId).length == 0) {
      const sessionMessages = await apiService.fetchSessionMessages(sessionId);
      store.setMessages(sessionId, sessionMessages.items);
    }
  }
  await nextTick();
  scrollToBottom();
}, { immediate: true, deep: true });



const isStreaming = computed(() => store.sessionIsStreaming(currentSessionId.value));
const itemRefs = ref({});

const setItemRef = (el, idx) => {
  if (el) {
    itemRefs.value[idx] = el;
  }
};

const isAtBottom = ref(true) // 初始假设在底部
const scrollThreshold = 50 // 距离底部的阈值，单位px

// 组件更新前清理无效引用
onBeforeUpdate(() => {
  itemRefs.value = {};
});


const chatTitle = computed(() => {
  if (props.session && props.session.title) {
    return props.session.title;
  }
  return "Loading...";
});

// 计算当前显示的消息
const activeMessages = computed({
  get: () => {
    return store.getMessages(currentSessionId.value) || []
  },
  set: (value) => {
    store.setMessages(currentSessionId.value, value);
  }
})

const debouncedUpdatedSession = useDebounceFn(async (activeMessages) => {
  if (activeMessages.value.length) {
    // 查找最后一条消息
    const lastMessage = activeMessages.value[activeMessages.value.length - 1];
    if (lastMessage.is_streaming) {
      return
    }
    // 查找激活的内容
    const currentContent = lastMessage.contents.find(item => item.is_current)
    currentSession.value.last_message = {
      content: currentContent.content,
      created_at: currentContent.created_at
    };
    currentSession.value = { ...currentSession.value }
  } else {
    currentSession.value.last_message = null;
    currentSession.value = { ...currentSession.value }
  }
}, 1000);

// 监听消息变化，自动滚动到底部
watch(
  () => activeMessages,
  () => {
    debouncedUpdatedSession(activeMessages)
    nextTick(() => {
      if (isAtBottom.value) {
        console.log('自动滚动到底部')
        scrollToBottom()
      }
    });
  },
  { deep: true }
);


// 检查是否在底部
const checkIsAtBottom = () => {
  const instance = simpleBarRef.value?.SimpleBar
  if (instance) {
    const scrollElement = instance.getScrollElement()
    const distanceToBottom = scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight
    return distanceToBottom <= scrollThreshold
  }
  return true
}

// 滚动事件处理
const handleScroll = () => {
  isAtBottom.value = checkIsAtBottom()
}

const handleStreamResponse = async (streamingSessionId, userMessageId, regeneration_mode = null, assistant_message_id = null,) => {
  store.setSessionIsStreaming(streamingSessionId, true);
  let message = null;
  let assistantMessageId = null;
  let assistantContentId = null;

  try {
    let responseContent = "";
    let isThinking = false;
    let thinkingContent = "";
    let content_index = 0;
    // 调用流式API
    for await (const response of apiService.chat(
      streamingSessionId,
      userMessageId,
      regeneration_mode,
      assistant_message_id,
      false)) {
      // if (!isStreaming.value) break;

      if (response.error) {
        console.error("Error in stream:", response.error);
        if (assistantMessageId)
          message.meta_data = response;
        else
          notify.error("Error in stream", response.error);
        break;
      }

      if (response.message_id && response.content_id) {
        assistantMessageId = response.message_id;
        assistantContentId = response.content_id;
        currentSession.value.updated_at = new Date().toISOString();
        const assistantMessage = activeMessages.value.find(msg => msg.id === assistantMessageId)
        if (assistantMessage) {
          message = assistantMessage;
          message.contents.forEach((item) => {
            if (item.is_current) {
              item.is_current = false;
            }
          });
          message.contents.push({
            id: assistantContentId,
            content: "",
            reasoning_content: null,
            meta_data: {},
            is_current: true,
            created_at: new Date().toISOString(),
          });
          message.is_streaming = true;
          content_index = message.contents.length - 1;
        } else {
          message = reactive({
            id: assistantMessageId,
            role: "assistant",
            contents: [{
              id: assistantContentId,
              content: "",
              reasoning_content: null,
              meta_data: {},
              is_current: true,
              created_at: new Date().toISOString(),
            }],
            parent_id: userMessageId,
            is_streaming: true,
            created_at: new Date().toISOString(),
          })
          content_index = 0;
          store.addMessage(streamingSessionId, message);
          // activeMessages.value.push(message);
        }
        continue;
      }

      if (response.reasoning_content) {
        if (!isThinking) {
          isThinking = true;
          itemRefs.value[message.id]?.startThinking();
        }
        thinkingContent += response.reasoning_content;
        // 更新思考内容
        message.contents[content_index].reasoning_content = thinkingContent;
        continue;
      }

      if (isThinking) {
        isThinking = false;
        itemRefs.value[message.id]?.stopThinking();
      }

      if (response.content) {
        responseContent += response.content;
        message.contents[content_index].content = responseContent;// 更新消息内容
        // messages.value = [...messages.value];
      }
    }
  } catch (error) {
    if (error.name !== "AbortError") {
      console.error("Error during streaming:", error);
      message.contents[content_index].content = error;
      if (!assistantMessageId) {
        notify.error("请求错误", error.message);
      }
    }
  } finally {
    store.setSessionIsStreaming(streamingSessionId, false);
    if (message) {
      message.is_streaming = false;
      message.id = assistantMessageId;
    }
  }
};

const handleSendUserMessage = async (data) => {
  try {

    const text = data.text;
    const files = data.files;
    const response = await apiService.createMessage(currentSessionId.value, text);
    const messageId = response["id"];

    const message = reactive({ ...response, 'files': files });
    // messages.value.push(message);
    activeMessages.value.push(message);
    // store.addMessage(currentSessionId.value, message);
    for (let i = 0; i < files.length; i++) {
      await apiService.uploadFile(messageId, files[i].file);
    }
    handleStreamResponse(currentSessionId.value, messageId);

  } catch (error) {
    notify.error("消息发送失败", error.message);
  }
};

const getSimpleBarInstance = (
) => {
  return simpleBarRef.value?.SimpleBar
}
// 滚动到底部
const scrollToBottom = () => {
  const instance = getSimpleBarInstance()
  if (instance) {
    const scrollElement = instance.getScrollElement()
    scrollElement.scrollTop = scrollElement.scrollHeight
  }
};
// 发送消息
const sendMessage = async () => {
  const message = inputMessage.value;
  if ((!message.text?.trim() && !message.files.length) || isStreaming.value) return;
  // 不要直接修改inputMessage.value,会导致handleSendUserMessage读不到内容
  inputMessage.value = { text: "", files: [] };
  handleSendUserMessage(message);
};

// 停止生成
const abortResponse = () => {
  apiService.cancelResponse(currentSessionId.value);
};

// 清空聊天
const clearChat = async () => {

  if (await confirm("清空聊天纪律", "确定要删除所有聊天记录吗？此操作不可撤销。")) {
    // 清空聊天记录
    await apiService.clearSessionMessages(currentSessionId.value);
    // messages.value = [];
    store.clearSessionState(currentSessionId.value);
    toast.success("聊天记录已清空");
  }
};

const handleSettingsClick = () => {
  emit("openSettings");
};

// 删除消息
const deleteMessage = async (message) => {

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
};


const getCurrentIndex = (messageContents) => {
  if (!messageContents || messageContents.length === 0) {
    return 0;
  }
  const currentIndex = messageContents.findIndex(content => content.is_current);
  return currentIndex !== -1 ? currentIndex : 0;
};

const getCurrentContent = (messageContents) => {
  const index = getCurrentIndex(messageContents);
  return messageContents[index];
};

// 编辑消息
const editMessage = async (message) => {

  try {
    const index = getCurrentIndex(message.contents);
    const result = await editText({
      title: "编辑消息",
      defaultValue: message.contents[index].content,
      confirmText: "保存",
      cancelText: "取消",
    });
    if (result) {
      const newContent = result;
      message.contents[index].content = newContent;
      await apiService.updateMessage(message.id, newContent);
      store.updateMessage(currentSessionId.value, message.id, message);
      toast.success("消息已更新");
    }
  } catch (error) {
    toast.error("更新失败");
    console.error("更新消息失败:", error);
  }
};

// 复制消息
const copyMessage = async (message) => {
  try {
    await navigator.clipboard.writeText(getCurrentContent(message.contents).content);
    toast.success("消息已复制");
  } catch (error) {
    console.error("复制消息失败:", error);
    toast.error("复制失败");
  }
};

// 重新回答问题
const generateResponse = async (message) => {
  handleStreamResponse(currentSessionId.value, message.id, 'overwrite');
};

// 回答多个版本
const regenerateResponse = async (message) => {
  if (message.contents.length >= 5) {
    toast.error("暂时最多支持5个回答版本");
    return;
  }
  handleStreamResponse(currentSessionId.value, message.parent_id, 'multi_version', message.id);
};

const debouncedSwitchContent = useDebounceFn(async (messageId, contentId) => {
  await apiService.setMessageCurrentContent(messageId, contentId);
}, 300);

const switchContent = (message, content) => {
  message = activeMessages.value.find(m => m.id === message.id);
  message.contents.forEach(item => {
    item.is_current = item.id === content.id;
  });
  debouncedSwitchContent(message.id, content.id)
};

// 处理网络搜索
const handleWebSearch = () => {
  // 实现网络搜索逻辑
  console.log("网络搜索功能");
};

// 处理图片上传
const handleImageUpload = () => {
  // 实现图片上传逻辑
  console.log("图片上传功能");
};

const handleTokensStatistic = async () => {
  showTokenModal.value = true;
};

// 组件挂载时调整输入框高度
onMounted(() => {
  // adjustTextareaHeight();
});
</script>

<style scoped>
.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 60px;
  font-size: 18px;
  font-weight: 600;
  /* background-color: #ffffff; */
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
  /* background-color: #f9f9f9; */
  display: flex;
  justify-content: center;
  width: 100%;
}



/* 自定义动画 */
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