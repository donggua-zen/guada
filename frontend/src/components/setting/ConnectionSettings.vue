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
              <div class="text-xs text-gray-400">{{ connectionKind(conn) === 'docker' ? 'Docker' : 'SSH' }}</div>
            </div>
          </div>
          <div class="flex gap-1">
            <el-button text size="small" @click="editConn(conn)">{{ t('common.edit') }}</el-button>
            <el-button text size="small" type="danger" @click="deleteConn(conn.id)">{{ t('common.delete') }}</el-button>
          </div>
        </div>
        <div class="text-xs text-gray-400 truncate">
          {{ connectionTargetLine(conn.config) }}
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
    <GdDialog v-model="editing" width="640px"
      :close-on-click-modal="false" append-to-body class="conn-dialog">
      <div class="flex" style="height: 480px;">
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
          <div v-if="currentStep === 0" class="flex flex-col gap-4 flex-1 overflow-auto">
            <div>
              <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300">{{ t('settings.connection.fillConfig') }}</h3>
              <p class="text-xs text-gray-400 mt-0.5">{{ t('settings.connection.fillConfigDesc') }}</p>
            </div>

            <div>
              <label class="text-xs text-gray-500 dark:text-gray-400 mb-1 block">{{ t('settings.connection.connectionName') }} <span class="text-red-500">*</span></label>
              <el-input v-model="editName" placeholder="my-server" />
            </div>

            <!-- 连接类型：SSH 远程主机 / 本机（或远程 daemon）上的 Docker 容器 -->
            <div>
              <label class="text-xs text-gray-500 dark:text-gray-400 mb-1 block">{{ t('settings.connection.typeLabel') }}</label>
              <div class="flex w-fit rounded-lg overflow-hidden border border-(--gd-color-border) dark:border-gray-700">
                <button
                  v-for="opt in typeOptions"
                  :key="opt.value"
                  type="button"
                  class="px-4 py-1.5 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer"
                  :class="editConfig.kind === opt.value
                    ? 'bg-(--gd-color-primary) text-white border-(--gd-color-primary)'
                    : 'text-(--gd-color-text-gray) hover:bg-(--gd-color-primary-100) hover:text-(--gd-color-primary)'"
                  @click="switchType(opt.value)">
                  {{ opt.label }}
                </button>
              </div>
              <div class="text-xs text-gray-400 dark:text-[#8b8d95] mt-1">
                {{ editConfig.kind === 'docker' ? t('settings.connection.typeDockerDesc') : t('settings.connection.typeSshDesc') }}
              </div>
            </div>

            <!-- SSH 字段 -->
            <template v-if="editConfig.kind === 'ssh'">
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
                    <el-option v-for="opt in authOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
                  </el-select>
                </div>
              </div>

              <div v-if="editConfig.authMethod === 'password'">
                <label class="text-xs text-gray-500 dark:text-gray-400 mb-1 block">{{ t('settings.connection.passwordLabel') }}</label>
                <el-input v-model="editConfig.password" type="password" show-password />
              </div>
              <div v-if="editConfig.authMethod === 'privateKey'">
                <label class="text-xs text-gray-500 dark:text-gray-400 mb-1 block">{{ t('settings.connection.privateKeyPathLabel') }}</label>
                <div class="flex gap-2">
                  <el-input v-model="editConfig.privateKeyPath" class="flex-1 min-w-0"
                    :placeholder="isElectron ? t('settings.connection.privateKeyPathPlaceholderElectron') : t('settings.connection.privateKeyPathPlaceholderWeb')" />
                  <el-button v-if="isElectron" @click="selectPrivateKeyFile">
                    {{ t('settings.connection.browse') }}
                  </el-button>
                </div>
                <div class="text-xs text-gray-400 dark:text-[#8b8d95] mt-1">
                  {{ t('settings.connection.privateKeyPathDesc') }}
                </div>
              </div>
            </template>

            <!-- Docker 字段 -->
            <template v-else>
              <div>
                <label class="text-xs text-gray-500 dark:text-gray-400 mb-1 block">{{ t('settings.connection.containerLabel') }} <span class="text-red-500">*</span></label>
                <div class="flex gap-2">
                  <el-select v-model="editConfig.container" filterable allow-create default-first-option
                    class="flex-1 min-w-0" :placeholder="t('settings.connection.containerPlaceholder')"
                    :loading="containersLoading" @visible-change="onContainerDropdown">
                    <el-option v-for="c in runningContainers" :key="c.name" :label="c.name" :value="c.name">
                      <span class="text-sm">{{ c.name }}</span>
                      <span class="text-xs text-gray-400 ml-2">{{ c.image }}</span>
                    </el-option>
                  </el-select>
                  <el-button :loading="containersLoading" @click="loadContainers()">
                    {{ t('settings.connection.refreshContainers') }}
                  </el-button>
                </div>
                <div class="text-xs text-gray-400 dark:text-[#8b8d95] mt-1">
                  {{ t('settings.connection.containerDesc') }}
                </div>
                <div v-if="containersError" class="text-xs text-red-500 mt-1">{{ containersError }}</div>
              </div>

              <div>
                <label class="text-xs text-gray-500 dark:text-gray-400 mb-1 block">{{ t('settings.connection.dockerHostLabel') }}</label>
                <el-input v-model="editConfig.dockerHost" :placeholder="t('settings.connection.dockerHostPlaceholder')" />
                <div class="text-xs text-gray-400 dark:text-[#8b8d95] mt-1">
                  {{ t('settings.connection.dockerHostDesc') }}
                </div>
              </div>
            </template>

            <!-- 权限模式:横向切换按钮（两种连接类型共用，agent 端强制） -->
            <div>
              <label class="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                {{ t('settings.connection.permTitle') }}
              </label>
              <div class="flex w-fit rounded-lg overflow-hidden border border-(--gd-color-border) dark:border-gray-700">
                <button
                  v-for="opt in permOptions"
                  :key="opt.value"
                  type="button"
                  class="px-4 py-1.5 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer"
                  :class="editConfig.perm === opt.value
                    ? 'bg-(--gd-color-primary) text-white border-(--gd-color-primary)'
                    : 'text-(--gd-color-text-gray) hover:bg-(--gd-color-primary-100) hover:text-(--gd-color-primary)'"
                  @click="editConfig.perm = opt.value">
                  {{ opt.label }}
                </button>
              </div>
              <div class="text-xs text-gray-400 dark:text-[#8b8d95] mt-1">
                {{ t('settings.connection.permDesc') }}
              </div>
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
                <p v-if="testing" class="text-sm text-gray-500">{{ t('settings.connection.testing') }} {{ connectionTargetLine(editConfig) }}...</p>
                <p v-else-if="testResult?.success" class="text-sm text-green-600 dark:text-green-400 font-medium">{{ t('settings.connection.connectedOk') }}</p>
                <p v-else-if="testResult" class="text-sm text-red-500 font-medium">{{ t('settings.connection.connectedFailed') }}</p>
              </div>
            </div>

            <div v-if="testLog || testing" class="flex-1 min-h-0 bg-gray-900 dark:bg-black rounded-lg p-3 overflow-auto font-mono text-xs leading-relaxed">
              <pre class="text-gray-300 whitespace-pre-wrap">{{ testLog || 'Connecting...' }}</pre>
              <span v-if="testing" class="inline-block w-2 h-4 bg-green-400 animate-pulse align-middle"></span>
            </div>
          </div>

          <!-- Step 2: 选择工作目录（远端 / 容器内） -->
          <div v-if="currentStep === 2" class="flex flex-col flex-1 min-h-0 gap-3">
            <div>
              <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300">
                {{ editConfig.kind === 'docker' ? t('settings.connection.browseTitleDocker') : t('settings.connection.browseTitle') }}
              </h3>
              <p class="text-xs text-gray-400 mt-0.5">
                {{ editConfig.kind === 'docker' ? t('settings.connection.browseDescDocker') : t('settings.connection.browseDesc') }}
              </p>
            </div>
            <!-- 路径栏 -->
            <div class="flex gap-2 shrink-0">
              <el-input v-model="browserPath" placeholder="/" @keyup.enter="navigateBrowser()" size="small" />
              <el-button size="small" @click="navigateBrowser()" :loading="browserLoading">{{ t('settings.connection.goTo') }}</el-button>
            </div>
            <!-- 目录不存在提示:空列表会让用户误以为目录是空的 -->
            <div v-if="!browserExists && !browserLoading" class="shrink-0 text-xs text-red-500">
              {{ t('settings.connection.dirNotExist') }}
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

          <!-- Step 3: 部署验证 -->
          <div v-if="currentStep === 3" class="flex flex-col flex-1 gap-3 min-h-0">
            <div class="flex items-center gap-3">
              <div v-if="deploying" class="w-8 h-8 border-3 border-gray-200 border-t-gray-600 dark:border-t-gray-300 rounded-full animate-spin shrink-0"></div>
              <div v-else-if="deployResult?.success" class="w-8 h-8 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center shrink-0">
                <span class="text-lg text-green-600 dark:text-green-400">✓</span>
              </div>
              <div v-else-if="deployResult" class="w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center shrink-0">
                <span class="text-lg text-red-500">✗</span>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300">{{ t('settings.connection.deployTitle') }}</h3>
                <p class="text-xs text-gray-400 mt-0.5">{{ t('settings.connection.deployDesc') }}</p>
                <p v-if="deploying" class="text-sm text-gray-500 mt-1">{{ t('settings.connection.deploying') }}</p>
                <p v-else-if="deployResult?.success && deployResult?.installed" class="text-sm text-green-600 dark:text-green-400 font-medium mt-1">{{ t('settings.connection.deployInstalled') }}</p>
                <p v-else-if="deployResult?.success" class="text-sm text-green-600 dark:text-green-400 font-medium mt-1">{{ t('settings.connection.deploySuccess') }}</p>
                <p v-else-if="deployResult" class="text-sm text-red-500 font-medium mt-1">{{ t('settings.connection.deployFailed') }}</p>
              </div>
            </div>

            <div ref="deployLogBox" v-if="deployLog || deploying" class="flex-1 min-h-0 bg-gray-900 dark:bg-black rounded-lg p-3 overflow-auto font-mono text-xs leading-relaxed log-scroll">
              <pre class="text-gray-300 whitespace-pre-wrap">{{ deployLog || 'Deploying...' }}</pre>
              <span v-if="deploying" class="inline-block w-2 h-4 bg-green-400 animate-pulse align-middle"></span>
            </div>
          </div>

          <!-- 底部按钮 -->
          <div class="flex justify-between items-center mt-auto pt-4 shrink-0">
            <el-button v-if="currentStep > 0" text @click="currentStep--">{{ t('settings.connection.prev') }}</el-button>
            <span v-else></span>
            <div class="flex gap-2">
              <el-button v-if="currentStep === 0" type="primary" @click="goToTest"
                :disabled="!canProceedFromConfig">
                {{ t('settings.connection.next') }}
              </el-button>
              <el-button v-if="currentStep === 1 && !testing" @click="testConn" :disabled="!canProceedFromConfig">
                {{ t('settings.connection.retest') }}
              </el-button>
              <el-button v-if="currentStep === 1 && testResult?.success" type="primary" @click="goToBrowse">
                {{ t('settings.connection.next') }}
              </el-button>
              <el-button v-if="currentStep === 2" type="primary" @click="goToDeploy" :disabled="!browserExists">
                {{ t('settings.connection.next') }}
              </el-button>
              <el-button v-if="currentStep === 3 && !deploying" @click="deployConn" :disabled="!browserExists">
                {{ t('settings.connection.deployRetry') }}
              </el-button>
              <el-button v-if="currentStep === 3" type="primary" @click="saveConn" :disabled="!deployResult?.success" :loading="saving">
                {{ t('settings.connection.save') }}
              </el-button>
            </div>
          </div>
        </div>
      </div>
    </GdDialog>
  </div>
