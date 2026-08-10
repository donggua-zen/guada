<template>
  <div class="flex flex-col py-3 w-full">
    <!-- 新建助手与使用说明 -->
    <div class="flex items-center justify-between mb-6">
      <div class="flex items-center gap-2">
        <el-button type="primary" @click="$emit('createCharacter')" class="flex items-center">
          <template #icon>
            <PlusOutlined />
          </template>
          {{ t('characters.list.create') }}
        </el-button>
        <el-button @click="triggerImport" class="flex items-center">
          <template #icon>
            <UploadOutlined />
          </template>
          {{ t('characters.list.import') }}
        </el-button>
        <input ref="fileInputRef" type="file" accept=".md,.markdown" multiple class="hidden" @change="handleFileSelect" />
      </div>
      <el-button link type="primary" class="text-sm" @click="$emit('openDocs')">
        <template #icon>
          <el-icon :size="16">
            <QuestionCircleOutlined />
          </el-icon>
        </template>
        {{ t('characters.list.docs') }}
      </el-button>
    </div>

    <!-- 分组筛选标签区域 -->
    <div class="flex flex-wrap gap-1">
      <div class="px-3 py-1 rounded cursor-pointer transition-all duration-200 select-none text-sm" :class="currentGroupId === null
        ? 'bg-gray-100 dark:bg-[#2a2c30] text-(--color-text-primary) font-medium'
        : 'text-(--color-text-secondary) hover:bg-gray-50 dark:hover:bg-[#2a2c30]/50'"
        @click="$emit('selectGroup', null)">
        {{ t('characters.list.all') }}
      </div>

      <div v-for="group in groups" :key="group.id"
        class="px-3 py-1 rounded cursor-pointer transition-all duration-200 select-none text-sm flex items-center gap-1"
        :class="currentGroupId === group.id
          ? 'bg-gray-100 dark:bg-[#2a2c30] text-(--color-text-primary) font-medium'
          : 'text-gray-500 dark:text-[#8b8d95] hover:bg-gray-50 dark:hover:bg-[#2a2c30]/50'"
        @click="$emit('selectGroup', group.id)" @contextmenu.prevent="$emit('renameGroup', group)">
        <span>{{ group.name }}</span>
      </div>

      <div
        class="px-3 py-1 rounded cursor-pointer transition-all duration-200 select-none text-sm flex items-center text-gray-500 dark:text-[#8b8d95] hover:text-(--color-primary) hover:bg-gray-50 dark:hover:bg-[#2a2c30]/50"
        @click="$emit('createGroup')">
        <el-icon :size="14" class="mr-1">
          <PlusOutlined />
        </el-icon>
        {{ t('characters.list.newGroup') }}
      </div>
    </div>

    <!-- 助手列表 -->
    <div class="flex-1 overflow-y-auto pt-4">
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
        <div v-for="character in characters" :key="character.id"
          class="provider-card group relative bg-white dark:bg-[#232428] border border-gray-200 dark:border-[#232428] rounded-lg p-4 cursor-default hover:border-(--color-primary) transition-all duration-200 overflow-hidden">
          <!-- 毛玻璃背景层 -->
          <div v-if="character.avatarUrl" class="absolute inset-0 z-0" :style="{
            backgroundImage: `url(${character.avatarUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: 'blur(30px)',
            opacity: 0.04,
            transform: 'scale(1.5)'
          }">
          </div>

          <div class="relative z-10 flex flex-col h-full">
            <div class="flex items-start gap-3">
              <Avatar class="w-11 h-11" :src="character.avatarUrl" :name="character.title" type="assistant" />
              <div class="flex-1 min-w-0">
                <div class="flex items-start justify-between">
                  <div class="font-medium text-base text-gray-900 dark:text-[#e8e9ed] truncate" :title="character.title">
                    {{ character.title }}
                  </div>
                  <el-button link size="small" type="danger"
                    class="opacity-0 group-hover:opacity-100 transition-all duration-200 delete-btn"
                    @click.stop="$emit('deleteCharacter', character)">
                    <el-icon :size="18">
                      <DeleteOutlineOutlined />
                    </el-icon>
                  </el-button>
                </div>
                <div class="text-xs text-gray-500 dark:text-[#8b8d95] mt-1.5">
                  {{ character.isPublic ? t('characters.list.sharedTemplate') : t('characters.list.myTemplate') }}
                </div>
              </div>
            </div>
            <div class="text-xs text-gray-400 dark:text-[#6b6d75] mt-2 line-clamp-2 leading-relaxed">
              {{ character.description || t('characters.list.noDescription') }}
            </div>
          </div>

          <!-- 悬停按钮 -->
          <div class="absolute inset-x-0 bottom-0 h-16 bg-linear-to-t from-white dark:from-[#232428] via-white/90 dark:via-[#232428]/90 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none rounded-b-lg"></div>
          <div class="absolute inset-x-2 bottom-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-auto z-20">
            <el-button type="primary" size="small" class="flex-1 shadow-sm" @click.stop="$emit('startNewChat', character)">
              {{ t('characters.list.useCharacter') }}
            </el-button>
            <el-button size="small" class="flex-1 shadow-sm" @click.stop="$emit('editCharacter', character)">
              {{ t('characters.list.characterSettings') }}
            </el-button>
          </div>
        </div>

        <!-- 空状态 -->
        <div v-if="!loading && characters.length === 0"
          class="col-span-full text-center py-12 text-gray-500 dark:text-[#8b8d95]">
          <el-icon size="48" class="text-gray-300 dark:text-[#5a5c63] mb-3">
            <People />
          </el-icon>
          <p class="text-lg">{{ t('characters.list.empty') }}</p>
          <p class="text-sm mt-1">{{ t('characters.list.emptyHint') }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElIcon, ElButton, ElMessage } from 'element-plus'
import { People } from '@vicons/ionicons5'
import { PlusOutlined, DeleteOutlineOutlined, UploadOutlined } from '@vicons/material'
import { QuestionCircleOutlined } from '@vicons/antd'
import { Avatar } from '../ui'
import { apiService } from '../../services/ApiService'
import type { CharacterGroup } from '@/types/character'

defineProps<{
  characters: any[]
  groups: CharacterGroup[]
  currentGroupId: string | null
  loading: boolean
}>()

const emit = defineEmits<{
  createCharacter: []
  editCharacter: [character: any]
  deleteCharacter: [character: any]
  startNewChat: [character: any]
  selectGroup: [groupId: string | null]
  createGroup: []
  renameGroup: [group: CharacterGroup]
  deleteGroup: [group: CharacterGroup]
  openDocs: []
  imported: []
}>()

const fileInputRef = ref<HTMLInputElement>()

const { t } = useI18n()

const triggerImport = () => {
  fileInputRef.value?.click()
}

const handleFileSelect = async (event: Event) => {
  const input = event.target as HTMLInputElement
  if (!input.files || input.files.length === 0) return

  const files: { content: string; filename: string }[] = []
  for (const file of Array.from(input.files)) {
    const content = await file.text()
    files.push({ content, filename: file.name })
  }

  try {
    const results = await apiService.importCharacters(files)
    const okCount = results.filter(r => r.status === 'ok').length
    const failCount = results.filter(r => r.status !== 'ok').length
    if (okCount > 0) {
      ElMessage.success(t('characters.list.importSuccess', { count: okCount }))
    }
    if (failCount > 0) {
      ElMessage.warning(t('characters.list.importPartial', { count: failCount }))
    }
    emit('imported')
  } catch (err: any) {
    ElMessage.error(err.message || t('characters.list.importFailed'))
  }

  // 重置 input 以便重复选择同一文件
  input.value = ''
}
</script>

<style scoped>
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.provider-card {
  min-height: 140px;
}

.delete-btn {
  border-radius: 4px;
}

.delete-btn:hover {
  background-color: rgba(239, 68, 68, 0.1);
}
</style>
