import { computed, ref, watch, type Ref } from 'vue'
import { useSessionStore } from '@/stores/session'
import { t } from '@/locales'
import type { InputMessageState } from '@/types/session'
import { normalizeMediaType } from '@/utils/media-type'
import { toUserMessageView, collectReferencedKbs } from '@/utils/messageUtils'

/**
 * 单个附件对象 → 发送 payload 的 FileRef 契约对象；不可用时返回 null。
 *
 * 入参是三种前端形态的混合体，按「有没有引用锚点」分派：
 * - 上传响应 / 编辑回填的投影：有 url（+ refType），原样透传
 * - Electron 非图片附件：有 localPath 无 url → refType='local'，本机绝对路径
 * - 新选未上传的：两者都没有 → null（调用方先上传）
 *
 * refType 缺省按引用来源推断：带 localPath 的是本机路径，其余按 store 解释
 * ——历史数据（编辑重发）没有 refType，其 url 是 uploads/... 存储引用，store 语义正确；
 * 'workspace' 引用一定由上传响应带回来，不会走到缺省分支。
 */
export function toPayloadFileRef(f: any): any | null {
    const ext = f.fileExtension || f.ext
    const localPath = typeof f.localPath === 'string' && f.localPath ? f.localPath : undefined
    const url = f.url || localPath
    if (!url) return null

    const name = f.name ?? f.fileName ?? f.displayName
    return {
        mediaType: normalizeMediaType(f.mediaType ?? f.type, ext),
        bytes: f.bytes ?? f.fileSize ?? f.size ?? 0,
        ...(name ? { name } : {}),
        url,
        ...(f.previewUrl ? { previewUrl: f.previewUrl } : {}),
        ...(ext ? { fileExtension: ext } : {}),
        refType: f.refType || (localPath && !f.url ? 'local' : 'store'),
    }
}

/**
 * 把前端附件对象数组统一映射为发送 payload 的 FileRef 契约对象。
 * 无引用锚点（既未上传、也无本机路径）的对象不进入 payload。
 */
export function toPayloadFileRefs(files: any[]): any[] {
    const refs: any[] = []
    for (const f of files ?? []) {
        const ref = toPayloadFileRef(f)
        if (ref) refs.push(ref)
    }
    return refs
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

        const payloadFiles: any[] = []

        // 串行上传未上传的文件，确保服务端 createdAt 顺序与用户选择顺序一致。
        // 已带引用锚点的（上传响应 / 编辑回填 / Electron 本机路径）直接透传，不再上传。
        for (const file of files ?? []) {
            const existing = toPayloadFileRef(file)
            if (existing) {
                payloadFiles.push(existing)
                continue
            }
            if (!file?.file) {
                // 既无引用锚点也无原始 File：无法还原这个附件（如持久化后丢失 File 的历史残留）。
                // 明确丢弃并告警——旧实现把 Electron 路径拼进消息正文，等于把附件混进用户的话里。
                console.warn('[prepareNewMessage] 跳过无法解析的附件：', file)
                continue
            }
            const response = await apiService.uploadFile(currentSessionId.value, file.file)
            const ref = toPayloadFileRef({ ...file, ...response })
            if (ref) payloadFiles.push(ref)
        }

        // 清空输入框
        inputMessage.value = { content: "", files: [], knowledgeBaseIds: undefined, isWaiting: false };

        return {
            content: text,
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
