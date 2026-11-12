<template>
  <GdDialog
    :model-value="modelValue"
    :title="detail?.name || pet?.name || t('settings.pet.marketDetailTitle')"
    size="sm"
    align-center
    destroy-on-close
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <div class="flex flex-col gap-4">
      <!-- 宠物本体：用官方精灵图播放 idle（比卡片里的海报图清楚得多） -->
      <div class="flex items-start gap-4">
        <div
          class="relative flex h-[140px] w-[140px] shrink-0 items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-black/[0.03] p-2.5 dark:border-[#2e3035] dark:bg-white/[0.04]"
        >
          <canvas ref="canvasEl" width="120" height="120" class="h-full w-full" />
          <div
            v-if="loading"
            class="absolute inset-0 flex items-center justify-center text-[11px] text-gray-400"
          >{{ t('settings.pet.marketDetailLoading') }}</div>
        </div>

        <div class="min-w-0 flex-1">
          <div class="text-base font-semibold text-gray-900 dark:text-[#e8e9ed]">
            {{ detail?.name || pet?.name }}
          </div>
          <div class="mt-0.5 text-xs text-gray-500 dark:text-[#8b8d95]">
            {{ pet?.author || t('settings.pet.marketUnknownAuthor') }}
            <span v-if="detail?.genre"> · {{ detail.genre }}</span>
          </div>
          <div v-if="detail?.publishedAt" class="mt-1 text-[11px] text-gray-400 dark:text-[#6b6d75]">
            {{ formatDate(detail.publishedAt) }}
          </div>
          <div v-if="detail?.keywords?.length" class="mt-2 flex flex-wrap gap-1">
            <span
              v-for="kw in detail.keywords.slice(0, 5)"
              :key="kw"
              class="rounded bg-gray-500/10 px-1.5 py-0.5 text-[10px] text-gray-600 dark:text-[#b9bbc1]"
            >{{ kw }}</span>
          </div>
          <p class="mt-2 line-clamp-3 text-xs leading-relaxed text-gray-600 dark:text-[#a8aab2]">
            {{ detail?.description || t('settings.pet.marketNoDescription') }}
          </p>
        </div>
      </div>

      <div
        v-if="error"
        class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-300"
      >{{ error }}</div>

      <!-- 来源说明 -->
      <p class="text-[11px] text-gray-500 dark:text-[#8b8d95]">
        {{ t('settings.pet.marketDetailSource') }}
      </p>
    </div>

    <template #footer>
      <div class="flex w-full items-center justify-between gap-2">
        <GdButton size="small" text @click="openPage">
          {{ t('settings.pet.marketOpenPage') }}
        </GdButton>
        <div class="flex items-center gap-2">
          <GdButton size="small" @click="emit('update:modelValue', false)">
            {{ t('common.cancel') }}
          </GdButton>
          <GdButton
            size="small"
            type="primary"
            :loading="Boolean(busy) && busy === pet?.slug"
            :disabled="Boolean(busy) && busy !== pet?.slug"
            @click="handleInstall"
          >
            {{ t('settings.pet.marketInstall') }}
          </GdButton>
        </div>
      </div>
    </template>
  </GdDialog>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import GdButton from '@/components/ui/GdButton.vue'
import GdDialog from '@/components/ui/GdDialog.vue'
import type { MarketPet } from '@/utils/petMarket'

const props = defineProps<{
  modelValue: boolean
  pet: MarketPet | null
  /** 正在安装的 slug（父级持有）；与当前宠物一致时按钮转圈 */
  busy?: string | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'install', pet: MarketPet): void
}>()

const { t } = useI18n()

interface Detail {
  slug: string
  name: string
  description: string
  spriteUrl: string
  genre?: string
  keywords?: string[]
  publishedAt?: string
  page: string
}

const detail = ref<Detail | null>(null)
const loading = ref(false)
const error = ref('')
const canvasEl = ref<HTMLCanvasElement | null>(null)

/** idle 行逐帧时长（Codex 契约，官网页面里也是 1100ms/6 帧） */
const IDLE_DURATIONS = [280, 110, 110, 140, 140, 320]
let rafId = 0
let frameIndex = 0
let startedAt = 0
let atlasImg: HTMLImageElement | null = null
let cellW = 0
let cellH = 0

