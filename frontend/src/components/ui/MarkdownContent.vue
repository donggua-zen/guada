<template>
    <!-- 方案二：DOM 节点级增量更新 -->
    <div class="markdown-content">
        <div ref="markdownContainerRef"></div>
    </div>
</template>
<script setup lang="ts">
import { watch, ref, onMounted, onBeforeUnmount } from 'vue';
import { useMarkdown } from "../../composables/useMarkdown";
import { useDiffDOM } from "../../composables/useDiffDOM";
import DiffDOM from 'diff-dom';

const { marked } = useMarkdown()


// 定义 Props - 类型化
const props = defineProps<{
    content: string;
}>();

// ============================================
// DOM 节点级增量更新（使用 diff-dom）
// ============================================
const markdownContainerRef = ref<HTMLElement | null>(null);
let lastRenderedHTML = ''; // 保存上一次渲染的完整 HTML
let diffEngine: DiffDOM | null = null; // diff-dom 实例

// 生命周期：初始化 diff-dom
onMounted(() => {
    diffEngine = useDiffDOM();
    initialRender(); // 初始渲染，直接使用 innerHTML
});

/**
 * 初始渲染：直接解析 Markdown，不进行 diff 对比
 */
const initialRender = async () => {
    if (!markdownContainerRef.value || !props.content) return;

    const newHTML = await marked.parse(props.content) as string;
    markdownContainerRef.value.innerHTML = newHTML;
    lastRenderedHTML = newHTML;

};

/**
 * 使用 diff-dom 进行增量更新
 * 专业的 DOM 差异对比和更新库
 */
const renderWithDiffDOM = async () => {
    if (!markdownContainerRef.value || !props.content) return;

    // 1. 将最新的 Markdown 解析为 HTML
    const newHTML = await marked.parse(props.content) as string;

    // 2. 与上一次渲染的 HTML 进行比较
    if (newHTML === lastRenderedHTML) {
        return;
    }
    try {
        // 3. 创建临时容器
        const tempContainer = document.createElement('div') as HTMLElement;
        tempContainer.innerHTML = newHTML;

        // 4. 计算并应用差异
        if (!diffEngine) return;

        // @ts-ignore - diff-dom 库的类型定义不完整
        const diffs = diffEngine.diff(markdownContainerRef.value, tempContainer);

        if (diffs && diffs.length > 0) {
            // 应用差异
            if (!diffEngine) return;

            const result = diffEngine.apply(markdownContainerRef.value, diffs) as any;

            if (result !== false && result !== undefined) {
                // 5. 更新记录
                lastRenderedHTML = newHTML as string;

                // 6. 触发事件
            
            } else {
                console.error('[Markdown-DiffDOM] Failed to apply changes');
            }
        } else {
            lastRenderedHTML = newHTML as string;
        }
    } catch (error) {
        console.error('[Markdown-DiffDOM] Error:', error);

        // 降级方案：全量替换
        console.warn('[Markdown-DiffDOM] Fallback to full replacement');
        markdownContainerRef.value.innerHTML = newHTML as string;
        lastRenderedHTML = newHTML as string;
    
    }
};

// 监听 content 变化，直接渲染
watch(
    () => props.content,
    () => {
        renderWithDiffDOM();
    },
);

// 生命周期：清理资源
onBeforeUnmount(() => {
    // useDebounceFn 返回的函数不需要手动清理
    // VueUse 会自动处理
});
</script>

<style scoped>
@reference "tailwindcss";

/* .markdown-content {
    position: relative;
} */

/* 新增内容的淡入动画 */
/* .markdown-content>* {
    animation: fadeIn 0.3s ease;
} */

@keyframes fadeIn {
    from {
        opacity: 0.7;
        transform: translateY(5px);
    }

    to {
        opacity: 1;
        transform: translateY(0);
    }
}
</style>
