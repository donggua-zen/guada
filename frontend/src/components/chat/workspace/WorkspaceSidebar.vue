<template>
    <div class="workspace-sidebar h-full flex flex-col relative">
        <!-- 顶部工具栏：资源管理器按钮 + 浏览器标签 + 窗口控制 -->
        <div
            class="flex items-center h-10 drag-region shrink-0 border-b border-(--gd-color-surface-border) dark:border-[#2e3035]">
            <!-- 所有类型标签统一一行（文件 / 浏览器 / Git 审阅） -->

            <!-- 标签栏（可横向滚动）+ 新建按钮（固定，不随标签滚出视野） -->
            <div v-if="props.sessionId" class="flex items-center min-w-0">
                <div ref="tabBarRef"
                    class="flex items-center min-w-0 overflow-x-auto no-drag browser-tabs-scroll"
                    @wheel="onTabBarWheel">
                    <!-- 统一标签（文件 + 浏览器，按创建顺序，可拖拽排序） -->
                    <div v-for="(tab, index) in tabs" :key="tab.key" class="browser-tab"
                        :class="{ active: activeTabKey === tab.key }"
                        :title="tabTitle(tab)" draggable="true"
                        @click="onTabClick(tab)"
                        @dragstart="onTabDragStart(index, $event)"
                        @dragover.prevent="onTabDragOver(index)" @drop.prevent="onTabDrop(index)" @dragend="onTabDragEnd">
                        <!-- 文件图标 -->
                        <img v-if="tab.type === 'file'" :src="getFileIcon(tab.name!)" class="tab-favicon" alt="" />
                        <!-- 浏览器图标 -->
                        <template v-else-if="tab.type === 'browser'">
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
                        <!-- Git 审阅图标 -->
                        <span v-else-if="tab.type === 'git'" class="tab-favicon tab-git">
                            <el-icon :size="13"><Branch20Regular /></el-icon>
                        </span>
                        <!-- 进程日志图标 -->
                        <span v-else-if="tab.type === 'processlog'" class="tab-favicon tab-git">
                            <el-icon :size="13"><Pulse20Regular /></el-icon>
                        </span>
                        <!-- 子代理会话图标（运行中带状态点） -->
                        <template v-else-if="tab.type === 'subagent'">
                            <span class="tab-favicon tab-git">
                                <el-icon :size="13"><Bot20Regular /></el-icon>
                            </span>
                            <span v-if="isSubAgentRunning(tab.key)" class="tab-run-dot" :title="t('chat.workspace.subagentRunning')"></span>
                        </template>
                        <!-- 工作流审阅图标 -->
                        <span v-else-if="tab.type === 'workflow'" class="tab-favicon tab-git">
                            <el-icon :size="13"><Flowchart20Regular /></el-icon>
                        </span>
                        <span class="tab-title" :class="{ 'is-preview': tab.isPreview }">{{ truncateTabTitle(tabTitle(tab)) }}</span>
                        <span class="tab-close"
                            @click.stop="closeTab(tab)">
                            <el-icon size="10">
                                <Close />
                            </el-icon>
                        </span>
                    </div>
                </div>

                <!-- 起始页按钮：打开起始页（无任何标签时同样显示该页） -->
                <GdTooltip :content="t('chat.workspace.newTab')" placement="bottom">
                    <button class="sidebar-tool-btn no-drag" @click="tabStore.openNewTab()">
                        <el-icon size="14">
                            <Plus />
                        </el-icon>
                    </button>
                </GdTooltip>
            </div>

            <!-- 弹性占位（拖拽区域） -->
            <div class="flex-1"></div>

            <!-- 全屏按钮 -->
            <GdTooltip :content="layoutStore.workspaceFullscreen ? t('chat.workspace.exitFullscreen') : t('chat.workspace.fullscreen')" placement="bottom">
                <button class="sidebar-tool-btn no-drag" @click="layoutStore.toggleWorkspaceFullscreen()">
                    <el-icon :size="16">
                        <FullScreenMaximize16Regular v-if="!layoutStore.workspaceFullscreen" />
                        <ArrowMinimize16Regular v-else />
                    </el-icon>
                </button>
            </GdTooltip>

            <!-- 窗口控制按钮（仅 Electron） -->
            <WindowControls v-if="isElectron" class="no-drag" />
        </div>
        <!-- 内容区：主内容（左）+ 目录树（右） -->
        <div class="flex-1 min-h-0 flex overflow-hidden">
            <!-- 左侧主内容：按激活标签渲染（file / git / browser / 空态） -->
            <div class="flex-1 min-w-0 relative">
                <!-- 起始页：无任何标签 或 点击 + 号时显示（不占用标签栏） -->
                <WorkspaceStartPage v-if="showStartPage" @open-file="onNewTabOpenFile" @open-terminal="onNewTabOpenTerminal"
                    @open-browser="onNewTabOpenBrowser" @open-git="onNewTabOpenGit" @open-workflow="onNewTabOpenWorkflow" />

                <!-- Git 审阅标签 -->
                <GitChangesPanel v-show="activeTab?.type === 'git' && !!props.sessionId" ref="gitPanelRef"
                    :session-id="props.sessionId" :active="activeTab?.type === 'git'" class="h-full" />
                <!-- 终端标签（v-if 兼作 sessionId 空值收窄：TerminalPanel 的 session-id 必填 string） -->
                <TerminalPanel v-if="activeTab?.type === 'terminal' && sessionId" :session-id="sessionId"
                    :terminal-id="activeTab.terminalId" @terminal-id="onTerminalIdReady(activeTab, $event)" />
                <!-- 进程日志标签（后台进程输出，轮询日志尾部） -->
                <ProcessLogPanel v-if="activeTab?.type === 'processlog' && sessionId && activeTab.processId"
                    :session-id="sessionId" :process-id="activeTab.processId"
                    :command="activeTab.command || activeTab.processId" :tab-key="activeTab.key" />
                <!-- 子代理会话标签（只读查看，与中央主会话同屏并存） -->
                <SubagentChatTab v-if="activeTab?.type === 'subagent'" class="h-full"
                    :sub-session-id="subSessionIdOf(activeTab.key)"
                    :session="resolveSubSession(subSessionIdOf(activeTab.key))" />
                <!-- 工作流审阅标签（终态归档 + 运行中快照合并，行展开看成员/日志/结果） -->
                <WorkflowHistoryPanel v-if="activeTab?.type === 'workflow' && sessionId" class="h-full"
                    :session-id="sessionId" />
                <!-- 浏览器标签（webview 实际在 MainLayout 层，此处仅空壳坐标） -->
                <BrowserPreviewPlaceholder v-if="isElectron"
                    v-show="activeTab?.type === 'browser' && !!browserStore.activeWindowId" />
                <!-- 文件标签：渲染所有 fileTabs，隐藏非激活（保留 DOM/滚动位置） -->
                <template v-if="sessionId">
                    <FilePreviewPanel v-for="tab in fileTabs" :key="tab.key"
                        :class="{ 'panel-hidden': !(activeTab?.type === 'file' && activeTabKey === tab.key) }"
                        :session-id="sessionId" :tab="tab"
                        :is-active="activeTab?.type === 'file' && activeTabKey === tab.key"
                        :content-version="fileChangeVersions[tab.path!] || 0"
                        :workspace-path="currentWorkspacePath"
                        @close="closeTab(tab)"
                        @insert-to-input="emit('insert-to-input', $event)"
                        @insert-snip="emit('insert-snip', $event)" />
                </template>
                <!-- 起始页已覆盖空态（无激活标签时显示），此处不再需要单独空态 -->
            </div>

            <!-- 右侧目录树：仅文件标签激活时显示（起始页/浏览器/Git 均隐藏） -->
            <div v-if="activeTab?.type === 'file'"
                class="shrink-0 w-72 border-l border-(--gd-color-surface-border) dark:border-[#2e3035] flex flex-col min-h-0 bg-[var(--gd-color-surface)]">
                <!-- 头部 -->
                <div class="shrink-0 flex items-center justify-between px-2 py-3">
                    <h3 class="text-sm font-normal text-gray-500 dark:text-[#8b8d95] whitespace-nowrap mx-2">
                        {{ t('chat.workspace.workingDir') }}</h3>
                    <div class="flex items-center gap-0 shrink-0">
                        <!-- 刷新按钮 -->
                        <GdTooltip :content="t('chat.workspace.refresh')" placement="bottom">
                            <el-button class="workspace-tool-btn" text @click="refreshTree" :loading="isLoading">
                                <el-icon size="15">
                                    <Refresh />
                                </el-icon>
                            </el-button>
                        </GdTooltip>
                    </div>
                </div>
                <!-- 目录树内容 -->
                <TreeView ref="treeViewRef" :rows="treeRows" :selected-key="selectedNodePath"
                    :collapsed-keys="collapsedTreeKeys" class="flex-1 min-h-0"
                    @select="onTreeSelect" @dblclick="onTreeDblClick" @toggle="onTreeToggle" @contextmenu="onTreeContextMenu">
                    <template #row="{ row }">
                        <!-- 文件图标（目录行与 diff 树一致：仅 chevron + 名称，无文件夹图标） -->
                        <span v-if="!row.isDir" class="node-icon file-icon">
                            <img :src="getFileIcon(row.name)" width="16" height="16" />
                        </span>
                        <!-- 节点名称 -->
                        <span class="node-label">{{ row.name }}</span>
                        <!-- 加载中（右对齐，带淡出过渡） -->
                        <Transition name="fade">
                            <span v-if="loadingPaths.has(row.path)" class="loading-indicator">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="spin">
                                    <path d="M21 12a9 9 0 11-6.219-8.56"/>
                                </svg>
                            </span>
                        </Transition>
                    </template>
                    <template #empty>
                        <div class="text-center py-12 text-gray-400 dark:text-[#6b6d73] text-xs p-2">
                            {{ t('chat.workspace.noFiles') }}
                        </div>
                    </template>
                </TreeView>
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
import { Folder16Regular, Window16Regular, Branch20Regular, Pulse20Regular, Bot20Regular, Flowchart20Regular, ArrowMinimize16Regular, FullScreenMaximize16Regular } from '@vicons/fluent';
import { VsCode, WindowsExplorer } from '@/components/icons';
import { getFileIcon } from '@/composables/useFileIcon';
import ContextMenu, { type ContextMenuItem } from '@/components/ui/ContextMenu.vue';
import GdTooltip from '@/components/ui/GdTooltip.vue';
import FilePreviewPanel from './FilePreviewPanel.vue';
import SubagentChatTab from './SubagentChatTab.vue';
import WorkflowHistoryPanel from './WorkflowHistoryPanel.vue';
import TreeView, { type TreeViewRow } from './TreeView.vue';
import WorkspaceStartPage from './WorkspaceStartPage.vue';
import BrowserPreviewPlaceholder from './BrowserPreviewPlaceholder.vue';
import GitChangesPanel from './GitChangesPanel.vue';
import TerminalPanel from './TerminalPanel.vue';
import ProcessLogPanel from './ProcessLogPanel.vue';
import { useBrowserWebviewStore } from '@/stores/browserWebview';
import { useLayoutStore } from '@/stores/layout';
import { useSessionStore } from '@/stores/session';
import { useTabStore } from '@/stores/tab';
import { usePreviewTabCache, type UnifiedTab } from '@/composables/usePreviewTabCache';
import type { WorkspaceNode } from './WorkspaceTree.vue';
import WindowControls from '@/components/WindowControls.vue';

