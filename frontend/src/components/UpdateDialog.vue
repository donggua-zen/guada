<template>
  <GdDialog
    :model-value="visible"
    @update:model-value="onVisibleChange"
    width="480px"
    :close-on-click-modal="false"
    class="update-dialog"
    append-to-body
    destroy-on-close
  >
    <template #header>
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
          <svg class="w-5 h-5 text-blue-500" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg">
            <path d="M512 128c-211.744 0-384 172.256-384 384 0 211.744 172.256 384 384 384 211.744 0 384-172.256 384-384 0-211.744-172.256-384-384-384z m0 704c-176.448 0-320-143.552-320-320 0-176.448 143.552-320 320-320 176.448 0 320 143.552 320 320 0 176.448-143.552 320-320 320z" fill="currentColor"/>
            <path d="M512 320c-17.664 0-32 14.336-32 32v160c0 17.664 14.336 32 32 32s32-14.336 32-32v-160c0-17.664-14.336-32-32-32z" fill="currentColor"/>
            <path d="M480 608a32 32 0 1 0 64 0 32 32 0 1 0-64 0z" fill="currentColor"/>
          </svg>
        </div>
        <div>
          <h3 class="text-base font-semibold text-(--gd-color-text-primary)">{{ t('ui.update.foundNew') }}</h3>
          <p class="text-xs text-(--gd-color-text-secondary)">{{ t('ui.update.versionInfo', { current: info?.clientVersion, latest: info?.version }) }}</p>
        </div>
      </div>
    </template>

    <!-- 内容区 -->
    <div class="space-y-4">
      <!-- 发布日期 -->
      <div class="flex items-center gap-2 text-xs text-(--gd-color-text-secondary)">
        <svg class="w-3.5 h-3.5" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg">
          <path d="M512 64C264.576 64 64 264.576 64 512s200.576 448 448 448 448-200.576 448-448S759.424 64 512 64z m0 832c-211.744 0-384-172.256-384-384S300.256 128 512 128s384 172.256 384 384-172.256 384-384 384z" fill="currentColor"/>
          <path d="M672 352H352c-17.664 0-32 14.336-32 32v256c0 17.664 14.336 32 32 32h320c17.664 0 32-14.336 32-32V384c0-17.664-14.336-32-32-32z m-32 256H384V416h256v192z" fill="currentColor"/>
          <path d="M480 480h64v64h-64z" fill="currentColor"/>
        </svg>
        <span>{{ t('ui.update.publishDate', { date: info?.publishDate || t('ui.update.unknownDate') }) }}</span>
      </div>

      <!-- 更新描述 -->
      <div>
        <h4 class="text-sm font-medium text-(--gd-color-text-primary) mb-2">{{ t('ui.update.content') }}</h4>
        <p class="text-sm text-(--gd-color-text-secondary) leading-relaxed whitespace-pre-wrap">{{ info?.description || t('ui.update.noDescription') }}</p>
      </div>

      <!-- 强制更新提示 -->
      <div v-if="info?.mandatory" class="flex items-center gap-2 text-xs text-orange-500 bg-orange-500/10 rounded-lg px-3 py-2">
        <svg class="w-4 h-4 shrink-0" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg">
          <path d="M512 64C264.576 64 64 264.576 64 512s200.576 448 448 448 448-200.576 448-448S759.424 64 512 64z m0 832c-211.744 0-384-172.256-384-384S300.256 128 512 128s384 172.256 384 384-172.256 384-384 384z" fill="currentColor"/>
          <path d="M512 256c-17.664 0-32 14.336-32 32v288c0 17.664 14.336 32 32 32s32-14.336 32-32V288c0-17.664-14.336-32-32-32z" fill="currentColor"/>
          <path d="M480 608a32 32 0 1 0 64 0 32 32 0 1 0-64 0z" fill="currentColor"/>
        </svg>
        <span>{{ t('ui.update.mandatoryTip') }}</span>
      </div>

      <!-- 下载进度 -->
      <div v-if="store.isDownloading" class="space-y-2 rounded-lg bg-(--gd-color-surface) p-3">
        <div class="flex items-center justify-between text-xs text-(--gd-color-text-secondary)">
          <span>{{ t('ui.update.downloading', { percent: progressPercent }) }}</span>
          <span>{{ formatSpeed(progress?.bytesPerSecond || 0) }}</span>
        </div>
        <el-progress
          :percentage="progressPercent"
          :stroke-width="8"
          :show-text="false"
          :indeterminate="!progress?.total"
        />
        <div class="text-[11px] text-(--gd-color-text-tertiary, var(--gd-color-text-secondary))">
          {{ formatBytes(progress?.transferred || 0) }} / {{ progress?.total ? formatBytes(progress.total) : '—' }}
        </div>
      </div>

      <!-- 已下载 -->
      <div v-else-if="store.isDownloaded" class="rounded-lg bg-green-500/10 p-3 text-xs text-green-600 dark:text-green-400 space-y-1">
        <div>{{ t('ui.update.downloadComplete') }}</div>
        <div class="opacity-80">{{ t('ui.update.installTip') }}</div>
      </div>

      <!-- 安装中 -->
      <div v-else-if="isInstalling" class="flex items-center gap-2 rounded-lg bg-blue-500/10 p-3 text-xs text-blue-500">
        <span class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"></span>
        <span>{{ t('ui.update.installing') }}</span>
      </div>

      <!-- 错误 -->
      <div v-else-if="hasError" class="rounded-lg bg-red-500/10 p-3 text-xs text-red-500 space-y-1">
        <div>{{ errorText }}</div>
        <div v-if="store.errorPhase === 'download'" class="opacity-80">{{ t('ui.update.downloadErrorTip') }}</div>
      </div>
    </div>

    <template #footer>
      <div class="flex items-center justify-between w-full">
        <el-checkbox
          v-if="store.status === 'available'"
          v-model="dontRemind"
          size="small"
          class="text-xs"
        >
          {{ t('ui.update.dontRemind') }}
        </el-checkbox>
        <span v-else></span>
        <div class="flex items-center gap-3">
          <template v-if="store.isDownloading">
            <el-button @click="handleCancelDownload">{{ t('ui.update.cancelDownload') }}</el-button>
            <el-button type="primary" @click="handleClose">{{ t('ui.update.backgroundDownload') }}</el-button>
          </template>
          <template v-else-if="store.isDownloaded">
            <el-button @click="handleClose">{{ t('ui.update.later') }}</el-button>
            <el-button type="primary" @click="handleInstall">{{ t('ui.update.installAndRestart') }}</el-button>
          </template>
          <template v-else-if="isInstalling">
            <el-button type="primary" disabled>{{ t('ui.update.installing') }}</el-button>
          </template>
          <template v-else-if="hasError">
            <el-button @click="handleManualDownload">{{ t('ui.update.manualDownload') }}</el-button>
            <el-button type="primary" @click="handleRetry">{{ t('ui.update.retry') }}</el-button>
          </template>
          <template v-else>
            <el-button @click="handleViewChangelog">{{ t('ui.update.viewChangelog') }}</el-button>
            <el-button v-if="!store.canInPlaceUpdate" @click="handleManualDownload">
              {{ t('ui.update.download') }}
            </el-button>
            <el-button v-else type="primary" @click="handleDownload">
              {{ t('ui.update.download') }}
            </el-button>
          </template>
        </div>
      </div>
    </template>
  </GdDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElButton, ElCheckbox, ElProgress } from 'element-plus'
