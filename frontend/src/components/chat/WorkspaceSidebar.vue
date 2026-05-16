<template>
    <div
        class="workspace-sidebar h-full flex flex-col bg-white dark:bg-[#1a1b1e] border-l border-gray-200 dark:border-[#2e3035]">
        <!-- 可拖拽分割区域 -->
        <LiteSplitpanes
            class="flex-1"
            :horizontal="!isHorizontalLayout"
            :pane1="{ size: selectedFile ? (isHorizontalLayout ? 40 : 60) : 100, minSize: 30, maxSize: 100 }"
            :pane2="{ size: selectedFile ? (isHorizontalLayout ? 60 : 40) : 0, minSize: 0, maxSize: 100 }"
        >
            <template #pane1>
                <div class="flex flex-col h-full">
                    <!-- 头部（仅在左侧目录树显示） -->
                    <div
                        class="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-[#2e3035]">
                        <h3 class="text-sm font-semibold text-gray-700 dark:text-[#e8e9ed]">工作目录</h3>
                        <div class="flex items-center gap-2">
                            <!-- 打开文件夹按钮（仅 Electron 环境） -->
                            <el-tooltip v-if="isElectron" content="在文件管理器中打开" placement="bottom">
                                <el-button :icon="FolderOpened" circle size="small" @click="openInFileManager" />
                            </el-tooltip>
                            <!-- 布局切换按钮 -->
                            <el-tooltip :content="isHorizontalLayout ? '切换为上下布局' : '切换为左右布局'" placement="bottom">
                                <el-button :icon="isHorizontalLayout ? SplitVerticalIcon : SplitHorizontalIcon" circle
                                    size="small" @click="toggleLayout" />
                            </el-tooltip>
                            <!-- 刷新按钮 -->
                            <el-tooltip content="刷新" placement="bottom">
                                <el-button :icon="Refresh" circle size="small" @click="refreshTree"
                                    :loading="isLoading" />
                            </el-tooltip>
                        </div>
                    </div>

                    <!-- 目录树内容 -->
                    <div class="flex-1 overflow-y-auto p-2">
                        <div v-if="isLoading && !treeData.length" class="flex items-center justify-center py-8">
                            <el-icon class="is-loading" size="24">
                                <LoadingOutlined />
                            </el-icon>
                        </div>

                        <div v-else-if="!treeData.length" class="text-center py-8 text-gray-400 text-sm">
                            暂无文件
                        </div>

                        <el-tree v-else ref="treeRef" :data="treeData" :props="treeProps" node-key="path"
                            :expand-on-click-node="true" :default-expanded-keys="expandedKeys"
                            @node-click="handleTreeNodeClick" @node-expand="handleNodeExpand"
                            @node-collapse="handleNodeCollapse" class="workspace-tree">
                            <template #default="{ node, data }">
                                <span class="workspace-tree-node">
                                    <el-icon v-if="data.isDirectory" class="mr-1">
                                        <Folder />
                                    </el-icon>
                                    <el-icon v-else class="mr-1">
                                        <Document />
                                    </el-icon>
                                    {{ node.label }}
                                </span>
                            </template>
                        </el-tree>
                    </div>
                </div>
            </template>

            <!-- 文件预览面板 -->
            <template #pane2>
                <div v-if="selectedFile" class="flex flex-col h-full w-full overflow-hidden">
                    <!-- 标题栏 -->
                    <div
                        class="flex-shrink-0 flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-[#2a2c30] border-b border-gray-200 dark:border-[#2e3035]">
                        <span class="text-xs font-medium text-gray-600 dark:text-[#8b8d95] truncate">
                            {{ selectedFile.name }}
                        </span>

                        <div class="flex items-center gap-2">
                            <!-- 预览/源码切换按钮（仅 md 和 html） -->
                            <el-button-group v-if="canTogglePreview">
                                <el-button size="small" :type="currentPreviewMode === 'rendered' ? 'primary' : ''"
                                    @click="currentPreviewMode = 'rendered'">
                                    预览
                                </el-button>
                                <el-button size="small" :type="currentPreviewMode === 'source' ? 'primary' : ''"
                                    @click="currentPreviewMode = 'source'">
                                    源码
                                </el-button>
                            </el-button-group>

                            <!-- 关闭按钮 -->
                            <el-button :icon="Close" circle size="small" @click="closePreview" />
                        </div>
                    </div>

                    <div class="flex-1 flex overflow-auto min-h-0">
                        <div v-if="previewLoading" class="flex items-center justify-center h-full">
                            <el-icon class="is-loading" size="20">
                                <LoadingOutlined />
                            </el-icon>
                        </div>

                        <div v-else-if="previewError" class="text-red-500 text-sm p-4">
                            {{ previewError }}
                        </div>

                        <div v-else class="w-full min-h-0">
                            <!-- HTML 预览模式 -->
                            <iframe v-if="isHtmlFile && currentPreviewMode === 'rendered'" :srcdoc="fileContent"
                                class="w-full border-0" style="height: 100%;" sandbox="allow-same-origin" />

                            <!-- Markdown 渲染模式 -->
                            <div v-else-if="isMarkdownFile && currentPreviewMode === 'rendered'"
                                class="markdown-preview markdown-text" v-html="renderedContent" />

                            <!-- 源码模式（带语法高亮）- 所有支持的文件类型 -->
                            <div v-else-if="renderedContent" class="code-preview-container" v-html="renderedContent" />

                            <!-- 普通文本预览（不支持高亮的文件） -->
                            <pre v-else
                                class="text-xs whitespace-pre-wrap break-all bg-gray-50 dark:bg-[#2a2c30] p-3 m-0 overflow-auto min-h-0">
                    {{ fileContent }}</pre>
                        </div>
                    </div>
                </div>
            </template>
        </LiteSplitpanes>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue';
