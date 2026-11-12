<template>
  <button
    ref="rootEl"
    type="button"
    class="group relative flex w-full flex-col overflow-hidden rounded-xl border border-gray-200 bg-(--gd-color-surface) text-left transition-colors hover:border-[#409eff]/60 dark:border-[#2e3035]"
    @click="emit('open', pet)"
  >
    <!-- 192:208 = Codex 单格比例，正好一格填满，不变形 -->
    <div class="relative aspect-[12/13] w-full overflow-hidden bg-black/5 dark:bg-white/5">
      <!--
        三档取图，优先小的：
        1. thumb  —— 官网预裁的 idle 第一格（~8KB），四周留边距，不顶满
        2. sprite —— 有 rows 才切格（rows 缺失时切不准，会露出半个身子）
        3. preview—— OG 海报，完整显示不裁切（最老的条目）
      -->
      <div v-if="thumbUrl" class="absolute inset-0 flex items-center justify-center p-4">
        <img
          :src="thumbUrl"
          :alt="pet.name"
          loading="lazy"
          decoding="async"
          class="h-full w-full object-contain"
          draggable="false"
        />
      </div>
      <div
        v-else-if="spriteUrl && spriteRows"
        class="absolute inset-0 bg-no-repeat"
        :style="{
          backgroundImage: `url(${spriteUrl})`,
          backgroundSize: `800% ${spriteRows * 100}%`,
          backgroundPosition: '0 0',
          imageRendering: 'pixelated',
        }"
        role="img"
        :aria-label="pet.name"
      />
      <div v-else class="absolute inset-0 flex items-center justify-center overflow-hidden p-4">
        <img
          :src="pet.preview"
          :alt="pet.name"
          loading="lazy"
          decoding="async"
          class="h-full w-full object-contain"
          draggable="false"
        />
      </div>

      <span
        class="absolute left-1.5 top-1.5 rounded bg-black/55 px-1 py-0.5 text-[10px] leading-none text-white/90"
      >{{ sourceName }}</span>
    </div>

    <div class="flex items-center gap-2 px-2 py-1.5">
      <div class="min-w-0 flex-1">
        <div class="truncate text-xs font-medium text-gray-800 dark:text-[#d0d1d5]">{{ pet.name }}</div>
        <div class="truncate text-[10px] text-gray-500 dark:text-[#8b8d95]">
          {{ pet.author || t('settings.pet.marketUnknownAuthor') }}
        </div>
      </div>
      <GdButton
        size="tiny"
        :loading="busy === pet.slug"
        :disabled="Boolean(busy) && busy !== pet.slug"
        @click.stop="emit('install', pet)"
      >{{ t('settings.pet.marketInstall') }}</GdButton>
    </div>
  </button>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import GdButton from '@/components/ui/GdButton.vue'
import type { MarketPet } from '@/utils/petMarket'

const props = defineProps<{
  pet: MarketPet
  sourceName: string
  /** 当前正在安装的 slug，null = 空闲 */
  busy: string | null
  /** 索引里没 sprite 时，父级按需抓回来的精灵图 */
  lazySprite?: { sprite: string; rows?: number } | null
}>()
// 卡片整体是按钮：点卡片 → 开详情弹窗（不跳浏览器）
const emit = defineEmits<{
  (e: 'install', pet: MarketPet): void
  (e: 'open', pet: MarketPet): void
  /** 卡片进入视口且没有 sprite → 让父级按需抓一次 */
  (e: 'visible', pet: MarketPet): void
}>()

const { t } = useI18n()
const rootEl = ref<HTMLElement | null>(null)

const spriteUrl = computed(() => props.lazySprite?.sprite || props.pet.sprite || '')
const spriteRows = computed(() => props.lazySprite?.rows || props.pet.rows)
/** 官网预裁缩略图（主进程已补成绝对 URL） */
const thumbUrl = computed(() => props.pet.thumb || '')

let observer: IntersectionObserver | null = null

onMounted(() => {
  // 只有索引里没有 sprite 才需要按需抓（避免无谓请求）
  if (props.pet.sprite || !rootEl.value || typeof IntersectionObserver === 'undefined') return
  observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      emit('visible', props.pet)
      observer?.disconnect()
      observer = null
    },
    { rootMargin: '120px' },
  )
  observer.observe(rootEl.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
})
</script>
