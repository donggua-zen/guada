<template>
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"
    fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true" focusable="false" :class="{ 'is-active': active }">
    <path d="M8 3.25C6.75.5 3 1.5 3.25 4a2.5 2.5 0 0 0-1 4.25 2.5 2.5 0 0 0 1.5 4.25C4 15 7 15 8 12.75M8 3.25C9.25.5 13 1.5 12.75 4a2.5 2.5 0 0 1 1 4.25 2.5 2.5 0 0 1-1.5 4.25C12 15 9 15 8 12.75M8 3.25v9.5" />
    <path d="M4.25 5.25 6 6v2M4 10.5h2M11.75 5.25 10 6v2M12 10.5h-2" />
    <circle class="thinking-node" cx="8" cy="8" r=".85" fill="currentColor" stroke="none" />
  </svg>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ active?: boolean }>(), { active: false });
</script>

<style scoped>
.is-active .thinking-node {
  animation: thinking-node-pulse 2s ease-in-out infinite;
}

@keyframes thinking-node-pulse {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .is-active .thinking-node {
    animation: none;
  }
}
</style>
