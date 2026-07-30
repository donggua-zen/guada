<template>
    <div class="flex flex-col h-full w-full flex-1">
        <!-- 标题栏 -->
        <div
            class="shrink-0 flex items-center justify-between px-4 py-2 border-b border-gray-100 dark:border-[#2e3035]">
            <div class="flex items-center gap-2 min-w-0">
                <!-- 预览/源码切换按钮（仅 md 和 html），放在左侧高频操作区 -->
                <div v-if="canTogglePreview"
                    class="flex items-center gap-0.5 bg-gray-100/80 dark:bg-[#242529] rounded-md p-0.5 shrink-0">
                    <button class="preview-mode-btn" :class="{ 'is-active': renderMode === 'rendered' }"
                        title="预览" @click="renderMode = 'rendered'">
                        <el-icon :size="16">
                            <Eye20Regular v-if="renderMode !== 'rendered'" />
                            <Eye20Filled v-else />
                        </el-icon>
                    </button>
                    <button class="preview-mode-btn" :class="{ 'is-active': renderMode === 'source' }"
                        title="源码" @click="renderMode = 'source'">
                        <el-icon :size="16">
                            <Code20Regular v-if="renderMode !== 'source'" />
                            <Code20Filled v-else />
                        </el-icon>
                    </button>
                </div>

                <span class="font-medium text-gray-600 dark:text-[#8b8d95] truncate ml-2">
                    {{ tab.name }}
                </span>
                <div class="flex items-center gap-1 shrink-0">
                    <!-- 手动刷新预览按钮 -->
                    <button class="preview-close-btn" title="刷新预览" @click="handleManualRefresh">
                        <el-icon :size="14">
                            <ArrowClockwise20Regular class="text-gray-500 dark:text-[#8b8d95]" />
                        </el-icon>
                    </button>
                </div>
            </div>
        </div>

        <div class="flex-1 flex overflow-auto min-h-0 p-1">
            <div v-if="previewLoading" class="flex items-center justify-center h-full w-full">
                <el-icon class="is-loading" size="20">
                    <LoadingOutlined />
                </el-icon>
            </div>

            <!-- 图片预览 -->
            <img v-else-if="previewType === 'image' && !previewError" :src="imagePreviewUrl" @error="onImageError"
                class="image-preview w-full h-full object-contain p-2" alt="图片预览" />

            <!-- 不支持的文件 -->
            <div v-else-if="previewType === 'unsupported' && !previewError"
                class="w-full h-full flex items-center justify-center">
                <div class="text-center">
                    <p class="text-gray-400 dark:text-gray-500 text-sm">此文件暂不支持预览</p>
                    <el-button v-if="isElectron" @click="handleOpenInExplorerForCurrent" size="small" class="mt-3">
                        在资源管理器中打开
                    </el-button>
                </div>
            </div>

            <!-- 错误 / 文本内容 -->
            <div v-else class="w-full min-h-0">
                <!-- 文件不存在 -->
                <div v-if="fileNotFound" class="w-full h-full flex items-center justify-center p-4">
                    <div class="text-center">
                        <p class="text-gray-400 dark:text-gray-500 text-sm">文件已不存在</p>
                        <el-button @click="emit('close')" size="small" class="mt-3">
                            关闭标签
                        </el-button>
                    </div>
                </div>
                <!-- 其他错误 -->
                <div v-else-if="previewError" class="w-full h-full flex items-center justify-center p-4">
                    <div class="text-center">
                        <p class="text-gray-400 dark:text-gray-500 text-sm">{{ previewError }}</p>
                        <el-button v-if="isElectron && previewType === 'unsupported'"
                            @click="handleOpenInExplorerForCurrent" size="small" class="mt-3">
                            在资源管理器中打开
                        </el-button>
                    </div>
                </div>
                <template v-else-if="previewType === 'text'">
                    <!-- HTML 预览模式（通过 src 直接加载，后端 Set-Cookie 鉴权） -->
                    <iframe v-if="isHtmlFile && renderMode === 'rendered'" :src="htmlPreviewSrc"
                        class="w-full border-0" style="height: 100%;" sandbox="allow-same-origin allow-scripts" />

                    <!-- Markdown 渲染模式（iframe srcdoc + <base> 让浏览器原生解析相对路径） -->
                    <iframe v-else-if="isMarkdownFile && renderMode === 'rendered'"
                        :srcdoc="markdownSrcDoc" ref="markdownIframeRef"
                        class="w-full border-0" style="height: 100%;"
                        sandbox="allow-same-origin allow-scripts" />

                    <!-- 源码高亮（所有文件的 source 模式 + 不支持预览的文本文件） -->
                    <div v-else-if="highlightedCode" class="code-preview-container" v-html="highlightedCode" />

                    <!-- 普通文本预览（不支持高亮的文件） -->
                    <pre v-else v-text="fileContent"
                        class="text-sm leading-relaxed whitespace-pre-wrap break-all dark:bg-[#2a2c30] text-gray-800 dark:text-gray-200 p-4 m-0 overflow-auto min-h-0 font-mono" />
                </template>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import { apiService } from '@/services/ApiService'
