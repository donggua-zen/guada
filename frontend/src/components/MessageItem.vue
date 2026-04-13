<template>
    <div v-if="!streamingState.isPlaceholder" class="message" :class="messageClass" ref="rootRef">
        <div class="message-content">
            <div v-if="isAssistant" class="text-xs text-gray-400 mb-3">
                <div class="flex items-center">
                    <div class="mr-5 flex items-center">
                        <div class="w-5.5 h-5.5 mr-2 relative top-0">
                            <Avatar :src="avatar" :round="false" type="assistant" :name="currentModelName"></Avatar>
                        </div>
                        <span class="text-[1.3em] text-gray-500 font-">{{
                            currentModelName
                            }}</span>
                    </div>
                    <div class="flex items-center">
                        <div class="inline-block h-3 w-3 shrink-0 items-center justify-center mr-1 relative">
                            <AccessTimeTwotone />
                        </div><span class="" :title="currentContentTime.full">{{ currentContentTime.firendly }}</span>
                    </div>
                </div>
            </div>
            <div class="message-card">
                <template v-for="(turn, index) in turns" :key="turn.id">
                    <!-- 优化后的思考框部分 -->
                    <div v-if="turn.reasoningContent" class="thinking-section mb-3"
                        :class="{ 'expanded': isTurnExpanded(turn.id, 'thinking') }">
                        <div class="collapsible-header inline-flex justify-between items-center text-sm text-gray-700 cursor-pointer font-medium py-2 px-3 transition-colors duration-200 rounded-t-lg bg-gray-50 dark:bg-gray-800/50 border border-b-0 border-gray-200 dark:border-gray-700 w-full"
                            @click.stop="toggleExpand(turn.id, 'thinking')">
                            <div class="items-center inline-flex">
                                <el-icon class="mr-1.5" size="16">
                                    <PsychologyOutlined />
                                </el-icon>
                                <span class="text-gray-500">{{ turn.state?.isThinking ? '思考中...' : '已深度思考' }}</span>
                                <!-- 思考时长显示：优先使用 thinkingDurationMs，如果没有则从 metaData 读取 -->
                                <span v-if="getThinkingDuration(turn)" class="text-xs text-gray-400 ml-2">
                                    <template v-if="turn.state?.isThinking">
                                        已思考 {{ formatDuration(getThinkingDuration(turn)) }}
                                    </template>
                                    <template v-else>
                                        思考耗时 {{ formatDuration(getThinkingDuration(turn)) }}
                                    </template>
                                </span>
                            </div>
                            <el-icon
                                :class="['transition-transform duration-300 ml-2', isTurnExpanded(turn.id, 'thinking') ? 'rotate-90' : 'rotate-0']"
                                size="10">
                                <ArrowRightTwotone />
                            </el-icon>
                        </div>

                        <div class="thinking-container" :class="{ expanded: isTurnExpanded(turn.id, 'thinking') }">
                            <div class="thinking-content-wrapper">
                                <MarkdownContent @click.stop="handleClick"
                                    class="thinking-content markdown-text py-3 px-4 pl-4 border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400"
                                    :content="turn.reasoningContent" :debounced="turn.state?.isStreaming"
                                    @render-complete="handleRenderComplete" />
                            </div>
                        </div>
                    </div>
                    <MarkdownContent v-if="turn.content" class="message-text markdown-text" @click="handleClick"
                        @render-complete="handleRenderComplete" :content="turn.content"
                        :debounced="turn.state?.isStreaming" />
                    <!-- 优化工具调用显示 -->
                    <div v-if="turn.additionalKwargs && turn.additionalKwargs.toolCalls" class="tool-calls-section mb-3"
                        :class="{ 'expanded': isTurnExpanded(turn.id, 'tool') }">
                        <div class="collapsible-header flex items-center text-sm font-medium text-gray-600 dark:text-gray-400 py-2 px-3 cursor-pointer rounded-t-lg bg-gray-50 dark:bg-gray-800/50 border border-b-0 border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors duration-200"
                            @click.stop="toggleExpand(turn.id, 'tool')">
                            <div class="flex items-center flex-1">
                                <el-icon class="mr-1.5" size="16">
                                    <BuildTwotone />
                                </el-icon>
                                <span>工具调用</span>
                                <span
                                    class="ml-2 text-xs text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">
                                    {{ turn.additionalKwargs.toolCalls.length }} 个工具
                                </span>
                            </div>
                            <el-icon
                                :class="['transition-transform duration-300', isTurnExpanded(turn.id, 'tool') ? 'rotate-90' : 'rotate-0']"
                                size="10">
                                <ArrowRightTwotone />
                            </el-icon>
                        </div>

                        <div class="tool-calls-container" :class="{ expanded: isTurnExpanded(turn.id, 'tool') }">
                            <div class="tool-calls-list-wrapper">
                                <div
                                    class="tool-calls-list space-y-2 p-3 border border-t-0 border-gray-200 dark:border-gray-700 rounded-b-lg bg-white dark:bg-gray-900/50">
                                    <div v-for="(tool, toolIndex) in turn.additionalKwargs.toolCalls" :key="toolIndex"
                                        class="tool-call-item transition-all">

                                        <!-- 工具名称和参数 -->
                                        <div class="tool-info mb-2">
                                            <div class="flex items-center gap-2 mb-1.5">
                                                <span
                                                    class="tool-name text-sm font-semibold text-blue-600 dark:text-blue-400">
                                                    {{ tool.name || 'Unknown Tool' }}
                                                </span>
                                                <span class="text-xs text-gray-400">•</span>
                                                <span class="text-xs text-gray-500 dark:text-gray-400">
                                                    调用 #{{ (toolIndex as number) + 1 }}
                                                </span>
                                            </div>

                                            <!-- 工具参数 -->
                                            <div v-if="tool.arguments || tool.args" class="tool-arguments mt-1.5">
                                                <div
                                                    class="text-xs text-gray-500 dark:text-gray-400 mb-1 flex items-center">
                                                    <el-icon size="12" class="mr-1">
                                                        <SettingsOutlined />
                                                    </el-icon>
                                                    参数
                                                </div>
                                                <pre
                                                    class="bg-white dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded p-2 text-xs overflow-x-auto text-gray-700 dark:text-gray-300">
                                <code>{{ formatToolArgs(tool.arguments || tool.args) }}</code>
                            </pre>
                                            </div>
                                        </div>

                                        <!-- 工具调用响应结果 -->
                                        <div v-if="turn.additionalKwargs.toolCallsResponse"
                                            class="tool-response mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                                            <div
                                                class="text-xs text-gray-500 dark:text-gray-400 mb-1 flex items-center">
                                                <el-icon size="12" class="mr-1">
                                                    <CheckCircleOutlined />
                                                </el-icon>
                                                响应结果
                                            </div>
                                            <div
                                                class="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded p-2 text-xs text-green-800 dark:text-green-300">
                                                <pre class="overflow-x-auto">{{
                                                    formatToolResponse(turn.additionalKwargs.toolCallsResponse[toolIndex])
                                }}</pre>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>


                </template>
                <el-alert v-if="metadata && metadata.finishReason == 'error'" title="API 请求错误" type="error"
                    :closable="false">
                    {{ metadata.error }}
                </el-alert>

                <!-- 新增：Token 消耗显示区域 -->
                <div v-if="isAssistant && tokenUsage && !streamingState.isStreaming" class="token-usage-section mt-2">
                    <div class="flex items-center gap-3 text-xs text-gray-400">
                        <el-icon size="13" class="text-gray-400">
                            <InsightsTwotone />
                        </el-icon>
                        <span class="text-gray-500">Tokens:</span>
                        <span class="token-item">
                            <span class="text-gray-400 dark:text-gray-300 text-xs">Prompt</span>&nbsp;<span
                                class="text-gray-500 dark:text-gray-300">{{ formatTokenNumber(tokenUsage.promptTokens)
                                }}</span>
                        </span>
                        <span class="token-item">
                            <span class="text-gray-400 dark:text-gray-300">Completion</span>&nbsp;<span
                                class="text-gray-500 dark:text-gray-300">{{
                                    formatTokenNumber(tokenUsage.completionTokens) }}</span>
                        </span>
                        <span class="token-item">
                            <span class="text-gray-400 dark:text-gray-300">Total</span>&nbsp;<span
                                class="text-gray-500 dark:text-gray-300">{{
                                    formatTokenNumber(tokenUsage.totalTokens) }}</span>
                        </span>
                    </div>
                </div>

                <div v-if="streamingState.isStreaming" class="assistant-loading flex items-center text-gray-500"
                    style="position: sticky;top:0;">
                    <el-icon size="16" class="mr-2 relative top-0">
                        <Loading />
                    </el-icon>
                    回答中
                </div>

            </div>
            <!--知识库-->
            <div class="knowledge-base flex flex-wrap gap-2 mt-3 ml-auto"
                v-if="message.role === 'user' && turns[0].additionalKwargs?.referencedKbs && turns[0].additionalKwargs?.referencedKbs.length > 0">
                <div v-for="kb, index in turns[0].additionalKwargs?.referencedKbs" :key="kb.id">
                    <div
                        class="knowledge-base-item rounded-md px-2 py-1 bg-gray-100 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 text-xs flex items-center gap-1">
                        <MenuBookOutlined class="w-4 h-4" />
                        {{ kb.name }}
                    </div>
                </div>
            </div>
            <!-- 文件列表显示区域 -->

            <div class="file-list flex flex-wrap gap-2 mt-3 ml-auto" v-if="message.files && message.files.length > 0">
                <FileItem v-for="file, index in message.files" :key="file.id" :name="file.displayName"
                    :type="file.fileType" :ext="file.fileExtension" :size="file.fileSize" :preview-url="file.previewUrl"
                    :clickable="file.fileType === 'image'" @click="handleImageClick(index as number)"></FileItem>
            </div>
            <div class="message-actions flex gap-0 text-sm w-full mt-3 text-gray-500 items-center"
                v-if="!streamingState.isStreaming"
                :class="[isAssistant ? 'justify-start' : 'justify-end', message.isStreaming ? 'opacity-0' : 'opacity-100']">


                <div class="message-action-button" @click="handleAction('copy')">
                    <el-icon :size="16">
                        <Copy24Filled />
                    </el-icon>
                </div>

                <template v-if="!isAssistant && props.allowGenerate">
                    <div class="message-action-button" @click="handleAction('generate')">
                        <el-icon :size="16">
                            <ArrowDownwardTwotone />
                        </el-icon>
                    </div>
                </template>

                <template v-if="isAssistant && props.isLast">
                    <div class="message-action-button" @click="handleAction('regenerate')">
                        <el-icon :size="16">
                            <ArrowCounterclockwise24Filled />
                        </el-icon>
                    </div>
                </template>

                <!-- 内容切换按钮（如果需要） -->
                <template v-if="isLast && message.contents.length > 1">
                    <div class="message-action-button" @click="switchContent('prev')" :disabled="!hasPrevContent">
                        <el-icon :size="16">
                            <ChevronLeft24Filled />
                        </el-icon>
                    </div>
                    <div class="text-gray-700 transition-colors duration-200 flex items-center py-1">
                        {{ getCurrentVersionIndex(message.contents) + 1 }} / {{ contentVersions.length }}
                    </div>
                    <div class="message-action-button" @click="switchContent('next')" :disabled="!hasNextContent">
                        <el-icon :size="16">
                            <ChevronRight24Filled />
                        </el-icon>
                    </div>
                </template>

                <!-- 更多按钮下拉菜单 -->
                <el-dropdown trigger="click" @command="handleMoreAction">
                    <div class="message-action-button">
                        <el-icon :size="16">
                            <MoreVertical24Filled />
                        </el-icon>
                    </div>
                    <template #dropdown>
                        <el-dropdown-menu>
                            <el-dropdown-item command="edit">
                                <div class="flex items-center">
                                    <el-icon class="mr-2">
                                        <EditTwotone />
                                    </el-icon>
                                    编辑内容
                                </div>
                            </el-dropdown-item>
                            <el-dropdown-item command="delete">
                                <div class="flex items-center">
                                    <el-icon class="mr-2">
                                        <DeleteTwotone />
                                    </el-icon>
                                    删除消息
                                </div>
                            </el-dropdown-item>
                        </el-dropdown-menu>
                    </template>
                </el-dropdown>

            </div>
        </div>
    </div>
    <el-image-viewer v-if="showImageViewer" v-model:visible="showImageViewer" :url-list="previewList"
        :initial-index="currentPreViewIndex" @close="showImageViewer = false" :teleported="true" />
