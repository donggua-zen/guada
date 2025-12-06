<template>
  <div class="flex flex-col h-full">
    <!-- 聊天头部 -->
    <div class="chat-header">
      <template v-if="!localSidebarVisible">
        <n-button text @click="localSidebarVisible = true">
          <template #icon>
            <n-icon size="22">
              <FormatListBulletedSharp />
            </n-icon>
          </template>
        </n-button>
        <span class="ml-4"></span>
      </template>
      <span class="hidden md:block">{{ chatTitle }}</span>
      <n-divider vertical />
      <n-button tertiary round size="small" icon-placement="left" @click="handleSwitchModelClick">
        {{ currentModelName }}
        <template #icon>
          <n-icon size="18">
            <SettingsTwotone />
          </n-icon>
        </template>
      </n-button>

      <div class="flex items-center flex-1 justify-end">
        <!-- 更多操作下拉菜单 -->
        <n-dropdown trigger="hover" :options="moreOptions" @select="handleMoreSelect">
          <n-button class="more-btn" title="更多操作" text>
            <template #icon>
              <n-icon size="24">
                <MoreVertOutlined />
              </n-icon>
            </template>
          </n-button>
        </n-dropdown>
      </div>
    </div>

    <!-- 消息内容区域 -->
    <div class="messages-container" ref="messagesContainerRef">
      <template v-if="!isLoading && activeMessages.length === 0">
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
                {{ currentSession.title || '' }}
              </h1>
              <h2 class="text-lg font-normal text-gray-600 leading-relaxed">
                {{ currentSession.description || '' }}
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
      <template v-else-if="authStore.isAuthenticated">
        <scroll-container ref="scrollContainerRef" :auto-scroll="true" :smooth-scroll="!isStreaming">
          <div class="flex flex-col items-center px-[20px] max-w-[1000px] mx-auto">
            <MessageItem v-for="(message, index) in activeMessages" :ref="(el) => setItemRef(el, message.id)"
              :key="message.id" :message="message"
              :avatar="message.role == 'user' ? userAvater : currentSession.avatar_url"
              :is-last="index == activeMessages.length - 1"
              :allow-generate="!isStreaming && allowReSendMessage(message, index)" @delete="deleteMessage"
              @edit="editMessage" @copy="copyMessage" @generate="generateResponse" @regenerate="regenerateResponse"
              @switch="switchContent" @renderComplete="handleRenderComplete" />
          </div>
        </scroll-container>
      </template>
    </div>

    <!-- 输入区域 -->
    <div class="px-5 pb-2.5 w-full flex flex-col items-center">
      <div class="w-full flex items-center max-w-[960px]">
        <ChatInput v-model:value="inputMessage.text" v-model:web-search-enabled="webSearchEnabled"
          v-model:thinking-enabled="thinkingEnabled" :buttons="chatInputButtons" :files="inputMessage.files"
          :streaming="isStreaming" @send="handleSendMessage" @abort="abortResponse" @toggle-web-search="handleWebSearch"
          @toggle-thinking="toggleDeepThinking" @tokens-statistic="handleTokensStatistic" />
      </div>
      <div class="ai-disclaimer text-xs text-gray-400 text-center mt-2">内容由AI生成，仅供参考</div>

    </div>
    <n-modal v-model:show="showEditMessageModal" :mask-closable="false" :auto-focus="false"
      style="width: 860px; max-width: 90vw" title="编辑消息" preset="card">
      <ChatInput v-model:value="editInputMessage.text" v-model:web-search-enabled="webSearchEnabled"
        v-model:thinking-enabled="thinkingEnabled" :buttons="chatInputButtons" :shadow="false"
        :files="editInputMessage.files" :streaming="isStreaming" @send="handleReSendMessage" @abort="abortResponse"
        @toggle-web-search="handleWebSearch" @toggle-thinking="toggleDeepThinking"
        @tokens-statistic="handleTokensStatistic" />
    </n-modal>
    <!-- Tokens统计模态框 -->
    <TokenStatisticsModal v-model:show="showTokenModal" :currentSessionId="currentSession.id" />
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUpdate, reactive, h } from "vue";
import { store } from "../stores/store";
import { apiService } from "../services/ApiService";
import { usePopup } from "@/composables/usePopup";
import { useDebounceFn } from "@vueuse/core";
import { useAuthStore } from "../stores/auth"

