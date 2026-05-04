<template>
    <div class="flex-1 overflow-hidden">
        <!-- 头部区域 -->
        <div class="sessions-header py-1 text-lg font-semibold flex justify-between items-center mb-6">
            <span>Skills</span>
            <el-space>
                <el-tooltip :content="autoScanEnabled ? '已启用自动扫描' : '已禁用自动扫描'" placement="top">
                    <el-switch
                        v-model="autoScanEnabled"
                        @change="handleToggleAutoScan"
                        inline-prompt
                        active-text="自动"
                        inactive-text="手动"
                        size="default"
                    />
                </el-tooltip>
                <el-button @click="handleShowInstallDialog">
                    <template #icon>
                        <UploadOutlined />
                    </template>
                    安装
                </el-button>
                <el-button 
                    v-if="loading" 
                    :loading="true" 
                    size="small"
                >
                    加载中...
                </el-button>
                <el-button @click="handleScan" :loading="scanning">
                    <template #icon>
                        <RefreshOutlined />
                    </template>
                    刷新
                </el-button>
            </el-space>
        </div>

        <!-- Skills 列表 -->
        <div class="space-y-4">
            <div class="text-sm text-gray-600 dark:text-[#8b8d95] mb-4">
                Skills 是系统自动发现的本地技能模块。启用“自动”开关后，系统会监控目录变更并自动扫描；也可点击“刷新”按钮手动扫描。
            </div>

            <!-- 网格布局：每行3列 -->
            <div class="grid grid-cols-3 gap-4">
                <div
                    v-for="skill in skills"
                    :key="skill.id"
                    class="rounded-lg border border-gray-200 dark:border-[#232428] overflow-hidden bg-white dark:bg-[#232428] transition-all hover:shadow-md"
                >
                    <div class="p-4">
                        <div class="flex items-start justify-between gap-2 mb-2">
                            <h3 class="text-base font-semibold text-gray-900 dark:text-[#e8e9ed] flex-1 truncate">
                                {{ skill.manifest.name || skill.id }}
                            </h3>
                            <el-tag v-if="skill.manifest.version" type="info" size="small" effect="plain">
                                v{{ skill.manifest.version }}
                            </el-tag>
                        </div>
                        
                        <p class="text-xs text-gray-600 dark:text-[#8b8d95] mb-3 line-clamp-3 min-h-12">
                            {{ skill.manifest.description || '暂无描述' }}
                        </p>
                        
                        <div class="flex items-center justify-end">
                            <div class="flex gap-2">
                                <el-button 
                                    link 
                                    size="small" 
                                    @click="handleViewDocumentation(skill.id)"
                                >
                                    <template #icon>
                                        <DescriptionOutlined />
                                    </template>
                                    SKILL.md
                                </el-button>
                                <el-button 
                                    link 
                                    size="small" 
                                    @click="handleReloadSkill(skill.id)"
                                    :loading="reloadingSkills.has(skill.id)"
                                >
                                    <template #icon>
                                        <RefreshRight />
                                    </template>
                                    重载
                                </el-button>
                                <el-button 
                                    link 
                                    size="small" 
                                    type="danger"
                                    @click="handleUninstallSkill(skill.id)"
                                    :loading="uninstallingSkills.has(skill.id)"
                                >
                                    <template #icon>
                                        <DeleteOutlined />
                                    </template>
                                    卸载
                                </el-button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 空状态 -->
            <div v-if="!loading && skills.length === 0" class="rounded-lg border border-gray-200 dark:border-[#232428] overflow-hidden bg-white dark:bg-[#232428]">
                <div class="p-12 text-center">
                    <el-icon size="64" class="mb-4 opacity-50 text-gray-400">
                        <InboxOutlined />
                    </el-icon>
                    <div class="text-xl font-medium text-gray-600 dark:text-[#e8e9ed] mb-2">
                        暂无 Skills
                    </div>
                    <div class="text-sm text-gray-500 dark:text-[#8b8d95] mb-4">
                        点击“刷新”按钮扫描本地 Skills 目录
                    </div>
                    <el-button type="primary" @click="handleScan" :loading="scanning">
                        <template #icon>
                            <RefreshOutlined />
                        </template>
                        立即扫描
                    </el-button>
                </div>
            </div>
        </div>

        <!-- 查看文档对话框 -->
        <el-dialog 
            v-model="showDocDialog" 
            :title="currentSkillName + ' - SKILL.md'" 
            width="600px"
            :style="{ maxWidth: '90vw' }"
            align-center
            destroy-on-close
        >
            <ScrollContainer class="h-[60vh]">
                <div v-if="loadingDoc" class="flex justify-center items-center py-12">
                    <el-icon class="is-loading" size="32">
                        <Loading />
                    </el-icon>
                </div>
                <div v-else-if="docError" class="py-12 text-center text-red-500">
                    {{ docError }}
                </div>
                <div v-else class="prose dark:prose-invert max-w-none">
                    <pre class="whitespace-pre-wrap font-mono text-sm bg-gray-50 dark:bg-[#2a2c30] p-4 rounded-lg overflow-x-auto">{{ documentation }}</pre>
                </div>
            </ScrollContainer>
            <template #footer>
                <el-button @click="showDocDialog = false">关闭</el-button>
            </template>
        </el-dialog>

        <!-- 安装 Skill 对话框 -->
        <el-dialog 
            v-model="showInstallDialog" 
            title="安装 Skill" 
            width="500px" 
            align-center
            destroy-on-close
        >
            <div class="py-4">
                <div class="text-sm text-gray-600 dark:text-[#8b8d95] mb-4">
                    请上传 ZIP 格式的 Skill 包。ZIP 文件应包含一个 Skill 目录，其中必须有 SKILL.md 文件。
                </div>
                
                <el-upload
                    ref="uploadRef"
                    class="upload-demo"
                    drag
                    :auto-upload="false"
                    :on-change="handleFileChange"
                    :limit="1"
                    accept=".zip"
                >
                    <el-icon class="el-icon--upload"><upload-filled /></el-icon>
                    <div class="el-upload__text">
                        拖拽文件到此处或 <em>点击上传</em>
                    </div>
                    <template #tip>
                        <div class="el-upload__tip text-xs text-gray-500 mt-2">
                            仅支持 .zip 格式文件
                        </div>
                    </template>
                </el-upload>

                <div v-if="selectedFile" class="mt-4 p-3 bg-gray-50 dark:bg-[#2a2c30] rounded-lg">
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-2">
                            <el-icon><Document /></el-icon>
                            <span class="text-sm">{{ selectedFile.name }}</span>
                        </div>
                        <el-button link type="danger" @click="clearSelectedFile">
                            <el-icon><Close /></el-icon>
                        </el-button>
                    </div>
                    <div class="text-xs text-gray-500 mt-1">
                        大小: {{ formatFileSize(selectedFile.size) }}
                    </div>
                </div>
            </div>

            <template #footer>
                <el-button @click="showInstallDialog = false">取消</el-button>
                <el-button 
                    type="primary" 
                    @click="handleInstallSkill"
                    :loading="installing"
                    :disabled="!selectedFile"
                >
                    安装
                </el-button>
            </template>
        </el-dialog>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElSpace, ElButton, ElTag, ElIcon, ElDialog, ElUpload, ElMessageBox } from 'element-plus'
