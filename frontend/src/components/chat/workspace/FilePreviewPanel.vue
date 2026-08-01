<template>
    <div class="flex flex-col h-full min-h-0 flex-1 bg-(--color-bg)">
        <!-- 标题栏 -->
        <div
            class="shrink-0 flex items-center justify-between px-4 py-2 border-b border-gray-100 dark:border-[#2e3035]">
            <div class="flex items-center gap-2 min-w-0">
                <!-- 预览/源码切换按钮（仅 md 和 html），放在左侧高频操作区 -->
                <div v-if="canTogglePreview"
                    class="flex items-center gap-0.5 bg-gray-100/80 dark:bg-[#242529] rounded-md p-0.5 shrink-0">
                    <button class="preview-mode-btn" :class="{ 'is-active': renderMode === 'rendered' }" title="预览"
                        @click="renderMode = 'rendered'">
                        <el-icon :size="16">
                            <Eye20Regular v-if="renderMode !== 'rendered'" />
                            <Eye20Filled v-else />
                        </el-icon>
                    </button>
                    <button class="preview-mode-btn" :class="{ 'is-active': renderMode === 'source' }" title="源码"
                        @click="renderMode = 'source'">
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

        <div class="flex-1 flex overflow-hidden w-full min-h-0 p-1" @contextmenu.prevent="handleContextMenu($event)">
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
            <template v-else>
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
                    <iframe v-if="isHtmlFile && renderMode === 'rendered'" :src="htmlPreviewSrc" class="w-full border-0"
                        style="height: 100%;" sandbox="allow-same-origin allow-scripts" />

                    <!-- Markdown 渲染模式（iframe srcdoc + <base> 让浏览器原生解析相对路径） -->
                    <iframe v-else-if="isMarkdownFile && renderMode === 'rendered'" :srcdoc="markdownSrcDoc"
                        ref="markdownIframeRef" class="w-full border-0" style="height: 100%;background-color: transparent !important;
    color-scheme: light; /* 强制使用浅色模式以确保透明生效 */" allowtransparency="true" sandbox="allow-same-origin allow-scripts" />

                    <!-- 源码高亮（所有文件的 source 模式 + 不支持预览的文本文件） -->
                    <div v-else-if="highlightedCode" class="code-preview-container min-w-full"
                        v-html="highlightedCode" />

                    <!-- 普通文本预览（不支持高亮的文件） -->
                    <pre v-else v-text="fileContent"
                        class="text-sm leading-relaxed whitespace-pre-wrap break-all  text-gray-800 dark:text-gray-200 p-4 m-0 overflow-auto min-h-0 font-mono" />
                </template>
            </template>
        </div>

        <!-- 右键上下文菜单 -->
        <ContextMenu :visible="contextMenuVisible" :x="contextMenuX" :y="contextMenuY"
            :items="contextMenuItems" @close="contextMenuVisible = false" />
    </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import { apiService } from '@/services/ApiService'
import { LoadingOutlined } from '@vicons/antd'
import { Eye20Filled, Eye20Regular, Code20Filled, Code20Regular, ArrowClockwise20Regular } from '@vicons/fluent'
import { DocumentCopy, Plus } from '@element-plus/icons-vue'
import { useStorage } from '@vueuse/core'
import { usePreviewMarkdown, buildMarkdownSrcDoc } from '@/composables/useMarkdown'
import { useTheme } from '@/composables/useTheme'
import { useHighlight } from '@/composables/useHighlight'
import ContextMenu, { type ContextMenuItem } from '@/components/ui/ContextMenu.vue'
import type { UnifiedTab } from '@/composables/usePreviewTabCache'

interface SelectedFile {
    name: string
    path: string
    extension: string
    size: number
    content: string
    mimeType: string
}

