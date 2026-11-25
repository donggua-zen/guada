<template>
    <!-- 方案二：DOM 节点级增量更新 -->
    <div class="markdown-content" @click="handleClick" @keydown="handleKeydown" @load.capture="handleImageEvent"
        @error.capture="handleImageEvent">
        <div ref="markdownContainerRef"></div>
    </div>
</template>
<script setup lang="ts">
import { watch, ref, onMounted, computed, onBeforeUnmount } from 'vue';

import { useI18n } from 'vue-i18n';
import { useMarkdown, delegateMarkdownCodeClick, createMarkedInstance } from "../../composables/useMarkdown";
import { useDiffDOM } from "../../composables/useDiffDOM";
import { useThrottledValue } from "../../composables/useThrottledValue";
import { createGroupedBlockRenderer, type GroupedRenderResult } from "../../utils/markdownImageBlocks";
import { applyImageNaturalSize, renderMarkdownImageCard, type MarkdownImageResolution } from "../../utils/markdownImages";
import { DiffDOM } from 'diff-dom';
import { perfStart } from '../../utils/perf';
import { toast } from '@/components/ui/toastService';
// 图片卡片样式必须跟着组件走：卡片是 v-html 注入的节点，scoped 样式够不到，
// 放在组件里可保证任何消费方（对话流 / 临时预览页 / 未来新入口）都不会漏引入。
import '@/assets/markdown-images.css';

const props = withDefaults(defineProps<{
    content: string;
    /** 流式正文：渲染值走节流（150ms），避免每个 SSE chunk 整篇 parse + 全树 diff */
    streaming?: boolean;
    /**
     * 消息所属会话。给了它才会把正文里的图片解析到该会话的工作目录，
     * 并启用卡片式展示 / 点击预览 / 失败重试。不传则保持原先的普通 `<img>` 行为
     * （知识库、插件文档等消费方无需关心工作目录）。
     */
    sessionId?: string;
    /**
     * 图片地址解析覆盖（仅临时预览页使用）：注入演示/自选来源，复用同一套卡片与分组。
     * 生产链路不要传，交给 sessionId 走会话工作目录解析。
     */
    resolveImage?: (src: string) => MarkdownImageResolution;
}>(), {
    streaming: false,
    sessionId: '',
    resolveImage: undefined,
});

const emit = defineEmits<{
    /** 需要打开大图预览：同组图片的地址列表 + 当前索引 */
    previewImage: [urls: string[], index: number];
    /**
     * 用户点了某张图片的「重试」。生产链路无需处理（换地址重请即可）；
     * 临时预览页用它模拟「文件稍后生成」的场景。
     */
    retryImage: [src: string];
}>();

const { t } = useI18n()

// 代码块 markup 由 code renderer 产出，行为挂在本组件：所有 markdown 消费方
// （对话流、思考区、插件文档…）都不必各写一遍委托，也不会出现"按钮按了没反应"。
const handleClick = (event: MouseEvent) => {
    delegateMarkdownCodeClick(event, (ok) => {
        if (ok) toast.success(t('chat.turn.codeCopied'));
        else toast.error(t('common.copyFailed'));
    });

    const target = event.target as HTMLElement;
    const card = target.closest<HTMLElement>('.markdown-image-card');
    if (!card) return;
    // 图片嵌在 Markdown 链接里时也优先预览，不触发链接跳转
    event.preventDefault();
    event.stopPropagation();

    if (target.closest('[data-md-image-retry]')) {
        retryImage(card);
        return;
    }
    openImagePreview(card);
};

const handleKeydown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (!target.classList?.contains('markdown-image-card')) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openImagePreview(target);
};

// ── 图片交互 ──

/** 该图片的重试次数：换一个带 `_mdRetry` 的地址强制浏览器重新请求 */
const imageRetries = new Map<string, number>();

function retryImage(card: HTMLElement) {
    const source = card.dataset.mdImageSrc;
    if (!source) return;
    imageRetries.set(source, (imageRetries.get(source) || 0) + 1);
    // 调用方可能需要切换图片来源（预览页模拟「文件稍后生成」）；
    // 必须在重渲染前通知，渲染时才能拿到新来源。
    emit('retryImage', source);
    // 结构随重试次数变化，必须重建缓存后重渲染
    blockRenderer.reset();
    lastRenderedHTML = '';
    renderWithDiffDOM();
}

