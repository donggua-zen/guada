<template>
  <div class="py-3 w-full min-w-0">
    <!-- 头部区域 -->
    <div class="flex items-center justify-between mb-6">
      <span class="text-lg font-semibold">轻量 Agent</span>
      <el-space>
        <el-button @click="refreshAgents" :loading="loading">
          <template #icon>
            <component :is="RefreshOutlined" class="w-4 h-4" />
          </template>
          刷新
        </el-button>
      </el-space>
    </div>

    <div class="text-sm text-gray-600 dark:text-[#8b8d95] mb-4">
      打开可见性后 AI 会根据任务自动调用对应的 Agent，关闭的 Agent 需要通过斜杠命令手动调用。
    </div>

    <!-- 加载中 -->
    <div v-if="loading" class="flex justify-center py-12">
      <el-icon class="is-loading" size="24">
        <Loading />
      </el-icon>
    </div>

    <template v-else-if="hasItems">
      <!-- ========== 无分组的 Agent ========== -->
      <div v-if="ungroupedAgents.length > 0" class="grid gap-3 mb-6"
        style="grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));">
        <AgentCard
          v-for="agent in ungroupedAgents"
          :key="agent.id"
          :agent="agent"
          :disabled="!agent.visible"
          @toggle-visibility="handleToggleAgentVisibility"
          @view-detail="viewAgentDetail"
          @delete="handleDeleteAgent"
        />
      </div>

      <!-- ========== 文件夹分组 ========== -->
      <div v-for="group in groups" :key="group.id" class="mb-6">
        <!-- 文件夹标题栏 -->
        <div class="flex items-center gap-2 mb-3 px-1 select-none cursor-pointer"
          :class="{ 'opacity-60': !group.visible }"
          @click="toggleGroupCollapse(group.id)">
          <component :is="collapsedGroups.has(group.id) ? ChevronRight : ChevronDown"
            class="w-5 h-5 text-gray-400" />
          <span class="text-xl">{{ group.emoji || '📁' }}</span>
          <span class="text-base font-semibold text-gray-800 dark:text-[#e8e9ed]">
            {{ group.name }}
          </span>
          <span class="text-xs text-gray-400">({{ group.agentCount }})</span>

          <div class="ml-auto flex items-center gap-2">
            <span class="text-sm text-gray-500">分组可见</span>
            <el-switch
              :model-value="group.visible"
              @click.stop
              @update:model-value="(val: any) => handleToggleGroupVisibility(group, !!val)"
              size="small"
              inline-prompt
            />
          </div>
        </div>

        <!-- 文件夹内 Agent 卡片 -->
        <div v-if="!collapsedGroups.has(group.id)" class="grid gap-3 pl-2"
          style="grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));">
          <AgentCard
            v-for="agent in getGroupedAgents(group.id)"
            :key="agent.id"
            :agent="agent"
            :disabled="!agent.visible || !agent.folderVisible"
            @toggle-visibility="handleToggleAgentVisibility"
            @view-detail="viewAgentDetail"
            @delete="handleDeleteAgent"
          />
        </div>
      </div>
    </template>

    <!-- 空状态 -->
    <div v-else class="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-[#5a5c63]">
      <component :is="Bot24Regular" class="w-16 h-16 mb-3 opacity-50" />
      <p class="text-lg">暂无轻量 Agent</p>
      <p class="text-sm mt-1">在 agents/ 目录中放入 .md 文件即可创建</p>
    </div>

    <!-- Agent 详情弹窗 -->
    <el-dialog v-model="showDetailDialog" :title="detailAgent?.name || 'Agent 详情'"
      :width="isMobile ? '90%' : '560px'" :append-to-body="true">
      <div class="space-y-4">
        <div class="flex items-center gap-3">
          <div class="w-12 h-12 rounded-lg flex items-center justify-center text-3xl"
            :style="{ backgroundColor: detailAgent?.color + '20' || '#f0f0f0' }">
            {{ detailAgent?.emoji || '🤖' }}
          </div>
          <div>
            <h3 class="font-medium text-lg">{{ detailAgent?.name }}</h3>
            <p class="text-sm text-gray-500">{{ detailAgent?.description }}</p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-sm text-gray-500">提示词注入：</span>
          <el-tag :type="detailAgent?.visible ? 'success' : 'info'" size="small">
            {{ detailAgent?.visible ? '可见' : '不可见' }}
          </el-tag>
        </div>
        <div class="border-t border-gray-200 dark:border-[#2a2c30] pt-4 space-y-2">
          <div class="flex items-center gap-2">
            <span class="text-sm text-gray-500 shrink-0">Agent ID:</span>
            <code class="text-sm bg-gray-100 dark:bg-[#2a2c30] px-2 py-1 rounded">{{ detailAgent?.id }}</code>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm text-gray-500 shrink-0">Path:</span>
            <code class="text-sm bg-gray-100 dark:bg-[#2a2c30] px-2 py-1 rounded flex-1 truncate">{{ detailFilePath }}</code>
            <el-button v-if="detailFilePath" link size="small" @click="openFilePath(detailFilePath)">
              <template #icon>
                <component :is="OpenInNewOutlined" class="w-4 h-4" />
              </template>
            </el-button>
          </div>
        </div>
        <div v-if="detailBody" class="border-t border-gray-200 dark:border-[#2a2c30] pt-4">
          <h4 class="text-sm font-medium text-gray-500 mb-2">系统提示词</h4>
          <pre class="text-sm bg-gray-50 dark:bg-[#1c1d20] p-3 rounded-lg max-h-60 overflow-y-auto whitespace-pre-wrap">{{
            detailBody }}</pre>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElIcon, ElButton, ElDialog, ElSpace, ElSwitch, ElTag } from 'element-plus'
