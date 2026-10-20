<template>
  <div
    class="group flex cursor-pointer items-center gap-3 rounded-[var(--gd-size-surface-radius)] bg-(--gd-color-surface-subtle) px-3 py-3 transition-colors hover:bg-(--gd-color-surface-subtle-hover)"
    @click="emit('click')"
  >
    <div class="shrink-0" :class="{ 'opacity-60': muted }">
      <CardAvatar :src="iconSrc" :name="name" size="md" />
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
        class="mt-1 truncate leading-4 text-(--gd-color-text-gray)"
        style="font-size: var(--gd-size-text-xs);"
        :title="description"
      >
        {{ description }}
      </p>
    </div>

    <div class="flex shrink-0 items-center gap-2">
      <DropdownMenu v-if="menuItems.length > 0" @command="(command: string) => emit('command', command)">
        <div class="row-menu-trigger" :title="t('common.more')" :aria-label="t('common.more')">
          <el-icon :size="16">
            <MoreHorizontal20Filled />
          </el-icon>
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
import { ElIcon } from 'element-plus'
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
</style>
