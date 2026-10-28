<template>
  <div class="flex-1 min-h-0 min-w-0 flex flex-col">
    <!-- 本地续聊 / 离线 / 配置缺失提示 -->
    <div v-if="bannerText" class="shrink-0 px-4 py-1.5 text-[11px] banner" :class="bannerKind">
      {{ bannerText }}
    </div>

    <!-- 详情加载 -->
    <div
      v-if="loading && !session"
      class="flex-1 flex items-center justify-center text-sm text-(--gd-color-text-gray)"
    >
      {{ t('bot.chat.loading') }}
    </div>

    <!-- 详情错误 -->
    <div
      v-else-if="error"
      class="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center"
    >
      <p class="text-sm text-(--gd-color-text-gray)">{{ error }}</p>
      <el-button size="small" @click="emit('refresh')">{{ t('bot.chat.retry') }}</el-button>
    </div>

    <!-- 复用主聊天面板 -->
    <ChatPanel
      v-else-if="session"
      ref="chatPanelRef"
      :session="session"
      :session-id="session.id"
      :readonly="!detail?.canReply"
      :readonly-placeholder="t('bot.chat.readonlyHint')"
      :composer-key="`${session.id}:${detail?.canReply ? 'rw' : 'ro'}`"
      :disable-branch="true"
      :send-handler="sendHandler"
      :aside-width="0"
      :aside-reserve="0"
      class="flex-1 min-h-0"
    />

    <!-- 未选择会话 -->
    <div
      v-else
      class="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center"
    >
      <div
        class="w-14 h-14 rounded-full flex items-center justify-center bg-(--gd-color-primary-100) text-(--gd-color-primary)"
      >
        <el-icon :size="26"><ChatDotRound /></el-icon>
      </div>
      <p class="text-sm font-medium text-(--gd-color-gray-900) dark:text-(--gd-color-gray-100)">
        {{ t('bot.chat.selectConversation') }}
      </p>
      <p class="text-xs text-(--gd-color-text-gray)">{{ t('bot.chat.selectHint') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElButton, ElIcon } from 'element-plus'
import { ChatDotRound } from '@element-plus/icons-vue'
import ChatPanel from '@/components/chat/ChatPanel.vue'
import type { BotSessionDetail } from '@/types/bot'
import type { Session } from '@/types/session'
import type { ChatStreamParams, ChatStreamResponse } from '@/services/modules/ChatStreamService'

const props = defineProps<{
  detail: BotSessionDetail | null
  session: Session | null
  loading: boolean
  error: string | null
  sendHandler: (params: ChatStreamParams) => Promise<ChatStreamResponse>
}>()

const emit = defineEmits<{
  refresh: []
}>()

const { t } = useI18n()
const chatPanelRef = ref<InstanceType<typeof ChatPanel> | null>(null)

const bannerKind = computed<'warning' | 'info'>(() => {
  if (props.detail?.warning) return 'warning'
  if (!props.detail?.canReply) return 'warning'
  return 'info'
})

const bannerText = computed(() => {
  if (!props.detail) return ''
  if (props.detail.warning) return props.detail.warning
  if (!props.detail.canReply) return t('bot.chat.readonlyHint')
  if (props.detail.bot && !props.detail.bot.online) return t('bot.chat.botOfflineHint')
  // 正常可回复时不展示「本地续聊」提示
  return ''
})

/** 供父页在清空记录后强制 ChatPanel 重新拉事件页 */
async function reload() {
  const id = props.session?.id
  if (!id) return
  await chatPanelRef.value?.loadMessages?.(id)
}

defineExpose({ reload })
</script>

<style scoped>
.banner.warning {
  color: var(--gd-color-danger);
  background: color-mix(in srgb, var(--gd-color-danger) 8%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--gd-color-danger) 18%, transparent);
}

.banner.info {
  color: var(--gd-color-text-gray);
  background: var(--gd-color-gray-50);
  border-bottom: 1px solid var(--gd-color-border);
}

.dark .banner.info {
  background: var(--gd-color-gray-900);
}
</style>
