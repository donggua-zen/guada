<template>
    <!-- 方案二：DOM 节点级增量更新 -->
    <div class="markdown-content">
        <div ref="markdownContainerRef"></div>
    </div>
</template>
<script setup>
import { watch, ref, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import { useMarkdown } from "../composables/useMarkdown";
import { DiffDOM } from 'diff-dom';

const { marked } = useMarkdown()
const emit = defineEmits(["render-complete"]);
// 🔹 定义 Props
const props = defineProps({
    content: {
        type: String,
        required: true
    },
    debounced: {
        type: Boolean,
        default: false
    }
    // ✅ 已移除 useDomIncremental，全面使用方案二
});

// ============================================
// 🔹 DOM 节点级增量更新（使用 diff-dom）
// ============================================
const markdownContainerRef = ref(null);
let lastRenderedHTML = ''; // 保存上一次渲染的完整 HTML
let diffEngine = null; // diff-dom 实例

// 🔹 生命周期：初始化 diff-dom
onMounted(() => {
    diffEngine = new DiffDOM({
        debug: true,
        // 配置选项
        valueDiffing: true,  // 比较 input 值
        preDiffApply: (info) => {
            // 在应用差异前的钩子
            // if(info.diff.name === 'class')
            //     return true;
            // console.log('[DiffDOM] Pre-diff:', info);
            return false;
        }
    });
    console.log('[Markdown] DiffDOM engine initialized');
    renderWithDiffDOM(); // 初始渲染
});

/**
 * 使用 diff-dom 进行增量更新
 * 专业的 DOM 差异对比和更新库
 */
const renderWithDiffDOM = () => {
    if (!markdownContainerRef.value || !props.content) return;

    const startTime = performance.now();

    // 1. 将最新的 Markdown 解析为 HTML
    const newHTML = marked.parse(props.content);

    // 2. 与上一次渲染的 HTML 进行比较
    if (newHTML === lastRenderedHTML) {
        console.log('oldHtml', lastRenderedHTML)
        console.log('newHtml', newHTML)
        console.log('[Markdown-DiffDOM] Content unchanged, skip update');
        return;
    }

    try {
        // 3. 创建临时容器
        const tempContainer = document.createElement('div');
        tempContainer.innerHTML = newHTML;

        // 4. 计算并应用差异
        const diffs = diffEngine.diff(markdownContainerRef.value, tempContainer);

        if (diffs && diffs.length > 0) {
            console.log(`[Markdown-DiffDOM] Found ${diffs.length} differences`);

            // 应用差异
            const result = diffEngine.apply(markdownContainerRef.value, diffs);
            console.log('[Markdown-DiffDOM] Result:', markdownContainerRef.value);

            if (result !== false) {
                console.log('[Markdown-DiffDOM] Changes applied successfully');

                // 5. 更新记录
                lastRenderedHTML = newHTML;

                // 6. 性能统计
                const duration = performance.now() - startTime;
                console.log(`[Markdown-DiffDOM] Update completed in ${duration.toFixed(2)}ms`);

                // 7. 触发事件
                emit("render-complete");
            } else {
                console.error('[Markdown-DiffDOM] Failed to apply changes');
            }
        } else {
            console.log('[Markdown-DiffDOM] No differences found');
            lastRenderedHTML = newHTML;
        }
    } catch (error) {
        console.error('[Markdown-DiffDOM] Error:', error);

        // 降级方案：全量替换
        console.warn('[Markdown-DiffDOM] Fallback to full replacement');
        markdownContainerRef.value.innerHTML = newHTML;
        lastRenderedHTML = newHTML;
        emit("render-complete");
    }
};

/**
 * 防抖版本的渲染函数
 * 延迟时间：50ms（适合流式输出场景）
 */
const debouncedRenderWithDiffDOM = useDebounceFn(() => {
    console.log('[Markdown-Debounce] Executing debounced render');
    renderWithDiffDOM();
}, 50); // 50ms 延迟，可根据需要调整

// 🔹 监听 content 变化，根据 debounced 属性决定渲染策略
watch(
    () => props.content,
    (newContent, oldContent) => {
        console.log('[Markdown-DiffDOM] Content updated:', {
            newLength: newContent?.length,
            oldLength: oldContent?.length,
            debounced: props.debounced
        });

        // 根据 debounced 属性选择渲染方式
        //nextTick(() => {
        if (props.debounced) {
            // 消抖模式：延迟渲染，减少流式输出时的频繁更新
            console.log('[Markdown-Debounce] Using debounced render mode');
            debouncedRenderWithDiffDOM();
        } else {
            // 即时模式：立即渲染，保持编辑模式的响应性
            console.log('[Markdown-DiffDOM] Using immediate render mode');
            renderWithDiffDOM();
        }
        //});
    },
    //{ immediate: true }
);

// 🔹 生命周期：清理资源
onBeforeUnmount(() => {
    // useDebounceFn 返回的函数不需要手动清理
    // VueUse 会自动处理

    console.log('[Markdown] Component unmounted, cleanup completed');
});
</script>

<style scoped>
@reference "tailwindcss";

.markdown-content {
    position: relative;
}

/* ✅ 新增内容的淡入动画 */
.markdown-content>* {
    /* animation: fadeIn 0.3s ease; */
}

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