import GdDialog from '@/components/ui/GdDialog.vue'
import { useUpdateStore } from '@/stores/update'

const props = defineProps<{
  visible: boolean
  isSkipped?: boolean
}>()

const emit = defineEmits(['update:visible', 'dont-remind', 'cancel-skip'])

const { t } = useI18n()
const store = useUpdateStore()

const dontRemind = ref(props.isSkipped ?? false)

const info = computed(() => store.info)
const progress = computed(() => store.progress)
const progressPercent = computed(() =>
  Math.max(0, Math.min(99, Math.round(progress.value?.percent || 0))),
)
const isInstalling = computed(() => store.status === 'installing')
const hasError = computed(() => store.status === 'error')
const errorText = computed(() => {
  if (!store.error) return t('ui.update.unknownError')
  if (store.errorPhase === 'download') {
    return t('ui.update.downloadFailed', { error: store.error })
  }
  if (store.errorPhase === 'install') {
    return t('ui.update.installFailed', { error: store.error })
  }
  return t('ui.update.checkFailed', { error: store.error })
})

// 当弹窗打开时，同步父组件传入的跳过状态
watch(() => props.visible, (val: boolean) => {
  if (val) {
    dontRemind.value = props.isSkipped ?? false
  }
})

const syncSkip = () => {
  if (dontRemind.value && !props.isSkipped) {
    emit('dont-remind')
  } else if (!dontRemind.value && props.isSkipped) {
    emit('cancel-skip')
  }
}

const handleClose = () => {
  syncSkip()
  emit('update:visible', false)
}

const onVisibleChange = (val: boolean) => {
  if (!val) syncSkip()
  emit('update:visible', val)
}

const handleDownload = () => {
  void store.startDownload()
}

const handleCancelDownload = () => {
  store.cancelDownload()
}

const handleInstall = () => {
  store.installAndRestart()
}

const handleRetry = () => {
  if (store.errorPhase === 'check') {
    void store.checkForUpdates()
  } else if (store.errorPhase === 'install') {
    store.installAndRestart()
  } else {
    void store.startDownload()
  }
}

const handleManualDownload = () => {
  store.openManualDownload()
  handleClose()
}

const handleViewChangelog = () => {
  store.openChangelog()
}

const formatBytes = (bytes: number): string => {
  if (!bytes) return '0 MB'
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

const formatSpeed = (bytesPerSecond: number): string =>
  bytesPerSecond > 0 ? `${formatBytes(bytesPerSecond)}/s` : ''
</script>

<style scoped>
/* GdDialog scoped styles handle dialog body/header/footer — no :deep overrides needed */
</style>
