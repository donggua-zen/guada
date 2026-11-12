<template>
  <div class="flex h-full flex-col">
    <!-- 视图条：复用插件/技能市场的二级切换（按内容宽度收在左侧，不平铺整行） -->
    <div class="mb-4 flex items-center gap-2">
      <PluginViewSwitch v-model="view" :items="viewItems" />
      <span class="text-xs text-gray-500 dark:text-[#8b8d95]">
        {{ view === 'market' ? t('settings.pet.marketHint') : t('settings.pet.avatarHint') }}
      </span>
    </div>

    <!-- 市场视图常驻（切走不销毁，搜索词/滚动位置保留） -->
    <div v-show="view === 'market'" class="min-h-0 flex-1">
      <PetMarketView @installed="(id) => { void afterImport(id) }" />
    </div>

    <div v-show="view === 'avatars'" class="min-h-0 flex-1 space-y-8 overflow-y-auto pr-1">
      <!-- 形象选择 -->
      <div>
        <h3 class="text-sm font-semibold text-gray-900 dark:text-[#e8e9ed] mb-3">
          {{ t('settings.pet.avatarTitle') }}
        </h3>
        <div class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-(--gd-color-surface) p-4">
          <div v-if="avatars.length > 0" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            <button
              v-for="avatar in avatars"
              :key="avatar.id"
              type="button"
              class="group relative flex flex-col items-center gap-2 rounded-xl border-2 p-3 transition-all duration-150"
              :class="avatar.id === selectedAvatarId
                ? 'border-[#409eff] bg-[#409eff]/5'
                : 'border-gray-200 dark:border-[#2e3035] hover:border-[#409eff]/50'"
              @click="selectAvatar(avatar.id)"
            >
              <img
                v-if="avatar.previewDataUrl || atlasPreviews[avatar.id]"
                :src="avatar.previewDataUrl || atlasPreviews[avatar.id]"
                :alt="avatar.name"
                class="h-32 w-full object-contain pointer-events-none select-none"
                draggable="false"
              />
              <div
                v-else
                class="h-32 w-full flex items-center justify-center text-xs text-gray-400 dark:text-[#6b6d75]"
              >
                {{ t('settings.pet.noPreview') }}
              </div>
              <span class="text-xs font-medium text-gray-700 dark:text-[#d0d1d5]">{{ avatar.name }}</span>
              <!-- 来源标记：内置的不标，其余标出来源（Petdex/Codex 是只读扫描目录） -->
              <span
                v-if="avatar.source !== 'bundled'"
                class="absolute top-2 left-2 rounded px-1 py-0.5 text-[10px] leading-none"
                :class="sourceBadgeClass(avatar)"
                :title="avatar.description || avatar.name"
              >{{ sourceLabel(avatar.source) }}</span>
              <span
                v-if="avatar.id === selectedAvatarId"
                class="absolute top-2 right-2 flex h-4 w-4 items-center justify-center rounded-full bg-[#409eff] text-[10px] text-white"
              >✓</span>
            </button>
          </div>
          <div v-else class="text-xs text-gray-500 dark:text-[#8b8d95]">
            {{ t('settings.pet.emptyAvatars') }}
          </div>

          <!-- 导入入口：切到市场 tab / 本地文件夹 / Petdex 命令行 -->
          <div class="mt-4 flex flex-wrap items-center gap-2">
            <GdButton size="small" type="primary" @click="view = 'market'">
              {{ t('settings.pet.browseMarket') }}
            </GdButton>
            <GdButton size="small" :loading="importing" @click="handleImportFolder">
              {{ t('settings.pet.importFolder') }}
            </GdButton>
            <div class="flex items-center gap-2">
              <GdInput
                v-model="petdexSlug"
                size="small"
                :placeholder="t('settings.pet.petdexPlaceholder')"
                style="width: 160px;"
                @keyup.enter="handleInstallPetdex"
              />
              <GdButton size="small" :loading="installing" @click="handleInstallPetdex">
                {{ t('settings.pet.installPetdex') }}
              </GdButton>
            </div>
            <GdButton size="small" text @click="handleOpenFolder">
              {{ t('settings.pet.openFolder') }}
            </GdButton>
          </div>

          <p class="mt-3 text-xs text-gray-500 dark:text-[#8b8d95]">
            {{ t('settings.pet.avatarHint') }}
          </p>
        </div>
      </div>

      <!-- 显示与外观 -->
      <div>
        <h3 class="text-sm font-semibold text-gray-900 dark:text-[#e8e9ed] mb-3">
          {{ t('settings.pet.behaviorTitle') }}
        </h3>
        <div class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-(--gd-color-surface) overflow-hidden">
          <!-- 显隐开关 -->
          <div class="px-4 py-3.5 flex items-center justify-between gap-4 border-b border-gray-100 dark:border-[#2e3035]">
            <div class="flex flex-col gap-1 min-w-0">
              <span class="text-base text-gray-900 dark:text-[#e8e9ed]">{{ t('settings.pet.enable') }}</span>
              <span class="text-xs text-gray-500 dark:text-[#8b8d95]">{{ t('settings.pet.enableDesc') }}</span>
            </div>
            <GdSwitch v-model="enabled" size="large" @change="handleSave" />
          </div>

          <!-- 透明度调节 -->
          <div class="px-4 py-3.5 flex items-center justify-between gap-4">
            <div class="flex flex-col gap-1 min-w-0">
              <span class="text-base text-gray-900 dark:text-[#e8e9ed]">{{ t('settings.pet.opacity') }}</span>
              <span class="text-xs text-gray-500 dark:text-[#8b8d95]">{{ t('settings.pet.opacityDesc') }}</span>
            </div>
            <div class="flex items-center gap-3 shrink-0 w-48">
              <GdSlider v-model="opacity" :min="30" :max="100" :step="1" class="flex-1" @change="handleSave" />
              <span class="text-sm text-gray-600 dark:text-[#8b8d95] w-10 text-right">{{ opacity }}%</span>
            </div>
          </div>

          <!-- 大小（按形象单独记忆：不同素材的视觉大小差很多） -->
          <div class="px-4 py-3.5 flex items-center justify-between gap-4 border-t border-gray-100 dark:border-[#2e3035]">
            <div class="flex flex-col gap-1 min-w-0">
              <span class="text-base text-gray-900 dark:text-[#e8e9ed]">{{ t('settings.pet.size') }}</span>
              <span class="text-xs text-gray-500 dark:text-[#8b8d95]">{{ t('settings.pet.sizeDesc') }}</span>
            </div>
            <div class="flex items-center gap-3 shrink-0 w-48">
              <GdSlider
                v-model="scalePercent"
                :min="60"
                :max="200"
                :step="5"
                class="flex-1"
                @change="handleScaleChange"
              />
              <span class="text-sm text-gray-600 dark:text-[#8b8d95] w-10 text-right">{{ scalePercent }}%</span>
            </div>
          </div>

          <!-- 播放速度（全局；Codex 官方 idle 是 6 帧 1.1 秒，有人会觉得眨眼偏密） -->
          <div class="px-4 py-3.5 flex items-center justify-between gap-4 border-t border-gray-100 dark:border-[#2e3035]">
            <div class="flex flex-col gap-1 min-w-0">
              <span class="text-base text-gray-900 dark:text-[#e8e9ed]">{{ t('settings.pet.speed') }}</span>
              <span class="text-xs text-gray-500 dark:text-[#8b8d95]">{{ t('settings.pet.speedDesc') }}</span>
            </div>
            <div class="flex items-center gap-3 shrink-0 w-48">
              <GdSlider
                v-model="speedPercent"
                :min="25"
                :max="200"
                :step="5"
                class="flex-1"
                @change="handleSpeedChange"
              />
              <span class="text-sm text-gray-600 dark:text-[#8b8d95] w-10 text-right">{{ speedPercent }}%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import GdSwitch from '@/components/ui/GdSwitch.vue'
