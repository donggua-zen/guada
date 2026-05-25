<template>
  <div class="dropdown-menu-item" :class="{ 'is-disabled': disabled }" @click="handleClick">
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

<style scoped>
@reference "tailwindcss";

.dropdown-menu-item {
  @apply px-4 py-2 text-sm cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center text-gray-700 dark:text-gray-200;
}

.dropdown-menu-item.is-disabled {
  @apply opacity-50 cursor-not-allowed;
}
</style>
