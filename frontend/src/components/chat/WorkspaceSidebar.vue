<template>
    <div class="workspace-sidebar h-full flex flex-col relative">
        <!-- 顶部工具栏：预览模式下显示资源管理器按钮 + 浏览器标签 + 窗口控制 -->
        <div v-if="isElectron"
            class="flex items-center h-11 drag-region shrink-0 border-b border-gray-100 dark:border-[#2e3035]">
            <!-- 工作区 / 预览区 切换按钮 -->
            <div class="ml-1 shrink-0 no-drag flex items-center gap-0.5 mr-1">
                <button ref="workspaceBtnRef" class="seg-btn" :class="{ active: !isPreviewMode }" title="工作区"
                    @click="showFileTree" @mouseenter="showTreePanel" @mouseleave="hideTreePanel">
                    <el-icon :size="20">
                        <Folder16Regular />
                    </el-icon>
                </button>
                <button class="seg-btn" :class="{ active: isPreviewMode }" :disabled="!props.sessionId" title="预览区"
                    @click="enterPreviewMode">
                    <el-icon :size="20">
                        <Window16Regular />
                    </el-icon>
                </button>
            </div>

            <!-- 标签 + 新建按钮容器（预览模式且有标签时显示） -->
            <div ref="tabBarRef" v-if="isPreviewMode && tabs.length > 0"
                class="flex items-center gap-0.5 flex-1 overflow-x-auto no-drag browser-tabs-scroll"
                @wheel="onTabBarWheel">
                <!-- 统一标签（文件 + 浏览器，按创建顺序，可拖拽排序） -->
                <div v-for="(tab, index) in tabs" :key="tab.key" class="browser-tab"
                    :class="{ active: activeTabKey === tab.key }"
                    :title="tab.type === 'file' ? tab.name : (tab.title || '未命名窗口')" draggable="true"
                    @click="onTabClick(tab)" @dragstart="onTabDragStart(index, $event)"
                    @dragover.prevent="onTabDragOver(index)" @drop.prevent="onTabDrop(index)" @dragend="onTabDragEnd">
                    <!-- 文件图标 -->
                    <img v-if="tab.type === 'file'" :src="getFileIcon(tab.name!)" class="tab-favicon" alt="" />
                    <!-- 浏览器图标 -->
                    <template v-else>
                        <img v-if="tab.favicon" :src="tab.favicon" class="tab-favicon" alt=""
                            @error="(e: Event) => (e.target as HTMLImageElement).style.display = 'none'" />
                        <span v-else class="tab-globe">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                stroke-width="2">
                                <circle cx="12" cy="12" r="10" />
                                <path
                                    d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                            </svg>
                        </span>
                    </template>
                    <span class="tab-title">{{ truncateTabTitle(tab.type === 'file' ? tab.name! : (tab.title || '新窗口'))
                        }}</span>
                    <span class="tab-close"
                        @click.stop="closeTab(tab)">
                        <el-icon size="10">
                            <Close />
                        </el-icon>
                    </span>
                </div>

                <!-- 新建标签按钮：进入预览模式并取消当前选中（显示空状态页） -->
                <el-tooltip content="新建" placement="bottom">
                    <button class="sidebar-tool-btn no-drag" :disabled="!props.sessionId" @click="deselectAllTabs">
                        <el-icon size="14">
                            <Plus />
                        </el-icon>
                    </button>
                </el-tooltip>
            </div>

            <!-- 弹性占位 -->
            <div v-if="!isPreviewMode || tabs.length === 0" class="flex-1"></div>

            <!-- 窗口控制按钮 -->
            <WindowControls class="no-drag" />
        </div>
        <!-- 目录树（预览时隐藏，v-show 保留 DOM） -->
        <div :class="treeContainerClass" :style="isPreviewMode ? treePanelStyle : {}" @mouseenter="showTreePanel"
            @mouseleave="hideTreePanel">
            <!-- 浏览器窗口列表（仅 Electron 环境，资源管理器模式下显示） -->
            <SessionBrowserWindowList v-if="isElectron && browserStore.sessionWebviews.length > 0"
                v-show="!isPreviewMode" :session-id="props.sessionId" />
            <div v-if="isElectron && browserStore.sessionWebviews.length > 0" v-show="!isPreviewMode"
                class="border-b border-gray-100 dark:border-[#2e3035] mx-4 mt-3"></div>
            <!-- 子代理任务列表 -->
            <SessionAgentList v-show="!isPreviewMode" :agent-tabs="props.agentTabs" :active-tab-id="props.activeTabId"
                @switch="emit('switch-agent', $event)" />
            <!-- 计划事项列表 -->
            <SessionPlanList v-show="!isPreviewMode" :session-id="props.sessionId" />
            <!-- 头部 -->
            <div class="shrink-0 flex items-center justify-between px-2  py-3 ">
                <h3 class="text-sm font-normal text-gray-500 dark:text-[#8b8d95] whitespace-nowrap mx-2">
                    工作目录</h3>
                <div class="flex items-center gap-0 shrink-0">
                    <!-- 更换工作目录按钮 -->
                    <el-tooltip content="更换工作目录" placement="bottom">
                        <el-button class="workspace-tool-btn" text @click="changeWorkspacePath">
                            <el-icon size="16">
                                <Switch />
                            </el-icon>
                        </el-button>
                    </el-tooltip>
                    <!-- 打开文件夹按钮（仅 Electron 环境） -->
                    <el-tooltip v-if="isElectron" content="在文件管理器中打开" placement="bottom">
                        <el-button class="workspace-tool-btn" text @click="openInFileManager">
                            <el-icon size="16">
                                <WindowsExplorer />
                            </el-icon>
                        </el-button>
                    </el-tooltip>
                    <!-- 以 VSCode 打开工作目录（仅 Electron 环境） -->
                    <el-tooltip v-if="isElectron" content="以 VSCode 打开工作目录" placement="bottom">
                        <el-button class="workspace-tool-btn" text @click="openWorkspaceInVSCode">
                            <el-icon size="16">
                                <VsCode />
                            </el-icon>
                        </el-button>
                    </el-tooltip>
                    <!-- 刷新按钮 -->
                    <el-tooltip content="刷新" placement="bottom">
                        <el-button class="workspace-tool-btn" text @click="refreshTree" :loading="isLoading">
                            <el-icon size="16">
                                <Refresh />
                            </el-icon>
                        </el-button>
                    </el-tooltip>
                </div>
            </div>

            <!-- 目录树内容 -->
            <div class="flex-1 overflow-auto min-w-0">
                <div v-if="!treeData.length" class="text-center py-12 text-gray-400 dark:text-[#6b6d73] text-xs p-2">
                    暂无文件，请先设置工作目录
                </div>

                <WorkspaceTree v-else :nodes="treeData" :selected-path="selectedNodePath" :loading-paths="loadingPaths"
                    :on-load="(node) => handleTreeNodeToggle(node, true)" @select="handleTreeNodeSelect"
                    @toggle="handleTreeNodeExpandToggle" @contextmenu="handleContextMenu" />
            </div>
        </div>

        <!-- 浏览器窗口预览占位（webview 实际在 MainLayout 层，此处仅空壳坐标） -->
        <BrowserPreviewPlaceholder v-if="isElectron" v-show="isPreviewMode && !!browserStore.activeWindowId" />

        <!-- 文件预览面板 -->
        <div v-show="isPreviewMode && selectedFile && !browserStore.activeWindowId"
            class="flex flex-col h-full w-full  flex-1">
            <!-- 标题栏 -->
            <div
                class="shrink-0 flex items-center justify-between px-4 py-2 border-b border-gray-100 dark:border-[#2e3035]">
                <div class="flex items-center gap-2 min-w-0">
                    <!-- 预览/源码切换按钮（仅 md 和 html），放在左侧高频操作区 -->
                    <div v-if="canTogglePreview"
                        class="flex items-center gap-0.5 bg-gray-100/80 dark:bg-[#242529] rounded-md p-0.5 shrink-0">
                        <button class="preview-mode-btn" :class="{ 'is-active': currentPreviewMode === 'rendered' }"
                            title="预览" @click="currentPreviewMode = 'rendered'">
                            <el-icon :size="16">
                                <Eye20Regular v-if="currentPreviewMode !== 'rendered'" />
                                <Eye20Filled v-else />
                            </el-icon>
                        </button>
                        <button class="preview-mode-btn" :class="{ 'is-active': currentPreviewMode === 'source' }"
                            title="源码" @click="currentPreviewMode = 'source'">
                            <el-icon :size="16">
                                <Code20Regular v-if="currentPreviewMode !== 'source'" />
                                <Code20Filled v-else />
                            </el-icon>
                        </button>
                    </div>

                    <span class="font-medium text-gray-600 dark:text-[#8b8d95] truncate ml-2">
                        {{ selectedFile?.name }}
                    </span>
                    <div class="flex items-center gap-1 shrink-0">
                        <!-- 手动刷新预览按钮 -->
                        <button class="preview-close-btn" title="刷新预览" @click="handleManualRefresh">
                            <el-icon :size="14">
                                <ArrowClockwise20Regular class="text-gray-500 dark:text-[#8b8d95]" />
                            </el-icon>
                        </button>
                    </div>
                </div>


            </div>

            <div class="flex-1 flex overflow-auto min-h-0 p-1">
                <div v-if="previewLoading" class="flex items-center justify-center h-full w-full">
                    <el-icon class="is-loading" size="20">
                        <LoadingOutlined />
                    </el-icon>
                </div>

                <!-- 图片预览 -->
                <img v-else-if="previewMode === 'image' && !previewError" :src="imagePreviewUrl" @error="onImageError"
                    class="image-preview w-full h-full object-contain p-2" alt="图片预览" />

                <!-- 不支持的文件 -->
                <div v-else-if="previewMode === 'unsupported' && !previewError"
                    class="w-full h-full flex items-center justify-center">
                    <div class="text-center">
                        <p class="text-gray-400 dark:text-gray-500 text-sm">此文件暂不支持预览</p>
                        <el-button v-if="isElectron" @click="handleOpenInExplorerForCurrent" size="small" class="mt-3">
                            在资源管理器中打开
                        </el-button>
                    </div>
                </div>

                <!-- 错误 / 文本内容 -->
                <div v-else class="w-full min-h-0">
                    <!-- 文件不存在 -->
                    <div v-if="fileNotFound" class="w-full h-full flex items-center justify-center p-4">
                        <div class="text-center">
                            <p class="text-gray-400 dark:text-gray-500 text-sm">文件已不存在</p>
                            <el-button @click="closeTab(tabs.find(t => t.key === activeTabKey)!)" size="small" class="mt-3">
                                关闭标签
                            </el-button>
                        </div>
                    </div>
                    <!-- 其他错误 -->
                    <div v-else-if="previewError" class="w-full h-full flex items-center justify-center p-4">
                        <div class="text-center">
                            <p class="text-gray-400 dark:text-gray-500 text-sm">{{ previewError }}</p>
                            <el-button v-if="isElectron && previewMode === 'unsupported'"
                                @click="handleOpenInExplorerForCurrent" size="small" class="mt-3">
                                在资源管理器中打开
                            </el-button>
                        </div>
                    </div>
                    <template v-else-if="previewMode === 'text'">
                        <!-- HTML 预览模式（通过 src 直接加载，后端 Set-Cookie 鉴权） -->
                        <iframe v-if="isHtmlFile && currentPreviewMode === 'rendered'" :src="htmlPreviewSrc"
                            class="w-full border-0" style="height: 100%;" sandbox="allow-same-origin allow-scripts" />

                        <!-- Markdown 渲染模式 -->
                        <div v-else-if="isMarkdownFile && currentPreviewMode === 'rendered'"
                            class="markdown-preview markdown-text" v-html="markdownHtml" />

                        <!-- 源码高亮（所有文件的 source 模式 + 不支持预览的文本文件） -->
                        <div v-else-if="highlightedCode" class="code-preview-container" v-html="highlightedCode" />

                        <!-- 普通文本预览（不支持高亮的文件） -->
                        <pre v-else v-text="fileContent"
                            class="text-sm leading-relaxed whitespace-pre-wrap break-all dark:bg-[#2a2c30] text-gray-800 dark:text-gray-200 p-4 m-0 overflow-auto min-h-0 font-mono" />
                    </template>
                </div>
            </div>
        </div>

        <!-- 空状态页（预览模式但无激活标签时显示） -->
        <div v-if="isPreviewMode && !activeTabKey"
            class="flex flex-col items-center justify-center h-full w-full flex-1">
            <div class="text-center">
                <svg class="w-12 h-12 mx-auto mb-3 text-gray-200 dark:text-[#3a3c40]" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <path d="M3 9h18" />
                    <path d="M9 21V9" />
                </svg>
                <p class="text-gray-400 dark:text-[#6b6d73] text-sm mb-4">暂无预览文件</p>
                <div class="flex items-center gap-2 justify-center">
                    <button v-if="isElectron" class="empty-state-btn" :disabled="!props.sessionId"
                        @click="createNewBrowserWindow">
                        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                            stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="10" />
                            <path
                                d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                        </svg>
                        <span>新建浏览器</span>
                    </button>
                    <button class="empty-state-btn" @click="showFileTree">
                        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                            stroke-linecap="round" stroke-linejoin="round">
                            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                        </svg>
                        <span>选择文件</span>
                    </button>
                </div>
            </div>
        </div>
    </div>

    <!-- 更换工作目录弹窗 -->
    <WorkspaceSettingsDialog v-model:visible="workspaceDialogVisible" :current-workspace-path="currentWorkspacePath"
        :allow-empty="false" @confirm="handleWorkspaceChange" />

    <ContextMenu :visible="contextMenu.visible" :x="contextMenu.x" :y="contextMenu.y" :items="contextMenuItems"
        @close="closeContextMenu" />
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted, nextTick } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { apiService, type FileChangeEvent } from '@/services/ApiService';
import { Refresh, Switch, CopyDocument, Edit, Delete, Plus, Close } from '@element-plus/icons-vue';
import { LoadingOutlined } from '@vicons/antd';
import { Dismiss20Regular, Eye20Filled, Eye20Regular, Code20Filled, Code20Regular, ArrowClockwise20Regular, Folder16Regular, Window16Regular } from '@vicons/fluent';
// @ts-ignore - icons 组件尚未迁移到 TypeScript
import { VsCode, WindowsExplorer } from '@/components/icons';
import { useStorage, useThrottleFn } from '@vueuse/core';
import { useMarkdown } from '@/composables/useMarkdown';
import { useHighlight } from '@/composables/useHighlight';
import { getFileIcon } from '@/composables/useFileIcon';
import ContextMenu, { type ContextMenuItem } from '@/components/ui/ContextMenu.vue';
import WorkspaceSettingsDialog from './chat-input/WorkspaceSettingsDialog.vue';
import SessionBrowserWindowList from './SessionBrowserWindowList.vue';
import SessionPlanList from './SessionPlanList.vue';
import SessionAgentList from './SessionAgentList.vue';
import WorkspaceTree from './WorkspaceTree.vue';
import BrowserPreviewPlaceholder from './BrowserPreviewPlaceholder.vue';
import { useBrowserWebviewStore } from '@/stores/browserWebview';
import { usePreviewTabCache, type UnifiedTab } from '@/composables/usePreviewTabCache';
import type { WorkspaceNode } from './WorkspaceTree.vue';
import WindowControls from '@/components/WindowControls.vue';

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
    agentTabs?: { id: string; name: string; status: 'running' | 'completed' | 'error'; loaded?: boolean; avatarUrl?: string }[];
    activeTabId?: string;
}>();

