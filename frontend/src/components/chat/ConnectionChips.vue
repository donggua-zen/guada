<template>
  <div v-if="connections.length > 0" class="w-full flex items-center gap-1.5 mb-1">
    <div
      v-for="conn in connections"
      :key="conn.id"
      class="connection-chip group inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-colors"
      :style="chipStyle(conn.name)"
    >
      <span class="truncate max-w-24">{{ conn.name }}</span>
      <span class="opacity-60 text-[10px]">{{ conn.config?.host }}</span>
      <button
        class="ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity hover:text-red-500"
        @click.stop="$emit('remove', conn.id)"
      >
        ✕
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

export interface ConnectionChip {
  id: string
  name: string
  scheme: string
  config: Record<string, any>
}

const props = defineProps<{
  connections: ConnectionChip[]
}>()

defineEmits<{
  remove: [id: string]
}>()

function chipStyle(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return {
    backgroundColor: `hsl(${h}, 55%, 90%)`,
    color: `hsl(${h}, 50%, 35%)`,
  }
}
</script>

<style scoped>
.connection-chip {
  border: 1px solid transparent;
  cursor: default;
}
</style>