const props = defineProps<{
    sessionId: string | null;
    /** 子代理会话元数据（ChatPage 维护；侧边栏 subagent 标签解析名称与状态用） */
    subSessions?: import('@/types/session').Session[];
}>();

const { t } = useI18n();

const emit = defineEmits<{
    'insert-to-input': [path: string];
    'insert-snip': [data: import('@/components/chat/workspace/FilePreviewPanel.vue').SnipData];
}>();

const treeData = ref<WorkspaceNode[]>([]);
const isLoading = ref(false);
const currentWorkspacePath = ref<string | null>(null);
// 树节点高亮路径：从激活文件标签的 path 派生（不依赖 key，
// 兼容"当前标签页打开"原地更新 path 而 key 不变的空占位标签场景）
const selectedNodePath = computed(() => {
    const key = tabStore.activeTabKey;
    if (!key) return '';
    const tab = tabStore.tabs.find(t => t.key === key);
    return tab?.type === 'file' ? (tab.path || '') : '';
});

// 文件变更版本号（SSE 事件递增，驱动 FilePreviewPanel 重载）
const fileChangeVersions = ref<Record<string, number>>({});

// 文件标签列表（用于 v-for 渲染 FilePreviewPanel）
const fileTabs = computed(() => tabStore.tabs.filter(t => t.type === 'file'));

