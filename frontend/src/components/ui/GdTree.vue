<template>
    <div class="gd-tree" role="tree">
        <GdTreeBranch :nodes="data" :depth="0" />
        <div v-if="data.length === 0 && emptyText"
            class="px-2 py-3 text-center text-[12px] leading-none text-[var(--gd-color-field-text-disabled)]">
            {{ emptyText }}
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, provide, useSlots, type Slot } from "vue";
import GdTreeBranch from "./GdTreeBranch";
import { gdTreeKey } from "./gdTreeContext";

defineOptions({ name: "GdTree", inheritAttrs: false });

/**
 * 只读展示树（替代 el-tree 的 KBFileTree 移动弹窗场景）。
 * 窄契约：data + idKey/labelKey/childrenKey + v-model:selected + @node-click +
 * #node 插槽自定义节点内容。无折叠/拖拽/异步加载/多选（0 用量不做）。
 * 递归渲染见 GdTreeBranch.ts（inject 本上下文，扁平输出节点行）。
 */

export interface GdTreeNode {
    [key: string]: unknown;
}

const props = withDefaults(defineProps<{
    data: GdTreeNode[];
    /** 节点 id 字段名 */
    idKey?: string;
    /** 节点标题字段名 */
    labelKey?: string;
    /** 子节点字段名 */
    childrenKey?: string;
    /** 当前选中节点 id（v-model:selected） */
    selected?: string | null;
    emptyText?: string;
}>(), {
    idKey: "id",
    labelKey: "label",
    childrenKey: "children",
    selected: null,
    emptyText: "",
});

const emit = defineEmits<{
    "update:selected": [id: string | null];
    "node-click": [node: GdTreeNode];
}>();

const slots = useSlots();
const selectedId = computed(() => props.selected);

provide(gdTreeKey, {
    get idKey() { return props.idKey; },
    get labelKey() { return props.labelKey; },
    get childrenKey() { return props.childrenKey; },
    get selectedId() { return selectedId.value; },
    get nodeSlot(): Slot | undefined { return slots.node; },
    select: (node: GdTreeNode) => {
        emit("node-click", node);
        emit("update:selected", String(node[props.idKey] ?? ""));
    },
});
</script>

<style scoped>
:deep(.gd-tree__node) {
    cursor: pointer;
    color: var(--gd-color-text);
}

:deep(.gd-tree__node:hover) {
    background: var(--gd-color-sidebar-bg-hover);
}

:deep(.gd-tree__node--selected),
:deep(.gd-tree__node--selected:hover) {
    background: var(--gd-color-field-option-bg-selected);
}
</style>
