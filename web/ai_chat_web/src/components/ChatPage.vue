<template>
  <div class="container">
    <sessions-list 
    :active-session="activeSession" 
    @select-session="selectSession"
    @create-session="createSession" />

    <div class="chat-panel">
      <!-- 聊天头部 -->
      <div class="chat-header">
        <span id="chat-title">{{ chatTitle }}</span>
        <button class="clear-chat-btn" title="清空聊天记录" @click="clearChat">
          <i class="fas fa-trash-alt"></i>
        </button>
      </div>

      <!-- 消息容器 -->
      <div class="messages-container" ref="messagesContainer">
        <MessageItem v-for="(message, index) in messages" :ref="(el) => setItemRef(el, message.id)" :key="message.id"
          :message="message" :character="activeCharacter" 
          :is-last="index === messages.length - 1"
          :is-generating="isStreaming &&
            message.role === 'assistant' &&
            index === messages.length - 1
            " @delete="deleteMessage" @edit="editMessage" @copy="copyMessage" @regenerate="regenerateResponse" />
      </div>

      <!-- 输入区域 -->
      <div class="input-container">
        <div class="input-wrapper" :class="{ expanded: isInputExpanded }">
          <textarea class="message-input" v-model="inputMessage" placeholder="输入消息..." @keydown="handleKeydown"
            @input="adjustTextareaHeight" ref="messageInput" rows="1"></textarea>

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
    <SettingsPanel :character="activeCharacter" :session="activeSession" @update-character="updateCharacter" />
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUpdate, reactive } from "vue";
import { apiService } from "../services/llmApi";
import PopupService from "../services/PopupService";

import SessionsList from "./SessionsList.vue";
import MessageItem from "./MessageItem.vue";
// import ChatPanel from "./ChatPanel.vue";
import SettingsPanel from './SettingsPanel.vue'

const activeCharacter = ref({
  id: '',
  title: '',
  name: '',
  identity: '',
  detailed_setting: '',
  avatar_url: ''
});
const activeSession = ref({
  id: '',
  model: '',
  memory_type: '',
  temperature: 0.7,
  max_tokens: 2048,
  top_p: 0.9,
  frequency_penalty: 0.5
});
const messages = ref([]);
const inputMessage = ref("12");
const isInputExpanded = ref(false);
const isDeepThinking = ref(false);
const messagesContainer = ref(null);
const messageInput = ref(null);
const abortController = ref(null);
const isStreaming = ref(false);

// onMounted(async () => {
//   await loadCharacters();
// });


// const loadCharacters = async () => {
//   const data = await apiService.fetchSessions();
//   sessions.value = data.items;
//   if (sessions.value.length > 0) {
//     selectSession(sessions.value[0].id);
//   }
// };

const selectSession = async (sessionId) => {
  const session = await apiService.fetchSessionConfig(sessionId);
  //const sessionConfig = await apiService.fetchSessionConfig(session.id);
  const character = await apiService.fetchCharacter(session["character_id"]);
  activeCharacter.value = character;

  const sessionMessages = await apiService.fetchSessionMessages(session.id);
  messages.value = sessionMessages.items;
  activeSession.value = session;

};
// 方法一：使用函数式引用存储组件实例
const itemRefs = ref({});

const setItemRef = (el, idx) => {
  if (el) {
    itemRefs.value[idx] = el;
  }
};
// 组件更新前清理无效引用
onBeforeUpdate(() => {
  itemRefs.value = {};
});

// 处理流式响应
const handleStreamResponse = async (userMessageId) => {
  isStreaming.value = true;
  abortController.value = new AbortController();

  const message = reactive({
    id: "tmp-assistant-id",
    role: "assistant",
    content: "",
    reasoning_content: null,
  });
  
  let assistantMessageId = null;

  try {
    let fullResponse = "";
    let isThinking = false;
    let thinkingContent = "";
    // 调用流式API
    for await (const value of apiService.fetchResponse(
      activeSession.value.id,
      userMessageId,
      isDeepThinking.value,
      abortController.value
    )) {
      if (!isStreaming.value) break;

      if (value.error) {
        console.error("Error in stream:", value.error);
        // 处理错误，更新消息为错误状态
        // handleUpdateStreamingMessage({
        //   error: value.error,
        //   messageId: assistantMessageId,
        // });
        break;
      }

      if (value.message_id) {
        assistantMessageId = value.message_id;
        // 等到获取了message_id之后再更新消息列表，并设置正确的ID
        message.id = assistantMessageId;
        messages.value.push(message);
        continue;
      }

      if (value.reasoning_content) {
        if (!isThinking) {
          isThinking = true;
          itemRefs.value[message.id].showThinkingBox();
        }
        thinkingContent += value.reasoning_content;
        // 更新思考内容
        message.reasoning_content = thinkingContent;
        console.log("更新思考内容:", value.reasoning_content);
        //messages.value = [...messages.value];
        continue;
      }

      if (isThinking) {
        isThinking = false;
        itemRefs.value[message.id].hideThinkingBox();
        // message
        //   // 思考结束，可以折叠思考部分
        //   .handleUpdateStreamingMessage({
        //     reasoningFinished: true,
        //     messageId: assistantMessageId,
        //   });
      }

      if (value.content) {
        fullResponse += value.content;
        // 更新消息内容
        message.content = fullResponse;
        console.log("更新消息内容:", value.content);
        // messages.value = [...messages.value];
      }
    }
  } catch (error) {
    if (error.name !== "AbortError") {
      console.error("Error during streaming:", error);
      message.content = error;
    }
  } finally {
    isStreaming.value = false;
    abortController.value = null;
    message.id = assistantMessageId; // 更新消息ID为最终生成的ID
    messages.value = [...messages.value];
  }
};

