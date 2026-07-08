<template>
  <div class="py-3 w-full min-w-0">
    <!-- 头部区域 -->
    <div class="flex items-center justify-between mb-6">
      <span class="text-lg font-semibold">轻量 Agent</span>
      <el-space>
        <el-button type="primary" @click="handleCreateAgent">
          <template #icon>
            <component :is="AddOutlined" class="w-4 h-4" />
          </template>
          新增 Agent
        </el-button>
        <el-button @click="handleImportClick">
          <template #icon>
            <component :is="FileUploadOutlined" class="w-4 h-4" />
          </template>
          导入
        </el-button>
        <el-button @click="refreshAgents" :loading="loading">
          <template #icon>
            <component :is="RefreshOutlined" class="w-4 h-4" />
          </template>
          刷新
        </el-button>
      </el-space>
    </div>

    <div class="text-sm text-gray-600 dark:text-[#8b8d95] mb-4">
      打开可见性后 AI 会根据任务自动调用对应的 Agent，关闭的 Agent 可以通过@命令手动调用。<br>
      <span class="text-red-500">太多的 可见Agent 会占用上下文预算，使得对话成本增加，且可能导致AI困惑。</span><br>
      <span>建议只保留必要且高频使用Agent可见（少于5个），其余agent使用时手动@调用即可。</span>
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
        <AgentCard v-for="agent in ungroupedAgents" :key="agent.id" :agent="agent" :disabled="!agent.visible"
          @toggle-visibility="handleToggleAgentVisibility" @edit="openEditor" @export="handleExportAgent" @delete="handleDeleteAgent" />
      </div>

      <!-- ========== 文件夹分组 ========== -->
      <div v-for="group in groups" :key="group.id" class="mb-6">
        <!-- 文件夹标题栏 -->
        <div class="flex items-center gap-2 mb-3 px-1 select-none cursor-pointer"
          :class="{ 'opacity-60': !group.visible }" @click="toggleGroupCollapse(group.id)">
          <component :is="collapsedGroups.has(group.id) ? ChevronRight : ChevronDown" class="w-5 h-5 text-gray-400" />
          <span class="text-xl">{{ group.emoji || '📁' }}</span>
          <span class="text-base font-semibold text-gray-800 dark:text-[#e8e9ed]">
            {{ group.name }}
          </span>
          <span class="text-xs text-gray-400">({{ group.agentCount }})</span>

          <div class="ml-auto flex items-center gap-2">
            <span class="text-sm text-gray-500">分组可见</span>
            <el-switch :model-value="group.visible" @click.stop
              @update:model-value="(val: any) => handleToggleGroupVisibility(group, !!val)" size="small"
              inline-prompt />
          </div>
        </div>

        <!-- 文件夹内 Agent 卡片 -->
        <div v-if="!collapsedGroups.has(group.id)" class="grid gap-3 pl-2"
          style="grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));">
          <AgentCard v-for="agent in getGroupedAgents(group.id)" :key="agent.id" :agent="agent"
            :disabled="!agent.visible || !agent.folderVisible" @toggle-visibility="handleToggleAgentVisibility"
            @edit="openEditor" @export="handleExportAgent" @delete="handleDeleteAgent" />
        </div>
      </div>
    </template>

    <!-- 空状态 -->
    <div v-else class="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-[#5a5c63]">
      <component :is="Bot24Regular" class="w-16 h-16 mb-3 opacity-50" />
      <p class="text-lg">暂无轻量 Agent</p>
      <p class="text-sm mt-1">在 agents/ 目录中放入 .md 文件即可创建</p>
    </div>

    <!-- Agent 编辑弹窗 -->
    <el-dialog v-model="showEditorDialog" :title="editorTitle" :width="isMobile ? '90%' : '640px'"
      :append-to-body="true" :close-on-click-modal="false">
      <div class="space-y-4">
        <!-- 基本信息 -->
        <div class="flex gap-3 items-start">
          <div class="flex-1 min-w-0">
            <label class="text-sm text-gray-500 mb-1 block">名称 *</label>
            <el-input v-model="editForm.name" placeholder="Agent 名称" />
          </div>
          <div class="shrink-0">
            <label class="text-sm text-gray-500 mb-1 block">Emoji</label>
            <el-popover placement="bottom" :width="320" trigger="click" popper-class="emoji-picker-popover">
              <template #reference>
                <el-button style="font-size: 24px; padding: 4px 8px; height: auto;">
                  {{ editForm.emoji || '🤖' }}
                </el-button>
              </template>
              <div class="emoji-grid">
                <button v-for="e in commonEmojis" :key="e"
                  class="emoji-item"
                  :class="{ active: editForm.emoji === e }"
                  @click="editForm.emoji = e">
                  {{ e }}
                </button>
              </div>
            </el-popover>
          </div>
        </div>

        <div>
          <label class="text-sm text-gray-500 mb-1 block">ID *（用作文件名）</label>
          <el-input v-model="editForm.agentId"
            placeholder="如：my-agent"
            :disabled="isEditing"
            :class="{ 'border-red-500': agentIdError || agentIdDuplicate }" />
          <p class="text-xs text-gray-400 mt-1">
            {{ isEditing ? '编辑模式下 ID 不可更改' : '仅允许英文字母、下划线、短横线（a-zA-Z_-）' }}
            <span v-if="agentIdError" class="text-red-500">格式不正确，只允许英文字母、下划线、短横线</span>
            <span v-else-if="agentIdDuplicate" class="text-red-500">该 ID 已被使用，请换一个</span>
          </p>
        </div>

        <div>
          <label class="text-sm text-gray-500 mb-1 block">描述</label>
          <el-input v-model="editForm.description" placeholder="Agent 功能描述" type="textarea" :rows="3" />
        </div>

        <div>
          <label class="text-sm text-gray-500 mb-1 block">所属文件夹</label>
          <el-select v-model="editForm.folder" placeholder="无文件夹" clearable allow-create filterable>
            <el-option label="（无文件夹）" value="" />
            <el-option v-for="g in groups" :key="g.id" :label="g.name" :value="g.id" />
          </el-select>
        </div>

        <div class="flex items-center gap-2">
          <el-switch v-model="editForm.visible" size="small" />
          <span class="text-sm text-gray-500">Agent自动可见</span>
        </div>

        <!-- 系统提示词 -->
        <div>
          <label class="text-sm text-gray-500 mb-1 block">系统提示词</label>
          <el-input v-model="editForm.body" type="textarea" :rows="10"
            placeholder="输入 Agent 的系统提示词（Markdown 格式）" />
        </div>
      </div>

      <template #footer>
        <el-button @click="showEditorDialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSaveAgent">
          {{ isEditing ? '保存修改' : '创建 Agent' }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 导入弹窗 -->
    <el-dialog v-model="showImportDialog" :title="importSummary ? '导入结果' : '导入 Agent'" :width="isMobile ? '90%' : '560px'" :append-to-body="true">
      <!-- 导入前: 提示文案 + 文件选择 + 文件夹选择 -->
      <template v-if="!importSummary">
        <div class="space-y-4">
          <!-- 目录提示 -->
          <div class="text-sm bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 space-y-2">
            <p class="font-medium text-blue-700 dark:text-blue-300">📥 导入说明</p>
            <p class="text-blue-600 dark:text-blue-400">
              支持导入符合 <strong>Claude Code</strong> 格式的 Agent 文件（<code class="bg-blue-100 dark:bg-blue-800 px-1 rounded">.md</code> 文件，含 YAML frontmatter）。
            </p>
            <p class="text-blue-600 dark:text-blue-400">
              文件将导入到以下目录：
            </p>
            <div class="flex items-center gap-2 bg-white dark:bg-[#1c1d20] rounded px-3 py-2 text-xs font-mono text-gray-700 dark:text-gray-300">
              <span class="flex-1 truncate select-all">{{ agentsDirPath }}</span>
              <el-button link size="small" @click="copyAgentsDir">
                <template #icon><component :is="FileCopyOutlined" class="w-3.5 h-3.5" /></template>
              </el-button>
            </div>
          </div>

          <!-- 文件选择 -->
          <div>
            <input ref="fileInputRef" type="file" multiple accept=".md" class="hidden" @change="handleFilesSelected" />
            <el-button @click="selectImportFiles" :disabled="importing">
              <template #icon><component :is="FileUploadOutlined" class="w-4 h-4" /></template>
              选择 .md 文件
            </el-button>
            <span v-if="pendingFiles.length > 0" class="text-sm text-gray-500 ml-2">
              已选 <strong>{{ pendingFiles.length }}</strong> 个文件
            </span>
          </div>

          <!-- 文件列表 -->
          <div v-if="pendingFiles.length > 0" class="max-h-40 overflow-y-auto space-y-1 border border-gray-200 dark:border-[#2a2c30] rounded-lg p-2">
            <div v-for="f in pendingFiles" :key="f.filename"
              class="flex items-center gap-2 text-sm px-2 py-1 bg-gray-50 dark:bg-[#1c1d20] rounded">
              <span class="text-blue-500 shrink-0">📄</span>
              <span class="flex-1 truncate">{{ f.filename }}</span>
            </div>
          </div>

          <!-- 文件夹选择 -->
          <div>
            <label class="text-sm text-gray-500 mb-1 block">目标文件夹（可选）</label>
            <el-select v-model="importFolder" placeholder="导入到根目录" clearable class="w-full">
              <el-option label="（根目录）" value="" />
              <el-option v-for="g in groups" :key="g.id" :label="g.name" :value="g.id" />
            </el-select>
          </div>
        </div>
      </template>
      <!-- 导入后: 结果 -->
      <div v-else class="space-y-3">
        <div class="flex gap-4 text-sm">
          <span class="text-green-600">成功: {{ importSummary.ok }}</span>
          <span v-if="importSummary.conflict > 0" class="text-orange-600">冲突: {{ importSummary.conflict }}</span>
          <span v-if="importSummary.invalid > 0" class="text-red-600">无效: {{ importSummary.invalid }}</span>
        </div>
        <div v-if="importResults.length > 0" class="max-h-48 overflow-y-auto space-y-1">
          <div v-for="r in importResults" :key="r.filename"
            class="flex items-center gap-2 text-sm px-2 py-1 rounded"
            :class="{
              'bg-green-50 dark:bg-green-900/20': r.status === 'ok',
              'bg-orange-50 dark:bg-orange-900/20': r.status === 'conflict',
              'bg-red-50 dark:bg-red-900/20': r.status === 'invalid',
            }">
            <span class="shrink-0">{{ r.status === 'ok' ? '✅' : r.status === 'conflict' ? '⚠️' : '❌' }}</span>
            <span class="flex-1 truncate">{{ r.filename }}</span>
            <span v-if="r.message" class="text-xs text-gray-500 truncate">{{ r.message }}</span>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button v-if="!importSummary" @click="showImportDialog = false">取消</el-button>
        <el-button v-if="!importSummary" type="primary" :loading="importing" :disabled="pendingFiles.length === 0" @click="handleConfirmImport">
          确认导入
        </el-button>
        <el-button v-else type="primary" @click="showImportDialog = false">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElIcon, ElButton, ElDialog, ElSpace, ElSwitch, ElTag, ElInput, ElSelect, ElOption } from 'element-plus'