const emit = defineEmits<{
    'preview-open': [];
    'preview-close': [];
    'switch-agent': [tabId: string];
}>();

const treeData = ref<WorkspaceNode[]>([]);
const isLoading = ref(false);
const selectedFile = ref<SelectedFile | null>(null);
/** 统一标签列表（文件 + 浏览器，按顺序排列，唯一数据源） */
const tabs = ref<UnifiedTab[]>([]);
/** 当前激活的标签统一标识（'file:<path>' 或 'browser:<windowId>'） */
const activeTabKey = ref<string | null>(null);
const fileContent = ref('');
const previewLoading = ref(false);
const workspaceDialogVisible = ref(false);
const currentWorkspacePath = ref<string | null>(null);
const previewError = ref('');
const fileNotFound = ref(false);
const selectedNodePath = ref('');

// 预览类型：text / image / unsupported
const previewMode = ref<'text' | 'image' | 'unsupported' | null>(null);
// 图片预览 URL（Electron 为 file:// 协议，非 Electron 为 rawfile URL）
const imagePreviewUrl = ref('');
// HTML 预览 URL（iframe src，Electron 为 file://，非 Electron 为 html-preview 端点）
const htmlPreviewUrl = ref('');
// HTML 预览版本号，文件变更时递增以强制 iframe 重新加载
const htmlPreviewVersion = ref(0);

// 正在加载子节点的目录路径集合
const loadingPaths = ref<Set<string>>(new Set());

// 右键菜单状态
const contextMenu = ref({
    visible: false,
    x: 0,
    y: 0,
    node: null as WorkspaceNode | null,
});

// 右键菜单项
const contextMenuItems = computed<ContextMenuItem[]>(() => {
    const items: ContextMenuItem[] = [
        {
            label: '复制文件名',
            icon: CopyDocument,
            onClick: handleCopyFileName,
        },
        {
            label: '复制路径',
            icon: CopyDocument,
            onClick: handleCopyFilePath,
        },
    ];
    if (isElectron) {
        items.push({
            label: '在资源管理器中打开',
            icon: WindowsExplorer,
            onClick: handleOpenInExplorer,
        });
        // 文件/目录支持以 VSCode 打开
        items.push({
            label: '以 VSCode 打开',
            icon: VsCode,
            onClick: handleOpenInVSCode,
        });
    }
    items.push({
        label: '重命名',
        icon: Edit,
        divider: true,
        onClick: handleRename,
    });
    items.push({
        label: '删除',
        icon: Delete,
        onClick: handleDelete,
    });
    return items;
});