</template>

<script setup lang="ts">
import { computed, ref, watch, onUnmounted, onMounted, onBeforeUnmount, h, nextTick, type Ref } from "vue";
import { ElAlert, ElIcon, ElImageViewer, ElDropdown, ElDropdownMenu, ElDropdownItem } from "element-plus";
import { useDebounceFn } from "@vueuse/core";
import {
    EditTwotone,
    DeleteTwotone,
    ArrowDownwardTwotone,
    AccessTimeTwotone,
    BuildTwotone,
    SettingsOutlined,
    CheckCircleOutlined,
    PsychologyOutlined,
    InsightsTwotone, // Token 消耗显示图标
    MenuBookOutlined,
} from "@vicons/material";
import {
    Copy24Filled,
    ArrowCounterclockwise24Filled,
    MoreVertical24Filled,
    ChevronLeft24Filled,
    ChevronRight24Filled
} from '@vicons/fluent'

// @ts-ignore - icons 组件尚未迁移到 TypeScript
import { Loading } from "./icons";
// @ts-ignore - UI 组件尚未迁移到 TypeScript
import { FileItem, Avatar } from "./ui";
import { usePopup } from "../composables/usePopup";
import { formatTime } from '../utils'
import { getCurrentTurns, getContentVersions } from '@/utils/messageUtils'


