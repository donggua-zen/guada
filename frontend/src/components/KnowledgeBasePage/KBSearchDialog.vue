<!-- KnowledgeBasePage/KBSearchDialog.vue -->
<template>
    <el-dialog v-model="dialogVisible" title="知识库搜索" width="700px" :close-on-click-modal="false"
        class="kb-search-dialog">
        <!-- 搜索输入区域 -->
        <div class="search-input-section mb-4">
            <el-form :model="searchForm" label-width="80px">
                <el-form-item label="知识库">
                    <el-select v-model="searchForm.kbId" placeholder="选择知识库" class="w-full" @change="handleKBChange">
                        <el-option v-for="kb in knowledgeBases" :key="kb.id" :label="kb.name" :value="kb.id" />
                    </el-select>
                </el-form-item>

                <el-form-item label="搜索内容">
                    <el-input v-model="searchForm.query" type="textarea" :rows="3" placeholder="输入要搜索的内容..."
                        @keyup.enter.ctrl="handleSearch" />
                </el-form-item>

                <el-form-item label="结果数量">
                    <el-slider v-model="searchForm.topK" :min="1" :max="20" :step="1" show-input />
                </el-form-item>
            </el-form>

            <!-- 搜索按钮 -->
            <div class="flex justify-end mt-4">
                <el-button type="primary" @click="handleSearch" :loading="isSearching" :disabled="!canSearch">
                    <el-icon class="mr-1">
                        <Search />
                    </el-icon>
                    搜索
                </el-button>
            </div>
        </div>

        <!-- 搜索结果区域 -->
        <div v-if="searchResults.length > 0 || isSearching" class="search-results-section">
            <div v-if="isSearching" class="loading-state text-center py-8">
                <el-icon class="animate-spin text-3xl text-gray-400">
                    <Loading />
                </el-icon>
                <p class="text-sm text-gray-500 mt-2">搜索中...</p>
            </div>

            <div v-else class="results-list">
                <div
                    class="results-header flex justify-between items-center mb-3 pb-2 border-b border-gray-200 dark:border-gray-700">
                    <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
                        找到 {{ searchResults.length }} 条结果
                    </span>
                    <el-button size="small" link @click="clearResults">
                        清空结果
                    </el-button>
                </div>

                <div class="results-content max-h-100 overflow-y-auto">
                    <div v-for="(result, index) in searchResults" :key="index"
                        class="result-item p-3 mb-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-blue-400 dark:hover:border-blue-500 transition-all cursor-pointer"
                        @click="handleResultClick(result)">
                        <!-- 分数信息 -->
                        <div class="flex items-center justify-between mb-2">
                            <div class="flex items-center gap-1.5 flex-wrap">
                                <!-- 混合搜索模式：显示三个分数 -->
                                <template v-if="hasHybridScores(result)">
                                    <el-tag size="small" type="primary" effect="plain">
                                        <span class="text-xs">语义</span>
                                        <span class="ml-1 font-medium">{{ (result.semanticScore || 0).toFixed(2) }}</span>
                                    </el-tag>
                                    <el-tag size="small" type="success" effect="plain">
                                        <span class="text-xs">关键词</span>
                                        <span class="ml-1 font-medium">{{ (result.keywordScore || 0).toFixed(2) }}</span>
                                    </el-tag>
                                    <el-tag size="small" type="warning">
                                        <span class="text-xs">综合</span>
                                        <span class="ml-1 font-bold">{{ (result.finalScore || 0).toFixed(2) }}</span>
                                    </el-tag>
                                </template>
                                <!-- 纯语义搜索模式：显示相似度 -->
                                <template v-else>
                                    <el-tag size="small" type="success">
                                        相似度: {{ ((result.similarity || 0) * 100).toFixed(1) }}%
                                    </el-tag>
                                </template>
                            </div>
                            <span class="text-xs text-gray-400">#{{ index + 1 }}</span>
                        </div>

                        <!-- 来源文件 -->
                        <div v-if="result.fileName || result.metadata?.fileId" class="mb-2">
                            <el-tag size="small" type="info">
                                {{ result.fileName || '未知文件' }}
                            </el-tag>
                        </div>

                        <!-- 内容预览 -->
                        <div class="content-preview text-sm text-gray-700 dark:text-gray-300 line-clamp-3"
                            v-html="highlightText(result.content, searchForm.query)">
                        </div>

                        <!-- 元数据信息 -->
                        <div v-if="result.metadata" class="mt-2 text-xs text-gray-400">
                            <span v-if="result.metadata.chunk_index">分块 #{{ result.metadata.chunk_index }}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- 空状态 -->
        <div v-else-if="hasSearched" class="empty-state text-center py-12">
            <el-icon size="48" class="text-gray-300 mb-3">
                <Search />
            </el-icon>
            <p class="text-sm text-gray-500">未找到相关结果</p>
            <p class="text-xs text-gray-400 mt-1">尝试调整搜索关键词或选择其他知识库</p>
        </div>

        <!-- 初始状态 -->
        <div v-else class="initial-state text-center py-12">
            <el-icon size="48" class="text-gray-300 mb-3">
                <Search />
            </el-icon>
            <p class="text-sm text-gray-500">输入关键词开始搜索</p>
            <p class="text-xs text-gray-400 mt-1">支持语义搜索和关键词匹配</p>
        </div>

        <template #footer>
            <div class="flex justify-end gap-2">
                <el-button @click="dialogVisible = false">关闭</el-button>
            </div>
        </template>
    </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Search, Loading, Document } from '@element-plus/icons-vue'