import GdSlider from '@/components/ui/GdSlider.vue'
import GdButton from '@/components/ui/GdButton.vue'
import GdInput from '@/components/ui/GdInput.vue'
import PluginViewSwitch from '@/components/plugins/PluginViewSwitch.vue'
import PetMarketView from './PetMarketView.vue'
import { confirmPetInstall } from '@/utils/petInstall'
import { apiService } from '@/services/ApiService'
import { useLayoutStore } from '@/stores/layout'
import { toast } from '@/components/ui/toastService'

interface PetAvatarOption {
  id: string
  name: string
  description?: string
  format: 'frames' | 'atlas'
  source: 'user' | 'petdex' | 'codex' | 'bundled'
  previewDataUrl: string | null
  /** atlas 素材：整张图集（主进程解不了 WebP，只能交给渲染层裁一格） */
  sheetDataUrl?: string | null
  previewCell?: { x: number; y: number; w: number; h: number }
}

const { t } = useI18n()
const layoutStore = useLayoutStore()

/** 来源徽标文案（bundled 不标） */
const sourceLabel = (source: PetAvatarOption['source']): string => {
  if (source === 'petdex') return t('settings.pet.badgePetdex')
  if (source === 'codex') return t('settings.pet.badgeCodexDir')
  return t('settings.pet.badgeUser')
}