import { RefreshOutlined, InboxOutlined, DescriptionOutlined, UploadOutlined, DeleteOutlined } from '@vicons/material'
import { RefreshRight, Loading, UploadFilled, Document, Close } from '@element-plus/icons-vue'
import { apiService } from '@/services/ApiService'
import ScrollContainer from '../ui/ScrollContainer.vue'

interface SkillManifest {
    name: string
    description?: string
    version?: string
    author?: string
    tags?: string[]
}

interface Skill {
    id: string
    basePath: string
    manifest: SkillManifest
    contentHash: string
}

const loading = ref(false)
const scanning = ref(false)
const reloadingSkills = ref<Set<string>>(new Set())
const skills = ref<Skill[]>([])

// 文档查看相关状态
const showDocDialog = ref(false)
const loadingDoc = ref(false)
const docError = ref<string | null>(null)
const documentation = ref('')
const currentSkillName = ref('')

// 自动扫描状态
const autoScanEnabled = ref(true)

// 安装相关状态
const showInstallDialog = ref(false)
const installing = ref(false)
const selectedFile = ref<File | null>(null)
const uploadRef = ref()

// 卸载相关状态
const uninstallingSkills = ref<Set<string>>(new Set())

/**
 * 加载 Skills 列表
 */
async function loadSkills() {
    loading.value = true
    
    try {
        const response = await apiService.fetchSkills()
        skills.value = Array.isArray(response?.items) ? response.items : []
    } catch (err: any) {
        console.error('加载 Skills 失败:', err)
        const errorMsg = err.message || '加载 Skills 失败'
        ElMessage.error(errorMsg)
        skills.value = []
    } finally {
        loading.value = false
    }
}

/**
 * 触发手动扫描
 */
async function handleScan() {
    scanning.value = true
    
    try {
        await apiService.scanSkills()
        ElMessage.success('扫描完成')
        // 扫描后重新加载列表
        await loadSkills()
    } catch (err: any) {
        console.error('扫描 Skills 失败:', err)
        const errorMsg = err.message || '扫描失败'
        ElMessage.error(errorMsg)
    } finally {
        scanning.value = false
    }
}

