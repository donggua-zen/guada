<template>
  <aside class="bot-chat-sidebar h-full flex flex-col">
    <!-- 搜索 -->
    <div class="shrink-0 px-3 pt-3 pb-2">
      <el-input
        v-model="keyword"
        size="small"
        clearable
        class="bot-search"
        :placeholder="t('bot.chat.searchPlaceholder')"
      >
        <template #prefix>
          <el-icon><Search /></el-icon>
        </template>
      </el-input>
    </div>

    <!-- 加载 / 错误 / 无机器人 -->
    <div
      v-if="loading && groups.length === 0"
      class="flex-1 flex items-center justify-center text-sm text-(--gd-color-text-gray)"
    >
      {{ t('bot.chat.loading') }}
    </div>

    <div
      v-else-if="error"
      class="flex-1 flex flex-col items-center justify-center gap-3 px-5 text-center"
    >
      <p class="text-sm text-(--gd-color-text-gray)">{{ error }}</p>
      <el-button size="small" @click="emit('retry')">{{ t('bot.chat.retry') }}</el-button>
    </div>

    <div
      v-else-if="!hasBots"
      class="flex-1 flex flex-col items-center justify-center gap-3 px-5 text-center"
    >
      <div
        class="w-12 h-12 rounded-full flex items-center justify-center bg-(--gd-color-primary-100) text-(--gd-color-primary)"
      >
        <el-icon :size="22"><ChatDotRound /></el-icon>
      </div>
      <p class="text-sm font-medium text-(--gd-color-gray-900) dark:text-(--gd-color-gray-100)">
        {{ t('bot.chat.noBots') }}
      </p>
      <p class="text-xs leading-relaxed text-(--gd-color-text-gray)">
        {{ t('bot.chat.noBotsHint') }}
      </p>
      <el-button size="small" type="primary" @click="emit('create')">
        {{ t('bot.chat.addBot') }}
      </el-button>
    </div>

    <!-- 机器人 → 用户列表 -->
    <ScrollContainer v-else class="flex-1 min-h-0">
      <div class="bot-list">
        <div v-for="group in filteredGroups" :key="group.botId" class="bot-group">
          <!-- 机器人卡片：第一行折叠热区，第二行搬进原管理页的状态信息 -->
          <div
            class="bot-card"
            :class="{
              'is-dragging': dragSourceId === group.botId,
              'is-drop-target': dropTargetId === group.botId && dragSourceId !== group.botId,
            }"
            :draggable="!group.unknownBot"
            tabindex="0"
            @keyup.enter="toggleBot(group.botId)"
            @dragstart="handleDragStart($event, group)"
            @dragover="handleDragOver($event, group)"
            @drop.prevent="handleDrop(group)"
            @dragend="endDrag"
          >
            <div class="bot-card-head" @click="toggleBot(group.botId)">
              <span
                class="w-5 h-5 rounded-[5px] shrink-0 flex items-center justify-center bg-gray-50 dark:bg-[#2a2c30] overflow-hidden"
              >
                <img
                  :src="getBotPlatformAvatar(group.platform)"
                  :alt="group.name"
                  class="w-full h-full object-contain p-px"
                  @error="handleBotAvatarError"
                />
              </span>
              <span class="bot-card-name">
                {{ group.unknownBot ? t('bot.chat.unknownBot') : group.name }}
              </span>

              <!-- 微信个人号：二维码入口常显在名字旁，避免新用户找不到；登录中高亮提示 -->
              <button
                v-if="group.platform === 'wechat-personal' && resolveBot(group)"
                type="button"
                class="bot-card-qr"
                :class="{ 'is-pending': botStatusKey(group) === 'connecting' }"
                :title="t('bot.card.qrCode')"
                :aria-label="t('bot.card.qrCode')"
                @click.stop="openQrForGroup(group)"
              >
                <QrCode20Regular class="w-4 h-4" />
              </button>

              <div
                v-if="resolveBot(group)"
                class="bot-card-more"
                :class="{ 'is-pending': pendingId === group.botId }"
              >
                <DropdownMenu
                  @command="(cmd: string) => handleBotCommand(group, cmd)"
                >
                  <button
                    type="button"
                    class="bot-card-kebab"
                    :title="t('common.more')"
                  >
                    <MoreHorizontal20Filled class="w-4 h-4" />
                  </button>
                  <template #dropdown>
                    <DropdownMenuItem command="config">
                      <Settings20Regular class="w-4 h-4 mr-2 inline-block" />
                      {{ t('bot.card.config') }}
                    </DropdownMenuItem>
                    <DropdownMenuItem command="toggle">
                      <Stop20Regular v-if="isBotRunning(group)" class="w-4 h-4 mr-2 inline-block" />
                      <Play20Regular v-else class="w-4 h-4 mr-2 inline-block" />
                      {{ isBotRunning(group) ? t('bot.card.stop') : t('bot.card.start') }}
                    </DropdownMenuItem>
                    <DropdownMenuItem v-if="group.platform === 'wechat-personal'" command="qr">
                      <QrCode20Regular class="w-4 h-4 mr-2 inline-block" />
                      {{ t('bot.card.qrCode') }}
                    </DropdownMenuItem>
                    <DropdownMenuItem command="delete">
                      <Delete20Regular class="w-4 h-4 mr-2 inline-block" />
                      {{ t('bot.card.delete') }}
                    </DropdownMenuItem>
                  </template>
                </DropdownMenu>
              </div>

              <el-icon :size="12" class="bot-card-chevron">
                <ArrowDown v-if="!isCollapsed(group.botId)" />
                <ArrowRight v-else />
              </el-icon>
            </div>

            <div class="bot-card-meta">
              <span
                v-if="!group.unknownBot"
                class="status-dot"
                :class="`is-${botStatusKey(group)}`"
                :title="statusTitle(group)"
              ></span>
              <span v-if="lastErrorOf(group)" class="bot-card-error" :title="lastErrorOf(group)">
                {{ lastErrorOf(group) }}
              </span>
              <span v-else-if="!group.unknownBot" class="meta-item">
                {{ platformLabel(group.platform) }}
              </span>
              <span class="meta-item">
                {{ t('bot.chat.sessionCount', { n: group.total }) }}
              </span>
            </div>
          </div>

          <div v-if="!isCollapsed(group.botId)">
            <div
              v-if="group.conversations.length === 0"
              class="bot-group-empty"
            >
              {{ t('bot.chat.empty') }}
            </div>

            <div v-else class="bot-children">
              <div
                v-for="conv in group.conversations"
                :key="conv.key"
                class="conversation-row"
                :class="{ 'is-active': isActive(conv) }"
              >
                <button
                  type="button"
                  class="conversation-main"
                  :title="`${conv.displayName} · ${platformLabel(conv.platform)}`"
                  @click="emit('select', conv)"
                >
                  <BotUserAvatar
                    :avatar-url="conv.avatarUrl"
                    :platform="conv.platform ?? group.platform"
                    :name="conv.displayName"
                    size="sm"
                  />
                  <div class="flex-1 min-w-0 text-left">
                    <div class="flex items-center gap-1.5">
                      <span class="conversation-name truncate">{{ conv.displayName }}</span>
                      <span v-if="conv.sourceType === 'group'" class="conversation-badge">
                        {{ t('bot.chat.group') }}
                      </span>
                      <span v-if="isStreaming(conv.sessionId)" class="streaming-dot"></span>
                    </div>
                  </div>
                  <svg
                    v-if="conv.pinned"
                    class="conversation-pin"
                    viewBox="0 0 16 16"
                    aria-hidden="true"
                  >
                    <path
                      fill="currentColor"
                      d="M9.9 1.6a1 1 0 0 1 1.4 0l3.1 3.1a1 1 0 0 1 0 1.4l-1.9 1.9-.5 2.6a1 1 0 0 1-1.7.5L8 9.7l-3.8 3.8a.7.7 0 0 1-1-1L7 8.7 4.9 5.7a1 1 0 0 1 .5-1.7l2.6-.5 1.9-1.9Z"
                    />
                  </svg>
                  <span class="conversation-time">
                    {{ conv.lastActiveAt ? formatTime(conv.lastActiveAt) : '' }}
                  </span>
                </button>

                <div class="conversation-more">
                  <DropdownMenu
                    @command="(cmd: string) => handleConversationCommand(conv, cmd)"
                  >
                    <button
                      type="button"
                      class="history-trigger"
                      :title="t('common.more')"
                    >
                      <MoreHorizontal20Filled class="w-4 h-4" />
                    </button>
                    <template #dropdown>
                      <DropdownMenuItem command="pin">
                        <Pin20Regular v-if="!conv.pinned" class="w-4 h-4 mr-2 inline-block" />
                        <PinOff20Regular v-else class="w-4 h-4 mr-2 inline-block" />
                        {{ conv.pinned ? t('bot.chat.unpin') : t('bot.chat.pin') }}
                      </DropdownMenuItem>
                      <!-- 私聊才能精确定位发送者身份；群聊成员 ID 需在 Bot 配置里手工维护 -->
                      <DropdownMenuItem
                        v-if="conv.sourceType === 'private' && conv.nativeId && conv.botId"
                        command="toggle-admin"
                      >
                        <PersonCircle20Regular class="w-4 h-4 mr-2 inline-block" />
                        {{ isConversationAdmin(conv) ? t('bot.chat.unsetAdmin') : t('bot.chat.setAdmin') }}
                      </DropdownMenuItem>
                      <template v-if="conv.sessionCount > 1">
                        <DropdownMenuItem disabled>
                          <History20Regular class="w-4 h-4 mr-2 inline-block" />
                          {{ t('bot.chat.history') }}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          v-for="ref in conv.sessions"
                          :key="ref.id"
                          :command="ref.id"
                          :class="{ 'is-current-history': ref.id === activeSessionId }"
                        >
                          <div class="flex items-center gap-2">
                            <span class="truncate max-w-[180px]">{{ ref.title }}</span>
                            <span class="text-[11px] text-(--gd-color-text-gray)">
                              {{ ref.lastActiveAt ? formatTime(ref.lastActiveAt) : '' }}
                            </span>
                          </div>
                        </DropdownMenuItem>
                      </template>
                      <DropdownMenuItem command="clear">
                        <Broom20Regular class="w-4 h-4 mr-2 inline-block" />
                        {{ t('bot.chat.clearMessages') }}
                      </DropdownMenuItem>
                      <DropdownMenuItem command="delete">
                        <Delete20Regular class="w-4 h-4 mr-2 inline-block" />
                        {{ t('bot.chat.deleteSession') }}
                      </DropdownMenuItem>
                    </template>
                  </DropdownMenu>
                </div>
              </div>
            </div>

            <button
              v-if="group.hasMore"
              type="button"
              class="load-more"
              @click="emit('loadMore', group.botId)"
            >
              {{ t('bot.chat.more') }} ({{ group.total - group.conversations.length }})
            </button>
          </div>
        </div>

        <div
          v-if="filteredGroups.length === 0"
          class="px-4 py-8 text-center text-xs text-(--gd-color-text-gray)"
        >
          {{ t('bot.chat.noResults') }}
        </div>
      </div>
    </ScrollContainer>

    <!-- 底部工具条：所有状态下都在，添加机器人不再藏在管理页 -->
    <div class="bot-side-foot">
      <button type="button" class="bot-add" @click="emit('create')">
        <el-icon :size="14"><Plus /></el-icon>
        {{ t('bot.chat.addBot') }}
      </button>
      <GdTooltip :content="t('bot.card.docs')" placement="top">
        <button type="button" class="bot-docs" @click="emit('docs')">
          <el-icon :size="14"><Document /></el-icon>
        </button>
      </GdTooltip>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElInput, ElButton, ElIcon, ElMessage } from 'element-plus'