// 检测是否为 Electron 环境
const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

// 浏览器 webview store（用于预览占位与文件预览互斥）
const browserStore = useBrowserWebviewStore();
const previewTabCache = usePreviewTabCache();

// ── 原生 HTML5 拖拽排序 ──
let dragSourceIndex = -1;
let suppressClick = false;

function onTabDragStart(index: number, e: DragEvent): void {
    dragSourceIndex = index;
    if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(index));
    }
}

function onTabDragOver(_index: number): void {
    // 只需要 preventDefault 允许 drop（已在模板 .prevent 中处理）
}

function onTabDrop(targetIndex: number): void {
    if (dragSourceIndex < 0 || dragSourceIndex === targetIndex) return;
    // 直接操作 tabs 数组
    const item = tabs.value.splice(dragSourceIndex, 1)[0];
    tabs.value.splice(targetIndex, 0, item);
    dragSourceIndex = -1;
}

function onTabDragEnd(): void {
    dragSourceIndex = -1;
    // 拖拽结束后短暂抑制 click，防止浏览器误触发
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 50);
}

function onTabClick(tab: UnifiedTab): void {
    if (suppressClick) return;
    void activateTab(tab);
}

// ── 悬浮目录树面板 ──
const isPreviewMode = ref(false);
const isTreePanelVisible = ref(false);
const treeTransitionReady = ref(false);
const workspaceBtnRef = ref<HTMLElement | null>(null);
const tabBarRef = ref<HTMLElement | null>(null);
const treePanelStyle = ref<Record<string, string>>({});
let treeHideTimer: ReturnType<typeof setTimeout> | null = null;
let treeShowTimer: ReturnType<typeof setTimeout> | null = null;

const TREE_PANEL_WIDTH = 320;
const TREE_PANEL_HEIGHT = 420;
const TREE_PANEL_GAP = 4;

function updateTreePanelPosition() {
    if (!workspaceBtnRef.value) return;
    const rect = workspaceBtnRef.value.getBoundingClientRect();
    let left = rect.left - TREE_PANEL_WIDTH - TREE_PANEL_GAP;
    if (left < TREE_PANEL_GAP) left = TREE_PANEL_GAP;
    const top = rect.bottom + TREE_PANEL_GAP;
    treePanelStyle.value = {
        position: 'fixed',
        left: `${left}px`,
        top: `${top}px`,
        width: `${TREE_PANEL_WIDTH}px`,
        height: `${TREE_PANEL_HEIGHT}px`,
    };
}

const treeContainerClass = computed(() => {
    if (!isPreviewMode.value) {
        return 'h-full flex flex-col flex-1 min-h-0';
    }
    return [
        'tree-floating-panel',
        {
            'tree-floating-visible': isTreePanelVisible.value,
            'tree-transition-ready': treeTransitionReady.value,
        },
    ];
});

function showTreePanel() {
    if (!isPreviewMode.value) return;
    if (treeHideTimer) {
        clearTimeout(treeHideTimer);
        treeHideTimer = null;
    }
    if (isTreePanelVisible.value) return;
    if (treeShowTimer) clearTimeout(treeShowTimer);
    treeShowTimer = setTimeout(() => {
        updateTreePanelPosition();
        isTreePanelVisible.value = true;
    }, 300);
}

function hideTreePanel() {
    if (!isPreviewMode.value) return;
    if (treeShowTimer) {
        clearTimeout(treeShowTimer);
        treeShowTimer = null;
    }
    if (treeHideTimer) clearTimeout(treeHideTimer);
    treeHideTimer = setTimeout(() => {
        isTreePanelVisible.value = false;
    }, 1000);
}

watch(isPreviewMode, (preview) => {
    if (!preview) {
        isTreePanelVisible.value = false;
        treeTransitionReady.value = false;
        if (treeHideTimer) {
            clearTimeout(treeHideTimer);
            treeHideTimer = null;
        }
        if (treeShowTimer) {
            clearTimeout(treeShowTimer);
            treeShowTimer = null;
        }
    } else {
        nextTick(() => {
            treeTransitionReady.value = true;
        });
    }
});

// ── 浏览器标签操作 ──

function truncateTabTitle(title: string, maxLen = 12): string {
    return title.length <= maxLen ? title : title.substring(0, maxLen) + '...';
}

/** 标签栏鼠标滚轮横向滚动 */
function onTabBarWheel(e: WheelEvent): void {
    if (!tabBarRef.value) return;
    const el = tabBarRef.value;
    // 仅当内容溢出时才拦截
    if (el.scrollWidth <= el.clientWidth) return;
    e.preventDefault();
    el.scrollLeft += e.deltaY;
}

/** 点击工作区按钮：退出预览模式，显示目录树（保留标签选中状态） */
function showFileTree(): void {
    if (isPreviewMode.value) {
        isPreviewMode.value = false;
        emit('preview-close');
    }
}

/** 点击预览区按钮：进入预览模式，无标签时显示空状态页 */
function enterPreviewMode(): void {
    if (!isPreviewMode.value) {
        isPreviewMode.value = true;
        emit('preview-open');
    }
}

/** 取消所有标签选中，显示空状态页 */
function deselectAllTabs(): void {
    if (!isPreviewMode.value) {
        isPreviewMode.value = true;
        emit('preview-open');
    }
    activeTabKey.value = null;
    browserStore.setActive(null);
    closePreview();
}

// ── 浏览器 store 同步：增删标签 + 元数据更新（单向 store → tabs） ──
// watch 源使用 fingerprint 数组（仅 windowId/title/favicon/url），避免 setActive 修改 isVisible 时冗余触发
watch(() => browserStore.sessionWebviews.map(w => ({
    windowId: w.windowId, title: w.title, favicon: w.favicon, url: w.url,
})), (webviews) => {
    const ids = new Set(webviews.map(w => w.windowId));

    // 移除已关闭的浏览器标签
    const toRemove = tabs.value
        .filter(t => t.type === 'browser' && !ids.has(t.windowId!))
        .map(t => t.key);
    for (const key of toRemove) handleTabRemoved(key);

    // 新增 + 更新元数据
    for (const wv of webviews) {
        const key = `browser:${wv.windowId}`;
        const existing = tabs.value.find(t => t.key === key);
        if (!existing) {
            tabs.value.push({ type: 'browser', key, windowId: wv.windowId, title: wv.title, favicon: wv.favicon, url: wv.url });
        } else {
            existing.title = wv.title;
            existing.favicon = wv.favicon;
            existing.url = wv.url;
        }
    }

    // 全部标签关闭时退出预览模式
    if (tabs.value.length === 0 && isPreviewMode.value) {
        isPreviewMode.value = false;
        emit('preview-close');
    }
}, { deep: true });

// ── 预览标签缓存：保存当前会话状态到 localStorage ──

function savePreviewCache(): void {
    if (!props.sessionId) return;
    previewTabCache.saveSession(props.sessionId, {
        isPreviewMode: isPreviewMode.value,
        activeTabKey: activeTabKey.value,
        tabs: tabs.value.map(t => ({ ...t })),
    });
}

// 自动保存：当预览状态、标签列表、激活标签变化时
// isRestoring 期间跳过，避免 restorePreviewCache 过程中多次写入中间态
let isRestoring = false;
watch([isPreviewMode, activeTabKey, tabs], () => {
    if (!isRestoring) savePreviewCache();
}, { deep: true });

// ── 预览标签缓存：从 localStorage 恢复会话状态 ──
async function restorePreviewCache(sessionId: string): Promise<void> {
    const cached = previewTabCache.getSession(sessionId);
    if (!cached) return;

    isRestoring = true;

    // 恢复完整标签列表（保留顺序）
    tabs.value = cached.tabs.map(t => ({ ...t }));

    // 过滤掉 webview 已不存在的浏览器标签（页面刷新场景）
    tabs.value = tabs.value.filter(tab => {
        if (tab.type === 'browser') {
            return browserStore.allWebviews.some(w => w.windowId === tab.windowId);
        }
        return true;
    });

    // 补充 store 中存在但缓存中没有的浏览器标签
    for (const wv of browserStore.sessionWebviews) {
        const key = `browser:${wv.windowId}`;
        if (!tabs.value.some(t => t.key === key)) {
            tabs.value.push({ type: 'browser', key, windowId: wv.windowId, title: wv.title, favicon: wv.favicon, url: wv.url });
        }
    }

    // 恢复预览模式 + 激活标签
    // 仅当缓存记录为预览模式时才激活标签，否则保持工作区模式（activateTab 会强制进入预览模式）
    if (cached.isPreviewMode) {
        isPreviewMode.value = true;
        emit('preview-open');
        if (cached.activeTabKey) {
            await nextTick();
            const tab = tabs.value.find(t => t.key === cached.activeTabKey);
            if (tab) await activateTab(tab);
        }
    }

    isRestoring = false;
    savePreviewCache();
}

// ── 统一标签操作 ──