</template>

<script setup lang="ts">
import { getErrorMessage } from '@/utils/errorMessage'
import { ref, computed, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'
import GdDialog from '@/components/ui/GdDialog.vue'
import { apiService } from '@/services/ApiService'
import { useRemoteWorkspaceStore } from '@/stores/remoteWorkspace'
import {
  connectionKind,
  connectionTargetLine,
  type RemoteConnection,
  type RemoteConnectionConfig,
  type DockerContainerInfo,
  type DirEntry,
} from '@/services/modules/remote-workspace.api'

const { t } = useI18n()

// 部署轮询取消:组件卸载/窗口关闭时置 true 终止轮询,并通知后端中止部署任务
let deployPollingCancelled = false
let activeDeployJobId: string | null = null
function cancelDeployPolling() {
  deployPollingCancelled = true
  // 窗口/组件已关闭,后端无需继续部署 — 通知取消,释放 SSH/下载资源
  const jobId = activeDeployJobId
  activeDeployJobId = null
  if (jobId) {
    apiService.cancelDeploy(jobId).catch(() => {})
  }
}
onUnmounted(() => cancelDeployPolling())
// 窗口关闭/刷新时也终止轮询并通知后端取消
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', cancelDeployPolling)
}

const remoteWorkspaceStore = useRemoteWorkspaceStore()
/** 连接清单（store 统一管理，与聊天侧绑定入口 WorkingDirBar / WorkspaceSelectorPopover 共享） */
const connections = computed(() => remoteWorkspaceStore.connections)
const editing = ref(false)
const editConnId = ref<string | null>(null)
const editName = ref('')

