// composables/useTitle.js
import { ref, watch } from 'vue';

export function useTitle(newTitle = null) {
    const title = ref(newTitle || document.title);

    watch(title, (newVal) => {
        if (newVal) {
            document.title = newVal;
        }
    }, { immediate: true });

    return title;
}