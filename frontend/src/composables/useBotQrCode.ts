import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { apiService } from '@/services/ApiService'
import { getErrorMessage } from '@/utils/errorMessage'

export type QrStatus = 'qr_ready' | 'logged_in' | 'verify_code_required' | 'pending' | 'unavailable'

const QR_POLL_MS = 5000

/** 微信个人号登录态：二维码可能处于生成中/待扫码/需配对码，弹窗打开期间持续轮询 */
export function useBotQrCode() {
  const { t } = useI18n()

  const visible = ref(false)
  const botId = ref<string | null>(null)
  const status = ref<QrStatus>('unavailable')
  const message = ref('')
  const loading = ref(false)
  const codeUrl = ref('')
  const verifyCode = ref('')
  const verifySubmitting = ref(false)
  let pollTimer: ReturnType<typeof setInterval> | null = null

  const qrImageUrl = computed(() =>
    codeUrl.value
      ? `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(codeUrl.value)}`
      : '',
  )

  async function fetchStatus() {
    const id = botId.value
    if (!id) return
    try {
      const result = await apiService.fetchBotQrCode(id)
      if (id !== botId.value) return
      status.value = result.status
      if (result.status === 'qr_ready') codeUrl.value = result.qrCodeUrl
      else message.value = result.message || ''
    } catch (error) {
      ElMessage.error(getErrorMessage(error) || t('bot.card.getQrFailed'))
    }
  }

  function open(id: string) {
    botId.value = id
    visible.value = true
    loading.value = true
    status.value = 'unavailable'
    codeUrl.value = ''
    message.value = ''
    verifyCode.value = ''
    void fetchStatus().finally(() => {
      loading.value = false
    })
  }

  function close() {
    visible.value = false
  }

  async function refresh() {
    loading.value = true
    status.value = 'unavailable'
    codeUrl.value = ''
    message.value = ''
    verifyCode.value = ''
    await fetchStatus()
    loading.value = false
  }

  async function submitVerifyCode() {
    const id = botId.value
    const code = verifyCode.value.trim()
    if (!id) return
    if (!/^\d{4,8}$/.test(code)) {
      ElMessage.warning(t('bot.card.qrVerifyCodeInvalid'))
      return
    }
    verifySubmitting.value = true
    try {
      const result = await apiService.submitBotVerification(id, code)
      if (result.success) {
        ElMessage.success(result.message)
        verifyCode.value = ''
        await fetchStatus()
      } else {
        ElMessage.warning(result.message)
      }
    } catch (error) {
      ElMessage.error(getErrorMessage(error) || t('bot.card.qrVerifyCodeFailed'))
    } finally {
      verifySubmitting.value = false
    }
  }

  async function logout() {
    const id = botId.value
    if (!id) return
    try {
      const result = await apiService.logoutBot(id)
      if (result.success) {
        ElMessage.success(result.message)
        close()
        await apiService.stopBotInstance(id)
        return true
      }
      ElMessage.warning(result.message)
    } catch (error) {
      ElMessage.error(getErrorMessage(error) || t('bot.card.logoutFailed'))
    }
    return false
  }

  watch(visible, (shown) => {
    if (shown) {
      pollTimer = setInterval(fetchStatus, QR_POLL_MS)
    } else if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  })

  return {
    visible,
    status,
    message,
    loading,
    verifyCode,
    verifySubmitting,
    qrImageUrl,
    open,
    close,
    refresh,
    submitVerifyCode,
    logout,
  }
}