const { toast } = usePopup();

const props = defineProps({
    message: {
        type: Object,
        required: true
    },
    avatar: String,
    isLast: {
        type: Boolean,
        default: false
    },
    allowGenerate: {
        type: Boolean,
        default: false
    }
});

// 类型化 emit 定义
const emit = defineEmits<{
    switch: [message: any, content: any]
    delete: [message: any]
    edit: [message: any]
    copy: [message: any]
    generate: [message: any]
    regenerate: [message: any]
    'render-complete': [message: any]
}>();

// ============================================
// 🔹 响应式数据
// ============================================
const showImageViewer = ref(false);
const currentPreViewIndex = ref(0);
const expandedStates = ref<Map<string, boolean>>(new Map()); // 使用 Map 存储不同区域的展开状态：{ [turnId_type]: boolean }
const rootRef = ref<HTMLElement | null>(null);

// ============================================
// 🔹 ResizeObserver + 图片加载监听机制
// ============================================
let resizeObserver: ResizeObserver | null = null;

/**
 * 防抖触发 render-complete 事件
 * 避免频繁触发滚动逻辑，延迟 200ms
 * 使用 VueUse 的 useDebounceFn 官方实现
 */
const debouncedEmitRenderComplete = useDebounceFn(() => {
    // console.log('[MessageItem] Render complete triggered by ResizeObserver or image load');
    emit('render-complete', props.message);
}, 200); // 200ms 防抖延迟

