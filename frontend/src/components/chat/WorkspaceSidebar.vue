<template>
    <div class="workspace-sidebar h-full flex flex-col border-l border-gray-200 dark:border-[#2e3035]">
        <!-- 可拖拽分割区域 -->
        <LiteSplitpanes class="flex-1" :horizontal="!isHorizontalLayout"
            :pane1="{ size: selectedFile ? '280px' : '100%', minSize: '220px', maxSize: '600px' }"
            :pane2="{ size: selectedFile ? 'auto' : '0px', minSize: selectedFile ? '120px' : '0px', maxSize: 100 }">
            <template #pane1>
                <div class="h-full flex flex-col">
                    <!-- 浏览器窗口列表（仅 Electron 环境，置于最上方确保可见） -->
                    <SessionBrowserWindowList v-if="isElectron" :session-id="props.sessionId" />

                    <!-- 头部（仅在左侧目录树显示） -->
                    <div
                        class="shrink-0 flex items-center justify-between px-2 py-1.5 border-b border-gray-200 dark:border-[#2e3035]">
                        <h3 class="text-sm font-semibold text-gray-700 dark:text-[#e8e9ed] whitespace-nowrap mr-1.5">
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
                                        <FolderOpened />
                                    </el-icon>
                                </el-button>
                            </el-tooltip>
                            <!-- 布局切换按钮 -->
                            <el-tooltip :content="isHorizontalLayout ? '切换为上下布局' : '切换为左右布局'" placement="bottom">
                                <el-button class="workspace-tool-btn" text @click="toggleLayout">
                                    <el-icon size="16">
                                        <component :is="isHorizontalLayout ? SplitVerticalIcon : SplitHorizontalIcon" />
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
                        <div v-if="!treeData.length" class="text-center py-8 text-gray-400 text-sm p-2">
                            暂无文件
                        </div>

                        <el-tree v-else ref="treeRef" :key="treeKey" :data="treeData" :props="treeProps" node-key="path"
                            :expand-on-click-node="true" :default-expanded-keys="expandedKeys" :lazy="true"
                            :load="loadNode" @node-click="handleTreeNodeClick" @node-expand="onNodeExpand"
                            @node-collapse="onNodeCollapse" @node-contextmenu="handleNodeContextMenu" highlight-current
                            class="workspace-tree min-w-fit p-2">
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
                        class="shrink-0 flex items-center justify-between px-2 py-1.5 bg-gray-50 dark:bg-[#2a2c30] border-b border-gray-200 dark:border-[#2e3035]">
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
                                class="w-full border-0" style="height: 100%;"
                                sandbox="allow-same-origin allow-scripts" />

                            <!-- Markdown 渲染模式 -->
                            <div v-else-if="isMarkdownFile && currentPreviewMode === 'rendered'"
                                class="markdown-preview markdown-text" v-html="renderedContent" />

                            <!-- 源码模式（带语法高亮）- 所有支持的文件类型 -->
                            <div v-else-if="renderedContent" class="code-preview-container" v-html="renderedContent" />

                            <!-- 普通文本预览（不支持高亮的文件） -->
                            <pre v-else v-text="fileContent"
                                class="text-sm leading-relaxed whitespace-pre-wrap break-all  dark:bg-[#2a2c30] text-gray-800 dark:text-gray-200 p-4 m-0 overflow-auto min-h-0 font-mono" />
                        </div>
                    </div>
                </div>
            </template>
        </LiteSplitpanes>
    </div>

    <!-- 更换工作目录弹窗 -->
    <WorkspaceSettingsDialog v-model:visible="workspaceDialogVisible" :current-workspace-path="currentWorkspacePath"
        :allow-empty="false" @confirm="handleWorkspaceChange" />

    <!-- 右键菜单 -->
    <div v-if="contextMenu.visible"
        class="fixed bg-white dark:bg-[#232428] rounded-lg shadow-lg border border-gray-200 dark:border-[#2e3035] py-1 z-50 min-w-40"
        :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }" @click.stop @contextmenu.prevent>
        <div class="px-4 py-2 text-sm text-gray-700 dark:text-[#e8e9ed] hover:bg-gray-100 dark:hover:bg-[#2a2c30] cursor-pointer flex items-center gap-2"
            @click="handleCopyFileName">
            <el-icon>
                <CopyDocument />
            </el-icon>
            复制文件名
        </div>
        <div class="px-4 py-2 text-sm text-gray-700 dark:text-[#e8e9ed] hover:bg-gray-100 dark:hover:bg-[#2a2c30] cursor-pointer flex items-center gap-2"
            @click="handleCopyFilePath">
            <el-icon>
                <CopyDocument />
            </el-icon>
            复制路径
        </div>
        <div v-if="isElectron"
            class="px-4 py-2 text-sm text-gray-700 dark:text-[#e8e9ed] hover:bg-gray-100 dark:hover:bg-[#2a2c30] cursor-pointer flex items-center gap-2"
            @click="handleOpenInExplorer">
            <el-icon>
                <FolderOpened />
            </el-icon>
            在资源管理器中打开
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted, nextTick } from 'vue';
import { ElMessage } from 'element-plus';
import { apiService, type FileChangeEvent } from '@/services/ApiService';
import { Refresh, Close, FolderOpened, Switch, CopyDocument } from '@element-plus/icons-vue';
import { SwapHorizTwotone as SplitVerticalIcon, SwapVertTwotone as SplitHorizontalIcon } from '@vicons/material';
import { LoadingOutlined } from '@vicons/antd';
import { Folder, Document } from '@element-plus/icons-vue';
import { LiteSplitpanes } from "../ui";
import { useStorage, useThrottleFn } from '@vueuse/core';
import { useMarkdown } from '@/composables/useMarkdown';
import { useHighlight } from '@/composables/useHighlight';
import WorkspaceSettingsDialog from './chat-input/WorkspaceSettingsDialog.vue';
import SessionBrowserWindowList from './SessionBrowserWindowList.vue';

