<template>
  <GdDialog v-model="visible" :title="t('bot.card.qrTitle')" size="xs" align-center>
    <div class="flex flex-col items-center py-4">
      <div v-if="loading" class="py-8">
        <el-icon :size="32">
          <ArrowSync16Regular class="animate-spin" />
        </el-icon>
      </div>

      <!-- 已登录 -->
      <div v-else-if="status === 'logged_in'" class="flex flex-col items-center py-4">
        <el-icon :size="48" class="text-green-500 mb-3">
          <CheckmarkCircle48Regular />
        </el-icon>
        <p class="text-sm text-gray-600">{{ message }}</p>
        <GdButton type="danger" size="small" class="mt-4" @click="handleLogout">
          <el-icon><Power20Regular /></el-icon>
          <span class="ml-1">{{ t('bot.card.logout') }}</span>
        </GdButton>
      </div>

      <!-- 二维码生成中 -->
      <div v-else-if="status === 'pending'" class="flex flex-col items-center py-4">
        <el-icon :size="32" class="text-orange-400 mb-3">
          <Timer32Regular />
        </el-icon>
        <p class="text-sm text-gray-600">{{ message }}</p>
      </div>

      <!-- 二维码可用 -->
      <div v-else-if="status === 'qr_ready'" class="w-full flex flex-col items-center">
        <img :src="qrImageUrl" alt="微信登录二维码" class="w-64 h-64" />
        <p class="text-xs text-gray-400 mt-3 text-center">
          {{ t('bot.card.qrReadyHint') }}
        </p>
        <GdButton size="small" class="mt-3" @click="refresh">
          <el-icon><ArrowClockwise16Regular /></el-icon>
          <span class="ml-1">{{ t('bot.card.refreshQr') }}</span>
        </GdButton>
      </div>

      <!-- 需要数字配对码 -->
      <div v-else-if="status === 'verify_code_required'" class="w-full flex flex-col items-center">
        <img v-if="qrImageUrl" :src="qrImageUrl" alt="微信登录二维码" class="w-48 h-48" />
        <p class="text-xs text-gray-500 mt-3 text-center">
          {{ message || t('bot.card.qrVerifyCodeHint') }}
        </p>
        <GdInput
          v-model="verifyCode"
          class="mt-3"
          maxlength="8"
          inputmode="numeric"
          clearable
          :placeholder="t('bot.card.qrVerifyCodePlaceholder')"
          @keyup.enter="submitVerifyCode"
        />
        <GdButton
          type="primary"
          size="small"
          class="mt-3"
          :loading="verifySubmitting"
          @click="submitVerifyCode"
        >
          {{ t('bot.card.qrVerifyCodeSubmit') }}
        </GdButton>
      </div>

      <!-- 不可用 -->
      <div v-else class="text-sm text-gray-400 py-8">
        {{ message || t('bot.card.qrUnavailable') }}
      </div>
    </div>
  </GdDialog>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { CheckmarkCircle48Regular, Timer32Regular, Power20Regular, ArrowSync16Regular, ArrowClockwise16Regular } from '@vicons/fluent'
import { ElIcon } from 'element-plus';
import GdButton from '@/components/ui/GdButton.vue';
import GdInput from '@/components/ui/GdInput.vue';

import GdDialog from '@/components/ui/GdDialog.vue'
import { useBotQrCode } from '@/composables/useBotQrCode'

const emit = defineEmits<{ stopped: [] }>()
const { t } = useI18n()
const {
  visible,
  status,
  message,
  loading,
  verifyCode,
  verifySubmitting,
  qrImageUrl,
  open: openQr,
  close,
  refresh,
  submitVerifyCode,
  logout,
} = useBotQrCode()

function open(botId: string) {
  openQr(botId)
}

async function handleLogout() {
  const stopped = await logout()
  if (stopped) emit('stopped')
}

defineExpose({ open, close })
</script>