import { ArrowDown, ArrowRight, ChatDotRound, Document, Plus, Search } from '@element-plus/icons-vue'
import { ScrollContainer } from '@/components/ui'
import DropdownMenu from '@/components/ui/DropdownMenu.vue'
import DropdownMenuItem from '@/components/ui/DropdownMenuItem.vue'
import GdTooltip from '@/components/ui/GdTooltip.vue'
import {
  Broom20Regular,
  Delete20Regular,
  History20Regular,
  MoreHorizontal20Filled,
  PersonCircle20Regular,
  Pin20Regular,
  PinOff20Regular,
  Play20Regular,
  QrCode20Regular,
  Settings20Regular,
  Stop20Regular,
} from '@vicons/fluent'
import { apiService } from '@/services/ApiService'
import { getErrorMessage } from '@/utils/errorMessage'
import { useSessionStore } from '@/stores/session'
import { useBotStore } from '@/stores/bot'
import { botStatusKey, isBotRunning, useBotActions } from '@/composables/useBotActions'
import { getBotPlatformAvatar, handleBotAvatarError } from '@/utils/botAvatar'
import { formatTime } from '@/utils/formatTime'
import type { BotChatConversation, BotChatGroup, BotInstance } from '@/types/bot'
import BotUserAvatar from './BotUserAvatar.vue'