import { LoadingOutlined } from '@vicons/antd'
import { Eye20Filled, Eye20Regular, Code20Filled, Code20Regular, ArrowClockwise20Regular } from '@vicons/fluent'
import { useStorage } from '@vueuse/core'
import { usePreviewMarkdown, buildMarkdownSrcDoc } from '@/composables/useMarkdown'
import { useHighlight } from '@/composables/useHighlight'
import type { UnifiedTab } from '@/composables/usePreviewTabCache'

interface SelectedFile {
    name: string
    path: string
    extension: string
    size: number
    content: string
    mimeType: string
}

const props = defineProps<{
    sessionId: string
    tab: UnifiedTab
    isActive: boolean
    contentVersion: number
    workspacePath: string | null
}>()

const emit = defineEmits<{
    close: []
    'insert-to-input': [path: string]
}>()

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined

// ── 预览状态 ──

const selectedFile = ref<SelectedFile | null>(null)
const fileContent = ref('')
const previewLoading = ref(false)
const previewError = ref('')
const fileNotFound = ref(false)
const previewType = ref<'text' | 'image' | 'unsupported' | null>(null)
const imagePreviewUrl = ref('')
const htmlPreviewUrl = ref('')
const htmlPreviewVersion = ref(0)
const fileContentHash = ref('')

// 缓存的工作目录绝对路径（用于 Electron file:// URL 拼接）
const cachedWorkspacePath = ref<string | null>(props.workspacePath)

watch(() => props.workspacePath, (val) => {
    if (val) cachedWorkspacePath.value = val
})

// 预览/源码模式（per-file，初始值从全局 localStorage 读取）
const globalDefaultMode = useStorage<'rendered' | 'source'>('filePreviewMode', 'rendered')
const renderMode = ref<'rendered' | 'source'>(globalDefaultMode.value)
watch(renderMode, (mode) => { globalDefaultMode.value = mode })

// Markdown iframe ref
const markdownIframeRef = ref<HTMLIFrameElement | null>(null)

// 懒加载标记
const hasLoaded = ref(false)
const isStale = ref(false)

// ── 依赖初始化 ──

const { parseMarkdown } = usePreviewMarkdown()
const { highlightCode, getLanguageFromExtension, isTextFile, isImageFile } = useHighlight()

// ── 计算属性 ──

const isHtmlFile = computed(() => {
    if (!selectedFile.value) return false
    const ext = selectedFile.value.extension.toLowerCase()
    return ext === '.html' || ext === '.htm'
})

const isMarkdownFile = computed(() => {
    if (!selectedFile.value) return false
    const ext = selectedFile.value.extension.toLowerCase()
    return ext === '.md' || ext === '.markdown'
})

const canTogglePreview = computed(() => isMarkdownFile.value || isHtmlFile.value)

