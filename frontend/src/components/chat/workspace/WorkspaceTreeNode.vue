<template>
    <div class="tree-node">
        <div
            class="tree-node-content"
            :class="{ 'is-selected': selectedPath === node.path }"
            :style="{ paddingLeft: depth * 16 + 8 + 'px' }"
            @click="handleClick"
            @contextmenu.prevent="(e) => $emit('contextmenu', e, node)"
        >
            <!-- 展开/折叠图标（仅目录） -->
            <span v-if="node.isDirectory" class="expand-icon" @click.stop="toggle">
                <svg v-if="expanded" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="6 9 12 15 18 9"/>
                </svg>
                <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="9 18 15 12 9 6"/>
                </svg>
            </span>
            <span v-else class="expand-icon-placeholder" />

            <!-- 文件夹/文件图标 -->
            <span v-if="node.isDirectory" class="node-icon folder-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
                </svg>
            </span>
            <span v-else class="node-icon file-icon">
                <img :src="fileIcon" width="16" height="16" />
            </span>

            <!-- 节点名称 -->
            <span class="node-label">{{ node.name }}</span>

            <!-- 加载中（右对齐，带淡出过渡） -->
            <Transition name="fade">
                <span v-if="loadingPaths.has(node.path)" class="loading-indicator">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="spin">
                        <path d="M21 12a9 9 0 11-6.219-8.56"/>
                    </svg>
                </span>
            </Transition>
        </div>

        <!-- 子节点（仅展开的目录） -->
        <div v-if="expanded && node.isDirectory" class="tree-children">
            <!-- 有缓存数据时先显示，background 刷新 -->
            <WorkspaceTreeNode
                v-for="child in node.children || []"
                :key="child.path"
                :node="child"
                :depth="depth + 1"
                :selected-path="selectedPath"
                :loading-paths="loadingPaths"
                :on-load="onLoad"
                @select="(n, isPreview) => $emit('select', n, isPreview)"
                @toggle="(n, e) => $emit('toggle', n, e)"
                @contextmenu="(e, n) => $emit('contextmenu', e, n)"
            />
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { WorkspaceNode } from './WorkspaceTree.vue';

// 递归组件需要显式导入自身
import WorkspaceTreeNode from './WorkspaceTreeNode.vue';
import { useFileIcon } from '@/composables/useFileIcon';

const fileIcon = useFileIcon(() => props.node.name);

const props = defineProps<{
    node: WorkspaceNode;
    depth: number;
    selectedPath: string;
    loadingPaths: Set<string>;
    onLoad?: (node: WorkspaceNode) => Promise<void>;
}>();

const emit = defineEmits<{
    select: [node: WorkspaceNode, isPreview?: boolean];
    contextmenu: [event: MouseEvent, node: WorkspaceNode];
    toggle: [node: WorkspaceNode, expanded: boolean];
}>();

const expanded = ref(false);

// 单击/双击延迟区分（仅文件节点）
let clickTimer: ReturnType<typeof setTimeout> | null = null;

function handleClick() {
    if (props.node.isDirectory) {
        toggle();
        return
    }
    // 文件节点：延迟区分单击/双击
    if (clickTimer) {
        // 第二次点击在延迟内到达 → 双击 → 持久标签
        clearTimeout(clickTimer)
        clickTimer = null
        emit('select', props.node, false)
    } else {
        clickTimer = setTimeout(() => {
            clickTimer = null
            emit('select', props.node, true)
        }, 250)
    }
}

async function toggle() {
    if (!props.node.isDirectory) return;
    expanded.value = !expanded.value;

    // 通知父组件展开状态变化（用于同步到后端）
    emit('toggle', props.node, expanded.value);

    // 展开时调用 onLoad 回调加载子节点（有缓存数据时会先显示再刷新）
    if (expanded.value && props.onLoad) {
        await props.onLoad(props.node);
    }
}
</script>

<style scoped>
.tree-node {
    user-select: none;
}

.tree-node-content {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 26px;
    padding: 0 8px 0 8px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    color: var(--color-text);
    transition: background-color 0.15s;
}

.tree-node-content:hover {
    background-color: var(--color-sidebar-bg-hover);
}

.tree-node-content.is-selected {
    background-color: var(--color-sidebar-bg-active) !important;
}

.expand-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    color: var(--color-text-gray);
    flex-shrink: 0;
}

.expand-icon-placeholder {
    width: 16px;
    flex-shrink: 0;
}

.node-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}

.folder-icon {
    color: #e6a23c;
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
}

.loading-indicator {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    color: var(--color-text-gray);
    flex-shrink: 0;
    margin-left: auto;
}

.spin {
    animation: tree-spin 0.6s linear infinite;
}

@keyframes tree-spin {
    to { transform: rotate(360deg); }
}

.tree-children {
    /* children indent via paddingLeft on each node-content */
}

/* 加载指示器淡出过渡 */
.fade-leave-active {
    transition: opacity 0.2s ease;
}
.fade-leave-to {
    opacity: 0;
}
</style>
