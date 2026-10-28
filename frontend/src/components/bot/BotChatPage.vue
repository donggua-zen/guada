<template>
  <div class="h-full min-h-0 flex flex-col overflow-hidden">
    <PageHeader :title="titleText">
      <template #title-actions>
        <button
          v-if="isNarrow && activeSessionId"
          type="button"
          class="header-icon-btn"
          :title="t('bot.chat.back')"
          @click="handleBack"
        >
          <el-icon :size="18"><ArrowLeft /></el-icon>
        </button>
        <span v-if="activeSessionId && !isNarrow" class="title-divider"></span>
        <BotConversationTitleInfo
          v-if="activeSessionId"
          :detail="activeDetail"
          :session="activeSession"
          :conversation="activeConversation"
          :display-name="displayName"
          :avatar-url="activeConversation?.avatarUrl ?? null"
        />
      </template>
    </PageHeader>

    <div class="flex-1 min-h-0 flex overflow-hidden">
      <!-- 内部二级侧边栏：只在机器人页内容区内出现，不占用 GlobalSidebar -->
      <BotConversationSidebar
        v-if="!isNarrow || !activeSessionId"
        :groups="groups"
        :active-session-id="activeSessionId"
        :loading="loading"
        :error="error"
        :has-bots="hasBots"
        :class="isNarrow ? 'w-full' : 'w-[280px] shrink-0'"
        @select="selectConversation"
        @clear-conversation="handleClear"
        @delete-conversation="handleDelete"
        @retry="loadGroups()"
        @load-more="handleLoadMore"
        @create="openCreate"
        @config="openConfig"
        @qr="openQr"
        @docs="openDocs"
        @changed="loadGroups(false)"
        @reorder="handleReorder"
        @dragging-change="suspendingBackgroundRefresh = $event"
      />

      <!-- 右侧复用现成的 ChatPanel；窄屏时与列表二选一 -->
      <BotConversationPanel
        v-if="!isNarrow || activeSessionId"
        ref="conversationPanelRef"
        :detail="activeDetail"
        :session="activeSession"
        :loading="detailLoading"
        :error="detailError"
        :send-handler="sendHandler"
        @refresh="handleRefresh"
      />
    </div>

    <!-- 机器人创建/配置弹窗与微信登录二维码，原先挂在管理页 -->
    <BotModal v-model="modalVisible" :bot="editingBot" @saved="handleBotSaved" />
    <BotQrDialog ref="qrDialogRef" @stopped="handleBotChanged" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import { ElIcon, ElMessage } from 'element-plus'
import { ArrowLeft } from '@element-plus/icons-vue'
import { apiService } from '@/services/ApiService'
import { useSessionStore } from '@/stores/session'
import { useBotStore } from '@/stores/bot'
import { usePopup } from '@/composables/usePopup'
import { useBotLiveSync } from '@/composables/useBotLiveSync'
import { getApiErrorStatus, getErrorMessage } from '@/utils/errorMessage'
import { openInExternalBrowser } from '@/utils/browserUtils'
import PageHeader from '@/components/PageHeader.vue'
import BotConversationTitleInfo from './BotConversationTitleInfo.vue'
import BotConversationSidebar from './BotConversationSidebar.vue'
import BotConversationPanel from './BotConversationPanel.vue'
import BotModal from './BotModal.vue'
import BotQrDialog from './BotQrDialog.vue'
import type { BotChatConversation, BotChatGroup, BotInstance, BotSessionDetail } from '@/types/bot'
import type { Session } from '@/types/session'
import type { ChatStreamParams, ChatStreamResponse } from '@/services/modules/ChatStreamService'

const { t } = useI18n()
const sessionStore = useSessionStore()
const botStore = useBotStore()
const { confirm } = usePopup()

/**
 * 窄屏只用宽度判断：列表/聊天两态切换。
 * 不用 useMediaQuery —— 部分宿主（含无头浏览器视口切换）不会派发 matchMedia 变更事件。
 */
const NARROW_MAX_WIDTH = 1024
const isNarrow = ref(
  typeof window !== 'undefined' && window.innerWidth < NARROW_MAX_WIDTH,
)

