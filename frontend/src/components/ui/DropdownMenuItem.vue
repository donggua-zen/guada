<template>
  <div
    class="px-4 py-2 text-sm cursor-pointer flex items-center hover:bg-gray-100 dark:hover:bg-(--color-sidebar-bg-hover) dark:bg-(--color-surface) dark:text-(--color-text)"
    :class="{ 'opacity-50 cursor-not-allowed': disabled }" @click="handleClick">
    <slot></slot>
  </div>
</template>

<script setup lang="ts">
import { inject } from 'vue';
import { dropdownKey } from './DropdownMenu.vue';

const props = defineProps<{
  command?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  click: [];
}>();

const dropdown = inject<{ handleItemClick: (command: string) => void } | null>(dropdownKey, null);

const handleClick = () => {
  if (props.disabled) return;
  if (dropdown && props.command !== undefined) {
    dropdown.handleItemClick(props.command);
  }
  emit('click');
};
</script>
