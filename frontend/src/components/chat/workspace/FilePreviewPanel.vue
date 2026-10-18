<template>
    <div class="flex flex-col h-full min-h-0 flex-1 bg-(--gd-color-bg)">
        <!-- 标题栏 -->
        <div
            class="shrink-0 flex items-center justify-between px-4 py-2 border-b border-gray-100 dark:border-[#2e3035]">
            <div class="flex items-center gap-2 min-w-0">
                <!-- 预览/源码切换按钮（仅 md/html/svg 有渲染形态），放在左侧高频操作区 -->
                <div v-if="canTogglePreview"
                    class="flex items-center gap-0.5 bg-gray-100/80 dark:bg-[#242529] rounded-md p-0.5 shrink-0">
                    <button class="preview-mode-btn" :class="{ 'is-active': renderMode === 'rendered' }" :title="t('chat.workspace.preview')"
                        @click="renderMode = 'rendered'">
                        <el-icon :size="16">
                            <Eye20Regular v-if="renderMode !== 'rendered'" />
                            <Eye20Filled v-else />
                        </el-icon>
                    </button>
                    <button class="preview-mode-btn" :class="{ 'is-active': renderMode === 'source' }" :title="t('chat.workspace.source')"
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
                <!-- 保存状态 -->
                <span v-if="saveStatus === 'saving'" class="text-xs text-gray-400 ml-1">{{ t('chat.workspace.saving') }}</span>
                <span v-else-if="saveStatus === 'unsaved'" class="text-xs text-amber-500 ml-1">{{ t('chat.workspace.unsaved') }}</span>
                <!-- 外部冲突提示 -->
                <span v-if="externalConflict" class="text-xs text-red-500 ml-2">{{ t('chat.workspace.fileModifiedExternal') }}</span>
            </div>

            <!-- 右侧操作区（右对齐，与 GitChangesPanel 头部同款按钮）：刷新预览 + 目录树显隐开关 -->
            <div class="flex items-center gap-1 shrink-0">
                <!-- 手动刷新预览按钮 -->
                <button class="preview-tool-btn" :title="t('chat.workspace.refreshPreview')" @click="handleManualRefresh">
                    <el-icon :size="16">
                        <ArrowClockwise20Regular />
                    </el-icon>
                </button>
                <!-- 目录树显隐开关（每个文件标签独立记忆，样式与 Git 审阅面板一致） -->
                <GdTooltip :content="treeVisible ? t('chat.workspace.collapseTree') : t('chat.workspace.expandTree')"
                    placement="bottom">
                    <!-- eslint-disable vue/no-mutating-props -- tab 对象即标签缓存实体，属性写入是本面板与缓存同步的既定模式 -->
                    <button class="preview-tool-btn" :class="{ 'preview-tool-btn--active': treeVisible }"
                        :title="treeVisible ? t('chat.workspace.collapseTree') : t('chat.workspace.expandTree')"
                        @click="props.tab.treeVisible = !treeVisible">
                        <el-icon :size="20">
                            <TextboxAlignTopRotate9020Regular />
                        </el-icon>
                    </button>
                    <!-- eslint-enable vue/no-mutating-props -->
                </GdTooltip>
            </div>
        </div>

        <!-- 左：文件内容区（弹性） | 右：目录树 pane2（仅激活面板 + 全局开关开启时渲染） -->
        <div class="flex-1 flex overflow-hidden w-full min-h-0 p-1" @contextmenu.prevent="handleContextMenu($event)">
            <div class="flex-1 min-w-0 flex flex-col overflow-hidden">
            <!-- 空态标签（path 为空）：新建标签页提示 -->
            <div v-if="!selectedFile && props.tab.type === 'file'" class="flex items-center justify-center h-full w-full">
                <div class="text-center">
                    <p class="text-gray-400 dark:text-gray-500 text-sm">{{ t('chat.workspace.newTabHint') }}</p>
                </div>
            </div>

            <div v-else-if="previewLoading" class="flex items-center justify-center h-full w-full">
                <el-icon class="is-loading" size="20">
                    <LoadingOutlined />
                </el-icon>
            </div>

            <!-- 图片预览 -->
            <img v-else-if="previewType === 'image' && assetPreviewUrl && !previewError" :src="assetPreviewUrl" @error="onImageError"
                class="image-preview w-full h-full object-contain p-2" :alt="t('chat.workspace.imageAlt')" />

            <!-- 视频预览（raw-file 走 Range/206，可拖进度条） -->
            <video v-else-if="previewType === 'video' && assetPreviewUrl && !previewError" ref="mediaElRef"
                :src="assetPreviewUrl" controls playsinline preload="metadata"
                class="w-full h-full object-contain p-2" @error="onMediaError" />

            <!-- 音频预览（无画面：文件图标 + 原生播放器） -->
            <div v-else-if="previewType === 'audio' && assetPreviewUrl && !previewError"
                class="w-full h-full flex items-center justify-center">
                <div class="flex flex-col items-center gap-3 px-6 max-w-full">
                    <img :src="getFileIcon(props.tab.name!)" class="w-12 h-12" alt="" />
                    <span class="text-sm text-gray-600 dark:text-[#8b8d95] truncate max-w-full">{{ props.tab.name }}</span>
                    <audio ref="mediaElRef" :src="assetPreviewUrl" controls class="w-[420px] max-w-full"
                        @error="onMediaError" />
                </div>
            </div>

            <!-- PDF 预览（浏览器内置阅读器） -->
            <iframe v-else-if="previewType === 'pdf' && assetPreviewUrl && !previewError" :src="assetPreviewUrl"
                class="w-full border-0" style="height: 100%;" />

            <!-- 不支持的文件 -->
            <div v-else-if="previewType === 'unsupported' && !previewError"
                class="w-full h-full flex items-center justify-center">
                <div class="text-center">
                    <p class="text-gray-400 dark:text-gray-500 text-sm">
                        {{ binaryNotPreviewable
                            ? t('chat.workspace.binaryNotPreview')
                            : isUnplayableMediaFile(currentExtension)
                                ? t('chat.workspace.mediaNotPlayable')
                                : t('chat.workspace.unsupportedPreview') }}
                    </p>
                    <el-button v-if="isElectron" @click="handleOpenInFileManager" size="small" class="mt-3">
                        {{ t(isMac ? 'chat.workspace.openInFinder' : 'chat.workspace.openInExplorer') }}
                    </el-button>
                </div>
            </div>

            <!-- 错误 / 文本内容 -->
            <template v-else>
                <!-- 文件不存在 -->
                <div v-if="fileNotFound" class="w-full h-full flex items-center justify-center p-4">
                    <div class="text-center">
                        <p class="text-gray-400 dark:text-gray-500 text-sm">{{ t('chat.workspace.fileNotFound') }}</p>
                        <el-button @click="emit('close')" size="small" class="mt-3">
                            {{ t('chat.workspace.closeTab') }}
                        </el-button>
                    </div>
                </div>
                <!-- 其他错误 -->
                <div v-else-if="previewError" class="w-full h-full flex items-center justify-center p-4">
                    <div class="text-center">
                        <p class="text-gray-400 dark:text-gray-500 text-sm">{{ previewError }}</p>
                        <el-button v-if="isElectron" @click="handleOpenInFileManager" size="small" class="mt-3">
                            {{ t(isMac ? 'chat.workspace.openInFinder' : 'chat.workspace.openInExplorer') }}
                        </el-button>
                    </div>
                </div>
                <template v-else-if="previewType === 'text'">
                    <!-- SVG 渲染模式：<img> 加载（SVG 作为图片不执行脚本），切换按钮与 md/html 同一套。
                         必须带 assetPreviewUrl 守卫：否则会先以 src="" 挂载，空 src 会触发一次 error 事件把预览打回错误态 -->
                    <img v-if="isSvgFile && renderMode === 'rendered' && assetPreviewUrl && !previewError"
                        :src="assetPreviewUrl" @error="onImageError"
                        class="image-preview w-full h-full object-contain p-2" :alt="t('chat.workspace.imageAlt')" />

                    <!-- HTML 预览模式（通过 src 直接加载，后端 Set-Cookie 鉴权） -->
                    <iframe v-else-if="isHtmlFile && renderMode === 'rendered'" :src="htmlPreviewSrc" class="w-full border-0"
                        style="height: 100%;" sandbox="allow-same-origin allow-scripts" />

                    <!-- Markdown 渲染模式（iframe srcdoc + <base> 让浏览器原生解析相对路径） -->
                    <iframe v-else-if="isMarkdownFile && renderMode === 'rendered'" :srcdoc="markdownSrcDoc"
                        ref="markdownIframeRef" class="w-full border-0" style="height: 100%;background-color: transparent !important;
    color-scheme: light; /* 强制使用浅色模式以确保透明生效 */" allowtransparency="true" sandbox="allow-same-origin allow-scripts" />

                    <!-- 编辑模式：md/html/svg 切到源码时，以及所有无渲染形态的文本文件
                         （.ts/.js/.json/.txt/.log…）都落到这里，统一以可编辑的 CodeMirror 打开（Ctrl+S 保存） -->
                    <template v-else>
                        <!-- 外部冲突横幅 -->
                        <div v-if="externalConflict" class="conflict-banner">
                            <span class="conflict-banner-text">{{ t('chat.workspace.externalConflictHint') }}</span>
                            <button class="conflict-banner-btn" @click="handleConflictReload">{{ t('chat.workspace.externalConflictReload') }}</button>
                            <button class="conflict-banner-btn primary" @click="handleConflictSave">{{ t('chat.workspace.externalConflictSave') }}</button>
                        </div>
                        <CodeMirrorEditor v-if="selectedFile" ref="editorRef" :model-value="editContent"
                            :extension="selectedFile.extension" @update:model-value="editContent = $event" @save="handleSaveFile" />
                    </template>
                </template>
            </template>
            </div>

            <!-- 右侧目录树：仅在激活面板渲染（v-if 于 panel-hidden 之外，非激活面板不持有树 DOM） -->
            <WorkspaceTreePanel v-if="props.isActive && treeVisible"
                :session-id="props.sessionId" @insert-to-input="emit('insert-to-input', $event)" />
        </div>

        <!-- 右键上下文菜单 -->
        <ContextMenu :visible="contextMenuVisible" :x="contextMenuX" :y="contextMenuY"
            :items="contextMenuItems" @close="contextMenuVisible = false" />
    </div>