export interface SnipData {
    path: string
    fileName: string
    startLine?: number
    endLine?: number
    content: string  // base64-encoded (truncated head + notice for large selections)
    label: string
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
    'insert-snip': [data: SnipData]
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

// ── 右键上下文菜单 ──

const contextMenuVisible = ref(false)
const contextMenuX = ref(0)
const contextMenuY = ref(0)
const contextMenuItems = ref<ContextMenuItem[]>([])

// Markdown iframe 选区文本（由 iframe postMessage 同步）
const iframeSelection = ref('')

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

const { isDark: isDarkMode } = useTheme()

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
    // 仅处理来自当前面板 iframe 的消息
    if (!markdownIframeRef.value || e.source !== markdownIframeRef.value.contentWindow) return

    const data = e.data
    if (data.type === 'md-preview-link' && data.url) {
        import('@/utils/workspacePreview').then(({ openLink }) => openLink(data.url))
    } else if (data.type === 'md-preview-selection') {
        iframeSelection.value = data.text || ''
    } else if (data.type === 'md-preview-contextmenu') {
        // 将 iframe 内坐标转换为父页面坐标
        const rect = markdownIframeRef.value.getBoundingClientRect()
        showContextMenu(rect.left + data.x, rect.top + data.y, data.text || '')
    }
}

// ── 选区提取 + Snip 构建 ──

const MAX_SNIPPET_CONTENT = 2000
const SNIPPET_HEAD = 800

/** UTF-8 安全的 base64 编码 */
function encodeBase64(text: string): string {
    return btoa(unescape(encodeURIComponent(text)))
}

/** 从高亮代码选区中提取行号和原始文本（保留缩进） */
function getCodeSelectionInfo(selection: Selection): { start?: number; end?: number; text?: string } {
    if (!selection.rangeCount || selection.isCollapsed) return {}
    const range = selection.getRangeAt(0)

    function findLineEl(node: Node): HTMLElement | null {
        let el = node.nodeType === Node.ELEMENT_NODE ? node as HTMLElement : node.parentElement
        while (el && !el.classList?.contains('line')) {
            el = el.parentElement
        }
        return el
    }

    const startLineEl = findLineEl(range.startContainer)
    const endLineEl = findLineEl(range.endContainer)

    let start: number | undefined
    let end: number | undefined

    if (startLineEl) {
        const startText = startLineEl.querySelector('.line-num')?.textContent
        const endText = endLineEl?.querySelector('.line-num')?.textContent
        if (startText) {
            start = parseInt(startText)
            end = endText ? parseInt(endText) : start
        }
    }

    // 提取选区文本：遍历 .line-content 元素的 textContent 以保留原始缩进
    const container = startLineEl?.parentElement // .code-lines
    if (container) {
        const allLines = container.querySelectorAll(':scope > .line')
        const lines: string[] = []
        allLines.forEach((lineEl) => {
            const lineNum = lineEl.querySelector('.line-num')?.textContent
            if (!lineNum) return
            const num = parseInt(lineNum)
            const content = lineEl.querySelector('.line-content')?.textContent || ''
            const inRange = start && end
                ? (num >= Math.min(start, end) && num <= Math.max(start, end))
                : false
            if (inRange) lines.push(content)
        })
        if (lines.length > 0) {
            return { start, end, text: lines.join('\n') }
        }
    }

    // Fallback: 通过偏移量在 <pre> 中计算行号
    const preEl = (range.startContainer as HTMLElement).closest?.('pre')
        || range.startContainer.parentElement?.closest('pre')
    if (preEl) {
        const preRange = document.createRange()
        preRange.selectNodeContents(preEl)
        preRange.setEnd(range.startContainer, range.startOffset)
        const beforeText = preRange.toString()
        const startLine = beforeText.split('\n').length
        const selectedText = selection.toString()
        const endLine = startLine + selectedText.split('\n').length - 1
        return { start: startLine, end: endLine, text: selectedText }
    }

    return {}
}