// 当前激活标签（内容区按类型渲染 + 目录树显隐）
const activeTab = computed(() => tabStore.tabs.find(t => t.key === tabStore.activeTabKey) || null);

// 标签标题（file→文件名 / browser→网页标题 / git→Git审阅 / processlog→进程日志 / subagent→子代理名）
function tabTitle(tab: UnifiedTab): string {
    if (tab.type === 'file') return tab.name || tab.path || tab.key;
    if (tab.type === 'git') return t('chat.workspace.gitTab');
    if (tab.type === 'terminal') return t('chat.workspace.terminal');
    if (tab.type === 'processlog') return t('chat.workspace.processLogTab');
    if (tab.type === 'subagent') return tab.name || t('chat.workspace.subagentTab');
    if (tab.type === 'workflow') return t('chat.workspace.workflowTab');
    return tab.title || t('chat.workspace.unnamedWindow');
}

// ── 子代理标签（与主会话同屏并存：中央恒显主会话，子代理在侧边栏查看） ──

/** 从标签 key（`subagent:<id>`）提取子代理会话 ID */
function subSessionIdOf(key: string): string {
    return key.slice('subagent:'.length);
}

/** 解析子代理会话元数据（ChatPage 的 subSessions；历史回放场景可能暂缺） */
function resolveSubSession(id: string): import('@/types/session').Session | null {
    return props.subSessions?.find(s => s.id === id) || null;
}