const groups = ref<BotChatGroup[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const perBotLimit = ref(200)

/** 上次打开的 Bot 会话：刷新/重进页面时恢复，避免每次重新选择 */
const lastBotSessionId = useStorage('botLastSelectedSessionId', '')

const activeSessionId = ref<string | null>(null)
const activeDetail = ref<BotSessionDetail | null>(null)
const detailLoading = ref(false)
const detailError = ref<string | null>(null)

const conversationPanelRef = ref<InstanceType<typeof BotConversationPanel> | null>(null)
const qrDialogRef = ref<InstanceType<typeof BotQrDialog> | null>(null)
const modalVisible = ref(false)
const editingBot = ref<BotInstance | null>(null)
/** 拖拽机器人分组期间挂起后台刷新，否则列表中途重排会让拖拽目标错位 */
const suspendingBackgroundRefresh = ref(false)

/** 进入页面前主聊天选中的会话；离开时恢复，避免把全局 activeSessionId 永久改到 Bot 会话 */
const previousActiveSessionId = sessionStore.activeSessionId
let lastAppliedActiveId: string | null = null
let detailRequestToken = 0
let refreshTimer: number | undefined
/** 防止事件驱动的刷新与手动/操作后刷新并发，乱序响应覆盖新数据 */
let groupsLoading = false
let groupsDirty = false

const hasBots = computed(
  () => botStore.botInstances.length > 0 || groups.value.some((group) => !group.unknownBot),
)

const activeSession = computed<Session | null>(() => {
  const id = activeSessionId.value
  return id ? sessionStore.getSession(id) ?? null : null
})

const activeConversation = computed<BotChatConversation | null>(() => {
  const id = activeSessionId.value
  if (!id) return null
  for (const group of groups.value) {
    const conversation = group.conversations.find(
      (item) =>
        item.sessionId === id ||
        item.sessions.some((session) => session.id === id),
    )
    if (conversation) return conversation
  }
  return null
})

const displayName = computed(
  () =>
    activeConversation.value?.displayName ||
    activeDetail.value?.session?.title ||
    t('bot.sessions.unnamedSession'),
)

/** 窄屏进入会话后把标题位让给会话信息（返回按钮 + 头像 + 名称） */
const titleText = computed(() =>
  isNarrow.value && activeSessionId.value ? '' : t('bot.center.title'),
)

async function loadGroups(showLoading = true) {
  if (showLoading) loading.value = true
  // 事件可能在一轮对话里连续触发刷新：进行中的请求结束后补跑最后一次即可
  if (groupsLoading) {
    groupsDirty = true
    return
  }
  groupsLoading = true
  error.value = null
  try {
    const response = await apiService.fetchBotChatGroups(perBotLimit.value)
    groups.value = response.groups ?? []
  } catch (err) {
    error.value = getErrorMessage(err) || t('bot.chat.loadFailed')
  } finally {
    groupsLoading = false
    loading.value = false
    if (groupsDirty) {
      groupsDirty = false
      void loadGroups(false)
    }
  }
}

async function loadDetail(
  sessionId: string,
  options: { restore?: boolean } = {},
) {
  detailLoading.value = true
  detailError.value = null
  const token = ++detailRequestToken
  try {
    const detail = await apiService.fetchBotSessionDetail(sessionId)
    if (token !== detailRequestToken) return
    activeDetail.value = detail
    sessionStore.mergeSession(detail.session)
    lastAppliedActiveId = sessionId
    sessionStore.activeSessionId = sessionId
    lastBotSessionId.value = sessionId
  } catch (err) {
    if (token !== detailRequestToken) return
    activeDetail.value = null
    const status = getApiErrorStatus(err)
    // 会话已删除（404）/ 非 bot 会话（400）：记忆已失效，清掉避免每次进页面都失败
    if (status === 404 || status === 400) {
      lastBotSessionId.value = ''
    }
    if (options.restore) {
      // 自动恢复是尽力而为：失败静默退回列表；网络错误保留记忆，下次重进再试
      activeSessionId.value = null
      detailError.value = null
      return
    }
    detailError.value = getErrorMessage(err) || t('bot.chat.loadFailed')
  } finally {
    if (token === detailRequestToken) detailLoading.value = false
  }
}

/** 挂载时打开上次选中的会话；失败按 restore 分支静默回落，不阻塞列表 */
async function restoreLastSession() {
  if (activeSessionId.value) return
  const raw = lastBotSessionId.value
  if (typeof raw !== 'string') return
  const sessionId = raw.trim()
  if (!sessionId) return
  activeSessionId.value = sessionId
  await loadDetail(sessionId, { restore: true })
}

async function selectConversation(
  conversation: BotChatConversation,
  sessionId?: string,
) {
  const targetId = sessionId || conversation.sessionId
  if (!targetId) return
  if (
    targetId === activeSessionId.value &&
    activeDetail.value &&
    !detailError.value
  ) {
    return
  }
  activeSessionId.value = targetId
  await loadDetail(targetId)
}

/** ChatPanel 的自定义发送入口：写 Bot 会话，不经过 /chat/stream */
const sendHandler = async (
  params: ChatStreamParams,
): Promise<ChatStreamResponse> => {
  const sessionId = activeSessionId.value
  if (!sessionId) throw new Error('No active session')
  try {
    return await apiService.sendBotSessionMessage(sessionId, {
      content: params.userMessage?.content ?? '',
      files: params.userMessage?.files,
      knowledgeBaseIds: params.userMessage?.knowledgeBaseIds,
      replaceTurnId: params.userMessage?.replaceTurnId,
      settingsOverride: params.settingsOverride as
        | Record<string, unknown>
        | undefined,
    })
  } catch (err) {
    // 请求在建立流之前失败时不会有 SSE 事件回收 pending，这里主动复位
    sessionStore.setStreamStatus(sessionId, 'idle')
    throw err
  }
}

async function handleRefresh() {
  await loadGroups(false)
  const sessionId = activeSessionId.value
  if (!sessionId) return
  await loadDetail(sessionId)
  await conversationPanelRef.value?.reload()
}

/** 清空指定会话（侧栏会话行菜单）；未传时回退到当前打开会话 */
async function handleClear(conversation?: BotChatConversation) {
  const sessionId = conversation?.sessionId ?? activeSessionId.value
  if (!sessionId) return
  const ok = await confirm(
    t('bot.chat.clearTitle'),
    t('bot.chat.clearConfirm', {
      name: conversation?.displayName || displayName.value,
    }),
    {
      confirmText: t('common.ok'),
      cancelText: t('common.cancel'),
      type: 'warning',
    },
  )
  if (!ok) return

  try {
    await apiService.clearSessionMessages(sessionId)
    ElMessage.success(t('bot.chat.clearSuccess'))
    if (sessionId === activeSessionId.value) {
      await conversationPanelRef.value?.reload()
    }
    await loadGroups(false)
  } catch (err) {
    console.error('清空 Bot 会话消息失败:', err)
    ElMessage.error(t('bot.chat.clearFailed'))
  }
}

/** 删除指定会话（侧栏会话行菜单）；未传时回退到当前打开会话 */
async function handleDelete(conversation?: BotChatConversation) {
  const sessionId = conversation?.sessionId ?? activeSessionId.value
  if (!sessionId) return
  const ok = await confirm(
    t('bot.chat.deleteTitle'),
    t('bot.chat.deleteConfirm', {
      name: conversation?.displayName || displayName.value,
    }),
    {
      confirmText: t('common.ok'),
      cancelText: t('common.cancel'),
      type: 'warning',
    },
  )
  if (!ok) return

  try {
    await apiService.deleteSession(sessionId)
    sessionStore.removeSession(sessionId)
    // 删除的正是记忆中的会话（含窄屏下列表视图、当前无选中会话的情况）
    if (lastBotSessionId.value === sessionId) {
      lastBotSessionId.value = ''
    }
    if (activeSessionId.value === sessionId) {
      handleBack()
    }
    ElMessage.success(t('bot.chat.deleteSuccess'))
    await loadGroups(false)
  } catch (err) {
    console.error('删除 Bot 会话失败:', err)
    ElMessage.error(t('bot.chat.deleteFailed'))
  }
}

function handleBack() {
  // 用户明确返回列表：不再自动打开上次的会话
  lastBotSessionId.value = ''
  detailRequestToken++
  activeSessionId.value = null
  activeDetail.value = null
  detailError.value = null
  detailLoading.value = false
  if (
    lastAppliedActiveId &&
    sessionStore.activeSessionId === lastAppliedActiveId
  ) {
    sessionStore.activeSessionId = previousActiveSessionId
    lastAppliedActiveId = null
  }
}

async function handleLoadMore() {
  perBotLimit.value = Math.min(perBotLimit.value + 200, 1000)
  await loadGroups(false)
}

function openCreate() {
  editingBot.value = null
  modalVisible.value = true
}

function openConfig(bot: BotInstance) {
  editingBot.value = bot
  modalVisible.value = true
}

function openQr(bot: BotInstance) {
  qrDialogRef.value?.open(bot.id)
}

function openDocs() {
  openInExternalBrowser('https://ai.dingd.cn/docs/bot')
}

/** 机器人增删改/启停后，groups 里的 online 与 botInstances 都要重新对齐 */
async function handleBotChanged() {
  await Promise.all([botStore.loadBotInstances(), loadGroups(false)])
}

async function handleBotSaved() {
  modalVisible.value = false
  editingBot.value = null
  await handleBotChanged()
}

/** 后台兜底刷新：拖拽进行中一律跳过 */
function refreshInBackground() {
  if (suspendingBackgroundRefresh.value) return
  void loadGroups(false)
}

/** 乐观重排 + 失败回滚；后端 reorder 会补齐未列出的实例，故 orderedIds 只含已知机器人 */
async function handleReorder(orderedIds: string[]) {
  const previous = groups.value
  const rank = new Map(orderedIds.map((id, index) => [id, index]))
  const rankOf = (group: BotChatGroup) =>
    group.unknownBot ? Number.MAX_SAFE_INTEGER : rank.get(group.botId) ?? 0
  groups.value = [...previous].sort((a, b) => rankOf(a) - rankOf(b))

  try {
    await apiService.reorderBotInstances(orderedIds)
  } catch (err) {
    groups.value = previous
    ElMessage.error(getErrorMessage(err) || t('bot.chat.reorderFailed'))
  }
}

function handleWindowFocus() {
  refreshInBackground()
}

function handleResize() {
  isNarrow.value = window.innerWidth < NARROW_MAX_WIDTH
}

/**
 * 实时同步：SSE 事件只做唤醒，分组仍由 chat-groups 全量聚合（防抖合并）。
 * 拖拽排序期间挂起，结束后补一次；机器人状态事件同时更新打开中的会话头部。
 */
const { cleanup: cleanupBotLiveSync } = useBotLiveSync({
  onSessionsChanged: () => void loadGroups(false),
  isSuspended: () => suspendingBackgroundRefresh.value,
  onBotStatus: (payload) => {
    const bot = activeDetail.value?.bot
    if (!bot || !payload.botId || bot.id !== payload.botId) return
    if (payload.runtimeStatus !== undefined) {
      bot.runtimeStatus = payload.runtimeStatus
      bot.online = payload.runtimeStatus.toLowerCase() === 'connected'
    }
  },
})

/** 卡片状态列要 join botInstances，创建弹窗要 platforms —— 原先都由管理页负责加载 */
async function loadBotMetadata() {
  try {
    await Promise.all([
      botStore.platforms.length ? null : botStore.loadPlatforms(),
      botStore.botInstances.length ? null : botStore.loadBotInstances(),
    ])
  } catch {
    // store 内部已提示，这里只负责不阻塞会话列表
  }
}

onMounted(() => {
  handleResize()
  void loadBotMetadata()
  void loadGroups()
  void restoreLastSession()
  // 实时更新由 useBotLiveSync 的 SSE 订阅负责；低频轮询只兜底任何遗漏的「只改库不发事件」
  refreshTimer = window.setInterval(() => {
    if (document.hidden) return
    refreshInBackground()
    void botStore.loadBotInstances({ silent: true }).catch(() => {})
  }, 60000)
  window.addEventListener('focus', handleWindowFocus)
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  if (refreshTimer) window.clearInterval(refreshTimer)
  cleanupBotLiveSync()
  window.removeEventListener('focus', handleWindowFocus)
  window.removeEventListener('resize', handleResize)
  if (
    lastAppliedActiveId &&
    sessionStore.activeSessionId === lastAppliedActiveId
  ) {
    sessionStore.activeSessionId = previousActiveSessionId
  }
})
</script>

<style scoped>
/* 标题与会话信息之间的细分隔线（仅宽屏；窄屏标题位让给会话信息） */
.title-divider {
  width: 1px;
  height: 16px;
  flex-shrink: 0;
  margin: 0 4px;
  background: var(--gd-color-border);
}
</style>