function openImagePreview(card: HTMLElement) {
    if (card.dataset.mdImageState !== 'ready') return;
    // 同组内左右切换，独立图片只预览自身
    const scope = card.closest<HTMLElement>('[data-md-image-gallery]') ?? markdownContainerRef.value;
    const cards = Array.from(scope?.querySelectorAll<HTMLElement>('.markdown-image-card[data-md-image-state="ready"]') || []);
    const urls = cards.map((item) => item.querySelector('img')?.src || '').filter(Boolean);
    const index = Math.max(0, cards.indexOf(card));
    if (!urls.length) return;
    emit('previewImage', urls, index);
}

/** 图片加载后按原始尺寸决定卡片显示宽度（小图不放大、长图收窄容器） */
function syncImageCard(image: HTMLImageElement, event: Event) {
    const card = image.closest<HTMLElement>('.markdown-image-card');
    if (!card) return;
    if (event.type === 'load' && image.naturalWidth) {
        card.dataset.mdImageState = 'ready';
        applyImageNaturalSize(card, image.naturalWidth, image.naturalHeight);
        return;
    }
    if (event.type === 'error') card.dataset.mdImageState = 'error';
}

function handleImageEvent(event: Event) {
    if (!(event.target instanceof HTMLImageElement)) return;
    syncImageCard(event.target, event);
}

/** diff 之后补同步：patch 出来的新 img 可能已经完成加载，不再触发 load 事件 */
function syncAllImageCards() {
    markdownContainerRef.value?.querySelectorAll<HTMLImageElement>('.markdown-image-card img').forEach((image) => {
        const card = image.closest<HTMLElement>('.markdown-image-card');
        if (!card || card.dataset.mdImageState === 'error' || card.dataset.mdImageState === 'blocked') return;
        if (!image.complete) return;
        if (image.naturalWidth) {
            card.dataset.mdImageState = 'ready';
            applyImageNaturalSize(card, image.naturalWidth, image.naturalHeight);
        } else {
            card.dataset.mdImageState = 'error';
        }
    });
}

// ── Markdown 实例 ──
// 图片渲染依赖「消息所属会话」，不同消息上下文不同；useMarkdown() 是模块单例
// （只有首次 options 生效），所以有图片上下文时建独立实例，其余消费方沿用单例。
const { marked: sharedMarked } = useMarkdown();
const imageContextEnabled = computed(() => Boolean(props.sessionId || props.resolveImage));
const marked = imageContextEnabled.value
    ? createMarkedInstance({
        escapeHtml: true,
        renderImage: ({ src, alt, title }) => renderMarkdownImageCard({
            src,
            alt,
            title,
            sessionId: props.sessionId,
            resolveImage: props.resolveImage,
            retry: imageRetries.get(src) || 0,
        }),
    })
    : sharedMarked;

// 流式节流：leading 立即、trailing 必达；非流式（静态文档/面板切换）走原值立即渲染，
// 不会出现"切内容后仍显示上一份"的滞后（与 PlanPanel 的条件节流策略一致）。
const STREAM_RENDER_INTERVAL_MS = 150;
const throttledContent = useThrottledValue(() => props.content, STREAM_RENDER_INTERVAL_MS);
const renderedContent = computed(() => (props.streaming ? throttledContent.value : props.content));

// 块级渲染缓存：流式追加时复用稳定块的 HTML，只重渲染尾部块；
// 分组在 token 阶段完成（相邻纯图片段落合并成画廊），不做渲染后的 DOM 扫描。
const blockRenderer = createGroupedBlockRenderer(marked);

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
    let result: GroupedRenderResult | null = null;
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
    syncAllImageCards();
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
    let result: GroupedRenderResult | null = null;
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
    syncAllImageCards();
};

// 监听渲染值变化（流式时是节流后的值）
watch(
    renderedContent,
    () => {
        renderWithDiffDOM();
    },
);

onBeforeUnmount(() => {
    imageRetries.clear();
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
        transform: none;
    }
}
</style>