/** 新连接的默认配置（SSH 形状；切到 Docker 时由 switchType 替换字段组） */
function defaultConfig(kind: 'ssh' | 'docker' = 'ssh'): RemoteConnectionConfig {
  return kind === 'docker'
    ? { kind: 'docker', container: '', dockerHost: '', path: '', perm: 'workspace' }
    : {
        kind: 'ssh',
        host: '', port: 22, username: 'root', authMethod: 'password',
        password: '', privateKeyPath: '', path: '', perm: 'workspace',
      }
}
const editConfig = ref<RemoteConnectionConfig>(defaultConfig())

/** 连接类型切换：替换为对应类型的默认字段组（已填的公共项 perm 保留） */
function switchType(kind: 'ssh' | 'docker') {
  if (editConfig.value.kind === kind) return
  const perm = editConfig.value.perm
  editConfig.value = { ...defaultConfig(kind), perm }
  // 路径属于目标侧概念：类型切换后原路径不再适用，浏览态一并重置
  browserPath.value = kind === 'docker' ? '/' : '/'
  browserEntries.value = []
  browserExists.value = false
  testResult.value = null
  testLog.value = ''
  deployResult.value = null
  deployLog.value = ''
}

const typeOptions = computed(() => [
  { value: 'ssh' as const, label: t('settings.connection.typeSsh') },
  { value: 'docker' as const, label: t('settings.connection.typeDocker') },
])