</template>

<script setup lang="ts">
import { getApiErrorStatus, getErrorMessage } from '@/utils/errorMessage'
import { decidePreviewRefresh } from '@/utils/previewRefresh'
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { apiService } from '@/services/ApiService'
import { LoadingOutlined } from '@vicons/antd'
import { Eye20Filled, Eye20Regular, Code20Filled, Code20Regular, ArrowClockwise20Regular, TextboxAlignTopRotate9020Regular } from '@vicons/fluent'
import { DocumentCopy, Plus, CopyDocument } from '@element-plus/icons-vue'
import { useStorage } from '@vueuse/core'
import { Finder, WindowsExplorer } from '@/components/icons'
import { writeTextToClipboard } from '@/utils/clipboard'
import { usePreviewMarkdown, buildMarkdownSrcDoc } from '@/composables/useMarkdown'
import { useTheme } from '@/composables/useTheme'
import { getPreviewKind, isUnplayableMediaFile, type FilePreviewKind } from '@/composables/useHighlight'
import { getFileIcon } from '@/composables/useFileIcon'
import CodeMirrorEditor from './CodeMirrorEditor.vue'
import ContextMenu, { type ContextMenuItem } from '@/components/ui/ContextMenu.vue'
import GdTooltip from '@/components/ui/GdTooltip.vue'
import WorkspaceTreePanel from './WorkspaceTreePanel.vue'
import { useWorkspaceTreeStore } from '@/stores/workspaceTree'
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
// macOS 的「文件管理器」是访达（Finder），文案需与 Windows 区分
const isMac = isElectron && window.electronAPI?.platform === 'darwin'
const { t } = useI18n()

