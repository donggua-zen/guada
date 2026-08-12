<template>
    <div class="flex-1 overflow-hidden">
        <div class="flex items-center justify-between gap-4 mb-8 mt-2">
            <div class="min-w-0">
                <h1 class="text-xl font-bold text-gray-900 dark:text-[#e8e9ed]">{{ t('plugins.mcp.title') }}</h1>
                <p class="text-sm text-gray-500 dark:text-[#8b8d95] mt-1">{{ t('plugins.mcp.subtitle') }}</p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
                <el-button @click="handleImport">
                    <template #icon>
                        <UploadOutlined />
                    </template>
                    {{ t('plugins.mcp.importConfig') }}
                </el-button>
                <el-button type="primary" @click="handleAddServer">
                    <template #icon>
                        <AddOutlined />
                    </template>
                    {{ t('plugins.mcp.addServer') }}
                </el-button>
            </div>
        </div>

        <!-- MCP 服务器列表 -->
        <div v-if="servers.length > 0" class="grid gap-y-4 gap-x-3"
            style="grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));">
            <div v-for="server in servers" :key="server.id"
                class="plugin-card flex flex-col overflow-hidden p-2.5 rounded-[var(--size-surface-radius)] border border-(--color-surface-border) bg-(--color-surface) transition-all hover:bg-(--color-surface-hover) hover:shadow-sm cursor-pointer"
                @click="handleEditServer(server)">
                <div class="flex items-center gap-2.5 mb-3">
                    <CardAvatar :name="server.name" :disabled="!server.enabled" />
                    <h3 class="font-semibold text-gray-900 dark:text-[#e8e9ed] truncate flex-1 min-w-0" style="font-size: var(--size-text-sm);">
                        {{ server.name }}
                    </h3>
                </div>

                <p class="text-gray-400 dark:text-[#6b6d75] line-clamp-2 h-[2.5rem]" style="font-size: calc(var(--size-text-base) - 2px);">
                    {{ server.description || t('plugins.mcp.noDescription') }}
                </p>

                <div class="flex items-center justify-end gap-2 mt-3">
                    <el-button link size="small" type="danger" @click.stop="handleDeleteServer(server)">
                        {{ t('common.delete') }}
                    </el-button>
                    <el-switch v-model="server.enabled" :active-value="true" :inactive-value="false"
                        @change="handleToggleServer(server)" @click.stop size="small" inline-prompt
                        :active-text="t('plugins.mcp.enable')" :inactive-text="t('plugins.mcp.disable')" />
                </div>
            </div>
        </div>
        <div v-else
            class="rounded-[var(--size-surface-radius)] border border-(--color-surface-border) bg-(--color-surface) p-12 text-center">
            <el-icon size="48" class="mb-3 opacity-50 text-gray-400">
                <InboxOutlined />
            </el-icon>
            <div class="text-gray-500 dark:text-[#8b8d95]">{{ t('plugins.mcp.empty') }}</div>
            <div class="text-sm text-gray-400 dark:text-[#6b6d75] mt-2">{{ t('plugins.mcp.emptyHint') }}</div>
        </div>

        <!-- 添加/编辑服务器对话框 -->
        <LDialog v-model="showModal" :title="isEditMode ? t('plugins.mcp.editTitle') : t('plugins.mcp.addTitle')" width="80%" align-center
            destroy-on-close append-to-body>

            <!-- Tab 切换 -->
            <el-tabs v-model="activeTab" class="mb-4">
                <el-tab-pane :label="t('plugins.mcp.tabConfig')" name="config">
                    <el-form ref="formRef" :model="serverForm" :rules="formRules" label-position="left"
                        label-width="120px" size="large">
                        <el-form-item :label="t('plugins.mcp.nameLabel')" prop="name">
                            <el-input v-model="serverForm.name" :placeholder="t('plugins.mcp.namePlaceholder')" />
                        </el-form-item>

                        <!-- HTTP 协议配置 (sse/streamableHttp) -->
                        <template v-if="serverForm.type !== 'stdio'">
                            <el-form-item :label="t('plugins.mcp.urlLabel')" prop="url">
                                <el-input v-model="serverForm.url" placeholder="https://example.com/mcp" />
                            </el-form-item>

                            <el-form-item :label="t('plugins.mcp.headersLabel')" prop="headers">
                                <el-input v-model="serverForm.headers" type="textarea" :rows="5"
                                    :placeholder="t('plugins.mcp.headersPlaceholder')" />
                                <div class="text-xs text-gray-400 mt-1">
                                    {{ t('plugins.mcp.headersHint') }}
                                </div>
                            </el-form-item>
                        </template>

                        <!-- Stdio 协议配置 -->
                        <template v-if="serverForm.type === 'stdio'">
                            <el-form-item :label="t('plugins.mcp.commandLabel')" prop="command">
                                <el-input v-model="serverForm.command" :placeholder="t('plugins.mcp.commandPlaceholder')" />
                                <div class="text-xs text-gray-400 mt-1">
                                    {{ t('plugins.mcp.commandHint') }}
                                </div>
                            </el-form-item>

                            <el-form-item :label="t('plugins.mcp.argsLabel')" prop="args">
                                <el-input v-model="serverForm.args" type="textarea" :rows="3"
                                    :placeholder="t('plugins.mcp.argsPlaceholder')" />
                                <div class="text-xs text-gray-400 mt-1">
                                    {{ t('plugins.mcp.argsHint') }}
                                </div>
                            </el-form-item>

                            <el-form-item :label="t('plugins.mcp.envLabel')" prop="env">
                                <el-input v-model="serverForm.env" type="textarea" :rows="5"
                                    :placeholder="t('plugins.mcp.envPlaceholder')" />
                                <div class="text-xs text-gray-400 mt-1">
                                    {{ t('plugins.mcp.envHint') }}
                                </div>
                            </el-form-item>

                            <el-form-item :label="t('plugins.mcp.cwdLabel')" prop="cwd">
                                <el-input v-model="serverForm.cwd" :placeholder="t('plugins.mcp.cwdPlaceholder')" />
                            </el-form-item>
                        </template>

                        <el-form-item label="协议类型" prop="type">
                            <el-select v-model="serverForm.type" placeholder="选择协议类型" clearable style="width: 100%">
                                <el-option label="标准输入 / 输出 (stdio)" value="stdio" />
                                <el-option label="服务器发送事件 (sse)" value="sse" />
                                <el-option label="可流式传输的 HTTP (streamableHttp)" value="streamableHttp" />
                            </el-select>
                        </el-form-item>

                        <el-form-item :label="t('plugins.mcp.descLabel')" prop="description">
                            <el-input v-model="serverForm.description" type="textarea" :rows="3"
                                :placeholder="t('plugins.mcp.descPlaceholder')" />
                        </el-form-item>

                        <el-form-item :label="t('plugins.mcp.enabledLabel')">
                            <el-switch v-model="serverForm.enabled" inline-prompt :active-text="t('plugins.mcp.enabledOn')" :inactive-text="t('plugins.mcp.enabledOff')"
                                size="large" />
                        </el-form-item>
                    </el-form>
                </el-tab-pane>

                <el-tab-pane :label="t('plugins.mcp.tabTools')" name="tools">
                    <div v-if="!isEditMode" class="py-12 text-center">
                        <el-icon size="48" class="mb-3 opacity-50 text-gray-400">
                            <InfoOutlined />
                        </el-icon>
                        <div class="text-gray-500">{{ t('plugins.mcp.toolsNewHint') }}</div>
                        <div class="text-sm text-gray-400 mt-2">{{ t('plugins.mcp.toolsNewHintSub') }}</div>
                    </div>

                    <div v-else class="tools-panel">
                        <div class="flex items-center justify-between mb-3">
                            <div class="text-sm text-gray-600 dark:text-[#8b8d95]">
                                {{ t('plugins.mcp.toolsCount', { count: toolsList.length }) }}
                            </div>
                            <el-button size="small" @click="handleRefreshTools" :loading="refreshingTools">
                                <el-icon class="mr-1" :class="{ 'is-loading': refreshingTools }">
                                    <RefreshRight />
                                </el-icon>
                                {{ t('plugins.mcp.refreshTools') }}
                            </el-button>
                        </div>

                        <div v-if="toolsList.length > 0" class="tools-list">
                            <div v-for="(tool, index) in toolsList" :key="index"
                                class="tool-item p-3 mb-2 rounded border border-gray-200 dark:border-[#2e3035] bg-gray-50 dark:bg-[#2a2c30]/50">
                                <div class="font-semibold text-sm mb-2">{{ tool.name }}</div>
                                <div class="text-xs text-gray-500 dark:text-[#8b8d95] mb-2 line-clamp-2">
                                    {{ tool.description || t('plugins.mcp.noDescription') }}
                                </div>
                                <div v-if="tool.inputSchema" class="text-xs">
                                    <div class="text-gray-400 mb-1">{{ t('plugins.mcp.toolParams') }}</div>
                                    <div class="text-gray-600 dark:text-[#e8e9ed]">
                                        <span
                                            v-if="!tool.inputSchema.properties || Object.keys(tool.inputSchema.properties).length === 0"
                                            class="text-gray-400">
                                            {{ t('plugins.mcp.noParams') }}
                                        </span>
                                        <div v-else class="space-y-1">
                                            <div v-for="(paramInfo, paramName) in tool.inputSchema.properties"
                                                :key="paramName" class="flex items-start gap-2">
                                                <span class="font-mono text-blue-600 dark:text-blue-400">{{ paramName
                                                }}</span>
                                                <span class="text-gray-400">:</span>
                                                <span class="text-gray-600 dark:text-[#e8e9ed] flex-1">
                                                    {{ paramInfo.description || paramInfo.type || '' }}
                                                </span>
                                                <el-tag
                                                    v-if="tool.inputSchema.required && tool.inputSchema.required.includes(paramName)"
                                                    type="danger" size="small">{{ t('plugins.mcp.paramRequired') }}</el-tag>
                                                <el-tag v-else-if="paramInfo.default !== undefined" type="info"
                                                    size="small">{{ t('plugins.mcp.paramDefault', { value: paramInfo.default }) }}</el-tag>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div v-else class="py-8 text-center text-gray-400">
                            <el-icon size="36" class="mb-2 opacity-50">
                                <InboxOutlined />
                            </el-icon>
                            <div class="text-sm">{{ t('plugins.mcp.toolsEmpty') }}</div>
                            <div class="text-xs mt-1">{{ t('plugins.mcp.toolsEmptyHint') }}</div>
                        </div>
                    </div>
                </el-tab-pane>
            </el-tabs>

            <template #footer>
                <span class="dialog-footer">
                    <el-button @click="showModal = false">{{ t('common.cancel') }}</el-button>
                    <el-button type="primary" @click="handleSaveServer" :loading="saving">{{ t('common.ok') }}</el-button>
                </span>
            </template>
        </LDialog>

        <!-- 导入配置对话框 -->
        <LDialog v-model="showImportModal" :title="t('plugins.mcp.importTitle')" align-center destroy-on-close
            width="80%">

            <div class="mb-4">
                <div class="text-sm text-gray-600 dark:text-[#8b8d95] mb-2">
                    {{ t('plugins.mcp.importDesc') }}
                </div>
                <ul class="text-xs text-gray-500 dark:text-[#6b6d75] list-disc list-inside space-y-1">
                    <li>{{ t('plugins.mcp.importFormat1') }}<code class="bg-gray-100 dark:bg-[#2a2c30] px-1 rounded">{"mcpServers": {...}}</code>
                    </li>
                    <li>{{ t('plugins.mcp.importFormat2') }}<code class="bg-gray-100 dark:bg-[#2a2c30] px-1 rounded">{"name": "...", "baseUrl":
                    "..."}</code></li>
                </ul>
            </div>

            <el-input v-model="importJsonText" type="textarea" :rows="15" :placeholder="t('plugins.mcp.importPlaceholder')" />
{
  "mcpServers": {
    "WebSearch": {
      "type": "streamableHttp",
      "description": "描述信息",
      "isActive": true,
      "name": "阿里云百炼_联网搜索",
      "baseUrl": "https://dashscope.aliyuncs.com/api/v1/mcps/WebSearch/mcp",
      "headers": {
        "Authorization": "Bearer sk-xxx"
      }
    }
  }
}' />

            <template #footer>
                <span class="dialog-footer">
                    <el-button @click="showImportModal = false">{{ t('common.cancel') }}</el-button>
                    <el-button type="primary" @click="handleImportJson" :loading="importing">{{ t('plugins.mcp.importBtn') }}</el-button>
                </span>
            </template>
        </LDialog>
    </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElButton, ElForm, ElFormItem, ElInput, ElSelect, ElOption, ElTag, ElSwitch, ElMessage, ElTabs, ElTabPane } from 'element-plus'
