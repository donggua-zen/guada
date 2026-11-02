<template>
  <div
    class="plugin-list-row group flex min-w-0 cursor-pointer items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-(--gd-color-surface-subtle-hover)"
    @click="emit('click')"
  >
    <div class="shrink-0" :class="{ 'opacity-60': muted }">
      <CardAvatar :src="iconSrc" :name="name" size="md" tray />
    </div>

    <div class="min-w-0 flex-1" :class="{ 'opacity-60': muted }">
      <div class="flex min-w-0 items-center gap-2">
        <span
          class="truncate font-semibold leading-5 text-(--gd-color-text)"
          style="font-size: var(--gd-size-text-sm);"
        >{{ name }}</span>
        <slot name="badges" />
      </div>
      <p
        v-if="description"
        class="plugin-row-desc mt-1 truncate leading-4 text-(--gd-color-text-gray)"
        style="font-size: var(--gd-size-text-xs);"
        :title="description"
      >
        {{ description }}
      </p>
    </div>

    <div class="flex shrink-0 items-center gap-2">
      <DropdownMenu v-if="menuItems.length > 0" @command="(command: string) => emit('command', command)">
        <div class="row-menu-trigger" :title="t('common.more')" :aria-label="t('common.more')">
          
            <MoreHorizontal20Filled class="w-4 h-4"  />
          
        </div>
        <template #dropdown>
          <DropdownMenuItem
            v-for="item in menuItems"
            :key="item.command"
            :command="item.command"
            :disabled="item.disabled"
            :title="item.title"
          >
            <span :class="item.danger ? 'text-red-500' : ''">{{ item.label }}</span>
          </DropdownMenuItem>
        </template>
      </DropdownMenu>
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { MoreHorizontal20Filled } from '@vicons/fluent'
import CardAvatar from '@/components/ui/CardAvatar.vue'
import DropdownMenu from '@/components/ui/DropdownMenu.vue'
import DropdownMenuItem from '@/components/ui/DropdownMenuItem.vue'
import type { PluginRowMenuItem } from './pluginList.types'

withDefaults(defineProps<{
  name: string
  description?: string
  iconSrc?: string | null
  /** 禁用态：仅淡化图标与文字，不影响右侧开关 */
  muted?: boolean
  menuItems?: PluginRowMenuItem[]
}>(), {
  description: '',
  iconSrc: null,
  muted: false,
  menuItems: () => [],
})

const emit = defineEmits<{
  click: []
  command: [command: string]
}>()

const { t } = useI18n()
</script>

<style scoped>
.row-menu-trigger {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  color: var(--gd-color-text-gray);
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.row-menu-trigger:hover {
  background-color: var(--gd-color-sidebar-bg-hover);
  color: var(--gd-color-text);
}

/* ── 市场行动作钮的显隐 ──
   更新类与进行中的动作长存，安装/添加类只在扫过该行或键盘落到行内时出现。
   用 opacity 而不是 display：位置一开始就占住，hover 不会让右侧列宽抖动。
   这里显式列了颜色过渡项，否则会覆盖掉 GdButton 自带的 transition-colors */
.plugin-list-row :deep(.market-action) {
  opacity: 0;
  transition: opacity 0.15s ease, background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease;
}

.plugin-list-row:hover :deep(.market-action),
.plugin-list-row:focus-within :deep(.market-action),
.plugin-list-row :deep(.market-action.is-persistent) {
  opacity: 1;
}

/* 触屏没有 hover，只在 hover 出现的动作在移动端一律常驻 */
html.mobile .plugin-list-row :deep(.market-action) {
  opacity: 1;
}
</style>