// 组件导入
import MessageItem from "./MessageItem.vue";
import Avatar from "./Avatar.vue";
import TokenStatisticsModal from "./TokenStatisticsModal.vue";
import ChatInput from "./ChatInput.vue";
import ScrollContainer from "@/components/layout/ScrollContainer.vue";

// 图标导入
import {
  DeleteTwotone,
  SettingsTwotone,
  FormatListBulletedSharp,
  MoreVertOutlined,
  FileDownloadOutlined,
  FileUploadOutlined
} from "@vicons/material";

// UI组件导入
import { NButton, NIcon, NDivider, NDropdown, NModal } from "naive-ui";

// 弹出层工具
const { confirm, editText, toast, notify } = usePopup();
const authStore = useAuthStore()

// 响应式数据
const scrollContainerRef = ref(null);
const messagesContainerRef = ref(null);
const currentSessionId = ref(null);
const showTokenModal = ref(false);
const showEditMessageModal = ref(false);
const itemRefs = ref({});
const isLoading = ref(false)

// 更多操作下拉菜单选项
const moreOptions = ref([
  {
    label: "清空记录",
    key: "clear",
    icon: () => h(NIcon, null, { default: () => h(DeleteTwotone) })
  },
  {
    label: "导出记录",
    key: "export",
    icon: () => h(NIcon, null, { default: () => h(FileDownloadOutlined) })
  },
  {
    label: "导入记录",
    key: "import",
    icon: () => h(NIcon, null, { default: () => h(FileUploadOutlined) })
  }
]);

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

const emit = defineEmits([
  "update:session",
  "openSettings",
  "openSwitchModel",
  "update:sidebarVisible",
  "saveSettings"
]);

// 计算属性
const currentSession = computed({
  get: () => props.session,
  set: (session) => emit("update:session", session)
});


const chatTitle = computed(() => props.session?.title || "Loading...");
const userAvater = computed(() => authStore.user?.avatar_url);

const currentModelName = computed(() =>
  currentSession.value.model
    ? currentSession.value.model.model_name.split("/").pop()
    : "请选择对话模型"
);

const isStreaming = computed(() => store.sessionIsStreaming(currentSessionId.value));

const inputMessage = computed({
  get: () => store.getInputMessage(currentSessionId.value) || { text: "", files: [] },
  set: (value) => store.setInputMessage(currentSessionId.value, value)
});

const editInputMessage = ref({ old_message_id: "", text: "", files: [] });

const activeMessages = computed({
  get: () => store.getMessages(currentSessionId.value) || [],
  set: (value) => store.setMessages(currentSessionId.value, value)
});

const webSearchEnabled = computed({
  get() {
    return currentSession.value.settings?.web_search_enabled;
  },
  set(value) {
    currentSession.value.settings["web_search_enabled"] = value;
  }
});

const thinkingEnabled = computed({
  get() {
    return currentSession.value.settings?.thinking_enabled;
  },
  set(value) {
    currentSession.value.settings["thinking_enabled"] = value;
  }
});



const chatInputButtons = computed(() => {
  return {
    thinkingButton: currentSession.value.model?.features?.includes("thinking"),
    imagesButton: currentSession.value.model?.features?.includes("visual"),
  }
})

const localSidebarVisible = computed({
  get() {
    return props.sidebarVisible;
  },
  set(value) {
    emit("update:sidebarVisible", value);
  }
});

// 防抖函数
const debouncedUpdatedSession = useDebounceFn(updateSessionLastMessage, 1000);
const debouncedSwitchContent = useDebounceFn(
  (messageId, contentId) => apiService.setMessageCurrentContent(messageId, contentId),
  300
);
const debouncedSaveSession = useDebounceFn(() => {
  emit("saveSettings");
}, 200);

// 监听器
watch(() => props.session?.id, handleSessionChange, { immediate: true });

