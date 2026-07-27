import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * 工作区预览请求 Store
 *
 * 仅用于文件预览请求（文件加载逻辑在 WorkspaceSidebar 内部，需通过 store 传递）。
 * URL 预览由 utils/workspacePreview.ts 直接完成，不经过此 store。
 */
export const useWorkspacePreviewStore = defineStore('workspacePreview', () => {
    /** 当前待处理的文件预览请求（null = 无待处理） */
    const pendingFile = ref<string | null>(null)

    /** 请求预览工作区文件 */
    function requestFile(filePath: string): void {
        pendingFile.value = filePath
    }

    /** 消费请求（WorkspaceSidebar 处理后调用） */
    function consumeFile(): void {
        pendingFile.value = null
    }

    return { pendingFile, requestFile, consumeFile }
})
