<!-- KnowledgeBasePage/FileChunksViewer.vue -->
<template>
    <GdDialog v-model="showModal" :title="dialogTitle" width="min(92vw, 1500px)"
        :close-on-click-modal="true" @close="handleClose">
        <!-- flex 外壳：Tab 栏固定，内容区自适应填满弹窗剩余高度（弹窗本体上限 85vh，
             定高 calc 会溢出产生双滚动，所以内容一律 flex-1 自伸缩） -->
        <div class="preview-shell">
            <!-- 双 Tab：默认原文预览，分块是调参核对效果的第二入口（胶囊分段切换，同插件页二级视图） -->
            <div class="flex items-center mb-3 flex-shrink-0">
                <PluginViewSwitch v-model="activeTab" :items="tabItems" />
            </div>

            <!-- ══ 原文预览 Tab ══ -->
            <div v-show="activeTab === 'original'" class="original-pane">
                <div v-if="originalLoading" class="loading-container text-center py-8">
                    <ArrowSync16Regular class="text-2xl text-gray-400 dark:text-[#6b6d75] size-4 animate-spin mx-auto" />
                    <p class="mt-2 text-gray-500 dark:text-[#8b8d95]">{{ t('knowledge.chunks.loading') }}</p>
                </div>
                <div v-else-if="originalError" class="text-center py-8">
                    <Document24Regular class="text-2xl text-gray-400 dark:text-[#6b6d75] size-4 mx-auto" />
                    <p class="mt-2 text-gray-500 dark:text-[#8b8d95]">{{ originalError }}</p>
                </div>

                <!-- PDF：Chromium 内置 PDF Viewer（iframe 指向 raw 端点，sendFile 自带 Range） -->
                <iframe v-else-if="previewKind === 'pdf' && rawUrl" :src="rawUrl"
                    class="w-full border-0 rounded-lg bg-gray-100 dark:bg-[#2a2c30] h-full"
                    :title="selectedFile?.displayName" />

                <!-- 位图 -->
                <div v-else-if="previewKind === 'image' && rawUrl"
                    class="h-full overflow-auto text-center flex items-center justify-center">
                    <img :src="rawUrl" class="max-w-full max-h-full mx-auto rounded-lg object-contain"
                        :alt="selectedFile?.displayName" @error="onImageError" />
                </div>

                <!-- Markdown 原文：完整格式渲染 -->
                <div v-else-if="previewKind === 'markdown'" class="original-scroll surface-box">
                    <MarkdownContent :content="originalText" />
                </div>

                <!-- 文本/代码原文：等宽 pre-wrap -->
                <div v-else-if="previewKind === 'text'" class="original-scroll surface-box">
                    <div class="chunk-content text-sm text-gray-800 dark:text-[#e8e9ed]">{{ originalText }}</div>
                </div>

                <!-- docx/xlsx/其余：回退去重叠解析文本 -->
                <template v-else-if="previewKind === 'fallback'">
                    <div
                        class="mb-2 px-2 py-1.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded text-xs text-amber-700 dark:text-amber-400 flex items-center gap-1.5 flex-shrink-0">
                        <span>⚠</span>
                        <span>{{ t('knowledge.chunks.fallbackNotice') }}</span>
                    </div>
                    <div v-if="previewText && isMarkdownLikeText" class="original-scroll surface-box">
                        <MarkdownContent :content="previewText" />
                    </div>
                    <div v-else-if="previewText" class="original-scroll surface-box">
                        <div class="chunk-content text-sm text-gray-800 dark:text-[#e8e9ed]">{{ previewText }}</div>
                    </div>
                </template>
            </div>

            <!-- ══ 分块 Tab ══ -->
            <div v-show="activeTab === 'chunks'" class="chunks-pane">
                <div class="chunks-scroll">
                    <div v-if="chunkStrategyOutdated"
                        class="mb-3 px-2 py-1.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded text-xs text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                        <span>⚠</span>
                        <span>{{ t('knowledge.file.outdatedChunkStrategy') }}</span>
                    </div>
                    <div v-if="chunksLoading" class="loading-container text-center py-8">
                        <ArrowSync16Regular class="text-2xl text-gray-400 dark:text-[#6b6d75] size-4 animate-spin mx-auto" />
                        <p class="mt-2 text-gray-500 dark:text-[#8b8d95]">{{ t('knowledge.chunks.loading') }}</p>
                    </div>
                    <div v-else-if="chunks.length === 0" class="no-chunks-container text-center py-8">
                        <Document24Regular class="text-2xl text-gray-400 dark:text-[#6b6d75] size-4 mx-auto" />
                        <p class="mt-2 text-gray-500 dark:text-[#8b8d95]">{{ t('knowledge.chunks.empty') }}</p>
                    </div>
                    <div v-else class="chunks-container">
                        <div v-for="(chunk, index) in chunks" :key="chunk.id"
                            class="chunk-item mb-4 p-4 bg-gray-50 dark:bg-[#2a2c30] rounded-lg border border-gray-200 dark:border-[#2e3035]">
                            <div class="chunk-header flex justify-between items-center mb-2">
                                <span class="chunk-index text-sm font-mono text-gray-500 dark:text-[#8b8d95]">
                                    #{{ (currentPage - 1) * pageSize + index + 1 }}
                                </span>
                                <div class="flex items-center gap-2">
                                    <span class="chunk-meta text-xs text-gray-400 dark:text-[#6b6d75]">
                                        {{ t('knowledge.chunks.index') }}: {{ chunk.chunkIndex }}, {{ t('knowledge.chunks.tokenCount') }}: {{ chunk.tokenCount }}
                                    </span>
                                    <button type="button" class="copy-btn" :title="t('knowledge.chunks.copy')"
                                        @click="copyChunk(chunk.content)">
                                        <Copy20Regular class="size-3.5" />
                                    </button>
                                </div>
                            </div>
                            <div class="chunk-content text-sm text-gray-800 dark:text-[#e8e9ed] whitespace-pre-wrap font-mono">
                                {{ chunk.content }}
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 分页控件：固定在内容区底部，不随滚动 -->
                <div v-if="chunks.length > 0" class="flex justify-between items-center pt-2 flex-shrink-0">
                    <div class="text-sm text-gray-500 dark:text-[#8b8d95]">
                        {{ t('knowledge.chunks.pagination', { total: totalChunks, start: Math.min(totalChunks, (currentPage - 1) * pageSize + 1), end: Math.min(totalChunks, currentPage * pageSize) }) }}
                    </div>
                    <GdPagination v-model="currentPage" :page-size="pageSize" :total="totalChunks"
                        hide-on-single-page @change="handlePageChange" />
                </div>
            </div>
        </div>
    </GdDialog>