// ── 容器选择器（Docker 类型）──
const runningContainers = ref<DockerContainerInfo[]>([])
const containersLoading = ref(false)
const containersError = ref('')

async function loadContainers() {
  if (editConfig.value.kind !== 'docker') return
  containersLoading.value = true
  containersError.value = ''
  try {
    const result = await apiService.listDockerContainers(editConfig.value.dockerHost || undefined)
    runningContainers.value = result?.containers || []
    if (result?.error) containersError.value = result.error
  } catch (e) {
    containersError.value = getErrorMessage(e)
  } finally {
    containersLoading.value = false
  }
}

/** 下拉展开时按需刷新容器列表（避免进入向导即调用 docker） */
function onContainerDropdown(visible: boolean) {
  if (visible && runningContainers.value.length === 0) void loadContainers()
}


// Electron 环境判断(有文件选择能力)
const isElectron = typeof window !== 'undefined' && !!window.electronAPI

// Electron 下打开文件选择框选择私钥路径;Web 下手写路径
async function selectPrivateKeyFile() {
  try {
    const selected = await window.electronAPI?.selectFile?.()
    if (selected) {
      editConfig.value.privateKeyPath = selected
    }
  } catch (error) {
    console.error('选择私钥文件失败:', error)
  }
}
// 认证方式下拉选项（与 permOptions 同构：label 走 locale key）
const authOptions = computed(() => [
  { value: 'password' as const, label: t('settings.connection.authPassword') },
  { value: 'privateKey' as const, label: t('settings.connection.authPrivateKey') },
])
// 权限模式横向切换选项
const permOptions = computed(() => [
  { value: 'workspace', label: t('settings.connection.permWorkspace') },
  { value: 'readonly', label: t('settings.connection.permReadonly') },
  { value: 'unrestricted', label: t('settings.connection.permUnrestricted') },
])
const saving = ref(false)
const testing = ref(false)
const testResult = ref<{ success: boolean; error?: string; log?: string } | null>(null)
const testLog = ref('')
const deploying = ref(false)
const deployResult = ref<{ success: boolean; installed: boolean; version: string; log: string[] } | null>(null)
const deployLog = ref('')

