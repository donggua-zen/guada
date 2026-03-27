# Markdown 双方案切换使用指南

**创建时间**: 2026-03-27  
**功能**: 支持两种增量渲染方案自由切换

---

## 🎯 **两种方案对比**

| 特性 | 方案一：分段增量渲染 | 方案二：DOM 节点级增量更新 |
|------|-------------------|------------------------|
| **实现方式** | Vue computed + v-for key 复用 | 手动 DOM diff + 节点操作 |
| **解析粒度** | 段落级别 | 完整 HTML |
| **DOM 更新粒度** | 段落级别（Vue 自动） | 节点级别（手动精细控制） |
| **性能** | ⭐⭐⭐⭐ 优秀 | ⭐⭐⭐⭐⭐ 极致 |
| **代码复杂度** | ⭐⭐ 简单 | ⭐⭐⭐⭐ 复杂 |
| **维护性** | ⭐⭐⭐⭐ 易维护 | ⭐⭐⭐ 较复杂 |
| **适用场景** | 通用场景 | 超长文本、高频更新 |

---

## 🚀 **使用方法**

### **默认：方案一（分段增量渲染）**

```vue
<MarkdownContent 
  :content="turn.content" 
  @render-complete="handleRenderComplete" 
/>
```

**特点**：
- ✅ 按段落分割，智能缓存
- ✅ Vue 自动管理 DOM 复用
- ✅ 代码简洁，易于维护
- ✅ 性能优秀，适合 99% 场景

---

### **切换到方案二（DOM 节点级增量更新）**

```vue
<MarkdownContent 
  :content="turn.content" 
  :use-dom-incremental="true"
  @render-complete="handleRenderComplete" 
/>
```

**特点**：
- ✅ 直接操作 DOM 节点
- ✅ 只更新差异部分
- ✅ 性能极致，适合极端场景
- ⚠️ 代码复杂，调试难度较高

---

## 📊 **日志输出对比**

### **方案一：分段增量渲染**

```javascript
// 控制台输出示例
[Markdown] Content updated: {
  newLength: 150,
  oldLength: 140,
  isUserSelecting: false,
  mode: 'Segment-Incremental'
}

// 每个段落独立渲染
[Markdown] User started selecting text
[Markdown] Update paused due to user selection
```

**日志特点**：
- 显示 `Segment-Incremental` 模式
- 不显示解析耗时（由 Vue 内部管理）
- 段落级别的更新对开发者透明

---

### **方案二：DOM 节点级增量更新**

```javascript
// 控制台输出示例
[Markdown] Content updated: {
  newLength: 150,
  oldLength: 140,
  isUserSelecting: false,
  mode: 'DOM-Incremental'
}

// 详细记录 DOM 对比过程
[Markdown-DOM] Diff found at index: 3 {
  totalOldNodes: 5,
  totalNewNodes: 6,
  unchangedNodes: 3
}

[Markdown-DOM] DOM updated: removed 2 nodes, added 3 nodes

[Markdown-DOM] Parse and update completed in 2.35ms
```

**日志特点**：
- 显示 `DOM-Incremental` 模式
- 详细的 DOM diff 信息
- 精确的解析和更新时间（毫秒级）
- 适合性能分析和调试

---

## 🔍 **核心实现原理**

### **方案一：分段增量渲染**

```javascript
// 1. Markdown 分段
const segments = computed(() => {
    return segmentMarkdown(props.content);
});

// 2. 每段生成唯一 ID（基于内容 hash）
function generateSegmentId(content) {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
        const char = content.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return `seg_${Math.abs(hash).toString(36)}`;
}

// 3. Vue 根据 key 自动复用 DOM
<div v-for="segment in segments" :key="segment.id" v-html="renderSegment(segment)" />

// 4. 缓存已渲染的段落
const renderSegment = (segment) => {
    const cached = renderedSegments.get(segment.id);
    if (cached && cached.content === segment.content) {
        return cached.html; // 命中缓存，直接返回
    }
    const html = marked.parse(segment.content);
    renderedSegments.set(segment.id, { content, html, timestamp: Date.now() });
    return html;
};
```

**优势**：
- ✅ Vue 响应式自动管理
- ✅ 段落级别精确缓存
- ✅ 未变化段落完全不动

---

### **方案二：DOM 节点级增量更新**

```javascript
// 1. 全量解析 Markdown
const currentRawHTML = marked.parse(props.content);

// 2. 与上一次渲染的 HTML 比较
if (currentHTML === lastRenderedHTML) {
    return; // 内容无变化，跳过
}

// 3. 创建临时容器
const tempContainer = document.createElement('div');
tempContainer.innerHTML = currentHTML;

const currentNodes = Array.from(container.childNodes);
const newNodes = Array.from(tempContainer.childNodes);

// 4. 找到第一个不同的索引
let idx = 0;
while (
    idx < currentNodes.length && 
    idx < newNodes.length && 
    currentNodes[idx].isEqualNode?.(newNodes[idx])
) {
    idx++;
}

// 5. 只更新差异部分
// 移除旧节点
for (let i = currentNodes.length - 1; i >= idx; i--) {
    container.removeChild(container.childNodes[i]);
}

// 追加新节点
for (let i = idx; i < newNodes.length; i++) {
    container.appendChild(newNodes[i].cloneNode(true));
}
```

