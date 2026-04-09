/**
 * API 服务 Mock 实现
 * 用于开发和测试环境
 */

import type { ApiResponse } from '@/types/common'

class ApiServiceDummy {
    baseURL: string
    currentAbortController: AbortController | null
    abortControllerMap: Map<string, AbortController>

    constructor(baseURL: string = '/api/v1') {
        this.baseURL = baseURL
        this.currentAbortController = null
        this.abortControllerMap = new Map()
    }

    // ========== 模型相关 ==========
    async fetchModels(): Promise<ApiResponse<any[]>> {
        return { data: [] }
    }

    async fetchRemoteModels(providerId: string): Promise<ApiResponse<any>> {
        return { data: { items: [], size: 0 } }
    }

    // ========== 角色相关 ==========
    async fetchCharacters(type: 'private' | 'public' = 'private'): Promise<ApiResponse<any>> {
        return { data: { items: [], total: 0, page: 1, page_size: 20 } }
    }

    async fetchCharacter(characterId: string): Promise<ApiResponse<any>> {
        return { data: null }
    }

    async createCharacter(characterData: any): Promise<ApiResponse<any>> {
        return { data: characterData }
    }

    async updateCharacter(characterId: string, characterData: any): Promise<ApiResponse<any>> {
        return { data: characterData }
    }

    async deleteCharacter(characterId: string): Promise<ApiResponse<{ success: boolean }>> {
        return { data: { success: true } }
    }

    // ========== 会话相关 ==========
    async createSession(data: any): Promise<ApiResponse<any>> {
        return { data: data }
    }

    async deleteSession(sessionId: string): Promise<ApiResponse<{ success: boolean }>> {
        return { data: { success: true } }
    }

    async fetchSession(sessionId: string): Promise<ApiResponse<any>> {
        return { data: null }
    }

    async fetchSessions(): Promise<ApiResponse<any[]>> {
        return { data: [] }
    }

    async fetchSessionMessages(sessionId: string): Promise<ApiResponse<any>> {
        return { data: { items: [], total: 0 } }
    }

    async importMessages(sessionId: string, messages: any[]): Promise<ApiResponse<any>> {
        return { data: messages }
    }

    async createMessage(
        sessionId: string,
        content: string,
        files: any[] = [],
        replaceMessageId: string | null = null,
        knowledgeBaseIds?: string[]
    ): Promise<ApiResponse<any>> {
        return {
            data: {
                id: 'mock-id',
                role: 'user',
                content,
                files
            }
        }
    }

    async fetchTokenStatistics(sessionId: string): Promise<ApiResponse<any>> {
        return { data: {} }
    }

    // ========== 流式聊天 ==========
    async *chat(
        sessionId: string,
        messageId: string,
        regenerationMode: string | null = null,
        assistantMessageId: string | null = null,
        enableReasoning: boolean = false
    ): AsyncGenerator<any, void, unknown> {
        // Mock 空响应
        yield { type: 'finish' }
    }

    async cancelResponse(sessionId: string): Promise<void> {
        const abortController = this.abortControllerMap.get(sessionId)
        if (abortController) {
            abortController.abort()
        }
    }

    // ========== 文件上传 ==========
    async uploadAvatar(uid: string, avatarFile: File, type: 'character' | 'session' = 'character'): Promise<ApiResponse<any>> {
        return { data: [] }
    }

    async uploadUserAvatar(avatarFile: File): Promise<ApiResponse<any>> {
        return { data: [] }
    }

    async uploadFile(sessionId: string, file: File): Promise<ApiResponse<any>> {
        return { data: null }
    }

    async copyMessageFile(messageId: string, fileId: string): Promise<ApiResponse<any>> {
        return { data: null }
    }

    async webSearch(messageId: string): Promise<ApiResponse<any>> {
        return { data: null }
    }

    // ========== 消息管理 ==========
    async deleteMessage(messageId: string): Promise<ApiResponse<{ success: boolean }>> {
        return { data: { success: true } }
    }

    async updateMessage(messageId: string, data: any): Promise<ApiResponse<any>> {
        return { data }
    }

    async setMessageCurrentContent(messageId: string, contentId: string): Promise<ApiResponse<any>> {
        return { data: null }
    }

