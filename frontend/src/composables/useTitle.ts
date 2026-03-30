// composables/useTitle.ts
import { ref, watch, type Ref } from 'vue'

/**
 * 页面标题管理 Composable
 * @param newTitle - 新标题，null 表示使用当前文档标题
 * @returns 响应式标题引用
 */
export function useTitle(newTitle: string | null = null): Ref<string> {
    const title = ref<string>(newTitle || document.title)

    watch(
        title,
        (newVal) => {
            if (newVal) {
                document.title = newVal
            }
        },
        { immediate: true }
    )

    return title
}
