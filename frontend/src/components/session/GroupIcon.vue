<template>
  <component :is="resolved" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { resolveGroupIcon } from '@/utils/groupIcon'

/** 分组 / 项目图标：统一默认回退，尺寸与颜色由调用方 class 透传。 */
const props = defineProps<{
  icon?: string | null
}>()

const resolved = computed(() => resolveGroupIcon(props.icon))
</script>