/** Petdex/Codex 是「外部目录里的」，用蓝色区分；自己导入的用灰 */
const sourceBadgeClass = (avatar: PetAvatarOption): string =>
  avatar.source === 'petdex' || avatar.source === 'codex'
    ? 'bg-[#409eff]/15 text-[#2b7cd3]'
    : 'bg-gray-500/15 text-gray-600 dark:text-[#b9bbc1]'

/** 二级视图：形象 / 市场（常驻，不销毁） */
const view = ref<'avatars' | 'market'>('avatars')
const viewItems = computed(() => [
  { value: 'avatars' as const, label: t('settings.pet.avatarTitle') },
  { value: 'market' as const, label: t('settings.pet.marketTitle') },
])

const avatars = ref<PetAvatarOption[]>([])
/** atlas 形象的预览（渲染层用 canvas 从图集裁一格，主进程解不了 WebP） */
const atlasPreviews = ref<Record<string, string>>({})
const selectedAvatarId = ref(layoutStore.petAvatarId)
const enabled = ref(layoutStore.petEnabled)
const opacity = ref(layoutStore.petOpacity)
/** 当前形象的大小（百分比，60–200）：按形象记忆，切形象时回显 */
const scalePercent = ref(Math.round(layoutStore.getPetScaleOf(layoutStore.petAvatarId) * 100))
/** 播放速度（百分比，25–200；100 = Codex 官方节奏） */
const speedPercent = ref(Math.round(layoutStore.petAnimationSpeed * 100))
/** Petdex 安装输入框 / 两个导入按钮的忙闲态 */
const petdexSlug = ref('')
const importing = ref(false)
const installing = ref(false)

/**
 * 导入成功后统一收尾：刷新列表、选中新形象、落盘设置。
 * 主进程已经校验过素材，这里只负责让 UI 立刻跟上。
 */
const afterImport = async (id: string) => {
  await loadAvatars()
  if (avatars.value.some((a) => a.id === id)) {
    selectedAvatarId.value = id
    scalePercent.value = Math.round(layoutStore.getPetScaleOf(id) * 100)
    await handleSave()
  }
}

const handleImportFolder = async () => {
  if (!window.electronAPI?.importPetAvatar) return
  importing.value = true
  try {
    const result = await window.electronAPI.importPetAvatar()
    if (!result.ok) {
      // 用户主动取消不算错误，不弹提示
      if (result.error !== '已取消') toast.error(result.error || t('settings.pet.importFailed'))
      return
    }
    await afterImport(result.id as string)
    toast.success(t('settings.pet.importSuccess'))
  } catch (error) {
    console.error('导入桌宠失败:', error)
    toast.error(t('settings.pet.importFailed'))
  } finally {
    importing.value = false
  }
}

const handleInstallPetdex = async () => {
  const slug = petdexSlug.value.trim()
  if (!slug || !window.electronAPI?.installPetdex || installing.value) return
  // 与市场卡片共用同一个 UI 确认弹窗
  const ok = await confirmPetInstall(slug)
  if (!ok) return
  installing.value = true
  try {
    const result = await window.electronAPI.installPetdex(slug)
    if (!result.ok) {
      toast.error(result.error || t('settings.pet.importFailed'))
      return
    }
    petdexSlug.value = ''
    await afterImport(result.id as string)
    toast.success(t('settings.pet.importSuccess'))
  } catch (error) {
    console.error('Petdex 安装失败:', error)
    toast.error(t('settings.pet.importFailed'))
  } finally {
    installing.value = false
  }
}

const handleOpenFolder = () => window.electronAPI?.openPetsFolder?.()

/**
 * 从图集裁出一格当预览。
 * 主进程的 nativeImage 不支持 WebP，所以由渲染层解码 + 裁剪。
 */
function cropSheetCell(
  sheetUrl: string,
  cell: { x: number; y: number; w: number; h: number },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = cell.w
      canvas.height = cell.h
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('canvas 不可用'))
        return
      }
      ctx.drawImage(img, cell.x, cell.y, cell.w, cell.h, 0, 0, cell.w, cell.h)
      resolve(canvas.toDataURL('image/webp', 0.9))
    }
    img.onerror = () => reject(new Error('图集解码失败'))
    img.src = sheetUrl
  })
}

