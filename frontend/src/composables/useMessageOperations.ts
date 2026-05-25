import { computed, nextTick, ref, watch, type Ref } from 'vue'
import { useSessionStore } from '@/stores/session'
import type { InputMessageState } from '@/types/session'

export function useMessageOperations(
    sessionStore: ReturnType<typeof useSessionStore>,
    apiService: any,
    currentSessionId: Ref<string | null>
) {
    // editMode 移到内部统一管理
    const editMode = ref<{ message: any; inputMessage: InputMessageState } | null>(null)

    // 监听 sessionId 变化，自动退出编辑模式
    watch(currentSessionId, (newId, oldId) => {
        if (newId !== oldId && editMode.value) {
            exitEditMode()
        }
    })
    /**
     * 智能 inputMessage：根据 editMode 状态自动切换数据源
     */
    const inputMessage = computed({
        get: () => {
            // 编辑模式下优先返回 editMode 中的数据
            if (editMode.value?.inputMessage) {
                return editMode.value.inputMessage
            }
            // 非编辑模式或 editMode 未初始化时从 store 获取
            if (!currentSessionId.value) {
                return { content: '', files: [], knowledgeBaseIds: [], isWaiting: false }
            }
            return sessionStore.getInputMessage(currentSessionId.value)
        },
        set: (value: InputMessageState) => {
            // 编辑模式下更新 editMode，否则更新 store
            if (editMode.value) {
                editMode.value.inputMessage = value
            } else if (currentSessionId.value) {
                sessionStore.setInputMessage(currentSessionId.value, value)
            }
        }
    })

    /**
     * 退出编辑模式
     */
    function exitEditMode() {
        editMode.value = null
        // 退出编辑模式后不清空输入框
        // inputMessage.value = { content: '', files: [], knowledgeBaseIds: [], isWaiting: false }
    }

    /**
     * 准备新消息数据（返回给外部用于流式请求）
     *
     * 不再直接调用 apiService.createMessage，而是返回消息创建参数，
     * 由外部在发起流式请求时一并传给后端，实现原子性。
     */
    async function prepareNewMessage(
        text: string,
        files: any[],
        replaceMessageId: string | null = null,
        knowledgeBaseIds?: string[]
    ): Promise<{
        content: string;
        fileIds: string[];
        replaceMessageId: string | null;
        knowledgeBaseIds?: string[];
        updatedFiles: any[];
    }> {
        if (!currentSessionId.value) {
            throw new Error('当前没有活动的会话')
        }

        // 分离已上传的文件和未上传的文件
        const uploadedFiles = files.filter(file => file.id && typeof file.id === 'string' && file.id.length > 10)
        const filesWithContent = files.filter(file => file.file && !uploadedFiles.includes(file))

        // 只上传还未上传的文件
        const uploadPromises = filesWithContent.map((file) =>
            apiService.uploadFile(currentSessionId.value, file.file)
        )
        const uploadResults = await Promise.all(uploadPromises)

        const updatedFiles = [...files]

        // 更新新上传的文件信息
        uploadResults.forEach((response, index) => {
            const fileIndex = files.indexOf(filesWithContent[index])
            if (fileIndex !== -1) {
                updatedFiles[fileIndex] = { ...updatedFiles[fileIndex], ...response }
                delete updatedFiles[fileIndex].file
                delete updatedFiles[fileIndex].content
                delete updatedFiles[fileIndex].uploadProgress
                delete updatedFiles[fileIndex].uploadStatus
            }
        })

        // 清理已上传文件的临时字段
        uploadedFiles.forEach(file => {
            const fileIndex = files.indexOf(file)
            if (fileIndex !== -1) {
                updatedFiles[fileIndex] = { ...updatedFiles[fileIndex] }
                delete updatedFiles[fileIndex].file
                delete updatedFiles[fileIndex].uploadProgress
                delete updatedFiles[fileIndex].uploadStatus
            }
        })

        const fileIds = [
            ...uploadedFiles.map(f => f.id),
            ...uploadResults.map((result) => result.id)
        ]

        // 清空输入框
        inputMessage.value = { content: "", files: [], knowledgeBaseIds: undefined, isWaiting: false };

        return {
            content: text,
            fileIds,
            replaceMessageId,
            knowledgeBaseIds,
            updatedFiles,
        }
    }

    /**
     * 进入编辑模式
     */
    function enterEditMode(message: any) {
        let knowledgeBaseIds = []
        const referencedKbs = message.contents[0].metadata?.referencedKbs || []
        for (let i = 0; i < referencedKbs.length; i++) {
            knowledgeBaseIds.push(referencedKbs[i].id)
        }

        const inputMsg = {
            content: message.contents[0].content,
            files: message.files || [],
            knowledgeBaseIds: knowledgeBaseIds,
            isWaiting: false
        }

        editMode.value = {
            message: message,
            inputMessage: inputMsg
        }

        inputMessage.value = inputMsg
    }

    return {
        // 暴露 editMode 给外部使用
        editMode,
        inputMessage,
        exitEditMode,
        prepareNewMessage,
        enterEditMode
    }
}
