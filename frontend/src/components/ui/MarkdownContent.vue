<template>
    <!-- 方案二：DOM 节点级增量更新 -->
    <div class="markdown-content" @click="handleCodeBlockClick">
        <div ref="markdownContainerRef"></div>
    </div>
</template>
<script setup lang="ts">
import { watch, ref, onMounted, computed } from 'vue';

import { useI18n } from 'vue-i18n';
import { useMarkdown, delegateMarkdownCodeClick } from "../../composables/useMarkdown";
import { useDiffDOM } from "../../composables/useDiffDOM";
import { useThrottledValue } from "../../composables/useThrottledValue";
import { createBlockCachedRenderer, type BlockRenderResult } from "../../utils/markdownBlocks";
import { DiffDOM } from 'diff-dom';
import { perfStart } from '../../utils/perf';
import { toast } from '@/components/ui/toastService';

const { marked } = useMarkdown()
const { t } = useI18n()

// 代码块 markup 由 code renderer 产出，行为挂在本组件：所有 markdown 消费方
// （对话流、思考区、插件文档…）都不必各写一遍委托，也不会出现"按钮按了没反应"。
const handleCodeBlockClick = (event: MouseEvent) => {
    delegateMarkdownCodeClick(event, (ok) => {
        if (ok) toast.success(t('chat.turn.codeCopied'));
        else toast.error(t('common.copyFailed'));
    });
};


// 定义 Props - 类型化
const props = withDefaults(defineProps<{
    content: string;
    /** 流式正文：渲染值走节流（150ms），避免每个 SSE chunk 整篇 parse + 全树 diff */
    streaming?: boolean;
}>(), {
    streaming: false,
});

// 流式节流：leading 立即、trailing 必达；非流式（静态文档/面板切换）走原值立即渲染，
// 不会出现"切内容后仍显示上一份"的滞后（与 PlanPanel 的条件节流策略一致）。
const STREAM_RENDER_INTERVAL_MS = 150;
const throttledContent = useThrottledValue(() => props.content, STREAM_RENDER_INTERVAL_MS);
const renderedContent = computed(() => (props.streaming ? throttledContent.value : props.content));

// 块级渲染缓存：流式追加时复用稳定块的 HTML，只重渲染尾部块
const blockRenderer = createBlockCachedRenderer(marked);

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
const initialRender = () => {
    const container = markdownContainerRef.value;
    if (!container) return;

    const content = renderedContent.value;
    if (!content) {
        blockRenderer.reset();
        container.innerHTML = '';
        lastRenderedHTML = '';
        return;
    }

    const chars = content.length;

    // 块级渲染是同步的（marked async:false），只对同步 parse 计时。
    const parseSpan = perfStart('markdown.initial.parse');
    let result: BlockRenderResult | null = null;
    try {
        result = blockRenderer.render(content);
    } catch (error) {
        console.error('[MarkdownContent] Markdown 解析失败:', error);
        return;
    } finally {
        parseSpan?.end({ chars, blocks: result?.blocks ?? 0, reused: result?.reused ?? 0 });
    }
    if (!result) return;

    const domSpan = perfStart('markdown.initial.dom');
    try {
        container.innerHTML = result.html;
        lastRenderedHTML = result.html;
    } finally {
        domSpan?.end({ chars });
    }
};

/**
 * 使用 diff-dom 进行增量更新
 * 专业的 DOM 差异对比和更新库
 */
const renderWithDiffDOM = () => {
    // 局部常量承载 ref 值：diff-dom 调用需要非空值
    const container = markdownContainerRef.value;
    if (!container) return;

    const content = renderedContent.value;

    // 内容变空（编辑清空/切换）时必须清掉旧 DOM，否则残留上一份内容
    if (!content) {
        blockRenderer.reset();
        if (lastRenderedHTML !== '') {
            container.innerHTML = '';
            lastRenderedHTML = '';
        }
        return;
    }

    // 1. 渲染为最新 HTML（稳定块复用缓存，尾部块重渲染并高亮）
    const parseSpan = perfStart('markdown.parse');
    let result: BlockRenderResult | null = null;
    try {
        result = blockRenderer.render(content);
    } catch (error) {
        // 解析失败保留上一帧 DOM，避免整块内容被清空
        console.error('[MarkdownContent] Markdown 解析失败:', error);
        return;
    } finally {
        parseSpan?.end({ chars: content.length, blocks: result?.blocks ?? 0, reused: result?.reused ?? 0 });
    }
    if (!result) return;
    const newHTML = result.html;

    // 2. 与上一次渲染的 HTML 进行比较
    if (newHTML === lastRenderedHTML) {
        return;
    }
    const diffSpan = perfStart('markdown.diff');
    try {
        // 3. 创建临时容器
        const tempContainer = document.createElement('div') as HTMLElement;
        tempContainer.innerHTML = newHTML;

        // 4. 计算并应用差异
        if (!diffEngine) return;

        const diffs = diffEngine.diff(container, tempContainer);

        if (diffs && diffs.length > 0) {
            const applied = diffEngine.apply(container, diffs);

            if (applied !== false && applied !== undefined) {
                // 5. 更新记录
                lastRenderedHTML = newHTML;
            } else {
                console.error('[Markdown-DiffDOM] Failed to apply changes');
            }
        } else {
            lastRenderedHTML = newHTML;
        }
    } catch (error) {
        console.error('[Markdown-DiffDOM] Error:', error);

        // 降级方案：全量替换
        console.warn('[Markdown-DiffDOM] Fallback to full replacement');
        container.innerHTML = newHTML;
        lastRenderedHTML = newHTML;
    } finally {
        diffSpan?.end({ html: newHTML.length });
    }
};

// 监听渲染值变化（流式时是节流后的值）
watch(
    renderedContent,
    () => {
        renderWithDiffDOM();
    },
);
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
