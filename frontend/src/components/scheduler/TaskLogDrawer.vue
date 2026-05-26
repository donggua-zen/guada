<template>
  <el-drawer v-model="drawerVisible" :title="drawerTitle" size="480px" destroy-on-close>
    <div class="flex flex-col h-full">
      <!-- 头部操作 -->
      <div class="flex justify-between items-center mb-4">
        <div class="text-sm text-gray-500 dark:text-[#8b8d95]">
          共 {{ logs.length }} 条记录
        </div>
        <el-button size="small" @click="handleRefresh" :loading="loading">
          <template #icon>
            <RefreshOutlined />
          </template>
          刷新
        </el-button>
      </div>

      <!-- 日志列表 -->
      <div class="flex-1 overflow-y-auto">
        <div v-if="logs.length > 0" class="space-y-3">
          <div v-for="log in logs" :key="log.id"
            class="rounded-lg border border-gray-200 dark:border-[#2e3035] p-3 bg-white dark:bg-[#232428]">
            <div class="flex items-center justify-between mb-2">
              <el-tag :type="getStatusType(log.status)" size="small" effect="light">
                {{ getStatusLabel(log.status) }}
              </el-tag>
              <span class="text-xs text-gray-400">
                {{ formatDateTime(log.startedAt) }}
              </span>
            </div>

            <div v-if="log.sessionId" class="text-xs text-gray-500 mb-1">
              会话: {{ log.sessionId }}
            </div>

            <div v-if="log.error" class="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded mt-2">
              {{ log.error }}
            </div>

            <div v-if="log.finishedAt" class="text-xs text-gray-400 mt-2">
              完成: {{ formatDateTime(log.finishedAt) }}
            </div>
          </div>
        </div>

        <!-- 空状态 -->
        <div v-else class="py-12 text-center text-gray-400">
          <el-icon size="48" class="mb-3 opacity-50">
            <InboxOutlined />
          </el-icon>
          <div>暂无执行记录</div>
          <div class="text-sm mt-2">任务执行后日志将显示在这里</div>
        </div>
      </div>
    </div>
  </el-drawer>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ElDrawer, ElTag, ElButton, ElIcon } from 'element-plus'
import { RefreshOutlined, InboxOutlined } from '@vicons/material'
import type { ScheduledTask, ScheduledTaskLog } from '../../types/scheduler'

interface Props {
  modelValue: boolean
  task: ScheduledTask | null
  logs: ScheduledTaskLog[]
  loading: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'refresh': []
}>()

const drawerVisible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
})

const drawerTitle = computed(() => {
  return props.task ? `执行日志 - ${props.task.name}` : '执行日志'
})

/**
 * 获取状态标签类型
 */
function getStatusType(status: string): string {
  switch (status) {
    case 'completed':
      return 'success'
    case 'running':
      return 'primary'
    case 'failed':
      return 'danger'
    case 'pending':
    default:
      return 'info'
  }
}

/**
 * 获取状态显示文本
 */
function getStatusLabel(status: string): string {
  switch (status) {
    case 'completed':
      return '已完成'
    case 'running':
      return '执行中'
    case 'failed':
      return '失败'
    case 'pending':
      return '等待中'
    default:
      return status
  }
}

/**
 * 格式化日期时间
 */
function formatDateTime(dateStr: string): string {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

/**
 * 刷新日志
 */
function handleRefresh() {
  emit('refresh')
}
</script>
