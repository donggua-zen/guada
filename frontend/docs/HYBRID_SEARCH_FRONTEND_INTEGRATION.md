# 混合搜索前端集成指南

## 📋 概述

本文档说明如何在前端 Vue 应用中集成和使用混合搜索功能。

---

## 🎯 核心变更

### API 响应增强

混合搜索模式下，返回结果包含额外分数信息：

```typescript
interface SearchResult {
  content: string;
  metadata: {
    file_name: string;
    [key: string]: any;
  };
  similarity: number;        // 语义相似度（或最终相似度）
  semantic_score?: number;   // 🔥 新增：语义分数
  keyword_score?: number;    // 🔥 新增：关键词分数
  final_score?: number;      // 🔥 新增：融合后的最终分数
}
```

---

## 💻 前端调用方式

### 方式 1: 默认调用（推荐）

系统会**自动启用混合搜索**和动态权重调整：

```typescript
// src/components/KnowledgeBasePage.vue 或相关组件
import { useChatStore } from '@/stores/chat'

const chatStore = useChatStore()

// 发送知识库搜索请求
const results = await chatStore.searchKnowledgeBase({
  knowledge_base_id: 'kb_123',
  query: 'FastAPI 异步请求处理',
  top_k: 5
})

// 处理增强后的结果
results.data.results.forEach(result => {
  console.log('内容:', result.content)
  console.log('文件名:', result.metadata.file_name)
  
  // 🔥 新增：访问混合搜索分数
  if (result.final_score !== undefined) {
    console.log('最终分数:', result.final_score)
    console.log('语义分数:', result.semantic_score)
    console.log('关键词分数:', result.keyword_score)
  }
})
```

---

### 方式 2: 自定义参数

精细控制搜索行为：

```typescript
const results = await chatStore.searchKnowledgeBase({
  knowledge_base_id: 'kb_123',
  query: 'def get_user(user_id: str) -> dict',
  top_k: 5,
  
  // 🔥 启用混合搜索
  use_hybrid_search: true,
  
  // 🔥 启用自动权重调整（根据查询特征）
  enable_rerank: true,
  
  // 🔥 或手动指定权重
  semantic_weight: 0.3,  // 代码查询，降低语义权重
  keyword_weight: 0.7    // 提高关键词权重
})
```

---

### 方式 3: 降级为纯语义搜索

回退到原有行为：

```typescript
const results = await chatStore.searchKnowledgeBase({
  knowledge_base_id: 'kb_123',
  query: '什么是机器学习？',
  top_k: 5,
  use_hybrid_search: false  // 关闭混合搜索
})
```

---

## 🎨 UI 展示建议

### 1. 分数可视化

在搜索结果中展示分数构成：

```vue
<!-- KnowledgeBaseResults.vue -->
<template>
  <div class="search-results">
    <div v-for="(result, index) in results" :key="index" class="result-item">
      <div class="result-content">
        <h3>{{ result.metadata.file_name }}</h3>
        <p>{{ result.content }}</p>
      </div>
      
      <!-- 🔥 分数展示 -->
      <div class="result-scores" v-if="result.final_score !== undefined">
        <div class="score-bar">
          <span class="score-label">语义:</span>
          <div class="score-fill" :style="{ width: `${result.semantic_score * 100}%` }"></div>
          <span class="score-value">{{ result.semantic_score?.toFixed(2) }}</span>
        </div>
        
        <div class="score-bar">
          <span class="score-label">关键词:</span>
          <div class="score-fill" :style="{ width: `${result.keyword_score * 100}%` }"></div>
          <span class="score-value">{{ result.keyword_score?.toFixed(2) }}</span>
        </div>
        
        <div class="score-bar final">
          <span class="score-label">综合:</span>
          <div class="score-fill" :style="{ width: `${result.final_score * 100}%` }"></div>
          <span class="score-value">{{ result.final_score?.toFixed(2) }}</span>
        </div>
      </div>
      
      <!-- 传统展示（无混合搜索分数时） -->
      <div class="similarity-score" v-else>
        相似度：{{ (result.similarity * 100).toFixed(1) }}%
      </div>
    </div>
  </div>
</template>

<style scoped>
.score-bar {
  display: flex;
  align-items: center;
  margin: 4px 0;
  height: 20px;
}

.score-label {
  width: 60px;
  font-size: 12px;
  color: #666;
}

.score-fill {
  flex: 1;
  height: 8px;
  background: linear-gradient(90deg, #4CAF50, #8BC34A);
  border-radius: 4px;
  transition: width 0.3s;
}

.score-bar.final .score-fill {
  background: linear-gradient(90deg, #2196F3, #03A9F4);
}

.score-value {
  width: 40px;
  text-align: right;
  font-size: 12px;
  color: #333;
  margin-left: 8px;
}
</style>
```