/** 激活标签（统一入口，替代 switchToFileTab + activateBrowserWindow） */
async function activateTab(tab: UnifiedTab): Promise<void> {
    if (!props.sessionId) return;
    if (activeTabKey.value === tab.key) return;

    activeTabKey.value = tab.key;

    if (tab.type === 'file') {
        browserStore.setActive(null);
        if (!isPreviewMode.value) {
            isPreviewMode.value = true;
            emit('preview-open');
        }

        const fileTab = tabs.value.find(t => t.key === tab.key);
        if (!fileTab) return;

        selectedFile.value = {
            name: fileTab.name!,
            path: fileTab.path!,
            extension: fileTab.extension!,
            size: fileTab.size!,
            content: '',
            mimeType: ''
        };
        previewError.value = '';
        previewLoading.value = false;
        fileContentHash.value = '';

        const ext = fileTab.extension!;
        if (isTextFile(ext)) {
            previewMode.value = 'text';
            if (isHtmlFile.value) {
                if (isElectron && window.location.protocol === 'file:') {
                    await loadHtmlPreviewLocal({ name: fileTab.name!, path: fileTab.path!, isDirectory: false, hasChildren: false } as WorkspaceNode);
                } else {
                    htmlPreviewUrl.value = apiService.getWorkspaceHtmlPreviewUrl(props.sessionId!, fileTab.path!);
                }
                await loadFileContent(fileTab.path!);
            } else {
                await loadFileContent(fileTab.path!);
            }
        } else if (isImageFile(ext)) {
            previewMode.value = 'image';
            if (isElectron && window.location.protocol === 'file:') {
                await loadImageLocal({ name: fileTab.name!, path: fileTab.path!, isDirectory: false, hasChildren: false } as WorkspaceNode);
            } else {
                if (fileTab.size && fileTab.size > 20 * 1024 * 1024) {
                    previewError.value = '文件过大暂不支持预览';
                } else {
                    imagePreviewUrl.value = apiService.getWorkspaceRawFileUrl(props.sessionId, fileTab.path!);
                }
            }
        } else {
            previewMode.value = 'unsupported';
        }
    } else {
        browserStore.setActive(tab.windowId!);
        if (!isPreviewMode.value) {
            isPreviewMode.value = true;
            emit('preview-open');
        }
    }
}

/** 内部：从 tabs 移除标签并处理相邻切换 */
function handleTabRemoved(key: string): void {
    const idx = tabs.value.findIndex(t => t.key === key);
    if (idx === -1) return;
    tabs.value.splice(idx, 1);
    if (activeTabKey.value === key) {
        const next = tabs.value[idx] || tabs.value[idx - 1] || null;
        if (next) {
            void activateTab(next);
        } else {
            activeTabKey.value = null;
            browserStore.setActive(null);
            closePreview();
            isPreviewMode.value = false;
            emit('preview-close');
        }
    }
}

/** 关闭标签（统一入口，替代 closeFileTab + closeBrowserWindow） */
async function closeTab(tab: UnifiedTab): Promise<void> {
    if (tab.type === 'browser' && tab.windowId) {
        if (window.electronAPI) {
            try {
                await window.electronAPI.closeBrowserWindow(tab.windowId);
            } catch (e) {
                console.error('Failed to close browser window:', e);
            }
        }
        await nextTick();
    }
    handleTabRemoved(tab.key);
}

/** 新建浏览器窗口：加载简约新建标签页 */
async function createNewBrowserWindow(): Promise<void> {
    if (!window.electronAPI || !props.sessionId) return;
    if (!isPreviewMode.value) {
        isPreviewMode.value = true;
        emit('preview-open');
    }
    try {
        const result = await window.electronAPI.createBrowserWindow('about:blank', {
            sessionId: props.sessionId,
            createdBy: props.sessionId,
        });
        if (!result.success) {
            ElMessage.warning(result.error || '创建窗口失败');
        } else if (result.window?.windowId) {
            activeTabKey.value = `browser:${result.window.windowId}`;
            browserStore.setActive(result.window.windowId);
        }
    } catch (e) {
        console.error('Failed to create browser window:', e);
    }
}

/**
 * 异步加载目录的子节点
 */
async function loadChildren(node: WorkspaceNode): Promise<WorkspaceNode[]> {
    if (!props.sessionId) return [];
    try {
        const response = await apiService.getWorkspaceChildren(props.sessionId, node.path);
        return response.children || [];
    } catch (error: any) {
        console.error('[WorkspaceSidebar] Failed to load children:', error);
        return [];
    }
}

/**
 * 展开目录时加载子节点
 */
async function handleTreeNodeToggle(node: WorkspaceNode, expanded: boolean) {
    if (!expanded || !node.isDirectory) return;

    // 标记加载中
    loadingPaths.value = new Set(loadingPaths.value).add(node.path);

    try {
        const children = await loadChildren(node);
        node.children = children;
    } finally {
        const next = new Set(loadingPaths.value);
        next.delete(node.path);
        loadingPaths.value = next;
    }
}

// 展开/折叠状态同步到后端（用于文件变化事件监听）
let collapseSyncTimer: ReturnType<typeof setTimeout> | null = null;
const expandedPaths = ref<Set<string>>(new Set());

function resetExpandedPaths() {
    if (collapseSyncTimer) {
        clearTimeout(collapseSyncTimer);
        collapseSyncTimer = null;
    }
    expandedPaths.value = new Set();
}

function handleTreeNodeExpandToggle(node: WorkspaceNode, expanded: boolean) {
    if (expanded) {
        // 展开：取消待处理的删除，立即同步
        expandedPaths.value = new Set(expandedPaths.value).add(node.path);
        if (collapseSyncTimer) clearTimeout(collapseSyncTimer);
        syncExpandedPaths();
    } else {
        // 折叠：消抖 10 秒，避免频繁开关浪费后端监听资源
        const next = new Set(expandedPaths.value);
        next.delete(node.path);
        expandedPaths.value = next;
        if (collapseSyncTimer) clearTimeout(collapseSyncTimer);
        collapseSyncTimer = setTimeout(() => syncExpandedPaths(), 10000);
    }
}

async function syncExpandedPaths(sessionId = props.sessionId): Promise<boolean> {
    if (!sessionId || sessionId !== props.sessionId) return false;
    try {
        await apiService.updateWorkspaceExpandedPaths(
            sessionId,
            Array.from(expandedPaths.value),
        );
        return true;
    } catch (error) {
        console.error('[WorkspaceSidebar] 同步展开状态失败:', error);
        return false;
    }
}

/**
 * 点击文件节点选中
 */
function handleTreeNodeSelect(node: WorkspaceNode) {
    if (node.isDirectory) return;
    selectedNodePath.value = node.path;
    browserStore.setActive(null);
    handleFileSelect(node);
}

// 预览模式：rendered=预览，source=源码，默认预览
const currentPreviewMode = useStorage<PreviewMode>('filePreviewMode', 'rendered');

// 初始化 Markdown 解析器，传入图片路径解析函数
const { parseMarkdown } = useMarkdown({
    resolveImageUrl: (src: string) => {
        // 只处理相对路径（不以协议、/、# 开头的路径）
        if (!src || /^([a-z][a-z0-9+.-]*:|\/|#)/i.test(src)) {
            return src;
        }
        if (!props.sessionId || !selectedFile.value) {
            return src;
        }
        // 计算图片相对于工作目录的路径
        // Markdown 文件在子目录中时，相对路径基于该子目录
        const mdFilePath = selectedFile.value.path.replace(/\\/g, '/');
        const lastSlashIndex = mdFilePath.lastIndexOf('/');
        const mdFileDir = lastSlashIndex > 0 ? mdFilePath.substring(0, lastSlashIndex) : '';
        const imagePath = mdFileDir ? `${mdFileDir}/${src}` : src;
        return apiService.getWorkspaceRawFileUrl(props.sessionId, imagePath);
    }
});

// 初始化代码高亮
const { highlightCode, getLanguageFromExtension, isTextFile, isImageFile } = useHighlight();

// 当前预览文件的内容哈希，用于检测文件是否变化
const fileContentHash = ref('');

/**
 * 计算字符串的简单哈希值
 */
function hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash.toString(16);
}

const isHtmlFile = computed(() => {
    if (!selectedFile.value) return false;
    const ext = selectedFile.value.extension.toLowerCase();
    return ext === '.html' || ext === '.htm';
});