</template>

<script setup lang="ts">
import { getErrorMessage } from '@/utils/errorMessage'
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowSync16Regular, Document24Regular, Copy20Regular } from '@vicons/fluent'
import type { KBFile } from '@/stores/knowledgeBase'
import type { KBChunk } from '@/services/modules/knowledge-base.api'
import { useKnowledgeBaseStore } from '@/stores/knowledgeBase'
import { toast } from '@/components/ui/toastService';
import { writeTextToClipboard } from '@/utils/clipboard'
import { apiService } from '@/services/ApiService'
import GdDialog from '@/components/ui/GdDialog.vue'
import GdPagination from '@/components/ui/GdPagination.vue'
import MarkdownContent from '@/components/ui/MarkdownContent.vue'
import PluginViewSwitch from '@/components/plugins/PluginViewSwitch.vue'

interface Props {
    modelValue: boolean
    selectedFile: KBFile | null
    /** 打开时默认停留的 Tab（检索结果点击直达分块定位） */
    initialTab?: 'original' | 'chunks'
    /** 直达的目标 chunkIndex（按 chunkIndex 而非页码传，组件内部换算页） */
    initialChunkIndex?: number | null
}

const props = defineProps<Props>()
const emit = defineEmits<{
    'update:modelValue': [value: boolean]
}>()

const store = useKnowledgeBaseStore()
const { t } = useI18n()

// ── 状态 ──
const showModal = ref(false)
const activeTab = ref<'original' | 'chunks'>('original')

// 原文预览
type PreviewKind = 'pdf' | 'image' | 'markdown' | 'text' | 'fallback' | 'none'
const previewKind = ref<PreviewKind>('none')
const rawUrl = ref('')
const originalText = ref('')
const previewText = ref('')
const originalLoading = ref(false)
const originalError = ref('')

// 分块
const chunks = ref<KBChunk[]>([])
const chunksLoading = ref(false)
const totalChunks = ref(0)
const currentPage = ref(1)
const pageSize = ref(10)

const chunkStrategyOutdated = computed(() => props.selectedFile?.chunkStrategyOutdated === true)

const dialogTitle = computed(() => t('knowledge.chunks.title', { name: props.selectedFile?.displayName }))

/** 胶囊分段切换项（PluginViewSwitch 数据源） */
const tabItems = computed(() => [
    { value: 'original' as const, label: t('knowledge.chunks.tabOriginal') },
    { value: 'chunks' as const, label: t('knowledge.chunks.tabChunks') },
])