/**
 * 等待图片加载完成
 * 确保所有可见图片都加载完成后才触发滚动
 */
const waitForImagesLoaded = async (): Promise<void> => {
    if (!rootRef.value) return;

    const images = Array.from(rootRef.value.querySelectorAll('img'));

    if (images.length === 0) {
        return; // 没有图片，直接返回
    }

    console.log(`[MessageItem] Waiting for ${images.length} image(s) to load`);

    const promises = images.map(img => {
        if (img.complete) {
            // 已经加载完成
            return Promise.resolve();
        }

        // 等待加载完成或失败
        return new Promise<void>(resolve => {
            const onLoad = () => {
                console.log('[MessageItem] Image loaded:', img.src);
                resolve();
            };

            img.addEventListener('load', onLoad, { once: true });
            img.addEventListener('error', () => {
                console.warn('[MessageItem] Image failed to load:', img.src);
                resolve(); // 即使失败也继续，避免阻塞
            }, { once: true });
        });
    });

    await Promise.all(promises);
    console.log('[MessageItem] All images loaded');
};

/**
 * 初始化 ResizeObserver 监听 DOM 尺寸变化
 * 捕获所有导致高度变化的情况（图片加载、内容展开、动画等）
 */
// const initResizeObserver = () => {
//   if (!rootRef.value) return;