// iframe src：在 htmlPreviewUrl 基础上附加版本号参数，文件变更时递增版本以强制浏览器重新加载
const htmlPreviewSrc = computed(() => {
    if (!htmlPreviewUrl.value) return '';
    const separator = htmlPreviewUrl.value.includes('?') ? '&' : '?';
    return `${htmlPreviewUrl.value}${separator}_v=${htmlPreviewVersion.value}`;
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

// Markdown 渲染（仅负责渲染，不判断文件类型和模式）
const markdownHtml = computed(() => {
    if (!selectedFile.value || !fileContent.value) return '';
    return parseMarkdown(fileContent.value);
});

// 源码高亮（仅负责渲染，不判断文件类型和模式）
const highlightedCode = computed(() => {
    if (!selectedFile.value || !fileContent.value) return '';
    const lang = getLanguageFromExtension(selectedFile.value.extension.toLowerCase());
    if (lang) return highlightCode(fileContent.value, lang);
    return '';
});


/**
 * 增量更新树数据，保留已加载的子节点和展开状态
 * 通过就地修改数组元素，避免 el-tree 重新渲染
 */
function updateTreeData(oldNodes: WorkspaceNode[], newNodes: WorkspaceNode[]): void {
    // 创建新节点的映射表
    const newNodeMap = new Map<string, WorkspaceNode>();
    newNodes.forEach(node => {
        newNodeMap.set(node.path, node);
    });

    // 删除旧数组中不存在的节点（从后往前删，避免索引问题）
    for (let i = oldNodes.length - 1; i >= 0; i--) {
        if (!newNodeMap.has(oldNodes[i].path)) {
            oldNodes.splice(i, 1);
        }
    }

    // 更新或添加节点
    newNodes.forEach((newNode, index) => {
        const existingIndex = oldNodes.findIndex(n => n.path === newNode.path);

        if (existingIndex !== -1) {
            // 更新现有节点，保留 children（这是关键！）
            const oldNode = oldNodes[existingIndex];
            oldNode.name = newNode.name;
            oldNode.size = newNode.size;
            oldNode.hasChildren = newNode.hasChildren;
            oldNode.isDirectory = newNode.isDirectory;
            // 不替换 children，保持已加载的子节点和展开状态

            // 如果位置变了，移动到正确位置
            if (existingIndex !== index) {
                oldNodes.splice(existingIndex, 1);
                oldNodes.splice(index, 0, oldNode);
            }
        } else {
            // 添加新节点
            oldNodes.splice(index, 0, newNode);
        }
    });
}

/**
 * 加载工作目录树（使用官方节流）
 */
let treeLoadGeneration = 0;

async function loadTree(force = false) {
    const sessionId = props.sessionId;
    if (!sessionId) return;

    if (isLoading.value && !force) return;

    const generation = ++treeLoadGeneration;
    isLoading.value = true;
    try {
        const response = await apiService.getWorkspaceTree(sessionId);
        if (generation !== treeLoadGeneration || sessionId !== props.sessionId) {
            return;
        }

        // 保存当前选中路径
        const currentSelected = selectedNodePath.value;

        // 增量更新树数据，保留已加载的子节点和展开状态
        updateTreeData(treeData.value, response.tree || []);

        // 如果当前选中的文件还在树中，保持选中状态（由 selectedNodePath 驱动）
        selectedNodePath.value = currentSelected;

        // 加载工作目录路径（用于顶部工具栏显示）
        if (!currentWorkspacePath.value) {
            try {
                const pathResp = await apiService.getWorkspacePath(sessionId);
                if (generation === treeLoadGeneration) {
                    currentWorkspacePath.value = pathResp.workspacePath || null;
                }
            } catch {
                // 忽略路径获取失败
            }
        }
    } catch (error: any) {
        if (generation === treeLoadGeneration && sessionId === props.sessionId) {
            console.error('Failed to load workspace tree:', error);
        }
    } finally {
        if (generation === treeLoadGeneration) {
            isLoading.value = false;
        }
    }
}


/**
 * 刷新树（强制立即执行）
 * 清空数据重新加载，就像新打开会话一样
 */
function refreshTree() {
    treeData.value = [];
    loadTree(true);
}

/**
 * 检查路径是否在已展开的目录下
 * 如果父目录未展开，则该路径下的变化不需要更新展示
 * 由 updateNodeLocal 中的 !parentNode.children 守卫处理
 */
function isPathInExpandedDir(_filePath: string): boolean {
    return true;
}

/**
 * 处理文件系统变化事件
 * 直接本地更新节点，不再请求后端 API
 */
function handleFileChange(event: FileChangeEvent) {
    // 忽略心跳消息
    if (event.type === 'heartbeat') {
        return;
    }

    // 判断变化的文件是否在已展开的目录下
    if (!event.path || !isPathInExpandedDir(event.path)) {
        return;
    }

    // 本地更新节点
    updateNodeLocal(event);
}

/**
 * 根据文件变化事件本地更新节点
 */
function updateNodeLocal(event: FileChangeEvent) {
    const normalizedPath = event.path.replace(/\\/g, '/');
    const parts = normalizedPath.split('/');
    const fileName = parts[parts.length - 1];
    const parentPath = parts.length > 1 ? parts.slice(0, -1).join('/') : '';

    // 查找父节点
    const parentNode = findNodeByPath(treeData.value, parentPath);
    if (!parentNode) {
        return;
    }

    // 如果父节点尚未加载（未展开过），忽略此次更新
    // 根目录（path 为空）始终视为已加载
    if (!parentNode.children && parentNode.path !== '') {
        return;
    }

    // 确保父节点有 children 数组
    if (!parentNode.children) {
        parentNode.children = [];
    }

    switch (event.type) {
        case 'add':
        case 'addDir':
            // 检查是否已存在
            if (parentNode.children.some(child => child.name === fileName)) {
                break;
            }
            // 创建新节点
            const newNode: WorkspaceNode = {
                name: fileName,
                path: normalizedPath,
                isDirectory: event.type === 'addDir',
                hasChildren: event.type === 'addDir',
            };
            // 直接添加到数组，Vue 响应式会自动更新视图
            parentNode.children.push(newNode);
            parentNode.children.sort((a, b) => {
                if (a.isDirectory !== b.isDirectory) {
                    return a.isDirectory ? -1 : 1;
                }
                return a.name.localeCompare(b.name);
            });
            break;

        case 'unlink':
        case 'unlinkDir': {
            // 从 children 数组中移除
            const rmIdx = parentNode.children.findIndex(child => child.name === fileName);
            if (rmIdx !== -1) {
                parentNode.children.splice(rmIdx, 1);
            }
            // 如果删除的是已打开的文件标签，关闭对应标签
            const unlinkPath = normalizedPath;
            const unlinkKey = `file:${unlinkPath}`;
            const unlinkTab = tabs.value.find(t => t.key === unlinkKey);
            if (unlinkTab) {
                void closeTab(unlinkTab);
            }
            break;
        }

        case 'change':
            // 文件内容变化，刷新预览内容（如果是当前选中的文件）
            if (selectedFile.value && selectedFile.value.path === normalizedPath) {
                loadFileContent(normalizedPath, false, true);
            }
            break;
    }
}

/**
 * 根据路径查找节点
 */
function findNodeByPath(nodes: WorkspaceNode[], path: string): WorkspaceNode | null {
    if (!path) {
        // 返回根节点（虚拟节点，包含所有根级子节点）
        return { name: '', path: '', isDirectory: true, children: nodes };
    }

    for (const node of nodes) {
        if (node.path === path) {
            return node;
        }
        if (node.children && node.children.length > 0) {
            const found = findNodeByPath(node.children, path);
            if (found) return found;
        }
    }
    return null;
}

/**
 * 处理节点右键菜单
 */
function handleContextMenu(event: MouseEvent, data: WorkspaceNode) {
    event.preventDefault();
    contextMenu.value = {
        visible: true,
        x: event.clientX,
        y: event.clientY,
        node: data,
    };
}

/**
 * 关闭右键菜单
 */
function closeContextMenu() {
    contextMenu.value.visible = false;
    contextMenu.value.node = null;
}

/**
 * 安全写入剪贴板
 */
async function writeToClipboard(text: string): Promise<void> {
    if (!text) return;

    const electronAPI = window.electronAPI;

    // 优先使用 Electron IPC 方式
    if (electronAPI?.clipboardIPC?.writeText) {
        try {
            const result = await electronAPI.clipboardIPC.writeText(text);
            if (!result.success) {
                throw new Error(result.error);
            }
            return;
        } catch (error) {
            console.warn('[Workspace] IPC 写入失败，尝试其他方式:', error);
        }
    }

    // 尝试直接调用 preload 暴露的 clipboard API
    if (electronAPI?.clipboard?.writeText) {
        try {
            electronAPI.clipboard.writeText(text);
            return;
        } catch (error) {
            console.warn('[Workspace] 直接调用失败，尝试 Web API:', error);
        }
    }

    // 回退到 Web Clipboard API
    if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
            await navigator.clipboard.writeText(text);
        } catch (error) {
            console.error('[Workspace] Web Clipboard API 写入失败:', error);
            ElMessage.error('复制失败');
        }
    } else {
        console.error('[Workspace] 所有剪贴板 API 都不可用');
        ElMessage.error('复制失败');
    }
}

/**
 * 复制文件名
 */
async function handleCopyFileName() {
    const node = contextMenu.value.node;
    if (!node) return;

    await writeToClipboard(node.name);
    ElMessage.success('文件名已复制');
    closeContextMenu();
}

/**
 * 复制路径（绝对路径）
 */