    async clearSessionMessages(sessionId: string): Promise<ApiResponse<boolean>> {
        return { data: true }
    }

    async updateSession(sessionId: string, data: any): Promise<ApiResponse<any>> {
        return { data }
    }

    async generateSessionTitle(sessionId: string): Promise<ApiResponse<any>> {
        return { data: { title: '新会话' } }
    }

    // ========== 请求控制 ==========
    abortCurrentRequest(): void {
        if (this.currentAbortController) {
            this.currentAbortController.abort()
            this.currentAbortController = null
        }
    }

    debounce<T extends (...args: any[]) => any>(func: T, delay: number): T {
        let timer: number | undefined
        return function (this: any, ...args: Parameters<T>) {
            clearTimeout(timer)
            timer = window.setTimeout(() => {
                func.apply(this, args)
            }, delay)
        } as T
    }

    // ========== 模型管理 ==========
    async createModel(data: any): Promise<ApiResponse<any>> {
        return { data }
    }

    async deleteModel(modelId: string): Promise<ApiResponse<boolean>> {
        return { data: true }
    }

    async updateModel(modelId: string, data: any): Promise<ApiResponse<any>> {
        return { data }
    }

    // ========== 提供商管理 ==========
    async createProvider(data: any): Promise<ApiResponse<any>> {
        return { data }
    }

    async deleteProvider(providerId: string): Promise<ApiResponse<boolean>> {
        return { data: true }
    }

    async updateProvider(providerId: string, data: any): Promise<ApiResponse<any>> {
        return { data }
    }

    // ========== 设置管理 ==========
    async fetchSettings(): Promise<ApiResponse<any>> {
        return { data: {} }
    }

    async updateSettings(data: any): Promise<ApiResponse<any>> {
        return { data }
    }

    // ========== 认证相关 ==========
    async login(credentials: any): Promise<ApiResponse<any>> {
        return {
            data: {
                accessToken: 'mock-token',
                user: { id: 'mock-id', username: credentials.username }
            }
        }
    }

    async getProfile(): Promise<ApiResponse<any>> {
        return { data: { id: 'mock-id', username: 'mock-user' } }
    }

    async updateProfile(data: any): Promise<ApiResponse<any>> {
        return { data }
    }

    async changePassword(oldPassword: string, newPassword: string): Promise<ApiResponse<any>> {
        return { data: null }
    }

    async createSubaccount(data: any): Promise<ApiResponse<any>> {
        return { data }
    }

    async updateSubaccount(subaccountId: string, data: any): Promise<ApiResponse<any>> {
        return { data }
    }

    async deleteSubaccount(subaccountId: string): Promise<ApiResponse<boolean>> {
        return { data: true }
    }

    async fetchSubaccounts(): Promise<ApiResponse<any[]>> {
        return { data: [] }
    }

    async checkResetPassword(): Promise<ApiResponse<any>> {
        return { data: null }
    }

    async resetPrimayPassword(data: any): Promise<ApiResponse<any>> {
        return { data }
    }

    // ========== MCP 服务器管理 ==========
    async fetchMcpServers(): Promise<ApiResponse<any>> {
        return { data: { items: [], total: 0 } }
    }

    async fetchMcpServer(serverId: string): Promise<ApiResponse<any>> {
        return { data: null }
    }

    async fetchMcpServerById(serverId: string): Promise<ApiResponse<any>> {
        return this.fetchMcpServer(serverId)
    }

    async createMcpServer(serverData: any): Promise<ApiResponse<any>> {
        return { data: serverData }
    }

    async updateMcpServer(serverId: string, serverData: any): Promise<ApiResponse<any>> {
        return { data: serverData }
    }

    async deleteMcpServer(serverId: string): Promise<ApiResponse<boolean>> {
        return { data: true }
    }

    async toggleMcpServer(serverId: string, enabled: boolean): Promise<ApiResponse<any>> {
        return { data: { enabled } }
    }

    async refreshMcpTools(serverId: string): Promise<ApiResponse<any>> {
        return { data: null }
    }

    async getMcpServers(): Promise<ApiResponse<any>> {
        return this.fetchMcpServers()
    }
}

// 创建默认实例并导出
export const apiServiceDummy = new ApiServiceDummy('/api/v1')
