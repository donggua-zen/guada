<template>
  <GdDialog :model-value="modelValue" size="lg" :title="t('ui.mobileAccess.title')" @update:model-value="close">
    <div class="space-y-4">
      <p class="text-sm text-gray-500 dark:text-[#8b8d95]">{{ t('ui.mobileAccess.desc') }}</p>

      <!-- 未开启 / 未设密码：空态 -->
      <div v-if="!anyEnabled" class="rounded-xl border border-dashed border-gray-300 dark:border-[#3a3b3f] px-6 py-10 flex flex-col items-center text-center gap-3">
        <div class="w-12 h-12 rounded-full bg-gray-100 dark:bg-[#2a2b2f] flex items-center justify-center">
          <SmartphoneOutlined class="w-6 h-6 text-gray-500 dark:text-[#8b8d95]" />
        </div>
        <div class="space-y-1">
          <p class="text-sm font-medium text-gray-900 dark:text-[#e8e9ed]">{{ t('ui.mobileAccess.emptyTitle') }}</p>
          <p class="text-xs text-gray-500 dark:text-[#8b8d95]">{{ t('ui.mobileAccess.emptyDesc') }}</p>
        </div>
        <el-button type="primary" @click="goSettings">{{ t('ui.mobileAccess.goEnable') }}</el-button>
      </div>

      <template v-else>
        <!-- 状态行 -->
        <div class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-(--gd-color-surface) overflow-hidden">
          <div class="px-4 py-3 flex items-center justify-between gap-4">
            <div class="flex items-center gap-3 min-w-0">
              <span :class="['w-2 h-2 rounded-full shrink-0', statusDotClass]"></span>
              <div class="flex flex-col min-w-0">
                <span class="text-sm font-medium text-gray-900 dark:text-[#e8e9ed]">{{ statusLabel }}</span>
                <span class="text-xs text-gray-500 dark:text-[#8b8d95] truncate">{{ statusDetail }}</span>
              </div>
            </div>
            <el-button size="small" @click="stopAccess">{{ t('ui.mobileAccess.stop') }}</el-button>
          </div>
        </div>

        <!-- 局域网 / 公网切换 -->
        <div v-if="modeOptions.length > 1" class="flex items-center gap-1 p-0.5 rounded-lg bg-gray-100 dark:bg-[#1a1b1e] w-fit">
          <button v-for="option in modeOptions" :key="option.value" @click="selectedMode = option.value"
            class="px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200"
            :class="selectedMode === option.value
              ? 'bg-white dark:bg-[#3a3b3f] text-gray-900 dark:text-[#e8e9ed] shadow-sm'
              : 'text-gray-500 dark:text-[#8b8d95] hover:text-gray-700 dark:hover:text-[#c0c1c5]'">
            {{ option.label }}
          </button>
        </div>

        <!-- 二维码 -->
        <div class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-(--gd-color-surface) px-4 py-5 flex flex-col items-center gap-4">
          <div class="w-[260px] h-[260px] rounded-lg bg-white flex items-center justify-center overflow-hidden">
            <img v-if="qrDataUrl" :src="qrDataUrl" alt="QR" class="w-full h-full object-contain" />
            <span v-else class="text-xs text-gray-400">{{ t('ui.mobileAccess.qrUnavailable') }}</span>
          </div>

          <div class="w-full flex items-center justify-between gap-3">
            <span class="text-xs text-gray-500 dark:text-[#8b8d95]">{{ t('ui.mobileAccess.cannotScan') }}</span>
            <el-button size="small" :disabled="!currentUrl" @click="copyLink">{{ t('ui.mobileAccess.copyLink') }}</el-button>
          </div>
          <code v-if="currentUrl" class="text-xs text-blue-600 dark:text-blue-400 break-all text-center select-all">{{ currentUrl }}</code>
        </div>

        <!-- 未设密码提示 -->
        <div v-if="!passwordSet" class="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 flex items-center justify-between gap-3">
          <span class="text-xs text-amber-700 dark:text-amber-400">{{ t('ui.mobileAccess.needPassword') }}</span>
          <el-button size="small" type="warning" plain @click="goSecurity">{{ t('ui.mobileAccess.setPassword') }}</el-button>
        </div>
      </template>
    </div>
  </GdDialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import QRCode from 'qrcode'
import GdDialog from '@/components/ui/GdDialog.vue'
import { SmartphoneOutlined } from '@vicons/material'
import { apiService } from '@/services/ApiService'
import { usePopup } from '@/composables/usePopup'
import { writeTextToClipboard } from '@/utils/clipboard'
import type { MobileAccessStatusView } from '@/services/modules/mobile-access.api'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const { t } = useI18n()
const router = useRouter()
const { notify } = usePopup()

