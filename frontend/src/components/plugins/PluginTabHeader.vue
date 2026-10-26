<template>
    <div class="flex items-center justify-between gap-4 mb-6 mt-2">
        <div class="min-w-0">
            <h1 class="text-xl font-bold text-gray-900 dark:text-[#e8e9ed]">{{ title }}</h1>
            <p v-if="subtitle" class="text-sm text-gray-500 dark:text-[#8b8d95] mt-1">{{ subtitle }}</p>
        </div>
        <div class="flex items-center gap-2 shrink-0">
            <slot name="actions" />
        </div>
    </div>
</template>

<script setup lang="ts">
defineProps<{
    title: string
    subtitle?: string
}>()
</script>
