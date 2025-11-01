<template>
  <div class="flex flex-col h-full">
    <!-- 聊天头部 -->
    <div class="chat-header">
      <span id="chat-title">{{ chatTitle }}</span>
      <button class="clear-chat-btn" title="清空聊天记录" @click="clearChat">
        <i class="fas fa-trash-alt"></i>
      </button>
    </div>
    <div class="messages-container" ref="messagesContainer">
      <template v-if="activeMessages.length === 0">
        <div class="welcome-page">
          <div class="welcome-content">
            <!-- 头像区域 -->
            <div class="avatar-section">
              <div class="avatar-container">
                <Avatar v-if="session" :src="session.avatar_url" round />
              </div>
              <div class="online-indicator"></div>
            </div>

            <!-- 标题和描述 -->
            <div class="character-info">
              <h1 class="character-title">{{ session.title }}</h1>
              <h2 class="character-description">{{ session.description }}</h2>

              <!-- 详细设置（如果有的话） -->
              <div v-if="session.system_prompt" class="detailed-setting">
                <h3>角色设定</h3>
                <p class="setting-content">{{ session.system_prompt }}</p>
              </div>
            </div>

            <!-- 交互提示 -->
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

            <!-- 开始对话按钮 -->
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
          <div class="flex flex-col items-center" style="max-width: 800px;margin: 0 auto;">
            <MessageItem v-for="(message, index) in activeMessages" :ref="(el) => setItemRef(el, message.id)"
              :key="message.id" :message="message" :avatar="session.avatar_url"
              :is-last="index === activeMessages.length - 1" @delete="deleteMessage" @edit="editMessage"
              @copy="copyMessage" @regenerate="regenerateResponse" />
          </div>
        </SimpleBar>
      </template>
    </div>
    <!-- 输入区域 -->
    <div class="input-container">
      <div class="input-wrapper" :class="{ expanded: isInputExpanded }">
        <textarea class="message-input" v-model="inputMessage" placeholder="输入消息..." @keydown="handleKeydown"
          @input="adjustTextareaHeight" ref="messageInputRef" rows="1"></textarea>

        <div class="input-actions">
          <div class="tools">
            <button class="tool-btn" title="上传文件" @click="handleFileUpload">
              <i class="fas fa-paperclip"></i>
            </button>
            <button class="tool-btn" title="联网搜索" @click="handleWebSearch">
              <i class="fas fa-search"></i>
            </button>
            <button class="tool-btn" title="添加图片" @click="handleImageUpload">
              <i class="fas fa-image"></i>
            </button>
            <button class="tool-btn" id="deep-thinking-btn" :class="{ active: isDeepThinking }"
              :title="isDeepThinking ? '关闭深度思考' : '深度思考'" @click="toggleDeepThinking">
              <i class="fas fa-brain"></i>
            </button>
          </div>

          <div class="send-actions">
            <button v-if="!isStreaming" class="send-btn" title="发送" @click="sendMessage"
              :disabled="!inputMessage.trim()">
              <i class="fas fa-arrow-up"></i>
            </button>
            <button v-if="isStreaming" class="send-btn stop-btn" title="停止生成" @click="abortResponse">
              <i class="fas fa-stop"></i>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUpdate, reactive } from "vue";
import { store } from "../store/store";
import MessageItem from "./MessageItem.vue";
import { apiService } from "../services/llmApi"
import Avatar from "./Avatar.vue";
// import PopupService from "../services/PopupService";
import { usePopup } from "@/composables/usePopup";

const { confirm, editText, toast, prompt } = usePopup();

const emit = defineEmits(['update:session']);

const scrollbarOptions = ref({
  autoHide: true,
  // forceVisible: true,
  timeout: 4000
})

const simpleBarRef = ref(null);
const messages = ref([]);
const messageInputRef = ref(null);
const isInputExpanded = ref(false);
const messagesContainer = ref(null);
const currentSessionId = ref(null);

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

watch(() => props.session, async (session) => {
  currentSessionId.value = session.id;
  isInputExpanded.value = false;
  if (messagesContainer.value)
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  if (store.getMessages(session.id).length == 0) {
    const sessionMessages = await apiService.fetchSessionMessages(session.id);
    store.setMessages(session.id, sessionMessages.items);
  }
  await nextTick();
  scrollToBottom();
}, { immediate: true, deep: true });



const isDeepThinking = computed({
  get: () => store.getSessionSetting(currentSessionId.value, 'isDeepThinking') || false,
  set: (value) => store.setSessionSetting(currentSessionId.value, 'isDeepThinking', value)
});
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

