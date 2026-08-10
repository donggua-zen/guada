<template>
  <el-dialog
    :model-value="visible"
    @update:model-value="$emit('update:visible', $event)"
    title="远端目录"
    width="520px"
    :close-on-click-modal="false"
    append-to-body
  >
    <!-- 已保存连接列表 -->
    <template v-if="!editing">
      <div v-if="connections.length > 0" class="flex flex-col gap-1 mb-3">
        <div
          v-for="conn in connections"
          :key="conn.id"
          class="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-all duration-150"
          :class="conn.workspacePath === selectedWorkspacePath
            ? 'bg-(--color-sidebar-bg-active)'
            : 'hover:bg-(--color-sidebar-bg-hover)'"
          @click="selectConnection(conn)"
        >
          <el-icon size="18" class="shrink-0 text-(--color-text-gray)">
            <Cloud24Regular />
          </el-icon>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium text-(--color-text) truncate">{{ conn.name }}</div>
            <div class="text-xs text-gray-400 truncate">{{ conn.workspacePath }}</div>
          </div>
          <el-button text size="small" @click.stop="editConnection(conn)">编辑</el-button>
          <el-button text size="small" type="danger" @click.stop="removeConnection(conn.id)">删除</el-button>
        </div>
      </div>
      <div v-else class="text-center py-6 text-(--color-text-gray)">
        <p class="text-sm">暂无远端连接</p>
      </div>
      <el-button @click="startNew" type="primary" plain class="w-full">
        + 新建连接
      </el-button>
    </template>

    <!-- 新建/编辑表单 -->
    <template v-else>
      <!-- 连接名称 -->
      <div class="flex flex-col gap-0.5 mb-3">
        <label class="text-xs font-medium">连接名称 <span class="text-red-500">*</span></label>
        <el-input v-model="editName" placeholder="my-server" />
      </div>

      <!-- Provider 选择 -->
      <div v-if="!editConnId" class="flex flex-col gap-0.5 mb-3">
        <label class="text-xs font-medium">类型</label>
        <el-select v-model="editScheme" placeholder="选择连接类型" class="w-full">
          <el-option
            v-for="p in providers.filter(p => p.scheme !== 'local')"
            :key="p.scheme"
            :label="p.label"
            :value="p.scheme"
          />
        </el-select>
      </div>

      <!-- SchemaForm -->
      <SchemaForm
        v-if="currentSchema.length > 0"
        :fields="currentSchema"
        v-model="editConfig"
      />

      <!-- 测试结果 -->
      <div v-if="testResult" class="mt-3 text-sm" :class="testResult.success ? 'text-green-500' : 'text-red-500'">
        {{ testResult.success ? '✓ 连接成功' : `✗ ${testResult.error}` }}
      </div>

      <!-- 按钮 -->
      <div class="flex justify-between mt-4">
        <el-button @click="testConnection" :loading="testing" :disabled="!editScheme">
          测试连接
        </el-button>
        <div class="flex gap-2">
          <el-button @click="cancelEdit">取消</el-button>
          <el-button type="primary" @click="saveConnection" :loading="saving">
            保存
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Cloud24Regular } from '@vicons/fluent'
import SchemaForm from './SchemaForm.vue'
import { apiService } from '@/services/ApiService'
import type { ProviderInfo, SavedConnection, ConfigField } from '@/services/modules/workspace-connections.api'

const props = defineProps<{
  visible: boolean
  selectedWorkspacePath?: string | null
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  'select': [workspacePath: string]
}>()

const api = apiService

// State
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

// Load data when dialog opens
watch(() => props.visible, async (val) => {
  if (val) {
    editing.value = false
    testResult.value = null
    try {
      const [provs, conns] = await Promise.all([
        api.getWorkspaceProviders(),
        api.getWorkspaceConnections(),
      ])
      providers.value = provs
      connections.value = conns
    } catch (e) {
      console.error('Failed to load workspace connections:', e)
    }
  }
})

function selectConnection(conn: SavedConnection) {
  emit('select', conn.workspacePath)
  emit('update:visible', false)
}

function startNew() {
  editing.value = true
  editConnId.value = null
  editName.value = ''
  editScheme.value = ''
  editConfig.value = {}
  testResult.value = null
}

// When scheme changes, apply default values from configSchema to editConfig
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

function editConnection(conn: SavedConnection) {
  editing.value = true
  editConnId.value = conn.id
  editName.value = conn.name
  editScheme.value = conn.scheme
  editConfig.value = { ...conn.config }
  testResult.value = null
}

function cancelEdit() {
  editing.value = false
}

async function testConnection() {
  testing.value = true
  testResult.value = null
  try {
    testResult.value = await api.testWorkspaceConnection({
      scheme: editScheme.value,
      config: editConfig.value,
    })
  } catch (e: any) {
    testResult.value = { success: false, error: e.message || String(e) }
  } finally {
    testing.value = false
  }
}

async function saveConnection() {
  if (!editName.value.trim()) {
    ElMessage.warning('请填写连接名称')
    return
  }
  saving.value = true
  try {
    if (editConnId.value) {
      await api.updateWorkspaceConnection(editConnId.value, {
        name: editName.value,
        config: editConfig.value,
      })
    } else {
      await api.createWorkspaceConnection({
        name: editName.value,
        scheme: editScheme.value,
        config: editConfig.value,
      })
    }
    // Reload
    connections.value = await api.getWorkspaceConnections()
    editing.value = false
    ElMessage.success('保存成功')
  } catch (e: any) {
    ElMessage.error('保存失败: ' + (e.message || String(e)))
  } finally {
    saving.value = false
  }
}

async function removeConnection(id: string) {
  try {
    await api.deleteWorkspaceConnection(id)
    connections.value = connections.value.filter(c => c.id !== id)
    ElMessage.success('已删除')
  } catch (e: any) {
    ElMessage.error('删除失败: ' + (e.message || String(e)))
  }
}
</script>