import { Loading } from '@element-plus/icons-vue'
import {
  Bot24Regular,
  ChevronRight24Regular as ChevronRight,
  ChevronDown24Regular as ChevronDown,
} from '@vicons/fluent'
import {
  RefreshOutlined,
  DescriptionOutlined,
  DeleteOutlineOutlined,
  OpenInNewOutlined,
} from '@vicons/material'
import { apiService } from '../../services/ApiService'
import { usePopup } from '../../composables/usePopup'
import AgentCard from './AgentCard.vue'

const { toast, confirm } = usePopup()

const agents = ref<any[]>([])
const groups = ref<any[]>([])
const loading = ref(false)
const collapsedGroups = ref(new Set<string>())
const showDetailDialog = ref(false)
const detailAgent = ref<any>(null)
const detailBody = ref('')
const detailFilePath = ref('')
const isMobile = ref(window.innerWidth < 768)

const hasItems = computed(() => agents.value.length > 0 || groups.value.length > 0)

/** 无分组的 Agent（folder === undefined） */
const ungroupedAgents = computed(() =>
  agents.value.filter((a) => !a.folder)
)

/** 按文件夹分组 */
const getGroupedAgents = (groupId: string) =>
  agents.value.filter((a) => a.folder === groupId)

const loadAgents = async (): Promise<void> => {
  loading.value = true
  try {
    const response = await apiService.fetchAgents()
    agents.value = response.agents || []
    groups.value = response.groups || []
    // 从清单文件恢复折叠状态
    collapsedGroups.value = new Set(
      groups.value.filter((g: any) => g.collapsed).map((g: any) => g.id)
    )
  } catch (error: any) {
    console.error('获取 Agent 列表失败:', error)
    toast.error('获取 Agent 列表失败')
  } finally {
    loading.value = false
  }
}

const refreshAgents = async (): Promise<void> => {
  await loadAgents()
  toast.success('Agent 列表已刷新')
}

const toggleGroupCollapse = async (groupId: string): Promise<void> => {
  const s = new Set(collapsedGroups.value)
  const collapsed = !s.has(groupId)
  if (collapsed) {
    s.add(groupId)
  } else {
    s.delete(groupId)
  }
  collapsedGroups.value = s
  // 持久化到清单文件
  const group = groups.value.find((g: any) => g.id === groupId)
  if (group) {
    try {
      await apiService.updateAgentVisibility(groupId, group.visible, collapsed)
    } catch {
      // 静默失败，不阻塞 UI
    }
  }
}

// ── Agent 可见性 ──

const handleToggleAgentVisibility = async (agent: any, visible: boolean): Promise<void> => {
  try {
    await apiService.updateAgentVisibility(agent.id, visible)
    agent.visible = visible
    toast.success(visible ? 'Agent 已设为可见' : 'Agent 已设为不可见')
  } catch (error: any) {
    console.error('切换 Agent 可见性失败:', error)
    toast.error('操作失败')
  }
}

// ── 文件夹可见性 ──

const handleToggleGroupVisibility = async (group: any, visible: boolean): Promise<void> => {
  try {
    await apiService.updateAgentVisibility(group.id, visible)
    group.visible = visible
    // 同步更新内部 agent 的 folderVisible，实现实时灰度
    for (const agent of agents.value) {
      if (agent.folder === group.id) {
        agent.folderVisible = visible
      }
    }
    toast.success(visible ? '文件夹已设为可见' : '文件夹已设为不可见')
  } catch (error: any) {
    console.error('切换文件夹可见性失败:', error)
    toast.error('操作失败')
  }
}

// ── Agent 详情 ──

const viewAgentDetail = async (agent: any): Promise<void> => {
  detailAgent.value = agent
  detailBody.value = ''
  detailFilePath.value = ''
  showDetailDialog.value = true
  try {
    const detail = await apiService.fetchAgentDetail(agent.id)
    if (detail.success && detail.data) {
      detailBody.value = detail.data.body
      detailFilePath.value = detail.data.filePath || ''
    }
  } catch {
    // 静默失败
  }
}

const openFilePath = (filePath: string): void => {
  navigator.clipboard.writeText(filePath).then(() => {
    toast.success('文件路径已复制到剪贴板')
  }).catch(() => {
    // 静默失败
  })
}

// ── 删除 ──

const handleDeleteAgent = async (agent: any): Promise<void> => {
  const result = await confirm('确认删除', `确定要删除 Agent「${agent.name}」吗？此操作将删除对应的文件。`)
  if (!result) return
  try {
    await apiService.deleteAgent(agent.id)
    agents.value = agents.value.filter((a) => a.id !== agent.id)
    toast.success('Agent 已删除')
  } catch (error: any) {
    console.error('删除 Agent 失败:', error)
    toast.error('删除失败')
  }
}

onMounted(() => {
  loadAgents()
})
</script>

<style scoped>
/* Mobile padding for grid items on small screens */
@media (max-width: 640px) {
  .grid {
    grid-template-columns: 1fr !important;
  }
}
</style>