import { RefreshRight } from '@element-plus/icons-vue'
import {
    AddOutlined,
    SettingsOutlined,
    RemoveCircleOutlineRound,
    InboxOutlined,
    UploadOutlined,
    InfoOutlined
} from '@vicons/material'
import { usePopup } from '../../composables/usePopup'
import { apiService } from '../../services/ApiService'
import CardAvatar from '@/components/ui/CardAvatar.vue'
import ScrollContainer from '../ui/ScrollContainer.vue'
import LDialog from '@/components/ui/LDialog.vue'

const { toast } = usePopup()
const { t } = useI18n()

// 响应式数据
const servers = ref([])
const showModal = ref(false)
const showImportModal = ref(false)
const isEditMode = ref(false)
const saving = ref(false)
const importing = ref(false)
const importJsonText = ref('')
const activeTab = ref('config')
const refreshingTools = ref(false)
const toolsList = ref([])

const formRef = ref(null)

const serverForm = ref({
    id: null,
    name: '',
    url: '',
    type: 'streamableHttp', // 协议类型：'stdio' | 'sse' | 'streamableHttp'
    description: '',
    headers: '',
    command: '',
    args: '',
    env: '',
    cwd: '',
    enabled: true
})

const formRules = computed(() => ({
    name: [
        { required: true, message: t('plugins.mcp.nameRequired'), trigger: 'blur' },
        { min: 2, max: 50, message: t('plugins.mcp.nameLength'), trigger: 'blur' }
    ],
    url: [
        { required: true, message: t('plugins.mcp.urlRequired'), trigger: 'blur' },
        {
            validator: (rule, value, callback) => {
                if (!value) {
                    callback()
                    return
                }
                const urlPattern = /^https?:\/\/.+/
                if (urlPattern.test(value)) {
                    callback()
                } else {
                    callback(new Error(t('plugins.mcp.urlInvalid')))
                }
            },
            trigger: 'blur'
        }
    ],
    command: [
        {
            validator: (rule, value, callback) => {
                if (serverForm.value.type === 'stdio' && !value) {
                    callback(new Error(t('plugins.mcp.commandRequired')))
                } else {
                    callback()
                }
            },
            trigger: 'blur'
        }
    ]
}))

