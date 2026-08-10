<template>
    <div class="workspace-sidebar h-full flex flex-col relative">
        <!-- 顶部工具栏：资源管理器按钮 + 浏览器标签 + 窗口控制 -->
        <div
            class="flex items-center h-11 drag-region shrink-0 border-b border-gray-100 dark:border-[#2e3035]">
            <!-- 工作区 / 预览区 切换按钮 -->
            <div class="ml-1 shrink-0 no-drag flex items-center gap-0.5 mr-1">
                <LTooltip :content="t('chat.workspace.workspaceArea')" placement="bottom">
                  <button ref="workspaceBtnRef" class="seg-btn" :class="{ active: !isPreviewMode }"
                      @click="showFileTree" @mouseenter="showTreePanel" @mouseleave="hideTreePanel">
                      <el-icon :size="20">
                          <Folder16Regular />
                      </el-icon>
                  </button>
                </LTooltip>
                <LTooltip :content="t('chat.workspace.previewArea')" placement="bottom">
                  <button class="seg-btn" :class="{ active: isPreviewMode }" :disabled="!props.sessionId"
                      @click="enterPreviewMode">
                      <el-icon :size="20">
                          <Window16Regular />
                      </el-icon>
                  </button>
                </LTooltip>
            </div>

            <!-- 标签 + 新建按钮容器（预览模式且有标签时显示） -->
            <div ref="tabBarRef" v-if="isPreviewMode && tabs.length > 0"
                class="flex items-center gap-0.5 shrink-0 overflow-x-auto no-drag browser-tabs-scroll"
                @wheel="onTabBarWheel">
                <!-- 统一标签（文件 + 浏览器，按创建顺序，可拖拽排序） -->
                <div v-for="(tab, index) in tabs" :key="tab.key" class="browser-tab"
                    :class="{ active: activeTabKey === tab.key }"
                    :title="tab.type === 'file' ? tab.name : (tab.title || t('chat.workspace.unnamedWindow'))" draggable="true"
                    @click="onTabClick(tab)" @dblclick="onTabDblClick(tab)"
                    @dragstart="onTabDragStart(index, $event)"
                    @dragover.prevent="onTabDragOver(index)" @drop.prevent="onTabDrop(index)" @dragend="onTabDragEnd">
                    <!-- 文件图标 -->
                    <img v-if="tab.type === 'file'" :src="getFileIcon(tab.name!)" class="tab-favicon" alt="" />
                    <!-- 浏览器图标 -->
                    <template v-else>
                        <img v-if="tab.favicon" :src="tab.favicon" class="tab-favicon" alt=""
                            @error="onFaviconImageError($event, tab)" />
                        <span v-else class="tab-globe">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                stroke-width="2">
                                <circle cx="12" cy="12" r="10" />
                                <path
                                    d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                            </svg>
                        </span>
                    </template>
                    <span class="tab-title" :class="{ 'is-preview': tab.isPreview }">{{
                        truncateTabTitle(tab.type === 'file' ? tab.name! : (tab.title || t('chat.workspace.newWindow')))
                        }}</span>
                    <span class="tab-close"
                        @click.stop="closeTab(tab)">
                        <el-icon size="10">
                            <Close />
                        </el-icon>
                    </span>
                </div>

                <!-- 新建标签按钮：进入预览模式并取消当前选中（显示空状态页） -->
                <LTooltip :content="t('chat.workspace.newTab')" placement="bottom">
                    <button class="sidebar-tool-btn no-drag" :disabled="!props.sessionId" @click="deselectAllTabs">
                        <el-icon size="14">
                            <Plus />
                        </el-icon>
                    </button>
                </LTooltip>
            </div>

            <!-- 弹性占位（拖拽区域） -->
            <div class="flex-1"></div>

            <!-- 全屏按钮 -->
            <LTooltip :content="layoutStore.workspaceFullscreen ? t('chat.workspace.exitFullscreen') : t('chat.workspace.fullscreen')" placement="bottom">
                <button class="sidebar-tool-btn no-drag" @click="layoutStore.toggleWorkspaceFullscreen()">
                    <el-icon :size="16">
                        <FullScreenMaximize16Regular v-if="!layoutStore.workspaceFullscreen" />
                        <ArrowMinimize16Regular v-else />
                    </el-icon>
                </button>
            </LTooltip>

            <!-- 窗口控制按钮（仅 Electron） -->
            <WindowControls v-if="isElectron" class="no-drag" />
        </div>
        <!-- 目录树（预览时隐藏，v-show 保留 DOM） -->
        <div :class="treeContainerClass" :style="isPreviewMode && !treePhase1Hide ? treePanelStyle : {}" @mouseenter="showTreePanel"
            @mouseleave="hideTreePanel">
            <!-- 浏览器窗口列表（仅 Electron 环境，资源管理器模式下显示） -->
            <SessionBrowserWindowList v-if="isElectron && browserStore.sessionWebviews.length > 0"
                v-show="!isPreviewMode" :session-id="props.sessionId"
                @activate="handleBrowserWindowActivate" @close="handleBrowserWindowClose"
                @create="createNewBrowserWindow" />
            <div v-if="isElectron && browserStore.sessionWebviews.length > 0" v-show="!isPreviewMode"
                class="border-b border-gray-100 dark:border-[#2e3035] mx-4 mt-3"></div>
            <!-- 待办事项列表 -->
            <SessionTodoList v-show="!isPreviewMode" :session-id="props.sessionId" />
            <!-- 头部 -->
            <div class="shrink-0 flex items-center justify-between px-2  py-3 ">
                <h3 class="text-sm font-normal text-gray-500 dark:text-[#8b8d95] whitespace-nowrap mx-2">
                    {{ t('chat.workspace.workingDir') }}</h3>
                <div class="flex items-center gap-0 shrink-0">
                    <!-- 打开文件夹按钮（仅 Electron 环境） -->
                    <LTooltip v-if="isElectron" :content="t('chat.workspace.openInFileManager')" placement="bottom">
                        <el-button class="workspace-tool-btn" text @click="openInFileManager">
                            <el-icon size="15">
                                <WindowsExplorer />
                            </el-icon>
                        </el-button>
                    </LTooltip>
                    <!-- 以 VSCode 打开工作目录（仅 Electron 环境） -->
                    <LTooltip v-if="isElectron" :content="t('chat.workspace.openInVSCode')" placement="bottom">
                        <el-button class="workspace-tool-btn" text @click="openWorkspaceInVSCode">
                            <el-icon size="15">
                                <VsCode />
                            </el-icon>
                        </el-button>
                    </LTooltip>
                    <!-- 刷新按钮 -->
                    <LTooltip :content="t('chat.workspace.refresh')" placement="bottom">
                        <el-button class="workspace-tool-btn" text @click="refreshTree" :loading="isLoading">
                            <el-icon size="15">
                                <Refresh />
                            </el-icon>
                        </el-button>
                    </LTooltip>
                </div>
            </div>

            <!-- 目录树内容 -->
            <div class="flex-1 overflow-auto min-w-0">
                <div v-if="!treeData.length" class="text-center py-12 text-gray-400 dark:text-[#6b6d73] text-xs p-2">
                    {{ t('chat.workspace.noFiles') }}
                </div>

                <WorkspaceTree v-else :nodes="treeData" :selected-path="selectedNodePath" :loading-paths="loadingPaths"
                    :on-load="(node) => handleTreeNodeToggle(node, true)" @select="handleTreeNodeSelect"
                    @toggle="handleTreeNodeExpandToggle" @contextmenu="handleContextMenu" />
            </div>
        </div>

        <!-- 浏览器窗口预览占位（webview 实际在 MainLayout 层，此处仅空壳坐标） -->
        <BrowserPreviewPlaceholder v-if="isElectron" v-show="isPreviewMode && !!browserStore.activeWindowId" />

        <!-- 文件预览面板（visibility:hidden 持久化，DOM 不销毁且保留滚动位置，含跨域 iframe） -->
        <template v-if="sessionId">
            <FilePreviewPanel v-for="tab in fileTabs" :key="tab.key"
                :class="{ 'panel-hidden': !(isPreviewMode && activeTabKey === tab.key && !browserStore.activeWindowId) }"
                :session-id="sessionId" :tab="tab"
                :is-active="isPreviewMode && activeTabKey === tab.key && !browserStore.activeWindowId"
                :content-version="fileChangeVersions[tab.path!] || 0"
                :workspace-path="currentWorkspacePath"
                @close="closeTab(tab)"
                @insert-to-input="emit('insert-to-input', $event)"
                @insert-snip="emit('insert-snip', $event)" />
        </template>

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
                <p class="text-gray-400 dark:text-[#6b6d73] text-sm mb-4">{{ t('chat.workspace.noPreviewFile') }}</p>
                <div class="flex items-center gap-2 justify-center">
                    <button v-if="isElectron" class="empty-state-btn" :disabled="!props.sessionId"
                        @click="createNewBrowserWindow">
                        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                            stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="10" />
                            <path
                                d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                        </svg>
                        <span>{{ t('chat.workspace.newBrowser') }}</span>
                    </button>
                    <button class="empty-state-btn" @click="showFileTree">
                        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                            stroke-linecap="round" stroke-linejoin="round">
                            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                        </svg>
                        <span>{{ t('chat.workspace.selectFile') }}</span>
                    </button>
                </div>
            </div>
        </div>
    </div>

    <ContextMenu :visible="contextMenu.visible" :x="contextMenu.x" :y="contextMenu.y" :items="contextMenuItems"
        @close="closeContextMenu" />
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted, nextTick } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useI18n } from 'vue-i18n';
import { apiService, type FileChangeEvent } from '@/services/ApiService';
import { Refresh, CopyDocument, Edit, Delete, Plus, Close } from '@element-plus/icons-vue';
import { Folder16Regular, Window16Regular, ArrowMinimize16Regular, FullScreenMaximize16Regular } from '@vicons/fluent';
import { VsCode, WindowsExplorer } from '@/components/icons';
import { getFileIcon } from '@/composables/useFileIcon';
import ContextMenu, { type ContextMenuItem } from '@/components/ui/ContextMenu.vue';
import LTooltip from '@/components/ui/LTooltip.vue';
import FilePreviewPanel from './FilePreviewPanel.vue';
import SessionBrowserWindowList from './SessionBrowserWindowList.vue';
import SessionTodoList from './SessionTodoList.vue';
import WorkspaceTree from './WorkspaceTree.vue';
import BrowserPreviewPlaceholder from './BrowserPreviewPlaceholder.vue';
import { useBrowserWebviewStore } from '@/stores/browserWebview';
import { useLayoutStore } from '@/stores/layout';
import { useTabStore } from '@/stores/tab';
import { usePreviewTabCache, type UnifiedTab } from '@/composables/usePreviewTabCache';
import type { WorkspaceNode } from './WorkspaceTree.vue';
import WindowControls from '@/components/WindowControls.vue';