import { apiService } from '@/services/ApiService';
import { Refresh, Close, View, Edit, FolderOpened } from '@element-plus/icons-vue';
import { SwapHorizTwotone as SplitVerticalIcon, SwapVertTwotone as SplitHorizontalIcon } from '@vicons/material';
import { LoadingOutlined } from '@vicons/antd';
import { Folder, Document } from '@element-plus/icons-vue';
import { LiteSplitpanes } from "../ui";
import { useStorage, useThrottleFn } from '@vueuse/core';
import { useMarkdown } from '@/composables/useMarkdown';
import { useHighlight } from '@/composables/useHighlight';

interface WorkspaceNode {
    name: string;
    path: string;
    isDirectory: boolean;
    children?: WorkspaceNode[];
    size?: number;
}

interface SelectedFile {
    name: string;
    path: string;
    extension: string;
    size: number;
    content: string;
    mimeType: string;
}

type PreviewMode = 'rendered' | 'source';

const props = defineProps<{
    sessionId: string | null;
}>();

const treeData = ref<WorkspaceNode[]>([]);
const isLoading = ref(false);
const selectedFile = ref<SelectedFile | null>(null);
const fileContent = ref('');
const previewLoading = ref(false);
const previewError = ref('');
const expandedKeys = ref<string[]>([]);
const treeRef = ref();

// 检测是否为 Electron 环境
const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

// el-tree 配置
const treeProps = {
    label: 'name',
    children: 'children',
    isLeaf: (data: WorkspaceNode) => !data.isDirectory,
};

// 布局方向：true=左右，false=上下，默认左右
const isHorizontalLayout = useStorage('workspaceLayoutHorizontal', true);

// 预览模式：rendered=预览，source=源码，默认预览
const currentPreviewMode = useStorage<PreviewMode>('filePreviewMode', 'rendered');

// 初始化 Markdown 解析器
const { parseMarkdown } = useMarkdown();

// 初始化代码高亮
const { highlightCode, getLanguageFromExtension, isTextFile } = useHighlight();

let refreshTimer: number | null = null;

const isHtmlFile = computed(() => {
    if (!selectedFile.value) return false;
    const ext = selectedFile.value.extension.toLowerCase();
    return ext === '.html' || ext === '.htm';
});

// 判断是否为 Markdown 文件
const isMarkdownFile = computed(() => {
    if (!selectedFile.value) return false;
    const ext = selectedFile.value.extension.toLowerCase();
    return ext === '.md' || ext === '.markdown';
});

// 判断是否可以切换预览模式（仅 md 和 html）
const canTogglePreview = computed(() => {
    return isMarkdownFile.value || isHtmlFile.value;
});

