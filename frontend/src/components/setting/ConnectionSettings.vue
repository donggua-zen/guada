<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-lg font-bold">{{ t('settings.connection.title') }}</h2>
        <p class="text-sm text-gray-400 mt-0.5">{{ t('settings.connection.desc') }}</p>
      </div>
      <el-button type="primary" @click="startNew">{{ t('settings.connection.newConnection') }}</el-button>
    </div>

    <!-- 连接列表 -->
    <div v-if="connections.length > 0" class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));">
      <div v-for="conn in connections" :key="conn.id"
        class="p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:shadow-md transition-shadow">
        <div class="flex items-start justify-between mb-2">
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 rounded-lg flex items-center justify-center"
              :style="{ background: `hsl(${hue(conn.name)}, 55%, 90%)` }">
              <span class="text-xs font-bold" :style="{ color: `hsl(${hue(conn.name)}, 50%, 40%)` }">
                {{ conn.name.charAt(0).toUpperCase() }}
              </span>
            </div>
            <div>
              <div class="text-sm font-medium">{{ conn.name }}</div>
              <div class="text-xs text-gray-400">SSH</div>
            </div>
          </div>
          <div class="flex gap-1">
            <el-button text size="small" @click="editConn(conn)">{{ t('common.edit') }}</el-button>
            <el-button text size="small" type="danger" @click="deleteConn(conn.id)">{{ t('common.delete') }}</el-button>
          </div>
        </div>
        <div class="text-xs text-gray-400 truncate">
          {{ conn.config.username }}@{{ conn.config.host }}:{{ conn.config.port || 22 }}
        </div>
        <div class="text-xs text-gray-400 truncate mt-0.5">
          {{ conn.config.path }}
        </div>
      </div>
    </div>
    <div v-else class="text-center py-12 text-gray-400">
      <p class="text-sm">{{ t('settings.connection.noConnections') }}</p>
      <p class="text-xs mt-1">{{ t('settings.connection.noConnectionsDesc') }}</p>
    </div>

    <!-- 新建/编辑弹窗：分步向导 -->
    <LDialog v-model="editing" width="640px"
      :close-on-click-modal="false" append-to-body class="conn-dialog">
      <div class="flex" style="height: 400px;">
        <!-- 左侧步骤导航 -->
        <div class="shrink-0 pr-5 pt-4 flex flex-col gap-5">
          <div v-for="(step, i) in stepLabels" :key="i"
            class="flex items-center gap-2 text-xs whitespace-nowrap"
            :class="currentStep === i
              ? 'font-medium text-gray-800 dark:text-gray-200'
              : currentStep > i
                ? 'text-green-600 dark:text-green-400'
                : 'text-gray-400 dark:text-gray-500'">
            <span class="w-5 h-5 rounded-full flex items-center justify-center text-[10px] shrink-0"
              :class="currentStep === i
                ? 'bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-800'
                : currentStep > i
                  ? 'bg-green-500 text-white'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-400'">
              <span v-if="currentStep > i">✓</span>
              <span v-else>{{ i + 1 }}</span>
            </span>
            <span>{{ step }}</span>
          </div>
        </div>

        <!-- 右侧内容区 -->
        <div class="flex-1 pl-6 flex flex-col min-w-0">
          <!-- Step 0: 填写配置 -->
          <div v-if="currentStep === 0" class="flex flex-col gap-4 flex-1">
            <div>
              <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300">{{ t('settings.connection.fillConfig') }}</h3>
              <p class="text-xs text-gray-400 mt-0.5">{{ t('settings.connection.fillConfigDesc') }}</p>
            </div>

            <div>
              <label class="text-xs text-gray-500 dark:text-gray-400 mb-1 block">{{ t('settings.connection.connectionName') }} <span class="text-red-500">*</span></label>
              <el-input v-model="editName" placeholder="my-server" />
            </div>

            <div class="flex gap-3 items-end">
              <div class="flex-1 min-w-0">
                <label class="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Host <span class="text-red-500">*</span></label>
                <el-input v-model="editConfig.host" placeholder="192.168.1.100" />
              </div>
              <div class="shrink-0" style="width: 110px;">
                <label class="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Port</label>
                <el-input-number v-model="editConfig.port" :min="1" :max="65535" controls-position="right" style="width: 110px;" />
              </div>
            </div>

            <div class="flex gap-3 items-end">
              <div class="flex-1 min-w-0">
                <label class="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Username <span class="text-red-500">*</span></label>
                <el-input v-model="editConfig.username" placeholder="root" />
              </div>
              <div class="shrink-0" style="width: 130px;">
                <label class="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Auth</label>
                <el-select v-model="editConfig.authMethod" style="width: 130px;">
                  <el-option :label="t('settings.connection.connectionName') === '连接名称' ? '密码' : 'Password'" value="password" />
                  <el-option :label="t('settings.connection.connectionName') === '连接名称' ? '私钥' : 'Private Key'" value="privateKey" />
                </el-select>
              </div>
            </div>

            <div v-if="editConfig.authMethod === 'password'">
              <label class="text-xs text-gray-500 dark:text-gray-400 mb-1 block">{{ t('settings.connection.connectionName') === '连接名称' ? '密码' : 'Password' }}</label>
              <el-input v-model="editConfig.password" type="password" show-password />
            </div>
            <div v-if="editConfig.authMethod === 'privateKey'">
              <label class="text-xs text-gray-500 dark:text-gray-400 mb-1 block">{{ t('settings.connection.connectionName') === '连接名称' ? '私钥内容' : 'Private Key' }}</label>
              <el-input v-model="editConfig.privateKey" type="textarea" :rows="4"
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;..." />
            </div>
          </div>

          <!-- Step 1: 测试连接 -->
          <div v-if="currentStep === 1" class="flex flex-col flex-1 gap-3 min-h-0">
            <div class="flex items-center gap-3">
              <div v-if="testing" class="w-8 h-8 border-3 border-gray-200 border-t-gray-600 dark:border-t-gray-300 rounded-full animate-spin shrink-0"></div>
              <div v-else-if="testResult?.success" class="w-8 h-8 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center shrink-0">
                <span class="text-lg text-green-600 dark:text-green-400">✓</span>
              </div>
              <div v-else-if="testResult" class="w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center shrink-0">
                <span class="text-lg text-red-500">✗</span>
              </div>
              <div class="flex-1 min-w-0">
                <p v-if="testing" class="text-sm text-gray-500">{{ t('settings.connection.testing') }} {{ editConfig.username }}@{{ editConfig.host }}:{{ editConfig.port }}...</p>
                <p v-else-if="testResult?.success" class="text-sm text-green-600 dark:text-green-400 font-medium">{{ t('settings.connection.sshConnected') }}</p>
                <p v-else-if="testResult" class="text-sm text-red-500 font-medium">{{ t('settings.connection.sshFailed') }}</p>
              </div>
            </div>

            <div v-if="testLog || testing" class="flex-1 min-h-0 bg-gray-900 dark:bg-black rounded-lg p-3 overflow-auto font-mono text-xs leading-relaxed">
              <pre class="text-gray-300 whitespace-pre-wrap">{{ testLog || 'Connecting...' }}</pre>
              <span v-if="testing" class="inline-block w-2 h-4 bg-green-400 animate-pulse align-middle"></span>
            </div>
          </div>

          <!-- Step 2: 选择远端目录 -->
          <div v-if="currentStep === 2" class="flex flex-col flex-1 min-h-0 gap-3">
            <div>
              <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300">{{ t('settings.connection.browseTitle') }}</h3>
              <p class="text-xs text-gray-400 mt-0.5">{{ t('settings.connection.browseDesc') }}</p>
            </div>
            <!-- 路径栏 -->
            <div class="flex gap-2 shrink-0">
              <el-input v-model="browserPath" placeholder="/" @keyup.enter="navigateBrowser" size="small" />
              <el-button size="small" @click="navigateBrowser" :loading="browserLoading">{{ t('settings.connection.goTo') }}</el-button>
            </div>
            <!-- 目录列表 -->
            <div class="flex-1 min-h-0 border rounded-lg overflow-hidden" style="border-color: var(--el-border-color, #dcdfe6);">
              <!-- 标题栏（风格与 item 一致，但不可点击） -->
              <div
                class="flex items-center gap-2 px-3 py-2 text-xs text-gray-400 select-none"
                :class="browserPath === '/' ? 'opacity-30 pointer-events-none' : 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800'"
                @click="goUp"
              >
                <span class="text-amber-500">📁</span>
                <span>{{ t('settings.connection.goUp') }}</span>
              </div>
              <!-- 目录/文件列表 -->
              <div class="overflow-auto" style="max-height: calc(100% - 38px);">
                <div v-if="browserLoading" class="text-center py-8 text-gray-400 text-sm">{{ t('settings.connection.loading') }}</div>
                <div v-else-if="browserEntries.length === 0" class="text-center py-8 text-gray-400 text-sm">{{ t('settings.connection.emptyDir') }}</div>
                <div v-for="entry in browserEntries" :key="entry.name"
                  class="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm"
                  @click="entry.isDirectory ? enterDir(entry.name) : null">
                  <span v-if="entry.isDirectory" class="text-amber-500">📁</span>
                  <span v-else class="text-gray-400">📄</span>
                  <span :class="entry.isDirectory ? 'font-medium' : 'text-gray-500'">{{ entry.name }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 底部按钮 -->
          <div class="flex justify-between items-center mt-auto pt-4 shrink-0">
            <el-button v-if="currentStep > 0" text @click="currentStep--">{{ t('settings.connection.prev') }}</el-button>
            <span v-else></span>
            <div class="flex gap-2">
              <el-button v-if="currentStep === 0" type="primary" @click="goToTest"
                :disabled="!editConfig.host || !editConfig.username || !editName.trim()">
                {{ t('settings.connection.next') }}
              </el-button>
              <el-button v-if="currentStep === 1 && !testing" @click="testConn" :disabled="!editConfig.host">
                {{ t('settings.connection.retest') }}
              </el-button>
              <el-button v-if="currentStep === 1 && testResult?.success" type="primary" @click="goToBrowse">
                {{ t('settings.connection.next') }}
              </el-button>
              <el-button v-if="currentStep === 2" type="primary" @click="saveConn" :loading="saving">
                {{ t('settings.connection.save') }}
              </el-button>
            </div>
          </div>
        </div>
      </div>
    </LDialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'
import LDialog from '@/components/ui/LDialog.vue'
import { apiService } from '@/services/ApiService'

const { t } = useI18n()

interface ConnectionConfig {
  host: string
  port: number
  username: string
  authMethod: 'password' | 'privateKey'
  password?: string
  privateKey?: string
  path: string
}

interface Connection {
  id: string
  name: string
  config: ConnectionConfig
}

interface DirEntry {
  name: string
  isDirectory: boolean
  size: number
}

const connections = ref<Connection[]>([])
const editing = ref(false)
const editConnId = ref<string | null>(null)
const editName = ref('')
const editConfig = ref<ConnectionConfig>({
  host: '', port: 22, username: 'root', authMethod: 'password', password: '', privateKey: '', path: ''
})
const saving = ref(false)
const testing = ref(false)
const testResult = ref<{ success: boolean; error?: string; log?: string } | null>(null)
const testLog = ref('')

const stepLabels = computed(() => [
  t('settings.connection.stepConfig'),
  t('settings.connection.stepTest'),
  t('settings.connection.stepBrowse'),
])
const currentStep = ref(0)

const browserPath = ref('/')
const browserEntries = ref<DirEntry[]>([])
const browserLoading = ref(false)

async function loadData() {
  try {
    connections.value = await apiService.getConnections()
  } catch (e) {
    console.error('Failed to load connections:', e)
  }
}
loadData()

function hue(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return h
}

function startNew() {
  editing.value = true
  editConnId.value = null
  editName.value = ''
  editConfig.value = { host: '', port: 22, username: 'root', authMethod: 'password', password: '', privateKey: '', path: '' }
  testResult.value = null
  testLog.value = ''
  currentStep.value = 0
}

function editConn(conn: Connection) {
  editing.value = true
  editConnId.value = conn.id
  editName.value = conn.name
  editConfig.value = { ...conn.config }
  testResult.value = null
  testLog.value = ''
  currentStep.value = 0
}

async function goToTest() {
  currentStep.value = 1
  await testConn()
}

async function testConn() {
  testing.value = true
  testResult.value = null
  testLog.value = ''
  try {
    const result = await apiService.testConnection(editConfig.value)
    testResult.value = result
    testLog.value = result.log || ''
  } catch (e: any) {
    testResult.value = { success: false, error: e.message || String(e) }
    testLog.value = e.message || String(e)
  } finally {
    testing.value = false
  }
}

async function goToBrowse() {
  currentStep.value = 2
  browserPath.value = editConfig.value.path || `/home/${editConfig.value.username}`
  await navigateBrowser()
}

async function navigateBrowser() {
  browserLoading.value = true
  try {
    browserEntries.value = await apiService.browsePath(editConfig.value, browserPath.value)
  } catch {
    browserEntries.value = []
  } finally {
    browserLoading.value = false
  }
}

function enterDir(name: string) {
  const current = browserPath.value.endsWith('/') ? browserPath.value : browserPath.value + '/'
  browserPath.value = current + name
  navigateBrowser()
}

function goUp() {
  const parts = browserPath.value.replace(/\/$/, '').split('/')
  parts.pop()
  browserPath.value = parts.join('/') || '/'
  navigateBrowser()
}

async function saveConn() {
  editConfig.value.path = browserPath.value
  if (!editName.value.trim()) { ElMessage.warning(t('settings.connection.nameRequired')); return }
  saving.value = true
  try {
    if (editConnId.value) {
      await apiService.updateConnection(editConnId.value, {
        name: editName.value, config: editConfig.value
      })
    } else {
      await apiService.createConnection(editName.value, editConfig.value)
    }
    await loadData()
    editing.value = false
    ElMessage.success(t('common.saveSuccess'))
  } catch (e: any) {
    ElMessage.error(t('common.saveFailed') + ': ' + (e.message || String(e)))
  } finally {
    saving.value = false
  }
}

async function deleteConn(id: string) {
  try {
    await apiService.deleteConnection(id)
    connections.value = connections.value.filter(c => c.id !== id)
    ElMessage.success(t('common.deleteSuccess'))
  } catch (e: any) {
    ElMessage.error(t('common.deleteFailed') + ': ' + (e.message || String(e)))
  }
}
</script>

<style scoped>
:deep(.conn-dialog .l-dialog__body) {
  padding: 0;
}
.border-3 {
  border-width: 3px;
}
</style>
