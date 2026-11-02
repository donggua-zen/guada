<template>
    <div
        class="plugins-view-switch"
        role="tablist"
        @keydown.left.prevent="move(-1)"
        @keydown.right.prevent="move(1)"
    >
        <!-- 滑动指示器：跟随选中项平移，切换时平滑滑过去（定位/测量见下方 measure） -->
        <span class="plugins-view-switch__indicator" :style="indicatorStyle" aria-hidden="true"></span>
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
import { onBeforeUnmount, onMounted, nextTick, ref, watch, type ComponentPublicInstance } from 'vue'
import type { PluginViewSwitchItem } from './pluginList.types'

// 插件页二级视图切换（已安装 / 市场）。
//
// 胶囊分段风格 + 滑动指示器（与侧边栏颜色主题切换同款视觉，但补上了位移动画）：
// 容器浅底圆角，选中项是浮起的表面色小块，切换时小块滑过去而不是瞬间跳变。
const props = defineProps<{
    modelValue: string
    items: PluginViewSwitchItem[]
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const buttons = ref<HTMLElement[]>([])
// 初始不可见，首次测量后淡入（避免从 0 位置滑入的怪动画）
const indicatorStyle = ref<Record<string, string>>({ opacity: '0' })

function setButton(index: number, el: Element | ComponentPublicInstance | null) {
    buttons.value[index] = el as HTMLElement
}

function measure() {
    const index = props.items.findIndex(item => item.value === props.modelValue)
    const el = buttons.value[index]
    if (!el) return
    indicatorStyle.value = {
        width: `${el.offsetWidth}px`,
        transform: `translateX(${el.offsetLeft}px)`,
        opacity: '1',
    }
}

// 字体加载/容器尺寸变化都可能改变按钮几何，resize 时重测
function handleResize() {
    measure()
}

onMounted(async () => {
    await nextTick()
    measure()
    window.addEventListener('resize', handleResize)
})

onBeforeUnmount(() => {
    window.removeEventListener('resize', handleResize)
})

watch(() => props.modelValue, async () => {
    await nextTick()
    measure()
})

watch(() => props.items, async () => {
    await nextTick()
    measure()
})

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
    position: relative;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    border-radius: 8px;
    background-color: var(--gd-color-sidebar-bg-active);
    /* 与列表行图标对位：行有 -mx-2 + px-2，切换条同样左移 8px 再补回 8px 内边距 */
    /* margin-left: -8px; */
}

.plugins-view-switch__indicator {
    position: absolute;
    top: 2px;
    left: 0;
    height: 26px;
    border-radius: 6px;
    background-color: var(--gd-color-surface);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
    pointer-events: none;
    transition:
        transform var(--gd-motion-duration-base) var(--gd-motion-ease-spring),
        width var(--gd-motion-duration-base) var(--gd-motion-ease-spring),
        opacity var(--gd-motion-duration-fast) ease;
}

.plugins-view-switch__item {
    position: relative;
    z-index: 1;
    display: inline-flex;
    align-items: center;
    height: 26px;
    padding: 0 10px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    cursor: pointer;
    font-size: var(--gd-size-text-sm);
    line-height: 18px;
    color: var(--gd-color-text-gray);
    transition: color 0.15s;
}

.plugins-view-switch__item:hover {
    color: var(--gd-color-text);
}

.plugins-view-switch__item.is-active {
    color: var(--gd-color-text);
    font-weight: 500;
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

/* ── 视图切换淡入 ──
   v-show 从 none 恢复时动画会重新播放，因此不需要 Transition/重建组件。
   加载态统一复用 .plugins-skeleton，不再额外维护进度条。 */
.plugins-view-fade {
    animation: plugins-view-fade-in 180ms ease-out;
}

@keyframes plugins-view-fade-in {
    from {
        opacity: 0;
        transform: translateY(4px);
    }

    to {
        opacity: 1;
        transform: translateY(0);
    }
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

/* 标签统一规则原先挂在 .el-tag 上（Element Plus 卸载后恒不匹配）。
   GdTag 自带 data-type/data-effect 三态配方，这里不再重复定义。 */
</style>
