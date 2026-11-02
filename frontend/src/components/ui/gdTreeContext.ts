import type { InjectionKey, Slot } from "vue";
import type { GdTreeNode } from "./GdTree.vue";

/**
 * GdTree ↔ GdTreeBranch 递归通道：
 * 字段名映射（id/label/children）、选中值、#node 插槽、点击回调。
 */
export interface GdTreeContext {
    idKey: string;
    labelKey: string;
    childrenKey: string;
    selectedId: string | null;
    nodeSlot: Slot | undefined;
    select: (node: GdTreeNode) => void;
}

export const gdTreeKey: InjectionKey<GdTreeContext> = Symbol("gd-tree-context");