/**
 * 目录树显隐：每文件标签独立记忆（tab.treeVisible，随标签缓存持久化）。
 * - 用户手动设置过 → 始终用该值（之后打开文件也不覆盖用户选择）；
 * - 从未设置（undefined）→ 按标签状态推导：空白标签展开（便于从树里选文件），
 *   已打开文件的标签自动收起（给预览让出宽度）。
 * 推导式（不写回状态）：点了文件后 path 变为非空即自动收起，刷新后同一规则重算，无需事件监听。
 */
const treeVisible = computed(() => props.tab.treeVisible ?? !props.tab.path)

// ── 预览状态 ──

const selectedFile = ref<SelectedFile | null>(null)
const editContent = ref('') // CodeMirror 编辑内容（source 模式）
/** 编辑器实例：右键"加入会话"要从 CodeMirror 状态取选区（原生 Selection 取不到编辑器选区） */
const editorRef = ref<{ getSelectionInfo: () => { text: string; startLine: number; endLine: number } | null } | null>(null)
const saveStatus = ref<'saved' | 'saving' | 'unsaved'>('saved')
const externalConflict = ref(false) // 外部修改冲突（用户有未保存编辑时外部文件变化）

const fileContent = ref('')
const previewLoading = ref(false)
const previewError = ref('')
const fileNotFound = ref(false)
const previewType = ref<FilePreviewKind | null>(null)
/** 兜底文案分流：后缀探测判定为二进制（区别于"已知不支持的后缀"） */
const binaryNotPreviewable = ref(false)
/** 图片/音视频/pdf/svg 渲染态共用的直出 URL（raw-file 或 Electron 本地 file://） */
const assetPreviewUrl = ref('')
const htmlPreviewUrl = ref('')
const htmlPreviewVersion = ref(0)
const fileContentHash = ref('')
/** 手动刷新计数：并入直出 URL 的版本参数，使元素真正重新请求（缓存击穿） */
const localRefreshCount = ref(0)
/** <video>/<audio> 元素引用（切走标签时暂停，避免隐藏面板继续出声） */
const mediaElRef = ref<HTMLMediaElement | null>(null)

// 文件加载/切换时，同步编辑内容（冲突时不覆盖）
watch([() => selectedFile.value?.path, () => fileContent.value], () => {
    if (externalConflict.value) return
    editContent.value = fileContent.value
    saveStatus.value = 'saved'
})