/** 子代理是否正在流式运行（驱动标签条状态点；渲染路径必须用纯读，getSessionState 会写缓存 → 递归更新） */
function isSubAgentRunning(tabKey: string): boolean {
    return sessionStore.peekStreamStatus(subSessionIdOf(tabKey)) === 'running';
}

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
const sessionStore = useSessionStore();
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
    tabStore.selectTab(tab.key)
}

// 标签与起始页状态
const gitPanelRef = ref<InstanceType<typeof GitChangesPanel> | null>(null);
const tabs = computed(() => tabStore.tabs);
const activeTabKey = computed(() => tabStore.activeTabKey);
const tabBarRef = ref<HTMLElement | null>(null);
// 起始页显示条件：无激活标签（空态或点击 + 号）
const showStartPage = computed(() => !activeTabKey.value);

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

// 起始页选项：打开文件 / 审阅 / 网页
function onNewTabOpenFile(): void {
    // 起始页不占用标签：创建空文件标签（预览态）并激活（path 为空，右侧目录树可选文件）。
    // 选中的文件会在这个预览标签内打开；双击则固定为持久标签。
    const key = `file:new-${Date.now()}`;
    tabStore.addTab({
        type: 'file',
        key,
        name: t('chat.workspace.newTab'),
        path: '',
        isPreview: true,
    });
    tabStore.selectTab(key);
}

function onNewTabOpenGit(): void {
    tabStore.openGitTab();
}

function onNewTabOpenWorkflow(): void {
    if (!props.sessionId) return;
    tabStore.openWorkflowTab(props.sessionId);
}

function onNewTabOpenBrowser(): void {
    createBrowserTab();
}

function onNewTabOpenTerminal(): void {
    // openTerminalTab 要求会话 id（string）；无会话时不建终端标签（守卫与模板 v-if 同语义）
    if (!props.sessionId) return;
    tabStore.openTerminalTab(props.sessionId);
}

/** 新建浏览器：直接创建 webview 并激活 */
async function createBrowserTab(): Promise<void> {
    if (!window.electronAPI || !props.sessionId) return;
    try {
        const result = await window.electronAPI.createBrowserWindow("about:blank", {
            sessionId: props.sessionId,
            createdBy: props.sessionId,
        });
        if (result.success && result.window?.windowId) {
            tabStore.selectTab(`browser:${result.window.windowId}`);
        }
    } catch (e) {
        console.error("Failed to create browser window:", e);
    }
}

// 浏览器 store → tabStore 同步已迁往 OverviewPanel（概览常驻，工作区隐藏时仍保持同步）

// ── 预览标签缓存：保存当前会话状态到 localStorage ──

function savePreviewCache(): void {
    if (!props.sessionId) return;
    previewTabCache.saveSession(props.sessionId, {
        activeTabKey: tabStore.activeTabKey,
        tabs: tabStore.tabs.map(t => ({ ...t })),
    });
}

// 自动保存：当标签列表、激活标签变化时（排除会话切换期间的自动保存）
let isRestoring = false;
let skipNextSave = false;
watch([() => tabStore.activeTabKey, () => tabStore.tabs], () => {
    if (!isRestoring && !skipNextSave) savePreviewCache();
    skipNextSave = false;
}, { deep: true });

// ── 预览标签缓存：从 localStorage 恢复会话状态 ──
/**
 * 从缓存恢复会话标签状态。
 *
 * 关键约束（勿改回无条件覆盖）：必须保留调用 restore 之前 tabStore 里
 * 「非 file 类型」的既有标签 —— 典型场景是概览面板点击子代理时先
 * openSubAgentTab（subagent 标签）、或打开了 terminal / git / workflow 标签，
 * 随后侧边栏才挂载并触发本函数。若直接 `tabStore.tabs = cached.tabs`，
 * 这些刚打开的标签会被缓存快照覆盖丢失，表现为「只打开了侧边栏，
 * 子代理标签没自动打开」。
 * 因此采用「缓存为基底 + 追加既有非 file 标签 + 复用既有 file 标签」的合并策略。
 */