const props = defineProps<{
    sessionId: string | null;
}>();

const { t } = useI18n();

const emit = defineEmits<{
    'insert-to-input': [path: string];
    'insert-snip': [data: import('@/components/chat/workspace/FilePreviewPanel.vue').SnipData];
}>();

const treeData = ref<WorkspaceNode[]>([]);
const isLoading = ref(false);
const currentWorkspacePath = ref<string | null>(null);
// 树节点高亮路径：从 activeTabKey 派生，与预览标签选中自动对齐
const selectedNodePath = computed(() => {
    const key = tabStore.activeTabKey;
    if (key?.startsWith('file:')) return key.slice(5);
    return '';
});

// 文件变更版本号（SSE 事件递增，驱动 FilePreviewPanel 重载）
const fileChangeVersions = ref<Record<string, number>>({});

// 文件标签列表（用于 v-for 渲染 FilePreviewPanel）
const fileTabs = computed(() => tabStore.tabs.filter(t => t.type === 'file'));

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
            label: t('chat.workspace.copyFileName'),
            icon: CopyDocument,
            onClick: handleCopyFileName,
        },
        {
            label: t('chat.workspace.copyPath'),
            icon: CopyDocument,
            onClick: handleCopyFilePath,
        },
        {
            label: t('chat.workspace.addToSession'),
            icon: Plus,
            divider: true,
            onClick: handleInsertToInput,
        },
    ];
    if (isElectron) {
        items.push({
            label: t('chat.workspace.openInExplorerShort'),
            icon: WindowsExplorer,
            onClick: handleOpenInExplorer,
        });
        // 文件/目录支持以 VSCode 打开
        items.push({
            label: t('chat.workspace.openInVSCodeShort'),
            icon: VsCode,
            onClick: handleOpenInVSCode,
        });
    }
    items.push({
        label: t('chat.workspace.rename'),
        icon: Edit,
        divider: true,
        onClick: handleRename,
    });
    items.push({
        label: t('chat.workspace.delete'),
        icon: Delete,
        onClick: handleDelete,
    });
    return items;
});

