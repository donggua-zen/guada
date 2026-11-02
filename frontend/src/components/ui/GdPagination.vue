<template>
    <div v-if="!hidden" :class="rootClasses" role="pagination">
        <!-- 上一页 -->
        <button type="button" aria-label="上一页" :disabled="currentPage <= 1" :class="pagerClasses"
            @click="go(currentPage - 1)">
            <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="m15 18-6-6 6-6" />
            </svg>
        </button>
        <!-- 页码组：首/省略/窗口/省略/尾 -->
        <template v-for="(item, i) in pagerItems" :key="`${item}-${i}`">
            <span v-if="item === '…'" class="gd-pagination__ellipsis select-none px-1 text-(--gd-color-text-disabled)">…</span>
            <button v-else type="button" :aria-current="item === currentPage ? 'page' : undefined"
                :class="pagerClasses" :data-active="item === currentPage ? 'true' : undefined"
                @click="go(item)">{{ item }}</button>
        </template>
        <!-- 下一页 -->
        <button type="button" aria-label="下一页" :disabled="currentPage >= totalPages" :class="pagerClasses"
            @click="go(currentPage + 1)">
            <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="m9 18 6-6-6-6" />
            </svg>
        </button>
    </div>
</template>
<script setup lang="ts">
import { computed } from "vue";

defineOptions({ name: "GdPagination" });

const props = withDefaults(defineProps<{
    total: number;
    pageSize: number;
    /** 当前页（受控）：v-model 或 :current-page + @change 单向 */
    modelValue?: number;
    hideOnSinglePage?: boolean;
    size?: "small" | "medium";
}>(), {
    modelValue: 1,
    hideOnSinglePage: false,
    size: "medium",
});

const emits = defineEmits<{
    "update:modelValue": [page: number];
    change: [page: number];
}>();

const currentPage = computed(() => props.modelValue);

const totalPages = computed(() => Math.max(1, Math.ceil(props.total / Math.max(1, props.pageSize))));
const hidden = computed(() => props.hideOnSinglePage && totalPages.value <= 1);

const go = (page: number): void => {
    const clamped = Math.min(Math.max(1, page), totalPages.value);
    if (clamped === props.modelValue) return;
    emits("update:modelValue", clamped);
    emits("change", clamped);
};

/** 经典页码窗口算法：首尾常驻，当前页 ±1 窗口，间隙折叠为省略号 */
const pagerItems = computed<(number | "…")[]>(() => {
    const total = totalPages.value;
    const cur = props.modelValue;
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const pages = new Set<number>([1, total, cur - 1, cur, cur + 1]);
    // 当前页靠边时多露出一位，避免出现 1 … 2 [3] … 这种无意义折叠
    if (cur <= 3) [2, 3, 4].forEach((p) => pages.add(p));
    if (cur >= total - 2) [total - 3, total - 2, total - 1].forEach((p) => pages.add(p));
    const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
    const out: (number | "…")[] = [];
    let prev = 0;
    for (const p of sorted) {
        if (p - prev > 1) out.push("…");
        out.push(p);
        prev = p;
    }
    return out;
});

const rootClasses = computed((): string => [
    // gd-pagination 基类是主题插件的稳定定位钩子，配合 data-size 换肤，不要改名
    "gd-pagination",
    "flex items-center gap-1",
].join(" "));

const pagerClasses = computed((): string => [
    "gd-pagination__item flex cursor-pointer select-none items-center justify-center rounded-md border-0 bg-transparent p-0 text-(--gd-color-text-gray) transition-colors duration-150",
    props.size === "small"
        ? "h-6 min-w-6 text-[12px]"
        : "h-8 min-w-8 text-[13px]",
    "md:hover:bg-[var(--gd-color-field-bg-hover)] md:hover:text-(--gd-color-text)",
    "disabled:cursor-not-allowed disabled:opacity-40 disabled:md:hover:bg-transparent",
    "data-[active=true]:bg-[var(--gd-color-primary)] data-[active=true]:font-medium data-[active=true]:text-white data-[active=true]:md:hover:bg-[var(--gd-color-primary)] data-[active=true]:md:hover:text-white",
].join(" "));
</script>