// 渲染后的内容（用于 Markdown 预览和源码高亮）
const renderedContent = computed(() => {
    if (!selectedFile.value || !fileContent.value) return '';

    const ext = selectedFile.value.extension.toLowerCase();

    // Markdown 预览模式
    if ((ext === '.md' || ext === '.markdown') && currentPreviewMode.value === 'rendered') {
        return parseMarkdown(fileContent.value);
    }

    // HTML 预览模式 - iframe 单独处理，这里返回空
    if ((ext === '.html' || ext === '.htm') && currentPreviewMode.value === 'rendered') {
        return '';
    }

    // 源码模式 - 所有支持高亮的文件
    if (currentPreviewMode.value === 'source') {
        const lang = getLanguageFromExtension(ext);
        if (lang) {
            return highlightCode(fileContent.value, lang);
        }
        // 如果没有匹配的语言，返回空，使用普通文本预览
        return '';
    }

    // 预览模式下，如果是支持高亮的代码文件，也显示高亮
    const lang = getLanguageFromExtension(ext);
    if (lang && currentPreviewMode.value === 'rendered') {
        return highlightCode(fileContent.value, lang);
    }

    return '';
});

/**
 * 加载工作目录树（使用官方节流）
 */
async function loadTree(force = false) {
    if (!props.sessionId) return;

    // 如果正在加载中，不重复请求
    if (isLoading.value) return;

    isLoading.value = true;
    try {
        const response = await apiService.getWorkspaceTree(props.sessionId);
        treeData.value = response.tree || [];
    } catch (error: any) {
        console.error('Failed to load workspace tree:', error);
    } finally {
        isLoading.value = false;
    }
}

// 创建节流版本的 loadTree（5秒内最多执行一次）
const throttledLoadTree = useThrottleFn(loadTree, 5000);

/**
 * 刷新树（强制立即执行）
 */
function refreshTree() {
    // 清除节流限制，直接调用原始函数
    loadTree();
}

/**
 * 处理节点展开
 */
function handleNodeExpand(data: WorkspaceNode) {
    if (!expandedKeys.value.includes(data.path)) {
        expandedKeys.value.push(data.path);
    }
}

/**
 * 处理节点折叠
 */
function handleNodeCollapse(data: WorkspaceNode) {
    const index = expandedKeys.value.indexOf(data.path);
    if (index > -1) {
        expandedKeys.value.splice(index, 1);
    }
}

/**
 * 处理树节点点击
 */
function handleTreeNodeClick(data: WorkspaceNode) {
    handleFileSelect(data);
}

/**
 * 处理文件选择
 */
async function handleFileSelect(node: WorkspaceNode) {
    if (node.isDirectory) return;

    if (!props.sessionId) return;

    // 检查是否为文本文件，非文本文件不打开预览
    const ext = node.name.substring(node.name.lastIndexOf('.')).toLowerCase();
    if (!isTextFile(ext)) {
        previewError.value = '不支持预览二进制文件';
        selectedFile.value = null;
        fileContent.value = '';
        return;
    }

    selectedFile.value = {
        name: node.name,
        path: node.path,
        extension: ext,
        size: node.size || 0,
        content: '',
        mimeType: ''
    };

    await loadFileContent(node.path);
}

/**
 * 加载文件内容
 */
async function loadFileContent(filePath: string) {
    if (!props.sessionId) return;

    previewLoading.value = true;
    previewError.value = '';

    try {
        const response = await apiService.getWorkspaceFile(props.sessionId, filePath);
        selectedFile.value!.content = response.content;
        selectedFile.value!.extension = response.extension;
        selectedFile.value!.mimeType = response.mimeType;
        fileContent.value = response.content;
    } catch (error: any) {
        previewError.value = error.message || '加载文件失败';
        console.error('Failed to load file:', error);
    } finally {
        previewLoading.value = false;
    }
}

/**
 * 关闭预览
 */
function closePreview() {
    selectedFile.value = null;
    fileContent.value = '';
    previewError.value = '';
}

/**
 * 切换布局方向
 */
function toggleLayout() {
    isHorizontalLayout.value = !isHorizontalLayout.value;
}

/**
 * 在文件管理器中打开工作目录
 */
async function openInFileManager() {
    if (!props.sessionId || !isElectron) return;

    try {
        const response = await apiService.getWorkspacePath(props.sessionId);
        if (response.workspacePath && window.electronAPI) {
            await window.electronAPI.openFolder(response.workspacePath);
        }
    } catch (error: any) {
        console.error('Failed to open workspace folder:', error);
    }
}

/**
 * 设置自动刷新（降低频率至 10 秒）
 */
