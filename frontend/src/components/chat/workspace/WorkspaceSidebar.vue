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
                        @dblclick="onTabDblClick(tab)"
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
                            <el-icon :size="14"><Branch20Regular /></el-icon>
                        </span>
                        <!-- 进程日志图标 -->
                        <span v-else-if="tab.type === 'processlog'" class="tab-favicon tab-git">
                            <el-icon :size="14"><Pulse20Regular /></el-icon>
                        </span>
                        <!-- 子代理会话图标（运行中带状态点） -->
                        <template v-else-if="tab.type === 'subagent'">
                            <span class="tab-favicon tab-git">
                                <el-icon :size="14"><Bot20Regular /></el-icon>
                            </span>
                            <span v-if="isSubAgentRunning(tab.key)" class="tab-run-dot" :title="t('chat.workspace.subagentRunning')"></span>
                        </template>
                        <!-- 子代理列表面板图标（与单个子代理标签的 Bot 图标区分） -->
                        <span v-else-if="tab.type === 'subagentlist'" class="tab-favicon tab-git">
                            <el-icon :size="14"><PeopleTeam20Regular /></el-icon>
                        </span>
                        <!-- 工作流审阅图标 -->
                        <span v-else-if="tab.type === 'workflow'" class="tab-favicon tab-git">
                            <el-icon :size="14"><Flowchart20Regular /></el-icon>
                        </span>
                        <!-- 计划面板图标 -->
                        <span v-else-if="tab.type === 'plan'" class="tab-favicon tab-git">
                            <el-icon :size="14"><Notepad20Regular /></el-icon>
                        </span>
                        <!-- 差异/编辑记录图标 -->
                        <span v-else-if="tab.type === 'diff'" class="tab-favicon tab-git">
                            <el-icon :size="14"><Code20Regular /></el-icon>
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
                <button class="sidebar-tool-btn no-drag mr-1.5" @click="layoutStore.toggleWorkspaceFullscreen()">
                    <el-icon :size="16">
                        <FullScreenMaximize16Regular v-if="!layoutStore.workspaceFullscreen" />
                        <ArrowMinimize16Regular v-else />
                    </el-icon>
                </button>
            </GdTooltip>
        </div>
        <!-- 内容区：主内容（左）+ 目录树（右，目录树已归入 FilePreviewPanel 的 pane2） -->
        <div class="flex-1 min-h-0 flex overflow-hidden">
            <!-- 左侧主内容：按激活标签渲染（file / git / browser / 空态） -->
            <div class="flex-1 min-w-0 relative">
                <!-- 起始页：无任何标签 或 点击 + 号时显示（不占用标签栏） -->
                <WorkspaceStartPage v-if="showStartPage" @open-file="onNewTabOpenFile" @open-terminal="onNewTabOpenTerminal"
                    @open-browser="onNewTabOpenBrowser" @open-git="onNewTabOpenGit" @open-subagents="onNewTabOpenSubagents"
                    @open-workflow="onNewTabOpenWorkflow" @open-plan="onNewTabOpenPlan" />

                <!-- Git 审阅标签 -->
                <GitChangesPanel v-show="activeTab?.type === 'git' && !!props.sessionId" ref="gitPanelRef"
                    :session-id="props.sessionId" :active="activeTab?.type === 'git'" class="h-full" />
                <!-- 终端标签：常驻挂载（切换标签不断开 WS/PTY —— 后端复用已有 terminalId 要求它已
                     标记 disconnected，重挂载的"关立刻重连"会因竞态新建第二个 PTY 并吃掉 3 个/会话的配额）。
                     非激活用 terminal-hidden 隐藏（只 visibility/pointer-events，不改几何，避免 PTY 反复 resize）；
                     懒挂载：曾激活过才挂载，避免恢复缓存时给没看过的标签 eager spawn shell。
                     @terminal-id 捕获循环里的 tab（不能用 activeTab：ready 帧可能晚于切标签到达） -->
                <template v-if="sessionId">
                    <template v-for="tab in terminalTabs" :key="tab.key">
                        <TerminalPanel v-if="isTerminalActivated(tab)" :session-id="sessionId"
                            :terminal-id="tab.terminalId" :is-active="activeTabKey === tab.key"
                            :class="{ 'terminal-hidden': activeTabKey !== tab.key }"
                            @terminal-id="onTerminalIdReady(tab, $event)" />
                    </template>
                </template>
                <!-- 进程日志标签（后台进程输出，轮询日志尾部；:key 保证每个标签持有独立面板实例） -->
                <ProcessLogPanel v-if="activeTab?.type === 'processlog' && sessionId && activeTab.processId"
                    :key="activeTab.key"
                    :session-id="sessionId" :process-id="activeTab.processId"
                    :started-at="activeTab.startedAt"
                    :command="activeTab.command || activeTab.processId" :tab-key="activeTab.key" />
                <!-- 子代理会话标签（只读查看，与中央主会话同屏并存） -->
                <SubagentChatTab v-if="activeTab?.type === 'subagent'" class="h-full"
                    :sub-session-id="subSessionIdOf(activeTab.key)"
                    :session="resolveSubSession(subSessionIdOf(activeTab.key))" />
                <!-- 子代理列表标签（活跃 + 已结束回放；已结束回放的唯一入口） -->
                <SubagentListPanel v-if="activeTab?.type === 'subagentlist' && sessionId" class="h-full"
                    :session-id="sessionId" :sub-sessions="props.subSessions" />
                <!-- 工作流审阅标签（终态归档 + 运行中快照合并，行展开看成员/日志/结果） -->
                <WorkflowHistoryPanel v-if="activeTab?.type === 'workflow' && sessionId" class="h-full"
                    :session-id="sessionId" />
                <!-- 计划面板标签（转录构建的计划列表 + Markdown 详情） -->
                <PlanPanel v-if="activeTab?.type === 'plan' && sessionId" class="h-full"
                    :session-id="sessionId" />
                <!-- 差异/编辑记录标签（文件变更历史，多次操作用 op-tabs 展示） -->
                <FileDiffPanel v-if="activeTab?.type === 'diff'" class="h-full"
                    :entry="activeTab ? tabStore.getDiffEntry(activeTab.key) : null" />
                <!-- 浏览器标签（webview 实际在 MainLayout 层，此处仅空壳坐标） -->
                <BrowserPreviewPlaceholder v-if="isElectron"
                    v-show="activeTab?.type === 'browser' && !!browserStore.activeWindowId" />
                <!-- 文件标签：渲染所有 fileTabs，隐藏非激活（保留 DOM/滚动位置） -->
                <template v-if="sessionId">
                    <FilePreviewPanel v-for="tab in fileTabs" :key="tab.key"
                        :class="{ 'panel-hidden': !(activeTab?.type === 'file' && activeTabKey === tab.key) }"
                        :session-id="sessionId" :tab="tab"
                        :is-active="activeTab?.type === 'file' && activeTabKey === tab.key"
                        :content-version="treeStore.fileChangeVersions[tab.path!] || 0"
                        :workspace-path="treeStore.workspacePath"
                        @close="closeTab(tab)"
                        @insert-to-input="emit('insert-to-input', $event)"
                        @insert-snip="emit('insert-snip', $event)" />
                </template>
                <!-- 起始页已覆盖空态（无激活标签时显示），此处不再需要单独空态 -->
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onUnmounted, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiService, type FileChangeEvent } from '@/services/ApiService';
import { Plus, Close } from '@element-plus/icons-vue';
import { Branch20Regular, Pulse20Regular, Bot20Regular, PeopleTeam20Regular, Flowchart20Regular, ArrowMinimize16Regular, FullScreenMaximize16Regular, Code20Regular, Notepad20Regular } from '@vicons/fluent';
import { getFileIcon } from '@/composables/useFileIcon';
import GdTooltip from '@/components/ui/GdTooltip.vue';
import FilePreviewPanel from './FilePreviewPanel.vue';
import SubagentChatTab from './SubagentChatTab.vue';
import SubagentListPanel from './SubagentListPanel.vue';
import WorkflowHistoryPanel from './WorkflowHistoryPanel.vue';
import PlanPanel from './PlanPanel.vue';
import FileDiffPanel from './FileDiffPanel.vue';
import WorkspaceStartPage from './WorkspaceStartPage.vue';
import BrowserPreviewPlaceholder from './BrowserPreviewPlaceholder.vue';
import GitChangesPanel from './GitChangesPanel.vue';
import TerminalPanel from './TerminalPanel.vue';
import ProcessLogPanel from './ProcessLogPanel.vue';
import { useBrowserWebviewStore } from '@/stores/browserWebview';
import { useGitStore } from '@/stores/git';
import { useLayoutStore } from '@/stores/layout';
import { useSessionStore } from '@/stores/session';
import { useTabStore } from '@/stores/tab';
import { useWorkspaceTreeStore } from '@/stores/workspaceTree';
import { usePreviewTabCache, type UnifiedTab } from '@/composables/usePreviewTabCache';
import { openSessionPlanPanel } from '@/utils/sessionPlan';

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

