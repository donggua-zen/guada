<!-- components/KnowledgeBasePage/UploadTaskModal.vue -->
<template>
  <GdDialog v-model="visible" :title="t('knowledge.uploadTask.title')" size="md" :close-on-click-modal="false" @close="handleClose">
    <!-- 上传任务列表 -->
    <div v-if="uploadTasks.length > 0" class="space-y-3 max-h-[400px] overflow-y-auto">
      <div v-for="task in uploadTasks" :key="task.id"
        class="p-3 border border-gray-200 dark:border-[#2e3035] rounded-lg hover:bg-gray-50 dark:hover:bg-[#2a2c30] transition-colors">
        <!-- 文件信息 -->
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2 flex-1 min-w-0">
            
              <Document16Regular class="text-gray-500 dark:text-[#8b8d95] shrink-0 w-4 h-4"  />
            
            <span class="text-sm text-gray-700 dark:text-[#e8e9ed] truncate" :title="task.fileName">
              {{ task.fileName }}
            </span>
          </div>

          <!-- 状态标签 -->
          <GdTag :type="getStatusType(task.processingStatus)" size="small" class="ml-2 shrink-0">
            {{ getStatusText(task.processingStatus) }}
          </GdTag>
        </div>

        <!-- 进度条 -->
        <div v-if="task.processingStatus === 'uploading' || task.processingStatus === 'processing'" class="mb-2">
          <GdProgress :percentage="task.progressPercentage" :stroke-width="6" />
          <div v-if="task.currentStep" class="mt-1 text-xs text-gray-500 dark:text-[#8b8d95]">
            {{ task.currentStep }}
          </div>
        </div>

        <!-- 错误信息 -->
        <div v-if="task.processingStatus === 'failed' && task.errorMessage" class="mt-2">
          <div class="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-2 rounded">
            {{ task.errorMessage }}
          </div>
        </div>

        <!-- 操作按钮 -->
        <div v-if="task.processingStatus === 'failed'" class="mt-2 flex justify-end gap-2">
          <GdButton size="small" @click="$emit('retry', task)">
            {{ t('common.retry') }}
          </GdButton>
          <GdButton size="small" type="danger" @click="$emit('delete', task)">
            {{ t('common.delete') }}
          </GdButton>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-else class="text-center py-12">
      
        <ArrowUpload24Regular class="text-gray-300 dark:text-[#3e4046] mb-3 w-12 h-12 mx-auto"  />
      
      <p class="text-sm text-gray-500 dark:text-[#8b8d95]">{{ t('knowledge.uploadTask.empty') }}</p>
    </div>

    <!-- 底部操作 -->
    <template #footer>
      <div class="flex justify-end">
        <GdButton size="small" @click="handleClose">{{ t('common.close') }}</GdButton>
      </div>
    </template>
  </GdDialog>
</template>

<script setup lang="ts">
import GdButton from '@/components/ui/GdButton.vue';
import GdTag from '@/components/ui/GdTag.vue';
import GdProgress from '@/components/ui/GdProgress.vue';
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Document16Regular, ArrowUpload24Regular } from '@vicons/fluent'
import type { KBFile } from '@/stores/knowledgeBase'
import GdDialog from '@/components/ui/GdDialog.vue'

interface Props {
  modelValue: boolean
  uploadTasks: KBFile[]
}

const props = defineProps<Props>()

const { t } = useI18n()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'retry', task: KBFile): void
  (e: 'delete', task: KBFile): void
}>()

// ========== Computed ==========

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

// ========== Methods ==========

function handleClose() {
  visible.value = false
}

function getStatusType(status: string): 'primary' | 'success' | 'info' | 'warning' | 'danger' {
  const types: Record<string, 'primary' | 'success' | 'info' | 'warning' | 'danger'> = {
    'queued': 'info',
    'uploading': 'warning',
    'uploaded': 'success',
    'completed': 'success',
    'failed': 'danger',
  }
  return types[status] || 'info'
}

function getStatusText(status: string): string {
  const texts: Record<string, string> = {
    'queued': t('knowledge.status.queuedShort'),
    'uploading': t('knowledge.status.uploading'),
    'uploaded': t('knowledge.status.uploadedShort'),
    'failed': t('knowledge.status.failed'),
  }
  return texts[status] || status
}
</script>

<style scoped>
/* 所有样式已使用 Tailwind CSS */
</style>