/** PluginViewSwitch v-model 直写 activeTab，这里负责懒加载数据 */
watch(activeTab, (tab, prev) => {
    if (tab === prev) return
    if (tab === 'chunks') {
        // 首次进分块 Tab 才拉数据
        if (chunks.value.length === 0) loadChunks()
    } else if (!rawUrl.value && !originalText.value && !previewText.value) {
        loadOriginal()
    }
})

/** 回退文本里 xlsx 由后端转成 Markdown 表格 → 走渲染；其余纯文本走 pre-wrap */
const isMarkdownLikeText = computed(() => {
    const ext = normalizeExt(props.selectedFile?.fileExtension)
    return ext === 'xlsx' || ext === 'xls'
})

// ── 预览类型分流（扩展名 → 展示形态） ──
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp'])
const MARKDOWN_EXTS = new Set(['md', 'markdown'])
// 浏览器可作文本直出的类型（docx/xlsx/pdf/image 走各自的分支，不在此列）
const TEXT_EXTS = new Set([
    'txt', 'log', 'json', 'xml', 'csv', 'yaml', 'yml', 'ini', 'conf', 'properties', 'toml',
    'env', 'cfg', 'config', 'reg', 'pem', 'tex', 'rst', 'adoc', 'org',
    'js', 'ts', 'jsx', 'tsx', 'css', 'html', 'htm', 'vue',
    'py', 'java', 'cpp', 'c', 'h', 'hpp', 'go', 'rs', 'php', 'rb', 'sql', 'sh', 'bat',
    'swift', 'kt', 'scala', 'dart', 'ex', 'r', 'jl', 'ps1', 'vbs',
    'proto', 'graphql', 'sol', 'diff', 'patch', 'lock', 'dts', 'dtsi', 'j2', 'ejs', 'hbs',
])

function normalizeExt(ext?: string | null): string {
    return (ext ?? '').replace(/^\./, '').trim().toLowerCase()
}

function resolvePreviewKind(file: KBFile | null): PreviewKind {
    const ext = normalizeExt(file?.fileExtension)
    if (!ext) return 'fallback'
    if (ext === 'pdf') return 'pdf'
    if (IMAGE_EXTS.has(ext)) return 'image'
    if (MARKDOWN_EXTS.has(ext)) return 'markdown'
    if (TEXT_EXTS.has(ext)) return 'text'
    return 'fallback'
}

// ── 外部 modelValue 同步 ──
watch(() => props.modelValue, (newValue) => {
    showModal.value = newValue
    if (newValue && props.selectedFile) {
        openPreview()
    }
})

watch(showModal, (newValue) => {
    emit('update:modelValue', newValue)
})

/**
 * 打开弹窗：按 initialTab 决定停留的 Tab，缺省原文预览。
 */
function openPreview() {
    const tab = props.initialTab ?? 'original'

    activeTab.value = tab
    if (tab === 'chunks') {
        // 检索命中直达：按 chunkIndex 换算页码后加载
        const target = props.initialChunkIndex
        currentPage.value = (target !== null && target !== undefined && target >= 0)
            ? Math.floor(target / pageSize.value) + 1
            : 1
        loadChunks()
    } else {
        currentPage.value = 1
        loadOriginal()
    }
}

// ── 原文预览加载 ──
async function loadOriginal() {
    const file = props.selectedFile
    if (!file || !store.activeKnowledgeBaseId) return

    previewKind.value = resolvePreviewKind(file)
    rawUrl.value = ''
    originalText.value = ''
    previewText.value = ''
    originalError.value = ''

    const kind = previewKind.value
    if (kind === 'none') return

    originalLoading.value = true
    try {
        if (kind === 'pdf' || kind === 'image') {
            rawUrl.value = apiService.getKBFileRawUrl(store.activeKnowledgeBaseId, file.id)
            // 加载失败由 iframe/img 的 error 事件兜底（onImageError）；iframe 的
            // 加载失败在 file: 页面下拿不到状态码，不做主动探测
        } else if (kind === 'markdown' || kind === 'text') {
            // 原文文本：fetch raw 端点（带 token 的 URL 同样可 fetch）
            const url = apiService.getKBFileRawUrl(store.activeKnowledgeBaseId, file.id)
            const resp = await fetch(url)
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
            originalText.value = await resp.text()
        } else {
            // fallback：去重叠解析全文
            const data = await apiService.getKBFilePreviewText(store.activeKnowledgeBaseId, file.id)
            previewText.value = data.text
            if (!data.text) originalError.value = t('knowledge.chunks.originalEmpty')
        }
    } catch (error) {
        console.error('加载原文预览失败:', error)
        originalError.value = getErrorMessage(error) || t('knowledge.chunks.originalLoadFailed')
    } finally {
        originalLoading.value = false
    }
}