async function handleCopyFilePath() {
    const node = contextMenu.value.node;
    if (!node || !props.sessionId) return;

    try {
        // 获取工作目录绝对路径
        const response = await apiService.getWorkspacePath(props.sessionId);
        const workspacePath = response.workspacePath;
        if (!workspacePath) {
            ElMessage.error('无法获取工作目录路径');
            closeContextMenu();
            return;
        }

        // 拼接完整绝对路径
        const relativePath = node.path.replace(/\\/g, '/');
        const separator = workspacePath.endsWith('/') || workspacePath.endsWith('\\') || relativePath.startsWith('/') ? '' : '/';
        const fullPath = workspacePath + separator + relativePath;

        await writeToClipboard(fullPath);
        ElMessage.success('路径已复制');
    } catch (error: any) {
        console.error('Failed to get workspace path for copy:', error);
        ElMessage.error('复制路径失败');
    }
    closeContextMenu();
}

/**
 * 在资源管理器中打开（文件会选中，目录直接打开）
 */
async function handleOpenInExplorer() {
    const node = contextMenu.value.node;
    if (!node || !isElectron || !props.sessionId) return;

    try {
        // 获取工作目录绝对路径
        const response = await apiService.getWorkspacePath(props.sessionId);
        const workspacePath = response.workspacePath;
        if (!workspacePath) {
            ElMessage.error('无法获取工作目录路径');
            closeContextMenu();
            return;
        }

        // 拼接完整绝对路径
        const relativePath = node.path.replace(/\\/g, '/');
        const separator = workspacePath.endsWith('/') || workspacePath.endsWith('\\') || relativePath.startsWith('/') ? '' : '/';
        const fullPath = workspacePath + separator + relativePath;

        if (node.isDirectory) {
            // 目录：直接打开
            await window.electronAPI!.openFolder(fullPath);
        } else {
            // 文件：在资源管理器中显示并选中
            await window.electronAPI!.showItemInFolder(fullPath);
        }
    } catch (error: any) {
        console.error('Failed to open in explorer:', error);
        ElMessage.error('打开失败');
    }
    closeContextMenu();
}

/**
 * 用 VSCode 打开文件
 */
async function handleOpenInVSCode() {
    const node = contextMenu.value.node;
    if (!node || !isElectron || !props.sessionId) return;

    try {
        const response = await apiService.getWorkspacePath(props.sessionId);
        const workspacePath = response.workspacePath;
        if (!workspacePath) {
            ElMessage.error('无法获取工作目录路径');
            closeContextMenu();
            return;
        }

        const relativePath = node.path.replace(/\\/g, '/');
        const separator = workspacePath.endsWith('/') || workspacePath.endsWith('\\') || relativePath.startsWith('/') ? '' : '/';
        const fullPath = workspacePath + separator + relativePath;

        await window.electronAPI!.openWithEditor(fullPath, 'vscode');
        ElMessage.success('已通过 VSCode 打开');
    } catch (error: any) {
        console.error('Failed to open in VSCode:', error);
        ElMessage.error('打开失败，请确认已安装 VSCode 且 code 命令可用');
    }
    closeContextMenu();
}

/**
 * 重命名文件/目录 - 弹出输入框
 */
async function handleRename() {
    const node = contextMenu.value.node;
    if (!node || !props.sessionId) {
        closeContextMenu();
        return;
    }

    try {
        const { value: newName } = await ElMessageBox.prompt(
            '请输入新名称',
            '重命名',
            {
                inputValue: node.name,
                inputPlaceholder: '请输入新文件名',
                confirmButtonText: '确定',
                cancelButtonText: '取消',
                inputValidator: (val: string) => {
                    if (!val || !val.trim()) return '名称不能为空';
                    if (val.includes('/') || val.includes('\\')) return '名称不能包含路径分隔符';
                    return true;
                },
            },
        );

        if (!newName || !newName.trim()) {
            closeContextMenu();
            return;
        }

        const result = await apiService.renameWorkspaceFile(
            props.sessionId,
            node.path,
            newName.trim(),
        );

        if (result.success) {
            ElMessage.success('重命名成功');
            // 本地更新节点名称，避免重新加载整棵树
            node.name = newName.trim();
            if (result.newPath) {
                node.path = result.newPath;
            }
            // 如果当前预览的文件正好是重命名的文件，更新预览路径
            if (selectedFile.value && selectedFile.value.path === node.path) {
                selectedFile.value.name = newName.trim();
                selectedFile.value.path = result.newPath || node.path;
                const ext = newName.trim().substring(newName.trim().lastIndexOf('.')).toLowerCase();
                selectedFile.value.extension = ext;
            }
        }
    } catch (error: any) {
        // ElMessageBox.prompt 取消会抛异常，忽略
        if (error === 'cancel' || error === 'close') {
            closeContextMenu();
            return;
        }
        console.error('[WorkspaceSidebar] Rename failed:', error);
        ElMessage.error(error?.response?.data?.message || error.message || '重命名失败');
    }
    closeContextMenu();
}

/**
 * 删除文件/目录 - 二次确认后执行
 */
async function handleDelete() {
    const node = contextMenu.value.node;
    if (!node || !props.sessionId) {
        closeContextMenu();
        return;
    }

    const displayName = node.name;
    const typeLabel = node.isDirectory ? '目录' : '文件';

    try {
        await ElMessageBox.confirm(
            `确定要删除${typeLabel}「${displayName}」吗？${node.isDirectory ? '该目录下的所有内容将被永久删除。' : ''}`,
            '删除确认',
            {
                confirmButtonText: '确定删除',
                cancelButtonText: '取消',
                type: 'warning',
                distinguishCancelAndClose: true,
            },
        );

        const result = await apiService.deleteWorkspaceFile(
            props.sessionId,
            node.path,
        );

        if (result.success) {
            ElMessage.success('删除成功');
            // 如果删除的是已打开的文件标签，关闭对应标签
            const deleteTabKey = `file:${node.path}`;
            const deleteTab = tabs.value.find(t => t.key === deleteTabKey);
            if (deleteTab) {
                void closeTab(deleteTab);
            }
        }
    } catch (error: any) {
        // ElMessageBox.confirm 取消会抛异常，忽略
        if (error === 'cancel' || error === 'close') {
            closeContextMenu();
            return;
        }
        console.error('[WorkspaceSidebar] Delete failed:', error);
        ElMessage.error(error?.response?.data?.message || error.message || '删除失败');
    }
    closeContextMenu();
}

/**
 * 处理文件选择
 *
 * 所有文件都打开预览面板，按类型决定显示内容：
 * - 文本文件 → 通过 API 加载内容（后端限制 5MB）
 * - 图片文件（Electron）→ 拼接本地 file:// 路径，无大小限制
 * - 图片文件（非 Electron）→ 使用 rawfile URL（后端限制 20MB）
 * - 不支持格式 → 显示"此文件暂不支持预览" + Electron 打开按钮
 */
async function handleFileSelect(node: WorkspaceNode) {
    if (node.isDirectory) return;
    if (!props.sessionId) return;

    const ext = node.name.substring(node.name.lastIndexOf('.')).toLowerCase();

    // 进入预览模式（若尚未进入）
    if (!isPreviewMode.value) {
        isPreviewMode.value = true;
        emit('preview-open');
    }

    // 取消浏览器激活，切换到文件预览
    browserStore.setActive(null);

    // 添加到统一标签列表（去重）
    const tabKey = `file:${node.path}`;
    const existingTab = tabs.value.find(t => t.key === tabKey);
    if (!existingTab) {
        tabs.value.push({
            type: 'file',
            key: tabKey,
            name: node.name,
            path: node.path,
            extension: ext,
            size: node.size || 0,
        });
    }
    activeTabKey.value = tabKey;

    // 总是打开预览面板
    selectedFile.value = {
        name: node.name,
        path: node.path,
        extension: ext,
        size: node.size || 0,
        content: '',
        mimeType: ''
    };
    previewError.value = '';
    previewLoading.value = false;

    if (isTextFile(ext)) {
        // 文本文件：通过后端 API 读取（已有 5MB 限制）
        previewMode.value = 'text';
        fileContentHash.value = '';

        // HTML 文件走 iframe src 直连，无需加载内容
        if (isHtmlFile.value) {
            if (isElectron && window.location.protocol === 'file:') {
                // Electron 生产环境（file:// 协议）：直接使用 file:// 加载本地文件
                // 浏览器原生解析所有相对路径（CSS、图片等），无鉴权问题
                await loadHtmlPreviewLocal(node);
            } else {
                // Electron 开发模式（http://）和非 Electron 环境：走后端 html-preview 代理
                htmlPreviewUrl.value = apiService.getWorkspaceHtmlPreviewUrl(props.sessionId!, node.path);
            }
            // 同时加载文件内容，用于源码模式切换
            await loadFileContent(node.path);
        } else {
            await loadFileContent(node.path);
        }
    } else if (isImageFile(ext)) {
        previewMode.value = 'image';
        // Electron 正式环境（file:// 协议）：直连本地文件，无大小限制
        // 开发环境（http://localhost）或非 Electron：走 rawfile 接口，后端限制 20MB
        if (isElectron && window.location.protocol === 'file:') {
            await loadImageLocal(node);
        } else {
            // 非 Electron / Electron 开发环境：rawfile URL 携带 ?token=，直接 <img> 渲染
            if (node.size && node.size > 20 * 1024 * 1024) {
                previewError.value = '文件过大暂不支持预览';
            } else {
                imagePreviewUrl.value = apiService.getWorkspaceRawFileUrl(props.sessionId, node.path);
            }
        }
    } else {
        // 不支持的文件格式
        previewMode.value = 'unsupported';
    }


}

