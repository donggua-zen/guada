<template>
  <div
    v-if="showImage && tray"
    class="flex flex-shrink-0 items-center justify-center overflow-hidden"
    :class="sizeClass"
    :style="[radiusStyle, trayStyle]"
  >
    <img
      :src="src ?? undefined"
      class="h-full w-full object-contain"
      @error="onError"
    />
  </div>
  <img
    v-else-if="showImage"
    :src="src ?? undefined"
    class="object-cover flex-shrink-0"
    :class="sizeClass"
    :style="radiusStyle"
    @error="onError"
  />
  <div
    v-else
    class="avatar-auto flex items-center justify-center flex-shrink-0 font-bold"
    :class="sizeClass"
    :style="{ '--avatar-hue': hue, ...radiusStyle }"
  >
    {{ initial }}
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { avatarHue } from '@/utils/avatarColor'

const props = withDefaults(defineProps<{
  src?: string | null
  name?: string
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  /**
   * 托盘模式：给图标加一层带边框的底托 + 内边距。
   *
   * 解决三个问题：满版图标（如 todo / 知识库）被圆角裁切、深浅色图标与背景撞色、
   * 无图标区域的边界不清。底托颜色走 CSS 变量，主题可覆盖：
   * `--gd-plugin-icon-tray-bg` / `--gd-plugin-icon-tray-border`。
   */
  tray?: boolean
  /** 底托底色覆盖（优先于 CSS 变量），用于个别图标需要特殊衬色时 */
  trayColor?: string
}>(), {
  size: 'sm',
  disabled: false,
  tray: false,
  trayColor: '',
})

const emit = defineEmits<{ 'error': [] }>()

const sizeClass = computed(() => {
  const map = {
    sm: 'w-8 h-8 text-sm',
    md: 'w-10 h-10 text-base',
    lg: 'w-12 h-12 text-lg',
  }
  return map[props.size]
})

/** 托盘内边距：图标不贴边，避免被 12px 圆角裁掉四角 */
const trayPadding = computed(() => {
  const map = { sm: '3px', md: '4px', lg: '5px' }
  return map[props.size]
})

const radiusStyle = computed(() => ({
  'border-radius': 'var(--gd-size-surface-radius)',
}))

const trayStyle = computed(() => ({
  background: props.trayColor || 'var(--gd-plugin-icon-tray-bg, var(--gd-color-surface))',
  border: '1px solid var(--gd-plugin-icon-tray-border, var(--gd-color-surface-border))',
  padding: trayPadding.value,
}))

const hue = computed(() => avatarHue(props.name || '?'))
const initial = computed(() => props.name?.trim().charAt(0) || '?')

// 图片加载失败时回退到首字母色块（此前只隐藏 <img>，会留一块空白）
const failed = ref(false)
const showImage = computed(() => !!props.src && !failed.value)

// 换图时重置失败状态，避免一次失败后永久回退
watch(
  () => props.src,
  () => {
    failed.value = false
  },
)

function onError() {
  failed.value = true
  emit('error')
}
</script>