const props = defineProps<{
  groups: BotChatGroup[]
  activeSessionId: string | null
  loading: boolean
  error: string | null
  hasBots: boolean
}>()

const emit = defineEmits<{
  select: [conversation: BotChatConversation, sessionId?: string]
  clearConversation: [conversation: BotChatConversation]
  deleteConversation: [conversation: BotChatConversation]
  toggleAdmin: [conversation: BotChatConversation]
  retry: []
  loadMore: [botId: string]
  create: []
  docs: []
  config: [bot: BotInstance]
  qr: [bot: BotInstance]
  changed: []
  reorder: [orderedBotIds: string[]]
  'dragging-change': [dragging: boolean]
}>()

const { t } = useI18n()
const sessionStore = useSessionStore()
const botStore = useBotStore()
const { pendingId, toggleBot: toggleRunning, deleteBot: removeBot } = useBotActions(() =>
  emit('changed'),
)

const keyword = ref('')
const collapsed = ref<Set<string>>(new Set())
const pendingPinKey = ref<string | null>(null)

const filteredGroups = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  if (!q) return props.groups

  return props.groups
    .map((group) => {
      const botMatched = group.name.toLowerCase().includes(q)
      const conversations = botMatched
        ? group.conversations
        : group.conversations.filter((conv) =>
            conv.displayName.toLowerCase().includes(q) ||
            (conv.nativeId ?? '').toLowerCase().includes(q) ||
            (conv.externalId ?? '').toLowerCase().includes(q),
          )
      return {
        ...group,
        conversations,
        total: conversations.length,
        hasMore: false,
      }
    })
    .filter((group) => group.conversations.length > 0)
})