const htmlPreviewSrc = computed(() => {
    if (!htmlPreviewUrl.value) return ''
    const separator = htmlPreviewUrl.value.includes('?') ? '&' : '?'
    return `${htmlPreviewUrl.value}${separator}_v=${htmlPreviewVersion.value}`
})

const markdownHtml = computed(() => {
    if (!selectedFile.value || !fileContent.value) return ''
    return parseMarkdown(fileContent.value)
})

const isDarkMode = computed(() => {
    if (typeof document === 'undefined') return false
    return document.documentElement.classList.contains('dark')
})

const markdownSrcDoc = computed(() => {
    if (!markdownHtml.value || !props.sessionId) return ''

    const mdFilePath = (selectedFile.value?.path || '').replace(/\\/g, '/')
    const lastSlashIndex = mdFilePath.lastIndexOf('/')
    const mdFileDir = lastSlashIndex > 0 ? mdFilePath.substring(0, lastSlashIndex) : ''

    let baseUrl: string
    if (isElectron && window.location.protocol === 'file:' && cachedWorkspacePath.value) {
        const separator = cachedWorkspacePath.value.endsWith('/') || cachedWorkspacePath.value.endsWith('\\') ? '' : '/'
        const fullPath = (cachedWorkspacePath.value + separator + mdFileDir).replace(/\\/g, '/')
        const encodedPath = encodeURI(fullPath)
        baseUrl = encodedPath.startsWith('/') ? `file://${encodedPath}/` : `file:///${encodedPath}/`
    } else {
        baseUrl = `/api/v1/sessions/${props.sessionId}/workspace/html-preview/${mdFileDir ? mdFileDir + '/' : ''}`
    }

    return buildMarkdownSrcDoc(markdownHtml.value, baseUrl, isDarkMode.value)
})

const highlightedCode = computed(() => {
    if (!selectedFile.value || !fileContent.value) return ''
    const lang = getLanguageFromExtension(selectedFile.value.extension.toLowerCase())
    if (lang) return highlightCode(fileContent.value, lang)
    return ''
})

// ── 工具方法 ──

function hashString(str: string): string {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i)
        hash = ((hash << 5) - hash) + char
        hash = hash & hash
    }
    return hash.toString(16)
}

// ── 文件加载 ──

async function loadFilePreview(): Promise<void> {
    if (!props.sessionId || props.tab.type !== 'file') return

    const tab = props.tab
    selectedFile.value = {
        name: tab.name!,
        path: tab.path!,
        extension: tab.extension!,
        size: tab.size!,
        content: '',
        mimeType: ''
    }
    previewError.value = ''
    previewLoading.value = false
    fileContentHash.value = ''

    const ext = tab.extension!
    if (isTextFile(ext)) {
        previewType.value = 'text'
        if (isHtmlFile.value) {
            if (isElectron && window.location.protocol === 'file:') {
                await loadHtmlPreviewLocal()
            } else {
                htmlPreviewUrl.value = apiService.getWorkspaceHtmlPreviewUrl(props.sessionId!, tab.path!)
            }
            await loadFileContent(tab.path!)
        } else if (isMarkdownFile.value) {
            if (isElectron && window.location.protocol === 'file:' && !cachedWorkspacePath.value) {
                try {
                    const resp = await apiService.getWorkspacePath(props.sessionId!)
                    cachedWorkspacePath.value = resp.workspacePath || null
                } catch { /* ignore */ }
            }
            await loadFileContent(tab.path!)
        } else {
            await loadFileContent(tab.path!)
        }
    } else if (isImageFile(ext)) {
        previewType.value = 'image'
        if (isElectron && window.location.protocol === 'file:') {
            await loadImageLocal()
        } else {
            if (tab.size && tab.size > 20 * 1024 * 1024) {
                previewError.value = '文件过大暂不支持预览'
            } else {
                imagePreviewUrl.value = apiService.getWorkspaceRawFileUrl(props.sessionId, tab.path!)
            }
        }
    } else {
        previewType.value = 'unsupported'
    }
}