// 缓存的工作目录绝对路径（用于 Electron file:// URL 拼接）
const cachedWorkspacePath = ref<string | null>(props.workspacePath)
const treeStore = useWorkspaceTreeStore()

watch(() => props.workspacePath, (val) => {
    if (val) cachedWorkspacePath.value = val
})

// 预览/源码模式：全局查看偏好（localStorage 持久化），只对 md/html/svg 有渲染形态的文件生效。
// 必须双向同步：面板实例随文件标签常驻，若只写回不监听，各标签会冻结在挂载那一刻的模式，
// 表现为"同一类文件在不同标签里行为不一致"。
const globalDefaultMode = useStorage<'rendered' | 'source'>('filePreviewMode', 'rendered')
const renderMode = ref<'rendered' | 'source'>(globalDefaultMode.value)
watch(renderMode, (mode) => { globalDefaultMode.value = mode })
watch(globalDefaultMode, (mode) => { renderMode.value = mode })

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

// ── 计算属性 ──

const isHtmlFile = computed(() => {
    if (!selectedFile.value) return false
    const ext = (selectedFile.value.extension || '').toLowerCase()
    return ext === '.html' || ext === '.htm'
})

const isMarkdownFile = computed(() => {
    if (!selectedFile.value) return false
    const ext = (selectedFile.value.extension || '').toLowerCase()
    return ext === '.md' || ext === '.markdown'
})

const isSvgFile = computed(() => {
    if (!selectedFile.value) return false
    return (selectedFile.value.extension || '').toLowerCase() === '.svg'
})

const canTogglePreview = computed(() => isMarkdownFile.value || isHtmlFile.value || isSvgFile.value)

/** 当前生效的后缀：探测回填后以 selectedFile 为准，未加载时退回标签值 */
const currentExtension = computed(() => selectedFile.value?.extension || props.tab.extension || '')

/**
 * 直出资源型预览（不走文本接口）：图片/音视频/pdf，以及 SVG 的渲染态。
 * 这些类型内容变更时只能重建 URL（raw-file 直出），不能调文本接口刷新。
 */
const isAssetPreview = computed(() => previewType.value !== 'text'
    || (isSvgFile.value && renderMode.value === 'rendered'))

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
        baseUrl = toLocalFileUrl(joinWorkspacePath(cachedWorkspacePath.value, mdFileDir)) + '/'
    } else {
        baseUrl = `/api/v1/sessions/${props.sessionId}/workspace/html-preview/${mdFileDir ? mdFileDir + '/' : ''}`
    }

    return buildMarkdownSrcDoc(markdownHtml.value, baseUrl, isDarkMode.value)
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

// ── 直出资源 URL（图片 / 音视频 / pdf / SVG 渲染态共用） ──

/** 工作区绝对路径 → file:// URL（仅 Electron 生产形态用：页面本身就是 file:） */
function toLocalFileUrl(absolutePath: string): string {
    const normalized = absolutePath.replace(/\\/g, '/')
    const encodedPath = encodeURI(normalized)
    return encodedPath.startsWith('/') ? `file://${encodedPath}` : `file:///${encodedPath}`
}

/** 拼接工作区绝对路径与相对路径（统一分隔符，处理 Windows 反斜杠） */
function joinWorkspacePath(workspacePath: string, relativePath: string): string {
    const separator = workspacePath.endsWith('/') || workspacePath.endsWith('\\') ? '' : '/'
    return (workspacePath + separator + relativePath).replace(/\\/g, '/')
}

/** 确保已缓存工作目录绝对路径（Electron 生产形态拼 file:// 需要）
 *  兜底走 store 的会话级缓存：正常路径由父层 :workspace-path 传入，本函数只在为空时触发 */
async function ensureWorkspacePath(): Promise<string | null> {
    if (cachedWorkspacePath.value) return cachedWorkspacePath.value
    const path = await treeStore.ensureWorkspacePath(props.sessionId!)
    if (path) cachedWorkspacePath.value = path
    return cachedWorkspacePath.value
}

/**
 * 直出资源 URL：Electron 生产（file:）走本地路径，其余走带 token 的 raw-file 端点。
 * 端点侧用 sendFile 提供 Range/206，故音视频可拖进度条、大文件按块加载；
 * `_v=` 版本参数用于外部变更/手动刷新后真正重新请求（URL 不变则元素不会重新加载）。
 */
async function resolveAssetUrl(filePath: string): Promise<string | null> {
    if (isElectron && window.location.protocol === 'file:') {
        const wsPath = await ensureWorkspacePath()
        if (!wsPath) {
            previewError.value = t('chat.workspace.workspacePathError')
            return null
        }
        return toLocalFileUrl(joinWorkspacePath(wsPath, filePath))
    }
    const rawUrl = apiService.getWorkspaceRawFileUrl(props.sessionId, filePath)
    return `${rawUrl}&_v=${props.contentVersion}.${localRefreshCount.value}`
}

// ── 文件加载 ──