const isCollapsed = (botId: string) => collapsed.value.has(botId)

const toggleBot = (botId: string) => {
  const next = new Set(collapsed.value)
  if (next.has(botId)) next.delete(botId)
  else next.add(botId)
  collapsed.value = next
}

/** 状态/会话数走 groups，lastError 只有 botInstances 里有，按 botId 补 */
const resolveBot = (group: BotChatGroup) => botStore.getBotById(group.botId)

const lastErrorOf = (group: BotChatGroup) => resolveBot(group)?.lastError || undefined

/** 状态收进颜色点后，四态文案与错误详情挂到 hover 提示上 */
const statusTitle = (group: BotChatGroup) => {
  const label = t(`bot.status.${botStatusKey(group)}`)
  const err = lastErrorOf(group)
  return err ? `${label}：${err}` : label
}

const handleBotCommand = async (group: BotChatGroup, command: string) => {
  const bot = resolveBot(group)
  if (!bot) return
  if (command === 'config') emit('config', bot)
  else if (command === 'qr') emit('qr', bot)
  else if (command === 'delete') await removeBot(bot)
  else if (command === 'toggle') await toggleRunning(bot)
}

/** 名字旁的二维码入口（微信个人号）：与菜单里的「登录二维码」走同一事件 */
const openQrForGroup = (group: BotChatGroup) => {
  const bot = resolveBot(group)
  if (bot) emit('qr', bot)
}

/* ===== 机器人分组拖拽排序（原生 HTML5 DnD，落位语义与 GlobalSidebar 的分组拖拽一致） ===== */
const dragSourceId = ref<string | null>(null)
const dropTargetId = ref<string | null>(null)

/** 「未知机器人」桶不对应任何实例，没有可持久化的顺序 */
const isDraggableGroup = (group: BotChatGroup) => !group.unknownBot

function handleDragStart(event: DragEvent, group: BotChatGroup) {
  if (!isDraggableGroup(group)) return
  dragSourceId.value = group.botId
  emit('dragging-change', true)
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', group.botId)
  }
}

function handleDragOver(event: DragEvent, group: BotChatGroup) {
  if (!dragSourceId.value || !isDraggableGroup(group) || group.botId === dragSourceId.value) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  dropTargetId.value = group.botId
}

function handleDrop(group: BotChatGroup) {
  const sourceId = dragSourceId.value
  if (!sourceId || group.botId === sourceId) return

  const ids = props.groups.filter(isDraggableGroup).map((item) => item.botId)
  const from = ids.indexOf(sourceId)
  const to = ids.indexOf(group.botId)
  if (from !== -1 && to !== -1) {
    ids.splice(to, 0, ids.splice(from, 1)[0])
    emit('reorder', ids)
  }
}