// 加载 MCP 服务器列表
const loadServers = async () => {
    try {
        const response = await apiService.fetchMcpServers()
        // 后端返回的数据格式：{ items: [...], total: null, page: null, size: N }
        console.log('MCP 服务器响应:', response)

        if (response && Array.isArray(response.items)) {
            servers.value = response.items
        } else {
            servers.value = []
        }
    } catch (error) {
        console.error('加载 MCP 服务器失败:', error)
        toast.error(error.message || t('common.error.loadFailed'))
        servers.value = []
    }
}

// 添加服务器
const handleAddServer = () => {
    isEditMode.value = false
    activeTab.value = 'config' // 默认显示配置页
    toolsList.value = [] // 清空工具列表

    serverForm.value = {
        id: null,
        name: '',
        url: '',
        type: 'streamableHttp', // 默认使用 streamableHttp
        description: '',
        headers: '',
        command: '',
        args: '',
        env: '',
        cwd: '',
        enabled: true
    }
    showModal.value = true

    // 重置表单验证
    setTimeout(() => {
        formRef.value?.clearValidate()
    }, 100)
}

// 编辑服务器
const handleEditServer = (server) => {
    isEditMode.value = true
    activeTab.value = 'config' // 默认显示配置页

    // 将 headers 对象转换为多行文本
    const headersText = server.headers ? Object.entries(server.headers)
        .map(([key, value]) => `${key}: ${value}`)
        .join('\n') : ''

    // 将 args 数组转换为多行文本
    const argsText = server.args ? (Array.isArray(server.args) ? server.args : JSON.parse(server.args || '[]'))
        .join('\n') : ''

    // 将 env 对象转换为多行文本
    const envText = server.env ? Object.entries(server.env)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n') : ''

    serverForm.value = {
        ...server,
        type: server.type || 'streamableHttp', // 确保 type 字段存在
        headers: headersText,
        command: server.command || '',
        args: argsText,
        env: envText,
        cwd: server.cwd || ''
    }

    // 加载工具列表
    loadTools(server.id)

    showModal.value = true

    // 重置表单验证
    setTimeout(() => {
        formRef.value?.clearValidate()
    }, 100)
}

