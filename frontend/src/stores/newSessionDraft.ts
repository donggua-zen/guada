// stores/newSessionDraft.ts
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { ChatFileView } from '@/types/session'

/**
 * 新建页工具栏配置快照：面板 DraftSession 的可恢复子集
 * （title 为派生值、avatar_url 恒为 null，不入快照）
 */
export interface NewSessionDraftConfig {
    agentId: string | null
    modelId: string | null
    workspacePath: string | null
    groupId: string | null
    settings: {
        referencedKbs?: string[]
        modelName?: string | null
        thinkingEffort?: string | null
        sandboxMode?: string
        planEnabled?: boolean
        maxTokensLimit?: number | null
        attachments?: Record<string, string[]>
    }
}

/** 已提交、等待会话创建结果的载荷（创建失败时原样还回输入框） */
interface SubmittedDraft {
    content: string
    files: ChatFileView[]
}

/**
 * 新建会话页草稿 Store
 *
 * 新建页整体由 ChatPage 的 v-if 分支承载，切到会话/其他页面即整体卸载，
 * 组件本地状态随之丢失。草稿因此上提到本 store（与已有会话的
 * sessionStore.inputMessage 同构），切换回来时恢复文字/附件/工具栏配置。
 *
 * 生命周期：仅应用运行期内存态（刷新/重启清空）；会话创建成功即清空。
 */
export const useNewSessionDraftStore = defineStore('newSessionDraft', () => {
    /** 输入框正文（含 [/command] 标记的纯文本形态） */
    const content = ref('')
    /** 已选附件（含尚未上传、只带原始 File 的新选项） */
    const files = ref<ChatFileView[]>([])
    /** 工具栏配置快照；null = 快照尚未写入（面板用默认值初始化） */
    const config = ref<NewSessionDraftConfig | null>(null)
    /** 提交快照：ChatInput 发送后会清空编辑器，此处保留一份以便失败回填 */
    const submitted = ref<SubmittedDraft | null>(null)

    /** 是否有可恢复的草稿内容（配置快照单独由 config 判断） */
    const hasDraft = computed(() => content.value.trim().length > 0 || files.value.length > 0)

    /** 记录工具栏配置快照（浅拷贝一层 settings，避免后续面板改配置串改快照） */
    function saveConfig(next: NewSessionDraftConfig): void {
        config.value = { ...next, settings: { ...next.settings } }
    }

    /** 发送前记录提交载荷（须早于 ChatInput 自清空编辑器与附件列表） */
    function markSubmitted(payload: { content?: string; files?: ChatFileView[] }): void {
        submitted.value = { content: payload.content ?? '', files: [...(payload.files ?? [])] }
    }

    /**
     * 把提交载荷还回输入框（创建失败/未登录时调用）。
     * files 赋一份新数组：原数组可能已经随 inputMessage 交给新会话缓存，不能共享引用。
     * @returns 是否有可回填的内容
     */
    function restoreSubmitted(): boolean {
        if (!submitted.value) return false
        content.value = submitted.value.content
        files.value = [...submitted.value.files]
        submitted.value = null
        return true
    }

    /**
     * 清空草稿（会话创建成功时调用：内容已转移给新会话，
     * 再次进入新建页应为空白而不是已发出去的旧文字）。
     * 一律重新赋值而不是就地清空数组——files 可能与新会话草稿共享实例。
     */
    function clear(): void {
        content.value = ''
        files.value = []
        config.value = null
        submitted.value = null
    }

    return { content, files, config, submitted, hasDraft, saveConfig, markSubmitted, restoreSubmitted, clear }
})