import { Loading, Plus as AddOutlined } from '@element-plus/icons-vue'
import {
  Bot24Regular,
  ChevronRight24Regular as ChevronRight,
  ChevronDown24Regular as ChevronDown,
} from '@vicons/fluent'
import {
  RefreshOutlined,
  FileUploadOutlined,
  FileCopyOutlined,
} from '@vicons/material'
import { apiService } from '../../services/ApiService'
import { usePopup } from '../../composables/usePopup'
import AgentCard from './AgentCard.vue'

const { toast, confirm } = usePopup()

const fileInputRef = ref<HTMLInputElement | null>(null)

interface AgentForm {
  name: string
  agentId: string
  description: string
  color: string
  emoji: string
  visible: boolean
  body: string
  folder: string
}

const defaultForm: AgentForm = {
  name: '',
  agentId: '',
  description: '',
  color: 'gray',
  emoji: '🤖',
  visible: true,
  body: '',
  folder: '',
}

const commonEmojis = [
  '🤖', '🧠', '⚡', '🎯', '🚀', '💻', '📱', '🔧',
  '🎨', '📊', '📝', '📚', '🔬', '🌐', '🛡️', '🎮',
  '🤝', '💬', '📈', '📉', '🧩', '🎪', '🎭', '🎬',
  '✍️', '🎵', '🎶', '📡', '🔍', '💡', '🕹️', '🧪',
  '🤗', '😎', '🤩', '😺', '🦊', '🐱', '🐶', '🐼',
  '🌟', '⭐', '🔥', '💎', '🎁', '🏆', '🥇', '🏅',
]

