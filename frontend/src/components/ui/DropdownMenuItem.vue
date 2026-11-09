<template>
  <div
    class="gd-dropdown-menu__item px-4 py-2 text-sm cursor-pointer flex items-center hover:bg-(--gd-color-sidebar-bg-hover) bg-(--gd-color-surface) text-(--gd-color-text)"
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