import type { KnowledgeBase } from '@/stores/knowledgeBase'
import { usePopup } from '@/composables/usePopup'

interface SearchResult {
    content: string
    metadata: Record<string, any>
    similarity?: number  // 旧版字段，兼容纯语义搜索
    semanticScore?: number  // 语义分数
    keywordScore?: number   // 关键词分数
    finalScore?: number     // 综合分数
    fileName?: string
}

interface Props {
    modelValue: boolean
    knowledgeBases: KnowledgeBase[]
    defaultKbId?: string | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
    'update:modelValue': [value: boolean]
    resultClick: [result: SearchResult]
}>()

const { toast } = usePopup()

// 对话框可见性
const dialogVisible = computed({
    get: () => props.modelValue,
    set: (value) => emit('update:modelValue', value)
})

// 搜索表单
const searchForm = ref({
    kbId: props.defaultKbId || '',
    query: '',
    topK: 10
})

// 搜索状态
const isSearching = ref(false)
const hasSearched = ref(false)
const searchResults = ref<SearchResult[]>([])

/**
 * 是否可以执行搜索
 */
const canSearch = computed(() => {
    return searchForm.value.kbId && searchForm.value.query.trim().length > 0
})

/**
 * 处理知识库变化
 */
function handleKBChange() {
    // 清空之前的搜索结果
    clearResults()
}

/**
 * 执行搜索
 */
async function handleSearch() {
    if (!canSearch.value) {
        toast.warning('请选择知识库并输入搜索内容')
        return
    }

    isSearching.value = true
    hasSearched.value = false
    searchResults.value = []

    try {
        const { apiService } = await import('@/services/ApiService')

        const response = await apiService.searchKnowledgeBase(
            searchForm.value.kbId,
            searchForm.value.query.trim(),
            searchForm.value.topK
        )

        searchResults.value = response.results || []
        hasSearched.value = true

        if (searchResults.value.length === 0) {
            toast.info('未找到相关结果')
        } else {
            toast.success(`找到 ${searchResults.value.length} 条结果`)
        }
    } catch (error: any) {
        console.error('搜索失败:', error)
        toast.error(error.response?.data?.detail || '搜索失败')
    } finally {
        isSearching.value = false
    }
}

/**
 * 清空搜索结果
 */
function clearResults() {
    searchResults.value = []
    hasSearched.value = false
}

/**
 * 高亮显示匹配文本
 */
function highlightText(text: string, query: string): string {
    if (!query || !text) return text

    try {
        // 先转义 HTML 特殊字符，防止 XSS
        const escapeHtml = (str: string) => {
            return str
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;')
        }

        // 转义原始文本
        const escapedText = escapeHtml(text)

        // 简单的关键词高亮（不区分大小写）
        const keywords = query.trim().split(/\s+/).filter(k => k.length > 0)
        let highlighted = escapedText

        keywords.forEach(keyword => {
            // 转义关键词中的特殊字符
            const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            const regex = new RegExp(`(${escapedKeyword})`, 'gi')
            highlighted = highlighted.replace(
                regex,
                '<mark class="bg-yellow-200 dark:bg-yellow-700 px-0.5 rounded">$1</mark>'
            )
        })

        return highlighted
    } catch (e) {
        console.error('高亮处理失败:', e)
        // 如果正则表达式失败，返回转义后的原文本
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
    }
}

/**
 * 判断是否有混合搜索分数
 */
function hasHybridScores(result: SearchResult): boolean {
    return result.semanticScore !== undefined && 
           result.keywordScore !== undefined && 
           result.finalScore !== undefined
}

/**
 * 处理结果点击
 */
function handleResultClick(result: SearchResult) {
    emit('resultClick', result)
}

/**
 * 监听对话框打开，重置状态
 */
watch(dialogVisible, (visible) => {
    if (visible) {
        // 设置默认知识库
        if (!searchForm.value.kbId && props.defaultKbId) {
            searchForm.value.kbId = props.defaultKbId
        }
    } else {
        // 关闭时清空
        clearResults()
        searchForm.value.query = ''
    }
})
</script>

<style scoped>
.kb-search-dialog :deep(.el-dialog__body) {
    padding: 20px;
}

/* 滚动条美化 */
.results-content::-webkit-scrollbar {
    width: 6px;
}

.results-content::-webkit-scrollbar-track {
    background: transparent;
}

.results-content::-webkit-scrollbar-thumb {
    background-color: rgba(156, 163, 175, 0.5);
    border-radius: 3px;
}

.results-content::-webkit-scrollbar-thumb:hover {
    background-color: rgba(156, 163, 175, 0.7);
}

/* 高亮样式 */
:deep(mark) {
    padding: 0 2px;
    border-radius: 2px;
}

/* 暗黑模式适配 */
.dark .results-content::-webkit-scrollbar-thumb {
    background-color: rgba(75, 85, 99, 0.5);
}

.dark .results-content::-webkit-scrollbar-thumb:hover {
    background-color: rgba(75, 85, 99, 0.7);
}
</style>