const stepLabels = computed(() => [
  t('settings.connection.stepConfig'),
  t('settings.connection.stepTest'),
  t('settings.connection.stepBrowse'),
  t('settings.connection.stepDeploy'),
])
const currentStep = ref(0)

const browserPath = ref('/')
const browserEntries = ref<DirEntry[]>([])
/** 当前浏览的路径是否为存在的目录:决定能否进入部署步骤 */
const browserExists = ref(false)
const browserLoading = ref(false)

// 连接清单由 store 加载（失败静默，重开设置页时重试）
void remoteWorkspaceStore.ensureConnections()

function hue(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return h
}

function startNew() {
  editing.value = true
  editConnId.value = null
  editName.value = ''
  editConfig.value = defaultConfig()
  testResult.value = null
  testLog.value = ''
  deployResult.value = null
  deployLog.value = ''
  browserPath.value = '/'
  browserEntries.value = []
  browserExists.value = false
  runningContainers.value = []
  containersError.value = ''
  currentStep.value = 0
}

function editConn(conn: RemoteConnection) {
  editing.value = true
  editConnId.value = conn.id
  editName.value = conn.name
  // 从未选择过权限的旧连接:默认 workspace(按钮高亮体现);
  // kind 缺省(旧数据)由后端归一为 ssh,此处补上以便表单分支判断
  editConfig.value = { kind: 'ssh', ...conn.config, perm: conn.config.perm || 'workspace' }
  testResult.value = null
  testLog.value = ''
  deployResult.value = null
  deployLog.value = ''
  browserPath.value = conn.config.path || '/'
  browserEntries.value = []
  browserExists.value = false
  runningContainers.value = []
  containersError.value = ''
  currentStep.value = 0
}

/** Step 0 必填校验（按连接类型） */
const canProceedFromConfig = computed(() => {
  if (!editName.value.trim()) return false
  if (editConfig.value.kind === 'docker') return !!editConfig.value.container?.trim()
  return !!editConfig.value.host && !!editConfig.value.username
})

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
  } catch (e) {
    testResult.value = { success: false, error: getErrorMessage(e) }
    testLog.value = getErrorMessage(e)
  } finally {
    testing.value = false
  }
}