const stopLoop = () => {
  if (rafId) cancelAnimationFrame(rafId)
  rafId = 0
  atlasImg = null
  frameIndex = 0
  startedAt = 0
}

const drawFrame = () => {
  const canvas = canvasEl.value
  const img = atlasImg
  if (!canvas || !img || !cellW || !cellH) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const dpr = window.devicePixelRatio || 1
  const size = canvas.clientWidth || 132
  const target = Math.round(size * dpr)
  if (canvas.width !== target) {
    canvas.width = target
    canvas.height = target
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  // 只画第 0 行（idle）的第 frameIndex 格，等比缩放到方形容器
  const scale = target / Math.max(cellW, cellH)
  const dw = cellW * scale
  const dh = cellH * scale
  ctx.drawImage(
    img,
    frameIndex * cellW,
    0,
    cellW,
    cellH,
    (target - dw) / 2,
    (target - dh) / 2,
    dw,
    dh,
  )
}

const loop = (ts: number) => {
  if (!atlasImg) return
  rafId = requestAnimationFrame(loop)
  if (!startedAt) startedAt = ts
  const duration = IDLE_DURATIONS[frameIndex] ?? 150
  if (ts - startedAt >= duration) {
    startedAt += duration
    if (ts - startedAt > 1000) startedAt = ts
    frameIndex = (frameIndex + 1) % IDLE_DURATIONS.length
  }
  drawFrame()
}

/**
 * 加载精灵图并开始播放。
 *
 * 行数/格子尺寸现算：宽/8 得格宽，格高固定 208/192 比例
 * （官方 1536×1872 → 9 行；ChatGPT 导出的 1536×2288 → 11 行，第 0 行同样是 idle 6 帧）。
 */
const startPreview = (url: string) => {
  stopLoop()
  error.value = ''
  const img = new Image()
  // 不要设 crossOrigin：这里只 drawImage 显示，不读像素（不需 getImageData）。
  // 带 crossOrigin='anonymous' 会走独立的 CORS 请求：实测同一张图要 7.7s，
  // 且部分资源直接 onerror（CORS 响应不一致）—— 表现为「预览加载失败」。
  img.onload = () => {
    cellW = img.naturalWidth / 8
    cellH = cellW * (208 / 192)
    atlasImg = img
    startedAt = 0
    frameIndex = 0
    rafId = requestAnimationFrame(loop)
  }
  img.onerror = () => {
    error.value = t('settings.pet.marketDetailPreviewFailed')
  }
  img.src = url
}

const loadDetail = async (slug: string) => {
  detail.value = null
  error.value = ''
  stopLoop()

  // 索引里已经带详情（官网预抓）→ 零请求秒开，直接用
  const cached = props.pet
  if (cached && cached.slug === slug && (cached.description || cached.sprite)) {
    detail.value = {
      slug,
      name: cached.name,
      description: cached.description || '',
      spriteUrl: cached.sprite || '',
      genre: cached.genre,
      keywords: cached.keywords,
      publishedAt: cached.publishedAt,
      page: cached.page,
    }
    if (cached.sprite) startPreview(cached.sprite)
    return
  }

  // 兜底：老索引没有详情时，才让主进程按需抓
  if (!window.electronAPI?.fetchPetDetail) return
  loading.value = true
  try {
    const result = await window.electronAPI.fetchPetDetail(slug)
    if (!result.ok || !result.detail) {
      error.value = result.error || t('settings.pet.marketDetailFailed')
      return
    }
    detail.value = result.detail
    startPreview(result.detail.spriteUrl)
  } catch (e) {
    error.value = (e as Error)?.message || t('settings.pet.marketDetailFailed')
  } finally {
    loading.value = false
  }
}

const formatDate = (value: string): string => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString()
}

const openPage = () => {
  const url = detail.value?.page || props.pet?.page
  if (url) void window.electronAPI?.openExternal?.(url)
}

const handleInstall = () => {
  if (props.pet) emit('install', props.pet)
}

watch(
  () => [props.modelValue, props.pet?.slug] as const,
  ([visible, slug]) => {
    if (!visible || !slug) {
      stopLoop()
      return
    }
    void loadDetail(slug)
  },
  { immediate: true },
)

onBeforeUnmount(stopLoop)
</script>