---

### 2. 搜索模式指示器

显示当前使用的搜索模式：

```vue
<template>
  <div class="search-mode-indicator">
    <span class="mode-badge" :class="searchMode">
      <i v-if="searchMode === 'hybrid'" class="icon-mix"></i>
      <i v-else class="icon-semantics"></i>
      {{ searchMode === 'hybrid' ? '混合搜索' : '语义搜索' }}
    </span>
    
    <!-- 🔥 权重展示（可选） -->
    <span class="weight-info" v-if="showWeights">
      (语义：{{ (semanticWeight * 100).toFixed(0) }}%, 
       关键词：{{ (keywordWeight * 100).toFixed(0) }}%)
    </span>
  </div>
</template>

<script setup>
defineProps({
  searchMode: {
    type: String,
    default: 'hybrid',
    validator: (v) => ['hybrid', 'semantic'].includes(v)
  },
  semanticWeight: Number,
  keywordWeight: Number,
  showWeights: Boolean
})
</script>

<style scoped>
.search-mode-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #f5f5f5;
  border-radius: 16px;
  font-size: 12px;
}

.mode-badge {
  padding: 4px 8px;
  border-radius: 12px;
  font-weight: 500;
}

.mode-badge.hybrid {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.mode-badge.semantic {
  background: #4CAF50;
  color: white;
}

.weight-info {
  color: #666;
  font-size: 11px;
}
</style>
```

---

### 3. 高级搜索面板

提供用户自定义控制选项：

```vue
<template>
  <div class="advanced-search-panel">
    <el-collapse v-model="activeNames">
      <el-collapse-item title="高级搜索选项" name="advanced">
        
        <!-- 搜索模式切换 -->
        <el-form-item label="搜索模式">
          <el-radio-group v-model="searchConfig.use_hybrid_search">
            <el-radio label="hybrid" border>
              <i class="icon-mix"></i> 混合搜索
            </el-radio>
            <el-radio label="semantic" border>
              <i class="icon-semantics"></i> 语义搜索
            </el-radio>
          </el-radio-group>
        </el-form-item>
        
        <!-- 权重调整滑块 -->
        <el-form-item label="权重配置" v-if="searchConfig.use_hybrid_search">
          <div class="weight-sliders">
            <div class="slider-item">
              <span>语义权重:</span>
              <el-slider
                v-model="searchConfig.semantic_weight"
                :min="0"
                :max="1"
                :step="0.1"
                :disabled="searchConfig.enable_rerank"
                show-input
              />
            </div>
            
            <div class="slider-item">
              <span>关键词权重:</span>
              <el-slider
                v-model="searchConfig.keyword_weight"
                :min="0"
                :max="1"
                :step="0.1"
                :disabled="searchConfig.enable_rerank"
                show-input
              />
            </div>
            
            <!-- 自动权重开关 -->
            <el-checkbox v-model="searchConfig.enable_rerank">
              自动调整权重（根据查询特征）
            </el-checkbox>
          </div>
        </el-form-item>
        
        <!-- 返回数量 -->
        <el-form-item label="返回数量">
          <el-input-number
            v-model="searchConfig.top_k"
            :min="1"
            :max="20"
            :step="1"
          />
        </el-form-item>
        
      </el-collapse-item>
    </el-collapse>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue'

const activeNames = ref([])

const searchConfig = reactive({
  use_hybrid_search: true,
  enable_rerank: true,      // 自动权重调整
  semantic_weight: 0.6,
  keyword_weight: 0.4,
  top_k: 5
})

// 暴露给父组件
defineExpose({
  searchConfig
})
</script>

<style scoped>
.advanced-search-panel {
  margin-top: 16px;
  padding: 16px;
  background: #fafafa;
  border-radius: 8px;
}

.weight-sliders {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.slider-item {
  display: flex;
  align-items: center;
  gap: 12px;
}

.slider-item span {
  width: 100px;
  font-size: 14px;
  color: #666;
}

:deep(.el-slider) {
  flex: 1;
}
</style>
```

---

## 🔍 结果排序优化

### 按分数类型排序

```typescript
// 默认排序：按 final_score 降序
const sortedByFinal = results.sort((a, b) => 
  (b.final_score || b.similarity) - (a.final_score || a.similarity)
)

// 按语义分数排序
const sortedBySemantic = results.sort((a, b) => 
  (b.semantic_score || 0) - (a.semantic_score || 0)
)

// 按关键词分数排序
const sortedByKeyword = results.sort((a, b) => 
  (b.keyword_score || 0) - (a.keyword_score || 0)
)
```

---

## 📊 性能优化建议

### 1. 懒加载分数详情

默认只显示主要内容，展开后显示详细分数：