/** 加载代际：会话/路径变化后丢弃迟到的响应，避免旧会话内容写进当前面板 */
let loadGeneration = 0

/** 当前响应是否仍属于最新一次加载且会话未变 */
function isCurrentLoad(generation: number, sessionId: string): boolean {
    return generation === loadGeneration && sessionId === props.sessionId
}

async function loadFilePreview(): Promise<void> {
    if (!props.sessionId || props.tab.type !== 'file') return
    // 新一次预览开始：作废所有在途加载（旧响应不得再回写状态）
    loadGeneration++
    // 空态标签（path 为空）：显示"新建标签页"提示，不加载内容
    if (!props.tab.path) {
        selectedFile.value = null
        previewLoading.value = false
        previewError.value = ''
        fileNotFound.value = false
        previewType.value = null
        assetPreviewUrl.value = ''
        return
    }

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
    assetPreviewUrl.value = ''
    binaryNotPreviewable.value = false

    const kind = getPreviewKind(tab.extension ?? '')
    previewType.value = kind

    // 确定不支持的类型：直接落兜底 UI，不发任何请求
    if (kind === 'unsupported') return

    // 后缀缺失/不认识：让后端读文件头探测，据结果决定文本 / 真实资源类型 / 不支持
    if (kind === 'unknown') {
        await probeUnknownFile(tab.path!)
        return
    }

    // 图片 / 音视频 / pdf：raw-file 直出，加载或解码失败由元素的 error 事件兜底
    if (kind !== 'text') {
        assetPreviewUrl.value = (await resolveAssetUrl(tab.path!)) ?? ''
        return
    }

    await prepareTextExtras(tab.path!)
    await loadFileContent(tab.path!)
}

/**
 * 文本类渲染前的额外准备：HTML 走 iframe（后端 Set-Cookie 鉴权，相对资源可用）、
 * SVG 渲染态走直出图片、Markdown 渲染态在 Electron 下需要工作目录绝对路径。
 */
async function prepareTextExtras(filePath: string): Promise<void> {
    if (isHtmlFile.value) {
        if (isElectron && window.location.protocol === 'file:') {
            await loadHtmlPreviewLocal(filePath)
        } else {
            htmlPreviewUrl.value = apiService.getWorkspaceHtmlPreviewUrl(props.sessionId!, filePath)
        }
    } else if (isSvgFile.value) {
        assetPreviewUrl.value = (await resolveAssetUrl(filePath)) ?? ''
    } else if (isMarkdownFile.value && isElectron && window.location.protocol === 'file:') {
        await ensureWorkspacePath()
    }
}

/**
 * 未知后缀探测：调后端嗅探文件头（sniff=1），据结果分流。
 * - 文本 → 按文本打开（无后缀的文本文件靠这一步救回，含 GBK 等非 UTF-8 编码）；
 * - 二进制但嗅出真实格式（png/pdf/mp4…）→ 落到对应预览形态；
 * - 其余二进制 → 兜底 UI，提示"二进制文件，不支持预览"。
 *
 * 探测响应本身就带内容，文本分支直接复用，不再发第二次内容请求。
 */
async function probeUnknownFile(filePath: string): Promise<void> {
    if (!props.sessionId) return
    const generation = ++loadGeneration
    const sessionId = props.sessionId
    previewLoading.value = true
    previewError.value = ''
    fileNotFound.value = false
    binaryNotPreviewable.value = false

    try {
        const response = await apiService.getWorkspaceFile(sessionId, filePath, { sniff: true })
        // 会话已切换（或又发起了新的加载）：丢弃迟到响应
        if (!isCurrentLoad(generation, sessionId)) return

        // 回填嗅探出的真实后缀：图标、预览/源码切换按钮都按它判断
        if (response.detectedExtension) {
            selectedFile.value!.extension = response.detectedExtension
        }

        if (!response.isBinary) {
            previewType.value = 'text'
            applyTextContent(response.content, response.mimeType)
            await prepareTextExtras(filePath)
            return
        }

        const detectedKind = response.detectedExtension
            ? getPreviewKind(response.detectedExtension)
            : 'unsupported'
        if (detectedKind === 'image' || detectedKind === 'audio' || detectedKind === 'video' || detectedKind === 'pdf') {
            previewType.value = detectedKind
            assetPreviewUrl.value = (await resolveAssetUrl(filePath)) ?? ''
            return
        }

        previewType.value = 'unsupported'
        binaryNotPreviewable.value = true
    } catch (error) {
        if (!isCurrentLoad(generation, sessionId)) return
        const status = getApiErrorStatus(error)
        const msg = getErrorMessage(error)
        if (status === 404 || msg.includes('not found') || msg.includes('does not exist') || msg.includes('ENOENT')) {
            fileNotFound.value = true
        } else if (msg.includes('File too large') || msg.includes('too large')) {
            previewError.value = t('chat.workspace.fileTooLarge')
        } else {
            previewError.value = t('chat.workspace.loadFileFailed')
        }
        console.error('Failed to probe file:', error)
    } finally {
        // 只清理本次加载的 loading：有更新的加载时保持它的状态；
        // 会话已切走但还没发起新加载时也应收起 spinner
        if (generation === loadGeneration) previewLoading.value = false
    }
}

