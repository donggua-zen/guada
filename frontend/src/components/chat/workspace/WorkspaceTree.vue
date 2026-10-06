<template>
    <div class="workspace-tree-custom">
        <WorkspaceTreeNode
            v-for="node in nodes"
            :key="node.path"
            :node="node"
            :depth="0"
            :selected-path="selectedPath"
            :loading-paths="loadingPaths"
            :expanded-paths="expandedPaths"
            :on-load="onLoad"
            @select="(n, isPreview) => $emit('select', n, isPreview)"
            @toggle="(n, e) => $emit('toggle', n, e)"
            @contextmenu="(e, n) => $emit('contextmenu', e, n)"
        />
    </div>
</template>

<script setup lang="ts">
import WorkspaceTreeNode from './WorkspaceTreeNode.vue';
import type { WorkspaceNode } from '@/types/workspace';

const props = defineProps<{
    nodes: WorkspaceNode[];
    selectedPath: string;
    loadingPaths: Set<string>;
    expandedPaths?: Set<string>;
    onLoad?: (node: WorkspaceNode) => Promise<void>;
}>();

const emit = defineEmits<{
    select: [node: WorkspaceNode, isPreview?: boolean];
    toggle: [node: WorkspaceNode, expanded: boolean];
    contextmenu: [event: MouseEvent, node: WorkspaceNode];
}>();
</script>

<style scoped>
.workspace-tree-custom {
    padding: 0 8px;
    min-width: fit-content;
}

.workspace-tree-custom > .tree-node + .tree-node {
    margin-top: 2px;
}

.workspace-tree-custom :deep(.tree-children > .tree-node + .tree-node) {
    margin-top: 2px;
}
</style>
