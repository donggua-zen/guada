<template>
  <div class="flex-1 overflow-hidden">
    <!-- Web 端（docker 部署）没有移动访问概念：只提示桌面端可用 -->
    <div v-if="!isElectronEnv" class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-(--gd-color-surface) p-6 text-sm text-gray-500 dark:text-[#8b8d95]">
      {{ t('settings.mobileAccess.desktopOnly') }}
    </div>

    <div v-else class="space-y-8">
      <!-- 安全提示：密码是移动访问的唯一门禁 -->
      <div v-if="!config.passwordSet" class="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3.5 flex items-center justify-between gap-4">
        <div class="flex flex-col gap-1 min-w-0 flex-1">
          <span class="text-sm font-medium text-amber-700 dark:text-amber-400">{{ t('settings.mobileAccess.passwordRequired') }}</span>
          <span class="text-xs text-amber-600/80 dark:text-amber-500/80">{{ t('settings.mobileAccess.passwordRequiredDesc') }}</span>
        </div>
        <el-button type="warning" plain @click="goSetPassword">{{ t('settings.mobileAccess.goSetPassword') }}</el-button>
      </div>

      <!-- 局域网访问 -->
      <div>
        <h3 class="text-sm font-semibold text-gray-900 dark:text-[#e8e9ed] mb-3">{{ t('settings.mobileAccess.lanTitle') }}</h3>
        <div class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-(--gd-color-surface) overflow-hidden">
          <div class="px-4 py-3.5 flex items-center justify-between gap-4">
            <div class="flex flex-col gap-1 min-w-0 flex-1">
              <span class="text-base text-gray-900 dark:text-[#e8e9ed]">{{ t('settings.mobileAccess.lanToggle') }}</span>
              <span class="text-xs text-gray-500 dark:text-[#8b8d95]">{{ t('settings.mobileAccess.lanDesc') }}</span>
            </div>
            <div class="shrink-0">
              <el-switch v-model="config.lanEnabled" :disabled="!config.passwordSet || savingLan" :loading="savingLan" @change="handleLanToggle" />
            </div>
          </div>
          <div v-if="config.lanEnabled" class="px-4 py-3.5 border-t border-gray-100 dark:border-[#2e3035]">
            <template v-if="lanUrls.length">
              <div class="flex items-center justify-between gap-4">
                <div class="flex flex-col gap-1 min-w-0 flex-1">
                  <span class="text-base text-gray-900 dark:text-[#e8e9ed]">{{ t('settings.mobileAccess.lanAddress') }}</span>
                  <span class="text-xs text-gray-500 dark:text-[#8b8d95]">{{ t('settings.mobileAccess.lanAddressDesc') }}</span>
                </div>
                <div class="shrink-0 flex items-center gap-2">
                  <code class="text-sm text-blue-600 dark:text-blue-400 select-all">{{ lanUrls[0] }}</code>
                  <el-button size="small" @click="copyUrl(lanUrls[0])">{{ t('settings.mobileAccess.copy') }}</el-button>
                </div>
              </div>
            </template>
            <div v-else class="flex items-center justify-between gap-4">
              <span class="text-xs text-amber-600 dark:text-amber-500">{{ t('settings.mobileAccess.lanPendingRestart') }}</span>
              <el-button size="small" type="warning" plain @click="restartApp">{{ t('settings.mobileAccess.restartNow') }}</el-button>
            </div>
          </div>
        </div>
      </div>

      <!-- 公网访问（SSH 反向隧道） -->
      <div>
        <h3 class="text-sm font-semibold text-gray-900 dark:text-[#e8e9ed] mb-3">{{ t('settings.mobileAccess.publicTitle') }}</h3>
        <div class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-(--gd-color-surface) overflow-hidden">
          <div class="px-4 py-3.5 flex items-center justify-between gap-4">
            <div class="flex flex-col gap-1 min-w-0 flex-1">
              <span class="text-base text-gray-900 dark:text-[#e8e9ed]">{{ t('settings.mobileAccess.publicToggle') }}</span>
              <span class="text-xs text-gray-500 dark:text-[#8b8d95]">{{ t('settings.mobileAccess.publicDesc') }}</span>
            </div>
            <div class="shrink-0 flex items-center gap-3">
              <span :class="['text-xs flex items-center gap-1.5', publicStatusClass]">
                <span :class="['w-1.5 h-1.5 rounded-full', publicStatusDotClass]"></span>
                {{ publicStatusLabel }}
              </span>
              <el-switch v-model="config.publicEnabled" :disabled="!config.passwordSet || savingPublic" :loading="savingPublic" @change="handlePublicToggle" />
            </div>
          </div>

          <!-- 连接状态 / 公网地址 -->
          <div v-if="config.publicEnabled" class="px-4 py-3.5 border-t border-gray-100 dark:border-[#2e3035] space-y-2">
            <div class="flex items-center justify-between gap-4">
              <span class="text-sm text-gray-600 dark:text-[#c0c1c5]">{{ t('settings.mobileAccess.publicUrlLabel') }}</span>
              <div class="flex items-center gap-2 min-w-0">
                <code class="text-sm text-blue-600 dark:text-blue-400 truncate select-all">{{ publicUrl || '—' }}</code>
                <el-button size="small" :disabled="!publicUrl" @click="copyUrl(publicUrl!)">{{ t('settings.mobileAccess.copy') }}</el-button>
              </div>
            </div>
            <div v-if="status?.public.lastError" class="text-xs text-red-600 dark:text-red-400 break-all">
              {{ t('settings.mobileAccess.lastError') }}: {{ status.public.lastError }}
              <button v-if="gatewayPortsError" type="button"
                class="text-blue-600 dark:text-blue-400 hover:underline ml-1"
                @click="gatewayPortsDialogVisible = true">
                {{ t('settings.mobileAccess.gatewayPortsHowTo') }}
              </button>
            </div>
            <div class="flex items-center gap-2 pt-1">
              <el-button size="small" :loading="reconnecting" @click="reconnectTunnel">{{ t('settings.mobileAccess.reconnect') }}</el-button>
            </div>
          </div>

          <!-- SSH 配置 -->
          <div class="border-t border-gray-100 dark:border-[#2e3035]">
            <div class="px-4 py-3.5 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="flex flex-col gap-1.5">
                <span class="text-sm text-gray-900 dark:text-[#e8e9ed]">{{ t('settings.mobileAccess.sshHost') }}</span>
                <el-input v-model="sshForm.host" :placeholder="t('settings.mobileAccess.sshHostPlaceholder')" clearable />
              </div>
              <div class="flex flex-col gap-1.5">
                <span class="text-sm text-gray-900 dark:text-[#e8e9ed]">{{ t('settings.mobileAccess.sshPort') }}</span>
                <el-input-number v-model="sshForm.port" :min="1" :max="65535" controls-position="right" class="w-full" />
              </div>
              <div class="flex flex-col gap-1.5">
                <span class="text-sm text-gray-900 dark:text-[#e8e9ed]">{{ t('settings.mobileAccess.sshUsername') }}</span>
                <el-input v-model="sshForm.username" placeholder="root" clearable />
              </div>
              <div class="flex flex-col gap-1.5">
                <span class="text-sm text-gray-900 dark:text-[#e8e9ed]">{{ t('settings.mobileAccess.authMethod') }}</span>
                <el-radio-group v-model="sshForm.authMethod">
                  <el-radio-button value="privateKey">{{ t('settings.mobileAccess.authPrivateKey') }}</el-radio-button>
                  <el-radio-button value="password">{{ t('settings.mobileAccess.authPassword') }}</el-radio-button>
                </el-radio-group>
              </div>

              <div v-if="sshForm.authMethod === 'password'" class="flex flex-col gap-1.5 md:col-span-2">
                <span class="text-sm text-gray-900 dark:text-[#e8e9ed]">{{ t('settings.mobileAccess.sshPassword') }}</span>
                <el-input v-model="sshForm.password" type="password" show-password clearable
                  :placeholder="config.hasPassword ? t('settings.mobileAccess.passwordKept') : ''" />
              </div>
              <div v-else class="flex flex-col gap-1.5 md:col-span-2">
                <span class="text-sm text-gray-900 dark:text-[#e8e9ed]">{{ t('settings.mobileAccess.privateKeyPath') }}</span>
                <div class="flex gap-2">
                  <el-input v-model="sshForm.privateKeyPath" :placeholder="t('settings.mobileAccess.privateKeyPathPlaceholder')" clearable />
                  <el-button v-if="isElectronEnv" @click="selectPrivateKey">{{ t('settings.mobileAccess.selectFile') }}</el-button>
                </div>
              </div>

              <div class="flex flex-col gap-1.5">
                <span class="text-sm text-gray-900 dark:text-[#e8e9ed]">{{ t('settings.mobileAccess.remoteBind') }}</span>
                <el-select v-model="sshForm.remoteBindAddress" @change="handleRemoteBindChange">
                  <el-option value="127.0.0.1" :label="t('settings.mobileAccess.remoteBindLoopback')" />
                  <el-option value="0.0.0.0" :label="t('settings.mobileAccess.remoteBindAll')" />
                </el-select>
                <span class="text-xs text-gray-500 dark:text-[#8b8d95]">
                  {{ t('settings.mobileAccess.remoteBindHint') }}
                  <button type="button" class="text-blue-600 dark:text-blue-400 hover:underline ml-1" @click="gatewayPortsDialogVisible = true">
                    {{ t('settings.mobileAccess.gatewayPortsHowTo') }}
                  </button>
                </span>
              </div>
              <div class="flex flex-col gap-1.5">
                <span class="text-sm text-gray-900 dark:text-[#e8e9ed]">{{ t('settings.mobileAccess.remotePort') }}</span>
                <el-input-number v-model="sshForm.remotePort" :min="1" :max="65535" controls-position="right" class="w-full" />
              </div>

              <div class="flex flex-col gap-1.5 md:col-span-2">
                <span class="text-sm text-gray-900 dark:text-[#e8e9ed]">{{ t('settings.mobileAccess.publicUrl') }}</span>
                <el-input v-model="sshForm.publicUrl" :placeholder="t('settings.mobileAccess.publicUrlPlaceholder')" clearable />
                <span class="text-xs text-gray-500 dark:text-[#8b8d95]">{{ t('settings.mobileAccess.publicUrlHint') }}</span>
              </div>

              <div v-if="config.ssh.hostFingerprint" class="flex items-center justify-between gap-4 md:col-span-2">
                <div class="flex flex-col gap-1 min-w-0">
                  <span class="text-sm text-gray-900 dark:text-[#e8e9ed]">{{ t('settings.mobileAccess.fingerprint') }}</span>
                  <code class="text-xs text-gray-500 dark:text-[#8b8d95] break-all">{{ config.ssh.hostFingerprint }}</code>
                </div>
                <el-button size="small" @click="clearFingerprint">{{ t('settings.mobileAccess.clearFingerprint') }}</el-button>
              </div>
            </div>
            <div class="px-4 pb-3.5 flex items-center justify-end gap-2">
              <el-button :loading="savingSsh" type="primary" @click="saveSshConfig">{{ t('settings.mobileAccess.save') }}</el-button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- GatewayPorts 配置说明：安装包用户没有 docs，直接给出可复制的命令 -->
    <GdDialog v-model="gatewayPortsDialogVisible" :title="t('settings.mobileAccess.gatewayPortsTitle')" size="md">
      <div class="space-y-4 text-sm text-gray-700 dark:text-[#c0c1c5]">
        <p>{{ t('settings.mobileAccess.gatewayPortsIntro') }}</p>

        <div class="space-y-2">
          <p class="font-medium text-gray-900 dark:text-[#e8e9ed]">{{ t('settings.mobileAccess.gatewayPortsEnableTitle') }}</p>
          <div class="relative">
            <pre class="bg-gray-900 text-gray-100 rounded-lg p-3 pr-20 text-xs overflow-x-auto"><code>{{ gatewayPortsEnableCommand }}</code></pre>
            <el-button class="!absolute right-2 top-2" size="small" @click="copyUrl(gatewayPortsEnableCommand)">{{ t('settings.mobileAccess.copy') }}</el-button>
          </div>
          <p class="text-xs text-gray-500 dark:text-[#8b8d95]">{{ t('settings.mobileAccess.gatewayPortsEnableNote') }}</p>
        </div>

        <div class="space-y-2">
          <p class="font-medium text-gray-900 dark:text-[#e8e9ed]">{{ t('settings.mobileAccess.gatewayPortsVerifyTitle') }}</p>
          <div class="relative">
            <pre class="bg-gray-900 text-gray-100 rounded-lg p-3 pr-20 text-xs overflow-x-auto"><code>{{ gatewayPortsVerifyCommand }}</code></pre>
            <el-button class="!absolute right-2 top-2" size="small" @click="copyUrl(gatewayPortsVerifyCommand)">{{ t('settings.mobileAccess.copy') }}</el-button>
          </div>
        </div>

        <div class="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-xs text-amber-700 dark:text-amber-400 space-y-1.5">
          <p>{{ t('settings.mobileAccess.gatewayPortsSecurity') }}</p>
          <p>{{ t('settings.mobileAccess.gatewayPortsAlternative') }}</p>
        </div>
      </div>
      <template #footer>
        <el-button type="primary" @click="gatewayPortsDialogVisible = false">{{ t('settings.mobileAccess.gatewayPortsGotIt') }}</el-button>
      </template>
    </GdDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { usePopup } from '@/composables/usePopup'
import { getErrorMessage } from '@/utils/errorMessage'
import { writeTextToClipboard } from '@/utils/clipboard'
import GdDialog from '@/components/ui/GdDialog.vue'
import { apiService } from '@/services/ApiService'
import type {
  MobileAccessConfigView,
  MobileAccessStatusView,
  MobileAccessTunnelState,
} from '@/services/modules/mobile-access.api'

const { t } = useI18n()
const router = useRouter()
const { notify } = usePopup()

const isElectronEnv = typeof window !== 'undefined' && !!window.electronAPI

const config = reactive<MobileAccessConfigView>({
  lanEnabled: false,
  publicEnabled: false,
  hasPassword: false,
  passwordSet: false,
  lanActive: false,
  port: null,
  ssh: {
    host: '',
    port: 22,
    username: '',
    authMethod: 'privateKey',
    privateKeyPath: '',
    remoteBindAddress: '127.0.0.1',
    remotePort: 8787,
    publicUrl: '',
    hostFingerprint: '',
  },
})

const sshForm = reactive({
  host: '',
  port: 22,
  username: '',
  authMethod: 'privateKey' as 'password' | 'privateKey',
  password: '',
  privateKeyPath: '',
  remoteBindAddress: '127.0.0.1' as '127.0.0.1' | '0.0.0.0',
  remotePort: 8787,
  publicUrl: '',
})

const status = ref<MobileAccessStatusView | null>(null)
const savingLan = ref(false)
const savingPublic = ref(false)
const savingSsh = ref(false)
const reconnecting = ref(false)
const gatewayPortsDialogVisible = ref(false)
let pollTimer: ReturnType<typeof setInterval> | null = null

/** 选择 0.0.0.0 时提醒服务器需开启 GatewayPorts（多数服务器默认关闭） */
function handleRemoteBindChange(val: string | number | boolean | undefined) {
  if (val === '0.0.0.0') {
    gatewayPortsDialogVisible.value = true
  }
}

const gatewayPortsEnableCommand = [
  "echo 'GatewayPorts clientspecified' | sudo tee -a /etc/ssh/sshd_config",
  "sudo sshd -t && sudo systemctl restart sshd",
].join('\n')

const gatewayPortsVerifyCommand = computed(() =>
  [
    'sudo sshd -T | grep -i gatewayports',
    `ss -lntp | grep ${sshForm.remotePort || 8787}`,
  ].join('\n'),
)

const lanUrls = computed(() => status.value?.lan.urls ?? [])
const publicUrl = computed(() => status.value?.public.url ?? null)
const gatewayPortsError = computed(() => {
  const err = status.value?.public.lastError ?? ''
  return /GatewayPorts|端口转发失败|administratively prohibited/i.test(err)
})

const publicStatusLabel = computed(() => {
  const state: MobileAccessTunnelState = status.value?.public.status ?? 'stopped'
  const map: Record<MobileAccessTunnelState, string> = {
    stopped: t('settings.mobileAccess.statusStopped'),
    connecting: t('settings.mobileAccess.statusConnecting'),
    connected: t('settings.mobileAccess.statusConnected'),
    error: t('settings.mobileAccess.statusError'),
  }
  return map[state]
})

const publicStatusDotClass = computed(() => {
  const state = status.value?.public.status ?? 'stopped'
  return {
    stopped: 'bg-gray-400',
    connecting: 'bg-amber-500 animate-pulse',
    connected: 'bg-emerald-500',
    error: 'bg-red-500',
  }[state]
})

const publicStatusClass = computed(() => {
  const state = status.value?.public.status ?? 'stopped'
  return {
    stopped: 'text-gray-500 dark:text-[#8b8d95]',
    connecting: 'text-amber-600 dark:text-amber-500',
    connected: 'text-emerald-600 dark:text-emerald-400',
    error: 'text-red-600 dark:text-red-400',
  }[state]
})

function applyConfig(view: MobileAccessConfigView) {
  Object.assign(config, {
    lanEnabled: view.lanEnabled,
    publicEnabled: view.publicEnabled,
    hasPassword: view.hasPassword,
    passwordSet: view.passwordSet,
    lanActive: view.lanActive,
    port: view.port,
    ssh: { ...view.ssh },
  })
  Object.assign(sshForm, {
    host: view.ssh.host,
    port: view.ssh.port,
    username: view.ssh.username,
    authMethod: view.ssh.authMethod,
    password: '',
    privateKeyPath: view.ssh.privateKeyPath,
    remoteBindAddress: view.ssh.remoteBindAddress,
    remotePort: view.ssh.remotePort,
    publicUrl: view.ssh.publicUrl,
  })
}

async function loadConfig() {
  try {
    applyConfig(await apiService.getMobileAccessConfig())
  } catch (error) {
    console.error('获取移动访问配置失败:', error)
  }
}

async function loadStatus() {
  try {
    status.value = await apiService.getMobileAccessStatus()
  } catch {
    // 轮询失败保持上一次状态
  }
}

async function handleLanToggle(val: string | number | boolean | undefined) {
  savingLan.value = true
  try {
    const view = await apiService.updateMobileAccessConfig({ lanEnabled: val === true })
    applyConfig(view)
    if (view.restartRequired) {
      notify.success(t('common.saveSuccess'), t('settings.mobileAccess.lanRestartRequired'))
    } else {
      notify.success(t('common.saveSuccess'), t('settings.mobileAccess.saved'))
    }
    await loadStatus()
  } catch (error) {
    config.lanEnabled = !config.lanEnabled
    notify.error(t('common.saveFailed'), getErrorMessage(error) || t('common.error.unknown'))
  } finally {
    savingLan.value = false
  }
}

async function handlePublicToggle(val: string | number | boolean | undefined) {
  savingPublic.value = true
  try {
    const view = await apiService.updateMobileAccessConfig({ publicEnabled: val === true })
    applyConfig(view)
    notify.success(t('common.saveSuccess'), t('settings.mobileAccess.saved'))
    await loadStatus()
  } catch (error) {
    config.publicEnabled = !config.publicEnabled
    notify.error(t('common.saveFailed'), getErrorMessage(error) || t('common.error.unknown'))
  } finally {
    savingPublic.value = false
  }
}

async function saveSshConfig() {
  savingSsh.value = true
  try {
    const view = await apiService.updateMobileAccessConfig({
      ssh: {
        host: sshForm.host,
        port: sshForm.port,
        username: sshForm.username,
        authMethod: sshForm.authMethod,
        privateKeyPath: sshForm.privateKeyPath,
        remoteBindAddress: sshForm.remoteBindAddress,
        remotePort: sshForm.remotePort,
        publicUrl: sshForm.publicUrl,
        ...(sshForm.password ? { password: sshForm.password } : {}),
      },
    })
    applyConfig(view)
    notify.success(t('common.saveSuccess'), t('settings.mobileAccess.saved'))
    await loadStatus()
  } catch (error) {
    notify.error(t('common.saveFailed'), getErrorMessage(error) || t('common.error.unknown'))
  } finally {
    savingSsh.value = false
  }
}

async function reconnectTunnel() {
  reconnecting.value = true
  try {
    await apiService.reconnectMobileAccessTunnel()
    notify.success(t('common.saveSuccess'), t('settings.mobileAccess.reconnecting'))
    await loadStatus()
  } catch (error) {
    notify.error(t('common.saveFailed'), getErrorMessage(error) || t('common.error.unknown'))
  } finally {
    reconnecting.value = false
  }
}

async function selectPrivateKey() {
  try {
    const selected = await window.electronAPI?.selectFile?.()
    if (selected) sshForm.privateKeyPath = selected
  } catch (error) {
    notify.error(t('common.saveFailed'), getErrorMessage(error) || t('common.error.unknown'))
  }
}

async function clearFingerprint() {
  try {
    const view = await apiService.updateMobileAccessConfig({
      ssh: { clearHostFingerprint: true },
    })
    applyConfig(view)
    notify.success(t('common.saveSuccess'), t('settings.mobileAccess.fingerprintCleared'))
  } catch (error) {
    notify.error(t('common.saveFailed'), getErrorMessage(error) || t('common.error.unknown'))
  }
}

async function copyUrl(url: string) {
  const ok = await writeTextToClipboard(url)
  if (ok) {
    notify.success(t('common.saveSuccess'), t('settings.mobileAccess.copied'))
  } else {
    notify.error(t('common.saveFailed'), t('settings.mobileAccess.copyFailed'))
  }
}

function goSetPassword() {
  router.push({ name: 'SystemSettings', params: { tab: 'security' } })
}

function restartApp() {
  if (window.electronAPI?.relaunchApp) {
    void window.electronAPI.relaunchApp()
  }
}

onMounted(async () => {
  if (!isElectronEnv) return
  await Promise.all([loadConfig(), loadStatus()])
  pollTimer = setInterval(loadStatus, 4000)
})

onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
})
</script>
