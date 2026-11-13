<template>
  <!--
    宠物市场：作为 PetSettings 的二级 tab 常驻（不是弹窗）。
    参照插件市场的做法：视图条由父级持有，本组件只负责内容，
    切出去再回来搜索词与滚动位置都在，也方便以后加推荐位/合集。
  -->
  <div class="flex h-full flex-col">
    <!-- 工具栏 -->
    <div class="flex flex-wrap items-center gap-2 pb-3">
      <span v-if="index" class="text-xs text-gray-500 dark:text-[#8b8d95]">
        {{ t('settings.pet.marketCount', { n: index.count }) }}
      </span>
      <div class="ml-auto flex items-center gap-2">
        <GdInput
          v-model="keyword"
          size="small"
          clearable
          :placeholder="t('settings.pet.marketSearch')"
          style="width: 220px;"
        />
        <GdButton size="small" :loading="loading" @click="load(true)">
          {{ t('settings.pet.marketRefresh') }}
        </GdButton>
        <GdButton size="small" text @click="openHomepage">
          {{ t('settings.pet.marketHomepage') }}
        </GdButton>
      </div>
    </div>

    <!-- 提示条：拉远端失败但用了旧缓存 -->
    <div
      v-if="banner"
      class="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-300"
    >
      {{ banner }}
    </div>

    <!-- 内容（自身滚动，父级高度固定） -->
    <div class="min-h-0 flex-1 overflow-y-auto pr-1" @scroll="onScroll">
      <div v-if="loading && !index" class="flex h-full items-center justify-center text-sm text-gray-500">
        {{ t('settings.pet.marketLoading') }}
      </div>

      <div v-else-if="!index" class="flex h-full flex-col items-center justify-center gap-3 text-sm text-gray-500">
        <span>{{ t('settings.pet.marketFailed') }}</span>
        <span v-if="errorText" class="max-w-md break-all text-center text-xs opacity-70">{{ errorText }}</span>
        <GdButton size="small" @click="load(true)">{{ t('settings.pet.marketRetry') }}</GdButton>
      </div>

      <template v-else>
        <!-- 推荐位：只在没搜索时显示，方便以后改成「编辑精选 / 本周热门」 -->
        <section v-if="!keyword.trim() && featured.length > 0" class="mb-5">
          <h4 class="mb-2 text-xs font-semibold text-gray-700 dark:text-[#d0d1d5]">
            {{ t('settings.pet.marketFeatured') }}
          </h4>
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            <PetCard
              v-for="pet in featured"
              :key="`f-${pet.slug}`"
              :pet="pet"
              :source-name="index.sourceName"
              :busy="installing"
              :lazy-sprite="lazySprites[pet.slug]"
              @install="install"
              @open="openDetail"
              @visible="requestSprite"
            />
          </div>
        </section>

        <div v-if="filtered.length === 0" class="flex h-40 items-center justify-center text-sm text-gray-500">
          {{ t('settings.pet.marketEmpty') }}
        </div>

        <div v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          <PetCard
            v-for="pet in visiblePets"
            :key="pet.slug"
            :pet="pet"
            :source-name="index.sourceName"
            :busy="installing"
            :lazy-sprite="lazySprites[pet.slug]"
            @install="install"
            @open="openDetail"
            @visible="requestSprite"
          />
        </div>

        <div v-if="filtered.length > visiblePets.length" class="py-4 text-center text-xs text-gray-500">
          <GdButton size="small" text @click="loadMore">{{ t('settings.pet.marketMore') }}</GdButton>
        </div>
      </template>
    </div>

    <!-- 详情弹窗：点卡片打开（不直接跳浏览器），里面可看宠物真身 -->
    <PetDetailDialog
      v-model="detailOpen"
      :pet="detailPet"
      :busy="installing"
      @install="install"
    />

    <!-- 来源与授权 -->
    <div class="flex items-center gap-3 border-t border-gray-100 pt-2 text-[11px] text-gray-500 dark:border-[#2e3035] dark:text-[#8b8d95]">
      <span class="flex-1">{{ index?.attribution || t('settings.pet.marketAttribution') }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import GdButton from '@/components/ui/GdButton.vue'
import GdInput from '@/components/ui/GdInput.vue'
import PetCard from './PetCard.vue'
import PetDetailDialog from './PetDetailDialog.vue'
import { toast } from '@/components/ui/toastService'
import { confirmPetInstall } from '@/utils/petInstall'
import {
  fetchPetMarketIndex,
  type MarketPet,
  type PetMarketIndex,
} from '@/utils/petMarket'

const emit = defineEmits<{ (e: 'installed', id: string): void }>()

const { t } = useI18n()

/** 推荐位兜底：索引没下发 featured 时用这份（正常情况以索引为准） */
const FALLBACK_FEATURED = ['boba', 'lulu-capybara-2', 'doraemon', 'paperclip']

/** 首屏数量 / 每次加载更多 */
const PAGE_SIZE = 60

const index = ref<PetMarketIndex | null>(null)
const loading = ref(false)
const banner = ref('')
/** 失败时的真实原因 */
const errorText = ref('')
const keyword = ref('')
const visibleCount = ref(PAGE_SIZE)
const installing = ref<string | null>(null)
/** 详情弹窗：点卡片打开，不直接跳浏览器 */
const detailOpen = ref(false)
const detailPet = ref<MarketPet | null>(null)

const openDetail = (pet: MarketPet) => {
  detailPet.value = pet
  detailOpen.value = true
}

/**
 * 索引里还没有 sprite 的条目：卡片进入视口时按需抓一次详情（带内存缓存 + 并发上限）。
 *
 * 为什么需要：索引是官网定时任务抓的，新宠物 / 尚未抓到的条目没有 sprite。
 * 这时候卡片回退 OG 海报会显得小，所以补一次详情请求（每只只发一次，
 * 同一会话内命中即缓存）。并发限 3，避免一次滚动打出几十个请求。
 */
const lazySprites = ref<Record<string, { sprite: string; rows?: number }>>({})
const spritePending = new Set<string>()
const spriteQueue: string[] = []
let spriteActive = 0
const SPRITE_CONCURRENCY = 3

const pumpSpriteQueue = () => {
  while (spriteActive < SPRITE_CONCURRENCY && spriteQueue.length > 0) {
    const slug = spriteQueue.shift()!
    if (lazySprites.value[slug]) {
      spritePending.delete(slug)
      continue
    }
    spriteActive += 1
    void (async () => {
      try {
        const result = await window.electronAPI?.fetchPetDetail?.(slug)
        if (result?.ok && result.detail?.spriteUrl) {
          lazySprites.value = {
            ...lazySprites.value,
            [slug]: { sprite: result.detail.spriteUrl },
          }
        }
      } catch {
        /* 拿不到就继续用 OG 兜底，不打扰用户 */
      } finally {
        spriteActive -= 1
        spritePending.delete(slug)
        pumpSpriteQueue()
      }
    })()
  }
}

const requestSprite = (pet: MarketPet) => {
  if (pet.sprite || lazySprites.value[pet.slug] || spritePending.has(pet.slug)) return
  spritePending.add(pet.slug)
  spriteQueue.push(pet.slug)
  pumpSpriteQueue()
}

const featured = computed<MarketPet[]>(() => {
  const list = index.value?.pets ?? []
  // 推荐位以索引下发为准（官网运营位）；老索引没有 featured 字段时用兜底名单
  const slugs = index.value?.featured?.length ? index.value.featured : FALLBACK_FEATURED
  return slugs
    .map((slug) => list.find((p) => p.slug === slug))
    .filter((p): p is MarketPet => Boolean(p))
})

const filtered = computed<MarketPet[]>(() => {
  const list = index.value?.pets ?? []
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return list
  return list.filter(
    (p) =>
      p.name.toLowerCase().includes(kw) ||
      p.slug.toLowerCase().includes(kw) ||
      p.author.toLowerCase().includes(kw),
  )
})

const visiblePets = computed(() => filtered.value.slice(0, visibleCount.value))

const load = async (force = false) => {
  loading.value = true
  banner.value = ''
  errorText.value = ''
  try {
    // force（重试）时打散 URL，避免复用浏览器缓存里的坏响应
    const result = await fetchPetMarketIndex(force)
    if (!result.ok || !result.index) {
      index.value = null
      errorText.value = result.error || t('settings.pet.marketUnknownError')
      return
    }
    index.value = result.index
    visibleCount.value = PAGE_SIZE
  } catch (error) {
    console.error('读取宠物市场失败:', error)
    index.value = null
    errorText.value = (error as Error)?.message || t('settings.pet.marketUnknownError')
  } finally {
    loading.value = false
  }
}

const onScroll = (event: Event) => {
  const el = event.target as HTMLElement
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) loadMore()
}