async function loadFileContent(filePath: string, force = false, skipLoading = false): Promise<void> {
    if (!props.sessionId) return

    if (!skipLoading) {
        previewLoading.value = true
    }
    previewError.value = ''
    fileNotFound.value = false

    try {
        const response = await apiService.getWorkspaceFile(props.sessionId, filePath)

        const newHash = hashString(response.content)

        if (!force && fileContentHash.value && newHash === fileContentHash.value) {
            previewLoading.value = false
            return
        }

        fileContentHash.value = newHash
        selectedFile.value!.content = response.content
        selectedFile.value!.extension = response.extension
        selectedFile.value!.mimeType = response.mimeType
        fileContent.value = response.content

        if (isHtmlFile.value && renderMode.value === 'rendered') {
            htmlPreviewVersion.value++
        }
    } catch (error: any) {
        const status = error?.response?.status
        const msg = error?.response?.data?.message || error.message || ''
        if (status === 404 || msg.includes('not found') || msg.includes('does not exist') || msg.includes('ENOENT')) {
            fileNotFound.value = true
        } else if (msg.includes('File too large') || msg.includes('too large')) {
            previewError.value = '文件过大暂不支持预览'
        } else {
            previewError.value = '加载文件失败'
        }
        console.error('Failed to load file:', error)
    } finally {
        previewLoading.value = false
    }
}

async function loadImageLocal(): Promise<void> {
    try {
        const resp = await apiService.getWorkspacePath(props.sessionId!)
        const absWorkspacePath = resp.workspacePath
        if (!absWorkspacePath) {
            previewError.value = '无法获取工作目录路径'
            return
        }
        const relativePath = props.tab.path!.replace(/\\/g, '/')
        const separator = absWorkspacePath.endsWith('/') || absWorkspacePath.endsWith('\\') ? '' : '/'
        const fullPath = (absWorkspacePath + separator + relativePath).replace(/\\/g, '/')
        const encodedPath = encodeURI(fullPath)
        const fileUrl = encodedPath.startsWith('/') ? `file://${encodedPath}` : `file:///${encodedPath}`
        imagePreviewUrl.value = fileUrl
    } catch (error: any) {
        previewError.value = '加载图片失败'
        console.error('[FilePreviewPanel] Failed to load image locally:', error)
    }
}

async function loadHtmlPreviewLocal(): Promise<void> {
    try {
        const resp = await apiService.getWorkspacePath(props.sessionId!)
        const absWorkspacePath = resp.workspacePath
        if (!absWorkspacePath) {
            previewError.value = '无法获取工作目录路径'
            return
        }
        const relativePath = props.tab.path!.replace(/\\/g, '/')
        const separator = absWorkspacePath.endsWith('/') || absWorkspacePath.endsWith('\\') ? '' : '/'
        const fullPath = (absWorkspacePath + separator + relativePath).replace(/\\/g, '/')
        const encodedPath = encodeURI(fullPath)
        const fileUrl = encodedPath.startsWith('/') ? `file://${encodedPath}` : `file:///${encodedPath}`
        htmlPreviewUrl.value = fileUrl
    } catch (error: any) {
        previewError.value = '加载 HTML 失败'
        console.error('[FilePreviewPanel] Failed to load HTML locally:', error)
    }
}

// ── 操作方法 ──

function handleManualRefresh(): void {
    if (!selectedFile.value) return
    loadFileContent(selectedFile.value.path, true, false)
}

function onImageError(event: Event | string): void {
    const src = (typeof event === 'object' && (event as Event).target instanceof HTMLImageElement)
        ? (event.target as HTMLImageElement).getAttribute('src')
        : imagePreviewUrl.value
    console.error('[FilePreviewPanel] Image load failed, URL:', src)
    previewError.value = isElectron ? '图片加载失败' : '文件过大暂不支持预览'
}