watch(
  () => activeMessages.value,
  () => {
    nextTick(() => {
      if (scrollContainerRef.value?.isAtBottom && !isStreaming.value) {
        immediateScrollToBottom();
      }
    });
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

// 滚动功能
function immediateScrollToBottom() {
  scrollContainerRef.value?.immediateScrollToBottom();
}

function smoothScrollToBottom() {
  scrollContainerRef.value?.smoothScrollToBottom();
}

function handleRenderComplete() {
  // 消息渲染完成时的处理
}

// 更多操作菜单选择处理
function handleMoreSelect(key) {
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
  if (!(await confirm("导入聊天记录", "确定要导入聊天记录吗？这将替换当前的聊天记录。"))) {
    return;
  }
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";

  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const chatData = JSON.parse(text);
      // 这里可以添加数据验证逻辑
      await apiService.importMessages(currentSession.value.id, chatData.messages);
      toast.success("聊天记录导入成功");
      loadMessages(currentSession.value.id);
      debouncedUpdatedSession();
    } catch (error) {
      console.error("导入聊天记录失败:", error);
      toast.error("文件格式错误或读取失败");
    }
  };

  input.click();
}

// 会话相关方法
function setItemRef(el, messageId) {
  if (el) itemRefs.value[messageId] = el;
}

async function handleSessionChange(newSessionId, oldSessionId) {
  if (newSessionId === oldSessionId) return;
  isLoading.value = true;
  currentSessionId.value = newSessionId;
  if (newSessionId) {
    await loadMessages(newSessionId);
    nextTick(immediateScrollToBottom);
  }
  isLoading.value = false;
}

async function loadMessages(sessionId) {
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
  if (lastMessage?.state?.is_streaming) return;

  const currentContent = getCurrentContent(lastMessage.contents);
  currentSession.value.last_message = {
    content: currentContent.content,
    created_at: currentContent.created_at
  };
  currentSession.value = { ...currentSession.value };
}

function getCurrentIndex(messageContents) {
  if (!messageContents?.length) return 0;
  const currentIndex = messageContents.findIndex((content) => content.is_current);
  return currentIndex !== -1 ? currentIndex : 0;
}

function getCurrentContent(messageContents) {
  const index = getCurrentIndex(messageContents);
  return messageContents[index];
}

function allowReSendMessage(message, index) {
  if (message.role !== "user") return false;
  // 最后一条user消息允许重新再发送栏中编辑
  return index >= activeMessages.value.length - 2;
}