// 检测是否为 Electron 环境
const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

// 浏览器 webview store（用于预览占位与文件预览互斥）
const browserStore = useBrowserWebviewStore();
const layoutStore = useLayoutStore();
const tabStore = useTabStore();
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
    tabStore.reorderTab(dragSourceIndex, targetIndex)
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
    tabStore.enterPreviewMode()
    tabStore.selectTab(tab.key)
}

/** 双击标签栏：临时标签提升为持久 */
function onTabDblClick(tab: UnifiedTab): void {
    if (tab.type === 'file' && tab.isPreview) {
        tabStore.promoteTab(tab.key)
    }
}

// ── 悬浮目录树面板 ──
const isPreviewMode = computed(() => tabStore.isPreviewMode);
const tabs = computed(() => tabStore.tabs);
const activeTabKey = computed(() => tabStore.activeTabKey);
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

// Phase 1 hide: visibility:hidden without transform/opacity to avoid compositing layer flash
const treePhase1Hide = ref(false);

const treeContainerClass = computed(() => {
    if (!isPreviewMode.value) {
        return 'h-full flex flex-col flex-1 min-h-0';
    }
    if (treePhase1Hide.value) {
        return 'tree-hidden-preview';
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
        treePhase1Hide.value = false;
        if (treeHideTimer) {
            clearTimeout(treeHideTimer);
            treeHideTimer = null;
        }
        if (treeShowTimer) {
            clearTimeout(treeShowTimer);
            treeShowTimer = null;
        }
    } else {
        // Phase 1: 用 visibility:hidden + position:absolute 立即隐藏（无 transform/opacity，不创建合成层）
        treePhase1Hide.value = true;
        // Phase 2: 下一帧切换到 floating-panel class（此时已是 visibility:hidden，position 变化不可见）
        requestAnimationFrame(() => {
            treeTransitionReady.value = false;
            treePhase1Hide.value = false;
            // Phase 3: 再下一帧启用过渡（此时 floating-panel 已渲染，opacity:0 不会闪）
            requestAnimationFrame(() => {
                treeTransitionReady.value = true;
            });
        });
    }
});

