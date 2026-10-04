<template>
  <div class="flex-1 overflow-hidden">
    <div class="flex items-center justify-between gap-4 mb-8 mt-2">
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
    <GdDialog v-model="installDialogVisible" width="600px" :close-on-click-modal="false" destroy-on-close @closed="handleInstallClosed">
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

    <div class="space-y-4">
      <div class="grid gap-y-4 gap-x-3" style="grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));">
        <div
          v-for="tool in globalTools"
          :key="tool.pluginId"
          class="plugin-card flex flex-col overflow-hidden p-2.5 rounded-[var(--gd-size-surface-radius)] border border-(--gd-color-surface-border) bg-(--gd-color-surface) transition-all hover:bg-(--gd-color-surface-hover) hover:shadow-sm cursor-pointer"
          @click="showDetail(tool)"
        >
          <!-- Header: icon + name + source tag -->
          <div class="flex items-center gap-2.5 mb-3">
            <CardAvatar :src="tool.icon ? `/api/v1/plugins/${tool.pluginId}/icon` : null" :name="tool.displayName" :disabled="!tool.enabled" />
            <h3 class="font-semibold text-gray-900 dark:text-[#e8e9ed] truncate flex-1 min-w-0" style="font-size: var(--gd-size-text-sm);">
              {{ tool.displayName }}
            </h3>
            <el-tag v-if="tool.source === 'dev'" size="small" type="warning" effect="dark">{{ t('plugins.localTools.sourceDev') }}</el-tag>
            <el-tag v-else-if="tool.source === 'user'" size="small" type="success" effect="plain">{{ t('plugins.localTools.sourceUser') }}</el-tag>
          </div>

          <!-- Description (max 2 lines) -->
          <p class="text-gray-400 dark:text-[#6b6d75] line-clamp-2 h-[2.5rem]" style="font-size: calc(var(--gd-size-text-base) - 2px);">
            {{ tool.description }}
          </p>

          <!-- Footer: uninstall + switch -->
          <div class="flex items-center justify-end gap-2 mt-3">
            <el-button
              v-if="tool.source === 'dev' || tool.source === 'user'"
              link
              size="small"
              type="danger"
              @click.stop="handleUninstall(tool.pluginId)"
            >
              {{ t('plugins.localTools.uninstall') }}
            </el-button>
            <el-switch
              :model-value="tool.enabled"
              :loading="updatingTools.has(tool.pluginId)"
              @update:model-value="(val: string | number | boolean) => handleToggleTool(tool.pluginId, !!val)"
              @click.stop
              size="small"
              inline-prompt
              :active-text="t('plugins.localTools.enable')"
              :inactive-text="t('plugins.localTools.disable')"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Detail Dialog -->
    <GdDialog v-model="detailVisible" width="560px" align-center destroy-on-close>
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
import { ref, onMounted, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { apiService } from '@/services/ApiService'
import { getLocale } from '@/locales'
import CardAvatar from '@/components/ui/CardAvatar.vue'
import GdDialog from '@/components/ui/GdDialog.vue'
import type { PluginQueryPlugin } from '@/services/modules/settings.api'

const { t } = useI18n()

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

async function handleInstall() {
  // 兼容保留：直接同步安装（无轮询）。UI 用 startInstallDialog（假终端）。
  await startInstall()
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
  } catch (err: any) {
    installLog.value += '\n❌ ' + (err.message || String(err))
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
  } catch (err: any) {
    console.error('加载全局工具失败:', err)
    const errorMsg = err.message || t('plugins.localTools.loadFailed')
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
  } catch (err: any) {
    console.error('更新全局工具状态失败:', err)
    ElMessage.error(err.message || t('plugins.localTools.updateFailed'))
  }
}

function handleToggleTool(pluginId: string, enabled: boolean) {
  const tool = globalTools.value.find(t => t.pluginId === pluginId)
  if (!tool) return
  
  const previousState = tool.enabled
  
  try {
    updatingTools.value.add(pluginId)
    updateGlobalToolStatus(pluginId, enabled)
  } catch (err: any) {
    console.error('更新工具状态失败:', err)
    tool.enabled = previousState
    ElMessage.error(err.message || t('plugins.localTools.toggleFailed'))
  } finally {
    updatingTools.value.delete(pluginId)
  }
}

async function handleUninstall(pluginId: string) {
  try {
    await ElMessageBox.confirm(t('plugins.localTools.uninstallConfirm'), t('plugins.localTools.uninstallTitle'), {
      confirmButtonText: t('plugins.localTools.uninstallBtn'),
      cancelButtonText: t('common.cancel'),
      type: 'warning',
    })
    const response = await apiService._request(`/plugins/${pluginId}`, { method: 'DELETE' })
    if (response.success) {
      ElMessage.success(t('plugins.localTools.uninstallSuccess'))
      await loadGlobalTools()
    }
  } catch (err: any) {
    if (err !== 'cancel' && err?.message !== 'cancel') {
      ElMessage.error(err.message || t('plugins.localTools.uninstallFailed'))
    }
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
