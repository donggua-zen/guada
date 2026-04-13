<template>
    <div class="flex-1 overflow-hidden">
        <div class="sessions-header py-1 text-lg font-semibold flex justify-between items-center mb-6">
            <span>MCP 服务器列表</span>
            <el-space>
                <el-button @click="handleImport">
                    <template #icon>
                        <UploadOutlined />
                    </template>
                    导入配置
                </el-button>
                <el-button type="primary" @click="handleAddServer">
                    <template #icon>
                        <AddOutlined />
                    </template>
                    添加服务器
                </el-button>
            </el-space>
        </div>

        <!-- MCP 服务器列表 -->
        <div class="rounded border border-gray-200 dark:border-gray-700 overflow-hidden">
            <ul v-if="servers.length > 0">
                <li v-for="server in servers" :key="server.id"
                    class="flex items-center py-4 px-4 border-b border-gray-200 dark:border-gray-700 last:border-b-0 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                    <div class="flex-1">
                        <div class="flex items-center gap-2 mb-1">
                            <div class="font-semibold text-base">{{ server.name }}</div>
                            <el-tag v-if="server.enabled" type="success" size="small">已启用</el-tag>
                            <el-tag v-else type="info" size="small">已禁用</el-tag>
                        </div>
                        <div class="text-sm text-gray-500 dark:text-gray-400 truncate max-w-md">
                            {{ server.url }}
                        </div>
                        <div v-if="server.description" class="text-sm text-gray-400 dark:text-gray-500 mt-1">
                            {{ server.description }}
                        </div>
                    </div>
                    <div class="flex items-center gap-3">
                        <el-switch
                            v-model="server.enabled"
                            :active-value="true"
                            :inactive-value="false"
                            @change="handleToggleServer(server)"
                            active-text="启用"
                            inactive-text="禁用"
                            size="default"
                        />
                        <el-button link style="font-size: 20px" @click="handleEditServer(server)">
                            <el-icon><SettingsOutlined /></el-icon>
                        </el-button>
                        <el-button type="danger" link style="font-size: 20px" @click="handleDeleteServer(server)">
                            <el-icon><RemoveCircleOutlineRound /></el-icon>
                        </el-button>
                    </div>
                </li>
            </ul>
            <div v-else class="py-12 text-center text-gray-400">
                <el-icon size="48" class="mb-3 opacity-50">
                    <InboxOutlined />
                </el-icon>
                <div>暂无 MCP 服务器</div>
                <div class="text-sm mt-2">点击"添加服务器"开始配置</div>
            </div>
        </div>

        <!-- 添加/编辑服务器对话框 -->
        <el-dialog v-model="showModal" :title="isEditMode ? '编辑 MCP 服务器' : '添加 MCP 服务器'" width="40%"
            align-center destroy-on-close>
            <!-- Tab 切换 -->
            <el-tabs v-model="activeTab" class="mb-4">
                <el-tab-pane label="基本配置" name="config">
                    <el-form ref="formRef" :model="serverForm" :rules="formRules" label-position="left" label-width="100px"
                        size="large">
                        <el-form-item label="服务器名称" prop="name">
                            <el-input v-model="serverForm.name" placeholder="请输入服务器名称" />
                        </el-form-item>

                        <el-form-item label="服务地址" prop="url">
                            <el-input v-model="serverForm.url" placeholder="https://example.com/mcp" />
                        </el-form-item>

                        <el-form-item label="描述信息" prop="description">
                            <el-input v-model="serverForm.description" type="textarea" :rows="3"
                                placeholder="可选，描述此服务器的用途" />
                        </el-form-item>

                        <el-form-item label="HTTP 请求头" prop="headers">
                            <el-input 
                                v-model="serverForm.headers" 
                                type="textarea" 
                                :rows="5"
                                placeholder="请输入自定义 HTTP 请求头，一行一个，格式：Header-Name: value&#10;例如:&#10;Authorization: Bearer your_token&#10;X-API-Key: your_api_key" 
                            />
                            <div class="text-xs text-gray-400 mt-1">
                                每行一个请求头，格式为 "Header-Name: value"
                            </div>
                        </el-form-item>

                        <el-form-item label="启用状态">
                            <el-switch v-model="serverForm.enabled" active-text="启用" inactive-text="禁用" />
                        </el-form-item>
                    </el-form>
                </el-tab-pane>
                
                <el-tab-pane label="工具列表" name="tools">
                    <div v-if="!isEditMode" class="py-12 text-center">
                        <el-icon size="48" class="mb-3 opacity-50 text-gray-400">
                            <InfoOutlined />
                        </el-icon>
                        <div class="text-gray-500">新增后才能查看工具</div>
                        <div class="text-sm text-gray-400 mt-2">请先填写基本信息并保存</div>
                    </div>
                    
                    <div v-else class="tools-panel">
                        <div class="flex items-center justify-between mb-3">
                            <div class="text-sm text-gray-600 dark:text-gray-400">
                                已获取到 {{ toolsList.length }} 个工具
                            </div>
                            <el-button size="small" @click="handleRefreshTools" :loading="refreshingTools">
                                <el-icon class="mr-1" :class="{ 'is-loading': refreshingTools }">
                                    <RefreshRight />
                                </el-icon>
                                刷新工具
                            </el-button>
                        </div>
                        
                        <div v-if="toolsList.length > 0" class="tools-list">
                            <div v-for="(tool, index) in toolsList" :key="index" 
                                 class="tool-item p-3 mb-2 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                                <div class="font-semibold text-sm mb-2">{{ tool.name }}</div>
                                <div class="text-xs text-gray-500 dark:text-gray-400 mb-2 line-clamp-2">
                                    {{ tool.description || '暂无描述' }}
                                </div>
                                <div v-if="tool.inputSchema" class="text-xs">
                                    <div class="text-gray-400 mb-1">参数：</div>
                                    <div class="text-gray-600 dark:text-gray-300">
                                        <span v-if="!tool.inputSchema.properties || Object.keys(tool.inputSchema.properties).length === 0" 
                                              class="text-gray-400">
                                            无参数
                                        </span>
                                        <div v-else class="space-y-1">
                                            <div v-for="(paramInfo, paramName) in tool.inputSchema.properties" 
                                                 :key="paramName"
                                                 class="flex items-start gap-2">
                                                <span class="font-mono text-blue-600 dark:text-blue-400">{{ paramName }}</span>
                                                <span class="text-gray-400">:</span>
                                                <span class="text-gray-600 dark:text-gray-300 flex-1">
                                                    {{ paramInfo.description || paramInfo.type || '' }}
                                                </span>
                                                <el-tag v-if="tool.inputSchema.required && tool.inputSchema.required.includes(paramName)" 
                                                        type="danger" size="small">必填</el-tag>
                                                <el-tag v-else-if="paramInfo.default !== undefined" 
                                                        type="info" size="small">默认：{{ paramInfo.default }}</el-tag>
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
                            <div class="text-sm">暂无工具</div>
                            <div class="text-xs mt-1">点击"刷新工具"尝试重新获取</div>
                        </div>
                    </div>
                </el-tab-pane>
            </el-tabs>

            <template #footer>
                <span class="dialog-footer">
                    <el-button @click="showModal = false">取消</el-button>
                    <el-button type="primary" @click="handleSaveServer" :loading="saving">确定</el-button>
                </span>
            </template>
        </el-dialog>

        <!-- 导入配置对话框 -->
        <el-dialog v-model="showImportModal" title="导入 MCP 服务器配置" width="50%" align-center destroy-on-close>
            <div class="mb-4">
                <div class="text-sm text-gray-600 dark:text-gray-400 mb-2">
                    请粘贴 MCP 服务器配置 JSON 数据，支持以下格式：
                </div>
                <ul class="text-xs text-gray-500 dark:text-gray-500 list-disc list-inside space-y-1">
                    <li>标准格式：<code class="bg-gray-100 dark:bg-gray-800 px-1 rounded">{"mcpServers": {...}}</code></li>
                    <li>单个服务器对象格式：<code class="bg-gray-100 dark:bg-gray-800 px-1 rounded">{"name": "...", "baseUrl": "..."}</code></li>
                </ul>
            </div>
            
            <el-input
                v-model="importJsonText"
                type="textarea"
                :rows="15"
                placeholder='请粘贴 JSON 配置，例如：
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
}'
            />
            
            <template #footer>
                <span class="dialog-footer">
                    <el-button @click="showImportModal = false">取消</el-button>
                    <el-button type="primary" @click="handleImportJson" :loading="importing">导入</el-button>
                </span>
            </template>
        </el-dialog>
    </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElButton, ElDialog, ElForm, ElFormItem, ElInput, ElSelect, ElOption, ElTag, ElSwitch, ElMessage, ElTabs, ElTabPane, ElSpace } from 'element-plus'
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