//   const targetElement = rootRef.value.querySelector('.message-card');
//   if (!targetElement) return;

//   resizeObserver = new ResizeObserver((entries) => {
//     for (const entry of entries) {
//       // 只有当高度发生变化时才触发
//       if (entry.contentRect.height > 0) {
//         // console.log('[MessageItem] Content height changed:', entry.contentRect.height);
//         // debouncedEmitRenderComplete();
//         emit('render-complete', props.message);
//       }
//     }
//   });

//   resizeObserver.observe(targetElement);
//   // console.log('[MessageItem] ResizeObserver initialized');
// };

/**
 * 监听文件列表变化，处理图片加载
 */
watch(
    () => props.message.files,
    async (newFiles) => {
        if (newFiles && newFiles.length > 0) {
            // 等待下一帧，确保 DOM 已经更新
            await nextTick();

            // 等待图片加载完成
            //await waitForImagesLoaded();

            // 图片加载完成后触发渲染完成事件
            //debouncedEmitRenderComplete();
        }
    },
    { immediate: true }
);

const previewList = computed(() => {
    const files = props.message.files || [];
    return files.map((file: any) => file.url || file.previewUrl);
})

const isAssistant = computed(() => props.message.role === "assistant");
const messageClass = computed(() =>
    isAssistant.value ? "assistant-message-container" : "user-message-container"
);
// const avatarClass = computed(() =>
//   isAssistant.value ? "assistant-avatar" : "user-avatar"
// );

const turns = computed(() => {
    // 使用工具函数获取当前版本的内容
    return getCurrentTurns(props.message as any)
})

// const hasThinking = computed(
//   () => isAssistant.value && getCurrentContent(props.message.contents).reasoningContent
// );

const metadata = computed(() => {
    const content = turns.value[0];
    return content.metaData;
});


// 优化：使用更精确的依赖
const state = computed(() =>
    isAssistant.value ? props.message.state : null
);

const streamingState = computed(() => ({
    isStreaming: state.value?.isStreaming ?? false,
    isThinking: state.value?.isThinking ?? false,
    isWebSearching: state.value?.isWebSearching ?? false,
    isPlaceholder: false
}));

const currentModelName = computed(() => {
    const modelName = metadata.value?.modelName;
    return modelName
        ? modelName.split("/").pop()
        : "unknown"
});

const currentContentTime = computed(() => {
    const content = turns.value[0];
    return {
        firendly: formatTime(content.createdAt || '', 'friendly'),
        full: formatTime(content.createdAt || '', 'full')
    };
})

// 新增：获取 token usage 的计算属性
const tokenUsage = computed(() => {
    if (!isAssistant.value || !turns.value || turns.value.length === 0) {
        return null;
    }

    // 获取最后一个 turn 的 metaData.usage
    const lastTurn = turns.value[turns.value.length - 1];
    return lastTurn?.metaData?.usage || null;
});

// 计算是否有上一个/下一个内容
const hasPrevContent = computed(() => {
    const currentIndex = getCurrentVersionIndex()
    return currentIndex > 0
})

const hasNextContent = computed(() => {
    const currentIndex = getCurrentVersionIndex() + 1
    return currentIndex < contentVersions.value.length
})

// 获取当前索引（本地实现，不再依赖废弃的函数）
const getCurrentVersionIndex = (contents?: any): number => {
    if (!contents) {
        return contentVersions.value.findIndex(version => version === props.message.currentTurnsId)
    }
    return contentVersions.value.findIndex(version => version === props.message.currentTurnsId)
}


