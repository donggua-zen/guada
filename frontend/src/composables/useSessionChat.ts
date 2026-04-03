import { ref, type Ref } from 'vue'
import { useSessionStore } from '@/stores/session'
import type { Session } from '@/types/session'

export function useSessionChat(
    sessionStore: ReturnType<typeof useSessionStore>,
    apiService: any
) {
    const currentSessionId = ref<string | null>(null)
    const isLoading = ref(false)
    const hasGeneratedTitle = ref(false)

    /**
     * 加载会话配置和消息
     */
    async function loadSession(sessionId: string): Promise<Session> {
        const sessionData = await apiService.fetchSession(sessionId)
        await loadMessages(sessionId)
        return sessionData
    }

    /**
     * 加载会话消息
     */
    async function loadMessages(sessionId: string) {
        if (sessionStore.getMessages(sessionId).length === 0) {
            const sessionMessages = await apiService.fetchSessionMessages(sessionId)

            // 处理历史消息的思考时长回填
            sessionMessages.items.forEach((message: { contents: any[] }) => {
                if (message.contents && Array.isArray(message.contents)) {
                    message.contents.forEach(content => {
                        if (content.meta_data?.thinking_duration_ms) {
                            content.thinking_duration_ms = content.meta_data.thinking_duration_ms
                        }
                        if (!content.state) {
                            content.state = { is_streaming: false, is_thinking: false }
                        }
                    })
                }
            })

            sessionStore.setMessages(sessionId, sessionMessages.items)
        }
    }

    /**
     * 重置标题生成标记
     */
    function resetTitleFlag() {
        hasGeneratedTitle.value = false
    }

    /**
     * 检查是否需要生成标题
     */
    async function generateTitleIfNeeded(
        sessionId: string,
        messages: any[],
        currentSession: Ref<Session | null>
    ) {
        if (messages.length === 2 && !hasGeneratedTitle.value) {
            hasGeneratedTitle.value = true

            try {
                const result = await apiService.generateSessionTitle(sessionId)
                if (!result.skipped && result.title && currentSession.value) {
                    currentSession.value.title = result.title
                    sessionStore.updateSessionTitle(sessionId, result.title)
                }
            } catch (error) {
                console.error('生成会话标题失败:', error)
            }
        }
    }

    return {
        currentSessionId,
        isLoading,
        hasGeneratedTitle,
        loadSession,
        loadMessages,
        resetTitleFlag,
        generateTitleIfNeeded
    }
}