// 文件标签列表（用于 v-for 渲染 FilePreviewPanel）
const fileTabs = computed(() => tabStore.tabs.filter(t => t.type === 'file'));

// 当前激活标签（内容区按类型渲染）
const activeTab = computed(() => tabStore.tabs.find(t => t.key === tabStore.activeTabKey) || null);

// 标签标题（file→文件名 / browser→网页标题 / git→Git审阅 / processlog→进程日志 / subagent→子代理名）
function tabTitle(tab: UnifiedTab): string {
    if (tab.type === 'file') return tab.name || tab.path || tab.key;
    if (tab.type === 'git') return t('chat.workspace.gitTab');
    if (tab.type === 'terminal') return t('chat.workspace.terminal');
    if (tab.type === 'processlog') return tab.command ? tab.command.replace(/\s+/g, ' ').trim() : t('chat.workspace.processLogTab');
    if (tab.type === 'subagent') return tab.name || t('chat.workspace.subagentTab');
    if (tab.type === 'subagentlist') return t('chat.workspace.subagentListTab');
    if (tab.type === 'workflow') return t('chat.workspace.workflowTab');
    if (tab.type === 'plan') return t('chat.workspace.planTab');
    if (tab.type === 'diff') return tab.name || tab.path || tab.key;
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

// 检测是否为 Electron 环境
const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

// 浏览器 webview store（用于预览占位与文件预览互斥）
const browserStore = useBrowserWebviewStore();
const layoutStore = useLayoutStore();
const tabStore = useTabStore();
const sessionStore = useSessionStore();
const treeStore = useWorkspaceTreeStore();
const gitStore = useGitStore();
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

/** 双击标签：固定文件标签为持久（与目录树双击打开文件同语义；非文件标签 no-op） */
function onTabDblClick(tab: UnifiedTab): void {
    if (suppressClick) return;
    tabStore.pinTab(tab.key);
}

// 标签与起始页状态
const tabs = computed(() => tabStore.tabs);
const activeTabKey = computed(() => tabStore.activeTabKey);
const tabBarRef = ref<HTMLElement | null>(null);
// 起始页显示条件：无激活标签（空态或点击 + 号）
const showStartPage = computed(() => !activeTabKey.value);

// ── 终端标签：常驻挂载 + 懒挂载 ──
// 注意：本段必须在 useTabStore()/activeTabKey 之后（immediate watcher 在 setup 期就执行，
// 写在前面会命中 TDZ：Cannot access 'tabStore' before initialization）
/** 终端标签列表（用于 v-for 渲染 TerminalPanel） */
const terminalTabs = computed(() => tabStore.tabs.filter(t => t.type === 'terminal'));
/**
 * 曾激活过的终端标签 key：点过才挂载（= 才向后端 spawn PTY）。
 * 从缓存恢复多个终端标签时不会一次性 eager 创建用户没看过的 shell。
 */
const activatedTerminalKeys = reactive(new Set<string>());

function isTerminalActivated(tab: UnifiedTab): boolean {
    return activeTabKey.value === tab.key || activatedTerminalKeys.has(tab.key);
}

watch(activeTabKey, (key) => {
    if (!key) return;
    const tab = tabStore.tabs.find(t => t.key === key);
    if (tab?.type === 'terminal') activatedTerminalKeys.add(key);
}, { immediate: true });

// ── 计划面板（计划模式产物）：入口常驻，面板内列出历史计划 ──

/** 起始页「计划」：打开计划面板标签（有无计划都可进入，空态提示） */
async function onNewTabOpenPlan(): Promise<void> {
    if (!props.sessionId) return;
    await openSessionPlanPanel(props.sessionId);
}

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

function onNewTabOpenSubagents(): void {
    if (!props.sessionId) return;
    tabStore.openSubagentListTab(props.sessionId);
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

// diff 标签仅存运行时 Map、不持久化；序列化缓存时剔除，避免还原出无内容的死标签
function buildTabCacheSnapshot(): { activeTabKey: string | null; tabs: UnifiedTab[] } {
    const tabs = tabStore.tabs.filter(t => t.type !== 'diff').map(t => ({ ...t }));
    const active = tabStore.activeTabKey;
    const activeIsDiff = active ? active.startsWith('diff:') : false;
    return { activeTabKey: activeIsDiff ? null : active, tabs };
}

function savePreviewCache(): void {
    if (!props.sessionId) return;
    previewTabCache.saveSession(props.sessionId, buildTabCacheSnapshot());
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

// ── 工作目录实时监听 ──
// 目录树数据/懒加载/SSE 增量更新已下沉 workspaceTree store，视图归
// WorkspaceTreePanel（FilePreviewPanel 的 pane2）所有；
// 此处只负责会话级 watcher 订阅与工作目录路径变化检测。

/**
 * 处理文件系统变化事件：委托目录树 store 做本地增量更新
 * （heartbeat / git / 空路径事件在 store 内过滤；git 状态由 GitStore 订阅刷新）
 */
function handleFileChange(event: FileChangeEvent): void {
    treeStore.applyFileChange(event);
}

let unsubscribeWatcher: (() => void) | null = null;
/** 上次已同步的工作目录路径：用于检测会话工作目录被外部变更（迁移）后重载目录树 */
let watchedWorkspacePath: string | null = null;

async function handleWorkspaceWatcherConnected(sessionId: string) {
    if (sessionId !== props.sessionId) return;

    try {
        const nextWorkspacePath = await treeStore.ensureWorkspacePath(sessionId);
        if (sessionId !== props.sessionId) return;

        if (treeStore.workspacePath === null) {
            treeStore.workspacePath = nextWorkspacePath;
        }

        const workspaceChanged =
            watchedWorkspacePath !== null &&
            nextWorkspacePath !== watchedWorkspacePath;
        watchedWorkspacePath = nextWorkspacePath;

        if (workspaceChanged) {
            // 工作目录变了（目录迁移/重新绑定）：重置展开态并重载目录树。
            // git 面板的数据同样绑定旧工作目录（变更列表/分支/文件选中整块过期，
            // 典型症状：切到「公共目录」后侧边栏还停在仓库的变更列表，且点文件报 git 错误）
            // → 强制刷新 git 状态，让面板回到「当前工作目录不是 Git 仓库」的空态。
            treeStore.resetExpandedPaths();
            await treeStore.loadTree(sessionId, true);
            void gitStore.refresh();
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
        previewTabCache.saveSession(prevSessionId, buildTabCacheSnapshot());
        // 跳过 clearAll 触发的自动保存，避免空标签覆盖新会话缓存
        skipNextSave = true;
        // 旧会话解除 file 订阅（SSE 连接由 OverviewPanel 常驻持有，勿断开）
        void apiService.setWorkspaceWatchScope(prevSessionId, "file", false);
        tabStore.clearAll();
        if (unsubscribeWatcher) {
            unsubscribeWatcher();
            unsubscribeWatcher = null;
        }
    }

    syncedSessionId = newSessionId || null;
    watchedWorkspacePath = null;

    if (newSessionId) {
        // 目录树数据：resetForSession 幂等（首次挂载/真正切换 → 重置；同会话重挂载保留），随后强制重载
        treeStore.resetForSession(newSessionId);
        void treeStore.loadTree(newSessionId, true);

        // 先注册变化监听器，再订阅 file 范围激活工作区根 watcher
        unsubscribeWatcher = apiService.onWorkspaceChange(handleFileChange);
        void apiService.setWorkspaceWatchScope(newSessionId, "file", true);
        // 初始化工作区路径监听状态（不依赖 SSE onConnected —— 连接可能已由概览建立）
        void handleWorkspaceWatcherConnected(newSessionId);

        // 恢复预览标签状态（内部会保护已存在的标签：已存在的 subagent/browser 标签
        // 不会被缓存覆盖丢失，仅补齐缺失项）。
        await restorePreviewCache(newSessionId);
    } else {
        if (unsubscribeWatcher) {
            unsubscribeWatcher();
            unsubscribeWatcher = null;
        }
    }
}, { immediate: true });

onUnmounted(() => {
    // 解除 file 订阅（连接由 OverviewPanel 持有，SSE 不断开）
    if (props.sessionId) void apiService.setWorkspaceWatchScope(props.sessionId, "file", false);
    if (unsubscribeWatcher) {
        unsubscribeWatcher();
        unsubscribeWatcher = null;
    }
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
    top: 2.5rem; /* 40px = h-10 工具栏高度，避免覆盖 drag-region */
    left: 0;
    right: 0;
    bottom: 0;
    visibility: hidden;
    pointer-events: none;
    z-index: 0;
}

/* 非激活终端面板：只关可见性与交互，**不动几何**。
   几何一变（如 panel-hidden 的 top 偏移）ResizeObserver 就会 fit → 给隐藏中的 PTY 发 resize，
   每次切标签都让 TUI 程序重绘；终端面板本身已是 absolute inset:0，不需要靠绝对定位出流。 */
.workspace-sidebar .terminal-hidden {
    visibility: hidden;
    pointer-events: none;
    z-index: 0;
}

.workspace-sidebar pre {
    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
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