async function* dummy_chat(_sessionId, _messageId, _regeneration_mode = null, _assistant_message_id = null) {
  // 模拟创建消息
  yield {
    type: "create",
    message_id: "dummy-assistant-message-id",
    content_id: "dummy-content-id",
    model_name: "Dummy Model"
  };

  // 模拟网络搜索
  yield {
    type: "web_search",
    msg: "start"
  };

  yield {
    type: "web_search",
    msg: "end"
  };



  yield {
    type: "think",
    msg: "正在分析问题..."
  };

  // 模拟逐步思考过程
  const thoughts = [
    "\n\n首先，我需要理解用户的问题。",
    "\n然后，我会考虑相关的知识点。",
    "\n最后，我会组织语言给出详细回答。"
  ];
  for (let i = 0; i < 5; i++) {
    for (const thought of thoughts) {
      yield {
        type: "think",
        msg: thought
      };
      // 模拟延迟
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }


  // 模拟实际回答内容
  const responseText = "这是模拟的回答内容。通过这个模拟函数，我们可以在没有真实API的情况下测试界面交互和功能。\n\n" +
    "模拟的内容包括：\n" +
    "1. 消息创建过程\n" +
    "2. 网络搜索提示\n" +
    "3. 思考过程（可选）\n" +
    "4. 实际回答内容\n\n" +
    "这样开发者就可以在开发过程中方便地进行调试和界面优化。";
  for (let i = 0; i < 5; i++) {
    for (let y = 0; y < responseText.length; y++) {
      yield {
        type: "text",
        msg: responseText.charAt(y)
      };
      // 模拟打字效果
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  // 模拟结束
  yield {
    type: "finish",
    finish_reason: "stop"
  };
}

// 流式响应处理
async function handleStreamResponse(
  streamingSessionId,
  userMessageId,
  regenerationMode = null,
  assistantMessageId = null
) {

  const USE_DUMMY_CHAT = false; // 设为 true 使用模拟接口，设为 false 使用真实接口

  store.setSessionIsStreaming(streamingSessionId, true);

  let message = null;
  let assistantMessageIdResult = null;
  let contentIndex = 0;

  try {
    let responseContent = "";
    let thinkingContent = "";
    let itemRef = null;
    // const chatSouce = USE_DUMMY_CHAT ? dummy_chat : apiService.chat;

    for await (const response of apiService.chat(
      streamingSessionId,
      userMessageId,
      regenerationMode,
      assistantMessageId,
    )) {
      if (response.type == "finish") {
        handleStreamFinish(response, message, contentIndex, assistantMessageIdResult);
        break;
      }

      if (response.type == "create") {
        ({ message, contentIndex } = handleNewMessage(response, streamingSessionId, userMessageId));
        assistantMessageIdResult = response.message_id;
        continue;
      }

      if (response.type == "web_search") {
        if (response.msg == "start") {
          message.state.is_web_searching = true;
        } else {
          message.state.is_web_searching = false;
        }
        continue;
      }

      if (response.type == "think") {
        if (!message?.state.is_thinking) {
          message.state.is_thinking = true;
          itemRefs.value[message.id].showThinking();
        }
        thinkingContent = handleThinkingContent(response, message, contentIndex, thinkingContent);
        continue;
      }

      if (response.type == "text") {
        if (message?.state.is_thinking) {
          message.state.is_thinking = false;
          itemRefs.value[message.id].hideThinking();
        }
        responseContent = handleContentResponse(response, message, contentIndex, responseContent);
        continue;
      }
    }
  } catch (error) {
    handleStreamCatchError(error, message, contentIndex, assistantMessageIdResult);
  } finally {
    cleanupStreaming(streamingSessionId, message, contentIndex);
    debouncedUpdatedSession();
  }
}

function handleNewMessage(response, sessionId, userMessageId) {
  const { message_id, content_id, model_name } = response;
  currentSession.value.updated_at = new Date().toISOString();

  const existingMessage = activeMessages.value.find((msg) => msg.id === message_id);

  if (existingMessage) {
    existingMessage.contents.forEach((item) => (item.is_current = false));
    existingMessage.contents.push({
      id: content_id,
      content: "",
      reasoning_content: null,
      meta_data: { model_name },
      is_current: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    existingMessage.state = {
      is_web_searching: false,
      is_thinking: false,
      is_streaming: true
    };
    return {
      message: existingMessage,
      contentIndex: existingMessage.contents.length - 1
    };
  } else {
    const newMessage = reactive({
      id: message_id,
      role: "assistant",
      contents: [
        {
          id: content_id,
          content: "",
          reasoning_content: null,
          meta_data: { model_name },
          is_current: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      ],
      parent_id: userMessageId,
      state: {
        is_web_searching: false,
        is_thinking: false,
        is_streaming: true
      },
      created_at: new Date().toISOString()
    });
    store.addMessage(sessionId, newMessage);
    return {
      message: newMessage,
      contentIndex: 0
    };
  }
}

function handleThinkingContent(response, message, contentIndex, thinkingContent) {
  thinkingContent += response.msg;
  message.contents[contentIndex].reasoning_content = thinkingContent;
  return thinkingContent;
}

function handleContentResponse(response, message, contentIndex, currentContent) {
  const newContent = currentContent + response.msg;
  message.contents[contentIndex].content = newContent;
  return newContent;
}

function handleStreamFinish(response, message, contentIndex, assistantMessageId) {
  if (response.finish_reason !== "error") {
    return;
  }
  console.error("Error in stream:", response.error);
  if (message && assistantMessageId) {
    message.contents[contentIndex].meta_data = {
      ...message.contents[contentIndex].meta_data,
      error: response.error,
      finish_reason: response.finish_reason
    };
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

function cleanupStreaming(sessionId, message, contentIndex) {
  store.setSessionIsStreaming(sessionId, false);
  if (message) {
    message.state.is_streaming = false;
    message.state.is_thinking = false;
    message.state.is_web_searching = false;
    message.contents[contentIndex].updated_at = new Date().toISOString();
    itemRefs.value[message.id]?.hideThinking();
  }
}

// 消息发送处理
async function sendNewMessage(sessionId, text, files, replaceMessageId = null) {
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
    store.deleteMessage(sessionId, replaceMessageId);
    const assistantMessage = activeMessages.value.find((msg) => msg.parent_id === replaceMessageId);
    if (assistantMessage) {
      store.deleteMessage(sessionId, assistantMessage.id);
    }
  }
  activeMessages.value.push(message);
  debouncedUpdatedSession();
  await nextTick(() => {
    immediateScrollToBottom();
  });
  return message;
}

// 消息操作方法
function abortResponse() {
  apiService.cancelResponse(currentSessionId.value);
}

async function clearChat() {
  if (await confirm("清空聊天记录", "确定要删除所有聊天记录吗？此操作不可撤销。")) {
    await apiService.clearSessionMessages(currentSessionId.value);
    store.clearSessionState(currentSessionId.value);
    debouncedUpdatedSession();
    toast.success("聊天记录已清空");
  }
}

const handleSwitchModelClick = (modelId) => {
  emit("openSwitchModel", modelId);
};

async function deleteMessage(message) {
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
        if (assistantMessage)
          store.deleteMessage(currentSessionId.value, assistantMessage.id);
      }
      store.deleteMessage(currentSessionId.value, message.id);
      debouncedUpdatedSession();
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
      cancelText: "取消"
    });

    if (result) {
      message.contents[index].content = result;
      await apiService.updateMessage(message.id, result);
      store.updateMessage(currentSessionId.value, message.id, message);
      debouncedUpdatedSession();
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

async function handleSendMessage() {
  const data = inputMessage.value;
  if ((!data.text?.trim() && !data.files.length) || isStreaming.value) return;

  try {
    const { text, files } = data;
    const message = await sendNewMessage(currentSession.value.id, text, files);
    inputMessage.value = { text: "", files: [] };
    handleStreamResponse(currentSessionId.value, message.id);
  } catch (error) {
    notify.error("消息发送失败", error.message);
  }
}

async function handleReSendMessage() {
  try {
    const data = editInputMessage.value;
    const { text, files } = data;
    const message = await sendNewMessage(currentSession.value.id, text, files, data.old_message_id);
    editInputMessage.value = { old_message_id: "", text: "", files: [] };
    showEditMessageModal.value = false;
    handleStreamResponse(currentSessionId.value, message.id);
  } catch (error) {
    notify.error("消息发送失败", error.message);
  }
}

function generateResponse(message) {
  editInputMessage.value = {
    old_message_id: message.id,
    text: message.contents[0].content,
    files: message.files
  };
  showEditMessageModal.value = true;
}

function regenerateResponse(message) {
  if (message.contents.length >= 5) {
    toast.error("暂时最多支持5个回答版本");
    return;
  }
  handleStreamResponse(currentSessionId.value, message.parent_id, "multi_version", message.id);
}

function switchContent(message, content) {
  const targetMessage = activeMessages.value.find((m) => m.id === message.id);
  targetMessage.contents.forEach((item) => {
    item.is_current = item.id === content.id;
  });
  debouncedSwitchContent(message.id, content.id);
  debouncedUpdatedSession();
}

// 设置操作
const handleWebSearch = () => {
  debouncedSaveSession();
};

const toggleDeepThinking = () => {
  debouncedSaveSession();
};

function handleTokensStatistic() {
  showTokenModal.value = true;
}

defineExpose({ sendMessage: handleSendMessage })

</script>

<style scoped>
.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 60px;
  font-size: 18px;
  font-weight: 600;
  border-bottom: 1px solid rgba(21, 23, 28, 0.1);
  border-radius: 0;
  margin: 0 40px;
}

.more-btn {
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

.more-btn:hover {
  background-color: #f5f5f5;
  color: #333;
}

.messages-container {
  flex: 1;
  overflow-y: hidden;
  width: 100%;
  align-items: center;
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
