<template>
    <!-- 目录树面板：作为 FilePreviewPanel 的右栏（参照 GitChangesPanel 的 pane2 布局）。
         仅在激活的文件标签内渲染（FilePreviewPanel v-if 控制），数据来自 workspaceTree store。 -->
    <div class="workspace-tree-pane shrink-0 w-56 border-l border-(--gd-color-surface-border) dark:border-[#2e3035] flex flex-col min-h-0 bg-[var(--gd-color-surface)]"
        @contextmenu.stop>
        <!-- 头部 -->
        <div class="shrink-0 flex items-center justify-between px-2 py-3">
            <h3 class="text-sm font-normal text-gray-500 dark:text-[#8b8d95] whitespace-nowrap mx-2">
                {{ t('chat.workspace.workingDir') }}</h3>
            <div class="flex items-center gap-0 shrink-0">
                <!-- 刷新按钮 -->
                <GdTooltip :content="t('chat.workspace.refresh')" placement="bottom">
                    <el-button class="workspace-tool-btn" text @click="refreshTree" :loading="treeStore.isLoading">
                        <el-icon size="15">
                            <Refresh />
                        </el-icon>
                    </el-button>
                </GdTooltip>
            </div>
        </div>
        <!-- 目录树内容 -->
        <TreeView ref="treeViewRef" :rows="treeRows" :selected-key="selectedPath"
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
                    <span v-if="treeStore.loadingPaths.has(row.path)" class="loading-indicator">
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

        <ContextMenu :visible="contextMenu.visible" :x="contextMenu.x" :y="contextMenu.y" :items="contextMenuItems"
            @close="closeContextMenu" />
    </div>
</template>

<script setup lang="ts">
import { getErrorMessage } from '@/utils/errorMessage'
import { ref, computed, watch, nextTick } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useI18n } from 'vue-i18n';
import { apiService } from '@/services/ApiService';
import { Refresh, CopyDocument, Edit, Delete, Plus } from '@element-plus/icons-vue';
import { VsCode, WindowsExplorer } from '@/components/icons';
import { getFileIcon } from '@/composables/useFileIcon';
import ContextMenu, { type ContextMenuItem } from '@/components/ui/ContextMenu.vue';
import GdTooltip from '@/components/ui/GdTooltip.vue';
import TreeView, { type TreeViewRow } from './TreeView.vue';
import type { WorkspaceNode } from '@/types/workspace';
import { useWorkspaceTreeStore } from '@/stores/workspaceTree';
import { useTabStore } from '@/stores/tab';

const props = defineProps<{
    sessionId: string;
}>();

const emit = defineEmits<{
    'insert-to-input': [path: string];
}>();

const { t } = useI18n();
const treeStore = useWorkspaceTreeStore();
const tabStore = useTabStore();

// 检测是否为 Electron 环境
const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

// 目录树滚动容器（TreeView 组件引用，用于滚动定位选中节点）
const treeViewRef = ref<InstanceType<typeof TreeView> | null>(null);

/** 激活文件标签的路径（树高亮路径：不依赖 key，兼容当前标签页原地更新 path 的空占位场景） */
const selectedPath = computed(() => {
    const key = tabStore.activeTabKey;
    if (!key) return '';
    const tab = tabStore.tabs.find(t => t.key === key);
    return tab?.type === 'file' ? (tab.path || '') : '';
});

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

/** 目录树扁平行（store treeData + expandedPaths 派生，供 TreeView 渲染） */
const treeRows = computed<TreeViewRow[]>(() => {
    const out: TreeViewRow[] = [];
    flattenWorkspaceTree(treeStore.treeData, treeStore.expandedPaths, 0, out);
    return out;
});

