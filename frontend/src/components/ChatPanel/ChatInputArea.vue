<template>
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
      <ChatInput
        v-model:value="inputMessage.content"
        v-model:thinking-enabled="thinkingEnabled"
        :config="inputConfig"
        :files="inputMessage.files"
        :streaming="streaming"
        @config-change="onConfigChange"
        @send="onSend"
        @abort="onAbort"
        @toggle-thinking="onToggleThinking"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineEmits, defineProps } from 'vue'
import ChatInput from '../ui/ChatInput.vue'

const props = defineProps<{
  inputMessage: any
  editMode: any
  streaming: boolean
  thinkingEnabled: boolean
  modelId: string | null
  maxMemoryLength: number | null
  knowledgeBaseIds: string[]
}>()

const emit = defineEmits<{
  configChange: [config: any]
  send: [payload?: any]
  abort: []
  toggleThinking: []
  exitEditMode: []
}>()

const inputConfig = computed(() => ({
  modelId: props.modelId,
  maxMemoryLength: props.maxMemoryLength,
  knowledgeBaseIds: props.editMode?.message?.knowledgeBaseIds || props.knowledgeBaseIds
}))

const onSend = (payload?: any) => emit('send', payload)
const onAbort = () => emit('abort')
const onToggleThinking = () => emit('toggleThinking')
const onExitEditMode = () => emit('exitEditMode')
</script>