// 删除服务器
const handleDeleteServer = async (server) => {
    try {
        const confirmed = await confirm(t('plugins.mcp.deleteTitle'), t('plugins.mcp.deleteConfirm', { name: server.name }))

        // 如果用户取消，则不执行删除
        if (!confirmed) {
            return
        }

        // 调用实际 API
        await apiService.deleteMcpServer(server.id)

        // 从列表中移除
        servers.value = servers.value.filter(s => s.id !== server.id)
        toast.success(t('common.deleteSuccess'))
    } catch (error) {
        if (error !== 'cancelled') {
            console.error('删除失败:', error)
            toast.error(error.message || t('common.deleteFailed'))
        }
    }
}

// 保存服务器
const handleSaveServer = async () => {
    try {
        await formRef.value.validate()
        saving.value = true

        // 解析 HTTP 请求头文本为对象
        const headersObj = parseHeaders(serverForm.value.headers)

        // 解析 args 多行文本为数组
        const argsArray = serverForm.value.args
            ? serverForm.value.args.split('\n').map(a => a.trim()).filter(a => a)
            : []

        // 解析 env 多行文本为对象
        const envObj = parseEnvVariables(serverForm.value.env)

        // 准备提交的数据
        const submitData = {
            name: serverForm.value.name,
            url: serverForm.value.type !== 'stdio' ? (serverForm.value.url || null) : null,
            type: serverForm.value.type || 'streamableHttp', // 传递协议类型
            description: serverForm.value.description,
            headers: serverForm.value.type !== 'stdio' ? headersObj : null,
            command: serverForm.value.type === 'stdio' ? (serverForm.value.command || null) : null,
            args: serverForm.value.type === 'stdio' ? argsArray : null,
            env: serverForm.value.type === 'stdio' ? envObj : null,
            cwd: serverForm.value.type === 'stdio' ? (serverForm.value.cwd || null) : null,
            enabled: serverForm.value.enabled
        }

        if (isEditMode.value) {
            // 更新现有服务器
            const response = await apiService.updateMcpServer(serverForm.value.id, submitData)

            // 更新列表中的数据
            const index = servers.value.findIndex(s => s.id === serverForm.value.id)
            if (index !== -1) {
                servers.value[index] = response
            }
            toast.success(t('common.updateSuccess'))
        } else {
            // 添加新服务器
            const response = await apiService.createMcpServer(submitData)
            servers.value.unshift(response)
            toast.success(t('common.createSuccess'))
        }

        showModal.value = false
    } catch (error) {
        if (error !== 'cancelled') {
            console.error('保存失败:', error)
            toast.error(error.message || t('common.saveFailed'))
        }
    } finally {
        saving.value = false
    }
}

