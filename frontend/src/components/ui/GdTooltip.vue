<template>
  <span
    ref="triggerRef"
    class="l-tooltip__trigger"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
    @focus="onMouseEnter"
    @blur="onMouseLeave"
  >
    <slot />
  </span>
</template>

<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import {
  showTooltip,
  hideTooltip,
  refreshTooltip,
  type TooltipPlacement,
  type TooltipEffect,
} from './tooltip'

const props = withDefaults(
  defineProps<{
    content?: string
    placement?: TooltipPlacement
    effect?: TooltipEffect
  }>(),
  {
    content: '',
    placement: 'top',
    effect: 'dark',
  },
)

const triggerRef = ref<HTMLElement | null>(null)

function onMouseEnter(): void {
  if (!props.content || !triggerRef.value) return
  showTooltip(triggerRef.value, props.content, props.placement, props.effect)
}

function onMouseLeave(): void {
  hideTooltip()
}

// content 变化且 tooltip 当前正显示（如点击切换按钮后文案变化但鼠标未移开）：
// 立即刷新文本并重定位，无需重新 hover
watch(
  () => props.content,
  () => {
    if (triggerRef.value) {
      refreshTooltip(triggerRef.value, props.content, props.placement, props.effect)
    }
  },
)

onUnmounted(() => {
  hideTooltip()
})
</script>

<style scoped>
.l-tooltip__trigger {
  display: inline-flex;
}
</style>