// 🔹 生命周期：初始化 ResizeObserver（延迟到 DOM 完全渲染后）
// onMounted(() => {
//   nextTick(() => {
//     initResizeObserver();
//   });
// });


// moreOptions 计算属性已废弃，不再使用

/**
 * Markdown 渲染完成处理
 * 保留原有逻辑，与 ResizeObserver 协同工作
 */
const handleRenderComplete = () => {
    // console.log('[MessageItem] Markdown render complete event received');
    // Markdown 渲染完成后立即触发，不需要等待防抖
    // emit('render-complete', props.message);
};

const toggleExpand = (turnId: string, type: 'thinking' | 'tool') => {
    const key = `${turnId}_${type}`;
    // 工具调用框默认闭合，思考框默认展开
    const defaultState = type === 'tool' ? false : true;
    const currentState = expandedStates.value.get(key) ?? defaultState;
    expandedStates.value.set(key, !currentState);
    // 触发响应式更新
    expandedStates.value = new Map(expandedStates.value);
};

const isTurnExpanded = (turnId: string, type: 'thinking' | 'tool'): boolean => {
    const key = `${turnId}_${type}`;
    // 工具调用框默认闭合，思考框默认展开
    const defaultState = type === 'tool' ? false : true;
    return expandedStates.value.get(key) ?? defaultState;
};

const handleAction = (action: 'switch' | 'delete' | 'edit' | 'copy' | 'generate' | 'regenerate') => {
    emit(action as any, props.message);
};

const handleMoreAction = (key: 'edit' | 'delete') => {
    emit(key as any, props.message);
};

const contentVersions = computed(() => {
    // 使用工具函数获取所有版本号
    return getContentVersions(props.message as any)
})

// @ts-ignore - getCurrentVersionIndex 参数类型兼容
const switchContent = (direction: 'prev' | 'next') => {
    const currentIndex = getCurrentVersionIndex()

    if (currentIndex === -1) return

    let newIndex
    if (direction === 'prev' && currentIndex > 0) {
        newIndex = currentIndex - 1
    } else if (direction === 'next' && currentIndex < contentVersions.value.length - 1) {
        newIndex = currentIndex + 1
    } else {
        return
    }

    // 通过事件通知父组件切换内容
    emit('switch', props.message, contentVersions.value[newIndex])
}

// isExpanded 变量已废弃，使用 expandedStates Map 替代

const handleImageClick = (index: number) => {
    currentPreViewIndex.value = index;
    showImageViewer.value = true;
};

// 🔹 生命周期：清理资源
onBeforeUnmount(() => {
    // 清理 ResizeObserver
    if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
        // console.log('[MessageItem] ResizeObserver disconnected');
    }

    // useDebounceFn 会自动清理，不需要手动处理

    console.log('[MessageItem] Component unmounted, cleanup completed');
});

const handleClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest('.copy-code-button')) {
        const button = target.closest('.copy-code-button') as HTMLElement;
        const codeBlock = button.closest('.custom-code-block');
        const codeElement = codeBlock?.querySelector('code');

        if (codeElement) {
            navigator.clipboard.writeText(codeElement.textContent).then(() => {
                toast.success("代码已复制到剪贴板")
            }).catch(err => {
                console.error('复制失败:', err)
                toast.error("复制失败")
            })
        }
    }
}

const formatToolArgs = (args: any): string => {
    if (!args) return '{}';
    try {
        // 如果是字符串，尝试解析为 JSON
        const parsed = typeof args === 'string' ? JSON.parse(args) : args;
        return JSON.stringify(parsed, null, 2);
    } catch (e) {
        // 如果解析失败，直接返回字符串
        return String(args);
    }
};

const formatToolResponse = (response: any): string => {
    if (!response) return '无响应';
    try {
        // 如果是字符串，尝试解析为 JSON
        const parsed = typeof response === 'string' ? JSON.parse(response) : response;
        return JSON.stringify(parsed['content'], null, 2);
    } catch (e) {
        // 如果解析失败，直接返回字符串
        return String(response);
    }
};