// 解析 HTTP 请求头文本为对象
const parseHeaders = (text) => {
    if (!text || typeof text !== 'string') {
        return {}
    }

    const headers = {}
    const lines = text.split('\n')

    for (const line of lines) {
        const trimmedLine = line.trim()
        if (!trimmedLine) continue

        const colonIndex = trimmedLine.indexOf(':')
        if (colonIndex === -1) continue

        const key = trimmedLine.substring(0, colonIndex).trim()
        const value = trimmedLine.substring(colonIndex + 1).trim()

        if (key && value) {
            headers[key] = value
        }
    }

    return headers
}

// 解析环境变量文本为对象
const parseEnvVariables = (text) => {
    if (!text || typeof text !== 'string') {
        return {}
    }

    const env = {}
    const lines = text.split('\n')

    for (const line of lines) {
        const trimmedLine = line.trim()
        if (!trimmedLine) continue

        const equalIndex = trimmedLine.indexOf('=')
        if (equalIndex === -1) continue

        const key = trimmedLine.substring(0, equalIndex).trim()
        const value = trimmedLine.substring(equalIndex + 1).trim()

        if (key && value !== undefined) {
            env[key] = value
        }
    }

    return env
}

// 导入 confirm 用于删除确认
const { confirm } = usePopup()