/** 把已取回的内容写入面板状态（探测分支复用，避免重复请求） */
function applyTextContent(content: string, mimeType: string): void {
    fileContentHash.value = hashString(content)
    selectedFile.value!.content = content
    selectedFile.value!.mimeType = mimeType
    fileContent.value = content
}

/** 只重建直出 URL（不发内容请求）：外部文件变更、手动刷新时用 */
async function refreshAssetUrl(): Promise<void> {
    if (!props.tab.path) return
    const url = await resolveAssetUrl(props.tab.path)
    if (url) assetPreviewUrl.value = url
}

async function loadFileContent(filePath: string, force = false, skipLoading = false): Promise<void> {
    if (!props.sessionId) return
    const generation = ++loadGeneration
    const sessionId = props.sessionId

    if (!skipLoading) {
        previewLoading.value = true
    }
    previewError.value = ''
    fileNotFound.value = false

    try {
        // 后缀不可信时继续让后端嗅探：否则刷新后 GBK 等非 UTF-8 文本会按 UTF-8 解出乱码
        const sniff = getPreviewKind(currentExtension.value) === 'unknown'
        const response = await apiService.getWorkspaceFile(sessionId, filePath, { sniff })
        // 会话已切换（或又发起了新的加载）：丢弃迟到响应
        if (!isCurrentLoad(generation, sessionId)) return

        const newHash = hashString(response.content)

        if (!force && fileContentHash.value && newHash === fileContentHash.value) {
            previewLoading.value = false
            return
        }

        applyTextContent(response.content, response.mimeType)
        // 不回写空后缀：探测回填的真实后缀（如无后缀的 .md）不能被覆盖掉
        if (response.extension) selectedFile.value!.extension = response.extension

        if (isHtmlFile.value && renderMode.value === 'rendered') {
            htmlPreviewVersion.value++
        }
    } catch (error) {
        if (!isCurrentLoad(generation, sessionId)) return
        const status = getApiErrorStatus(error)
        const msg = getErrorMessage(error)
        if (status === 404 || msg.includes('not found') || msg.includes('does not exist') || msg.includes('ENOENT')) {
            fileNotFound.value = true
        } else if (msg.includes('File too large') || msg.includes('too large')) {
            previewError.value = t('chat.workspace.fileTooLarge')
        } else {
            previewError.value = t('chat.workspace.loadFileFailed')
        }
        console.error('Failed to load file:', error)
    } finally {
        // 只清理本次加载的 loading：有更新的加载时保持它的状态；
        // 会话已切走但还没发起新加载时也应收起 spinner
        if (generation === loadGeneration) previewLoading.value = false
    }
}

async function loadHtmlPreviewLocal(filePath: string): Promise<void> {
    const wsPath = await ensureWorkspacePath()
    if (!wsPath) {
        previewError.value = t('chat.workspace.workspacePathError')
        return
    }
    htmlPreviewUrl.value = toLocalFileUrl(joinWorkspacePath(wsPath, filePath))
}

// ── 操作方法 ──

function handleManualRefresh(): void {
    if (!selectedFile.value) return
    // 有未保存编辑：先标记冲突，不覆盖用户内容（与外部变更路径一致）
    if (saveStatus.value === 'unsaved') {
        externalConflict.value = true
        return
    }
    if (isAssetPreview.value) {
        localRefreshCount.value++ // URL 变了元素才会重新请求
        void refreshAssetUrl()
        return
    }
    loadFileContent(selectedFile.value.path, true, false)
}

// 保存文件（Ctrl+S 触发）
async function handleSaveFile(content: string): Promise<void> {
    if (!selectedFile.value || !props.sessionId) return
    const filePath = selectedFile.value.path
    saveStatus.value = 'saving'
    try {
        await apiService.saveWorkspaceFile(props.sessionId, filePath, content)
        saveStatus.value = 'saved'
        externalConflict.value = false
        ElMessage.success(t('chat.workspace.saveSuccess'))
    } catch (e) {
        saveStatus.value = 'unsaved'
        ElMessage.error(getErrorMessage(e) || t('chat.workspace.saveFailed'))
    }
}

// 冲突处理：覆盖本地（放弃编辑，重新加载外部内容）
async function handleConflictReload(): Promise<void> {
    if (!selectedFile.value) return
    externalConflict.value = false
    saveStatus.value = 'saved'
    await loadFileContent(selectedFile.value.path, true, false)
}

// 冲突处理：覆盖外部（保存当前编辑）
async function handleConflictSave(): Promise<void> {
    externalConflict.value = false
    await handleSaveFile(editContent.value)
}

