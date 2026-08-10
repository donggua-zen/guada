<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-lg font-bold">{{ t('settings.connection.title') }}</h2>
        <p class="text-sm text-gray-400 mt-0.5">{{ t('settings.connection.desc') }}</p>
      </div>
      <el-button type="primary" @click="startNew" :icon="Add24Regular">{{ t('settings.connection.newConnection') }}</el-button>
    </div>

    <!-- 连接列表 -->
    <div v-if="connections.length > 0" class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));">
      <div v-for="conn in connections" :key="conn.id"
        class="p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:shadow-md transition-shadow">
        <div class="flex items-start justify-between mb-2">
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 rounded-lg flex items-center justify-center"
              :style="{ background: `hsl(${hue(conn.name)}, 55%, 90%)` }">
              <Cloud24Regular class="w-4 h-4" :style="{ color: `hsl(${hue(conn.name)}, 50%, 40%)` }" />
            </div>
            <div>
              <div class="text-sm font-medium">{{ conn.name }}</div>
              <div class="text-xs text-gray-400">{{ conn.scheme.toUpperCase() }}</div>
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
      <Cloud24Regular class="w-12 h-12 mx-auto mb-3 opacity-30" />
      <p class="text-sm">{{ t('settings.connection.noConnections') }}</p>
      <p class="text-xs mt-1">{{ t('settings.connection.noConnectionsDesc') }}</p>
    </div>

    <!-- 编辑/新建弹窗 -->
    <el-dialog v-model="editing" :title="editConnId ? t('settings.connection.editConnection') : t('settings.connection.newConnection')" width="480px" :close-on-click-modal="false" append-to-body>
      <!-- 连接名称 -->
      <div class="flex flex-col gap-0.5 mb-3">
        <label class="text-xs font-medium">{{ t('settings.connection.connectionName') }} <span class="text-red-500">*</span></label>
        <el-input v-model="editName" placeholder="my-server" />
      </div>
      <!-- 类型 -->
      <div v-if="!editConnId" class="flex flex-col gap-0.5 mb-3">
        <label class="text-xs font-medium">{{ t('common.type') }}</label>
        <el-select v-model="editScheme" :placeholder="t('settings.connection.selectType')" class="w-full">
          <el-option v-for="p in providers.filter(p => p.scheme !== 'local')" :key="p.scheme" :label="p.label" :value="p.scheme" />
        </el-select>
      </div>
      <!-- SchemaForm -->
      <SchemaForm v-if="currentSchema.length > 0" :fields="currentSchema" v-model="editConfig" />
      <!-- 测试结果 -->
      <div v-if="testResult" class="mt-3 text-sm" :class="testResult.success ? 'text-green-500' : 'text-red-500'">
        {{ testResult.success ? t('settings.connection.connectionSuccess') : `✗ ${testResult.error}` }}
      </div>
      <!-- 按钮 -->
      <div class="flex justify-between mt-4">
        <el-button @click="testConn" :loading="testing" :disabled="!editScheme">{{ t('settings.connection.testConnection') }}</el-button>
        <div class="flex gap-2">
          <el-button @click="editing = false">{{ t('common.cancel') }}</el-button>
          <el-button type="primary" @click="saveConn" :loading="saving">{{ t('common.save') }}</el-button>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { Add24Regular, Cloud24Regular } from '@vicons/fluent'
import SchemaForm from '../chat/chat-input/SchemaForm.vue'
import { apiService } from '@/services/ApiService'
import type { ProviderInfo, SavedConnection, ConfigField } from '@/services/modules/workspace-connections.api'

const { t } = useI18n()

const providers = ref<ProviderInfo[]>([])
const connections = ref<SavedConnection[]>([])
const editing = ref(false)
const editConnId = ref<string | null>(null)
const editName = ref('')
const editScheme = ref('')
const editConfig = ref<Record<string, any>>({})
const testResult = ref<{ success: boolean; error?: string } | null>(null)
const testing = ref(false)
const saving = ref(false)

const currentSchema = computed<ConfigField[]>(() => {
  const p = providers.value.find(p => p.scheme === editScheme.value)
  return p?.configSchema || []
})

function hue(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return h
}

async function loadData() {
  try {
    const [provs, conns] = await Promise.all([
      apiService.getWorkspaceProviders(),
      apiService.getWorkspaceConnections(),
    ])
    providers.value = provs
    connections.value = conns
  } catch (e) {
    console.error('Failed to load connections:', e)
  }
}

onMounted(loadData)

watch(editScheme, (newScheme) => {
  if (!newScheme) return
  const provider = providers.value.find(p => p.scheme === newScheme)
  if (!provider) return
  const defaults: Record<string, any> = {}
  for (const field of provider.configSchema) {
    if (field.default !== undefined && editConfig.value[field.key] === undefined) {
      defaults[field.key] = field.default
    }
  }
  if (Object.keys(defaults).length > 0) {
    editConfig.value = { ...defaults, ...editConfig.value }
  }
})

function startNew() {
  editing.value = true
  editConnId.value = null
  editName.value = ''
  editScheme.value = ''
  editConfig.value = {}
  testResult.value = null
}

function editConn(conn: SavedConnection) {
  editing.value = true
  editConnId.value = conn.id
  editName.value = conn.name
  editScheme.value = conn.scheme
  editConfig.value = { ...conn.config }
  testResult.value = null
}

async function testConn() {
  testing.value = true
  testResult.value = null
  try {
    testResult.value = await apiService.testWorkspaceConnection({
      scheme: editScheme.value,
      config: editConfig.value,
    })
  } catch (e: any) {
    testResult.value = { success: false, error: e.message || String(e) }
  } finally {
    testing.value = false
  }
}

async function saveConn() {
  if (!editName.value.trim()) {
    ElMessage.warning(t('settings.connection.nameRequired'))
    return
  }
  saving.value = true
  try {
    if (editConnId.value) {
      await apiService.updateWorkspaceConnection(editConnId.value, {
        name: editName.value,
        config: editConfig.value,
      })
    } else {
      await apiService.createWorkspaceConnection({
        name: editName.value,
        scheme: editScheme.value,
        config: editConfig.value,
      })
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
    await apiService.deleteWorkspaceConnection(id)
    connections.value = connections.value.filter(c => c.id !== id)
    ElMessage.success(t('common.deleteSuccess'))
  } catch (e: any) {
    ElMessage.error(t('common.deleteFailed') + ': ' + (e.message || String(e)))
  }
}
</script>