function onImageError() {
    originalError.value = t('knowledge.chunks.imageLoadFailed')
    rawUrl.value = ''
}

// ── 分块加载 ──
async function loadChunks() {
    if (!props.selectedFile || !store.activeKnowledgeBaseId) {
        toast.error(t('knowledge.chunks.noFileSelected'))
        return
    }

    // 已完成或处理失败的文件均可查看分块内容
    if (props.selectedFile.processingStatus !== 'completed' && props.selectedFile.processingStatus !== 'failed') {
        toast.warning(t('knowledge.chunks.fileNotReady'))
        return
    }

    chunksLoading.value = true

    try {
        // 获取分块数据，计算正确的 skip 值 (currentPage 从 1 开始，所以要减 1)
        const skip = (currentPage.value - 1) * pageSize.value
        const data = await apiService.getKBFileChunks(
            store.activeKnowledgeBaseId,
            props.selectedFile.id,
            skip,
            pageSize.value
        )

        chunks.value = data

        // 使用文件记录中的totalChunks字段作为总分块数
        totalChunks.value = props.selectedFile.totalChunks || 0
    } catch (error) {
        console.error('获取文件分块失败:', error)
        toast.error(getErrorMessage(error) || t('knowledge.chunks.loadFailed'))
        chunks.value = []
        totalChunks.value = 0
    } finally {
        chunksLoading.value = false
    }
}

async function handlePageChange(page: number) {
    currentPage.value = page
    await loadChunks()
}

async function copyChunk(content: string) {
    const ok = await writeTextToClipboard(content)
    if (ok) toast.success(t('knowledge.chunks.copySuccess'))
    else toast.error(t('knowledge.chunks.copyFailed'))
}

function handleClose() {
    // 重置状态
    chunks.value = []
    totalChunks.value = 0
    currentPage.value = 1
    activeTab.value = 'original'
    previewKind.value = 'none'
    rawUrl.value = ''
    originalText.value = ''
    previewText.value = ''
    originalError.value = ''
}

// 暴露方法供父组件调用
defineExpose({
    loadChunks
})
</script>

<style scoped>
/* flex 外壳：GdDialog 的高度由内容撑起（body 高度 auto，max-height 85vh 只是上限），
   height:100% 在 auto 链上解析不出值，flex 链会塌陷成"扁弹窗"。
   所以直接给视口定高：85vh 弹窗上限 − header(~40px) − body 上下 padding(24px)
   − Tab 行(~44px)，留余量取 120px；min-height 兜底小窗口。 */
.preview-shell {
    display: flex;
    flex-direction: column;
    height: calc(85vh - 120px);
    min-height: 320px;
}

/* 原文滚动容器：Tab 固定在弹窗头部，内容区独立滚动 */
.original-pane {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
}

.chunks-pane {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
}

.chunks-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
}

.original-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
}

.surface-box {
    padding: 0.75rem 1rem;
    background-color: var(--gd-color-surface);
    border: 1px solid var(--gd-color-border);
    border-radius: 8px;
}

.chunk-item {
    border: 1px solid var(--gd-color-border);
    border-radius: 8px;
    transition: all 0.2s ease;
}

.chunk-item:hover {
    border-color: var(--gd-color-primary);
    box-shadow: 0 2px 8px var(--gd-dialog-shadow, 0 0 10px rgba(0, 0, 0, 0.1));
}

.chunk-header {
    border-bottom: 1px solid var(--gd-color-border);
    padding-bottom: 0.5rem;
}

.chunk-content {
    font-family: 'Monaco', 'Consolas', 'Courier New', monospace;
    line-height: 1.6;
    padding: 0.75rem;
    background-color: var(--gd-color-surface);
    border-radius: 4px;
    white-space: pre-wrap;
    word-break: break-word;
}

.copy-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    background: transparent;
    cursor: pointer;
    color: var(--gd-color-text-gray, #999);
    border-radius: 5px;
    transition: background 0.15s, color 0.15s;
    flex-shrink: 0;
    padding: 0;
}

.copy-btn:hover {
    background: var(--gd-color-surface-hover, rgba(0, 0, 0, 0.06));
    color: var(--gd-color-text);
}

.chunk-index {
    font-weight: bold;
    color: var(--gd-color-text-gray);
}

.chunk-meta {
    color: var(--gd-color-text-disabled);
}

.loading-container {
    min-height: 200px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
}

.no-chunks-container {
    min-height: 200px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
}
</style>
