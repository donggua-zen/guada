# 前端集成指南 - 知识库工具提供者

本文档介绍如何在前端项目中集成和使用知识库工具提供者。

## 📋 目录

1. [概述](#概述)
2. [TypeScript 类型定义](#typescript-类型定义)
3. [API 服务封装](#api-服务封装)
4. [Vue Composable 封装](#vue-composable-封装)
5. [组件示例](#组件示例)
6. [状态管理集成](#状态管理集成)
7. [最佳实践](#最佳实践)

---

## 概述

### 架构设计

```
┌─────────────────┐
│   Vue 组件      │
└────────┬────────┘
         │
┌────────▼────────┐
│  Composable     │ useKnowledgeBase()
└────────┬────────┘
         │
┌────────▼────────┐
│  ApiService     │ callTool()
└────────┬────────┘
         │
┌────────▼────────┐
│  后端 API       │ knowledge_base__xxx
└─────────────────┘
```

---

## TypeScript 类型定义

### 1. 添加到 `src/types/api.ts`

在现有的 `ApiResponses` 接口中添加知识库工具相关类型：

```typescript
// 知识库工具调用参数
export interface KBSearchToolParams {
    knowledge_base_id: string
    query: string
    file_id?: string
    top_k: number
}

export interface KBListFilesToolParams {
    knowledge_base_id: string
}

export interface KBGetChunksToolParams {
    knowledge_base_id: string
    file_id: string
    chunk_index: number
    limit: number
}

// 工具调用响应
export interface ToolCallResponse {
    tool_call_id: string
    role: string
    name: string
    content: string
    is_error: boolean
}

// 添加到 ApiResponses 接口
export interface ApiResponses {
    // ... 现有类型
    
    // 知识库工具调用
    callKBSearch: ToolCallResponse
    callKBListFiles: ToolCallResponse
    callKBGetChunks: ToolCallResponse
}
```

### 2. 创建工具类型文件 `src/types/knowledge-base.ts`

```typescript
/**
 * 知识库工具相关类型定义
 */

// 工具调用参数
export interface KBSearchParams {
    /** 知识库 ID */
    knowledge_base_id: string
    /** 搜索查询文本 */
    query: string
    /** 限制搜索的文件 ID（可选） */
    file_id?: string
    /** 返回结果数量（1-20） */
    top_k: number
}

export interface KBListFilesParams {
    /** 知识库 ID */
    knowledge_base_id: string
}

export interface KBGetChunksParams {
    /** 知识库 ID */
    knowledge_base_id: string
    /** 文件 ID */
    file_id: string
    /** 起始分块索引（从 0 开始） */
    chunk_index: number
    /** 获取数量（1-10） */
    limit: number
}

// 搜索结果解析
export interface ParsedSearchResult {
    /** 文件名 */
    fileName: string
    /** 相似度分数 */
    similarity: string
    /** 分块内容 */
    content: string
    /** 元数据 */
    metadata?: Record<string, any>
}

// 文件信息
export interface KBFileInfo {
    /** 文件 ID */
    id: string
    /** 显示名称 */
    name: string
    /** 文件大小（字节） */
    size: number
    /** 文件类型 */
    type: string
    /** 处理状态 */
    status: 'pending' | 'processing' | 'completed' | 'failed'
    /** 分块数量 */
    chunks: number
}

// 分块信息
export interface KBChunkInfo {
    /** 分块索引 */
    index: number
    /** Token 数量 */
    tokenCount: number
    /** 内容 */
    content: string
}
```

---

## API 服务封装

### 在 `src/services/api.ts` 中添加方法

```typescript
import type { 
    KBSearchParams, 
    KBListFilesParams, 
    KBGetChunksParams,
    ToolCallResponse 
} from '@/types/knowledge-base'

export class ApiService {
    // ... 现有方法
    
    /**
     * 调用知识库工具
     */
    private async callKBTool<T extends ToolCallResponse>(
        toolName: string,
        arguments: Record<string, any>
    ): Promise<T> {
        return this.callTool(toolName, arguments)
    }
    
    /**
     * 知识库语义搜索
     */
    async searchKnowledgeBase(params: KBSearchParams): Promise<ToolCallResponse> {
        return this.callKBTool('knowledge_base__search', params)
    }
    
    /**
     * 获取知识库文件列表
     */
    async listKnowledgeBaseFiles(params: KBListFilesParams): Promise<ToolCallResponse> {
        return this.callKBTool('knowledge_base__list_files', params)
    }
    
    /**
     * 获取文件分块详情
     */
    async getKnowledgeBaseChunks(params: KBGetChunksParams): Promise<ToolCallResponse> {
        return this.callKBTool('knowledge_base__get_chunks', params)
    }
}
```

---

## Vue Composable 封装

### 创建 `src/composables/useKnowledgeBase.ts`

```typescript
import { ref, computed } from 'vue'
import { apiService } from '@/services/api'
import type { 
    KBSearchParams, 
    KBListFilesParams, 
    KBGetChunksParams,
    ParsedSearchResult,
    KBFileInfo,
    KBChunkInfo
} from '@/types/knowledge-base'

export function useKnowledgeBase() {
    const loading = ref(false)
    const error = ref<string | null>(null)
    const searchResults = ref<ParsedSearchResult[]>([])
    const fileList = ref<KBFileInfo[]>([])
    const chunks = ref<KBChunkInfo[]>([])
    
    // 搜索知识库
    async function search(params: KBSearchParams) {
        loading.value = true
        error.value = null
        
        try {
            const response = await apiService.searchKnowledgeBase(params)
            
            if (response.is_error) {
                throw new Error(response.content)
            }
            
            // 解析搜索结果
            searchResults.value = parseSearchResults(response.content)
            
            return response
        } catch (e: any) {
            error.value = e.message
            throw e
        } finally {
            loading.value = false
        }
    }
    
    // 获取文件列表
    async function listFiles(params: KBListFilesParams) {
        loading.value = true
        error.value = null
        
        try {
            const response = await apiService.listKnowledgeBaseFiles(params)
            
            if (response.is_error) {
                throw new Error(response.content)
            }
            
            // 解析文件列表
            fileList.value = parseFileList(response.content)
            
            return response
        } catch (e: any) {
            error.value = e.message
            throw e
        } finally {
            loading.value = false
        }
    }
    
    // 获取文件分块
    async function getChunks(params: KBGetChunksParams) {
        loading.value = true
        error.value = null
        
        try {
            const response = await apiService.getKnowledgeBaseChunks(params)
            
            if (response.is_error) {
                throw new Error(response.content)
            }
            
            // 解析分块内容
            chunks.value = parseChunks(response.content)
            
            return response
        } catch (e: any) {
            error.value = e.message
            throw e
        } finally {
            loading.value = false
        }
    }
    
    // 解析搜索结果（JSON 格式）
    function parseSearchResults(jsonContent: string): ParsedSearchResult[] {
        try {
            const response = JSON.parse(jsonContent)
            if (!response.success || !response.data) {
                return []
            }
            
            return response.data.results.map((result: any) => ({
                fileName: result.metadata?.file_name || '未知文件',
                similarity: (result.similarity * 100).toFixed(1) + '%',
                content: result.content,
                metadata: result.metadata
            }))
        } catch (e) {
            console.error('解析搜索结果失败:', e)
            return []
        }
    }
    
    // 解析文件列表（JSON 格式）
    function parseFileList(jsonContent: string): KBFileInfo[] {
        try {
            const response = JSON.parse(jsonContent)
            if (!response.success || !response.data) {
                return []
            }
            
            return response.data.files.map((file: any) => ({
                id: file.id,
                name: file.display_name,
                size: file.file_size,
                type: file.file_type,
                status: file.processing_status,
                chunks: file.total_chunks
            }))
        } catch (e) {
            console.error('解析文件列表失败:', e)
            return []
        }
    }
    
    // 解析分块内容（JSON 格式）
    function parseChunks(jsonContent: string): KBChunkInfo[] {
        try {
            const response = JSON.parse(jsonContent)
            if (!response.success || !response.data) {
                return []
            }
            
            return response.data.chunks.map((chunk: any) => ({
                index: chunk.chunk_index,
                tokenCount: chunk.token_count || 0,
                content: chunk.content
            }))
        } catch (e) {
            console.error('解析分块内容失败:', e)
            return []
        }
    }
    
    // 辅助函数已不需要，因为 JSON 格式直接提供结构化数据
    // 保留这些函数以兼容旧版本（如果需要）
    function extractId(line: string): string {
        const match = line.match(/ID: `(.*?)`/)
        return match ? match[1] : ''
    }
    
    function extractSize(line: string): number {
        const match = line.match(/大小：(.*?)(MB|KB|GB)/)
        if (!match) return 0
        
        const value = parseFloat(match[1])
        const unit = match[2]
        
        const multipliers: Record<string, number> = {
            'B': 1,
            'KB': 1024,
            'MB': 1024 * 1024,
            'GB': 1024 * 1024 * 1024,
        }
        
        return Math.round(value * (multipliers[unit] || 1))
    }
    
    function extractType(line: string): string {
        const match = line.match(/类型：(\w+)/)
        return match ? match[1] : 'unknown'
    }
    
    function extractStatus(line: string): 'pending' | 'processing' | 'completed' | 'failed' {
        const match = line.match(/状态：(\w+)/)
        const status = match ? match[1] : 'pending'
        return status as any
    }
    
    function extractChunks(line: string): number {
        const match = line.match(/分块数：(\d+)/)
        return match ? parseInt(match[1]) : 0
    }
    
    // 清除错误
    function clearError() {
        error.value = null
    }
    
    // 清除所有状态
    function clearAll() {
        error.value = null
        searchResults.value = []
        fileList.value = []
        chunks.value = []
    }
    
    return {
        // 状态
        loading,
        error,
        searchResults,
        fileList,
        chunks,
        
        // 计算属性
        hasResults: computed(() => searchResults.value.length > 0),
        hasFiles: computed(() => fileList.value.length > 0),
        hasChunks: computed(() => chunks.value.length > 0),
        
        // 方法
        search,
        listFiles,
        getChunks,
        clearError,
        clearAll,
    }
}
```

---

## 组件示例

### 示例 1: 知识库搜索组件

```vue
<!-- src/components/KBSearch.vue -->
<template>
    <div class="kb-search p-4">
        <!-- 搜索框 -->
        <el-input
            v-model="searchQuery"
            placeholder="输入搜索关键词..."
            size="large"
            @keyup.enter="handleSearch"
        >
            <template #append>
                <el-button 
                    @click="handleSearch" 
                    :loading="loading"
                    type="primary"
                >
                    🔍 搜索
                </el-button>
            </template>
        </el-input>
        
        <!-- 错误提示 -->
        <el-alert
            v-if="error"
            type="error"
            :title="error"
            show-icon
            closable
            class="mt-4"
        />
        
        <!-- 搜索结果 -->
        <div v-if="hasResults" class="search-results mt-6">
            <h3 class="text-lg font-semibold mb-4">
                搜索结果 ({{ searchResults.length }})
            </h3>
            
            <el-card
                v-for="(result, index) in searchResults"
                :key="index"
                class="result-item mb-4"
                shadow="hover"
            >
                <template #header>
                    <div class="flex justify-between items-center">
                        <span class="font-medium text-blue-600">
                            📄 {{ result.fileName }}
                        </span>
                        <el-tag type="success">
                            相似度：{{ result.similarity }}
                        </el-tag>
                    </div>
                </template>
                
                <div class="result-content text-gray-700 leading-relaxed">
                    {{ result.content }}
                </div>
            </el-card>
        </div>
        
        <!-- 空状态 -->
        <el-empty
            v-if="!loading && !hasResults && !error"
            description="请输入关键词开始搜索"
        />
    </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useKnowledgeBase } from '@/composables/useKnowledgeBase'

const props = defineProps<{
    knowledgeBaseId: string
}>()

const searchQuery = ref('')
const {
    loading,
    error,
    searchResults,
    hasResults,
    search,
    clearAll,
} = useKnowledgeBase()

async function handleSearch() {
    if (!searchQuery.value.trim()) return
    
    await search({
        knowledge_base_id: props.knowledgeBaseId,
        query: searchQuery.value,
        top_k: 5,
    })
}
</script>

<style scoped>
.result-item:hover {
    transform: translateY(-2px);
    transition: transform 0.2s;
}
</style>
```

### 示例 2: 知识库文件浏览器

```vue
<!-- src/components/KBFileBrowser.vue -->
<template>
    <div class="kb-file-browser p-4">
        <h3 class="text-lg font-semibold mb-4">📚 知识库文件</h3>
        
        <!-- 刷新按钮 -->
        <el-button 
            @click="loadFiles" 
            :loading="loading"
            icon="Refresh"
            circle
            class="mb-4"
        />
        
        <!-- 文件列表 -->
        <el-table 
            :data="fileList" 
            v-loading="loading"
            stripe
            border
        >
            <el-table-column prop="name" label="文件名" min-width="200">
                <template #default="{ row }">
                    <span class="font-medium">{{ row.name }}</span>
                </template>
            </el-table-column>
            
            <el-table-column prop="size" label="大小" width="100">
                <template #default="{ row }">
                    {{ formatFileSize(row.size) }}
                </template>
            </el-table-column>
            
            <el-table-column prop="type" label="类型" width="80">
                <template #default="{ row }">
                    <el-tag size="small">{{ row.type }}</el-tag>
                </template>
            </el-table-column>
            
            <el-table-column prop="status" label="状态" width="100">
                <template #default="{ row }">
                    <el-tag 
                        :type="getStatusType(row.status)"
                        size="small"
                    >
                        {{ getStatusText(row.status) }}
                    </el-tag>
                </template>
            </el-table-column>
            
            <el-table-column prop="chunks" label="分块数" width="80" />
            
            <el-table-column label="操作" width="150">
                <template #default="{ row }">
                    <el-button
                        v-if="row.status === 'completed'"
                        @click="viewChunks(row)"
                        size="small"
                        type="primary"
                    >
                        查看
                    </el-button>
                </template>
            </el-table-column>
        </el-table>
        
        <!-- 错误提示 -->
        <el-alert
            v-if="error"
            type="error"
            :title="error"
            show-icon
            closable
            class="mt-4"
        />
    </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useKnowledgeBase } from '@/composables/useKnowledgeBase'

const props = defineProps<{
    knowledgeBaseId: string
}>()

const emit = defineEmits<{
    (e: 'view-chunks', fileId: string): void
}>()

const {
    loading,
    error,
    fileList,
    hasFiles,
    listFiles,
} = useKnowledgeBase()

onMounted(async () => {
    await loadFiles()
})

async function loadFiles() {
    await listFiles({
        knowledge_base_id: props.knowledgeBaseId,
    })
}

function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B'
    
    const units = ['B', 'KB', 'MB', 'GB']
    let unitIndex = 0
    let size = bytes
    
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024
        unitIndex++
    }
    
    return `${size.toFixed(2)} ${units[unitIndex]}`
}

function getStatusType(status: string): string {
    const types: Record<string, string> = {
        pending: 'info',
        processing: 'warning',
        completed: 'success',
        failed: 'danger',
    }
    return types[status] || 'info'
}

function getStatusText(status: string): string {
    const texts: Record<string, string> = {
        pending: '等待中',
        processing: '处理中',
        completed: '已完成',
        failed: '失败',
    }
    return texts[status] || status
}

function viewChunks(file: any) {
    emit('view-chunks', file.id)
}
</script>
```

---

## 状态管理集成

### 使用 Pinia Store

创建 `src/stores/knowledge-base.ts`:

```typescript
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { 
    ParsedSearchResult, 
    KBFileInfo, 
    KBChunkInfo 
} from '@/types/knowledge-base'
import { useKnowledgeBase } from '@/composables/useKnowledgeBase'

export const useKnowledgeBaseStore = defineStore('knowledge-base', () => {
    // 当前选中的知识库
    const currentKBId = ref<string | null>(null)
    const currentFileId = ref<string | null>(null)
    
    // 使用 composable
    const {
        loading,
        error,
        searchResults,
        fileList,
        chunks,
        search,
        listFiles,
        getChunks,
        clearAll,
    } = useKnowledgeBase()
    
    // 设置当前知识库
    function setCurrentKB(kbId: string) {
        currentKBId.value = kbId
        clearAll()
    }
    
    // 搜索
    async function searchKB(query: string, topK = 5) {
        if (!currentKBId.value) {
            throw new Error('请先选择知识库')
        }
        
        return search({
            knowledge_base_id: currentKBId.value,
            query,
            top_k: topK,
        })
    }
    
    // 加载文件列表
    async function loadFiles() {
        if (!currentKBId.value) {
            throw new Error('请先选择知识库')
        }
        
        return listFiles({
            knowledge_base_id: currentKBId.value,
        })
    }
    
    // 加载分块
    async function loadChunks(fileId: string, chunkIndex = 0, limit = 10) {
        if (!currentKBId.value) {
            throw new Error('请先选择知识库')
        }
        
        currentFileId.value = fileId
        
        return getChunks({
            knowledge_base_id: currentKBId.value,
            file_id: fileId,
            chunk_index: chunkIndex,
            limit,
        })
    }
    
    return {
        // 状态
        currentKBId,
        currentFileId,
        loading,
        error,
        searchResults,
        fileList,
        chunks,
        
        // 方法
        setCurrentKB,
        searchKB,
        loadFiles,
        loadChunks,
        clearAll,
    }
})
```

---

## 最佳实践

### 1. 错误处理

```typescript
// ✅ 推荐：统一的错误处理
try {
    await search(params)
} catch (e: any) {
    console.error('搜索失败:', e)
    ElMessage.error(e.message || '搜索失败，请稍后重试')
}
```

### 2. 加载状态

```typescript
// ✅ 推荐：使用 loading 状态
const { loading, search } = useKnowledgeBase()

<el-button :loading="loading" @click="handleSearch">
    {{ loading ? '搜索中...' : '搜索' }}
</el-button>
```

### 3. 分页处理

```typescript
// ✅ 推荐：实现分页加载更多分块
const currentPage = ref(0)
const PAGE_SIZE = 10

async function loadMoreChunks() {
    await getChunks({
        knowledge_base_id: kbId,
        file_id: fileId,
        chunk_index: currentPage.value * PAGE_SIZE,
        limit: PAGE_SIZE,
    })
    currentPage.value++
}
```

### 4. 性能优化

```typescript
// ✅ 推荐：使用防抖减少请求次数
import { useDebounceFn } from '@vueuse/core'

const debouncedSearch = useDebounceFn(async (query: string) => {
    await search({ query, top_k: 5 })
}, 300)
```

### 5. 缓存结果

```typescript
// ✅ 推荐：缓存搜索结果
const searchCache = new Map<string, ParsedSearchResult[]>()

async function cachedSearch(query: string) {
    const cacheKey = `${props.knowledgeBaseId}:${query}`
    
    if (searchCache.has(cacheKey)) {
        searchResults.value = searchCache.get(cacheKey)!
        return
    }
    
    await search({ query, top_k: 5 })
    searchCache.set(cacheKey, searchResults.value)
}
```

---

## 总结

通过以上集成方案，您可以在前端项目中优雅地使用知识库工具提供者：

1. ✅ **类型安全**: 完整的 TypeScript 类型定义
2. ✅ **模块化**: Composable 模式便于复用
3. ✅ **状态管理**: Pinia Store 统一管理
4. ✅ **用户体验**: 完善的加载和错误处理
5. ✅ **性能优化**: 防抖、缓存等优化措施

这样可以构建出高效、易用的知识库管理界面。