async function goToDeploy() {
  currentStep.value = 3
  await deployConn()
}

async function deployConn() {
  deploying.value = true
  deployResult.value = null
  deployLog.value = ''
  deployPollingCancelled = false
  try {
    // 启动后台部署任务,返回 jobId;轮询日志实现实时进度反馈
    const { jobId } = await apiService.deployConnection(editConfig.value)
    activeDeployJobId = jobId
    while (!deployPollingCancelled) {
      const state = await apiService.getDeployLog(jobId)
      deployLog.value = state.log?.join('\n') || ''
      if (state.done) {
        activeDeployJobId = null
        deployResult.value = state.result || { success: false, installed: false, version: '', log: state.log || [] }
        break
      }
      await new Promise((r) => setTimeout(r, 500))
    }
  } catch (e) {
    deployResult.value = { success: false, installed: false, version: '', log: [getErrorMessage(e)] }
    deployLog.value = getErrorMessage(e)
  } finally {
    deploying.value = false
  }
}

async function goToBrowse() {
  currentStep.value = 2
  // 旧连接保存的目录可能已被改名/删除:先按原路径浏览,确认不存在再回退到主目录,
  // 否则用户只看到一个空列表,分不清是"空目录"还是"目录不存在"。
  const saved = editConfig.value.path
  await navigateBrowser(saved || '')
  if (saved && !browserExists.value) {
    ElMessage.warning(t('settings.connection.pathMissingFallback'))
    await navigateBrowser('')
  }
}

async function navigateBrowser(target?: string) {
  browserLoading.value = true
  try {
    const result = await apiService.browsePath(editConfig.value, target ?? browserPath.value)
    browserPath.value = result.path
    // 当前浏览的目录即所选工作目录:同步回配置,部署步骤的 --root 预校验才能拿到新路径
    editConfig.value.path = result.path
    browserEntries.value = result.entries
    browserExists.value = result.exists
  } catch {
    browserEntries.value = []
    browserExists.value = false
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
  if (!editName.value.trim()) { ElMessage.warning(t('settings.connection.nameRequired')); return }
  saving.value = true
  try {
    // 路径栏里的内容可能未点「前往」生效:保存前按当前路径再校验一次存在性,
    // 避免把不存在的工作目录存进连接配置。
    const checked = await apiService.browsePath(editConfig.value, browserPath.value)
    if (!checked.exists) {
      ElMessage.error(t('settings.connection.dirNotExist'))
      return
    }
    editConfig.value.path = checked.path
    // store 动作成功后已同步本地清单，无需重新加载
    if (editConnId.value) {
      await remoteWorkspaceStore.updateConnection(editConnId.value, {
        name: editName.value, config: editConfig.value
      })
    } else {
      await remoteWorkspaceStore.createConnection(editName.value, editConfig.value)
    }
    editing.value = false
    ElMessage.success(t('common.saveSuccess'))
  } catch (e) {
    ElMessage.error(t('common.saveFailed') + ': ' + (getErrorMessage(e)))
  } finally {
    saving.value = false
  }
}

async function deleteConn(id: string) {
  try {
    await remoteWorkspaceStore.deleteConnection(id)
    ElMessage.success(t('common.deleteSuccess'))
  } catch (e) {
    ElMessage.error(t('common.deleteFailed') + ': ' + (getErrorMessage(e)))
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
/* 部署日志区域:滚动条始终可见,便于查看历史进度 */
.log-scroll {
  scrollbar-width: thin;           /* Firefox */
  scrollbar-color: #4b5563 #111827;
}
.log-scroll::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
.log-scroll::-webkit-scrollbar-track {
  background: #111827;
  border-radius: 4px;
}
.log-scroll::-webkit-scrollbar-thumb {
  background: #4b5563;
  border-radius: 4px;
}
.log-scroll::-webkit-scrollbar-thumb:hover {
  background: #6b7280;
}
</style>