**优势**：
- ✅ 节点级别精确更新
- ✅ 只操作必要的 DOM 节点
- ✅ 性能监控可视化

---

## 🧪 **测试建议**

### **场景 1: 短文本流式输出**

```markdown
你好 → 你好世界 → 你好世界！
```

**预期**：
- 方案一：每段都是新段落，无明显优势
- 方案二：每次全量对比，性能相近

---

### **场景 2: 长文本多段落**

```markdown
段落 1（不变）
段落 2（新增内容）
段落 3（不变）
```

**预期**：
- 方案一：只重新渲染段落 2 ✅
- 方案二：只更新差异节点 ✅

---

### **场景 3: 代码块流式输出**

````markdown
```python
def hello():
    print("Hello")  # 逐字符追加
```
````

**预期**：
- 方案一：整个代码块作为一个段落，持续更新
- 方案二：每次对比所有节点，精确更新文本

---

### **场景 4: 用户选择文本**

**操作步骤**：
1. AI 开始输出
2. 用户用鼠标选择某段文字
3. 观察控制台日志

**预期**：
```
[Markdown] User started selecting text
[Markdown] Update paused due to user selection
[Markdown] User finished selecting, applying pending update
```

**视觉反馈**：
- 蓝色边框高亮
- "内容已暂停更新"提示

---

## 📈 **性能监控**

### **方案一性能指标**

```javascript
// 通过浏览器 DevTools Performance 面板观察
- Layout 次数
- Paint 次数
- Script 执行时间
```

---

### **方案二性能指标**

```javascript
// 控制台直接输出
[Markdown-DOM] Parse and update completed in 2.35ms

// 包含：
// - Markdown 解析耗时
// - DOM diff 耗时
// - DOM 操作耗时
```

---

## ⚙️ **切换时机建议**

### **使用方案一（推荐）**

✅ **适用于以下场景**：
- 日常聊天对话
- 中等长度文本（< 5000 字符）
- 常规流式输出
- 需要良好维护性

---

### **使用方案二**

✅ **适用于以下场景**：
- 超长文本（> 10000 字符）
- 极高频更新（每秒 > 50 次）
- 性能敏感场景
- 需要精确性能数据

⚠️ **注意事项**：
- 代码复杂度较高
- 调试难度较大
- 需要更多测试

---

## 🐛 **已知问题**

### **方案一**

1. **DOM 层级问题**
   - 会多一层 `<div>`（已通过 `display: contents` 优化）
   - 旧版浏览器可能不支持

2. **Hash 冲突**
   - 简单 hash 算法在极端情况下可能冲突
   - 生产环境可升级为 `crypto.subtle`

---

### **方案二**

1. **innerHTML 安全性**
   - 当前未使用 DOMPurify 净化
   - 如需安全可添加：`DOMPurify.sanitize(html)`

2. **复杂 DOM 结构**
   - `isEqualNode` 在某些边缘情况可能误判
   - 建议使用标准 HTML 标签

---

## 🎯 **最佳实践**

### **1. 开发阶段**

```vue
<!-- 默认使用方案一，便于调试 -->
<MarkdownContent :content="turn.content" />
```

---

### **2. 性能优化阶段**

```vue
<!-- 如遇到性能瓶颈，切换到方案二 -->
<MarkdownContent 
  :content="turn.content" 
  :use-dom-incremental="true"
/>
```

---

### **3. 生产环境**

```vue
<!-- 根据实际场景选择 -->
<template v-for="chat in chats">
  <!-- 普通聊天使用方案一 -->
  <MarkdownContent :content="chat.content" />
  
  <!-- 长文本/代码展示使用方案二 -->
  <MarkdownContent 
    v-if="chat.isLongText"
    :content="chat.content" 
    :use-dom-incremental="true"
  />
</template>
```

---

## 📝 **总结**

本次重构提供了两种优秀的增量渲染方案：

1. **方案一（分段增量渲染）**：
   - ✅ 优雅、简洁、易维护
   - ✅ 性能优秀，适合 99% 场景
   - ✅ 推荐作为默认方案

2. **方案二（DOM 节点级增量更新）**：
   - ✅ 性能极致、精确控制
   - ✅ 适合极端场景
   - ✅ 可作为性能优化武器

**自由选择，灵活切换！** 🎉

---

**最后更新**: 2026-03-27  
**维护者**: AI Chat Team
