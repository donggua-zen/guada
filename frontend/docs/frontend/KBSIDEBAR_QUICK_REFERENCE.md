# KBSidebar 组件 - 快速参考

## 核心概念

```
KBSidebar = 知识库导航栏（搜索 + 列表 + 操作）
```

## Props 和 Events

### Props

```typescript
interface Props {
  visible?: boolean              // 侧边栏可见状态（预留）
  knowledgeBases: KnowledgeBase[] // 知识库列表
  activeId: string | null        // 当前选中的 ID
  searchKeyword: string          // 搜索关键词（v-model）
}
```

### Events

```typescript
const emit = defineEmits<{
  select: [kb: KnowledgeBase]           // 选中知识库
  create: []                             // 点击新建
  edit: [kb: KnowledgeBase]             // 点击编辑
  delete: [kb: KnowledgeBase]           // 点击删除
  'update:searchKeyword': [value: string] // 更新搜索词
}>()
```

## 基本使用

```vue
<template>
  <SidebarLayout>
    <template #sidebar>
      <KBSidebar
        :knowledge-bases="store.knowledgeBases"
        :active-id="store.activeKnowledgeBaseId"
        v-model:search-keyword="searchKeyword"
        @select="handleSelectKB"
        @create="showCreateModal = true"
        @edit="handleEdit"
        @delete="handleDelete"
      />
    </template>
  </SidebarLayout>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { KBSidebar } from '@/components/KnowledgeBasePage'
import type { KnowledgeBase } from '@/stores/knowledgeBase'

const searchKeyword = ref('')

function handleSelectKB(kb: KnowledgeBase) {
  console.log('选中:', kb.name)
}

function handleEdit(kb: KnowledgeBase) {
  console.log('编辑:', kb.name)
}

function handleDelete(kb: KnowledgeBase) {
  console.log('删除:', kb.name)
}
</script>
```

## 功能特性

### 1. 搜索过滤

```vue
<!-- 自动过滤，无需额外逻辑 -->
<KBSidebar v-model:search-keyword="keyword" />
```

**内部实现**：
```typescript
const filteredKnowledgeBases = computed(() => {
  if (!props.searchKeyword.trim()) {
    return props.knowledgeBases
  }
  const keyword = props.searchKeyword.toLowerCase().trim()
  return props.knowledgeBases.filter(kb =>
    kb.name?.toLowerCase().includes(keyword) ||
    kb.description?.toLowerCase().includes(keyword)
  )
})
```

### 2. 选中状态

```vue
<!-- 自动高亮当前选中的知识库 -->
<KBSidebar :active-id="currentKbId" />
```

**样式**：
- 选中：`.kb-item-active`（深色背景）
- 未选中：`.kb-item-inactive`（悬停效果）

### 3. 下拉菜单

```vue
<!-- 每个知识库项都有编辑/删除菜单 -->
<el-dropdown @command="(cmd) => handleDropdownCommand(cmd, kb)">
  <el-dropdown-item command="edit">编辑</el-dropdown-item>
  <el-dropdown-item command="delete">删除</el-dropdown-item>
</el-dropdown>
```

### 4. 空状态

```vue
<!-- 自动显示空状态 -->
<div v-if="filteredKnowledgeBases.length === 0">
  {{ searchKeyword ? '未找到匹配的知识库' : '没有知识库' }}
</div>
```

## 样式定制

### 覆盖默认样式

```css
/* 在父组件中覆盖 */
:deep(.kb-sidebar) {
  /* 自定义样式 */
}

:deep(.kb-item) {
  /* 自定义列表项样式 */
}
```

### 主题变量

```css
/* 使用 CSS 变量 */
.kb-sidebar {
  background-color: var(--color-conversation-bg);
}

.kb-item-active {
  color: var(--color-conversation-text-active);
}
```

## 常见问题

### Q1: 如何实现搜索防抖？

**A**: 在父组件中使用 `watch` + 防抖：

```typescript
import { watch } from 'vue'
import { debounce } from 'lodash-es'

const debouncedSearch = debounce((keyword: string) => {
  // 执行搜索逻辑
}, 300)

watch(searchKeyword, (newVal) => {
  debouncedSearch(newVal)
})
```

### Q2: 如何添加自定义操作按钮？

**A**: 目前不支持插槽，可以 fork 组件后修改：

```vue
<!-- 在头部添加自定义按钮 -->
<div class="flex justify-between items-center">
  <span>知识库</span>
  <div class="flex gap-2">
    <slot name="actions"></slot>
    <el-button @click="handleCreate">新建</el-button>
  </div>
</div>
```

### Q3: 如何禁用搜索功能？

**A**: 传入空字符串并保持不变：

```vue
<KBSidebar 
  :search-keyword="''"
  @update:search-keyword="() => {}" 
/>
```

### Q4: 如何获取当前选中的知识库？

**A**: 通过 `activeId` prop 控制：

```typescript
const activeKb = computed(() => {
  return store.knowledgeBases.find(kb => kb.id === activeId.value)
})
```

### Q5: 列表项太多性能怎么办？

**A**: 考虑虚拟滚动（未来优化方向）：

```vue
<!-- 目前支持最多 ~200 个知识库 -->
<!-- 超过建议使用虚拟滚动库 -->
```

## 调试技巧

### 查看过滤结果

```typescript
// 在浏览器控制台
console.log('原始列表:', knowledgeBases.length)
console.log('过滤后:', filteredKnowledgeBases.length)
console.log('搜索词:', searchKeyword)
```

### 检查事件触发

```typescript
function handleSelect(kb: KnowledgeBase) {
  console.log('[KBSidebar] 选中知识库:', kb)
  console.log('[KBSidebar] KB ID:', kb.id)
  console.log('[KBSidebar] KB Name:', kb.name)
}
```

### 监控搜索变化

```typescript
watch(searchKeyword, (newVal, oldVal) => {
  console.log(`[Search] "${oldVal}" -> "${newVal}"`)
})
```

## 最佳实践

✅ **推荐做法**:
- 使用 `v-model` 绑定搜索关键词
- 保持 `knowledgeBases` 响应式更新
- 正确处理所有事件
- 使用 TypeScript 类型检查

❌ **避免做法**:
- 不要直接修改子组件内部状态
- 不要在父组件中重复实现过滤逻辑
- 不要忽略事件处理
- 不要传递过大的列表（>500 项）

## 性能优化

### 1. 列表大小

- **推荐**: < 100 个知识库
- **可接受**: 100-200 个
- **需要优化**: > 200 个（考虑虚拟滚动）

### 2. 搜索性能

- 简单搜索：< 10ms
- 复杂搜索（描述字段）：< 50ms
- 大量数据：考虑后端搜索

### 3. 渲染优化

- 使用 `key` 属性优化列表渲染
- 避免不必要的重渲染
- 合理使用 `computed` 缓存

## 扩展阅读

- [完整重构文档](./KBSIDEBAR_REFACTOR_SUMMARY.md)
- [Vue 组件通信指南](https://cn.vuejs.org/guide/components/events.html)
- [Element Plus Dropdown](https://element-plus.org/zh-CN/component/dropdown.html)

## 版本历史

### v1.0.0 (当前版本)

- ✅ 基础功能完整
- ✅ 搜索过滤
- ✅ 下拉菜单
- ✅ 空状态
- ✅ 暗黑模式
- ✅ TypeScript 支持

### 计划功能

- 🔲 虚拟滚动支持
- 🔲 拖拽排序
- 🔲 键盘快捷键
- 🔲 批量操作
- 🔲 收藏功能