const status = ref<MobileAccessStatusView | null>(null)
const qrDataUrl = ref('')
const selectedMode = ref<'lan' | 'public'>('lan')
let pollTimer: ReturnType<typeof setInterval> | null = null

const anyEnabled = computed(() => !!status.value && (status.value.lan.enabled || status.value.public.enabled))
const passwordSet = computed(() => status.value?.passwordSet ?? true)

const modeOptions = computed(() => {
  const options: Array<{ value: 'lan' | 'public'; label: string }> = []
  if (status.value?.lan.enabled) options.push({ value: 'lan', label: t('ui.mobileAccess.lanTab') })
  if (status.value?.public.enabled) options.push({ value: 'public', label: t('ui.mobileAccess.publicTab') })
  return options
})

const currentUrl = computed(() => {
  if (!status.value) return null
  if (selectedMode.value === 'lan') return status.value.lan.urls[0] ?? null
  return status.value.public.url
})

const statusLabel = computed(() => {
  if (!status.value) return t('ui.mobileAccess.statusStopped')
  if (status.value.public.enabled && status.value.public.status === 'error') {
    return t('ui.mobileAccess.statusPublicError')
  }
  if (status.value.public.enabled && status.value.public.status === 'connecting') {
    return t('ui.mobileAccess.statusPublicConnecting')
  }
  if (selectedMode.value === 'lan' && status.value.lan.enabled && !status.value.lan.active) {
    return t('ui.mobileAccess.lanPendingRestart')
  }
  return t('ui.mobileAccess.statusWaiting')
})

const statusDetail = computed(() => {
  if (!status.value) return ''
  const parts: string[] = []
  if (status.value.lan.enabled) {
    parts.push(
      status.value.lan.active
        ? t('ui.mobileAccess.lanActive')
        : t('ui.mobileAccess.lanInactive'),
    )
  }
  if (status.value.public.enabled) {
    parts.push(
      status.value.public.status === 'connected'
        ? t('ui.mobileAccess.publicConnected')
        : status.value.public.status === 'connecting'
          ? t('ui.mobileAccess.statusPublicConnecting')
          : status.value.public.status === 'error'
            ? t('ui.mobileAccess.statusPublicError')
            : t('ui.mobileAccess.statusStopped'),
    )
  }
  return parts.join(' · ')
})

const statusDotClass = computed(() => {
  if (!status.value) return 'bg-gray-400'
  if (status.value.public.enabled && status.value.public.status === 'error') return 'bg-red-500'
  if (currentUrl.value) return 'bg-emerald-500'
  return 'bg-amber-500 animate-pulse'
})

async function loadStatus() {
  try {
    status.value = await apiService.getMobileAccessStatus()
    // 选中的模式被关闭时自动切到仍开启的那一个
    if (modeOptions.value.length > 0 && !modeOptions.value.some((o) => o.value === selectedMode.value)) {
      selectedMode.value = modeOptions.value[0].value
    }
  } catch {
    // 弹窗轮询失败保持上一次状态
  }
}

async function refreshQr() {
  if (!currentUrl.value) {
    qrDataUrl.value = ''
    return
  }
  try {
    qrDataUrl.value = await QRCode.toDataURL(currentUrl.value, {
      width: 520,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#111827', light: '#ffffff' },
    })
  } catch {
    qrDataUrl.value = ''
  }
}

async function stopAccess() {
  try {
    await apiService.updateMobileAccessConfig({ lanEnabled: false, publicEnabled: false })
    notify.success(t('common.saveSuccess'), t('ui.mobileAccess.stopped'))
    await loadStatus()
  } catch (error: any) {
    notify.error(t('common.saveFailed'), error?.message || t('common.error.unknown'))
  }
}

async function copyLink() {
  if (!currentUrl.value) return
  const ok = await writeTextToClipboard(currentUrl.value)
  if (ok) {
    notify.success(t('common.saveSuccess'), t('ui.mobileAccess.copied'))
  } else {
    notify.error(t('common.saveFailed'), t('ui.mobileAccess.copyFailed'))
  }
}

function goSettings() {
  emit('update:modelValue', false)
  router.push({ name: 'SystemSettings', params: { tab: 'mobile-access' } })
}

function goSecurity() {
  emit('update:modelValue', false)
  router.push({ name: 'SystemSettings', params: { tab: 'security' } })
}

function close(value: boolean) {
  emit('update:modelValue', value)
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      void loadStatus()
      pollTimer = setInterval(loadStatus, 4000)
    } else if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  },
  { immediate: true },
)

watch(currentUrl, () => {
  void refreshQr()
})

onBeforeUnmount(() => {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
})
</script>
