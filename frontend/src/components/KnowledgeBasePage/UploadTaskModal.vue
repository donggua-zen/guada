<!-- components/KnowledgeBasePage/UploadTaskModal.vue -->
<template>
  <el-dialog v-model="visible" title="上传任务" width="600px" :close-on-click-modal="false" @close="handleClose">
    <!-- 上传任务列表 -->
    <div v-if="uploadTasks.length > 0" class="space-y-3 max-h-[400px] overflow-y-auto">
      <div v-for="task in uploadTasks" :key="task.id"
        class="p-3 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
        <!-- 文件信息 -->
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2 flex-1 min-w-0">
            <el-icon size="16" class="text-gray-500 dark:text-gray-400 flex-shrink-0">
              <Document />
            </el-icon>
            <span class="text-sm text-gray-700 dark:text-gray-300 truncate" :title="task.fileName">
              {{ task.fileName }}
            </span>
          </div>

          <!-- 状态标签 -->
          <el-tag :type="getStatusType(task.processingStatus)" size="small" class="ml-2 flex-shrink-0">
            {{ getStatusText(task.processingStatus) }}
          </el-tag>
        </div>

        <!-- 进度条 -->
        <div v-if="task.processingStatus === 'uploading' || task.processingStatus === 'processing'" class="mb-2">
          <el-progress :percentage="task.progressPercentage" :stroke-width="6" />
          <div v-if="task.currentStep" class="mt-1 text-xs text-gray-500 dark:text-gray-400">
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
          <el-button size="small" @click="$emit('retry', task)">
            重试
          </el-button>
          <el-button size="small" type="danger" @click="$emit('delete', task)">
            删除
          </el-button>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-else class="text-center py-12">
      <el-icon size="48" class="text-gray-300 dark:text-gray-600 mb-3">
        <Upload />
      </el-icon>
      <p class="text-sm text-gray-500 dark:text-gray-400">暂无上传任务</p>
    </div>

    <!-- 底部操作 -->
    <template #footer>
      <div class="flex justify-end">
        <el-button size="small" @click="handleClose">关闭</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Document, Upload } from '@element-plus/icons-vue'
import type { KBFile } from '@/stores/knowledgeBase'

interface Props {
  modelValue: boolean
  uploadTasks: KBFile[]
}

const props = defineProps<Props>()

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

function getStatusType(status: string): string {
  const types: Record<string, string> = {
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
    'queued': '排队中',
    'uploading': '上传中',
    'uploaded': '已上传',
    'failed': '失败',
  }
  return texts[status] || status
}
</script>

<style scoped>
/* 所有样式已使用 Tailwind CSS */
</style>
