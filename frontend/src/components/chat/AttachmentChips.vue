<template>
  <div v-if="chips.length > 0" class="w-full flex items-center gap-1.5 mb-1 flex-wrap">
    <div
      v-for="chip in chips"
      :key="`${chip.typeId}-${chip.id}`"
      class="attachment-chip group inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-colors"
      :style="chipStyle(chip.typeId)"
    >
      <span class="truncate max-w-24">{{ chip.name }}</span>
      <span class="opacity-60 text-[10px]">{{ chip.subtitle }}</span>
      <button
        class="ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity hover:text-red-500"
        @click.stop="$emit('remove', chip.typeId, chip.id)"
      >
        ✕
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

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

function chipStyle(typeId: string) {
  let h = 0
  for (let i = 0; i < typeId.length; i++) h = (h * 31 + typeId.charCodeAt(i)) % 360
  return {
    backgroundColor: `hsl(${h}, 55%, 90%)`,
    color: `hsl(${h}, 50%, 35%)`,
  }
}
</script>

<style scoped>
.attachment-chip {
  border: 1px solid transparent;
  cursor: default;
}
</style>