// ── 浏览器标签操作 ──

function truncateTabTitle(title: string, maxLen = 12): string {
    return title.length <= maxLen ? title : title.substring(0, maxLen) + '...';
}

function onFaviconImageError(event: Event, tab: UnifiedTab): void {
    console.warn('[Favicon] sidebar image failed', {
        windowId: tab.windowId,
        chars: tab.favicon?.length || 0,
    })
    if (tab.windowId) {
        browserStore.updateWebview(tab.windowId, { favicon: undefined })
    }
    ;(event.target as HTMLImageElement).style.display = 'none'
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

/** 点击工作区按钮：退出预览模式 */
function showFileTree(): void {
    tabStore.exitPreviewMode()
}

/** 点击预览区按钮：进入预览模式 */
function enterPreviewMode(): void {
    tabStore.enterPreviewMode()
}

/** 取消所有标签选中，显示空状态页 */
function deselectAllTabs(): void {
    tabStore.enterPreviewMode()
    tabStore.selectTab(null)
}

// ── 浏览器 store 同步：由 tabStore 统一管理 ──
// 外部激活浏览器窗口时同步 activeTabKey
watch(() => browserStore.activeWindowId, () => {
    tabStore.syncActiveWindowId()
})

// 浏览器标签增删 + 元数据同步
// 使用字符串 fingerprint（基元类型，按值比较）避免 setActive 修改 isVisible 时
// map() 产生新对象引用导致 { deep: true } watch 误触发和 re-entrancy
watch(() => browserStore.sessionWebviews.map(w =>
    `${w.windowId}\0${w.title}\0${w.favicon || ''}\0${w.url}`
).join('\n'), () => {
    tabStore.syncBrowserTabs(browserStore.sessionWebviews.map(w => ({
        windowId: w.windowId, title: w.title, favicon: w.favicon, url: w.url,
    })))
})

// ── 预览标签缓存：保存当前会话状态到 localStorage ──

function savePreviewCache(): void {
    if (!props.sessionId) return;
    previewTabCache.saveSession(props.sessionId, {
        isPreviewMode: isPreviewMode.value,
        activeTabKey: tabStore.activeTabKey,
        tabs: tabStore.tabs.map(t => ({ ...t })),
    });
}

// 自动保存：当预览状态、标签列表、激活标签变化时
let isRestoring = false;
watch([isPreviewMode, () => tabStore.activeTabKey, () => tabStore.tabs], () => {
    if (!isRestoring) savePreviewCache();
}, { deep: true });

// ── 预览标签缓存：从 localStorage 恢复会话状态 ──
async function restorePreviewCache(sessionId: string): Promise<void> {
    const cached = previewTabCache.getSession(sessionId);
    if (!cached) return;

    isRestoring = true;

    try {
        // 恢复完整标签列表（保留顺序）
        tabStore.tabs = cached.tabs.map(t => ({ ...t }));

        // 过滤掉 webview 已不存在的浏览器标签（页面刷新场景）
        tabStore.tabs = tabStore.tabs.filter(tab => {
            if (tab.type === 'browser') {
                return browserStore.allWebviews.some(w => w.windowId === tab.windowId);
            }
            return true;
        });

        // 补充 store 中存在但缓存中没有的浏览器标签
        for (const wv of browserStore.sessionWebviews) {
            const key = `browser:${wv.windowId}`;
            if (!tabStore.tabs.some(t => t.key === key)) {
                tabStore.tabs.push({ type: 'browser', key, windowId: wv.windowId, title: wv.title, favicon: wv.favicon, url: wv.url });
            }
        }

        // 恢复预览模式 + 激活标签
        if (cached.isPreviewMode) {
            tabStore.enterPreviewMode()
            if (cached.activeTabKey && tabStore.tabs.some(t => t.key === cached.activeTabKey)) {
                await nextTick()
                tabStore.selectTab(cached.activeTabKey)
                // 内容加载由 FilePreviewPanel 自动处理
            } else if (tabStore.tabs.length > 0) {
                await nextTick()
                tabStore.selectTab(tabStore.tabs[0].key)
            }
        } else {
            // 非预览模式：恢复 activeTabKey 但不进入预览（通过 selectTab 确保 browserStore 同步）
            if (cached.activeTabKey && tabStore.tabs.some(t => t.key === cached.activeTabKey)) {
                tabStore.selectTab(cached.activeTabKey)
            }
        }
    } finally {
        isRestoring = false
        savePreviewCache()
    }
}

// ── 统一标签操作 ──

/** 关闭标签（统一入口） */
async function closeTab(tab: UnifiedTab): Promise<void> {
    if (tab.type === 'browser' && tab.windowId) {
        if (window.electronAPI) {
            try {
                await window.electronAPI.closeBrowserWindow(tab.windowId)
            } catch (e) {
                console.error('Failed to close browser window:', e)
            }
        }
        await nextTick()
    }
    tabStore.removeTab(tab.key)
}

/** 新建浏览器窗口：加载简约新建标签页 */
async function createNewBrowserWindow(): Promise<void> {
    if (!window.electronAPI || !props.sessionId) return;
    try {
        const result = await window.electronAPI.createBrowserWindow('about:blank', {
            sessionId: props.sessionId,
            createdBy: props.sessionId,
        });
        if (!result.success) {
            ElMessage.warning(result.error || t('chat.workspace.createWindowFailed'));
        } else if (result.window?.windowId) {
            tabStore.enterPreviewMode()
            tabStore.selectTab(`browser:${result.window.windowId}`)
        }
    } catch (e) {
        console.error('Failed to create browser window:', e);
    }
}

/** SessionBrowserWindowList 激活窗口 */
function handleBrowserWindowActivate(windowId: string): void {
    tabStore.enterPreviewMode()
    tabStore.selectTab(`browser:${windowId}`)
}

/** SessionBrowserWindowList 关闭窗口 */
function handleBrowserWindowClose(windowId: string): void {
    const key = `browser:${windowId}`;
    const tab = tabStore.tabs.find(t => t.key === key);
    if (tab) {
        void closeTab(tab);
    } else if (window.electronAPI) {
        void window.electronAPI.closeBrowserWindow(windowId);
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

const expandedPaths = ref<Set<string>>(new Set());

function resetExpandedPaths() {
    expandedPaths.value = new Set();
}

function handleTreeNodeExpandToggle(node: WorkspaceNode, expanded: boolean) {
    if (expanded) {
        expandedPaths.value = new Set(expandedPaths.value).add(node.path);
    } else {
        const next = new Set(expandedPaths.value);
        next.delete(node.path);
        expandedPaths.value = next;
    }
}

/**
 * 点击文件节点选中
 */
function handleTreeNodeSelect(node: WorkspaceNode, isPreview?: boolean) {
    if (node.isDirectory) return;
    handleFileSelect(node, isPreview);
}

/**
 * 递归合并树数据，保留已加载的子节点（避免刷新时丢失懒加载的 children）
 */
function mergeTreeData(oldNodes: WorkspaceNode[], newNodes: WorkspaceNode[]): WorkspaceNode[] {
    const oldMap = new Map(oldNodes.map(n => [n.path, n]));
    return newNodes.map(newNode => {
        const old = oldMap.get(newNode.path);
        if (old?.children?.length) {
            return { ...newNode, children: mergeTreeData(old.children, newNode.children || []) };
        }
        return newNode;
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

        // 合并树数据，保留已加载的子节点和展开状态
        treeData.value = mergeTreeData(treeData.value, response.tree || []);

        // 加载工作目录路径（用于顶部工具栏显示）
        if (!currentWorkspacePath.value) {
            const path = await fetchWorkspacePath(sessionId);
            if (generation === treeLoadGeneration && sessionId === props.sessionId) {
                currentWorkspacePath.value = path;
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
 * 处理文件系统变化事件
 * 直接本地更新节点，不再请求后端 API
 */
function handleFileChange(event: FileChangeEvent) {
    // 忽略心跳消息
    if (event.type === 'heartbeat') {
        return;
    }

    if (!event.path) return;

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
            const unlinkTab = tabStore.tabs.find(t => t.key === unlinkKey);
            if (unlinkTab) {
                void closeTab(unlinkTab);
            }
            break;
        }

        case 'change':
            // 递增文件变更版本号 → FilePreviewPanel 的 watch 会处理重载
            fileChangeVersions.value = {
                ...fileChangeVersions.value,
                [normalizedPath]: (fileChangeVersions.value[normalizedPath] || 0) + 1
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
            ElMessage.error(t('chat.workspace.copyFailed'));
        }
    } else {
        console.error('[Workspace] 所有剪贴板 API 都不可用');
        ElMessage.error(t('chat.workspace.copyFailed'));
    }
}

/**
 * 复制文件名
 */
async function handleCopyFileName() {
    const node = contextMenu.value.node;
    if (!node) return;

    await writeToClipboard(node.name);
    ElMessage.success(t('chat.workspace.fileNameCopied'));
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
            ElMessage.error(t('chat.workspace.workspacePathError'));
            closeContextMenu();
            return;
        }

        // 拼接完整绝对路径
        const relativePath = node.path.replace(/\\/g, '/');
        const separator = workspacePath.endsWith('/') || workspacePath.endsWith('\\') || relativePath.startsWith('/') ? '' : '/';
        const fullPath = workspacePath + separator + relativePath;

        await writeToClipboard(fullPath);
        ElMessage.success(t('chat.workspace.pathCopied'));
    } catch (error: any) {
        console.error('Failed to get workspace path for copy:', error);
        ElMessage.error(t('common.copyFailed'));
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
            ElMessage.error(t('chat.workspace.workspacePathError'));
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
        ElMessage.error(t('chat.workspace.openFailed'));
    }
    closeContextMenu();
}

/**
 * 将节点路径插入到聊天输入框光标处
 */
function handleInsertToInput() {
    const node = contextMenu.value.node;
    if (!node) return;
    emit('insert-to-input', node.path);
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
            ElMessage.error(t('chat.workspace.workspacePathError'));
            closeContextMenu();
            return;
        }

        const relativePath = node.path.replace(/\\/g, '/');
        const separator = workspacePath.endsWith('/') || workspacePath.endsWith('\\') || relativePath.startsWith('/') ? '' : '/';
        const fullPath = workspacePath + separator + relativePath;

        await window.electronAPI!.openWithEditor(fullPath, 'vscode');
        ElMessage.success(t('chat.workspace.openedInVSCode'));
    } catch (error: any) {
        console.error('Failed to open in VSCode:', error);
        ElMessage.error(t('chat.workspace.openVSCodeFailed'));
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
            t('chat.workspace.renameTitle'),
            t('chat.workspace.rename'),
            {
                inputValue: node.name,
                inputPlaceholder: t('chat.workspace.renameInputPlaceholder'),
                confirmButtonText: t('common.ok'),
                cancelButtonText: t('common.cancel'),
                inputValidator: (val: string) => {
                    if (!val || !val.trim()) return t('chat.workspace.nameRequired');
                    if (val.includes('/') || val.includes('\\')) return t('chat.workspace.nameNoSeparator');
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
            ElMessage.success(t('chat.workspace.renameSuccess'));
            // 本地更新节点名称，避免重新加载整棵树
            const oldPath = node.path;
            node.name = newName.trim();
            if (result.newPath) {
                node.path = result.newPath;
            }
            // 更新标签中的文件路径（key 变化导致旧面板卸载、新面板挂载）
            const oldKey = `file:${oldPath}`;
            const newKey = `file:${result.newPath || oldPath}`;
            const oldTab = tabStore.tabs.find(t => t.key === oldKey);
            if (oldTab) {
                const wasActive = tabStore.activeTabKey === oldKey;
                const newExt = newName.trim().substring(newName.trim().lastIndexOf('.')).toLowerCase();
                tabStore.removeTab(oldKey);
                tabStore.addTab({
                    type: 'file', key: newKey, name: newName.trim(),
                    path: result.newPath || oldPath, extension: newExt, size: oldTab.size || 0,
                });
                if (wasActive) tabStore.selectTab(newKey);
            }
            // 清除旧路径的文件变更版本号
            delete fileChangeVersions.value[oldPath];
        }
    } catch (error: any) {
        // ElMessageBox.prompt 取消会抛异常，忽略
        if (error === 'cancel' || error === 'close') {
            closeContextMenu();
            return;
        }
        console.error('[WorkspaceSidebar] Rename failed:', error);
        ElMessage.error(error?.response?.data?.message || error.message || t('chat.workspace.renameFailed'));
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

    try {
        await ElMessageBox.confirm(
            node.isDirectory
                ? t('chat.workspace.deleteConfirmDir', { name: displayName })
                : t('chat.workspace.deleteConfirmFile', { name: displayName }),
            t('chat.workspace.deleteConfirmTitle'),
            {
                confirmButtonText: t('chat.workspace.confirmDelete'),
                cancelButtonText: t('common.cancel'),
                type: 'warning',
                distinguishCancelAndClose: true,
            },
        );

        const result = await apiService.deleteWorkspaceFile(
            props.sessionId,
            node.path,
        );

        if (result.success) {
            ElMessage.success(t('common.deleteSuccess'));
            // 如果删除的是已打开的文件标签，关闭对应标签
            const deleteTabKey = `file:${node.path}`;
            const deleteTab = tabStore.tabs.find(t => t.key === deleteTabKey);
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
        ElMessage.error(error?.response?.data?.message || error.message || t('chat.workspace.deleteFailed'));
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
async function handleFileSelect(node: WorkspaceNode, isPreview: boolean = true) {
    if (node.isDirectory) return;
    if (!props.sessionId) return;

    const ext = node.name.substring(node.name.lastIndexOf('.')).toLowerCase();

    // 添加标签 + 选中 + 进入预览模式（内容加载由 FilePreviewPanel 自动处理）
    const tabKey = `file:${node.path}`;
    tabStore.addTab({
        type: 'file',
        key: tabKey,
        name: node.name,
        path: node.path,
        extension: ext,
        size: node.size || 0,
        isPreview,
    });
    tabStore.enterPreviewMode()
    tabStore.selectTab(tabKey)
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
        ElMessage.error(t('chat.workspace.openVSCodeFailed'));
    }
}

let unsubscribeWatcher: (() => void) | null = null;
let watchedWorkspacePath: string | null = null;

// Deduplicate concurrent getWorkspacePath requests (loadTree and watcher connect race)
let workspacePathPromise: Promise<string | null> | null = null;
let workspacePathSessionId: string | null = null;

async function fetchWorkspacePath(sessionId: string): Promise<string | null> {
    if (workspacePathPromise && workspacePathSessionId === sessionId) {
        return workspacePathPromise;
    }
    workspacePathSessionId = sessionId;
    workspacePathPromise = apiService.getWorkspacePath(sessionId)
        .then(resp => resp.workspacePath || null)
        .catch(() => null)
        .finally(() => {
            workspacePathPromise = null;
            workspacePathSessionId = null;
        });
    return workspacePathPromise;
}

async function handleWorkspaceWatcherConnected(sessionId: string) {
    if (sessionId !== props.sessionId) return;

    try {
        const nextWorkspacePath = await fetchWorkspacePath(sessionId);
        if (sessionId !== props.sessionId) return;

        if (currentWorkspacePath.value === null) {
            currentWorkspacePath.value = nextWorkspacePath;
        }

        const workspaceChanged =
            watchedWorkspacePath !== null &&
            nextWorkspacePath !== watchedWorkspacePath;
        watchedWorkspacePath = nextWorkspacePath;

        if (workspaceChanged) {
            resetExpandedPaths();
            treeData.value = [];
            await loadTree(true);
        }
    } catch (error) {
        console.error('[WorkspaceSidebar] 恢复工作目录监听失败:', error);
    }
}

watch(() => props.sessionId, async (newSessionId, oldSessionId) => {
    treeLoadGeneration++;
    isLoading.value = false;

    // 会话切换或组件重新挂载时清理旧状态
    // oldSessionId 为 undefined 时是组件重新挂载（如新建会话后），tabStore 可能有上一个会话的残留
    if (newSessionId !== oldSessionId) {
        tabStore.exitPreviewMode()
        tabStore.clearAll();
        fileChangeVersions.value = {};
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

        // 恢复预览标签状态
        await restorePreviewCache(newSessionId);
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
<style scoped>
.workspace-sidebar {
    width: 100%;
    height: 100%;
}

/* 非激活文件预览面板：visibility:hidden 保留渲染状态（含滚动位置），不触发 display:none 的重置 */
.workspace-sidebar .panel-hidden {
    position: absolute !important;
    top: 2.75rem; /* 44px = h-11 工具栏高度，避免覆盖 drag-region */
    left: 0;
    right: 0;
    bottom: 0;
    visibility: hidden;
    pointer-events: none;
    z-index: 0;
}

.workspace-sidebar pre {
    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
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
    color: var(--color-sidebar-text-active);
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
    color: var(--color-sidebar-text-active);
    font-weight: 500;
}

/* 临时标签斜体显示 */
.browser-tab .tab-title.is-preview {
    font-style: italic;
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

/* Phase 1 hide: visibility:hidden without transform/opacity to avoid compositing layer flash */
.tree-hidden-preview {
    position: absolute;
    top: 2.75rem;
    left: 0;
    right: 0;
    bottom: 0;
    visibility: hidden;
    pointer-events: none;
}

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
    color: var(--color-sidebar-text-active);
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
