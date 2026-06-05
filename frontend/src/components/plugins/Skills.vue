<template>
    <div class="flex-1">
        <!-- 头部区域 -->
        <div class="sessions-header py-1 text-lg font-semibold flex justify-between items-center mb-6">
            <span>Skills</span>
            <el-space>
                <el-button @click="handleShowInstallDialog">
                    <template #icon>
                        <UploadOutlined />
                    </template>
                    安装
                </el-button>
                <el-button v-if="loading" :loading="true" size="small">
                    加载中...
                </el-button>
                <el-button @click="handleScan" :loading="scanning">
                    <template #icon>
                        <RefreshOutlined />
                    </template>
                    扫描
                </el-button>
                <el-button @click="handleOpenSkillsDocs">
                    <template #icon>
                        <Document />
                    </template>
                    使用说明
                </el-button>
            </el-space>
        </div>

        <!-- Skills 列表 -->
        <div class="space-y-4">
            <div class="text-sm text-gray-600 dark:text-[#8b8d95] mb-4">
                Skills 是系统自动发现的本地技能模块。手动添加或者修改技能后点击“刷新”按钮手动扫描目录变更。
            </div>

            <!-- 技能卡片列表 -->
            <div class="grid gap-4" style="grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));">
                <div v-for="skill in skills" :key="skill.id"
                    class="rounded-lg border border-gray-200 dark:border-[#232428] overflow-hidden bg-white dark:bg-[#232428] transition-all hover:border-(--color-primary)">
                    <div class="p-5 pb-4">
                        <div class="flex items-start justify-between gap-2 mb-2">
                            <h3 class="text-lg font-semibold text-gray-900 dark:text-[#e8e9ed] flex-1 truncate">
                                {{ skill.manifest.name || skill.id }}
                            </h3>
                            <el-tag v-if="skill.manifest.version" type="info" size="small" effect="plain"
                                style="margin-top: 2px;">
                                v{{ skill.manifest.version }}
                            </el-tag>
                        </div>

                        <p class="text-sm text-gray-600 dark:text-[#8b8d95] mb-3 line-clamp-3 min-h-[3.75rem]">
                            {{ skill.manifest.description || '暂无描述' }}
                        </p>

                        <div class="flex items-center justify-end">
                            <div class="flex gap-2">
                                <el-button link size="small" @click="handleViewDocumentation(skill.id)">
                                    <template #icon>
                                        <DescriptionOutlined />
                                    </template>
                                    SKILL.md
                                </el-button>
                                <el-button link size="small" @click="handleReloadSkill(skill.id)"
                                    :loading="reloadingSkills.has(skill.id)">
                                    <template #icon>
                                        <RefreshRight />
                                    </template>
                                    重载
                                </el-button>
                                <el-button link size="small" type="danger" @click="handleUninstallSkill(skill.id)"
                                    :loading="uninstallingSkills.has(skill.id)">
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
            <div v-if="!loading && skills.length === 0"
                class="rounded-lg border border-gray-200 dark:border-[#232428] overflow-hidden bg-white dark:bg-[#232428]">
                <div class="p-12 text-center">
                    <el-icon size="64" class="mb-4 opacity-50 text-gray-400">
                        <InboxOutlined />
                    </el-icon>
                    <div class="text-xl font-medium text-gray-600 dark:text-[#e8e9ed] mb-2">
                        暂无 Skills
                    </div>
                    <div class="text-sm text-gray-500 dark:text-[#8b8d95] mb-4">
                        点击"刷新"按钮扫描本地 Skills 目录
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

        <!-- 技能市场推荐 -->
        <div class="mt-8">
            <div class="sessions-header py-1 text-lg font-semibold flex items-center gap-3 mb-4">
                <span>技能推荐</span>
                <el-button link size="small" :loading="loadingMarket" @click="() => loadMarketSkills(true)">
                    <template #icon>
                        <el-icon :class="{ 'is-loading': loadingMarket }">
                            <ArrowClockwise16Regular />
                        </el-icon>
                    </template>
                    {{ loadingMarket ? '加载中...' : '换一批' }}
                </el-button>
            </div>

            <!-- 错误提示 -->
            <div v-if="marketError"
                class="rounded-lg border border-gray-200 dark:border-[#232428] bg-white dark:bg-[#232428] p-6 text-center">
                <el-icon size="32" class="mb-2 opacity-50 text-gray-400">
                    <InboxOutlined />
                </el-icon>
                <div class="text-sm text-gray-500 dark:text-[#8b8d95]">
                    {{ marketError }}
                </div>
            </div>

            <!-- 推荐列表 -->
            <div v-else-if="marketSkills.length > 0" class="grid gap-4"
                style="grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));">
                <div v-for="skill in marketSkills" :key="skill.id"
                    class="rounded-lg border border-gray-200 dark:border-[#232428] overflow-hidden bg-white dark:bg-[#232428] transition-all hover:border-(--color-primary)">
                    <div class="p-5 pb-4">
                        <div class="flex items-start justify-between gap-2 mb-2">
                            <h3 class="text-lg font-semibold text-gray-900 dark:text-[#e8e9ed] flex-1 truncate">
                                {{ skill.name }}
                            </h3>
                        </div>

                        <p class="text-sm text-gray-600 dark:text-[#8b8d95] mb-3 line-clamp-3 min-h-[3.75rem]">
                            {{ skill.description || '暂无描述' }}
                        </p>

                        <div class="flex items-center justify-between">
                            <div class="flex flex-wrap gap-1.5">
                                <el-tag v-if="skill.labels && skill.labels.length > 0" v-for="label in skill.labels"
                                    :key="label" size="small" effect="light">
                                    {{ label }}
                                </el-tag>
                            </div>
                            <el-button v-if="skill.detailUrl" size="small" @click="handleOpenDetailUrl(skill)">
                                获取
                            </el-button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 底部提示 -->
            <div class="mt-6 text-center text-sm text-gray-500 dark:text-[#8b8d95]">
                访问<span class="text-blue-500 cursor-pointer hover:underline" @click="openExternalLink('https://ai.dingd.cn/skills')">技能市场</span>获取更多推荐技能
            </div>
        </div>

        <!-- 查看文档对话框 -->
        <el-dialog v-model="showDocDialog" :title="currentSkillName + ' - SKILL.md'" width="800px"
            :style="{ maxWidth: '90vw' }" align-center destroy-on-close>

            <div v-if="loadingDoc" class="flex justify-center items-center py-12">
                <el-icon class="is-loading" size="32">
                    <Loading />
                </el-icon>
            </div>
            <div v-else-if="docError" class="py-12 text-center text-red-500">
                {{ docError }}
            </div>
            <div v-else>
                <!-- 元信息表格 -->
                <div v-if="parsedMeta.length > 0" class="skill-meta-table mb-6">
                    <table>
                        <tbody>
                            <tr v-for="item in parsedMeta" :key="item.key">
                                <td class="meta-key">{{ item.key }}</td>
                                <td class="meta-value">{{ item.value }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <!-- 正文内容 -->
                <div class="markdown-doc prose dark:prose-invert max-w-none" v-html="parsedDocumentation">
                </div>
            </div>
            <template #footer>
                <el-button @click="showDocDialog = false">关闭</el-button>
            </template>
        </el-dialog>

        <!-- 安装 Skill 对话框 -->
        <el-dialog v-model="showInstallDialog" title="安装 Skill" width="500px" align-center destroy-on-close>
            <div class="py-4">
                <div class="text-sm text-gray-600 dark:text-[#8b8d95] mb-4">
                    请上传 ZIP 格式的 Skill 包。ZIP 文件应包含一个 Skill 目录，其中必须有 SKILL.md 文件。
                </div>

                <el-upload ref="uploadRef" class="upload-demo" drag :auto-upload="false" :on-change="handleFileChange"
                    :limit="1" accept=".zip">
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
                            <el-icon>
                                <Document />
                            </el-icon>
                            <span class="text-sm">{{ selectedFile.name }}</span>
                        </div>
                        <el-button link type="danger" @click="clearSelectedFile">
                            <el-icon>
                                <Close />
                            </el-icon>
                        </el-button>
                    </div>
                    <div class="text-xs text-gray-500 mt-1">
                        大小: {{ formatFileSize(selectedFile.size) }}
                    </div>
                </div>

                <div class="mt-4">
                    <el-checkbox v-model="forceOverwrite">
                        <span class="text-sm">强制覆盖（如果技能已存在则替换）</span>
                    </el-checkbox>
                    <div class="text-xs text-gray-500 dark:text-[#8b8d95] mt-1 ml-6">
                        注意：此操作会删除旧版本的技能文件
                    </div>
                </div>
            </div>

            <template #footer>
                <el-button @click="showInstallDialog = false">取消</el-button>
                <el-button type="primary" @click="handleInstallSkill" :loading="installing" :disabled="!selectedFile">
                    安装
                </el-button>
            </template>
        </el-dialog>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { ElMessage, ElSpace, ElButton, ElTag, ElIcon, ElDialog, ElUpload, ElMessageBox } from 'element-plus'
import { RefreshOutlined, InboxOutlined, DescriptionOutlined, UploadOutlined, DeleteOutlined } from '@vicons/material'
import { RefreshRight, Loading, UploadFilled, Document, Close } from '@element-plus/icons-vue'
import { ArrowDownload16Regular, ArrowClockwise16Regular } from '@vicons/fluent'
import { apiService } from '@/services/ApiService'
import { SkillMarketService, type MarketSkill, type MarketSkillWithStatus } from '@/services/SkillMarketService'
import { useMarkdown } from '@/composables/useMarkdown'
import { openExternalLink } from '@/utils/modelUtils'

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

// Markdown 解析
const { parseMarkdown } = useMarkdown()

// 解析 YAML frontmatter
interface SkillMeta {
    key: string
    value: string
}

const parsedMeta = computed((): SkillMeta[] => {
    const content = documentation.value
    if (!content) return []

    const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/)
    if (!match) return []

    const yamlContent = match[1]
    const lines = yamlContent.split('\n')
    const result: SkillMeta[] = []

    let i = 0
    while (i < lines.length) {
        const line = lines[i]
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) {
            i++
            continue
        }

        const colonIndex = trimmed.indexOf(':')
        if (colonIndex === -1) {
            i++
            continue
        }

        const key = trimmed.substring(0, colonIndex).trim()
        let value = trimmed.substring(colonIndex + 1).trim()

        // 处理多行字符串：> 或 | 折叠符
        if (value === '>' || value === '|' || value === '>-' || value === '|-') {
            const multilineValues: string[] = []
            i++
            // 收集缩进行
            while (i < lines.length) {
                const nextLine = lines[i]
                if (nextLine.match(/^\s+/)) {
                    multilineValues.push(nextLine.trim())
                    i++
                } else if (nextLine.trim() === '') {
                    // 空行：多行字符串中的空行保留一个标记
                    multilineValues.push('')
                    i++
                } else {
                    break
                }
            }
            if (multilineValues.length > 0) {
                // 过滤尾部空行
                while (multilineValues.length > 0 && multilineValues[multilineValues.length - 1] === '') {
                    multilineValues.pop()
                }
                result.push({ key, value: multilineValues.join(' ') })
            }
            continue
        }

        // 处理数组格式：tags 等
        if (value === '' && trimmed.endsWith(':')) {
            const arrayItems: string[] = []
            i++
            while (i < lines.length) {
                const nextLine = lines[i]
                if (nextLine.match(/^\s+-\s+/)) {
                    const item = nextLine.replace(/^\s+-\s*/, '').trim()
                    if (item) arrayItems.push(item)
                    i++
                } else if (nextLine.trim() && !nextLine.match(/^\s+/)) {
                    break
                } else {
                    i++
                }
            }
            if (arrayItems.length > 0) {
                result.push({ key, value: arrayItems.join(', ') })
            }
            continue
        }

        // 去除引号
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1)
        }

        if (key && value) {
            result.push({ key, value })
        }
        i++
    }

    return result
})

