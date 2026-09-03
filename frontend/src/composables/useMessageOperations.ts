import { computed, nextTick, ref, watch, type Ref } from 'vue'
import { useSessionStore } from '@/stores/session'
import { t } from '@/locales'
import type { InputMessageState } from '@/types/session'
import { normalizeMediaType } from '@/utils/media-type'
import { toUserMessageView, collectReferencedKbs } from '@/utils/messageUtils'

/**
 * 把前端附件对象（上传响应 FileRef / 投影 FileAttachment / ChatFile 混合形态）
 * 统一映射为发送 payload 的 FileRef 契约对象（self-contained 元数据，不再降维成 id）。
 * 无存储锚点（url）的对象不进入 payload。
 */
export function toPayloadFileRefs(files: any[]): any[] {
    return (files ?? [])
        .filter((f: any) => (f.mediaType || f.type) && f.url)
        .map((f: any) => {
            const ext = f.fileExtension || f.ext
            return {
                mediaType: normalizeMediaType(f.mediaType ?? f.type, ext),
                bytes: f.bytes ?? f.size ?? 0,
                name: f.name ?? f.displayName ?? f.fileName,
                url: f.url,
                ...(f.previewUrl ? { previewUrl: f.previewUrl } : {}),
                ...(ext ? { fileExtension: ext } : {}),
            }
        })
}

export function useMessageOperations(
    sessionStore: ReturnType<typeof useSessionStore>,
    apiService: any,
    currentSessionId: Ref<string | null>
) {
    // editMode 移到内部统一管理
    // turnId:被编辑消息所属的回合外壳 id,进入编辑模式时直接定位,
    // 由 handleSendMessage 直接使用(不再反查)。
    const editMode = ref<{ message: any; turnId?: string; inputMessage: InputMessageState } | null>(null)

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
        replaceTurnId: string | null = null,
        knowledgeBaseIds?: string[]
    ): Promise<{
        content: string;
        files: any[];
        replaceTurnId: string | null;
        knowledgeBaseIds?: string[];
    }> {
        if (!currentSessionId.value) {
            throw new Error(t('chat.message.noActiveSession'))
        }

        // 分离三类文件：已上传的、需上传的、Electron本地路径引用的
        const uploadedFiles = files.filter(file => file.id && typeof file.id === 'string' && file.id.length > 10)
        const localPathFiles = files.filter(file => file.localPath && !file.file)
        const filesWithContent = files.filter(file => file.file && !uploadedFiles.includes(file) && !localPathFiles.includes(file))

        // 串行上传未上传的文件，确保 createdAt 顺序与用户选择顺序一致
        const uploadResults = []
        for (const file of filesWithContent) {
            const result = await apiService.uploadFile(currentSessionId.value, file.file)
            uploadResults.push(result)
        }

        const updatedFiles = [...files]

        // 更新新上传的文件信息（上传响应即 FileRef 形状，原样透传）
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

        // 发送 payload：FileRef 对象数组（self-contained 元数据，不再降维成 id）。
        // 来源有二：上传响应（mediaType/bytes 原生 FileRef）与编辑重发的投影对象
        // （type/size/ext），统一映射为 FileRef 契约；Electron 本地路径引用
        // （无存储 url）不进入 payload，路径已拼进消息文本。
        const payloadFiles = toPayloadFileRefs(updatedFiles)

        // Electron 本地路径文件：拼接路径到消息内容
        let finalContent = text
        if (localPathFiles.length > 0) {
            const pathLines = localPathFiles.map(f => `\n\n[文件: ${f.fileName}]\n路径: ${f.localPath}`)
            finalContent = text + pathLines.join('')
        }

        // 清空输入框
        inputMessage.value = { content: "", files: [], knowledgeBaseIds: undefined, isWaiting: false };

        return {
            content: finalContent,
            files: payloadFiles,
            replaceTurnId,
            knowledgeBaseIds,
        }
    }

    /**
     * 进入编辑模式
     * 入参可能是用户消息束（bundle，块级内容分散）或旧块形态——统一经
     * toUserMessageView 聚合为带 content/files 的视图再消费。
     */
    function enterEditMode(message: any, turnId: string) {
        const view = toUserMessageView(message) ?? message
        // KB 回填：kb-ref 块明细优先（toUserMessageView 保留的 blocks 仍带 kbRefs），
        // 历史数据回退 metadata（归一化见 collectReferencedKbs）
        const knowledgeBaseIds = collectReferencedKbs(view).map((kb) => kb.id)

        const inputMsg = {
            content: view.content,
            files: view.files || [],
            knowledgeBaseIds: knowledgeBaseIds,
            isWaiting: false
        }

        // turnId 由调用方经渲染链路直接传入(整轮 turn 携带),此处零反查。
        editMode.value = {
            message: view,
            turnId: turnId,
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