async function buildAtlasPreviews() {
  for (const avatar of avatars.value) {
    if (avatar.format !== 'atlas' || !avatar.sheetDataUrl || !avatar.previewCell) continue
    if (atlasPreviews.value[avatar.id]) continue
    try {
      const dataUrl = await cropSheetCell(avatar.sheetDataUrl, avatar.previewCell)
      atlasPreviews.value = { ...atlasPreviews.value, [avatar.id]: dataUrl }
    } catch (error) {
      console.error(`预制预览失败 ${avatar.id}:`, error)
    }
  }
}

/** 形象列表来自主进程扫盘（build-resources/pets/*），浏览器环境没有该能力 */
const loadAvatars = async () => {
  if (!window.electronAPI?.listPetAvatars) {
    avatars.value = []
    return
  }
  try {
    avatars.value = await window.electronAPI.listPetAvatars()
    // 选中的形象已不存在（目录被删）→ 回落到列表第一个
    if (avatars.value.length > 0 && !avatars.value.some((a) => a.id === selectedAvatarId.value)) {
      selectedAvatarId.value = avatars.value[0].id
    }
    void buildAtlasPreviews()
  } catch (error) {
    console.error('读取桌宠形象失败:', error)
    avatars.value = []
  }
}

/**
 * 以 `pet` 分组为准回读一次。
 * 不直接依赖 layout store：store 由 MainLayout 挂载时异步加载，
 * 用户抢先打开设置页会读到 localStorage 里的旧值。
 * 分组为空时保留 store 的值（store 内部已做过 appearance 旧键迁移）。
 */
const loadSettings = async () => {
  try {
    const saved = await apiService.fetchGroupSettings<Record<string, unknown>>('pet')
    if (typeof saved?.enabled === 'boolean') enabled.value = saved.enabled
    if (typeof saved?.opacity === 'number') opacity.value = saved.opacity
    if (typeof saved?.avatarId === 'string' && saved.avatarId) {
      selectedAvatarId.value = saved.avatarId
    }
    // 回显该形象记住的大小（分组里的 scales 已由 store 载入）
    scalePercent.value = Math.round(layoutStore.getPetScaleOf(selectedAvatarId.value) * 100)
    speedPercent.value = Math.round(layoutStore.petAnimationSpeed * 100)
  } catch (error) {
    console.error('读取桌宠设置失败:', error)
  }
}

const selectAvatar = (id: string) => {
  if (id === selectedAvatarId.value) return
  selectedAvatarId.value = id
  // 切形象时回显那个形象自己记住的大小
  scalePercent.value = Math.round(layoutStore.getPetScaleOf(id) * 100)
  handleSave()
}

/** 大小滑块：先写进 store（按当前形象记），再统一落盘 */
const handleScaleChange = () => {
  layoutStore.setPetScale(scalePercent.value / 100)
  handleSave()
}

/** 速度滑块：全局，立刻生效（不等落盘） */
const handleSpeedChange = () => {
  layoutStore.setPetAnimationSpeed(speedPercent.value / 100)
  layoutStore.applyPetSettings()
  handleSave()
}

/** 统一落盘 + 同步 store + 推给主进程 */
const handleSave = async () => {
  layoutStore.setPetEnabled(enabled.value)
  layoutStore.setPetOpacity(opacity.value)
  layoutStore.setPetAvatarId(selectedAvatarId.value)
  layoutStore.setPetScale(scalePercent.value / 100)
  layoutStore.setPetAnimationSpeed(speedPercent.value / 100)
  layoutStore.applyPetSettings()

  try {
    await apiService.updateGroupSettings('pet', {
      enabled: enabled.value,
      opacity: opacity.value,
      avatarId: selectedAvatarId.value,
      animationSpeed: speedPercent.value / 100,
      // 每形象大小记忆（整体覆盖写，避免后端无法删键导致旧值残留）
      scales: layoutStore.petScales,
    })
  } catch (error) {
    console.error('保存桌宠设置失败:', error)
    toast.error(t('settings.pet.saveFailed'))
  }
}

/** 外部目录变化（终端里 petdex install / Codex 装了新宠物）时刷新列表 */
let unsubscribeAvatars: (() => void) | null = null
/** 窗口重新获得焦点时也刷一次：兜住「目录在应用启动后才被创建、没能挂上 fs.watch」的情况 */
const handleWindowFocus = () => {
  void loadAvatars()
}

onMounted(async () => {
  await loadSettings()
  await loadAvatars()
  unsubscribeAvatars = window.electronAPI?.onPetAvatarsChanged?.(() => {
    void loadAvatars()
  }) ?? null
  window.addEventListener('focus', handleWindowFocus)
})

onUnmounted(() => {
  unsubscribeAvatars?.()
  unsubscribeAvatars = null
  window.removeEventListener('focus', handleWindowFocus)
})
</script>
