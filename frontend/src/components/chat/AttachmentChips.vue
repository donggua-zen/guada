<template>
  <div v-if="chips.length > 0" class="w-full flex items-center gap-1.5 mb-1 flex-wrap px-5">
    <div
      v-for="chip in chips"
      :key="`${chip.typeId}-${chip.id}`"
      class="attachment-chip group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs transition-colors"
    >
      <span class="truncate max-w-24 text-gray-700 dark:text-[#c5c7cc]">{{ chip.name }}</span>
      <span v-if="chip.subtitle" class="opacity-50 text-[10px] text-gray-500 dark:text-[#8b8d95]">{{ chip.subtitle }}</span>
      <button
        class="ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-red-500 leading-none"
        @click.stop="$emit('remove', chip.typeId, chip.id)"
        :aria-label="`remove ${chip.name}`"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
          stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
export interface AttachmentChip {
  typeId: string
  id: string
  name: string
  subtitle?: string
}

const props = defineProps<{
  chips: AttachmentChip[]
}>()

defineEmits<{
  remove: [typeId: string, id: string]
}>()
</script>

<style scoped>
.attachment-chip {
  background: var(--color-secondary-surface);
  backdrop-filter: blur(20px) saturate(1.5);
  -webkit-backdrop-filter: blur(20px) saturate(1.5);
  border: 1px solid rgba(0, 0, 0, 0.06);
  cursor: default;
}

.dark .attachment-chip {
  background: rgba(42, 42, 42, 0.8);
  border-color: rgba(255, 255, 255, 0.08);
}

.attachment-chip:hover {
  background: rgba(229, 231, 235, 1);
}

.dark .attachment-chip:hover {
  background: rgba(58, 58, 62, 0.9);
}
</style>
