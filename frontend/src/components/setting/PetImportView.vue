<template>
  <div class="space-y-5">
    <!-- 目录位置 -->
    <section>
      <h3 class="mb-2 text-sm font-semibold text-gray-900 dark:text-[#e8e9ed]">
        {{ t('settings.pet.importDirTitle') }}
      </h3>
      <div class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-(--gd-color-surface) p-4">
        <p class="mb-3 text-xs leading-relaxed text-gray-500 dark:text-[#8b8d95]">
          {{ t('settings.pet.importDirDesc') }}
        </p>
        <div class="flex flex-wrap items-center gap-2">
          <code
            class="min-w-0 flex-1 select-all truncate rounded-lg bg-gray-500/8 px-3 py-2 font-mono text-xs text-gray-700 dark:bg-white/5 dark:text-[#d0d1d5]"
            :title="petsDir"
          >{{ petsDir || '…' }}</code>
          <GdButton size="small" @click="handleOpenFolder">
            {{ t('settings.pet.openFolder') }}
          </GdButton>
        </div>
        <p class="mt-2 text-[11px] text-gray-400 dark:text-[#6b6d75]">
          {{ t('settings.pet.importDirNote') }}
        </p>
      </div>
    </section>

    <!-- 一键从文件夹导入 -->
    <section>
      <div class="flex items-center justify-between gap-4 rounded-xl border border-gray-200 dark:border-[#2e3035] bg-(--gd-color-surface) px-4 py-3.5">
        <div class="min-w-0">
          <div class="text-base text-gray-900 dark:text-[#e8e9ed]">
            {{ t('settings.pet.importFolder') }}
          </div>
          <div class="text-xs text-gray-500 dark:text-[#8b8d95]">
            {{ t('settings.pet.importFolderDesc') }}
          </div>
        </div>
        <GdButton size="small" :loading="importing" @click="handlePickFolder">
          {{ t('settings.pet.pickFolder') }}
        </GdButton>
      </div>
    </section>

    <!-- 格式说明 -->
    <section>
      <h3 class="mb-2 text-sm font-semibold text-gray-900 dark:text-[#e8e9ed]">
        {{ t('settings.pet.formatTitle') }}
      </h3>
      <div class="space-y-3 rounded-xl border border-gray-200 dark:border-[#2e3035] bg-(--gd-color-surface) p-4 text-xs leading-relaxed text-gray-600 dark:text-[#a8aab2]">
        <p>{{ t('settings.pet.formatIntro') }}</p>

        <div>
          <div class="mb-1.5 font-medium text-gray-800 dark:text-[#d0d1d5]">
            {{ t('settings.pet.formatAtlasTitle') }}
          </div>
          <pre class="overflow-x-auto rounded-lg bg-gray-500/8 p-3 font-mono text-[11px] leading-5 text-gray-700 dark:bg-white/5 dark:text-[#d0d1d5]">{{ atlasSample }}</pre>
          <p class="mt-1.5">{{ t('settings.pet.formatAtlasDesc') }}</p>
        </div>

        <ul class="list-disc space-y-1 pl-5">
          <li>{{ t('settings.pet.formatRule1') }}</li>
          <li>{{ t('settings.pet.formatRule3') }}</li>
        </ul>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import GdButton from '@/components/ui/GdButton.vue'
import { toast } from '@/components/ui/toastService'

const emit = defineEmits<{ (e: 'imported', id: string): void }>()
const { t } = useI18n()

const petsDir = ref('')
const importing = ref(false)

const atlasSample = `<宠物id>/
├── pet.json
└── spritesheet.webp

pet.json:
{
  "id": "my-pet",
  "displayName": "我的宠物",
  "spritesheetPath": "spritesheet.webp"
}`

onMounted(async () => {
  try {
    petsDir.value = (await window.electronAPI?.getPetsDir?.()) || ''
  } catch (error) {
    console.error('读取桌宠目录失败:', error)
  }
})

const handleOpenFolder = () => window.electronAPI?.openPetsFolder?.()

const handlePickFolder = async () => {
  if (!window.electronAPI?.importPetAvatar || importing.value) return
  importing.value = true
  try {
    const result = await window.electronAPI.importPetAvatar()
    if (!result.ok) {
      if (result.error !== '已取消') toast.error(result.error || t('settings.pet.importFailed'))
      return
    }
    toast.success(t('settings.pet.importSuccess'))
    if (result.id) emit('imported', result.id)
  } catch (error) {
    console.error('导入桌宠失败:', error)
    toast.error(t('settings.pet.importFailed'))
  } finally {
    importing.value = false
  }
}
</script>