/**
 * 重载指定 Skill
 */
async function handleReloadSkill(skillId: string) {
    const previousState = reloadingSkills.value.has(skillId)
    
    try {
        reloadingSkills.value.add(skillId)
        await apiService.reloadSkill(skillId)
        ElMessage.success('重载成功')
        // 重载后重新加载列表
        await loadSkills()
    } catch (err: any) {
        console.error('重载 Skill 失败:', err)
        const errorMsg = err.message || '重载失败'
        ElMessage.error(errorMsg)
    } finally {
        reloadingSkills.value.delete(skillId)
    }
}

/**
 * 查看 Skill 文档
 */
async function handleViewDocumentation(skillId: string) {
    showDocDialog.value = true
    loadingDoc.value = true
    docError.value = null
    documentation.value = ''
    
    // 获取 skill 名称用于标题
    const skill = skills.value.find(s => s.id === skillId)
    currentSkillName.value = skill?.manifest.name || skillId
    
    try {
        const response = await apiService.fetchSkillDocumentation(skillId)
        documentation.value = response.content || '暂无文档内容'
    } catch (err: any) {
        console.error('获取 Skill 文档失败:', err)
        const errorMsg: string = err.message || '获取文档失败'
        docError.value = errorMsg
        ElMessage.error(errorMsg)
    } finally {
        loadingDoc.value = false
    }
}

/**
 * 加载自动扫描状态
 */
async function loadAutoScanStatus() {
    try {
        const response = await apiService.getAutoScanStatus()
        autoScanEnabled.value = response.enabled
    } catch (err: any) {
        console.error('获取自动扫描状态失败:', err)
        // 失败时默认启用
        autoScanEnabled.value = true
    }
}

/**
 * 切换自动扫描开关
 */
async function handleToggleAutoScan(enabled: boolean) {
    try {
        await apiService.toggleAutoScan(enabled)
        ElMessage.success(enabled ? '已启用自动扫描' : '已禁用自动扫描')
    } catch (err: any) {
        console.error('切换自动扫描失败:', err)
        ElMessage.error(err.message || '切换失败')
        // 恢复原状态
        autoScanEnabled.value = !enabled
    }
}

/**
 * 显示安装对话框
 */
function handleShowInstallDialog() {
    showInstallDialog.value = true
    selectedFile.value = null
}

/**
 * 处理文件选择
 */
function handleFileChange(file: any) {
    selectedFile.value = file.raw
}

/**
 * 清除选中的文件
 */
function clearSelectedFile() {
    selectedFile.value = null
    if (uploadRef.value) {
        uploadRef.value.clearFiles()
    }
}

/**
 * 格式化文件大小
 */
function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i]
}

/**
 * 安装 Skill
 */
async function handleInstallSkill() {
    if (!selectedFile.value) {
        ElMessage.warning('请选择要安装的 ZIP 文件')
        return
    }

    installing.value = true
    
    try {
        const response = await apiService.installSkill(selectedFile.value)
        
        if (response.success) {
            ElMessage.success(response.message || '安装成功')
            showInstallDialog.value = false
            selectedFile.value = null
            // 重新加载列表
            await loadSkills()
        } else {
            ElMessage.error(response.message || '安装失败')
        }
    } catch (err: any) {
        console.error('安装 Skill 失败:', err)
        ElMessage.error(err.message || '安装失败')
    } finally {
        installing.value = false
    }
}

/**
 * 卸载 Skill
 */
async function handleUninstallSkill(skillId: string) {
    try {
        // 确认卸载
        await new Promise<void>((resolve, reject) => {
            ElMessageBox.confirm(
                `确定要卸载 Skill "${skillId}" 吗？此操作将删除该 Skill 的所有文件。`,
                '确认卸载',
                {
                    confirmButtonText: '确定',
                    cancelButtonText: '取消',
                    type: 'warning',
                }
            ).then(() => resolve()).catch(() => reject())
        })
        
        uninstallingSkills.value.add(skillId)
        
        const response = await apiService.uninstallSkill(skillId)
        
        if (response.success) {
            ElMessage.success(response.message || '卸载成功')
            // 重新加载列表
            await loadSkills()
        } else {
            ElMessage.error(response.message || '卸载失败')
        }
    } catch (err: any) {
        if (err !== 'cancel' && err !== 'close') {
            console.error('卸载 Skill 失败:', err)
            ElMessage.error(err.message || '卸载失败')
        }
    } finally {
        uninstallingSkills.value.delete(skillId)
    }
}

onMounted(() => {
    loadSkills()
    loadAutoScanStatus()
})
</script>