// 提取正文（去掉 frontmatter）
const bodyContent = computed(() => {
    const content = documentation.value
    if (!content) return ''

    const match = content.match(/^---\s*\n[\s\S]*?\n---\s*\n([\s\S]*)$/)
    return match ? match[1].trim() : content.trim()
})

const parsedDocumentation = computed(() => {
    return parseMarkdown(bodyContent.value)
})

// 安装相关状态
const showInstallDialog = ref(false)
const installing = ref(false)
const selectedFile = ref<File | null>(null)
const uploadRef = ref()
const forceOverwrite = ref(false)

// 卸载相关状态
const uninstallingSkills = ref<Set<string>>(new Set())

// 市场推荐相关状态
const marketSkills = ref<MarketSkillWithStatus[]>([])
const loadingMarket = ref(false)
const marketError = ref<string | null>(null)

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
 * 显示安装对话框
 */
function handleShowInstallDialog() {
    showInstallDialog.value = true
    selectedFile.value = null
    forceOverwrite.value = false
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
    forceOverwrite.value = false
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
        const response = await apiService.installSkill(selectedFile.value, forceOverwrite.value)

        if (response.success) {
            ElMessage.success(response.message || '安装成功')
            showInstallDialog.value = false
            selectedFile.value = null
            forceOverwrite.value = false
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

/**
 * 打开 Skills 使用说明文档
 */
function handleOpenSkillsDocs() {
    openExternalLink('https://ai.dingd.cn/docs/skills')
}

/**
 * 加载市场推荐技能列表
 * @param forceRefresh 是否强制刷新（来自用户手动点击"换一批"）
 */
async function loadMarketSkills(forceRefresh: boolean = false) {
    if (loadingMarket.value) return

    loadingMarket.value = true
    marketError.value = null

    const startTime = Date.now()

    try {
        const remoteSkills = await SkillMarketService.fetchMarketSkills(!forceRefresh)

        // 仅手动刷新时确保至少显示 500ms 的加载动画
        if (forceRefresh) {
            const elapsed = Date.now() - startTime
            if (elapsed < 500) {
                await new Promise(resolve => setTimeout(resolve, 500 - elapsed))
            }
        }

        marketSkills.value = remoteSkills.map(skill => ({
            ...skill,
            localStatus: 'not_installed' as const,
        }))
    } catch (err: any) {
        console.error('加载市场技能失败:', err)
        marketError.value = err.message || '加载推荐技能失败'
    } finally {
        loadingMarket.value = false
    }
}

/**
 * 打开技能详情页
 */
function handleOpenDetailUrl(marketSkill: MarketSkillWithStatus) {
    if (!marketSkill.detailUrl) {
        ElMessage.warning('该技能暂无详情链接')
        return
    }
    openExternalLink(marketSkill.detailUrl)
}

onMounted(async () => {
    await loadSkills()
    await loadMarketSkills()
})
</script>

<style scoped>
@import "@/assets/markdown.css";


/* 代码块容器 */
.markdown-doc :deep(.custom-code-block) {
    margin-bottom: 1em;
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid #e3e3e7;
}

.dark .markdown-doc :deep(.custom-code-block) {
    border-color: #333;
}

/* 代码块头部 */
.markdown-doc :deep(.code-header) {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 7px 12px;
    background: #f3f3f5;
    color: #222;
    font-size: 0.8em;
    border-bottom: 1px solid #e3e3e7;
}

.dark .markdown-doc :deep(.code-header) {
    background: #2a2c30;
    color: #e8e9ed;
    border-color: #333;
}

.markdown-doc :deep(.code-language) {
    font-weight: 600;
    text-transform: uppercase;
    color: #666;
}

.dark .markdown-doc :deep(.code-language) {
    color: #8b8d95;
}

/* 代码块内容 */
.markdown-doc :deep(pre.hljs) {
    margin: 0;
    border-radius: 0;
    background: #fafafb !important;
    padding: 16px;
    overflow-x: auto;
}

.dark .markdown-doc :deep(pre.hljs) {
    background: #1a1c20 !important;
}

.markdown-doc :deep(code.hljs) {
    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
    font-size: 0.875em;
    background: transparent !important;
    display: block;
    overflow-x: auto;
}

/* 行内代码 */
.markdown-doc :deep(:not(pre) > code) {
    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
    font-size: 0.875em;
    background-color: #f0f0f0;
    padding: 2px 6px;
    border-radius: 4px;
    color: #e83e8c;
}

.dark .markdown-doc :deep(:not(pre) > code) {
    background-color: #2a2c30;
    color: #ff7b72;
}

.markdown-doc :deep(p) {
    margin-bottom: 1em;
    line-height: 1.6;
}

.markdown-doc :deep(h1),
.markdown-doc :deep(h2),
.markdown-doc :deep(h3),
.markdown-doc :deep(h4) {
    margin-top: 1.5em;
    margin-bottom: 0.75em;
    font-weight: 600;
}

.markdown-doc :deep(ul),
.markdown-doc :deep(ol) {
    margin-bottom: 1em;
    padding-left: 1.5em;
}

.markdown-doc :deep(li) {
    margin-bottom: 0.25em;
}

.markdown-doc :deep(blockquote) {
    border-left: 4px solid #ddd;
    padding-left: 1em;
    color: #666;
    margin-bottom: 1em;
}

.dark .markdown-doc :deep(blockquote) {
    border-left-color: #444;
    color: #999;
}

.markdown-doc :deep(table) {
    border-collapse: collapse;
    width: 100%;
    margin-bottom: 1em;
}

.markdown-doc :deep(th),
.markdown-doc :deep(td) {
    border: 1px solid #ddd;
    padding: 8px 12px;
    text-align: left;
}

.dark .markdown-doc :deep(th),
.dark .markdown-doc :deep(td) {
    border-color: #444;
}

.markdown-doc :deep(th) {
    background-color: #f6f8fa;
    font-weight: 600;
}

.dark .markdown-doc :deep(th) {
    background-color: #2a2c30;
}

/* 元信息表格样式 */
.skill-meta-table {
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid #e3e3e7;
}

.dark .skill-meta-table {
    border-color: #333;
}

.skill-meta-table table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9em;
}

.skill-meta-table td {
    padding: 10px 14px;
    border-bottom: 1px solid #e3e3e7;
}

.dark .skill-meta-table td {
    border-color: #333;
}

.skill-meta-table tr:last-child td {
    border-bottom: none;
}

.skill-meta-table .meta-key {
    width: 100px;
    background-color: #f6f8fa;
    font-weight: 600;
    color: #444;
    white-space: nowrap;
}

.dark .skill-meta-table .meta-key {
    background-color: #2a2c30;
    color: #b0b2b8;
}

.skill-meta-table .meta-value {
    color: #333;
    word-break: break-word;
}

.dark .skill-meta-table .meta-value {
    color: #e8e9ed;
}
</style>