const handleSendUserMessage = async (text) => {
  const reponse = await apiService.addMessage(activeSession.value.id, text);
  const messageId = reponse["id"];

  const message = {
    id: messageId,
    role: "user",
    content: text,
    reasoning_content: null,
  };
  messages.value.push(message);

  handleStreamResponse(messageId);
};

const updateCharacter = async (updatedCharacter) => {
  // 更新角色逻辑
};

//聊天逻辑

// 计算聊天标题
const chatTitle = computed(() => {
  if (activeSession.name) {
    return activeSession.name;
  }
  return "新会话";
});

// 监听消息变化，自动滚动到底部
watch(
  () => messages,
  () => {
    nextTick(() => {
      scrollToBottom();
    });
  },
  { deep: true }
);

// 组件挂载时调整输入框高度
onMounted(() => {
  adjustTextareaHeight();
});

// 调整文本区域高度
const adjustTextareaHeight = () => {
  const textarea = messageInput.value;
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

// 滚动到底部
const scrollToBottom = () => {
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
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
  adjustTextareaHeight(); // 重置输入框高度

  //   // 发出发送消息事件
  //   emit("send-message", message, isDeepThinking.value);
  handleSendUserMessage(message);
};

// 停止生成
const abortResponse = () => {
  emit("abort-response");
};

// 清空聊天
const clearChat = async () => {
  const result = await PopupService.confirm(
    "确认清空",
    "确定要删除所有聊天记录吗？此操作不可撤销。"
  );

  if (result.isConfirmed) {
    // 清空聊天记录
    await apiService.clearSessionMessages(activeSession.value.id);
    messages.value = [];
    PopupService.toast("聊天记录已清空", "success");
  }
};

// 删除消息
const deleteMessage = async (message) => {
  const result = await PopupService.confirm(
    "确认删除",
    "确定要删除这条消息吗？此操作不可撤销。",
    "确认删除",
    "取消"
  );


  if (result.isConfirmed) {
    try {
      await apiService.deleteMessage(message.id);
      messages.value = messages.value.filter((m) => m.id !== message.id);

      //emit("delete-message", message.id);
      PopupService.toast("消息已删除", "success");
    } catch (error) {
      console.error("删除消息失败:", error);
      PopupService.toast("删除失败", "error");
    }
  }

};

// 编辑消息
const editMessage = async (message) => {
  const result = await PopupService.editMessage(message.content);

  if (result.isConfirmed) {
    const newContent = result.value;
    try {
      await apiService.updateMessage(message.id, newContent);
      const msg = messages.value.find((m) => m.id === message.id);
      if (msg) {
        msg.content = newContent;
      }
      messages.value = [...messages.value];
      //emit("update-message", message.id, newContent);
      PopupService.toast("消息已更新", "success");
    } catch (error) {
      console.error("更新消息失败:", error);
      PopupService.toast("更新失败", "error");
    }
  }
};

// 复制消息
const copyMessage = async (message) => {
  try {
    await navigator.clipboard.writeText(message.content);
    PopupService.toast("消息已复制", "success");
  } catch (error) {
    console.error("复制消息失败:", error);
    PopupService.toast("复制失败", "error");
  }
};

// 重新生成响应
const regenerateResponse = async (message) => {
  handleStreamResponse(message.id);
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
</script>
<style scoped>
/* 布局结构 */
.container {
  display: flex;
  height: 100vh;
  width: 100%;
  margin: 0;
  padding: 0;
  gap: 0;
}

.chat-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  border: none;
  min-width: 865px;
}

.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 15px 20px;
  font-size: 18px;
  font-weight: 600;
  background-color: #ffffff;
  border-bottom: 1px solid #eee;
  border-radius: 0;
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
  overflow-y: auto;
  padding: 25px;
  display: flex;
  flex-direction: column;
  gap: 25px;
  background: #f9f9f9;
  margin: 0 auto;
  width: 100%;
  align-items: center;
}

.input-container {
  padding: 0 20px 20px 20px;
  background-color: #f9f9f9;
  display: flex;
  justify-content: center;
  width: 100%;
}

.input-wrapper {
  border: none;
  border-radius: 18px;
  padding: 18px 20px 12px 20px;
  background-color: white;
  position: relative;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  transition: box-shadow 0.3s ease;
  min-height: 60px;
  max-width: 800px;
  width: 100%;
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
  color: #333;
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
  background-color: #4a90e2;
  color: white;
  border: none;
  border-radius: 50%;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background-color 0.2s;
  font-size: 18px;
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