/** 折叠集合：所有目录中不在 expandedPaths 的（TreeView 语义：在集合 = 折叠） */
const collapsedTreeKeys = computed<Set<string>>(() => {
    const collapsed = new Set<string>();
    const walk = (nodes: WorkspaceNode[]) => {
        for (const n of nodes) {
            if (n.isDirectory) {
                if (!treeStore.expandedPaths.has(n.path)) collapsed.add(n.path);
                walk(n.children || []);
            }
        }
    };
    walk(treeStore.treeData);
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
    void treeStore.toggleNode(node, expanded);
}

function onTreeContextMenu(event: MouseEvent, row: TreeViewRow): void {
    handleContextMenu(event, row.node as WorkspaceNode);
}

/**
 * 点击文件节点选中（单击：预览态打开，保持标签预览属性）
 */
function handleTreeNodeSelect(node: WorkspaceNode) {
    if (node.isDirectory) return;
    void handleFileSelect(node);
}

/**
 * 处理文件选择（目录树单击/双击）
 *
 * 单击：在当前激活的文件标签内原位打开，保持该标签的预览/持久属性。
 * 双击：同上，并把该标签固定为持久（persistent: true）。
 */
async function handleFileSelect(node: WorkspaceNode, opts: { persistent?: boolean } = {}) {
    if (node.isDirectory) return;

    const ext = node.name.substring(node.name.lastIndexOf('.')).toLowerCase();
    const file = { path: node.path, name: node.name, extension: ext, size: node.size || 0 };

    // 正常路径：树可见 ⇒ 必有激活文件标签。返回 false 仅为防御（如激活态刚被清空）
    if (tabStore.openFileInActiveTab(file, opts)) return;

    // 兜底：打开到唯一的预览标签（不会改动持久标签）
    tabStore.openFilePreview(file);
}

/**
 * 刷新树（强制立即执行）：清空数据重新加载
 */
function refreshTree(): void {
    treeStore.refresh();
}

// ── 右键菜单 ──

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
            console.warn('[Workspace] 直接调用失败:', error);
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
    if (!node) return;

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
    } catch (error) {
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
    if (!node || !isElectron) return;

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
    } catch (error) {
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
    if (!node || !isElectron) return;

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
    } catch (error) {
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
    if (!node) {
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
                    // 重建标签对象：保留每标签的目录树显隐（否则会被重置为默认展开）
                    treeVisible: oldTab.treeVisible,
                });
                if (wasActive) tabStore.selectTab(newKey);
            }
            // 清除旧路径的文件变更版本号
            treeStore.clearFileChangeVersion(oldPath);
        }
    } catch (error) {
        // ElMessageBox.prompt 取消会抛异常，忽略
        if (error === 'cancel' || error === 'close') {
            closeContextMenu();
            return;
        }
        console.error('[WorkspaceTreePanel] Rename failed:', error);
        ElMessage.error(getErrorMessage(error) || t('chat.workspace.renameFailed'));
    }
    closeContextMenu();
}

/**
 * 删除文件/目录 - 二次确认后执行
 */
async function handleDelete() {
    const node = contextMenu.value.node;
    if (!node) {
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
                tabStore.removeTab(deleteTab.key);
            }
        }
    } catch (error) {
        // ElMessageBox.confirm 取消会抛异常，忽略
        if (error === 'cancel' || error === 'close') {
            closeContextMenu();
            return;
        }
        console.error('[WorkspaceTreePanel] Delete failed:', error);
        ElMessage.error(getErrorMessage(error) || t('chat.workspace.deleteFailed'));
    }
    closeContextMenu();
}

// ── 选中定位：激活文件路径变化时（含面板挂载首次）展开祖先目录并滚动进可视区 ──

watch(selectedPath, (path) => {
    if (path) void revealAndScroll(path);
}, { immediate: true });

/** 展开选中文件的所有祖先目录（含懒加载），完成后滚动到可视区域 */
async function revealAndScroll(path: string): Promise<void> {
    await treeStore.revealPath(path);
    await nextTick();
    treeViewRef.value?.scrollToKey(path);
}

defineExpose({ revealAndScroll });
</script>

<style scoped>
/* 目录树面板样式（自 WorkspaceSidebar 迁移） */

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
</style>