/**
 * Electron 环境下加载本地图片
 * 获取工作目录绝对路径，拼接相对路径构造 file:// URL
 */
async function loadImageLocal(node: WorkspaceNode) {
    try {
        const resp = await apiService.getWorkspacePath(props.sessionId!);
        const absWorkspacePath = resp.workspacePath;
        if (!absWorkspacePath) {
            previewError.value = '无法获取工作目录路径';
            return;
        }
        // 拼接绝对路径：工作目录 + 文件相对路径
        const relativePath = node.path.replace(/\\/g, '/');
        const separator = absWorkspacePath.endsWith('/') || absWorkspacePath.endsWith('\\') ? '' : '/';
        const fullPath = (absWorkspacePath + separator + relativePath).replace(/\\/g, '/');
        // encodeURI 编码空格、中文等特殊字符，但保留 : / 等 URL 合法字符
        const encodedPath = encodeURI(fullPath);
        // 构造 file:// 协议 URL，Windows 需要 / 前缀
        const fileUrl = encodedPath.startsWith('/') ? `file://${encodedPath}` : `file:///${encodedPath}`;
        imagePreviewUrl.value = fileUrl;
        console.log('[WorkspaceSidebar] Image local URL:', fileUrl);
    } catch (error: any) {
        previewError.value = '加载图片失败';
        console.error('[WorkspaceSidebar] Failed to load image locally:', error);
    }
}

/**
 * Electron 环境下加载本地 HTML 文件
 * 获取工作目录绝对路径，拼接相对路径构造 file:// URL
 * 浏览器原生处理所有相对路径（CSS、图片等）
 */
async function loadHtmlPreviewLocal(node: WorkspaceNode) {
    try {
        const resp = await apiService.getWorkspacePath(props.sessionId!);
        const absWorkspacePath = resp.workspacePath;
        if (!absWorkspacePath) {
            previewError.value = '无法获取工作目录路径';
            return;
        }
        const relativePath = node.path.replace(/\\/g, '/');
        const separator = absWorkspacePath.endsWith('/') || absWorkspacePath.endsWith('\\') ? '' : '/';
        const fullPath = (absWorkspacePath + separator + relativePath).replace(/\\/g, '/');
        const encodedPath = encodeURI(fullPath);
        const fileUrl = encodedPath.startsWith('/') ? `file://${encodedPath}` : `file:///${encodedPath}`;
        htmlPreviewUrl.value = fileUrl;
        console.log('[WorkspaceSidebar] HTML local URL:', fileUrl);
    } catch (error: any) {
        previewError.value = '加载 HTML 失败';
        console.error('[WorkspaceSidebar] Failed to load HTML locally:', error);
    }
}

/**
 * 加载文件内容
 * @param filePath 文件路径
 * @param force 是否强制刷新，忽略哈希对比
 * @param skipLoading 是否跳过 loading 状态（用于静默刷新）
 */
async function loadFileContent(filePath: string, force = false, skipLoading = false) {
    if (!props.sessionId) return;

    // 静默刷新时不显示 loading 状态，避免闪烁
    if (!skipLoading) {
        previewLoading.value = true;
    }
    previewError.value = '';
    fileNotFound.value = false;

    try {
        const response = await apiService.getWorkspaceFile(props.sessionId, filePath);

        // 计算新内容的哈希值
        const newHash = hashString(response.content);

        // 如果内容没有变化，不更新（保留滚动位置）
        if (!force && fileContentHash.value && newHash === fileContentHash.value) {
            previewLoading.value = false;
            return;
        }

        // 更新内容和哈希
        fileContentHash.value = newHash;
        selectedFile.value!.content = response.content;
        selectedFile.value!.extension = response.extension;
        selectedFile.value!.mimeType = response.mimeType;
        fileContent.value = response.content;

        // HTML 预览：递增版本号，强制 iframe 以新 URL 重新加载
        if (isHtmlFile.value && currentPreviewMode.value === 'rendered') {
            htmlPreviewVersion.value++;
        }
    } catch (error: any) {
        const status = error?.response?.status;
        const msg = error?.response?.data?.message || error.message || '';
        if (status === 404 || msg.includes('not found') || msg.includes('does not exist') || msg.includes('ENOENT')) {
            fileNotFound.value = true;
        } else if (msg.includes('File too large') || msg.includes('too large')) {
            previewError.value = '文件过大暂不支持预览';
        } else {
            previewError.value = '加载文件失败';
        }
        console.error('Failed to load file:', error);
    } finally {
        previewLoading.value = false;
    }
}

/**
 * 手动刷新预览
 */
function handleManualRefresh() {
    if (!selectedFile.value) return;
    // 重新加载文件内容（force=true 绕过哈希对比）
    loadFileContent(selectedFile.value.path, true, false);
}

/**
 * 关闭预览
 */
function closePreview() {
    selectedFile.value = null;
    fileContent.value = '';
    previewError.value = '';
    fileNotFound.value = false;
    previewMode.value = null;
    imagePreviewUrl.value = '';
    htmlPreviewUrl.value = '';
}

/**
 * 图片加载失败处理
 * - Electron: file:// 加载失败，通常是文件不存在/无法访问
 * - 非 Electron: rawfile 返回错误，通常是文件过大（超 20MB）
 */
function onImageError(event: Event | string) {
    const src = (typeof event === 'object' && (event as Event).target instanceof HTMLImageElement)
        ? (event.target as HTMLImageElement).getAttribute('src')
        : imagePreviewUrl.value;
    console.error('[WorkspaceSidebar] Image load failed, URL:', src);
    previewError.value = isElectron ? '图片加载失败' : '文件过大暂不支持预览';
}

/**
 * 在资源管理器中打开当前选中的文件（预览面板内的按钮使用）
 */