function onImageError(event: Event | string): void {
    const src = (typeof event === 'object' && (event as Event).target instanceof HTMLImageElement)
        ? (event.target as HTMLImageElement).getAttribute('src')
        : assetPreviewUrl.value
    console.error('[FilePreviewPanel] Image load failed, URL:', src)
    // 失败原因无法从 error 事件读出（解码不了 / 后端拒绝 / 文件已删），统一按"加载失败"提示；
    // 旧实现在 Web 下把任何失败都错报成"文件过大"
    previewError.value = t('chat.workspace.imageLoadFailed')
}

function onMediaError(): void {
    // 浏览器解不了该容器/编码，或后端拒绝（超上限等），统一提示
    previewError.value = t('chat.workspace.mediaPlaybackFailed')
}

/** 相对路径 → 工作区绝对路径（复制路径 / 在文件管理器中打开需要）；失败返回 null 并提示 */
async function resolveAbsolutePath(relativePath: string): Promise<string | null> {
    if (!props.sessionId) return null
    const wsPath = await treeStore.ensureWorkspacePath(props.sessionId)
    if (!wsPath) {
        ElMessage.error(t('chat.workspace.workspacePathError'))
        return null
    }
    const rel = relativePath.replace(/\\/g, '/')
    const separator = wsPath.endsWith('/') || wsPath.endsWith('\\') || rel.startsWith('/') ? '' : '/'
    return wsPath + separator + rel
}

/** 复制当前文件的绝对路径 */
async function handleCopyFilePath(): Promise<void> {
    if (!selectedFile.value) return
    const fullPath = await resolveAbsolutePath(selectedFile.value.path)
    if (!fullPath) return
    const ok = await writeTextToClipboard(fullPath)
    if (ok) ElMessage.success(t('chat.workspace.pathCopied'))
    else ElMessage.error(t('chat.workspace.copyFailed'))
}

/** 在系统文件管理器中打开并选中当前文件（Windows 资源管理器 / macOS 访达） */
async function handleOpenInFileManager(): Promise<void> {
    if (!selectedFile.value || !isElectron) return
    const fullPath = await resolveAbsolutePath(selectedFile.value.path)
    if (!fullPath) return
    try {
        await window.electronAPI!.showItemInFolder(fullPath)
    } catch (error) {
        console.error('[FilePreviewPanel] Open in file manager failed:', error)
        ElMessage.error(t('chat.workspace.openFailed'))
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
    } else if (data.type === 'md-preview-dismiss-menu') {
        // iframe 内的点击/滚动不会冒泡到父页面，需由此显式关闭菜单
        contextMenuVisible.value = false
    }
}

// ── 选区提取 + Snip 构建 ──

const MAX_SNIPPET_CONTENT = 2000
const SNIPPET_HEAD = 800

/** UTF-8 安全的 base64 编码 */
function encodeBase64(text: string): string {
    return btoa(unescape(encodeURIComponent(text)))
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
            label: t('chat.workspace.addSelectionToSession'),
            icon: DocumentCopy,
            onClick: () => {
                const snip = buildSnipData(selectedText, startLine, endLine)
                if (snip) emit('insert-snip', snip)
            },
        })
        items.push({
            label: t('chat.workspace.addFileToSession'),
            icon: Plus,
            divider: true,
            onClick: () => {
                if (selectedFile.value) emit('insert-to-input', selectedFile.value.path)
            },
        })
    } else {
        items.push({
            label: t('chat.workspace.addFileToSession'),
            icon: Plus,
            onClick: () => {
                if (selectedFile.value) emit('insert-to-input', selectedFile.value.path)
            },
        })
    }

    // 文件系统操作（与上面的"会话"操作分组）；空标签页没有文件，不展示
    if (selectedFile.value) {
        items.push({
            label: t('chat.workspace.copyPath'),
            icon: CopyDocument,
            divider: true,
            onClick: handleCopyFilePath,
        })
        if (isElectron) {
            items.push({
                label: t(isMac ? 'chat.workspace.openInFinder' : 'chat.workspace.openInExplorerShort'),
                icon: isMac ? Finder : WindowsExplorer,
                onClick: handleOpenInFileManager,
            })
        }
    }

    contextMenuItems.value = items
    contextMenuX.value = x
    contextMenuY.value = y
    contextMenuVisible.value = true
}

