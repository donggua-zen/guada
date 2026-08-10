<template>
  <img
    v-if="src"
    :src="src"
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
import { computed } from 'vue'
import { avatarHue } from '@/utils/avatarColor'

const props = withDefaults(defineProps<{
  src?: string | null
  name?: string
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
}>(), {
  size: 'sm',
  disabled: false,
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

const radiusStyle = computed(() => ({
  'border-radius': 'var(--size-surface-radius)',
}))

const hue = computed(() => avatarHue(props.name || '?'))
const initial = computed(() => props.name?.trim().charAt(0) || '?')

function onError(e: Event) {
  const target = e.target as HTMLImageElement
  target.style.display = 'none'
  emit('error')
}
</script>
