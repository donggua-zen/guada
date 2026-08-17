<template>
  <!-- single 模式：只取第一个 -->
  <component
    v-if="mode === 'single' && items[0]"
    :is="items[0].component"
    v-bind="mergedProps(items[0])"
  />
  <!-- list 模式：并列渲染 -->
  <template v-else-if="mode === 'list'">
    <component
      v-for="(item, i) in items"
      :key="`${item.pluginId}-${item.component}-${i}`"
      :is="item.component"
      v-bind="mergedProps(item)"
    />
  </template>
  <!-- chain 模式：暂缓实现，首版按 list 兜底 -->
  <template v-else>
    <component
      v-for="(item, i) in items"
      :key="`${item.pluginId}-${item.component}-${i}`"
      :is="item.component"
      v-bind="mergedProps(item)"
    />
  </template>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import { usePluginSlots } from '@/stores/pluginSlots'

const props = defineProps({
  name: { type: String, required: true },
  mode: { type: String, default: 'list' }, // 'single' | 'list' | 'chain'
})

const slots = usePluginSlots()
onMounted(() => slots.init())

const items = computed(() => {
  const all = slots.resolve(props.name)
  return props.mode === 'single' ? all.slice(0, 1) : all
})

// 静态 props（注册时）+ 调用方动态 props（渲染时）合并，inject 覆盖静态
function mergedProps(item) {
  return { ...(item.props || {}), ...(item.extraProps || {}) }
}
</script>
