<template>
  <div
    class="bot-card flex flex-col overflow-hidden p-2.5 rounded-[var(--size-surface-radius)] border border-(--color-surface-border) bg-(--color-surface) transition-all hover:bg-(--color-surface-hover) hover:shadow-sm">
    <!-- Header: icon + name + platform tag -->
    <div class="flex items-center gap-2.5 mb-3">
      <div
        class="w-8 h-8 rounded-[var(--size-surface-radius)] shrink-0 flex items-center justify-center bg-gray-50 dark:bg-[#2a2c30] overflow-hidden">
        <img :src="getPlatformAvatar(bot.platform)" :alt="getPlatformName(bot.platform)"
          class="w-full h-full object-contain p-1" @error="handleImageError" />
      </div>
      <h3 class="font-semibold text-gray-900 dark:text-[#e8e9ed] truncate flex-1 min-w-0" style="font-size: var(--size-text-sm);"
        :title="bot.name">
        {{ bot.name }}
      </h3>
      <el-tag size="small" effect="plain">{{ getPlatformName(bot.platform) }}</el-tag>
    </div>

    <!-- Description: status info -->
    <div class="flex items-center gap-2 h-[2.5rem]" style="font-size: calc(var(--size-text-base) - 2px);">
      <el-tag :type="getStatusType(bot.status, bot.runtimeStatus)" size="small" effect="plain">
        {{ getStatusText(bot.status, bot.runtimeStatus) }}
      </el-tag>
      <LTooltip v-if="bot.lastError" :content="bot.lastError" placement="top" effect="dark">
        <span class="text-xs text-red-500 truncate flex-1 cursor-help">
          {{ bot.lastError }}
        </span>
      </LTooltip>
    </div>

    <!-- Footer: action buttons + switch -->
    <div class="flex items-center justify-end gap-2 mt-3">
      <el-button v-if="bot.platform === 'wechat-personal'" link size="small" @click="handleShowQrCode">
        {{ t('bot.card.qrCode') }}
      </el-button>
      <el-button link size="small" @click="$emit('edit', bot)">
        {{ t('bot.card.edit') }}
      </el-button>
      <el-button link size="small" type="danger" @click="$emit('delete', bot)">
        {{ t('bot.card.delete') }}
      </el-button>
      <el-switch :model-value="bot.status === 'running'" :loading="isOperating" @update:model-value="handleToggle"
        size="small" inline-prompt :active-text="t('bot.card.enable')" :inactive-text="t('bot.card.disable')" />
    </div>
  </div>

  <!-- 二维码弹窗 -->
  <el-dialog v-model="qrDialogVisible" :title="t('bot.card.qrTitle')" width="360px" align-center>
    <div class="flex flex-col items-center py-4">
      <div v-if="qrLoading" class="py-8">
        <el-icon class="is-loading" :size="32">
          <Loading />
        </el-icon>
      </div>
      <!-- 已登录 -->
      <div v-else-if="qrStatus === 'logged_in'" class="flex flex-col items-center py-4">
        <el-icon :size="48" class="text-green-500 mb-3">
          <CircleCheck />
        </el-icon>
        <p class="text-sm text-gray-600">{{ qrMessage }}</p>
        <el-button type="danger" size="small" class="mt-4" @click="handleLogout">
          <el-icon>
            <SwitchButton />
          </el-icon>
          <span class="ml-1">{{ t('bot.card.logout') }}</span>
        </el-button>
      </div>
      <!-- 二维码生成中 -->
      <div v-else-if="qrStatus === 'pending'" class="flex flex-col items-center py-4">
        <el-icon :size="32" class="text-orange-400 mb-3">
          <Timer />
        </el-icon>
        <p class="text-sm text-gray-600">{{ qrMessage }}</p>
      </div>
      <!-- 二维码可用 -->
      <div v-else-if="qrStatus === 'qr_ready'" class="w-full flex flex-col items-center">
        <img :src="qrImageUrl" alt="微信登录二维码" class="w-64 h-64" />
        <p class="text-xs text-gray-400 mt-3 text-center">
          {{ t('bot.card.qrReadyHint') }}
        </p>
        <el-button size="small" class="mt-3" @click="handleRefreshQrCode">
          <el-icon><Refresh /></el-icon>
          <span class="ml-1">{{ t('bot.card.refreshQr') }}</span>
        </el-button>
      </div>
      <!-- 不可用 -->
      <div v-else class="text-sm text-gray-400 py-8">
        {{ qrMessage || t('bot.card.qrUnavailable') }}
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleCheck, Timer, SwitchButton, Refresh } from '@element-plus/icons-vue'
import { ElMessage, ElIcon } from 'element-plus'
import type { BotInstance } from '@/types/bot'
import { fixFrontendAssetUrl } from '@/utils/url'
import { apiService } from '@/services/ApiService'
import LTooltip from '@/components/ui/LTooltip.vue'

const props = defineProps<{
  bot: BotInstance
}>()