async function handleOpenInExplorerForCurrent(): Promise<void> {
    if (!selectedFile.value || !props.sessionId || !isElectron) return
    try {
        const resp = await apiService.getWorkspacePath(props.sessionId)
        const wsPath = resp.workspacePath
        if (!wsPath) {
            ElMessage.error('无法获取工作目录路径')
            return
        }
        const relativePath = selectedFile.value.path.replace(/\\/g, '/')
        const separator = wsPath.endsWith('/') || wsPath.endsWith('\\') || relativePath.startsWith('/') ? '' : '/'
        let fullPath = wsPath + separator + relativePath
        const lastSep = Math.max(fullPath.lastIndexOf('/'), fullPath.lastIndexOf('\\'))
        if (lastSep > 0) {
            fullPath = fullPath.substring(0, lastSep)
        }
        await window.electronAPI!.openFolder(fullPath)
    } catch (error: any) {
        console.error('[FilePreviewPanel] Open in explorer failed:', error)
        ElMessage.error('打开失败')
    }
}

// ── Markdown iframe 消息处理 ──

function onMarkdownMessage(e: MessageEvent): void {
    if (!e.data || typeof e.data !== 'object') return
    if (e.data.type === 'md-preview-link' && e.data.url) {
        // 仅处理来自当前面板 iframe 的消息
        if (markdownIframeRef.value && e.source === markdownIframeRef.value.contentWindow) {
            import('@/utils/workspacePreview').then(({ openLink }) => openLink(e.data.url))
        }
    }
}

// ── 生命周期 ──

onMounted(() => {
    window.addEventListener('message', onMarkdownMessage)
    if (props.isActive) {
        hasLoaded.value = true
        loadFilePreview()
    }
})

onBeforeUnmount(() => {
    window.removeEventListener('message', onMarkdownMessage)
})

// ── Watch：懒加载 + 文件变更 ──

watch(() => props.isActive, async (active) => {
    if (!active) return

    if (!hasLoaded.value) {
        hasLoaded.value = true
        await loadFilePreview()
    } else if (isStale.value) {
        isStale.value = false
        await loadFileContent(props.tab.path!, false, true)
    }
})

watch(() => props.contentVersion, (newVer, oldVer) => {
    if (oldVer === 0 || newVer <= oldVer) return
    if (props.isActive) {
        loadFileContent(props.tab.path!, false, true)
    } else {
        isStale.value = true
    }
})
</script>

<style>
.code-preview-container pre code.hljs {
    color: var(--color-text, #333) !important;
    background-color: transparent !important;
}

/* 代码行号样式 */
.code-lines {
    display: flex;
    flex-direction: column;
}

.line {
    display: flex;
    min-height: 1.5em;
}

.line-num {
    box-sizing: content-box;
    user-select: none;
    text-align: right;
    padding-right: 0.75em;
    color: #9ca3af;
    font-variant-numeric: tabular-nums;
    border-right: 1px solid #e5e7eb;
    margin-right: 0.75em;
}

.dark .line-num {
    color: #4b5563;
    border-right-color: #374151;
}

.line-content {
    flex: 1;
    white-space: pre;
}
</style>

<style scoped>
.code-preview-container {
    overflow-y: auto;
    overflow-x: auto;
    min-height: 100%;
    max-height: 100%;
}

/* 预览/源码模式切换按钮 */
.preview-mode-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    background: transparent;
    color: var(--color-text-gray);
    transition: background 0.15s ease, color 0.15s ease;
    outline: none;
}

.preview-mode-btn:hover {
    background: var(--color-sidebar-bg-hover);
}

.preview-mode-btn.is-active {
    color: var(--color-text);
    background: var(--color-bg);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}

/* 关闭预览按钮 */
.preview-close-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    background: transparent;
    color: var(--color-text);
    transition: background 0.15s ease, color 0.15s ease;
    outline: none;
}

.preview-close-btn:hover {
    background: var(--color-sidebar-bg-hover);
}
</style>
