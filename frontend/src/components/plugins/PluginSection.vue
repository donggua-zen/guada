<template>
    <section class="mb-6">
        <h2 class="mb-2 text-sm font-semibold text-gray-900 dark:text-[#e8e9ed]">{{ title }}</h2>
        <div v-show="expanded" class="-mx-2 grid grid-cols-1 gap-x-6 gap-y-3 lg:grid-cols-2">
            <slot />
        </div>
        <button
            v-if="collapsible"
            type="button"
            class="-ml-2 mt-1 rounded px-2 text-xs text-gray-400 transition-colors hover:bg-(--gd-color-surface-subtle-hover) hover:text-gray-600 dark:hover:text-gray-300"
            @click="expanded = !expanded"
        >
            {{ expanded ? t('common.collapse') : t('common.expand') }}
        </button>
    </section>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

withDefaults(defineProps<{
    title: string
    collapsible?: boolean
}>(), {
    collapsible: true,
})

const { t } = useI18n()
const expanded = ref(true)
</script>