const emit = defineEmits<{
  edit: [bot: BotInstance]
  delete: [bot: BotInstance]
  start: [id: string]
  stop: [id: string]
}>()

const { t } = useI18n()

// 判断是否正在操作中
const isOperating = computed(() => {
  return props.bot.runtimeStatus === 'CONNECTING'
})

// 处理开关切换
const handleToggle = (val: string | number | boolean) => {
  if (val) {
    emit('start', props.bot.id)
  } else {
    emit('stop', props.bot.id)
  }
}

// 二维码弹窗状态
const qrDialogVisible = ref(false)
const qrStatus = ref<'qr_ready' | 'logged_in' | 'pending' | 'unavailable'>('unavailable')
const qrCodeUrl = ref('')
const qrMessage = ref('')
const qrLoading = ref(false)
let qrPollTimer: ReturnType<typeof setInterval> | null = null

// 二维码图片 URL（使用 qrserver API 生成）
const qrImageUrl = computed(() => {
  if (!qrCodeUrl.value) return ''
  return `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrCodeUrl.value)}`
})

// 获取二维码状态
const fetchQrStatus = async () => {
  try {
    const result = await apiService.fetchBotQrCode(props.bot.id)
    qrStatus.value = result.status
    if (result.status === 'qr_ready') {
      qrCodeUrl.value = result.qrCodeUrl
    } else {
      qrMessage.value = result.message || ''
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || t('bot.card.getQrFailed'))
  }
}

// 显示二维码弹窗
const handleShowQrCode = async () => {
  qrDialogVisible.value = true
  qrLoading.value = true
  qrStatus.value = 'unavailable'
  qrCodeUrl.value = ''
  qrMessage.value = ''
  await fetchQrStatus()
  qrLoading.value = false
}

// 弹窗打开时启动轮询，关闭时停止
watch(qrDialogVisible, (visible) => {
  if (visible) {
    qrPollTimer = setInterval(fetchQrStatus, 5_000)
  } else if (qrPollTimer) {
    clearInterval(qrPollTimer)
    qrPollTimer = null
  }
})

// 手动刷新二维码
const handleRefreshQrCode = async () => {
  qrLoading.value = true
  qrStatus.value = 'unavailable'
  qrCodeUrl.value = ''
  qrMessage.value = ''
  await fetchQrStatus()
  qrLoading.value = false
}

// 退出登录
const handleLogout = async () => {
  try {
    const result = await apiService.logoutBot(props.bot.id)
    if (result.success) {
      ElMessage.success(result.message)
      qrDialogVisible.value = false
      // 退出登录后自动停止机器人
      await apiService.stopBotInstance(props.bot.id)
      emit('stop', props.bot.id)
    } else {
      ElMessage.warning(result.message)
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || t('bot.card.logoutFailed'))
  }
}

// 获取平台头像路径
const getPlatformAvatar = (platform: string) => {
  const avatarMap: Record<string, string> = {
    qq: '/images/bots/qq.png',
    wechat: '/images/bots/wechat.png',
    'wechat-personal': '/images/bots/wechat.png',
    discord: '/images/bots/discord.svg',
    dingtalk: '/images/bots/dingtalk.svg',
    lark: '/images/bots/lark.png',
    wecom: '/images/bots/wecom-bot.png'
  }
  const path = avatarMap[platform] || '/images/bots/qq.png'
  return fixFrontendAssetUrl(path)
}

// 图片加载失败处理
const handleImageError = (e: Event) => {
  const target = e.target as HTMLImageElement
  target.style.display = 'none'
  const parent = target.parentElement
  if (parent) {
    parent.innerHTML = '<div class="text-gray-400 text-xs">BOT</div>'
  }
}

// 获取平台名称
const getPlatformName = (platform: string) => {
  const knownPlatforms = ['qq', 'wechat', 'wechat-personal', 'discord', 'lark', 'wecom']
  return knownPlatforms.includes(platform) ? t(`bot.platform.${platform}`) : platform
}

// 获取状态类型
const getStatusType = (status: string, runtimeStatus: string | null): 'primary' | 'success' | 'info' | 'warning' | 'danger' => {
  if (status === 'stopped') return 'info'
  if (runtimeStatus === 'ERROR' || status === 'error') return 'danger'
  if (runtimeStatus === 'CONNECTING') return 'warning'
  if (runtimeStatus === 'CONNECTED') return 'success'
  return 'info'
}

// 获取状态文本
const getStatusText = (status: string, runtimeStatus: string | null) => {
  if (status === 'stopped') return t('bot.status.stopped')
  if (runtimeStatus === 'ERROR') return t('bot.status.error')
  if (runtimeStatus === 'CONNECTING') return t('bot.status.connecting')
  if (runtimeStatus === 'CONNECTED') return t('bot.status.running')
  return status === 'running' ? t('bot.status.running') : t('bot.status.unknown')
}
</script>

<style scoped>
</style>
