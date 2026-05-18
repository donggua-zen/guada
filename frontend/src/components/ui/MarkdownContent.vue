<template>
    <!-- 方案二：DOM 节点级增量更新 -->
    <div class="markdown-content">
        <div ref="markdownContainerRef"></div>
    </div>
</template>
<script setup lang="ts">
import { watch, ref, onMounted, onBeforeUnmount, nextTick, type Ref } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import { useMarkdown } from "../../composables/useMarkdown";
import { DiffDOM } from 'diff-dom';

const { marked } = useMarkdown()
const emit = defineEmits<{
    'render-complete': []
}>();

// 定义 Props - 类型化
const props = defineProps<{
    content: string;
    debounced?: boolean;
}>();

// ============================================
// DOM 节点级增量更新（使用 diff-dom）
// ============================================
const markdownContainerRef = ref<HTMLElement | null>(null);
let lastRenderedHTML = ''; // 保存上一次渲染的完整 HTML
let diffEngine: DiffDOM | null = null; // diff-dom 实例

// 生命周期：初始化 diff-dom
onMounted(() => {
    diffEngine = new DiffDOM({
        debug: true,
        // 配置选项
        valueDiffing: true,  // 比较 input 值
        preDiffApply: (info: any) => {
            // 在应用差异前的钩子
            // if(info.diff.name === 'class')
            //     return true;
            // console.log('[DiffDOM] Pre-diff:', info);
            return false;
        }
    });
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
    emit("render-complete");
};

/**
 * 使用 diff-dom 进行增量更新
 * 专业的 DOM 差异对比和更新库
 */
const renderWithDiffDOM = async () => {
    if (!markdownContainerRef.value || !props.content) return;

    const totalStart = performance.now();

    // 1. 将最新的 Markdown 解析为 HTML
    const parseStart = performance.now();
    const newHTML = await marked.parse(props.content) as string;
    const parseDuration = performance.now() - parseStart;

    // 2. 与上一次渲染的 HTML 进行比较
    if (newHTML === lastRenderedHTML) {
        return;
    }
    try {
        // 3. 创建临时容器
        const tempStart = performance.now();
        const tempContainer = document.createElement('div') as HTMLElement;
        tempContainer.innerHTML = newHTML;
        const tempDuration = performance.now() - tempStart;

        // 4. 计算并应用差异
        if (!diffEngine) return;

        const diffStart = performance.now();
        // @ts-ignore - diff-dom 库的类型定义不完整
        const diffs = diffEngine.diff(markdownContainerRef.value, tempContainer);
        const diffDuration = performance.now() - diffStart;

        if (diffs && diffs.length > 0) {
            // 应用差异
            if (!diffEngine) return;

            const applyStart = performance.now();
            const result = diffEngine.apply(markdownContainerRef.value, diffs) as any;
            const applyDuration = performance.now() - applyStart;

            if (result !== false && result !== undefined) {
                // 5. 更新记录
                lastRenderedHTML = newHTML as string;

                // 6. 性能统计
                const totalDuration = performance.now() - totalStart;

                // 输出所有渲染的性能日志（用于调试）
                console.log(`[性能监控] Markdown 渲染耗时: ${totalDuration.toFixed(2)}ms`, {
                    '内容长度': props.content.length,
                    'marked.parse': `${parseDuration.toFixed(2)}ms`,
                    '创建临时DOM': `${tempDuration.toFixed(2)}ms`,
                    'diff计算': `${diffDuration.toFixed(2)}ms`,
                    '应用差异': `${applyDuration.toFixed(2)}ms`,
                    '差异数量': diffs.length
                });

                // 7. 触发事件
                emit("render-complete");
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
        emit("render-complete");
    }
};

/**
 * 防抖版本的渲染函数
 * 延迟时间：50ms（适合流式输出场景）
 */
let debounceCallCount = 0;
let lastDebounceCallTime = 0;
const debouncedRenderWithDiffDOM = useDebounceFn(() => {
    const now = Date.now();
    const timeSinceLastCall = now - lastDebounceCallTime;
    debounceCallCount++;
    console.log(`[性能监控] 防抖渲染执行 #${debounceCallCount}, 距上次调用: ${timeSinceLastCall}ms`);
    renderWithDiffDOM();
}, 50, { maxWait: 100 }); // 50ms 延迟，可根据需要调整

// 监听 content 变化，根据 debounced 属性决定渲染策略
watch(
    () => props.content,
    (newContent, oldContent) => {
        const watchStartTime = performance.now();
        // console.log('[Markdown-DiffDOM] Content updated:', {
        //     newLength: newContent?.length,
        //     oldLength: oldContent?.length,
        //     debounced: props.debounced
        // });

        // 根据 debounced 属性选择渲染方式
        //nextTick(() => {
        if (props.debounced) {
            // 消抖模式：延迟渲染，减少流式输出时的频繁更新
            const now = Date.now();
            lastDebounceCallTime = now;
            debounceCallCount++; // 记录调用次数
            console.log(`[性能监控] 防抖函数被调用 #${debounceCallCount}, content长度: ${newContent?.length}, watch耗时: ${(performance.now() - watchStartTime).toFixed(2)}ms`);
            debouncedRenderWithDiffDOM();
        } else {
            // 即时模式：立即渲染，保持编辑模式的响应性
            // console.log('[Markdown-DiffDOM] Using immediate render mode');
            renderWithDiffDOM();
        }
        //});
    },
    //{ immediate: true }
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