// 格式化思考时长
const formatDuration = (ms: number | null): string => {
    if (!ms) return '';
    const seconds = ms / 1000;
    if (seconds < 60) {
        return `${seconds.toFixed(1)}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = (seconds % 60).toFixed(1);
    return `${minutes}分${remainingSeconds}秒`;
};

// 格式化 token 数字：1600 -> 1.6K
const formatTokenNumber = (num: number | null): string => {
    if (!num && num !== 0) return '0';

    if (num >= 1000000) {
        // 大于 100 万，显示为 M
        return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    } else if (num >= 1000) {
        // 大于 1000，显示为 K
        return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    } else {
        // 小于 1000，直接显示
        return num.toString();
    }
};

// 获取思考时长：优先使用 metaData 中的值（后端保存的），如果没有则使用 thinkingDurationMs
const getThinkingDuration = (turn: any): number | null => {
    // 如果正在思考中，使用实时计算的 thinkingDurationMs
    if (turn.state?.isThinking) {
        return turn.thinkingDurationMs;
    }
    // 思考完成后，优先使用 metaData 中的值（后端保存的准确值）
    return turn.metaData?.thinkingDurationMs || turn.thinkingDurationMs;
};

// defineExpose 已移除，相关方法通过事件传递
// 暴露 rootRef 以便父组件可以访问 DOM 元素
defineExpose({
    el: rootRef
});
</script>

<style scoped>
@reference "tailwindcss";

/* 消息样式 */
.message {
    display: flex;
    gap: 15px;
    width: 100%;
    margin-top: 20px;
    margin-bottom: 25px;
    animation: fadeInUp 0.3s ease;
}

/* 新增卡片式设计 */
.message-card {
    font-size: var(--size-text-base);
    letter-spacing: 1px;
    transition: all 0.3s ease;
    max-width: 100%;
}

/* 用户消息气泡特定样式 */
.user-message-container .message-card {
    background-color: var(--color-bubble-user-bg);
    color: var(--color-bubble-user-text);
    padding: 5px 12px;
    border-radius: 16px;
    border: 1px solid var(--color-bubble-user-border);
    margin-left: auto;
}

/* AI消息气泡特定样式 */
.assistant-message-container .message-card {
    background: var(--color-bubble-assitant-bg);
    color: var(--color-bubble-assitant-text);
    border: 1px solid var(--assistant-bubble-border-color);
    margin-right: auto;
    width: 100%;
    padding: 0;
    box-shadow: none;
    border: none;
}

.message-content {
    display: flex;
    flex-direction: column;
    position: relative;
    min-width: 0;
}

/* 修复用户消息对齐问题 */
.message.user-message-container {
    flex-direction: row-reverse;
}

.message.assistant-message-container {
    justify-content: flex-start;
}

.message.user-message-container .message-content {
    align-items: flex-start;
}

.message.assistant-message-container .message-content {
    align-items: flex-start;
    width: 100%;
}

/* 消息文本格式化 */
.message-text {
    line-height: 1.7;
    color: inherit;
    max-width: 100%;
    vertical-align: middle;
}

/* 加载动画 */
.assistant-loading {
    font-size: var(--size-text-sm);
    margin-top: 8px;
}

/* 重用的消息操作按钮样式 */
.message-action-button {
    @apply cursor-pointer flex items-center gap-1 py-1 px-1 rounded mr-1 hover:bg-(--color-surface) disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-gray-100 disabled:hover:text-gray-400 transition-transform duration-100;
}

/* 统一的折叠框样式 */
.collapsible-section {
    animation: fadeIn 0.3s ease;
}

/* 折叠框头部样式 */
.collapsible-header {
    user-select: none;
}

/* 折叠框容器样式 */
.collapsible-container {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    will-change: grid-template-rows;
    overflow: hidden;
    border-radius: 0 0 8px 8px;
}

.collapsible-container.expanded {
    grid-template-rows: 1fr;
}

.collapsible-content {
    min-height: 0;
    opacity: 0;
    transform: translateY(-8px);
    transition: opacity 0.25s ease, transform 0.25s ease;
}

.collapsible-container.expanded .collapsible-content {
    opacity: 1;
    transform: translateY(0);
}

/* 思考框特定样式 */
.thinking-section {
    border-radius: 8px;
    overflow: hidden;
}

.thinking-section .collapsible-header {
    border-radius: 8px;
    transition: border-radius 0.3s ease;
}

.thinking-section.expanded .collapsible-header,
.thinking-container.expanded~.collapsible-header {
    border-radius: 8px 8px 0 0;
}

.thinking-section:not(.expanded) .collapsible-header {
    border-radius: 8px;
    border-bottom: 1px solid var(--color-border-light, #e5e7eb) !important;
}

.dark .thinking-section:not(.expanded) .collapsible-header {
    border-bottom-color: var(--color-border-dark, #374151) !important;
}

.thinking-container {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    overflow: hidden;
}

.thinking-container.expanded {
    grid-template-rows: 1fr;
}

.thinking-content-wrapper {
    min-height: 0;
    opacity: 0;
    transform: translateY(-8px);
    transition: opacity 0.25s ease, transform 0.25s ease;
    overflow: hidden;
}

.thinking-container.expanded .thinking-content-wrapper {
    opacity: 1;
    transform: translateY(0);
}

.thinking-content {
    border: 1px solid var(--color-border-light, #e5e7eb);
    border-top: none;
    border-radius: 0 0 8px 8px;
    background-color: var(--color-bg-light, #f9fafb);
}

.dark .thinking-content {
    border-color: var(--color-border-dark, #374151);
    background-color: var(--color-bg-dark, rgba(31, 41, 55, 0.5));
}

/* 工具调用特定样式 */
.tool-calls-section {
    border-radius: 8px;
    overflow: hidden;
}

.tool-calls-section .collapsible-header {
    border-radius: 8px;
    transition: border-radius 0.3s ease;
}

.tool-calls-section.expanded .collapsible-header,
.tool-calls-container.expanded~.collapsible-header {
    border-radius: 8px 8px 0 0;
}

.tool-calls-section:not(.expanded) .collapsible-header {
    border-radius: 8px;
    border-bottom: 1px solid var(--color-border-light, #e5e7eb) !important;
}

.dark .tool-calls-section:not(.expanded) .collapsible-header {
    border-bottom-color: var(--color-border-dark, #374151) !important;
}

.tool-calls-container {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    overflow: hidden;
}

.tool-calls-container.expanded {
    grid-template-rows: 1fr;
}

.tool-calls-list-wrapper {
    min-height: 0;
    opacity: 0;
    transform: translateY(-8px);
    transition: opacity 0.25s ease, transform 0.25s ease;
    overflow: hidden;
}

.tool-calls-container.expanded .tool-calls-list-wrapper {
    opacity: 1;
    transform: translateY(0);
}

.tool-calls-list {
    padding: 12px;
    border: 1px solid var(--color-border-light, #e5e7eb);
    border-top: none;
    border-radius: 0 0 8px 8px;
    background-color: var(--color-bg-white, #ffffff);
}

.dark .tool-calls-list {
    border-color: var(--color-border-dark, #374151);
    background-color: var(--color-bg-dark, rgba(17, 24, 39, 0.5));
}

.tool-call-item {
    position: relative;
}



.tool-arguments pre,
.tool-response pre {
    white-space: pre-wrap;
    word-break: break-word;
}

@keyframes fadeIn {
    from {
        opacity: 0;
        transform: translateY(-5px);
    }

    to {
        opacity: 1;
        transform: translateY(0);
    }
}

/* Token 消耗显示样式 - 简约风格 */
.token-usage-section {
    padding: 4px 0;
    animation: fadeIn 0.3s ease;
}

.token-item {
    display: inline-flex;
    align-items: center;
    font-size: 12px;
    white-space: nowrap;
    /* 防止换行 */
}

.token-item strong {
    font-weight: 600;
    color: inherit;
}
</style>
<style>
@import "@/assets/markdown.css";
/* 全局样式：确保 v-html 中的代码高亮生效 */
@import 'highlight.js/styles/foundation.css';
</style>