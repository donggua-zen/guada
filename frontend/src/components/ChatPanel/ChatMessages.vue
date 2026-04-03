<template>
  <div class="flex-1 overflow-hidden w-full items-center">
    <template v-if="!isLoading && messages.length === 0">
      <WelcomeScreen :session="session" />
    </template>
    <template v-else-if="authStore.isAuthenticated">
      <ScrollContainer
        ref="scrollContainerRef"
        :auto-scroll="autoScroll"
        @scroll="handleScroll"
        @is-at-bottom-change="handleIsAtBottomChange"
      >
        <div class="flex flex-col items-center px-[20px] max-w-[1000px] mx-auto pb-35">
          <div class="w-full" v-for="(pair, index) in messagePairs" :key="pair[0].id">
            <MessageItem
              v-for="message in pair"
              :key="message.id"
              :message="message"
              :avatar="getAvatar(message)"
              :is-last="message.index == messages.length - 1"
              :allow-generate="canRegenerate(message)"
              @delete="onDelete"
              @edit="onEdit"
              @copy="onCopy"
              @generate="onGenerate"
              @regenerate="onRegenerate"
              @render-complete="onRenderComplete"
              @switch="onSwitch"
            />
          </div>
        </div>
      </ScrollContainer>

      <ScrollToBottomButton
        :show="showScrollToBottomBtn"
        :is-streaming="shouldButtonBreathe"
        @click="onScrollToBottomClick"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, defineEmits, defineProps, ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { pairMessages, allowReSendMessage } from '@/utils/messageUtils'
import MessageItem from '../MessageItem.vue'
import ScrollContainer from '../ui/ScrollContainer.vue'
import ScrollToBottomButton from '../ui/ScrollToBottomButton.vue'
import WelcomeScreen from './WelcomeScreen.vue'

const props = defineProps<{
  messages: any[]
  session: any
  isLoading: boolean
  autoScroll: boolean
  showScrollToBottomBtn: boolean
  shouldButtonBreathe: boolean
  userAvatar: string | undefined
}>()

const emit = defineEmits<{
  delete: [message: any]
  edit: [message: any]
  copy: [message: any]
  generate: [message: any]
  regenerate: [message: any]
  switch: [message: any, turns_id: string]
  renderComplete: []
  scroll: [event: any]
  isAtBottomChange: [isAtBottom: boolean]
  scrollToBottomClick: []
}>()

const authStore = useAuthStore()
const scrollContainerRef = ref<any>(null)
const messagePairs = computed(() => pairMessages(props.messages))

const getAvatar = (message: any) =>
  message.role == 'user' ? props.userAvatar : props.session?.avatar_url

const canRegenerate = (message: any) =>
  !props.isStreaming && allowReSendMessage(message, message.index ?? 0, props.messages)

// 事件转发
const onDelete = (message: any) => emit('delete', message)
const onEdit = (message: any) => emit('edit', message)
const onCopy = (message: any) => emit('copy', message)
const onGenerate = (message: any) => emit('generate', message)
const onRegenerate = (message: any) => emit('regenerate', message)
const onSwitch = (message: any, turns_id: string) => emit('switch', message, turns_id)
const onRenderComplete = () => emit('renderComplete')
const handleScroll = (event: any) => emit('scroll', event)
const handleIsAtBottomChange = (isAtBottom: boolean) => emit('isAtBottomChange', isAtBottom)
const onScrollToBottomClick = () => emit('scrollToBottomClick')

// 暴露 scrollContainerRef 给父组件使用
defineExpose({
  scrollContainerRef
})
</script>
