<template>
  <div
    class="bot-card group relative bg-white dark:bg-[#232428] border border-gray-200 dark:border-[#232428] rounded-lg p-4 cursor-default hover:border-(--color-primary) transition-all duration-200 overflow-hidden">
    <!-- 内容区域 -->
    <div class="relative z-10 flex flex-col h-full">
      <!-- 头部：平台图标 + 名称 + 开关 -->
      <div class="flex items-start gap-3">
        <div class="w-11 h-11 shrink-0 flex items-center justify-center bg-gray-50 dark:bg-[#2a2c30] rounded-md overflow-hidden">
          <img :src="getPlatformAvatar(bot.platform)" :alt="getPlatformName(bot.platform)"
            class="w-full h-full object-contain p-1" @error="handleImageError" />
        </div>
        <div class="flex-1 min-w-0">
          <div class="font-medium text-base text-gray-900 dark:text-[#e8e9ed] truncate" :title="bot.name">{{ bot.name }}</div>
          <div class="text-xs text-gray-500 dark:text-[#8b8d95] mt-1">{{ getPlatformName(bot.platform) }}</div>
        </div>
        <!-- 启用开关 -->
        <el-switch :model-value="bot.status === 'running'" :loading="isOperating" @update:model-value="handleToggle"
          inline-prompt active-text="启动" inactive-text="禁用" size="large" class="shrink-0 ml-2" />
      </div>

      <!-- 状态信息 -->
      <div class="flex items-center gap-2 mt-6">
        <el-tag :type="getStatusType(bot.status, bot.runtimeStatus)" size="small">
          {{ getStatusText(bot.status, bot.runtimeStatus) }}
        </el-tag>
        <el-tooltip v-if="bot.lastError" :content="bot.lastError" placement="top" effect="dark">
          <span class="text-xs text-red-500 truncate flex-1 cursor-help">
            {{ bot.lastError }}
          </span>
        </el-tooltip>
      </div>

      <!-- 底部操作按钮 -->
      <div class="mt-4 flex gap-2">
        <!-- 编辑按钮 -->
        <el-button size="small" @click="$emit('edit', bot)">
          <el-icon><Edit /></el-icon>
          <span>编辑</span>
        </el-button>

        <!-- 删除按钮 -->
        <el-button size="small" type="danger" @click="$emit('delete', bot)">
          <el-icon><Delete /></el-icon>
          <span>删除</span>
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Edit, Delete } from '@element-plus/icons-vue'
import type { BotInstance } from '@/types/bot'
import { fixFrontendAssetUrl } from '@/utils/url'

const props = defineProps<{
  bot: BotInstance
}>()

const emit = defineEmits<{
  edit: [bot: BotInstance]
  delete: [bot: BotInstance]
  start: [id: string]
  stop: [id: string]
}>()

// 判断是否正在操作中
const isOperating = computed(() => {
  return props.bot.runtimeStatus === 'CONNECTING'
})

// 处理开关切换
const handleToggle = (enabled: boolean) => {
  if (enabled) {
    emit('start', props.bot.id)
  } else {
    emit('stop', props.bot.id)
  }
}

// 获取平台头像路径
const getPlatformAvatar = (platform: string) => {
  const avatarMap: Record<string, string> = {
    qq: '/images/bots/qq.png',
    wechat: '/images/bots/wechat.png',
    discord: '/images/bots/discord.svg',
    dingtalk: '/images/bots/dingtalk.svg',
    lark: '/images/bots/lark.png',
    wecom: '/images/bots/wecom-bot.png'
  }
  const path = avatarMap[platform] || '/images/bots/qq.png' // 默认使用 QQ 头像
  return fixFrontendAssetUrl(path)
}

// 图片加载失败处理
const handleImageError = (e: Event) => {
  const target = e.target as HTMLImageElement
  // 加载失败时显示默认图标
  target.style.display = 'none'
  const parent = target.parentElement
  if (parent) {
    parent.innerHTML = '<div class="text-gray-400 text-xs">BOT</div>'
  }
}

// 获取平台名称
const getPlatformName = (platform: string) => {
  const nameMap: Record<string, string> = {
    qq: 'QQ 机器人',
    wechat: '微信机器人',
    discord: 'Discord Bot',
    wecom: '企业微信智能机器人'
  }
  return nameMap[platform] || platform
}

// 获取状态类型
const getStatusType = (status: string, runtimeStatus: string | null) => {
  if (status === 'stopped') return 'info'
  if (runtimeStatus === 'ERROR' || status === 'error') return 'danger'
  if (runtimeStatus === 'CONNECTING') return 'warning'
  if (runtimeStatus === 'CONNECTED') return 'success'
  return 'info'
}

// 获取状态文本
const getStatusText = (status: string, runtimeStatus: string | null) => {
  if (status === 'stopped') return '已停止'
  if (runtimeStatus === 'ERROR') return '错误'
  if (runtimeStatus === 'CONNECTING') return '连接中'
  if (runtimeStatus === 'CONNECTED') return '运行中'
  return status === 'running' ? '运行中' : '未知'
}

// 格式化时间
const formatTime = (timeStr: string) => {
  const date = new Date(timeStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()

  // 小于1分钟
  if (diff < 60000) {
    return '刚刚'
  }
  // 小于1小时
  if (diff < 3600000) {
    return `${Math.floor(diff / 60000)}分钟前`
  }
  // 小于24小时
  if (diff < 86400000) {
    return `${Math.floor(diff / 3600000)}小时前`
  }
  // 超过24小时，显示日期
  return date.toLocaleDateString('zh-CN')
}
</script>

<style scoped>
.bot-card {
  min-height: 140px;
}
</style>