async function handleOpenInExplorerForCurrent() {
    if (!selectedFile.value || !props.sessionId || !isElectron) return;
    try {
        const resp = await apiService.getWorkspacePath(props.sessionId);
        const wsPath = resp.workspacePath;
        if (!wsPath) {
            ElMessage.error('无法获取工作目录路径');
            return;
        }
        const relativePath = selectedFile.value.path.replace(/\\/g, '/');
        const separator = wsPath.endsWith('/') || wsPath.endsWith('\\') || relativePath.startsWith('/') ? '' : '/';
        let fullPath = wsPath + separator + relativePath;
        // 如果是文件，打开其父目录
        const lastSep = Math.max(fullPath.lastIndexOf('/'), fullPath.lastIndexOf('\\'));
        if (lastSep > 0) {
            fullPath = fullPath.substring(0, lastSep);
        }
        await window.electronAPI!.openFolder(fullPath);
    } catch (error: any) {
        console.error('[WorkspaceSidebar] Open in explorer failed:', error);
        ElMessage.error('打开失败');
    }
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
 * 以 VSCode 打开工作目录
 */
async function openWorkspaceInVSCode() {
    if (!props.sessionId || !isElectron) return;

    try {
        const response = await apiService.getWorkspacePath(props.sessionId);
        if (response.workspacePath && window.electronAPI) {
            await window.electronAPI.openWithEditor(response.workspacePath, 'vscode');
        }
    } catch (error: any) {
        console.error('Failed to open workspace in VSCode:', error);
        ElMessage.error('打开失败，请确认已安装 VSCode 且 code 命令可用');
    }
}

/**
 * 更换工作目录路径
 * 打开工作目录设置弹窗
 */
async function changeWorkspacePath() {
    if (!props.sessionId) return;

    try {
        // 获取当前工作目录路径
        const response = await apiService.getWorkspacePath(props.sessionId);
        currentWorkspacePath.value = response.workspacePath || null;
        workspaceDialogVisible.value = true;
    } catch (error: any) {
        console.error('Failed to get workspace path:', error);
        // 获取失败也打开弹窗，路径为空
        currentWorkspacePath.value = null;
        workspaceDialogVisible.value = true;
    }
}

/**
 * 处理工作目录变更确认
 */
async function handleWorkspaceChange(workspacePath: string | null) {
    const sessionId = props.sessionId;
    if (!sessionId || !workspacePath) return;

    const previousExpandedPaths = new Set(expandedPaths.value);
    resetExpandedPaths();
    if (!(await syncExpandedPaths(sessionId))) {
        expandedPaths.value = previousExpandedPaths;
        ElMessage.error('同步工作目录监听状态失败');
        return;
    }

    try {
        await apiService.updateSessionWorkspacePath(sessionId, workspacePath);
        if (sessionId !== props.sessionId) return;

        ElMessage.success('工作目录已更换');
        watchedWorkspacePath = workspacePath;
        treeData.value = [];
        await loadTree(true);
    } catch (error: any) {
        if (sessionId === props.sessionId) {
            expandedPaths.value = previousExpandedPaths;
            void syncExpandedPaths(sessionId);
        }
        console.error('Failed to change workspace path:', error);
        ElMessage.error(error.message || '更换工作目录失败');
    }
}

let unsubscribeWatcher: (() => void) | null = null;
let watchedWorkspacePath: string | null = null;

async function handleWorkspaceWatcherConnected(sessionId: string) {
    if (sessionId !== props.sessionId) return;

    try {
        const response = await apiService.getWorkspacePath(sessionId);
        if (sessionId !== props.sessionId) return;

        const nextWorkspacePath = response.workspacePath || null;
        const workspaceChanged =
            watchedWorkspacePath !== null &&
            nextWorkspacePath !== watchedWorkspacePath;
        watchedWorkspacePath = nextWorkspacePath;

        if (workspaceChanged) {
            resetExpandedPaths();
            treeData.value = [];
        }
        await syncExpandedPaths(sessionId);
        if (workspaceChanged) {
            await loadTree(true);
        }
    } catch (error) {
        console.error('[WorkspaceSidebar] 恢复工作目录监听失败:', error);
    }
}

watch(() => props.sessionId, async (newSessionId, oldSessionId) => {
    treeLoadGeneration++;
    isLoading.value = false;

    // 会话切换时关闭文件预览并清理旧会话的展开状态
    if (oldSessionId && newSessionId !== oldSessionId) {
        if (isPreviewMode.value) {
            isPreviewMode.value = false;
            emit('preview-close');
        }
        closePreview();
        tabs.value = [];
        activeTabKey.value = null;
        watchedWorkspacePath = null;
        resetExpandedPaths();
        treeData.value = [];
        currentWorkspacePath.value = null;
        apiService.disconnectWorkspaceWatcher();
        if (unsubscribeWatcher) {
            unsubscribeWatcher();
            unsubscribeWatcher = null;
        }
    }

    if (newSessionId) {
        loadTree(true); // 会话切换时强制启动新请求

        // 先注册变化监听器，再连接并在每次自动重连后重报展开状态
        unsubscribeWatcher = apiService.onWorkspaceChange(handleFileChange);
        apiService.connectWorkspaceWatcher(newSessionId, () => {
            void handleWorkspaceWatcherConnected(newSessionId);
        });

        // 恢复预览标签状态（侧边栏可见时才恢复）
        restorePreviewCache(newSessionId);
    } else {
        watchedWorkspacePath = null;
        resetExpandedPaths();
        treeData.value = [];
        apiService.disconnectWorkspaceWatcher();
        if (unsubscribeWatcher) {
            unsubscribeWatcher();
            unsubscribeWatcher = null;
        }
    }
}, { immediate: true });

onUnmounted(() => {
    watchedWorkspacePath = null;
    resetExpandedPaths();
    apiService.disconnectWorkspaceWatcher();
    if (unsubscribeWatcher) {
        unsubscribeWatcher();
        unsubscribeWatcher = null;
    }
    if (treeHideTimer) {
        clearTimeout(treeHideTimer);
        treeHideTimer = null;
    }
    if (treeShowTimer) {
        clearTimeout(treeShowTimer);
        treeShowTimer = null;
    }
    closeContextMenu();
});
</script>
<style>
@import "@/assets/markdown.css";

.code-preview-container pre code.hljs {
    color: var(--color-text, #333) !important;
}

/* 代码行号样式 */
.code-lines {
    display: flex;
    flex-direction: column;
}

.line {
    display: flex;
    min-height: 1.5em;
}

.line-num {
    box-sizing: content-box;
    user-select: none;
    text-align: right;
    padding-right: 0.75em;
    color: #9ca3af;
    font-variant-numeric: tabular-nums;
    border-right: 1px solid #e5e7eb;
    margin-right: 0.75em;
}

.dark .line-num {
    color: #4b5563;
    border-right-color: #374151;
}

.line-content {
    flex: 1;
    white-space: pre;
}
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
    color: var(--color-text, #333) !important;
}

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

/* 工作目录树样式 — 已迁移到 WorkspaceTreeNode.vue */

/* 工作目录工具按钮 - 纯图标无框样式 */
.workspace-tool-btn {
    color: var(--color-text-gray);
    cursor: pointer;
    font-size: 14px;
    height: 24px;
    width: 24px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
    margin: 0 2px;
    border: none;
    background: transparent;
    border-radius: 6px;
    outline: none;
}

.workspace-tool-btn:hover {
    background: var(--color-sidebar-bg-hover);
    color: var(--color-text);
}

/* 预览/源码模式切换按钮 */
.preview-mode-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    background: transparent;
    color: var(--color-text-gray);
    transition: all 0.15s ease;
    outline: none;
}

.preview-mode-btn:hover {
    background: var(--color-sidebar-bg-hover);
}

.preview-mode-btn.is-active {
    color: var(--color-text);
    background: var(--color-bg);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}

/* 关闭预览按钮 */
.preview-close-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    background: transparent;
    color: var(--color-text);
    transition: all 0.15s ease;
    outline: none;
}

.preview-close-btn:hover {
    background: var(--color-sidebar-bg-hover);
}

.drag-region {
    -webkit-app-region: drag;
}

.no-drag {
    -webkit-app-region: no-drag;
}

/* ── 顶部工具栏按钮 ── */
.sidebar-tool-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 4px;
    border: none;
    border-radius: 8px;
    background: transparent;
    cursor: pointer;
    color: var(--color-text-gray);
    flex-shrink: 0;
    align-self: center;
    transition: all 0.2s;
}

.sidebar-tool-btn:hover:not(:disabled) {
    background: var(--color-sidebar-bg-hover);
    color: var(--color-text);
}

.sidebar-tool-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
}

/* ── 浏览器标签 ── */
.browser-tabs-scroll {
    scrollbar-width: none;
    padding: 0 2px;
}

.browser-tabs-scroll::-webkit-scrollbar {
    display: none;
}

.browser-tab {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 1px 6px;
    height: 26px;
    min-width: 0;
    max-width: 190px;
    border-radius: 6px;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.15s;
}

.browser-tab:hover {
    background: var(--color-sidebar-bg-hover);
}

.browser-tab.active {
    background: var(--color-sidebar-bg-active);
}

.tab-favicon {
    width: 14px;
    height: 14px;
    border-radius: 2px;
    flex-shrink: 0;
    object-fit: contain;
}

.tab-globe {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-gray);
}

.tab-title {
    font-size: 13px;
    line-height: 1;
    color: var(--color-text-gray);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
}

.browser-tab.active .tab-title {
    color: var(--color-text);
    font-weight: 500;
}

.tab-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 4px;
    color: var(--color-text);
    flex-shrink: 0;
    opacity: 0.7;
    transition: opacity 0.15s, background 0.15s, color 0.15s;
}

.browser-tab:hover .tab-close,
.browser-tab.active .tab-close {
    opacity: 1;
}

.tab-close:hover {
    background: rgba(239, 68, 68, 0.1);
    color: #ef4444;
}

/* ── 悬浮目录树面板（预览模式下） ── 视觉风格对齐 CustomPopover */
.tree-floating-panel {
    position: fixed;
    z-index: 2000;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    box-shadow: 0 0 16px rgba(0, 0, 0, 0.10);
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transform: translateY(-8px) scale(0.98);
    padding-bottom: 4px;
}

.tree-floating-panel.tree-transition-ready {
    transition: opacity 0.25s ease, transform 0.25s ease, visibility 0.25s;
}

.dark .tree-floating-panel {
    background: var(--color-surface, #242529);
    border-color: var(--color-surface-border, #2e3035);
    box-shadow: 0 0 8px rgba(0, 0, 0, 0.4);
}

.tree-floating-panel.tree-floating-visible {
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
    transform: translateY(0) scale(1);
}

/* ── 工作区/预览区 分段按钮 ── */
.seg-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 4px;
    border: none;
    background: transparent;
    color: var(--color-text-gray);
    cursor: pointer;
    border-radius: 8px;
    transition: all 0.2s;
    outline: none;
}

.seg-btn :deep(svg) {
    width: 20px;
    height: 20px;
}

.seg-btn:hover:not(:disabled) {
    background: var(--color-sidebar-bg-hover);
    color: var(--color-text);
}

.seg-btn.active {
    color: var(--color-text);
    background: var(--color-sidebar-bg-active);
}

.seg-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
}

/* ── 空状态页按钮 ── */
.empty-state-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    background: transparent;
    color: var(--color-text-gray);
    cursor: pointer;
    font-size: 13px;
    transition: all 0.15s ease;
    outline: none;
}

.empty-state-btn:hover:not(:disabled) {
    background: var(--color-sidebar-bg-hover);
    color: var(--color-text);
    border-color: var(--color-text-gray);
}

.empty-state-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
}

.dark .empty-state-btn {
    border-color: var(--color-surface-border, #2e3035);
}
</style>
