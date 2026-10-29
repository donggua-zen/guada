<template>
  <div
    class="title-info flex items-center gap-2 min-w-0"
    :title="tooltip || undefined"
  >
    <BotUserAvatar
      :avatar-url="avatarUrl"
      :platform="platform"
      :name="displayName"
      size="sm"
    />

    <span class="title-name truncate min-w-0">{{ displayName }}</span>
    <span v-if="sourceType" class="title-badge">{{ sourceLabel }}</span>
    <span
      v-if="isAdminBadge"
      class="title-badge title-badge--admin"
    >{{ t('bot.chat.adminBadge') }}</span>
    <span
      v-if="online !== null"
      class="status-dot"
      :class="online ? 'online' : 'offline'"
      :title="onlineTitle"
    ></span>
    <span v-if="botName" class="title-bot truncate min-w-0">{{ botName }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatTime } from '@/utils/formatTime'
import { useBotStore } from '@/stores/bot'
import type { BotChatConversation, BotSessionDetail } from '@/types/bot'
import type { Session } from '@/types/session'
import BotUserAvatar from './BotUserAvatar.vue'

const props = defineProps<{
  detail: BotSessionDetail | null
  session: Session | null
  conversation: BotChatConversation | null
  displayName: string
  avatarUrl?: string | null
}>()

const { t } = useI18n()
const botStore = useBotStore()

/** 私聊发送者在 Bot 管理员名单里时显示徽标 */
const isAdminBadge = computed(() => {
  const conv = props.conversation
  if (!conv?.botId || !conv.nativeId) return false
  if (conv.sourceType !== 'private') return false
  const bot = botStore.getBotById(conv.botId)
  return (bot?.adminUserIds ?? []).includes(conv.nativeId)
})

const platform = computed(
  () =>
    props.detail?.bot?.platform ??
    props.session?.platform ??
    props.conversation?.platform ??
    null,
)

const platformLabel = computed(() => {
  const key = (platform.value ?? '').toLowerCase()
  const known = ['qq', 'wechat', 'wechat-personal', 'discord', 'lark', 'wecom']
  return known.includes(key)
    ? t(`bot.platform.${key}`)
    : platform.value || t('bot.platform.unknown')
})

/** 从 externalId（platform:type:nativeId）读私聊/群聊 */
const sourceType = computed<'private' | 'group' | null>(() => {
  const externalId =
    props.session?.externalId ?? props.conversation?.externalId
  if (!externalId) return null
  const base = String(externalId).split('@')[0]
  const parts = base.split(':')
  if (parts[1] === 'group') return 'group'
  if (parts[1] === 'private') return 'private'
  return null
})

const sourceLabel = computed(() =>
  sourceType.value === 'group' ? t('bot.chat.group') : t('bot.chat.private'),
)

/** null = 详情未到达，暂不显示状态点 */
const online = computed<boolean | null>(() =>
  props.detail?.bot ? props.detail.bot.online : null,
)

const onlineTitle = computed(() =>
  online.value ? t('bot.chat.online') : t('bot.chat.offline'),
)

const botName = computed(() => props.detail?.bot?.name || '')

const lastActiveAt = computed(
  () => props.session?.lastActiveAt ?? props.conversation?.lastActiveAt ?? null,
)

/** 单行放不下平台与时间，收进 hover 提示 */
const tooltip = computed(() => {
  const parts = [platformLabel.value]
  if (lastActiveAt.value) parts.push(formatTime(lastActiveAt.value))
  return parts.filter(Boolean).join(' · ')
})
</script>

<style scoped>
.title-info {
  max-width: min(560px, 70vw);
}

.title-name {
  font-size: 13px;
  line-height: 16px;
  font-weight: 600;
  color: var(--gd-color-text);
}

.title-bot {
  font-size: 11px;
  line-height: 14px;
  color: var(--gd-color-text-gray);
}

.title-badge {
  flex-shrink: 0;
  padding: 0 5px;
  border-radius: 4px;
  font-size: 10px;
  line-height: 16px;
  white-space: nowrap;
  color: var(--gd-color-primary);
  background: var(--gd-color-primary-100);
}

.title-badge--admin {
  color: var(--gd-color-success);
  background: color-mix(in srgb, var(--gd-color-success) 15%, transparent);
}

.status-dot {
  width: 6px;
  height: 6px;
  flex-shrink: 0;
  border-radius: 9999px;
}

.status-dot.online {
  background: var(--gd-color-success);
}

.status-dot.offline {
  background: var(--gd-color-gray-400);
}
</style>
