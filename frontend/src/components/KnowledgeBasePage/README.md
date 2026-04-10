# KnowledgeBasePage 组件模块

## 目录结构

```
KnowledgeBasePage/
├── FileChunksViewer.vue    # 文件分块查看器组件
└── index.ts                # 模块导出文件
```

## 组件说明

### FileChunksViewer.vue

文件分块查看器组件，用于展示知识库文件的分块内容。

#### 功能特性

- 仅对处理完成（`processing_status === 'completed'`）的文件启用查看功能
- 弹窗形式展示，支持滚动查看
- 分页功能，每页最多显示 10 个分块
- 显示分块索引、Token 数等元信息
- 使用等宽字体展示代码类内容
- 暗黑模式兼容
- 简洁美观的界面设计

#### Props

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| modelValue | boolean | 是 | 控制弹窗显示/隐藏（v-model） |
| selectedFile | UnifiedFileRecord \| null | 是 | 选中的文件对象 |

#### 使用示例

```vue
<template>
  <FileChunksViewer 
    v-model="showFileChunksModal" 
    :selected-file="selectedFile"
  />
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { FileChunksViewer } from '@/components/KnowledgeBasePage'
import type { UnifiedFileRecord } from '@/stores/fileUpload'

const showFileChunksModal = ref(false)
const selectedFile = ref<UnifiedFileRecord | null>(null)

// 打开弹窗
function openChunksViewer(file: UnifiedFileRecord) {
  if (file.processing_status === 'completed') {
    selectedFile.value = file
    showFileChunksModal.value = true
  }
}
</script>
```

#### 注意事项

1. 组件会自动在打开时加载第一页数据
2. 关闭弹窗时会重置内部状态
3. 分页从第 1 页开始（与 Element Plus 分页组件保持一致）
4. 需要确保父组件已正确设置 `activeKnowledgeBaseId`

## 重构说明

本次重构将原本集成在 `KnowledgeBasePage.vue` 中的文件分块查看逻辑拆分到独立组件中，主要优势：

1. **职责分离**：主组件专注于知识库和文件列表管理，子组件专注于分块内容展示
2. **代码可维护性**：相关逻辑集中在一起，便于维护和修改
3. **可复用性**：FileChunksViewer 可以在其他地方独立使用
4. **降低复杂度**：主组件代码量减少，结构更清晰

## API 依赖

该组件依赖后端 API：
- `GET /api/v1/knowledge-bases/{kb_id}/files/{file_id}/chunks?skip={skip}&limit={limit}`

确保 ApiService 中已实现 `getKBFileChunks` 方法。