const handleStreamResponse = async (streamingSessionId, userMessageId) => {
  emit('update:session', { id: streamingSessionId });
  store.setSessionIsStreaming(streamingSessionId, true);
  const message = reactive({
    id: "tmp-assistant-id",
    role: "assistant",
    content: "",
    reasoning_content: null,
    meta_data: {},
    is_streaming: true,
  });

  let assistantMessageId = null;

  try {
    let responseContent = "";
    let isThinking = false;
    let thinkingContent = "";
    // 调用流式API
    for await (const response of apiService.fetchResponse(
      streamingSessionId,
      userMessageId,
      false)) {
      // if (!isStreaming.value) break;

      if (response.error) {
        console.error("Error in stream:", response.error);
        message.meta_data = response;
        break;
      }

      if (response.message_id) {
        assistantMessageId = response.message_id;
        // 等到获取了message_id之后再更新消息列表，并设置正确的ID
        message.id = assistantMessageId;
        // messages.value.push(message);
        store.addMessage(streamingSessionId, message);
        continue;
      }

      if (response.reasoning_content) {
        if (!isThinking) {
          isThinking = true;
          itemRefs.value[message.id]?.startThinking();
        }
        thinkingContent += response.reasoning_content;
        // 更新思考内容
        message.reasoning_content = thinkingContent;
        continue;
      }

      if (isThinking) {
        isThinking = false;
        itemRefs.value[message.id]?.stopThinking();
      }

      if (response.content) {
        responseContent += response.content;
        message.content = responseContent;// 更新消息内容
        // messages.value = [...messages.value];
      }
    }
  } catch (error) {
    if (error.name !== "AbortError") {
      console.error("Error during streaming:", error);
      message.content = error;
    }
  } finally {
    store.setSessionIsStreaming(streamingSessionId, false);
    message.is_streaming = false;
    message.id = assistantMessageId;
  }
};

const handleSendUserMessage = async (text) => {
  const reponse = await apiService.addMessage(currentSessionId.value, text);
  const messageId = reponse["id"];

  const message = {
    id: messageId,
    role: "user",
    content: text,
    reasoning_content: null,
  };
  // messages.value.push(message);
  store.addMessage(currentSessionId.value, message);
  handleStreamResponse(currentSessionId.value, messageId);
};

//聊天逻辑

// 计算聊天标题
const chatTitle = computed(() => {
  if (props.session && props.session.title) {
    return props.session.title;
  }
  return "Loading...";
});

// 计算当前显示的消息
const activeMessages = computed(() => {
  console.log("activeMessages.value", activeMessages.value);
  return store.getMessages(currentSessionId.value) || []
})

// 监听消息变化，自动滚动到底部
watch(
  () => activeMessages,
  () => {
    nextTick(() => {
      if (isAtBottom.value) {
        scrollToBottom()
      }
    });
  },
  { deep: true }
);