const agents = ref<any[]>([])
const groups = ref<any[]>([])
const agentsDirPath = ref('')
const loading = ref(false)
const collapsedGroups = ref(new Set<string>())
const isMobile = ref(window.innerWidth < 768)

// 编辑弹窗状态
const showEditorDialog = ref(false)
const saving = ref(false)
const editingId = ref<string | null>(null)
const editForm = ref<AgentForm>({ ...defaultForm })

// 导入状态
const showImportDialog = ref(false)
const importing = ref(false)
const importResults = ref<any[]>([])
const importSummary = ref<{ total: number; ok: number; conflict: number; invalid: number } | null>(null)
const pendingFiles = ref<{ content: string; filename: string }[]>([])
const importFolder = ref('')

const hasItems = computed(() => agents.value.length > 0 || groups.value.length > 0)
const isEditing = computed(() => !!editingId.value)
const editorTitle = computed(() => isEditing.value ? '编辑 Agent' : '新增 Agent')
const agentIdError = computed(() => {
  const id = editForm.value.agentId
  return id.length > 0 && !/^[a-zA-Z_-]+$/.test(id)
})
const agentIdDuplicate = computed(() => {
  if (isEditing.value || !editForm.value.agentId) return false
  // 检查 id + folder 组合是否已被占用
  const targetId = editForm.value.folder
    ? `agent-${editForm.value.folder}/${editForm.value.agentId}`
    : `agent-${editForm.value.agentId}`
  return agents.value.some((a) => a.id === targetId)
})

