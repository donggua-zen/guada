<template>
  <div class="flex-1 overflow-hidden">
    <div class="space-y-8">
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
                v-if="avatar.previewDataUrl"
                :src="avatar.previewDataUrl"
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
              <span
                v-if="avatar.id === selectedAvatarId"
                class="absolute top-2 right-2 flex h-4 w-4 items-center justify-center rounded-full bg-[#409eff] text-[10px] text-white"
              >✓</span>
            </button>
          </div>
          <div v-else class="text-xs text-gray-500 dark:text-[#8b8d95]">
            {{ t('settings.pet.emptyAvatars') }}
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
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import GdSwitch from '@/components/ui/GdSwitch.vue'
import GdSlider from '@/components/ui/GdSlider.vue'
import { apiService } from '@/services/ApiService'
import { useLayoutStore } from '@/stores/layout'
import { toast } from '@/components/ui/toastService'

interface PetAvatarOption {
  id: string
  name: string
  previewDataUrl: string | null
}

const { t } = useI18n()
const layoutStore = useLayoutStore()

const avatars = ref<PetAvatarOption[]>([])
const selectedAvatarId = ref(layoutStore.petAvatarId)
const enabled = ref(layoutStore.petEnabled)
const opacity = ref(layoutStore.petOpacity)

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
  } catch (error) {
    console.error('读取桌宠设置失败:', error)
  }
}

const selectAvatar = (id: string) => {
  if (id === selectedAvatarId.value) return
  selectedAvatarId.value = id
  handleSave()
}

/** 统一落盘 + 同步 store + 推给主进程 */
const handleSave = async () => {
  layoutStore.setPetEnabled(enabled.value)
  layoutStore.setPetOpacity(opacity.value)
  layoutStore.setPetAvatarId(selectedAvatarId.value)
  layoutStore.applyPetSettings()

  try {
    await apiService.updateGroupSettings('pet', {
      enabled: enabled.value,
      opacity: opacity.value,
      avatarId: selectedAvatarId.value,
    })
  } catch (error) {
    console.error('保存桌宠设置失败:', error)
    toast.error(t('settings.pet.saveFailed'))
  }
}

onMounted(async () => {
  await loadSettings()
  await loadAvatars()
})
</script>