async function restorePreviewCache(sessionId: string): Promise<void> {
    // 记录调用时已存在的标签（调用方在本函数前写入的标签需要被保留）
    const preExistingTabs = tabStore.tabs.map(t => ({ ...t }));
    const preExistingActiveKey = tabStore.activeTabKey;

    const cached = previewTabCache.getSession(sessionId);

    isRestoring = true;

    try {
        if (!cached) {
            // 无缓存：不动既有标签（可能正是调用方刚打开的），仅补一次保存
            return;
        }

        // 恢复完整标签列表（保留顺序）
        tabStore.tabs = cached.tabs.map(t => ({ ...t }));

        // 过滤掉 webview 已不存在的浏览器标签（页面刷新场景）
        // 同时过滤历史遗留的 newtab 标签（起始页已不占用标签栏）
        tabStore.tabs = tabStore.tabs.filter(tab => {
            if (tab.type === 'newtab') return false;
            if (tab.type === 'browser') {
                return browserStore.allWebviews.some(w => w.windowId === tab.windowId);
            }
            return true;
        });

        // 规范化历史缓存：旧版"当前标签页打开"原地改 path 会留下 key 与 path 脱钩的条目，
        // 按 path 重建规范 key 并按 path 去重（保留先出现者）；空标签原样保留。
        const rawActive = tabStore.tabs.find(t => t.key === cached.activeTabKey);
        const normalized: UnifiedTab[] = [];
        const seenPaths = new Set<string>();
        for (const tab of tabStore.tabs) {
            if (tab.type !== 'file' || !tab.path) {
                normalized.push(tab);
                continue;
            }
            if (seenPaths.has(tab.path)) continue;
            seenPaths.add(tab.path);
            normalized.push({ ...tab, key: `file:${tab.path}` });
        }
        tabStore.tabs = normalized;
        const restoredActiveKey = rawActive?.type === 'file' && rawActive.path
            ? `file:${rawActive.path}`
            : cached.activeTabKey;

        // ── 合并：保留恢复前已存在的标签（同 key 以既有为准，缓存为辅） ──
        // 这样子代理 / 终端 / 工作流等在本函数之前打开的标签不会被缓存快照吃掉。
        for (const prev of preExistingTabs) {
            const existing = tabStore.tabs.find(t => t.key === prev.key);
            if (existing) {
                // 同 key：保留既有的运行时字段（如 subagent 名称变更、terminalId）
                existing.name = prev.name ?? existing.name;
                if (prev.terminalId) existing.terminalId = prev.terminalId;
            } else {
                tabStore.tabs.push(prev);
            }
        }

        // 补充 store 中存在但缓存中没有的浏览器标签
        for (const wv of browserStore.sessionWebviews) {
            const key = `browser:${wv.windowId}`;
            if (!tabStore.tabs.some(t => t.key === key)) {
                tabStore.tabs.push({ type: 'browser', key, windowId: wv.windowId, title: wv.title, favicon: wv.favicon, url: wv.url });
            }
        }

        // 恢复激活标签（显示完全由激活标签驱动）
        // 优先级：调用方刚激活的标签 > 缓存中的激活标签 > 第一个标签
        // null = 起始页；'newtab' 为旧缓存哨兵键，一并归一到起始页
        if (preExistingActiveKey && tabStore.tabs.some(t => t.key === preExistingActiveKey)) {
            // 调用方（如概览点击子代理）在本函数前已激活了目标标签 —— 保持它
            await nextTick()
            tabStore.selectTab(preExistingActiveKey)
        } else if (cached.activeTabKey === null || cached.activeTabKey === 'newtab') {
            // 起始页不占用标签：恢复为无激活标签
            tabStore.selectTab(null)
        } else if (restoredActiveKey && tabStore.tabs.some(t => t.key === restoredActiveKey)) {
            await nextTick()
            tabStore.selectTab(restoredActiveKey)
        } else if (tabStore.tabs.length > 0) {
            await nextTick()
            tabStore.selectTab(tabStore.tabs[0].key)
        }
    } finally {
        isRestoring = false
        savePreviewCache()
    }
}

// ── 统一标签操作 ──

/** 后端创建 PTY 后，将稳定 terminalId 写回标签缓存 */
function onTerminalIdReady(tab: UnifiedTab, terminalId: string): void {
    if (tab.type !== 'terminal' || tab.terminalId === terminalId) return;
    tab.terminalId = terminalId;
    savePreviewCache();
}

