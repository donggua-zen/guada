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
import { onUnmounted, ref } from 'vue'
import {
  showTooltip,
  hideTooltip,
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

onUnmounted(() => {
  hideTooltip()
})
</script>

<style scoped>
.l-tooltip__trigger {
  display: inline-flex;
}
</style>
