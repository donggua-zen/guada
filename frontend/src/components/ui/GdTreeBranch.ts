import { defineComponent, h, inject, type PropType, type VNode } from "vue";
import { gdTreeKey } from "./gdTreeContext";
import type { GdTreeNode } from "./GdTree.vue";

/**
 * GdTree 的递归渲染器：inject 根组件上下文，
 * 输出节点行（子级缩进 +16px），无包装 div、无折叠状态。
 */

const GdTreeBranch = defineComponent({
    name: "GdTreeBranch",
    props: {
        nodes: { type: Array as PropType<GdTreeNode[]>, required: true },
        depth: { type: Number, required: true },
    },
    setup(branchProps): () => VNode[] {
        const ctx = inject(gdTreeKey);
        if (!ctx) return () => [];
        return () => {
            const out: VNode[] = [];
            for (const node of branchProps.nodes) {
                const id = String(node[ctx.idKey] ?? "");
                const label = String(node[ctx.labelKey] ?? "");
                const children = (node[ctx.childrenKey] as GdTreeNode[] | undefined) ?? [];
                const isSelected = id !== "" && id === ctx.selectedId;
                out.push(
                    h(
                        "div",
                        {
                            key: `node-${id || label}-${branchProps.depth}`,
                            class: ["gd-tree__node", isSelected ? "gd-tree__node--selected" : ""],
                            role: "treeitem",
                            "aria-selected": isSelected,
                            "aria-level": branchProps.depth + 1,
                            tabindex: "-1",
                            onClick: () => ctx.select(node),
                        },
                        [
                            h(
                                "span",
                                {
                                    class: "flex min-w-0 items-center gap-2 rounded-md py-1.5 pr-2 text-[13px] leading-none transition-colors duration-150",
                                    style: { paddingLeft: `${8 + branchProps.depth * 16}px` },
                                },
                                [
                                    ctx.nodeSlot
                                        ? ctx.nodeSlot({ node })
                                        : h("span", { class: "truncate" }, label),
                                ],
                            ),
                        ],
                    ),
                );
                if (children.length) {
                    out.push(h(GdTreeBranch, { nodes: children, depth: branchProps.depth + 1 }));
                }
            }
            return out;
        };
    },
});

export default GdTreeBranch;