/** 关闭标签（统一入口） */
async function closeTab(tab: UnifiedTab): Promise<void> {
    if (tab.type === 'terminal' && tab.terminalId) {
        try {
            await apiService.disposeTerminal(tab.terminalId);
        } catch (e) {
            console.error('[WorkspaceSidebar] Failed to dispose terminal:', e);
        }
    }
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

/** 浏览器窗口创建/激活/关闭已迁往概览面板（OverviewPanel） */

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
/** 目录树滚动容器（TreeView 组件引用，用于滚动定位选中节点） */
const treeViewRef = ref<InstanceType<typeof TreeView> | null>(null);

/**
 * 将嵌套 treeData 拍平为 TreeView 扁平行：
 * 展开的目录（在 expandedPaths 中）递归输出子行，折叠目录只输出目录行。
 */
function flattenWorkspaceTree(
    nodes: WorkspaceNode[],
    expanded: Set<string>,
    depth: number,
    out: TreeViewRow[],
): void {
    for (const n of nodes) {
        const isDir = n.isDirectory;
        out.push({
            key: n.path,
            depth,
            isDir,
            name: n.name,
            path: n.path,
            node: n,
        });
        if (isDir && expanded.has(n.path)) {
            flattenWorkspaceTree(n.children || [], expanded, depth + 1, out);
        }
    }
}

/** 目录树扁平行（treeData + expandedPaths 派生，供 TreeView 渲染） */
const treeRows = computed<TreeViewRow[]>(() => {
    const out: TreeViewRow[] = [];
    flattenWorkspaceTree(treeData.value, expandedPaths.value, 0, out);
    return out;
});

/** 折叠集合：所有目录中不在 expandedPaths 的（TreeView 语义：在集合 = 折叠） */
const collapsedTreeKeys = computed<Set<string>>(() => {
    const collapsed = new Set<string>();
    const walk = (nodes: WorkspaceNode[]) => {
        for (const n of nodes) {
            if (n.isDirectory) {
                if (!expandedPaths.value.has(n.path)) collapsed.add(n.path);
                walk(n.children || []);
            }
        }
    };
    walk(treeData.value);
    return collapsed;
});

/** TreeView 行事件 → WorkspaceNode 事件适配 */
function onTreeSelect(row: TreeViewRow): void {
    handleTreeNodeSelect(row.node as WorkspaceNode);
}

/** 双击文件行：在当前文件标签内打开并固定为持久 */
function onTreeDblClick(row: TreeViewRow): void {
    const node = row.node as WorkspaceNode;
    if (node.isDirectory) return;
    void handleFileSelect(node, { persistent: true });
}

function onTreeToggle(row: TreeViewRow, expanded: boolean): void {
    const node = row.node as WorkspaceNode;
    handleTreeNodeExpandToggle(node, expanded);
    if (expanded) void handleTreeNodeToggle(node, true);
}

function onTreeContextMenu(event: MouseEvent, row: TreeViewRow): void {
    handleContextMenu(event, row.node as WorkspaceNode);
}

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
 * 展开选中文件的所有祖先目录（含懒加载），展开完成后将选中节点滚动到可视区域。
 * 切换标签定位文件时调用，配合树节点对 expandedPaths 的受控展开：
 * 先把祖先目录路径加入 expandedPaths（节点 watch 自动展开），
 * 再确保子节点已加载（未加载过的目录触发懒加载）。
 */
async function revealPathInTree(path: string): Promise<void> {
    if (!path) return;
    const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
    for (let i = 1; i < parts.length; i++) {
        const ancestorPath = parts.slice(0, i).join('/');
        const node = findNodeByPath(treeData.value, ancestorPath);
        if (!node?.isDirectory) return;
        if (!expandedPaths.value.has(ancestorPath)) {
            expandedPaths.value = new Set(expandedPaths.value).add(ancestorPath);
        }
        if (!node.children || node.children.length === 0) {
            await handleTreeNodeToggle(node, true);
        }
    }

    // 等待展开后的子节点渲染完成，再把选中节点滚动进可视区
    await nextTick();
    treeViewRef.value?.scrollToKey(path);
}

// 切换标签（激活文件路径变化）时展开其祖先目录并滚动定位
watch(selectedNodePath, (path) => {
    if (path) void revealPathInTree(path);
});

/**
 * 点击文件节点选中
 */
function handleTreeNodeSelect(node: WorkspaceNode) {
    if (node.isDirectory) return;
    handleFileSelect(node);
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

    // Git 状态刷新只由 git 事件（后端 .git watcher → type:"git"）触发（GitStore 订阅）——
    // 文件变更事件（含被 git 忽略的文件）不刷新 git，避免无关变更重载当前预览 diff
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
                    isPreview: oldTab.isPreview,
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
 * 处理文件选择（目录树单击/双击；树仅在文件标签激活时可见）
 *
 * 单击：在当前激活的文件标签内原位打开，保持该标签的预览/持久属性。
 * 双击：同上，并把该标签固定为持久（persistent: true）。
 */
async function handleFileSelect(node: WorkspaceNode, opts: { persistent?: boolean } = {}) {
    if (node.isDirectory) return;
    if (!props.sessionId) return;

    const ext = node.name.substring(node.name.lastIndexOf('.')).toLowerCase();
    const file = { path: node.path, name: node.name, extension: ext, size: node.size || 0 };

    // 正常路径：树可见 ⇒ 必有激活文件标签。返回 false 仅为防御（如激活态刚被清空）
    if (tabStore.openFileInActiveTab(file, opts)) return;

    // 兜底：打开到唯一的预览标签（不会改动持久标签）
    tabStore.openFilePreview(file);
}

/**
 * 在文件管理器中打开工作目录（已迁移至 ChatPage Header）
 */

/**
 * 以 VSCode 打开工作目录（已迁移至 ChatPage Header）
 */

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

/**
 * 上次已同步的会话 id。
 * 用于区分「组件首次挂载」（此处为 null）与「用户真正切换会话」：
 * 首次挂载时 tabStore 里可能已有合法标签（例如概览面板刚 push 的子代理标签、
 * 或同一会话下其他入口打开的标签），此时绝不能 clearAll 清空。
 * 仅当确认是从一个具体旧会话切到另一个会话时，才需要清空并重建。
 */
let syncedSessionId: string | null = null;

watch(() => props.sessionId, async (newSessionId) => {
    treeLoadGeneration++;
    isLoading.value = false;

    // 会话切换或组件重新挂载时清理旧状态。
    // 注意：immediate 首跑时"上一次值"不可用（undefined），有两种可能 ——
    //   1) immediate 首跑（组件首次挂载）：tabStore 可能已被调用方写好标签，不可清空；
    //   2) 组件卸载后重新挂载（如新建会话后）且仍持有旧会话残留标签：需要清空。
    // 用 syncedSessionId 区分：非 null 表示本组件实例已同步过某个会话，
    // 此时才是真正的「从旧会话切走」，需要清空重建。
    // 取切换前的旧会话 id 快照：syncedSessionId 是外部可变 let，直接经布尔别名判断
    // 无法被 TS 收窄为 string，这里用 const 局部量，语义与 syncedSessionId 完全一致
    const prevSessionId = syncedSessionId;
    const isRealSessionSwitch = prevSessionId !== null && prevSessionId !== newSessionId;
    if (isRealSessionSwitch) {
        // 保存旧会话缓存：必须用 prevSessionId，不能用 props.sessionId（已指向新会话）
        previewTabCache.saveSession(prevSessionId, {
            activeTabKey: tabStore.activeTabKey,
            tabs: tabStore.tabs.map(t => ({ ...t })),
        });
        // 跳过 clearAll 触发的自动保存，避免空标签覆盖新会话缓存
        skipNextSave = true;
        // 旧会话解除 file 订阅（SSE 连接由 OverviewPanel 常驻持有，勿断开）
        void apiService.setWorkspaceWatchScope(prevSessionId, "file", false);
        tabStore.clearAll();
        fileChangeVersions.value = {};
        watchedWorkspacePath = null;
        resetExpandedPaths();
        treeData.value = [];
        currentWorkspacePath.value = null;
        if (unsubscribeWatcher) {
            unsubscribeWatcher();
            unsubscribeWatcher = null;
        }
    }

    syncedSessionId = newSessionId || null;

    if (newSessionId) {
        loadTree(true); // 会话切换时强制启动新请求

        // 先注册变化监听器，再订阅 file 范围激活工作区根 watcher
        unsubscribeWatcher = apiService.onWorkspaceChange(handleFileChange);
        void apiService.setWorkspaceWatchScope(newSessionId, "file", true);
        // 初始化工作区路径监听状态（不依赖 SSE onConnected —— 连接可能已由概览建立）
        void handleWorkspaceWatcherConnected(newSessionId);

        // 恢复预览标签状态（内部会保护已存在的标签：已存在的 subagent/browser 标签
        // 不会被缓存覆盖丢失，仅补齐缺失项）。
        await restorePreviewCache(newSessionId);
    } else {
        watchedWorkspacePath = null;
        resetExpandedPaths();
        treeData.value = [];
        if (unsubscribeWatcher) {
            unsubscribeWatcher();
            unsubscribeWatcher = null;
        }
    }
}, { immediate: true });

onUnmounted(() => {
    watchedWorkspacePath = null;
    resetExpandedPaths();
    // 解除 file 订阅（连接由 OverviewPanel 持有，SSE 不断开）
    if (props.sessionId) void apiService.setWorkspaceWatchScope(props.sessionId, "file", false);
    if (unsubscribeWatcher) {
        unsubscribeWatcher();
        unsubscribeWatcher = null;
    }
    closeContextMenu();
});
</script>
<style scoped>
.workspace-sidebar {
    width: 100%;
    height: 100%;
}

/* ── 文件树插槽内容样式（行结构/高亮由 TreeView 统一渲染，此处只定义行内内容） ── */
.node-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}

.file-icon img {
    display: block;
    width: 16px;
    height: 16px;
}

.node-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
    color: var(--gd-color-text);
}