// 加载工具列表
const loadTools = async (serverId) => {
    if (!serverId) {
        toolsList.value = []
        return
    }

    try {
        const response = await apiService.fetchMcpServerById(serverId)
        if (response && response.tools) {
            // 将对象转换为数组
            toolsList.value = Object.entries(response.tools).map(([name, tool]) => ({
                name,
                ...tool
            }))
        } else {
            toolsList.value = []
        }
    } catch (error) {
        console.error('加载工具列表失败:', error)
        toolsList.value = []
    }
}

// 打开导入对话框
const handleImport = () => {
    importJsonText.value = ''
    showImportModal.value = true
}

// 处理 JSON 导入
const handleImportJson = async () => {
    try {
        importing.value = true

        // 解析 JSON
        const jsonData = JSON.parse(importJsonText.value)

        if (!jsonData || typeof jsonData !== 'object') {
            throw new Error(t('plugins.mcp.importInvalidJson'))
        }

        let serversToImport = []

        // 判断是标准格式还是单个服务器对象
        if (jsonData.mcpServers && typeof jsonData.mcpServers === 'object') {
            // 标准格式：{ "mcpServers": { "ServerName": {...}, ... } }
            serversToImport = Object.entries(jsonData.mcpServers).map(([key, server]) => ({
                key,
                ...server
            }))
        } else if (jsonData.name && jsonData.baseUrl) {
            // 单个服务器对象
            serversToImport = [jsonData]
        } else {
            throw new Error(t('plugins.mcp.importUnrecognized'))
        }

        if (serversToImport.length === 0) {
            toast.warning(t('plugins.mcp.importNoServers'))
            return
        }

        // 批量导入服务器
        let successCount = 0
        let failCount = 0
        const errors = []

        for (const serverData of serversToImport) {
            try {
                // 推断传输类型：标准 MCP 配置（Claude Desktop / Cursor 格式）中
                // stdio 服务器通常不写 type 字段，通过 command/args 的存在来推断
                const isStdio = serverData.type === 'stdio' || (!serverData.type && !!(serverData.command || serverData.args))

                // 转换数据格式
                const submitData = {
                    name: serverData.name || serverData.key || t('plugins.mcp.unnamedServer'),
                    url: isStdio ? null : (serverData.baseUrl || serverData.url || ''),
                    description: serverData.description || `导入自配置文件：${serverData.key || 'unknown'}`,
                    headers: isStdio ? null : (serverData.headers || {}),
                    enabled: serverData.isActive !== undefined ? serverData.isActive : true,
                    type: isStdio ? 'stdio' : (serverData.type || 'streamableHttp'),
                    command: isStdio ? (serverData.command || '') : null,
                    args: isStdio ? (serverData.args || []) : null,
                    env: isStdio ? (serverData.env || {}) : null,
                    cwd: isStdio ? (serverData.cwd || null) : null,
                }

                // 验证必填字段
                if (!submitData.name) {
                    throw new Error(`缺少必填字段：name`)
                }
                if (isStdio && !submitData.command) {
                    throw new Error(`缺少必填字段：command`)
                }
                if (!isStdio && !submitData.url) {
                    throw new Error(`缺少必填字段：url`)
                }

                // 调用 API 创建
                await apiService.createMcpServer(submitData)
                successCount++
            } catch (error) {
                failCount++
                errors.push(`"${serverData.name || serverData.key}": ${error.message}`)
            }
        }

        // 显示导入结果
        if (successCount > 0) {
            toast.success(t('plugins.mcp.importSuccess', { count: successCount }))
            // 重新加载列表
            await loadServers()
            showImportModal.value = false
        }

        if (failCount > 0) {
            toast.error(t('plugins.mcp.importFailedCount', { count: failCount }) + `\n${errors.join('\n')}`)
        }

    } catch (error) {
        console.error('导入失败:', error)
        if (error instanceof SyntaxError) {
            toast.error(t('plugins.mcp.importJsonError'))
        } else {
            toast.error(error.message || t('common.importFailed'))
        }
    } finally {
        importing.value = false
    }
}