// 调整文本区域高度
const adjustTextareaHeight = () => {
  const textarea = messageInputRef.value;
  if (!textarea) return;

  // 重置高度为auto以获取正确的内容高度
  textarea.style.height = "auto";
  // 计算内容高度
  const height = Math.min(textarea.scrollHeight, 120); // 限制最大高度为120px
  // 设置新高度
  textarea.style.height = height + "px";

  // 根据高度决定是否展开输入区域
  isInputExpanded.value = textarea.scrollHeight > 60;
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

// 处理键盘事件
const handleKeydown = (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
};

// 发送消息
const sendMessage = async () => {
  const message = inputMessage.value.trim();
  if (!message || isStreaming.value) return;
  inputMessage.value = "";
  handleSendUserMessage(message);
  await nextTick();
  adjustTextareaHeight(); // 重置输入框高度
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

// 编辑消息
const editMessage = async (message) => {

  try {
    const result = await editText({
      title: "编辑消息",
      defaultValue: message.content,
      confirmText: "保存",
      cancelText: "取消",
    });
    if (result) {
      const newContent = result;
      await apiService.updateMessage(message.id, newContent);
      store.updateMessage(currentSessionId.value, message.id, newContent);
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
    await navigator.clipboard.writeText(message.content);
    toast.success("消息已复制");
  } catch (error) {
    console.error("复制消息失败:", error);
    toast.error("复制失败");
  }
};

// 重新生成响应
const regenerateResponse = async (message) => {
  handleStreamResponse(currentSessionId.value, message.id);
};

// 切换深度思考模式
const toggleDeepThinking = () => {
  isDeepThinking.value = !isDeepThinking.value;
};

// 处理文件上传
const handleFileUpload = () => {
  // 实现文件上传逻辑
  console.log("文件上传功能");
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

// 组件挂载时调整输入框高度
onMounted(() => {
  adjustTextareaHeight();
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

.input-wrapper {
  border: none;
  border-radius: 12px;
  padding: 18px 20px 12px 20px;
  background-color: white;
  position: relative;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
  transition: box-shadow 0.3s ease;
  min-height: 60px;
  max-width: 800px;
  width: 100%;
  border: 1px solid rgb(230, 232, 238);
}

.input-wrapper.expanded {
  border-radius: 12px;
}

.message-input {
  width: 100%;
  min-height: 24px;
  max-height: 120px;
  border: none;
  resize: none;
  outline: none;
  font-size: 16px;
  line-height: 1.5;
  padding: 0;
  background: transparent;
  /* color: #333; */
  overflow-y: auto;
  margin-bottom: 10px;
  box-sizing: border-box;
  transition: height 0.2s ease;
}

.input-actions {
  display: flex;
  justify-content: space-between;
  position: static;
  bottom: auto;
  left: auto;
  right: auto;
  width: 100%;
}

.tools {
  display: flex;
  gap: 12px;
  align-items: flex-end;
}

.send-actions {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}

.tool-btn {
  background: none;
  border: none;
  color: #777;
  cursor: pointer;
  font-size: 18px;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  transition: all 0.2s;
}

.tool-btn:hover {
  background-color: #e6f0fa;
  color: #4a90e2;
}

/* 深度思考按钮激活状态样式 */
#deep-thinking-btn.active {
  background-color: #e6f0fa;
  color: #4a90e2;
  box-shadow: 0 0 0 2px rgba(74, 144, 226, 0.2);
}

.send-btn {
  background-color: var(--primary-color);
  color: white;
  border: none;
  border-radius: 50%;
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background-color 0.2s;
  font-size: 16px;
  align-self: flex-end;
}

.send-btn:hover:not(:disabled) {
  background-color: #3a7bc8;
}

.send-btn:disabled {
  background-color: #cccccc;
  cursor: not-allowed;
}

.stop-btn {
  background-color: #ff3b30;
}

.stop-btn:hover {
  background-color: #e62e24;
}
</style>
<style scoped>
/* 原有的样式保持不变，添加以下欢迎页样式 */

.welcome-page {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 500px;
  /* background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%); */
  padding: 40px 20px;
}

.welcome-content {
  max-width: 600px;
  width: 100%;
  text-align: center;
  /* background: white; */
  padding: 40px;
  border-radius: 20px;
  /* box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1); */
  /* border: 1px solid rgba(255, 255, 255, 0.2); */
}

/* 头像区域 */
.avatar-section {
  position: relative;
  display: inline-block;
  margin-bottom: 20px;
}

.avatar-container {
  width: 100px;
  height: 100px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, var(--primary-color) 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto;
  position: relative;
  overflow: hidden;
  padding: 0;
  gap: 0;
}

.character-avatar {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
  display: block;
  margin: 0;
}

.avatar-placeholder {
  font-size: 40px;
  color: white;
}

.online-indicator {
  position: absolute;
  bottom: 5px;
  right: 5px;
  width: 20px;
  height: 20px;
  background: #4CAF50;
  border: 3px solid white;
  border-radius: 50%;
}

/* 角色信息 */
.character-info {
  margin-bottom: 30px;
}

.character-title {
  font-size: 2.2rem;
  font-weight: 700;
  color: #2c3e50;
  margin: 0 0 15px 0;
  background: linear-gradient(135deg, #667eea 0%, var(--primary-color) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.character-description {
  font-size: 1.2rem;
  font-weight: 400;
  color: #7f8c8d;
  line-height: 1.6;
  margin: 0;
}

.detailed-setting {
  display: none;
  margin-top: 25px;
  padding: 20px;
  background: #f8f9fa;
  border-radius: 12px;
  border-left: 4px solid var(--primary-color);
}

.detailed-setting h3 {
  font-size: 1.1rem;
  color: #2c3e50;
  margin: 0 0 10px 0;
  font-weight: 600;
}

.setting-content {
  font-size: 1rem;
  color: #5a6c7d;
  line-height: 1.5;
  margin: 0;
  text-align: left;
}

/* 交互提示 */
.interaction-hints {
  display: flex;
  flex-direction: column;
  gap: 15px;
  margin-bottom: 30px;
}

.hint-item {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 12px 20px;
  /* background: #f8f9fa; */
  background-color: #ffffff;
  border-radius: 10px;
  color: #5a6c7d;
}

.hint-icon {
  width: 30px;
  height: 30px;
  background: #667eea;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
}

/* 开始对话按钮 */
.start-conversation {
  margin-top: 20px;
}

.start-btn {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  padding: 15px 30px;
  border-radius: 25px;
  font-size: 1.1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
}

.start-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
}

.start-btn:active {
  transform: translateY(0);
}

/* 响应式设计 */
@media (max-width: 768px) {
  .welcome-content {
    padding: 30px 20px;
    margin: 20px;
  }

  .character-title {
    font-size: 1.8rem;
  }

  .character-description {
    font-size: 1.1rem;
  }

  .avatar-container {
    width: 80px;
    height: 80px;
  }

  .avatar-placeholder {
    font-size: 32px;
  }
}

/* 动画效果 */
.welcome-content {
  animation: fadeInUp 0.8s ease-out;
}

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

.avatar-container {
  animation: bounceIn 1s ease-out;
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
</style>