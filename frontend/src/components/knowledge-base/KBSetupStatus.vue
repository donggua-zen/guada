<template>
  <details class="rounded-lg border border-(--gd-color-surface-border) bg-(--gd-color-surface) text-sm"
    :open="needsAttention">
    <summary class="cursor-pointer select-none px-3 py-2 text-(--gd-color-text)">
      <span class="font-medium">{{ t('knowledge.setup.title') }}</span>
      <span class="ml-3 inline-flex items-center gap-1.5 align-middle text-xs text-(--gd-color-text-secondary)">
        <span class="setup-dot" :style="dotStyle(embeddingTone)"></span>
        {{ t('knowledge.setup.embedding') }}
        <span class="setup-badge" :style="badgeStyle(embeddingTone)">{{ embeddingBadge }}</span>
      </span>
      <span class="ml-3 inline-flex items-center gap-1.5 align-middle text-xs text-(--gd-color-text-secondary)">
        <span class="setup-dot" :style="dotStyle(ocrTone)"></span>
        OCR
        <span class="setup-badge" :style="badgeStyle(ocrTone)">{{ ocrBadge }}</span>
      </span>
    </summary>

    <div class="border-t border-(--gd-color-surface-border) px-3 py-2.5 space-y-2.5">
      <!-- 嵌入模型 -->
      <div class="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <div class="min-w-0 flex-1">
          <p class="flex flex-wrap items-center gap-2 font-medium text-(--gd-color-text)">
            <span class="setup-badge shrink-0" :style="badgeStyle(embeddingTone)">{{ embeddingBadge }}</span>
            <span>{{ t('knowledge.setup.embedding') }}</span>
            <span v-if="embeddingStatus === 'configured' && modelName" class="font-normal text-(--gd-color-text-secondary) truncate">{{ modelName }}</span>
          </p>
          <p v-if="showEmbeddingHint" class="mt-1 text-xs leading-relaxed text-(--gd-color-text-secondary)">{{ embeddingHint }}</p>
        </div>
        <div class="flex shrink-0 flex-wrap gap-2">
          <GdButton v-if="embeddingStatus === 'unavailable' && hasCurrentKb" size="small" @click="emit('edit-model')">{{ t('knowledge.setup.selectAnotherModel') }}</GdButton>
          <GdButton size="small" @click="emit('configure', 'providers')">{{ t(embeddingStatus === 'missing' ? 'knowledge.setup.addEmbedding' : 'knowledge.setup.manageEmbedding') }}</GdButton>
        </div>
      </div>

      <!-- OCR -->
      <div class="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <div class="min-w-0 flex-1">
          <p class="flex flex-wrap items-center gap-2 font-medium text-(--gd-color-text)">
            <span class="setup-badge shrink-0" :style="badgeStyle(ocrTone)">{{ ocrBadge }}</span>
            <span>{{ t('knowledge.setup.ocr') }}</span>
            <span v-if="ocrStatus === 'configured'" class="font-normal text-(--gd-color-text-secondary) truncate">{{ ocrProvider }}</span>
          </p>
          <p v-if="showOcrHint" class="mt-1 text-xs leading-relaxed text-(--gd-color-text-secondary)">{{ ocrHint }}</p>
        </div>
        <GdButton size="small" @click="emit('configure', 'ocr')">{{ t('knowledge.setup.configureOcr') }}</GdButton>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-2 pt-1">
        <p class="text-xs text-(--gd-color-text-secondary) opacity-80">{{ t('knowledge.setup.scopeHint') }}</p>
        <GdButton size="small" link :loading="isLoading" @click="emit('refresh')">{{ t('knowledge.setup.refresh') }}</GdButton>
      </div>
    </div>
  </details>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import GdButton from '@/components/ui/GdButton.vue'
import type { EmbeddingSetupStatus, OcrSetupStatus, SetupLoadState } from '@/utils/knowledgeSetup'