/** 右键事件处理（编辑器区域；md/html iframe 内的右键由 postMessage 触发，不走这里） */
function handleContextMenu(event: MouseEvent) {
    // 编辑器选区优先：CodeMirror 自己管理选区，window.getSelection() 拿不到
    const info = editorRef.value?.getSelectionInfo()
    if (info && info.text.trim()) {
        showContextMenu(event.clientX, event.clientY, info.text, info.startLine, info.endLine)
        return
    }

    // 非编辑器区域（如 SVG 渲染态）仍支持"添加文件到会话"
    const selectedText = window.getSelection()?.toString() || ''
    showContextMenu(event.clientX, event.clientY, selectedText.trim() ? selectedText : '')
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
    if (!active) {
        // 非激活面板只是 CSS 隐藏、DOM 仍在：视频/音频不暂停会继续出声
        mediaElRef.value?.pause()
        return
    }

    if (!hasLoaded.value) {
        hasLoaded.value = true
        await loadFilePreview()
    } else if (isStale.value) {
        isStale.value = false
        if (isAssetPreview.value) await refreshAssetUrl()
        else await loadFileContent(props.tab.path!, false, true)
    }
})

watch(() => props.contentVersion, (newVer, oldVer) => {
    // 注意不能用 oldVer === 0 当作「无需处理」：面板打开时该路径往往还没有变更记录（版本 0），
    // 此后第一次外部修改就是 0 → 1，丢弃它会让首个变更永远不刷新。是否已加载才是正确判据。
    const action = decidePreviewRefresh({
        hasLoaded: hasLoaded.value,
        newVersion: newVer,
        oldVersion: oldVer,
        saveStatus: saveStatus.value,
        isActive: props.isActive,
    })
    if (action === 'ignore') return
    if (action === 'conflict') {
        // 用户有未保存编辑 + 外部文件变化 → 冲突标记，不覆盖编辑内容
        externalConflict.value = true
        return
    }
    if (action === 'stale') {
        isStale.value = true
        return
    }
    // 直出资源（图片/音视频/pdf/SVG 渲染态）没有内容接口，只能重建 URL 让元素重新请求；
    // 文本类走内容接口并跳过 loading，避免每次外部写入都闪一下转圈
    if (isAssetPreview.value) void refreshAssetUrl()
    else loadFileContent(props.tab.path!, false, true)
})

// tab.path 变化（空占位标签选中文件 / 在当前标签页切换其他文件）：
// 原地更新路径时不重建组件，需手动触发重新加载预览
watch(() => props.tab.path, (newPath, oldPath) => {
    if (newPath === oldPath) return
    if (props.isActive) {
        hasLoaded.value = true
        loadFilePreview()
    } else {
        isStale.value = true
    }
})
</script>

<style>
/* 行号高亮布局：供 highlightCode() 的输出使用（chat 的消息代码块、diff 面板等同样依赖，
   故这里是全应用唯一定义处，不能随本面板的只读视图一起删除） */
.code-lines {
    display: flex;
    flex-direction: column;
    /* 与编辑模式（CodeMirror 14px）统一 */
    font-size: 14px;
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
    background: var(--gd-color-bg, #fff);
}

.dark .line-num {
    color: #4b5563;
    border-right-color: #374151;
    background: var(--gd-color-bg, #222);
}

.line-content {
    white-space: pre-wrap;
    word-break: break-all;
    padding-left: 1em;
    min-width: 800px;
}
</style>

<style scoped>
.conflict-banner {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 12px;
    background: var(--gd-color-danger-bg, #fef0f0);
    border-bottom: 1px solid var(--gd-color-danger-border, #fde2e2);
    flex-shrink: 0;
}
.conflict-banner-text {
    flex: 1;
    font-size: 12px;
    color: var(--gd-color-danger, #f56c6c);
}
.conflict-banner-btn {
    padding: 3px 10px;
    font-size: 12px;
    border-radius: 4px;
    border: 1px solid var(--gd-color-border, #dcdfe6);
    background: var(--gd-color-surface, #fff);
    color: var(--gd-color-text, #333);
    cursor: pointer;
    white-space: nowrap;
}
.conflict-banner-btn:hover {
    border-color: var(--gd-color-primary, #409eff);
    color: var(--gd-color-primary, #409eff);
}
.conflict-banner-btn.primary {
    background: var(--gd-color-primary, #409eff);
    border-color: var(--gd-color-primary, #409eff);
    color: #fff;
}
.conflict-banner-btn.primary:hover {
    opacity: 0.85;
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
    color: var(--gd-color-text-gray);
    transition: background 0.15s ease, color 0.15s ease;
    outline: none;
}

.preview-mode-btn:hover {
    background: var(--gd-color-sidebar-bg-hover);
}

.preview-mode-btn.is-active {
    color: var(--gd-color-text);
    background: var(--gd-color-bg);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}

/* 头部工具按钮（与 GitChangesPanel 的 .git-tool-btn 同款：26px 方形圆角图标按钮） */
.preview-tool-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--gd-color-text-gray);
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.15s ease, color 0.15s ease;
}

.preview-tool-btn:hover:not(:disabled) {
    background: var(--gd-color-sidebar-bg-hover);
    color: var(--gd-color-text);
}

.preview-tool-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

/* 开关型按钮的开启态（目录树显隐开关） */
.preview-tool-btn--active {
    color: var(--gd-color-text);
    background: var(--gd-color-sidebar-bg-active);
}
</style>