const loadMore = () => {
  if (visiblePets.value.length >= filtered.value.length) return
  visibleCount.value += PAGE_SIZE
}

const install = async (pet: MarketPet) => {
  if (installing.value) return
  const api = window.electronAPI
  if (!api?.installFromMarket && !api?.installPetdex) return

  // 有直连通道（不需要 Node）就静默装；只有走 CLI 兜底时才需要那套「会执行第三方脚本」的确认
  const direct = Boolean(api.installFromMarket)
  if (!direct) {
    const ok = await confirmPetInstall(pet.slug)
    if (!ok) return
  }

  installing.value = pet.slug
  try {
    // 索引里带 sprite 就直接给主进程（少抓一次详情页）
    const result = direct
      ? await api.installFromMarket!(pet.slug, pet.sprite)
      : await api.installPetdex!(pet.slug)
    if (!result.ok) {
      toast.error(result.error || t('settings.pet.importFailed'))
      return
    }
    toast.success(t('settings.pet.importSuccess'))
    emit('installed', result.id || pet.slug)
  } catch (error) {
    console.error('安装宠物失败:', error)
    toast.error(t('settings.pet.importFailed'))
  } finally {
    installing.value = null
  }
}

const openHomepage = () => {
  const url = index.value?.homepage
  if (url) void window.electronAPI?.openExternal?.(url)
}

onMounted(() => void load(false))
</script>