const props = defineProps<{
  embeddingState: SetupLoadState
  embeddingStatus: EmbeddingSetupStatus
  modelName?: string
  hasCurrentKb: boolean
  ocrState: SetupLoadState
  ocrStatus: OcrSetupStatus
  ocrProvider: string
}>()
const emit = defineEmits<{
  configure: [tab: 'providers' | 'ocr']
  refresh: []
  'edit-model': []
}>()
const { t } = useI18n()

type Tone = 'success' | 'warning' | 'danger' | 'info'
const TONE_COLOR: Record<Tone, string> = {
  success: 'var(--gd-color-success)',
  warning: 'var(--gd-color-warning)',
  danger: 'var(--gd-color-danger)',
  info: 'var(--gd-color-info)',
}
// 语义色和主题文字色混合：浅色主题得到深色文字、深色主题得到浅色文字，
// 避免亮绿/亮黄直接配近白底导致对比度不足；边框再补一层轮廓。
function badgeStyle(tone: Tone) {
  const color = TONE_COLOR[tone]
  return {
    color: `color-mix(in srgb, ${color} 55%, var(--gd-color-text))`,
    backgroundColor: `color-mix(in srgb, ${color} 16%, var(--gd-color-surface))`,
  }
}
function dotStyle(tone: Tone) {
  return { backgroundColor: `color-mix(in srgb, ${TONE_COLOR[tone]} 80%, var(--gd-color-text))` }
}

const isLoading = computed(() => props.embeddingState === 'loading' || props.ocrState === 'loading')
const needsAttention = computed(() => props.embeddingState === 'error' || props.ocrState === 'error'
  || (props.embeddingState === 'loaded' && props.embeddingStatus !== 'configured')
  || (props.ocrState === 'loaded' && props.ocrStatus !== 'configured'))

const embeddingTone = computed<Tone>(() => {
  if (props.embeddingState === 'error') return 'danger'
  if (props.embeddingState === 'loading') return 'info'
  return props.embeddingStatus === 'configured' ? 'success' : 'warning'
})
const ocrTone = computed<Tone>(() => {
  if (props.ocrState === 'error') return 'danger'
  if (props.ocrState === 'loading') return 'info'
  if (props.ocrStatus === 'configured') return 'success'
  if (props.ocrStatus === 'disabled') return 'info'
  return 'warning'
})
const embeddingBadge = computed(() => {
  if (props.embeddingState === 'error') return t('knowledge.setup.loadFailed')
  if (props.embeddingState === 'loading') return t('knowledge.setup.loading')
  if (props.embeddingStatus === 'configured') return t('knowledge.setup.badgeReady')
  if (props.embeddingStatus === 'unavailable') return t('knowledge.setup.badgeUnavailable')
  return t('knowledge.setup.badgeMissing')
})
const ocrBadge = computed(() => {
  if (props.ocrState === 'error') return t('knowledge.setup.loadFailed')
  if (props.ocrState === 'loading') return t('knowledge.setup.loading')
  if (props.ocrStatus === 'configured') return t('knowledge.setup.badgeReady')
  if (props.ocrStatus === 'disabled') return t('knowledge.setup.ocrDisabled')
  return t('knowledge.setup.badgeIncomplete')
})

const showEmbeddingHint = computed(() => props.embeddingState !== 'loaded' || props.embeddingStatus !== 'configured')
const showOcrHint = computed(() => props.ocrState !== 'loaded' || props.ocrStatus !== 'configured')
const embeddingHint = computed(() => t(
  props.embeddingState === 'error' ? 'knowledge.setup.modelsLoadFailed'
    : props.embeddingStatus === 'unavailable' ? 'knowledge.setup.modelUnavailableHint'
      : 'knowledge.setup.noEmbeddingHint',
))
const ocrHint = computed(() => t(props.ocrState === 'error' ? 'knowledge.setup.ocrLoadFailed' : 'knowledge.setup.ocrHint'))
</script>

<style scoped>
.setup-dot {
  display: inline-block;
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 9999px;
}
.setup-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 7px;
  border-radius: 5px;
  font-size: 11px;
  line-height: 1.5;
  font-weight: 600;
}
</style>