function endDrag() {
  dragSourceId.value = null
  dropTargetId.value = null
  emit('dragging-change', false)
}

const isActive = (conv: BotChatConversation) =>
  conv.sessionId === props.activeSessionId ||
  conv.sessions.some((session) => session.id === props.activeSessionId)

/** 只读流状态：peekStreamStatus 不会在渲染路径创建会话缓存 */
const isStreaming = (sessionId: string) => {
  const status = sessionStore.peekStreamStatus(sessionId)
  return status === 'running' || status === 'pending'
}

const platformLabel = (platform?: string | null) => {
  const key = (platform ?? '').toLowerCase()
  const known = ['qq', 'wechat', 'wechat-personal', 'discord', 'lark', 'wecom']
  return known.includes(key)
    ? t(`bot.platform.${key}`)
    : platform || t('bot.platform.unknown')
}

/** 会话行菜单：pin = 置顶，clear/delete = 清空记录/删除会话，其余 command 即历史会话 id */
const handleConversationCommand = (conv: BotChatConversation, command: string) => {
  if (command === 'pin') {
    void togglePin(conv)
    return
  }
  if (command === 'clear') {
    emit('clearConversation', conv)
    return
  }
  if (command === 'delete') {
    emit('deleteConversation', conv)
    return
  }
  if (command === 'toggle-admin') {
    emit('toggleAdmin', conv)
    return
  }
  emit('select', conv, command)
}

/** 该私聊会话的发送者是否在 Bot 的管理员名单里 */
const isConversationAdmin = (conv: BotChatConversation) => {
  if (!conv.botId || !conv.nativeId) return false
  const bot = botStore.getBotById(conv.botId)
  return (bot?.adminUserIds ?? []).includes(conv.nativeId)
}

/** 置顶写在该用户默认打开的那个会话上，聚合行按「任一会话置顶」判定 */
async function togglePin(conv: BotChatConversation) {
  if (pendingPinKey.value) return
  pendingPinKey.value = conv.key
  try {
    await apiService.updateSession(conv.sessionId, { pinned: !conv.pinned })
  } catch (error) {
    ElMessage.error(getErrorMessage(error) || t('bot.chat.pinFailed'))
    pendingPinKey.value = null
    return
  }
  pendingPinKey.value = null
  emit('changed')
}
</script>

<style scoped>
/* 局部视觉原语：hover / 选中直接复用全局侧边栏 token，保持跨模块一致 */
.bot-chat-sidebar {
  /* ScrollContainer 的 scrollbar-gutter: stable both-edges 已在两侧各留 10px，
     这里只补 2px 才凑成与搜索框一致的 12px 内缩 */
  --bot-gutter: 2px;
  --bot-radius: 9px;
  --bot-duration: 0.16s;
  --bot-ease: cubic-bezier(0.25, 0.1, 0.25, 1);
  --bot-bg-hover: var(--gd-color-sidebar-bg-hover);
  --bot-bg-active: var(--gd-color-sidebar-bg-active);
  --bot-text-hover: var(--gd-color-sidebar-text-hover);
  --bot-focus: color-mix(in srgb, var(--gd-color-primary) 45%, transparent);
  /* 层级线必须半透明：不透明灰压在选中底色上只差 4 级明度，会看不见 */
  --bot-line: color-mix(in srgb, var(--gd-color-text) 12%, transparent);
}

/* 可交互元素统一手型指针：原生 button 默认是箭头，与全局侧栏的 cursor-pointer 对齐 */
.bot-chat-sidebar button:not(:disabled) {
  cursor: pointer;
}

.bot-chat-sidebar button:disabled {
  cursor: not-allowed;
}

.bot-chat-sidebar :deep(.bot-search .el-input__wrapper) {
  height: 30px;
  padding: 0 9px;
  border-radius: 8px;
  background: var(--bot-bg-active);
  box-shadow: 0 0 0 1px transparent inset;
  transition: background-color var(--bot-duration) var(--bot-ease),
    box-shadow var(--bot-duration) var(--bot-ease);
}

.bot-chat-sidebar :deep(.bot-search .el-input__wrapper:hover) {
  background: color-mix(in srgb, var(--gd-color-text) 9%, transparent);
  box-shadow: 0 0 0 1px transparent inset;
}

.bot-chat-sidebar :deep(.bot-search .el-input__wrapper.is-focus) {
  background: var(--gd-color-surface);
  box-shadow: 0 0 0 1px var(--bot-focus) inset;
}

