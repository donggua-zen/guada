<template>
  <div class="flex-1 overflow-hidden">
    <div class="flex items-center justify-between gap-4 mb-6 mt-2">
      <div class="min-w-0">
          <h1 class="text-xl font-bold text-gray-900 dark:text-[#e8e9ed]">{{ t('plugins.localTools.title') }}</h1>
        <p class="text-sm text-gray-500 dark:text-[#8b8d95] mt-1">{{ t('plugins.localTools.subtitle') }}</p>
      </div>
      <el-button 
        v-if="loading" 
        :loading="true" 
        size="small"
      >
        {{ t('common.loading') }}
      </el-button>
      <el-button type="primary" size="small" @click="startInstallDialog">安装插件</el-button>
    </div>

    <!-- 安装进度弹窗（输入 source → 假终端进度） -->
    <GdDialog v-model="installDialogVisible" size="md" :close-on-click-modal="false" destroy-on-close @closed="handleInstallClosed">
      <template #header>
        <span>安装插件</span>
      </template>
      <!-- 输入 + 安装按钮（并排） -->
      <div class="install-row">
        <el-input
          v-model="installSource"
          placeholder="github:owner/repo#ref / gitee:owner/repo / git:https://…#ref / local:path"
          clearable
          @keyup.enter="beginInstall"
        />
        <el-button type="primary" :loading="installing" @click="beginInstall">安装</el-button>
      </div>
      <!-- 假终端（常驻） -->
      <div ref="installLogBox" class="install-terminal">
        <pre class="install-log">{{ installLog || '等待安装…' }}</pre>
        <span v-if="installing" class="terminal-cursor"></span>
      </div>
      <template #footer>
        <el-button v-if="installing" @click="cancelInstallDialog">取消</el-button>
        <el-button v-else @click="installDialogVisible = false">关闭</el-button>
      </template>
    </GdDialog>

    <div
      v-if="globalTools.length > 0"
      class="grid gap-4"
      style="grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));"
    >
      <PluginListRow
        v-for="tool in globalTools"
        :key="tool.pluginId"
        :name="tool.displayName || tool.name || tool.pluginId"
        :description="tool.description || t('plugins.localTools.noDescription')"
        :icon-src="tool.icon ? `/api/v1/plugins/${tool.pluginId}/icon` : null"
        :menu-items="getPluginMenuItems(tool)"
        @click="showDetail(tool)"
        @command="(command) => handlePluginCommand(command, tool)"
      >
        <template #badges>
          <el-tag v-if="tool.source === 'dev'" size="small" type="warning" effect="dark">{{ t('plugins.localTools.sourceDev') }}</el-tag>
          <el-tag v-else-if="tool.source === 'user'" size="small" type="success" effect="plain">{{ t('plugins.localTools.sourceUser') }}</el-tag>
        </template>
        <template #actions>
          <el-switch
            :model-value="tool.enabled"
            :loading="updatingTools.has(tool.pluginId)"
            @update:model-value="(val: string | number | boolean) => handleToggleTool(tool.pluginId, !!val)"
            @click.stop
            size="small"
          />
        </template>
      </PluginListRow>
    </div>

    <div
      v-else-if="!loading"
      class="rounded-[var(--gd-size-surface-radius)] bg-(--gd-color-surface-subtle) p-10 text-center"
    >
      <div class="text-sm text-(--gd-color-text-gray)">{{ t('plugins.localTools.empty') }}</div>
      <div class="mt-1 text-xs text-(--gd-color-text-disabled)">{{ t('plugins.localTools.emptyHint') }}</div>
    </div>

    <!-- Detail Dialog -->
    <GdDialog v-model="detailVisible" size="sm" align-center destroy-on-close>
      <template #header>
        <div class="flex items-center gap-3">
          <CardAvatar :src="currentTool?.icon ? `/api/v1/plugins/${currentTool?.pluginId}/icon` : null" :name="currentTool?.displayName" size="md" />
          <div class="flex items-center gap-2">
            <span class="text-base font-semibold text-gray-900 dark:text-[#e8e9ed]">{{ currentTool?.displayName }}</span>
            <el-tag v-if="currentTool?.source === 'dev'" size="small" type="warning" effect="dark">{{ t('plugins.localTools.sourceDev') }}</el-tag>
            <el-tag v-else-if="currentTool?.source === 'user'" size="small" type="success" effect="plain">{{ t('plugins.localTools.sourceUser') }}</el-tag>
          </div>
        </div>
      </template>

      <div v-if="currentTool" class="space-y-4">
        <div>
          <div class="text-xs text-gray-500 dark:text-[#8b8d95] mb-1">{{ t('plugins.localTools.descLabel') }}</div>
          <p class="text-sm text-gray-700 dark:text-[#d0d1d5] leading-relaxed">{{ currentTool.description }}</p>
        </div>

        <div v-if="currentTool.tools && currentTool.tools.length > 0">
          <div class="text-xs text-gray-500 dark:text-[#8b8d95] mb-2">{{ t('plugins.localTools.toolsLabel', { count: currentTool.tools.length }) }}</div>
          <div class="space-y-1.5">
            <div v-for="sub in currentTool.tools" :key="sub.name"
              class="flex items-start gap-2 py-1.5 px-3 rounded-[var(--gd-size-surface-radius)] bg-gray-50 dark:bg-[#2a2a2e]">
              <div class="flex-1 min-w-0">
                <div class="text-sm text-gray-700 dark:text-[#d0d1d5] font-medium">{{ sub.name }}</div>
                <div v-if="sub.description" class="text-xs text-gray-400 mt-0.5">{{ sub.description }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <template #footer>
        <el-button @click="detailVisible = false">{{ t('common.close') }}</el-button>
      </template>
    </GdDialog>
  </div>
</template>

<script setup lang="ts">
import { getErrorMessage } from '@/utils/errorMessage'
import { ref, onMounted, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { apiService } from '@/services/ApiService'
import { getLocale } from '@/locales'
import { usePopup } from '@/composables/usePopup'
import CardAvatar from '@/components/ui/CardAvatar.vue'
import GdDialog from '@/components/ui/GdDialog.vue'
import PluginListRow from './PluginListRow.vue'
import type { PluginRowMenuItem } from './pluginList.types'
import type { PluginQueryPlugin } from '@/services/modules/settings.api'

const { t } = useI18n()
const { confirm } = usePopup()

const loading = ref(false)
const error = ref<string | null>(null)
const updatingTools = ref<Set<string>>(new Set())
const installSource = ref('')
const installing = ref(false)

const globalTools = ref<PluginQueryPlugin[]>([])

// Detail dialog
const detailVisible = ref(false)
const currentTool = ref<PluginQueryPlugin | null>(null)

function showDetail(tool: PluginQueryPlugin) {
  currentTool.value = tool
  detailVisible.value = true
}

function getPluginMenuItems(tool: PluginQueryPlugin): PluginRowMenuItem[] {
  if (tool.source !== 'dev' && tool.source !== 'user') return []
  return [{ command: 'uninstall', label: t('plugins.localTools.uninstall'), danger: true }]
}

function handlePluginCommand(command: string, tool: PluginQueryPlugin) {
  if (command === 'uninstall') void handleUninstall(tool.pluginId)
}

// ── 安装假终端（轮询日志）──
const installDialogVisible = ref(false)
const installLog = ref('')
const installLogBox = ref<HTMLElement | null>(null)
let installPollCancelled = false
let activeInstallJobId: string | null = null

function startInstallDialog() {
  // 打开弹窗，进入输入阶段（不立即安装）
  installSource.value = ''
  installLog.value = ''
  installDialogVisible.value = true
}

function beginInstall() {
  const src = installSource.value.trim()
  if (!src || installing.value) return
  void startInstall()
}

async function startInstall() {
  installing.value = true
  installLog.value = ''
  installPollCancelled = false
  try {
    const { jobId } = await apiService.installPlugin(installSource.value.trim())
    activeInstallJobId = jobId
    while (!installPollCancelled) {
      const state = await apiService.getInstallLog(jobId)
      installLog.value = state.log.join('\n')
      if (state.done) {
        activeInstallJobId = null
        installing.value = false
        if (state.result?.success) {
          installLog.value += '\n\n✅ 安装成功'
          installSource.value = ''
          await loadGlobalTools()
        } else {
          installLog.value += '\n\n❌ 安装失败'
        }
        break
      }
      await new Promise((r) => setTimeout(r, 500))
    }
  } catch (err) {
    installLog.value += '\n❌ ' + (getErrorMessage(err))
    installing.value = false
  }
}

function cancelInstallDialog() {
  if (activeInstallJobId) {
    apiService.cancelInstall(activeInstallJobId).catch(() => {})
  }
  installPollCancelled = true
  activeInstallJobId = null
  installing.value = false
}

function handleInstallClosed() {
  cancelInstallDialog()
}

// 自动滚动假终端到底部
watch(installLog, () => {
  nextTick(() => {
    if (installLogBox.value) {
      installLogBox.value.scrollTop = installLogBox.value.scrollHeight
    }
  })
})

async function loadGlobalTools() {
  loading.value = true
  error.value = null

  try {
    const response = await apiService.queryPlugins(undefined, getLocale())
    globalTools.value = response.plugins
  } catch (err) {
    console.error('加载全局工具失败:', err)
    const errorMsg = getErrorMessage(err) || t('plugins.localTools.loadFailed')
    error.value = errorMsg
    ElMessage.error(errorMsg)
  } finally {
    loading.value = false
  }
}

async function updateGlobalToolStatus(pluginId: string, enabled: boolean) {
  try {
    const response = await apiService.updateGlobalToolStatus(pluginId, enabled)
    if (response.success) {
      const tool = globalTools.value.find(t => t.pluginId === pluginId)
      if (tool) {
        tool.enabled = enabled
      }
    }
  } catch (err) {
    console.error('更新全局工具状态失败:', err)
    ElMessage.error(getErrorMessage(err) || t('plugins.localTools.updateFailed'))
  }
}

function handleToggleTool(pluginId: string, enabled: boolean) {
  const tool = globalTools.value.find(t => t.pluginId === pluginId)
  if (!tool) return
  
  const previousState = tool.enabled
  
  try {
    updatingTools.value.add(pluginId)
    updateGlobalToolStatus(pluginId, enabled)
  } catch (err) {
    console.error('更新工具状态失败:', err)
    tool.enabled = previousState
    ElMessage.error(getErrorMessage(err) || t('plugins.localTools.toggleFailed'))
  } finally {
    updatingTools.value.delete(pluginId)
  }
}

async function handleUninstall(pluginId: string) {
  const ok = await confirm(t('plugins.localTools.uninstallTitle'), t('plugins.localTools.uninstallConfirm'), {
    confirmText: t('plugins.localTools.uninstallBtn'),
    cancelText: t('common.cancel'),
    type: 'warning',
  })
  if (!ok) return

  try {
    const response = await apiService._request(`/plugins/${pluginId}`, { method: 'DELETE' })
    if (response.success) {
      ElMessage.success(t('plugins.localTools.uninstallSuccess'))
      await loadGlobalTools()
    }
  } catch (err) {
    ElMessage.error(getErrorMessage(err) || t('plugins.localTools.uninstallFailed'))
  }
}

onMounted(() => {
  loadGlobalTools()
})
</script>

<style scoped>
.install-row { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; }
.install-terminal {
  background-color: #0d1117;
  color: #c9d1d9;
  border-radius: 8px;
  padding: 12px;
  min-height: 220px;
  max-height: 320px;
  overflow-y: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
}
.install-log {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
}
.terminal-cursor {
  display: inline-block;
  width: 7px;
  height: 14px;
  background: #58a6ff;
  animation: blink 1s step-end infinite;
  vertical-align: text-bottom;
}
@keyframes blink {
  50% { opacity: 0; }
}
</style>
