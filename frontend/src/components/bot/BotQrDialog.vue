<template>
  <GdDialog v-model="visible" :title="t('bot.card.qrTitle')" size="xs" align-center>
    <div class="flex flex-col items-center py-4">
      <div v-if="loading" class="py-8">
        <el-icon class="is-loading" :size="32">
          <Loading />
        </el-icon>
      </div>

      <!-- 已登录 -->
      <div v-else-if="status === 'logged_in'" class="flex flex-col items-center py-4">
        <el-icon :size="48" class="text-green-500 mb-3">
          <CircleCheck />
        </el-icon>
        <p class="text-sm text-gray-600">{{ message }}</p>
        <el-button type="danger" size="small" class="mt-4" @click="handleLogout">
          <el-icon><SwitchButton /></el-icon>
          <span class="ml-1">{{ t('bot.card.logout') }}</span>
        </el-button>
      </div>

      <!-- 二维码生成中 -->
      <div v-else-if="status === 'pending'" class="flex flex-col items-center py-4">
        <el-icon :size="32" class="text-orange-400 mb-3">
          <Timer />
        </el-icon>
        <p class="text-sm text-gray-600">{{ message }}</p>
      </div>

      <!-- 二维码可用 -->
      <div v-else-if="status === 'qr_ready'" class="w-full flex flex-col items-center">
        <img :src="qrImageUrl" alt="微信登录二维码" class="w-64 h-64" />
        <p class="text-xs text-gray-400 mt-3 text-center">
          {{ t('bot.card.qrReadyHint') }}
        </p>
        <el-button size="small" class="mt-3" @click="refresh">
          <el-icon><Refresh /></el-icon>
          <span class="ml-1">{{ t('bot.card.refreshQr') }}</span>
        </el-button>
      </div>

      <!-- 需要数字配对码 -->
      <div v-else-if="status === 'verify_code_required'" class="w-full flex flex-col items-center">
        <img v-if="qrImageUrl" :src="qrImageUrl" alt="微信登录二维码" class="w-48 h-48" />
        <p class="text-xs text-gray-500 mt-3 text-center">
          {{ message || t('bot.card.qrVerifyCodeHint') }}
        </p>
        <el-input
          v-model="verifyCode"
          class="mt-3"
          maxlength="8"
          inputmode="numeric"
          clearable
          :placeholder="t('bot.card.qrVerifyCodePlaceholder')"
          @keyup.enter="submitVerifyCode"
        />
        <el-button
          type="primary"
          size="small"
          class="mt-3"
          :loading="verifySubmitting"
          @click="submitVerifyCode"
        >
          {{ t('bot.card.qrVerifyCodeSubmit') }}
        </el-button>
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
import { CircleCheck, Timer, SwitchButton, Loading, Refresh } from '@element-plus/icons-vue'
import { ElButton, ElIcon, ElInput } from 'element-plus'
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
