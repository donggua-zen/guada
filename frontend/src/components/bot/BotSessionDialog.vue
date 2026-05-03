<template>
  <el-dialog
    v-model="dialogVisible"
    :title="sessionTitle"
    width="80%"
    :style="{ maxWidth: '1200px' }"
    top="12.5vh"
    :close-on-click-modal="false"
    append-to-body
    class="bot-session-dialog"
  >
    <div style="height: 65vh; overflow-y: auto;">
      <!-- 加载状态 -->
      <div v-if="loading" class="flex justify-center items-center py-12">
        <el-icon class="is-loading" :size="32">
          <Loading />
        </el-icon>
        <span class="ml-2 text-gray-500 dark:text-[#8b8d95]">加载中...</span>
      </div>

      <!-- 消息列表 -->
      <div v-else-if="messages.length > 0" class="message-list">
        <MessageItem
          v-for="message in messages"
          :key="message.id"
          :message="message"
          :avatar="getMessageAvatar(message)"
          :is-last="false"
          :allow-generate="false"
          @delete="handleDeleteMessage"
          @edit="handleEditMessage"
          @copy="handleCopyMessage"
        />
      </div>

      <!-- 空状态 -->
      <div v-else class="text-center py-12">
        <el-icon size="48" class="text-gray-300 dark:text-[#3e4046] mb-3">
          <ChatDotRound />
        </el-icon>
        <p class="text-lg text-gray-500 dark:text-[#8b8d95]">暂无消息</p>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Loading, ChatDotRound } from '@element-plus/icons-vue'
import { apiService } from '@/services/ApiService'
import MessageItem from '../chat/MessageItem.vue'
import type { Session } from '@/types/session'
import type { Message } from '@/types/message'

const props = defineProps<{
  modelValue: boolean
  session: Session | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const dialogVisible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

const sessionTitle = computed(() => {
  return props.session?.title || '会话详情'
})

const loading = ref(false)
const messages = ref<Message[]>([])

// 监听对话框打开,加载消息
watch(dialogVisible, async (visible) => {
  if (visible && props.session) {
    await loadMessages()
  }
})

// 加载消息列表
const loadMessages = async () => {
  if (!props.session) return
  
  loading.value = true
  try {
    const response = await apiService.fetchSessionMessages(props.session.id)
    messages.value = response.items || []
  } catch (error) {
    console.error('加载消息失败:', error)
    ElMessage.error('加载消息失败')
  } finally {
    loading.value = false
  }
}

// 获取消息头像
const getMessageAvatar = (message: Message): string | undefined => {
  if (message.role === 'user') {
    // 用户头像可以从 authStore 获取,这里暂时返回 undefined
    return undefined
  } else {
    // AI 头像使用会话的角色头像
    return props.session?.character?.avatarUrl
  }
}

// 删除消息
const handleDeleteMessage = async (message: Message) => {
  try {
    await ElMessageBox.confirm(
      message.role === 'user'
        ? '确定要删除这条提问吗?对应的回答也会被删除。此操作不可撤销。'
        : '确定要删除这条回答吗?此操作不可撤销。',
      '删除消息',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
    
    await apiService.deleteMessage(message.id)
    
    // 如果是用户消息,同时删除对应的助手消息
    if (message.role === 'user') {
      const assistantMessage = messages.value.find(msg => msg.parentId === message.id)
      if (assistantMessage) {
        messages.value = messages.value.filter(msg => msg.id !== assistantMessage.id)
      }
    }
    
    // 从列表中移除
    messages.value = messages.value.filter(msg => msg.id !== message.id)
    
    ElMessage.success('消息已删除')
  } catch (error) {
    if (error !== 'cancel') {
      console.error('删除消息失败:', error)
      ElMessage.error('删除失败')
    }
  }
}

// 编辑消息
const handleEditMessage = async (message: Message) => {
  ElMessage.info('编辑功能待实现')
  // TODO: 实现编辑功能
}

// 复制消息
const handleCopyMessage = (message: Message) => {
  // MessageItem 组件内部已经处理了复制逻辑
  // 这里可以添加额外的处理
}
</script>

<style scoped>
.message-list {
  padding: 20px;
  max-width: 900px;
  margin: 0 auto;
}
</style>