const { toast } = usePopup()

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
    description: '',
    headers: '',
    enabled: true
})

const formRules = ref({
    name: [
        { required: true, message: '请输入服务器名称', trigger: 'blur' },
        { min: 2, max: 50, message: '长度在 2 到 50 个字符', trigger: 'blur' }
    ],
    url: [
        { required: true, message: '请输入服务地址', trigger: 'blur' },
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
                    callback(new Error('请输入有效的 URL 地址'))
                }
            },
            trigger: 'blur'
        }
    ]
})

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
        toast.error(error.message || '加载失败')
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
        description: '',
        headers: '',
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
    
    serverForm.value = {
        ...server,
        headers: headersText
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
        const confirmed = await confirm('删除服务器', `确定要删除服务器 "${server.name}" 吗？`)
        
        // 如果用户取消，则不执行删除
        if (!confirmed) {
            return
        }
        
        // 调用实际 API
        await apiService.deleteMcpServer(server.id)
        
        // 从列表中移除
        servers.value = servers.value.filter(s => s.id !== server.id)
        toast.success('删除成功')
    } catch (error) {
        if (error !== 'cancelled') {
            console.error('删除失败:', error)
            toast.error(error.message || '删除失败')
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
        
        // 准备提交的数据
        const submitData = {
            name: serverForm.value.name,
            url: serverForm.value.url,
            description: serverForm.value.description,
            headers: headersObj,
            enabled: serverForm.value.enabled
        }
        
        if (isEditMode.value) {
            // 更新现有服务器
            const response = await apiService.updateMcpServer(serverForm.value.id, submitData)
            
            // 更新列表中的数据
            const index = servers.value.findIndex(s => s.id === serverForm.value.id)
            if (index !== -1) {
                servers.value[index] = response || response.data
            }
            toast.success('更新成功')
        } else {
            // 添加新服务器
            const response = await apiService.createMcpServer(submitData)
            servers.value.unshift(response || response.data)
            toast.success('添加成功')
        }
        
        showModal.value = false
    } catch (error) {
        if (error !== 'cancelled') {
            console.error('保存失败:', error)
            toast.error(error.message || '保存失败')
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
            throw new Error('无效的 JSON 格式')
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
            throw new Error('无法识别的 JSON 格式，请确保包含 mcpServers 字段或有效的服务器对象')
        }
        
        if (serversToImport.length === 0) {
            toast.warning('未找到可导入的服务器配置')
            return
        }
        
        // 批量导入服务器
        let successCount = 0
        let failCount = 0
        const errors = []
        
        for (const serverData of serversToImport) {
            try {
                // 转换数据格式
                const submitData = {
                    name: serverData.name || serverData.key || '未命名服务器',
                    url: serverData.baseUrl || serverData.url || '',
                    description: serverData.description || `导入自配置文件：${serverData.key || 'unknown'}`,
                    headers: serverData.headers || {},
                    enabled: serverData.isActive !== undefined ? serverData.isActive : true
                }
                
                // 验证必填字段
                if (!submitData.name || !submitData.url) {
                    throw new Error(`缺少必填字段：name 或 url`)
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
            toast.success(`成功导入 ${successCount} 个服务器`)
            // 重新加载列表
            await loadServers()
            showImportModal.value = false
        }
        
        if (failCount > 0) {
            toast.error(`导入失败：${failCount} 个\n${errors.join('\n')}`)
        }
        
    } catch (error) {
        console.error('导入失败:', error)
        if (error instanceof SyntaxError) {
            toast.error('JSON 格式错误，请检查输入')
        } else {
            toast.error(error.message || '导入失败')
        }
    } finally {
        importing.value = false
    }
}

// 刷新工具列表
const handleRefreshTools = async () => {
    if (!serverForm.value.id) {
        toast.warning('请先保存服务器')
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
            
            toast.success(`成功刷新 ${toolsList.value.length} 个工具`)
            
            // 同时更新当前编辑的服务器数据
            const serverIndex = servers.value.findIndex(s => s.id === serverForm.value.id)
            if (serverIndex !== -1) {
                servers.value[serverIndex].tools = response.tools
            }
        } else {
            toast.warning('未获取到工具列表')
        }
    } catch (error) {
        console.error('刷新工具失败:', error)
        toast.error(error.message || '刷新工具失败')
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
            const responseData = response || response.data
            servers.value[index].enabled = responseData.enabled
        }
        
        toast.success(server.enabled ? '已启用' : '已禁用')
    } catch (error) {
        console.error('切换状态失败:', error)
        toast.error(error.message || '切换失败')
        
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
    -webkit-box-orient: vertical;
    overflow: hidden;
}

/* 滚动条美化 */
.tools-panel::-webkit-scrollbar,
.tools-list::-webkit-scrollbar {
    width: 6px;
}

.tools-panel::-webkit-scrollbar-thumb,
.tools-list::-webkit-scrollbar-thumb {
    background: #c1c1c1;
    border-radius: 3px;
}

.dark .tools-panel::-webkit-scrollbar-thumb,
.dark .tools-list::-webkit-scrollbar-thumb {
    background: #4a4a4a;
}
</style>