/** 构造 SnipData */
function buildSnipData(selectedText: string, startLine?: number, endLine?: number): SnipData | null {
    if (!selectedFile.value) return null

    const path = selectedFile.value.path.replace(/\\/g, '/')
    const fileName = selectedFile.value.name
    const rangeLabel = startLine && endLine
        ? (startLine === endLine ? `L${startLine}` : `L${startLine}-L${endLine}`)
        : (startLine ? `L${startLine}` : '')
    const label = rangeLabel ? `${path}:${rangeLabel}` : path

    let payload: string
    if (selectedText.length <= MAX_SNIPPET_CONTENT) {
        payload = selectedText
    } else {
        const head = selectedText.substring(0, SNIPPET_HEAD)
        const fileRef = `file:${path}${rangeLabel ? `:${rangeLabel}` : ''}`
        payload = `${head}\n\n<system_reminder>The selected text has been truncated. If you need the full content, read the file at ${fileRef}.</system_reminder>`
    }

    const data: SnipData = {
        path,
        fileName,
        label,
        content: encodeBase64(payload),
    }

    if (startLine) data.startLine = startLine
    if (endLine) data.endLine = endLine

    return data
}

/** 显示右键上下文菜单 */
function showContextMenu(x: number, y: number, selectedText: string, startLine?: number, endLine?: number) {
    const hasSelection = selectedText.trim().length > 0
    const items: ContextMenuItem[] = []

    if (hasSelection) {
        items.push({
            label: '添加选区到会话',
            icon: DocumentCopy,
            onClick: () => {
                const snip = buildSnipData(selectedText, startLine, endLine)
                if (snip) emit('insert-snip', snip)
            },
        })
        items.push({
            label: '添加文件到会话',
            icon: Plus,
            divider: true,
            onClick: () => {
                if (selectedFile.value) emit('insert-to-input', selectedFile.value.path)
            },
        })
    } else {
        items.push({
            label: '添加文件到会话',
            icon: Plus,
            onClick: () => {
                if (selectedFile.value) emit('insert-to-input', selectedFile.value.path)
            },
        })
    }

    contextMenuItems.value = items
    contextMenuX.value = x
    contextMenuY.value = y
    contextMenuVisible.value = true
}

/** 右键事件处理（代码预览 / 纯文本预览） */
function handleContextMenu(event: MouseEvent) {
    const selection = window.getSelection()
    const selectedText = selection?.toString() || ''

    if (selectedText.trim()) {
        const info = getCodeSelectionInfo(selection!)
        const text = info.text || selectedText
        showContextMenu(event.clientX, event.clientY, text, info.start, info.end)
    } else {
        // Markdown iframe 的右键由 postMessage 触发，不走这里
        // 非选区右键仍可添加文件
        showContextMenu(event.clientX, event.clientY, '')
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

.code-preview-container pre {
    margin: 0;
    padding: 0;
    overflow: visible;
}

.code-preview-container code.hljs {
    overflow: visible;
}

/* per-line 布局：每行 flex row，行号 sticky 固定 + 代码折行 */
.code-lines {
    display: flex;
    flex-direction: column;
}

.line {
    display: flex;
    align-items: stretch;
    min-height: 1.5em;
}

.line-num {
    display: flex;
    flex-shrink: 0;
    align-self: stretch;
    box-sizing: content-box;
    user-select: none;
    text-align: right;
    padding-right: 0.75em;
    color: #9ca3af;
    font-variant-numeric: tabular-nums;
    border-right: 1px solid #e5e7eb;
    /* sticky 固定行号：横向滚动时钉在左侧 */
    position: sticky;
    left: 0;
    z-index: 1;
    /* 背景色防止代码透过行号显示 */
    background: var(--color-bg, #fff);
}

.dark .line-num {
    color: #4b5563;
    border-right-color: #374151;
    background: var(--color-bg, #222);
}

.line-content {
    white-space: pre-wrap;
    word-break: break-all;
    padding-left: 1em;
    min-width: 800px;
}
</style>

<style scoped>
.code-preview-container {
    overflow-y: auto;
    overflow-x: auto;
    flex: 1;
    min-width: 0;
    min-height: 0;
    background-color: transparent;
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
