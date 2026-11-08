<template>
  <div data-gd-slot="plugin-page" class="h-full w-full overflow-hidden flex flex-col">
    <div v-if="!target" class="flex-1 flex flex-col items-center justify-center gap-2 text-sm text-(--gd-color-text-gray)">
      <span>{{ t('plugins.pageView.missing') }}</span>
      <span class="text-xs opacity-70">{{ pluginId }}{{ slotKey ? ':' + slotKey : '' }}</span>
    </div>
    <div v-else-if="!resolved" class="flex-1 flex items-center justify-center text-sm text-(--gd-color-text-gray)">
      {{ t('plugins.pageView.loading') }}
    </div>
    <component
      v-else
      :is="resolved.component"
      :key="resolved.pluginId + ':' + resolved.component"
      v-bind="resolved.extraProps"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'

import { usePluginSlots } from '@/stores/pluginSlots'
import { usePluginHost } from '@/services/plugin-host'

/**
 * 插件全页工作台（v3 `main` slot）
 *
 * 路由：`/plugin-page/:pluginId/:slotKey?`
 * 组件来自 `pluginSlots.resolve('main')`，props 统一注入 `{ pluginId, sessionId, host }`。
 * 插件被禁用/卸载时 slot 消失 → 自动回退首页，避免白屏。
 */
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const slots = usePluginSlots()
const host = usePluginHost()

const pluginId = computed(() => String(route.params.pluginId || ''))
const slotKey = computed(() => String(route.params.slotKey || ''))

const target = computed(() =>
  slots
    .resolve('main')
    .find(
      (item) =>
        item.pluginId === pluginId.value &&
        (!slotKey.value || item.slotKey === slotKey.value),
    ),
)

const resolved = computed(() => {
  const item = target.value
  if (!item) return null
  return {
    pluginId: item.pluginId,
    component: item.component,
    extraProps: { pluginId: item.pluginId, sessionId: null, host },
  }
})

onMounted(() => slots.init())

// 插件被禁用/卸载后回退
watch(
  () => slots.version,
  () => {
    if (!target.value && pluginId.value) {
      void router.replace({ path: '/' })
    }
  },
)
</script>
