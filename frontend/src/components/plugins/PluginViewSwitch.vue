<template>
    <div
        class="plugins-view-switch"
        role="tablist"
        @keydown.left.prevent="move(-1)"
        @keydown.right.prevent="move(1)"
    >
        <button
            v-for="(item, index) in items"
            :key="item.value"
            :ref="el => setButton(index, el)"
            type="button"
            role="tab"
            :aria-selected="modelValue === item.value"
            :tabindex="modelValue === item.value ? 0 : -1"
            class="plugins-view-switch__item"
            :class="{ 'is-active': modelValue === item.value }"
            @click="emit('update:modelValue', item.value)"
        >
            <span class="plugins-view-switch__label">{{ item.label }}</span>
        </button>
    </div>
</template>

<script setup lang="ts">
import { ref, type ComponentPublicInstance } from 'vue'
import type { PluginViewSwitchItem } from './pluginList.types'

// 插件页二级视图切换（已安装 / 市场）。
//
// 刻意与一级 el-tabs 拉开一档：高度 44→32、字号 15→14、active 走正文色而非品牌色，
// 否则两层下划线同权，看不出谁包着谁。
const props = defineProps<{
    modelValue: string
    items: PluginViewSwitchItem[]
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const buttons = ref<HTMLElement[]>([])

function setButton(index: number, el: Element | ComponentPublicInstance | null) {
    buttons.value[index] = el as HTMLElement
}

/**
 * 方向键只在焦点落在切换钮时生效：不挂全局监听，就不会和搜索框、全局快捷键抢键。
 * 切完把焦点交给新选中的那一项，继续按方向键才能连着走。
 */
function move(step: number) {
    const index = props.items.findIndex(item => item.value === props.modelValue)
    if (index < 0 || props.items.length < 2) return
    const next = (index + step + props.items.length) % props.items.length
    emit('update:modelValue', props.items[next].value)
    buttons.value[next]?.focus()
}
</script>

<style scoped>
.plugins-view-switch {
    display: flex;
    align-items: center;
    gap: 4px;
    /* 与列表行图标同列：行有 -mx-2 + px-2，切换钮同样左移 8px 再补回 8px 内边距 */
    margin-left: -8px;
}

.plugins-view-switch__item {
    display: inline-flex;
    align-items: center;
    height: 32px;
    padding: 0 8px;
    border: 0;
    border-bottom: 2px solid transparent;
    background: transparent;
    cursor: pointer;
    font-size: var(--gd-size-text-sm);
    line-height: 20px;
    color: var(--gd-color-text-gray);
    transition: color 0.15s, border-color 0.15s;
}

.plugins-view-switch__item:hover {
    color: var(--gd-color-text);
}

.plugins-view-switch__item.is-active {
    color: var(--gd-color-text);
    font-weight: 600;
    border-bottom-color: var(--gd-color-text);
}
</style>

<style>
/* ── 插件页工具栏体系（视图条 / 筛选行 / 搜索 / 说明钮）
   与 PluginViewSwitch 同生命周期加载，Skills 与 MCP 两个 tab 共用一套几何 ── */
.plugins-view-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 40px;
    margin-bottom: 8px;
}

.plugins-view-bar__left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
}

.plugins-view-bar__right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
}

.plugins-view-info {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--gd-color-text-gray);
    cursor: pointer;
    transition: background-color 0.15s, color 0.15s;
}

.plugins-view-info:hover {
    background-color: var(--gd-color-sidebar-bg-hover);
    color: var(--gd-color-text);
}

.plugins-filter-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 12px;
}

.plugins-filter-row__spacer {
    flex: 1;
}

.plugins-chip {
    padding: 4px 12px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    font-size: calc(var(--gd-size-text-base) - 1px);
    line-height: 18px;
    color: var(--gd-color-text-gray);
    cursor: pointer;
    transition: background-color 0.15s, color 0.15s;
}

.plugins-chip:hover {
    background-color: var(--gd-color-surface-subtle-hover);
    color: var(--gd-color-text);
}

.plugins-chip.is-active {
    background-color: var(--gd-color-sidebar-bg-active);
    color: var(--gd-color-text);
}

.plugins-chip__count {
    margin-left: 4px;
    font-size: calc(var(--gd-size-text-base) - 3px);
    line-height: 14px;
    color: var(--gd-color-text-disabled);
}

.plugins-search {
    width: 240px;
}

/* ── 首次进入市场的占位行：几何对齐 PluginListRow（py-2.5 px-2 / gap-3 / 40px 头像 / 20px+16px 两行）
   pulse 只动 opacity，与 MessageSkeleton 同一手法 */
.plugins-skeleton {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    padding: 10px 8px;
    border-radius: 8px;
    animation: plugins-skeleton-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

.plugins-skeleton__avatar {
    width: 40px;
    height: 40px;
    flex-shrink: 0;
    border-radius: 12px;
    background-color: color-mix(in srgb, var(--gd-color-text) 10%, var(--gd-color-bg));
}

.plugins-skeleton__lines {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
}

.plugins-skeleton__line {
    width: 100%;
    height: 16px;
    border-radius: 4px;
    background-color: color-mix(in srgb, var(--gd-color-text) 10%, var(--gd-color-bg));
}

.plugins-skeleton__line--name {
    width: 45%;
    height: 14px;
}

@keyframes plugins-skeleton-pulse {

    0%,
    100% {
        opacity: 1;
    }

    50% {
        opacity: 0.5;
    }
}

/* ── 标签统一（原先 Skills 页把标签全压平成灰、MCP 页保留 Element 彩色，同一页两种语言）
   中性标签走文字色派生的浅底，状态标签走状态色浅底；两档都随主题翻转，无需 .dark 分支 */
.plugin-list-row .el-tag,
.market-install .el-tag,
.mcp-market__dialog .el-tag {
    height: 20px;
    padding: 0 7px;
    border: none;
    background-color: var(--gd-color-surface-subtle);
    color: var(--gd-color-text-gray);
    font-size: calc(var(--gd-size-text-base) - 3px);
    line-height: 18px;
}

.plugin-list-row .el-tag--success,
.market-install .el-tag--success,
.mcp-market__dialog .el-tag--success {
    background-color: color-mix(in srgb, var(--gd-color-success) 12%, transparent);
    color: var(--gd-color-success);
}

.plugin-list-row .el-tag--warning,
.market-install .el-tag--warning,
.mcp-market__dialog .el-tag--warning {
    background-color: color-mix(in srgb, var(--gd-color-warning) 14%, transparent);
    color: var(--gd-color-warning);
}
</style>