/** 无分组的 Agent（folder === undefined/null） */
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
    agentsDirPath.value = response.agentsDir || ''
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

// ── 新增 / 编辑 ──

/** 打开新增弹窗 */
const handleCreateAgent = (): void => {
  editingId.value = null
  editForm.value = { ...defaultForm }
  showEditorDialog.value = true
}

/** 打开编辑弹窗（先加载详情） */
const openEditor = async (agent: any): Promise<void> => {
  editingId.value = agent.id
  // 从 agent.id 中提取标识符（去掉 "agent-" 前缀）
  const baseId = agent.id.startsWith('agent-') ? agent.id.slice(6) : agent.id
  // 先填充卡片已有的信息
  editForm.value = {
    name: agent.name || '',
    agentId: baseId,
    description: agent.description || '',
    color: agent.color || 'gray',
    emoji: agent.emoji || '🤖',
    visible: agent.visible !== false,
    body: '',
    folder: agent.folder || '',
  }
  showEditorDialog.value = true

  // 异步加载完整 body
  try {
    const detail = await apiService.fetchAgentDetail(agent.id)
    if (detail.success && detail.data) {
      editForm.value.body = detail.data.body || ''
    }
  } catch {
    // 静默失败
  }
}

/** 保存（新增或更新） */
const handleSaveAgent = async (): Promise<void> => {
  if (!editForm.value.name.trim()) {
    toast.warning('请输入 Agent 名称')
    return
  }

  // 创建时 id 必填
  if (!isEditing.value) {
    if (!editForm.value.agentId.trim()) {
      toast.warning('请输入 Agent ID')
      return
    }
    if (!/^[a-zA-Z_-]+$/.test(editForm.value.agentId)) {
      toast.warning('ID 只允许英文字母、下划线、短横线')
      return
    }
    if (agentIdDuplicate.value) {
      toast.warning('该 ID 已被使用，请换一个')
      return
    }
  }

  saving.value = true
  try {
    const payload: any = {
      name: editForm.value.name.trim(),
      description: editForm.value.description.trim(),
      emoji: editForm.value.emoji || '🤖',
      visible: editForm.value.visible,
      body: editForm.value.body,
      folder: editForm.value.folder || undefined,
    }

    if (!isEditing.value) {
      payload.id = editForm.value.agentId
    }

    if (isEditing.value) {
      await apiService.updateAgent(editingId.value!, payload)
      toast.success('Agent 已更新')
    } else {
      await apiService.createAgent(payload)
      toast.success('Agent 已创建')
    }

    showEditorDialog.value = false
    await loadAgents()
  } catch (error: any) {
    console.error('保存 Agent 失败:', error)
    toast.error(error?.message || '保存失败')
  } finally {
    saving.value = false
  }
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

// ── 导出 ──

/** 导出单个 Agent 为 .md 文件 */
const handleExportAgent = async (agent: any): Promise<void> => {
  try {
    // 获取完整 body
    let body = ''
    try {
      const detail = await apiService.fetchAgentDetail(agent.id)
      if (detail.success && detail.data) {
        body = detail.data.body || ''
      }
    } catch {
      // 静默，body 留空
    }
    // 从 agent.id 提取文件名标识
    const fileId = agent.id.startsWith('agent-') ? agent.id.slice(6) : agent.id
    const filename = `${fileId}.md`

    // 重建 .md 内容
    const frontmatter: Record<string, any> = {
      name: agent.name,
    }
    if (agent.description) frontmatter.description = agent.description
    if (agent.emoji && agent.emoji !== '🤖') frontmatter.emoji = agent.emoji
    if (agent.visible === false) frontmatter.visible = false
    if (agent.color && agent.color !== 'gray') frontmatter.color = agent.color

    const yamlStr = Object.entries(frontmatter)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n')
    const mdContent = `---\n${yamlStr}\n---\n${body}`

    // 触发下载
    const blob = new Blob([mdContent], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`已导出 ${filename}`)
  } catch (error: any) {
    console.error('导出 Agent 失败:', error)
    toast.error('导出失败')
  }
}

// ── 导入 ──

/** 点击导入按钮 → 打开导入弹窗 */
const handleImportClick = (): void => {
  pendingFiles.value = []
  importFolder.value = ''
  importResults.value = []
  importSummary.value = null
  showImportDialog.value = true
}

/** 选择文件后 → 读取内容，追加到文件列表 */
const selectImportFiles = (): void => {
  fileInputRef.value?.click()
}

const handleFilesSelected = async (event: Event): Promise<void> => {
  const input = event.target as HTMLInputElement
  if (!input.files || input.files.length === 0) return

  for (const file of Array.from(input.files)) {
    try {
      const content = await file.text()
      pendingFiles.value.push({ content, filename: file.name })
    } catch {
      toast.error(`读取文件失败: ${file.name}`)
    }
  }

  // 重置 input 以便再次选择同一文件
  input.value = ''
}

/** 复制 agents 目录路径 */
const copyAgentsDir = (): void => {
  if (!agentsDirPath.value) return
  navigator.clipboard.writeText(agentsDirPath.value).then(() => {
    toast.success('目录路径已复制')
  }).catch(() => {
    toast.error('复制失败')
  })
}

/** 确认导入 */
const handleConfirmImport = async (): Promise<void> => {
  if (pendingFiles.value.length === 0) return

  importing.value = true
  importResults.value = []
  importSummary.value = null
  try {
    const resp = await apiService.importAgents({
      files: pendingFiles.value,
      folder: importFolder.value || undefined,
    })
    if (resp.success) {
      importResults.value = resp.results || []
      importSummary.value = resp.summary
      await loadAgents()
    } else {
      toast.error(resp.message || '导入失败')
      showImportDialog.value = false
    }
  } catch (error: any) {
    console.error('导入 Agent 失败:', error)
    toast.error('导入失败')
    showImportDialog.value = false
  } finally {
    importing.value = false
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

<style>
/* Emoji picker grid (global: rendered outside scoped via popper-class) */
.emoji-picker-popover .emoji-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 2px;
  max-height: 260px;
  overflow-y: auto;
}
.emoji-picker-popover .emoji-item {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  font-size: 20px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
}
.emoji-picker-popover .emoji-item:hover {
  background: #f0f0f0;
}
.emoji-picker-popover .emoji-item.active {
  background: var(--color-primary-light, #e0e7ff);
  outline: 2px solid var(--color-primary, #409eff);
  outline-offset: -2px;
}
</style>