.bot-chat-sidebar :deep(.bot-search .el-input__prefix),
.bot-chat-sidebar :deep(.bot-search .el-input__suffix) {
  color: var(--gd-color-text-gray);
}

.bot-list {
  padding: 4px 0 10px;
}

.bot-group + .bot-group {
  margin-top: 5px;
}

/* 机器人卡片：第一行是折叠热区，第二行搬进原管理页的状态信息 */
.bot-card {
  margin: 0 var(--bot-gutter);
  padding: 6px;
  border-radius: var(--bot-radius);
  transition: background-color var(--bot-duration) var(--bot-ease);
}

.bot-card:hover {
  background: var(--bot-bg-hover);
}

.bot-card.is-dragging {
  opacity: 0.55;
}

.bot-card.is-drop-target {
  background: var(--bot-bg-active);
}

.bot-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.bot-card-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
  color: var(--gd-color-text);
}

/* 菜单触发器作为 flex 子项固定宽度；启停/删除进行中时禁止再次打开 */
.bot-card-more {
  flex-shrink: 0;
  display: flex;
}

.bot-card-more.is-pending {
  pointer-events: none;
  opacity: 0.5;
}

/* 微信个人号二维码入口：常显（不像 ⋯ 只在 hover 出现），登录中高亮提示 */
.bot-card-qr {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: var(--gd-color-text-gray);
  transition: color var(--bot-duration) var(--bot-ease),
    background-color var(--bot-duration) var(--bot-ease);
}

.bot-card-qr:hover {
  background: var(--bot-bg-hover);
  color: var(--gd-color-text);
}

.bot-card-qr.is-pending {
  color: var(--gd-color-warning);
}

.bot-card-kebab {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: var(--gd-color-text-gray);
  opacity: 0;
  transition: opacity var(--bot-duration) var(--bot-ease),
    background-color var(--bot-duration) var(--bot-ease);
}

.bot-card:hover .bot-card-kebab,
.bot-card-kebab:focus-visible {
  opacity: 1;
}

.bot-card-kebab:hover {
  background: var(--bot-bg-active);
}

.bot-card-chevron {
  flex-shrink: 0;
  color: var(--gd-color-text-gray);
  opacity: 0.6;
  transition: opacity var(--bot-duration) var(--bot-ease);
}

.bot-card:hover .bot-card-chevron {
  opacity: 1;
}

/* 第二行整体右移 7px，让状态点落在机器人图标中心轴上，层级线就从这里垂下去 */
.bot-card-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  margin-top: 4px;
  padding-left: 7px;
  font-size: 11px;
  line-height: 16px;
  color: var(--gd-color-text-gray);
}

.meta-item {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 状态点后面不补点号，只在并列的 meta 项之间补 */
.bot-card-meta > :not(.status-dot) + .meta-item::before {
  content: '·';
  opacity: 0.55;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 9999px;
  flex-shrink: 0;
  cursor: help;
}

.status-dot.is-running {
  background: var(--gd-color-success);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--gd-color-success) 18%, transparent);
}

.status-dot.is-connecting {
  background: var(--gd-color-warning);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--gd-color-warning) 18%, transparent);
}

.status-dot.is-error {
  background: var(--gd-color-danger);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--gd-color-danger) 18%, transparent);
}

.status-dot.is-stopped {
  background: color-mix(in srgb, var(--gd-color-text) 24%, transparent);
}

.bot-card-error {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--gd-color-danger);
  cursor: help;
}

.bot-group-empty {
  padding: 5px var(--bot-gutter);
  font-size: 12px;
  line-height: 18px;
  color: var(--gd-color-text-gray);
}

/* 层级线沿用 WorkflowMemberTree 的配方：竖线 + 横肘，1px --gd-color-border */
.bot-children {
  position: relative;
  /* flow-root 收住首尾行的 2px 外边距，下面的 calc 才取得准 */
  display: flow-root;
}

.bot-children::before {
  content: '';
  position: absolute;
  top: 0;
  /* 竖线对齐机器人图标中心（2px 外缩 + 6px 内边距 + 10px 半径），止于最后一个横肘 */
  left: 18px;
  height: calc(100% - 21px);
  border-left: 1px solid var(--bot-line);
}