function setupAutoRefresh() {
    // 清除旧的定时器
    if (refreshTimer) {
        clearInterval(refreshTimer);
    }

    // 每 10 秒刷新一次（从 3 秒改为 10 秒，减少请求频率）
    refreshTimer = window.setInterval(() => {
        if (props.sessionId) {
            throttledLoadTree(); // 使用节流版本，5秒内最多执行一次
        }
    }, 10000);
}

watch(() => props.sessionId, (newSessionId, oldSessionId) => {
    // 会话切换时关闭文件预览
    if (oldSessionId && newSessionId !== oldSessionId) {
        closePreview();
        treeData.value = [];
    }

    if (newSessionId) {
        loadTree(); // 直接调用，不受节流限制
        setupAutoRefresh();
    } else {
        treeData.value = [];
        if (refreshTimer) {
            clearInterval(refreshTimer);
            refreshTimer = null;
        }
    }
}, { immediate: true });

onUnmounted(() => {
    if (refreshTimer) {
        clearInterval(refreshTimer);
    }
});
</script>
<style>
@import "@/assets/markdown.css";
</style>
<style scoped>
.workspace-sidebar {
    width: 100%;
    height: 100%;
}

.workspace-sidebar pre {
    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
}

/* Markdown 预览容器 - 复用 markdown-text 样式 */
.markdown-preview {
    padding: 16px;
    overflow: auto;
    height: 100%;
}

/* 代码高亮容器样式 - 双层滚动 */
.code-preview-container {
    overflow-y: auto;
    overflow-x: auto;
    min-height: 100%;
    max-height: 100%;
}



:deep(.code-preview-container pre code.hljs) {
    overflow-x: unset !important;
    background-color: unset !important;
}

/* 工作目录树样式 */
.workspace-tree {
    background: transparent;
    --el-tree-node-content-height: 32px;
}

.workspace-tree .el-tree-node__content {
    border-radius: 4px;
    padding: 0 8px;
}

.workspace-tree .el-tree-node__content:hover {
    background-color: var(--el-color-primary-light-9, rgba(0, 0, 0, 0.04));
}

.dark .workspace-tree .el-tree-node__content:hover {
    background-color: rgba(255, 255, 255, 0.05);
}

.workspace-tree .el-tree-node.is-current>.el-tree-node__content {
    background-color: var(--el-color-primary-light-9, rgba(0, 0, 0, 0.06)) !important;
}

.dark .workspace-tree .el-tree-node.is-current>.el-tree-node__content {
    background-color: rgba(255, 255, 255, 0.08) !important;
}

.workspace-tree .el-tree-node__expand-icon {
    color: var(--color-text-gray, #666);
}

.dark .workspace-tree .el-tree-node__expand-icon {
    color: var(--color-text-gray);
}

.workspace-tree-node {
    font-size: 13px;
    color: var(--color-text, #333);
}

.dark .workspace-tree-node {
    color: var(--color-text);
}

/* Splitpanes 自定义样式 - 适配暗色模式 */
:deep(.splitpanes.default-theme .splitpanes__pane) {
    background-color: transparent;
}

:deep(.splitpanes.default-theme .splitpanes__splitter) {
    background-color: var(--color-surface, #f5f5f5);
    position: relative;
    transition: background-color 0.2s ease;
}

:deep(.dark .splitpanes.default-theme .splitpanes__splitter) {
    background-color: #25262a;
}

/* 悬停时显示主题色（中等浅色） */
:deep(.splitpanes.default-theme .splitpanes__splitter:hover) {
    background-color: var(--el-color-primary-light-8, #d9ecff) !important;
}

/* 移除 Pane 的边框，避免与分割线重叠 */
:deep(.splitpanes.default-theme .splitpanes__pane) {
    background-color: transparent;
    border: none !important;
}

/* 隐藏悬停指示器 */
:deep(.splitpanes.default-theme .splitpanes__splitter:before),
:deep(.splitpanes.default-theme .splitpanes__splitter:after) {
    display: none !important;
}

:deep(.splitpanes.default-theme.splitpanes--horizontal .splitpanes__splitter) {
    border-top: 0;
    border-bottom: 0;
    height: 2px !important;
}

:deep(.splitpanes.default-theme.splitpanes--vertical .splitpanes__splitter) {
    border-left: 0;
    border-right: 0;
    width: 2px !important;
}
</style>