.loading-indicator {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    color: var(--gd-color-text-gray);
    flex-shrink: 0;
    margin-left: auto;
}

.spin {
    animation: tree-spin 0.6s linear infinite;
}

@keyframes tree-spin {
    to { transform: rotate(360deg); }
}

/* 加载指示器淡出过渡 */
.fade-leave-active {
    transition: opacity 0.2s ease;
}
.fade-leave-to {
    opacity: 0;
}

/* 非激活文件预览面板：visibility:hidden 保留渲染状态（含滚动位置），不触发 display:none 的重置 */
.workspace-sidebar .panel-hidden {
    position: absolute !important;
    top: 2.5rem; /* 40px = h-10 工具栏高度，避免覆盖 drag-region */
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
    color: var(--gd-color-text-gray);
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
    background: var(--gd-color-sidebar-bg-hover);
    color: var(--gd-color-text);
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
    color: var(--gd-color-text-gray);
    flex-shrink: 0;
    align-self: center;
    transition: all 0.2s;
}

.sidebar-tool-btn:hover:not(:disabled) {
    background: var(--gd-color-sidebar-bg-hover);
    color: var(--gd-color-text);
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
    padding: 1px 8px;
    height: 26px;
    width: 120px;
    min-width: 120px;
    max-width: 120px;
    flex: 0 0 120px;
    box-sizing: border-box;
    border-radius: 6px;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.15s;
    position: relative;
}
/* 分隔竖线：短直线，垂直居中，不随标签圆角弯曲。
   仅未选中标签右侧显示；选中标签两侧都无线。 */