```vue
<template>
  <div class="result-item">
    <div class="result-header" @click="showDetails = !showDetails">
      <h3>{{ result.metadata.file_name }}</h3>
      <span class="final-score">{{ (result.final_score * 100).toFixed(1) }}分</span>
    </div>
    
    <div class="result-content" v-show="!showDetails">
      {{ result.content }}
    </div>
    
    <!-- 展开后显示详细分数 -->
    <transition name="slide">
      <div v-if="showDetails && result.final_score" class="score-details">
        <!-- 分数条展示 -->
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref } from 'vue'
const showDetails = ref(false)
</script>
```

### 2. 缓存搜索结果

避免重复搜索相同查询：

```typescript
const searchCache = new Map<string, SearchResult[]>()

async function cachedSearch(params: SearchParams) {
  const cacheKey = JSON.stringify(params)
  
  if (searchCache.has(cacheKey)) {
    return searchCache.get(cacheKey)!
  }
  
  const results = await performSearch(params)
  searchCache.set(cacheKey, results)
  
  return results
}
```

---

## 🎯 实际应用场景

### 场景 1: 代码片段检索

```typescript
// 用户查询代码实现
const codeQuery = "async def get_user(user_id: str) -> dict"

const results = await searchKnowledgeBase({
  query: codeQuery,
  use_hybrid_search: true,
  enable_rerank: true  // 自动检测代码特征，调整为 (0.3, 0.7)
})

// 结果会优先匹配包含代码符号的文档
```

### 场景 2: 技术术语检索

```typescript
// 用户查询专业术语
const termQuery = "依赖注入模式"

const results = await searchKnowledgeBase({
  query: termQuery,
  use_hybrid_search: true,
  enable_rerank: true  // 自动识别为短查询，使用 (0.5, 0.5)
})

// 结果会平衡语义理解和精确匹配
```

### 场景 3: 精确短语检索

```typescript
// 用户精确搜索特定短语
const exactQuery = '"event-driven architecture"'

const results = await searchKnowledgeBase({
  query: exactQuery,
  use_hybrid_search: true,
  enable_rerank: true  // 自动检测引号，调整为 (0.4, 0.6)
})

// 结果会优先匹配包含完整短语的文档
```

---

## ⚠️ 注意事项

### 1. 向后兼容

确保代码能处理两种响应格式：

```typescript
function processResults(results: SearchResult[]) {
  return results.map(result => {
    // 🔥 兼容混合搜索格式
    if ('final_score' in result) {
      return {
        ...result,
        score: result.final_score,
        scoreType: 'hybrid'
      }
    }
    
    // 兼容纯语义搜索格式
    return {
      ...result,
      score: result.similarity,
      scoreType: 'semantic'
    }
  })
}
```

### 2. 错误处理

```typescript
try {
  const results = await searchKnowledgeBase(params)
  
  if (!results.success) {
    console.error('搜索失败:', results.error)
    ElMessage.error(results.error || '搜索出错')
    return []
  }
  
  return results.data.results
  
} catch (error) {
  console.error('搜索异常:', error)
  ElMessage.error('网络错误，请稍后重试')
  return []
}
```

### 3. 中文分词限制

当前版本对中文连续文本的分词效果有限，建议：
- 使用英文或中英文混合查询
- 避免过长的中文连续文本

---

## 🧪 测试验证

### 单元测试示例

```typescript
// tests/unit/hybrid-search.test.ts
import { describe, it, expect } from 'vitest'

describe('混合搜索', () => {
  it('应正确处理混合搜索结果', async () => {
    const mockResults = [
      {
        content: 'FastAPI async example',
        similarity: 0.89,
        semantic_score: 0.95,
        keyword_score: 0.72,
        final_score: 0.86
      }
    ]
    
    const processed = processResults(mockResults)
    
    expect(processed[0].score).toBe(0.86)
    expect(processed[0].scoreType).toBe('hybrid')
  })
  
  it('应兼容纯语义搜索结果', () => {
    const mockResults = [
      {
        content: 'Machine learning basics',
        similarity: 0.92
      }
    ]
    
    const processed = processResults(mockResults)
    
    expect(processed[0].score).toBe(0.92)
    expect(processed[0].scoreType).toBe('semantic')
  })
})
```

---

## 📚 参考资源

- [后端实现文档](../../backend/docs/knowledge_base/HYBRID_SEARCH_IMPLEMENTATION.md)
- [快速开始指南](../../backend/docs/knowledge_base/HYBRID_SEARCH_QUICKSTART.md)
- [API 接口定义](../../backend/app/services/tools/providers/knowledge_base_tool_provider.py)
- [VectorService](../../backend/app/services/vector_service.py)

---

**最后更新**: 2026-04-03  
**维护者**: AI Chat Frontend Team
