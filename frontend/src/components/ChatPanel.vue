<template>
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
      <MessageItem
        v-for="message in messages"
        :key="message.id"
        :message="message"
        :character="currentCharacter"
        :is-generating="isStreaming && message.role === 'assistant' && message.id === generatingMessageId"
        @delete="deleteMessage"
        @edit="editMessage"
        @copy="copyMessage"
        @regenerate="regenerateResponse"
      />
    </div>

    <!-- 输入区域 -->
    <div class="input-container">
      <div class="input-wrapper" :class="{ expanded: isInputExpanded }">
        <textarea
          class="message-input"
          v-model="inputMessage"
          placeholder="输入消息..."
          @keydown="handleKeydown"
          @input="adjustTextareaHeight"
          ref="messageInput"
          rows="1"
        ></textarea>
        
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
            <button
              class="tool-btn"
              id="deep-thinking-btn"
              :class="{ active: isDeepThinking }"
              :title="isDeepThinking ? '关闭深度思考' : '深度思考'"
              @click="toggleDeepThinking"
            >
              <i class="fas fa-brain"></i>
            </button>
          </div>
          
          <div class="send-actions">
            <button
              class="send-btn"
              title="发送"
              @click="sendMessage"
              :disabled="!inputMessage.trim()"
            >
              <i class="fas fa-arrow-up"></i>
            </button>
            <button
              v-if="isStreaming"
              class="send-btn stop-btn"
              title="停止生成"
              @click="abortResponse"
            >
              <i class="fas fa-stop"></i>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { apiService } from '../services/llmApi'
import MessageItem from './MessageItem.vue'
import PopupService from '../services/PopupService'

const props = defineProps({
  messages: {
    type: Array,
    default: () => []
  },
  currentCharacter: {
    type: Object,
    default: () => ({})
  },
  currentSession: {
    type: Object,
    default: () => ({})
  },
  isStreaming: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits([
  'send-message',
  'clear-chat',
  'abort-response',
  'update-message',
  'delete-message',
  'regenerate-response'
])

const inputMessage = ref('')
const isInputExpanded = ref(false)
const isDeepThinking = ref(false)
const messagesContainer = ref(null)
const messageInput = ref(null)
const generatingMessageId = ref(null)

// 计算聊天标题
const chatTitle = computed(() => {
    if (props.currentSession && props.currentSession.name) {
        return props.currentSession.name
    }
    return '新会话'
})

// 监听消息变化，自动滚动到底部
watch(() => props.messages, () => {
  nextTick(() => {
    scrollToBottom()
  })
}, { deep: true })

// 组件挂载时调整输入框高度
onMounted(() => {
  adjustTextareaHeight()
})

// 调整文本区域高度
const adjustTextareaHeight = () => {
  const textarea = messageInput.value
  if (!textarea) return
  
  // 重置高度为auto以获取正确的内容高度
  textarea.style.height = 'auto'
  // 计算内容高度
  const height = Math.min(textarea.scrollHeight, 120) // 限制最大高度为120px
  // 设置新高度
  textarea.style.height = height + 'px'
  
  // 根据高度决定是否展开输入区域
  isInputExpanded.value = textarea.scrollHeight > 60
}

// 滚动到底部
const scrollToBottom = () => {
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
  }
}

// 处理键盘事件
const handleKeydown = (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
}

// 发送消息
const sendMessage = async () => {
  const message = inputMessage.value.trim()
  if (!message || props.isStreaming) return
  
  inputMessage.value = ''
  adjustTextareaHeight() // 重置输入框高度
  
  // 发出发送消息事件
  emit('send-message', message, isDeepThinking.value)
}

// 停止生成
const abortResponse = () => {
  emit('abort-response')
}

// 清空聊天
const clearChat = async () => {
  const result = await PopupService.confirm('确认清空', '确定要删除所有聊天记录吗？此操作不可撤销。')
  
  if (result.isConfirmed) {
    emit('clear-chat')
  }
}

// 删除消息
const deleteMessage = async (message) => {
  const result = await PopupService.confirm('确认删除', '确定要删除这条消息吗？此操作不可撤销。', '确认删除', '取消')
  
  if (result.isConfirmed) {
    try {
      await apiService.deleteMessage(message.id)
      emit('delete-message', message.id)
      PopupService.toast('消息已删除', 'success')
    } catch (error) {
      console.error('删除消息失败:', error)
      PopupService.toast('删除失败', 'error')
    }
  }
}

// 编辑消息
const editMessage = async (message) => {
  const result = await PopupService.editMessage(message.content)
  
  if (result.isConfirmed) {
    const newContent = result.value
    try {
      await apiService.updateMessage(message.id, newContent)
      emit('update-message', message.id, newContent)
      PopupService.toast('消息已更新', 'success')
    } catch (error) {
      console.error('更新消息失败:', error)
      PopupService.toast('更新失败', 'error')
    }
  }
}

// 复制消息
const copyMessage = async (message) => {
  try {
    await navigator.clipboard.writeText(message.content)
    PopupService.toast('消息已复制', 'success')
  } catch (error) {
    console.error('复制消息失败:', error)
    PopupService.toast('复制失败', 'error')
  }
}

// 重新生成响应
const regenerateResponse = (message) => {
  emit('regenerate-response', message.id)
}

// 切换深度思考模式
const toggleDeepThinking = () => {
  isDeepThinking.value = !isDeepThinking.value
}

// 处理文件上传
const handleFileUpload = () => {
  // 实现文件上传逻辑
  console.log('文件上传功能')
}

// 处理网络搜索
const handleWebSearch = () => {
  // 实现网络搜索逻辑
  console.log('网络搜索功能')
}

// 处理图片上传
const handleImageUpload = () => {
  // 实现图片上传逻辑
  console.log('图片上传功能')
}
</script>

<style scoped>
.chat-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  border: none;
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