.browser-tab:not(.active)::after {
    content: "";
    position: absolute;
    right: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 1px;
    height: 12px;
    border-radius: 0;
    background: var(--gd-color-border, rgba(0, 0, 0, 0.1));
}
/* 紧贴选中标签右侧的线不显示（选中右侧无线） */
.browser-tab.active + .browser-tab:not(.active)::after,
/* 紧贴选中标签左侧的线不显示（选中左侧无线） */
.browser-tab:not(.active):has(+ .browser-tab.active)::after {
    display: none;
}

.browser-tab:hover {
    background: var(--gd-color-sidebar-bg-hover);
}

.browser-tab.active {
    background: var(--gd-color-sidebar-bg-active);
    color: var(--gd-color-sidebar-text-active);
}

.tab-favicon {
    width: 14px;
    height: 14px;
    border-radius: 2px;
    flex-shrink: 0;
    object-fit: contain;
}

/* Git 审阅图标：span 包裹 el-icon，需 flex 居中（否则按基线对齐偏下） */
.tab-git {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--gd-color-text-gray);
}

.tab-globe {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--gd-color-text-gray);
}

.tab-title {
    font-size: 13px;
    line-height: 1;
    color: var(--gd-color-text-gray);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    /* 撑满剩余空间，让关闭按钮始终右对齐 */
    flex: 1 1 auto;
}

/* 子代理标签运行状态点（流式进行中显示，绿色呼吸） */
.tab-run-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
    background: var(--gd-color-success, #22c55e);
    animation: tab-run-pulse 1.6s ease-in-out infinite;
}

@keyframes tab-run-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
}

.browser-tab.active .tab-title {
    color: var(--gd-color-sidebar-text-active);
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
    color: var(--gd-color-text);
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

/* ── 悬浮目录树面板（预览模式下） ── 视觉风格对齐 GdPopover */

/* Phase 1 hide: visibility:hidden without transform/opacity to avoid compositing layer flash */
.tree-hidden-preview {
    position: absolute;
    top: 2.5rem;
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
    background: var(--gd-color-surface);
    border: 1px solid var(--gd-color-surface-border);
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
    background: var(--gd-color-surface, #242529);
    border-color: var(--gd-color-surface-border, #2e3035);
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
    color: var(--gd-color-text-gray);
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
    background: var(--gd-color-sidebar-bg-hover);
    color: var(--gd-color-text);
}

.seg-btn.active {
    color: var(--gd-color-text);
    background: var(--gd-color-sidebar-bg-active);
    color: var(--gd-color-sidebar-text-active);
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
    border: 1px solid var(--gd-color-surface-border);
    border-radius: 8px;
    background: transparent;
    color: var(--gd-color-text-gray);
    cursor: pointer;
    font-size: 13px;
    transition: all 0.15s ease;
    outline: none;
}

.empty-state-btn:hover:not(:disabled) {
    background: var(--gd-color-sidebar-bg-hover);
    color: var(--gd-color-text);
    border-color: var(--gd-color-text-gray);
}

.empty-state-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
}

.dark .empty-state-btn {
    border-color: var(--gd-color-surface-border, #2e3035);
}
</style>
