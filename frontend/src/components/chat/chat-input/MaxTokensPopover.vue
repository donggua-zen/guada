<template>
  <CustomPopover :show="visible" @update:show="handleVisibleChange" :width="220" :anchor-el="anchorEl">
    <template #header>
      <div class="flex items-center gap-2 px-1 pb-2 pt-1">
        <span class="text-sm font-semibold text-gray-800 dark:text-gray-200">Token 上限</span>
        <span class="text-xs text-gray-400 dark:text-gray-500">{{ currentLabel }}</span>
      </div>
    </template>
    <div class="px-3 pb-3 pt-1">
      <el-slider v-model="localValue" :min="0" :max="8" :step="1" :show-tooltip="false" @input="onInput" @change="onChange" />
      <div class="flex justify-between mt-2 px-1">
        <span class="text-xs text-gray-400 dark:text-gray-500">不限</span>
        <span class="text-xs text-gray-400 dark:text-gray-500">1M</span>
      </div>
    </div>
  </CustomPopover>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ElSlider } from 'element-plus'
import CustomPopover from '../../ui/CustomPopover.vue'

const props = defineProps<{
  visible: boolean
  anchorEl: HTMLElement | null
  currentValue: number | null
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  'change': [value: number | null]
}>()

const STEP = 128000

const localValue = ref(0)
const dirty = ref(false)

function syncFromProps() {
  localValue.value = !props.currentValue ? 0 : Math.round(props.currentValue / STEP)
  dirty.value = false
}

watch(() => props.visible, (v) => {
  if (v) syncFromProps()
})

const currentLabel = computed(() => {
  const v = localValue.value
  if (v === 0) return '不限'
  const tokens = v * STEP
  if (tokens >= 1000000 && tokens % 1000000 === 0) return `${tokens / 1000000}M`
  return `${tokens / 1000}K`
})

// 拖动时标记为脏
function onInput() {
  dirty.value = true
}

// 松手时（在 popover 内松手）直接提交并关闭
function onChange(val: number | number[]) {
  const n = Array.isArray(val) ? val[0] : val
  dirty.value = false
  emit('change', n === 0 ? null : n * STEP)
  emit('update:visible', false)
}

// 关闭时：如果有未提交的改动（鼠标在 popover 外松手），提交当前值
function handleVisibleChange(v: boolean) {
  if (v) {
    syncFromProps()
  } else if (dirty.value) {
    dirty.value = false
    const n = localValue.value
    emit('change', n === 0 ? null : n * STEP)
  }
  emit('update:visible', v)
}
</script>