.conversation-row {
  position: relative;
  display: flex;
  align-items: center;
  margin: 2px var(--bot-gutter);
  padding: 5px 6px 5px 24px;
  border-radius: var(--bot-radius);
  cursor: pointer;
  transition: background-color var(--bot-duration) var(--bot-ease),
    color var(--bot-duration) var(--bot-ease);
}

.conversation-row:hover {
  background: var(--bot-bg-hover);
  color: var(--bot-text-hover);
}

.conversation-row.is-active {
  background: var(--bot-bg-active);
  color: var(--gd-color-sidebar-text-active);
}

/* 横肘从竖线走到头像边缘，仅作层级连接，不参与选中态 */
.conversation-row::after {
  content: '';
  position: absolute;
  top: 18px;
  left: 16px;
  width: 8px;
  height: 1px;
  background: var(--bot-line);
}

.conversation-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0;
  text-align: left;
}

.conversation-name {
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
}

.conversation-row.is-active .conversation-name {
  font-weight: 600;
}

.conversation-time {
  flex-shrink: 0;
  font-size: 11px;
  line-height: 16px;
  color: var(--gd-color-text-gray);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  transition: opacity var(--bot-duration) var(--bot-ease);
}

.conversation-pin {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  color: var(--gd-color-text-gray);
}

.conversation-row.is-active .conversation-time {
  color: var(--gd-color-text);
  opacity: 0.75;
}

.conversation-badge {
  flex-shrink: 0;
  padding: 0 4px;
  border-radius: 4px;
  border: 1px solid color-mix(in srgb, var(--gd-color-primary) 26%, transparent);
  font-size: 10px;
  line-height: 14px;
  color: var(--gd-color-primary);
  background: var(--gd-color-primary-100);
}

.streaming-dot {
  width: 6px;
  height: 6px;
  flex-shrink: 0;
  border-radius: 9999px;
  background: var(--gd-color-primary);
  animation: bot-stream-pulse 1.2s ease-in-out infinite;
}

@keyframes bot-stream-pulse {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.85);
  }
  50% {
    opacity: 1;
    transform: scale(1);
  }
}

/* ⋯ 脱离文档流，盖在时间戳的槽位上（right 6px = 行右内边距），两者共用同一块空间 */
.conversation-row .conversation-more {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--bot-duration) var(--bot-ease);
}

/* 时间戳先让位，⋯ 迟一拍再进来，避免两者交叠成一团 */
.conversation-row:hover .conversation-more,
.conversation-row:focus-within .conversation-more {
  opacity: 1;
  pointer-events: auto;
  transition-delay: 0.06s;
}

.conversation-row:hover .conversation-time,
.conversation-row:focus-within .conversation-time {
  opacity: 0;
}

.history-trigger {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: var(--gd-color-text-gray);
  transition: color var(--bot-duration) var(--bot-ease);
}

/* 与全局侧栏一致：hover 只改文字/图标色（深色主题下为浅白），不加边框或底色 */
.history-trigger:hover {
  color: var(--bot-text-hover);
}

.load-more {
  display: block;
  margin: 3px var(--bot-gutter) 0;
  padding: 5px 12px;
  border-radius: var(--bot-radius);
  font-size: 12px;
  color: var(--gd-color-primary);
  text-align: center;
  transition: background-color var(--bot-duration) var(--bot-ease);
}

.load-more:hover {
  background: var(--bot-bg-hover);
}

.bot-side-foot {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
}

.bot-add {
  flex: 1;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--gd-color-primary) 22%, transparent);
  font-size: 12px;
  font-weight: 500;
  color: var(--gd-color-primary);
  background: var(--gd-color-primary-100);
  cursor: pointer;
  transition: background-color var(--bot-duration) var(--bot-ease);
}

.bot-add:hover {
  background: color-mix(in srgb, var(--gd-color-primary) 14%, var(--gd-color-surface));
}

.bot-docs {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: var(--gd-color-text-gray);
  cursor: pointer;
  transition: background-color var(--bot-duration) var(--bot-ease),
    color var(--bot-duration) var(--bot-ease);
}

.bot-docs:hover {
  background: var(--bot-bg-hover);
  color: var(--gd-color-text);
}

.bot-card:focus-visible,
.bot-card-kebab:focus-visible,
.conversation-main:focus-visible,
.history-trigger:focus-visible,
.load-more:focus-visible,
.bot-add:focus-visible,
.bot-docs:focus-visible {
  outline: 2px solid var(--bot-focus);
  outline-offset: -2px;
}
</style>