// 刷新工具列表
const handleRefreshTools = async () => {
    if (!serverForm.value.id) {
        toast.warning(t('plugins.mcp.refreshToolsWarning'))
        return
    }

    try {
        refreshingTools.value = true

        // 调用刷新工具的 API
        const response = await apiService.refreshMcpTools(serverForm.value.id)

        if (response && response.tools) {
            // 更新工具列表
            toolsList.value = Object.entries(response.tools).map(([name, tool]) => ({
                name,
                ...tool
            }))

            toast.success(t('plugins.mcp.refreshToolsSuccess', { count: toolsList.value.length }))

            // 同时更新当前编辑的服务器数据
            const serverIndex = servers.value.findIndex(s => s.id === serverForm.value.id)
            if (serverIndex !== -1) {
                servers.value[serverIndex].tools = response.tools
            }
        } else {
            toast.warning(t('plugins.mcp.refreshToolsEmpty'))
        }
    } catch (error) {
        console.error('刷新工具失败:', error)
        toast.error(error.message || t('plugins.mcp.refreshToolsFailed'))
    } finally {
        refreshingTools.value = false
    }
}

// 切换服务器启用/禁用状态
const handleToggleServer = async (server) => {
    try {
        const response = await apiService.toggleMcpServer(server.id, server.enabled)

        // 更新列表中的状态
        const index = servers.value.findIndex(s => s.id === server.id)
        if (index !== -1) {
            servers.value[index].enabled = response.enabled
        }

        toast.success(server.enabled ? t('common.enabled') : t('common.disabled'))
    } catch (error) {
        console.error('切换状态失败:', error)
        toast.error(error.message || t('plugins.mcp.toggleFailed'))

        // 恢复原来的状态
        server.enabled = !server.enabled
    }
}

// 组件挂载时加载数据
onMounted(() => {
    loadServers()
})
</script>

<style scoped>
.dialog-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
}

.tools-panel {
    max-height: 500px;
    overflow-y: auto;
}

.tools-list {
    max-height: 450px;
    overflow-y: auto;
}

.tool-item {
    transition: all 0.2s;
}

.tool-item:hover {
    border-color: #409eff;
    background-color: #f0f9ff;
}

.line-clamp-2 {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}
</style>