interface WorkspaceNode {
    name: string;
    path: string;
    isDirectory: boolean;
    children?: WorkspaceNode[];
    size?: number;
    hasChildren?: boolean;
    loaded?: boolean; // 标记是否已加载子节点
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
const workspaceDialogVisible = ref(false);
const currentWorkspacePath = ref<string | null>(null);
const previewError = ref('');
const expandedKeys = ref<string[]>([]);
const treeRef = ref();
const treeKey = ref(0);

// 右键菜单状态
const contextMenu = ref({
    visible: false,
    x: 0,
    y: 0,
    node: null as WorkspaceNode | null,
});

// 检测是否为 Electron 环境
const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

// el-tree 配置
const treeProps = {
    label: 'name',
    children: 'children',
    isLeaf: (data: WorkspaceNode) => !data.isDirectory,
};

/**
 * 懒加载节点数据
 */
async function loadNode(node: any, resolve: (data: WorkspaceNode[]) => void) {
    // 根节点（level === 0）已经在 loadTree 中加载
    if (node.level === 0) {
        resolve(treeData.value);
        return;
    }

    // 子节点懒加载
    const nodeData = node.data as WorkspaceNode;

    if (!nodeData.isDirectory || !props.sessionId) {
        resolve([]);
        return;
    }

    // 关键：如果节点已经加载过，直接返回缓存数据，不重复发起 API 请求
    if (nodeData.loaded && nodeData.children) {
        resolve(nodeData.children);
        return;
    }

    try {
        const response = await apiService.getWorkspaceChildren(props.sessionId, nodeData.path);
        const children = response.children || [];
        // 保存到 nodeData，以便后续本地更新
        nodeData.children = children;
        nodeData.loaded = true;
        resolve(children);
    } catch (error: any) {
        console.error('[WorkspaceSidebar] Failed to lazy load node:', error);
        resolve([]);
    }
}

// 布局方向：true=左右，false=上下，默认上下
const isHorizontalLayout = useStorage('workspaceLayoutHorizontal', false);

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
const { highlightCode, getLanguageFromExtension, isTextFile } = useHighlight();

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
 * 检查节点是否在树中
 */
function isNodeInTree(nodes: WorkspaceNode[], path: string): boolean {
    for (const node of nodes) {
        if (node.path === path) return true;
        if (node.children && isNodeInTree(node.children, path)) return true;
    }
    return false;
}

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
async function loadTree(force = false) {
    if (!props.sessionId) return;

    // 如果正在加载中，不重复请求
    if (isLoading.value) return;

    isLoading.value = true;
    try {
        const response = await apiService.getWorkspaceTree(props.sessionId);

        // 记录当前的选中状态
        const currentSelectedKey = treeRef.value?.getCurrentKey();

        // 增量更新树数据，保留已加载的子节点和展开状态
        updateTreeData(treeData.value, response.tree || []);

        // 等待 DOM 更新
        await nextTick();

        // 恢复选中状态
        if (currentSelectedKey) {
            treeRef.value?.setCurrentKey(currentSelectedKey);
        }
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
 * 清空数据重新加载，就像新打开会话一样
 */
function refreshTree() {
    treeData.value = [];
    loadTree();
}

/**
 * 检查路径是否在已展开的目录下
 * 如果父目录未展开，则该路径下的变化不需要更新展示
 */
function isPathInExpandedDir(filePath: string): boolean {
    // 根目录总是展开的（因为根目录数据始终加载）
    if (!filePath || (filePath.indexOf('/') === -1 && filePath.indexOf('\\') === -1)) {
        return true;
    }

    // 获取所有已展开节点的路径
    const expandedPaths = getExpandedNodePaths();

    // 统一使用 / 分隔符处理路径
    const normalizedPath = filePath.replace(/\\/g, '/');
    // 检查文件路径的任何一个父目录是否已展开
    const parts = normalizedPath.split('/');
    let currentPath = '';
    for (let i = 0; i < parts.length - 1; i++) {
        currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
        if (expandedPaths.includes(currentPath)) {
            return true;
        }
    }

    return false;
}

/**
 * 获取所有已展开节点的路径
 */
function getExpandedNodePaths(): string[] {
    const paths: string[] = [];
    const tree = treeRef.value;

    // 尝试多种方式获取展开节点
    if (tree) {
        // 方式1: 通过 store.nodesMap
        const nodesMap = tree.store?.nodesMap;
        if (nodesMap) {
            Object.values(nodesMap).forEach((node: any) => {
                if (node.expanded && node.data?.path) {
                    paths.push(node.data.path);
                }
            });
        }

        // 方式2: 通过 $refs.rootNode
        if (paths.length === 0 && tree.$refs?.rootNode?.childNodes) {
            collectExpandedPaths(tree.$refs.rootNode.childNodes, paths);
        }
    }

    return paths;
}

/**
 * 递归收集已展开节点的路径
 */
function collectExpandedPaths(nodes: any[], paths: string[]): void {
    nodes.forEach((node: any) => {
        if (node.expanded && node.data?.path) {
            paths.push(node.data.path);
        }
        if (node.childNodes && node.childNodes.length > 0) {
            collectExpandedPaths(node.childNodes, paths);
        }
    });
}

/**
 * 处理文件系统变化事件
 * 直接本地更新节点，不再请求后端 API
 */
function handleFileChange(event: FileChangeEvent) {
    // 忽略心跳消息
    if ((event as any).type === 'heartbeat') {
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
    if (!parentNode.loaded && parentNode.path !== '') {
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
            const existingIndex = parentNode.children.findIndex(child => child.name === fileName);
            if (existingIndex === -1) {
                // 创建新节点
                const newNode: WorkspaceNode = {
                    name: fileName,
                    path: normalizedPath,
                    isDirectory: event.type === 'addDir',
                    hasChildren: event.type === 'addDir',
                    children: event.type === 'addDir' ? [] : undefined,
                };
                // 计算插入位置（保持排序：目录在前，按名称排序）
                let insertBeforeNode = null;
                for (const child of parentNode.children) {
                    const childIsDir = child.isDirectory;
                    const newIsDir = newNode.isDirectory;
                    if (newIsDir && !childIsDir) {
                        // 新节点是目录，当前是文件，插入到当前之前
                        insertBeforeNode = treeRef.value.getNode(child.path);
                        break;
                    }
                    if (newIsDir === childIsDir && newNode.name.localeCompare(child.name) < 0) {
                        // 同类型且名称更小，插入到当前之前
                        insertBeforeNode = treeRef.value.getNode(child.path);
                        break;
                    }
                }
                // 如果 treeRef 未初始化（目录为空时 el-tree 未渲染），直接修改 treeData
                if (!treeRef.value) {
                    parentNode.children.push(newNode);
                    parentNode.children.sort((a, b) => {
                        if (a.isDirectory !== b.isDirectory) {
                            return a.isDirectory ? -1 : 1;
                        }
                        return a.name.localeCompare(b.name);
                    });
                } else if (insertBeforeNode) {
                    treeRef.value.insertBefore(newNode, insertBeforeNode);
                } else {
                    // 根目录的虚拟节点 path 为空字符串，需传入 null 而非节点对象
                    treeRef.value.append(newNode, parentNode.path || null);
                }
            }
            break;

        case 'unlink':
        case 'unlinkDir':
            // 使用 el-tree 官方 API 移除节点
            const node = treeRef.value.getNode(normalizedPath);
            if (node) {
                treeRef.value.remove(node);
            }
            // 如果删除的是当前预览的文件，自动关闭预览
            if (selectedFile.value && selectedFile.value.path === normalizedPath) {
                closePreview();
            }
            break;

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
 * 处理树节点点击
 */
function handleTreeNodeClick(data: WorkspaceNode) {
    handleFileSelect(data);
}

/**
 * 处理节点右键菜单
 */
function handleNodeContextMenu(event: MouseEvent, data: WorkspaceNode) {
    event.preventDefault();
    contextMenu.value = {
        visible: true,
        x: event.clientX,
        y: event.clientY,
        node: data,
    };

    // 点击其他地方关闭菜单
    const closeHandler = () => {
        closeContextMenu();
        document.removeEventListener('click', closeHandler);
    };
    setTimeout(() => {
        document.addEventListener('click', closeHandler);
    }, 0);
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

    const win = window as any;

    // 优先使用 Electron IPC 方式
    if (win.electronAPI?.clipboardIPC?.writeText) {
        try {
            const result = await win.electronAPI.clipboardIPC.writeText(text);
            if (!result.success) {
                throw new Error(result.error);
            }
            return;
        } catch (error) {
            console.warn('[Workspace] IPC 写入失败，尝试其他方式:', error);
        }
    }

    // 尝试直接调用 preload 暴露的 clipboard API
    if (win.electronAPI?.clipboard?.writeText) {
        try {
            win.electronAPI.clipboard.writeText(text);
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
 * 在资源管理器中打开
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
        let fullPath = workspacePath + separator + relativePath;

        // 如果是文件，获取其父目录路径
        if (!node.isDirectory) {
            const lastSepIndex = Math.max(fullPath.lastIndexOf('/'), fullPath.lastIndexOf('\\'));
            if (lastSepIndex > 0) {
                fullPath = fullPath.substring(0, lastSepIndex);
            }
        }

        if (window.electronAPI) {
            await window.electronAPI.openFolder(fullPath);
        }
    } catch (error: any) {
        console.error('Failed to open in explorer:', error);
        ElMessage.error('打开失败');
    }
    closeContextMenu();
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

    // 切换文件时重置哈希值，确保新文件内容能正常加载
    fileContentHash.value = '';

    await loadFileContent(node.path);
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
    if (!props.sessionId || !workspacePath) return;

    try {
        // 调用 API 更新工作目录路径
        await apiService.updateSessionWorkspacePath(props.sessionId, workspacePath);
        ElMessage.success('工作目录已更换');

        // 清空旧树数据并重新加载，确保显示新的工作目录
        treeData.value = [];
        expandedKeys.value = [];
        await loadTree();
    } catch (error: any) {
        console.error('Failed to change workspace path:', error);
        ElMessage.error(error.message || '更换工作目录失败');
    }
}

/**
 * 收集当前所有已展开节点的路径
 */
function collectExpandedPathsFromTree(): string[] {
    const paths: string[] = [];
    const tree = treeRef.value;
    if (!tree) return paths;

    const nodesMap = tree.store?.nodesMap;
    if (nodesMap) {
        Object.values(nodesMap).forEach((node: any) => {
            if (node.expanded && node.data?.path) {
                paths.push(node.data.path);
            }
        });
    }
    return paths;
}

// 防抖发送展开状态到后端
let expandPathsDebounceTimer: ReturnType<typeof setTimeout> | null = null;
function sendExpandedPathsToBackend() {
    if (expandPathsDebounceTimer) {
        clearTimeout(expandPathsDebounceTimer);
    }
    expandPathsDebounceTimer = setTimeout(async () => {
        if (!props.sessionId) return;
        const paths = collectExpandedPathsFromTree();
        try {
            await apiService.updateWorkspaceExpandedPaths(props.sessionId, paths);
        } catch (error) {
            console.error('[WorkspaceSidebar] 同步展开状态失败:', error);
        }
    }, 300);
}

// 节点展开/折叠事件处理
function onNodeExpand() {
    sendExpandedPathsToBackend();
}

function onNodeCollapse() {
    sendExpandedPathsToBackend();
}

let unsubscribeWatcher: (() => void) | null = null;

watch(() => props.sessionId, async (newSessionId, oldSessionId) => {
    // 会话切换时关闭文件预览
    if (oldSessionId && newSessionId !== oldSessionId) {
        closePreview();
        treeData.value = [];
        apiService.disconnectWorkspaceWatcher();
        if (unsubscribeWatcher) {
            unsubscribeWatcher();
            unsubscribeWatcher = null;
        }
    }

    if (newSessionId) {
        loadTree(); // 直接调用，不受节流限制

        // 连接 WorkspaceWatcher 实时监听文件变化
        apiService.connectWorkspaceWatcher(newSessionId);

        // 注册文件变化监听器
        unsubscribeWatcher = apiService.onWorkspaceChange(handleFileChange);
    } else {
        treeData.value = [];
        apiService.disconnectWorkspaceWatcher();
        if (unsubscribeWatcher) {
            unsubscribeWatcher();
            unsubscribeWatcher = null;
        }
    }
}, { immediate: true });

onUnmounted(() => {
    apiService.disconnectWorkspaceWatcher();
    if (unsubscribeWatcher) {
        unsubscribeWatcher();
        unsubscribeWatcher = null;
    }
    closeContextMenu();
});
</script>
<style>
@import "@/assets/markdown.css";
.code-preview-container pre code.hljs {
    color: var(--color-text, #333)!important;
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
    color: var(--color-text, #333)!important;
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
    display: block;
    width: 100%;
}

.dark .workspace-tree-node {
    color: var(--color-text);
}

/* 工作目录工具按钮 - 纯图标无框样式 */
.workspace-tool-btn {
    color: #888;
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
}

.workspace-tool-btn:hover {
    color: var(--color-primary, #409eff);
}

.dark .workspace-tool-btn {
    color: #8b8d95;
}

.dark .workspace-tool-btn:hover {
    color: var(--color-primary, #409eff);
}

/* LiteSplitpanes 基础样式 - 适配暗色模式 */
:deep(.lite-splitpanes__pane) {
    background-color: transparent;
    border: none !important;
}

/* 工作目录 pane 设置最小宽度和滚动 */
:deep(.lite-splitpanes__pane:first-child) {
    overflow: hidden !important;
}

/* 目录窗格滚动条美化 */
:deep(.lite-splitpanes__pane:first-child) ::-webkit-scrollbar {
    width: 6px;
    height: 6px;
}

:deep(.lite-splitpanes__pane:first-child) ::-webkit-scrollbar-thumb {
    background-color: rgba(0, 0, 0, 0.08);
    border-radius: 6px;
}

:deep(.lite-splitpanes__pane:first-child) ::-webkit-scrollbar-thumb:hover {
    background-color: rgba(0, 0, 0, 0.15);
}

:deep(.dark .lite-splitpanes__pane:first-child) ::-webkit-scrollbar-thumb {
    background-color: rgba(255, 255, 255, 0.08);
}

:deep(.dark .lite-splitpanes__pane:first-child) ::-webkit-scrollbar-thumb:hover {
    background-color: rgba(255, 255, 255, 0.15);
}

/* LiteSplitpanes 自定义样式 - 使用 :deep 确保穿透 scoped */
:deep(.lite-splitpanes__splitter) {
    background-color: var(--color-surface, #f5f5f5) !important;
    transition: background-color 0.2s ease;
    position: relative;
    z-index: 1;
}

:deep(.lite-splitpanes__splitter:hover) {
    background-color: var(--el-color-primary-light-8, #d9ecff) !important;
}

:deep(.dark .lite-splitpanes__splitter) {
    background-color: #25262a !important;
}

:deep(.dark .lite-splitpanes__splitter:hover) {
    background-color: var(--el-color-primary-light-8, #4a4d55) !important;
}

/* 水平布局：分割条为横线 */
:deep(.lite-splitpanes--horizontal .lite-splitpanes__splitter),
:deep(.lite-splitpanes__splitter--horizontal) {
    height: 4px !important;
    min-height: 4px !important;
    max-height: 4px !important;
    cursor: row-resize !important;
}

/* 垂直布局：分割条为竖线 */
:deep(.lite-splitpanes:not(.lite-splitpanes--horizontal) .lite-splitpanes__splitter) {
    width: 4px !important;
    cursor: col-resize !important;
}
</style>
