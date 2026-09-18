<template>
  <div class="flex flex-col py-3 w-full">
    <!-- 新建智能体与使用说明 -->
    <div class="flex items-center justify-between mb-6">
      <div class="flex items-center gap-2">
        <el-button type="primary" @click="$emit('createAgent')" class="flex items-center">
          <template #icon>
            <PlusOutlined />
          </template>
          {{ t('agents.list.create') }}
        </el-button>
        <el-button @click="triggerImport" class="flex items-center">
          <template #icon>
            <UploadOutlined />
          </template>
          {{ t('agents.list.import') }}
        </el-button>
        <input ref="fileInputRef" type="file" accept=".md,.markdown" multiple class="hidden" @change="handleFileSelect" />
      </div>
      <el-button link type="primary" class="text-sm" @click="$emit('openDocs')">
        <template #icon>
          <el-icon :size="16">
            <QuestionCircleOutlined />
          </el-icon>
        </template>
        {{ t('agents.list.docs') }}
      </el-button>
    </div>

    <!-- 智能体列表 -->
    <div class="flex-1 overflow-y-auto">
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
        <div v-for="agent in agents" :key="agent.id"
          class="provider-card group relative bg-white dark:bg-[#232428] border border-gray-200 dark:border-[#232428] rounded-lg p-4 cursor-default hover:border-(--gd-color-primary) transition-all duration-200 overflow-hidden">
          <!-- 毛玻璃背景层 -->
          <div v-if="agent.avatarUrl" class="absolute inset-0 z-0" :style="{
            backgroundImage: `url(${agent.avatarUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: 'blur(30px)',
            opacity: 0.04,
            transform: 'scale(1.5)'
          }">
          </div>

          <div class="relative z-10 flex flex-col h-full">
            <div class="flex items-start gap-3">
              <Avatar class="w-11 h-11" :src="agent.avatarUrl" :name="agent.name" type="assistant" />
              <div class="flex-1 min-w-0">
                <div class="flex items-start justify-between">
                  <div class="font-medium text-base text-gray-900 dark:text-[#e8e9ed] truncate" :title="agent.name">
                    {{ agent.name }}
                  </div>
                  <el-button v-if="canDelete(agent)" link size="small" type="danger"
                    class="opacity-0 group-hover:opacity-100 transition-all duration-200 delete-btn"
                    @click.stop="$emit('deleteAgent', agent)">
                    <el-icon :size="18">
                      <DeleteOutlineOutlined />
                    </el-icon>
                  </el-button>
                </div>
                <div class="text-xs text-gray-500 dark:text-[#8b8d95] mt-1.5 font-mono truncate" :title="agent.id">
                  {{ agent.id }}
                </div>
              </div>
            </div>
            <div class="text-xs text-gray-400 dark:text-[#6b6d75] mt-2 line-clamp-2 leading-relaxed">
              {{ agent.description || t('agents.list.noDescription') }}
            </div>
          </div>

          <!-- 悬停按钮 -->
          <div class="absolute inset-x-0 bottom-0 h-16 bg-linear-to-t from-white dark:from-[#232428] via-white/90 dark:via-[#232428]/90 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none rounded-b-lg"></div>
          <div class="absolute inset-x-2 bottom-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-auto z-20">
            <el-button type="primary" size="small" class="flex-1 shadow-sm" @click.stop="$emit('startNewChat', agent)">
              {{ t('agents.list.useAgent') }}
            </el-button>
            <el-button size="small" class="flex-1 shadow-sm" @click.stop="$emit('editAgent', agent)">
              {{ t('agents.list.agentSettings') }}
            </el-button>
          </div>
        </div>

        <!-- 空状态 -->
        <div v-if="!loading && agents.length === 0"
          class="col-span-full text-center py-12 text-gray-500 dark:text-[#8b8d95]">
          <el-icon size="48" class="text-gray-300 dark:text-[#5a5c63] mb-3">
            <People />
          </el-icon>
          <p class="text-lg">{{ t('agents.list.empty') }}</p>
          <p class="text-sm mt-1">{{ t('agents.list.emptyHint') }}</p>
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

defineProps<{
  agents: any[]
  loading: boolean
}>()

const emit = defineEmits<{
  createAgent: []
  editAgent: [agent: any]
  deleteAgent: [agent: any]
  startNewChat: [agent: any]
  openDocs: []
  imported: []
}>()

// 内置默认智能体：后端保证恒排第一且禁止删除，前端同步隐藏删除入口
const DEFAULT_AGENT_ID = 'assistant-agent'

const canDelete = (agent: any): boolean => agent.id !== DEFAULT_AGENT_ID

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
    const results = await apiService.importAgents(files)
    const okCount = results.filter(r => r.status === 'ok').length
    const failCount = results.filter(r => r.status !== 'ok').length
    if (okCount > 0) {
      ElMessage.success(t('agents.list.importSuccess', { count: okCount }))
    }
    if (failCount > 0) {
      ElMessage.warning(t('agents.list.importPartial', { count: failCount }))
    }
    emit('imported')
  } catch (err: any) {
    ElMessage.error(err.message || t('agents.list.importFailed'))
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
