/**
 * API 客户端服务
 * 提供完整的后端 API 接口调用
 */

import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from 'axios'
import { useStorage } from '@vueuse/core'
import { apiServiceDummy } from './ApiServiceDummy'
import type {
    IApiService,
    StreamEvent,
    LoginRequest,
    LoginResponse,
    User,
    ResetPasswordCheckResponse,
    ResetPasswordRequest,
    RegisterRequest,
    Subaccount,
    GlobalSettings,
    UploadResponse
} from '@/types/service'
import type { Model, McpServer } from '@/types/api'
import type { Character, CharacterListResponse } from '@/types/character'
import type { Session, SessionListResponse } from '@/types/session'
import type { Message } from '@/types/message'
import type { PaginatedResponse } from '@/types/common'
import type { KnowledgeBase, KBFile } from '@/stores/knowledgeBase'

class ApiService implements IApiService {
    baseURL: string
    tokenStore: any
    dummy: typeof apiServiceDummy
    axiosInstance: AxiosInstance
    currentAbortController: AbortController | null
    abortControllerMap: Map<string, AbortController>

    constructor(baseURL: string = '/api/v1') {
        this.baseURL = baseURL
        this.tokenStore = useStorage('token', '')
        this.dummy = apiServiceDummy

        // 创建 Axios 实例
        this.axiosInstance = axios.create({
            baseURL: this.baseURL,
            headers: {
                'Content-Type': 'application/json',
            },
        })

        // 添加响应拦截器处理通用错误
        this.axiosInstance.interceptors.response.use(
            (response: AxiosResponse) => {
                return response.data ? response.data : response
            },
            (error) => {
                console.error('API 请求失败:', error)
                if (error.status === 401) {
                    window.location.href = '/login'
                    return Promise.reject(error)
                }
                if (error.response?.data?.error) {
                    throw new Error(error.response.data.error || '请求失败')
                }
                return Promise.reject(error)
            }
        )

        // 添加请求拦截器动态设置 token
        this.axiosInstance.interceptors.request.use(
            (config) => {
                const token = this.tokenStore.value
                if (token) {
                    config.headers.Authorization = `Bearer ${token}`
                }
                return config
            },
            (error) => {
                return Promise.reject(error)
            }
        )

        this.currentAbortController = null
        this.abortControllerMap = new Map()
    }

    /**
     * 通用请求方法
     */
    async _request<T = any>(endpoint: string, options?: AxiosRequestConfig): Promise<T> {
        try {
            const response = await this.axiosInstance({
                url: endpoint,
                ...options,
            })
            // 响应拦截器已经返回了 response.data，这里直接返回 response
            return response as T
        } catch (error) {
            console.error(`API 请求失败：${endpoint}`, error)
            throw error
        }
    }

    // ========== 模型管理 ==========
    async fetchModels(): Promise<PaginatedResponse<Model>> {
        return await this._request('/models')
    }

    async fetchRemoteModels(provider_id: string): Promise<Model[]> {
        return await this._request(`/providers/${provider_id}/remote_models`)
    }

    async createModel(data: any): Promise<Model> {
        return await this._request('/models', { method: 'POST', data })
    }

    async updateModel(modelId: string, data: any): Promise<Model> {
        return await this._request(`/models/${modelId}`, { method: 'PUT', data })
    }

    async deleteModel(modelId: string): Promise<boolean> {
        return await this._request(`/models/${modelId}`, { method: 'DELETE' })
    }

    // ========== 提供商管理 ==========
    async createProvider(data: any): Promise<any> {
        return await this._request('/providers', { method: 'POST', data })
    }

    async deleteProvider(providerId: string): Promise<boolean> {
        return await this._request(`/providers/${providerId}`, { method: 'DELETE' })
    }

    async updateProvider(providerId: string, data: any): Promise<any> {
        return await this._request(`/providers/${providerId}`, { method: 'PUT', data })
    }

    // ========== 角色相关 ==========
    async fetchCharacters(type: 'private' | 'public' = 'private'): Promise<CharacterListResponse> {
        if (type === 'private') {
            return await this._request('/characters')
        }
        return await this._request('/shared/characters')
    }

    async fetchCharacter(characterId: string): Promise<Character> {
        return await this._request(`/characters/${characterId}`)
    }

    async createCharacter(characterData: any): Promise<Character> {
        return await this._request('/characters', { method: 'POST', data: characterData })
    }

    async updateCharacter(characterId: string, characterData: any): Promise<Character> {
        return await this._request(`/characters/${characterId}`, { method: 'PUT', data: characterData })
    }

    async deleteCharacter(characterId: string): Promise<{ success: boolean }> {
        return await this._request(`/characters/${characterId}`, { method: 'DELETE' })
    }

    // ========== 会话相关 ==========
    async createSession(data: any): Promise<Session> {
        return await this._request('/sessions', { method: 'POST', data })
    }

    async deleteSession(sessionId: string): Promise<{ success: boolean }> {
        return await this._request(`/sessions/${sessionId}`, { method: 'DELETE' })
    }

    async fetchSession(sessionId: string): Promise<Session> {
        return await this._request(`/sessions/${sessionId}`)
    }

    async fetchSessions(): Promise<SessionListResponse> {
        return await this._request('/sessions')
    }

    async fetchSessionMessages(sessionId: string): Promise<PaginatedResponse<Message>> {
        return await this._request(`/sessions/${sessionId}/messages`)
    }

    async importMessages(sessionId: string, messages: any[]): Promise<any> {
        return await this._request(`/sessions/${sessionId}/messages/import`, {
            method: 'POST',
            data: messages,
        })
    }

    async createMessage(
        sessionId: string,
        content: string,
        files: any[] = [],
        replaceMessageId: string | null = null
    ): Promise<Message> {
        return await this._request(`/sessions/${sessionId}/messages`, {
            method: 'POST',
            data: {
                content,
                files,
                replace_message_id: replaceMessageId,
            },
        })
    }

    async fetchTokenStatistics(sessionId: string): Promise<any> {
        return await this._request(`/sessions/${sessionId}/tokens`)
    }

    async clearSessionMessages(sessionId: string): Promise<boolean> {
        return await this._request(`/sessions/${sessionId}/messages/clear`, { method: 'DELETE' })
    }

    async updateSession(sessionId: string, data: any): Promise<Session> {
        return await this._request(`/sessions/${sessionId}`, { method: 'PUT', data })
    }

    async generateSessionTitle(sessionId: string): Promise<{ title: string; skipped?: boolean }> {
        return await this._request(`/sessions/${sessionId}/generate-title`, { method: 'POST' })
    }

    // ========== 消息管理 ==========
    async deleteMessage(messageId: string): Promise<{ success: boolean }> {
        return await this._request(`/messages/${messageId}`, { method: 'DELETE' })
    }

    async updateMessage(messageId: string, data: any): Promise<Message> {
        return await this._request(`/messages/${messageId}`, { method: 'PUT', data })
    }

    async setMessageCurrentContent(messageId: string, contentId: string): Promise<any> {
        return await this._request(`/messages/${messageId}/content/${contentId}`, { method: 'PUT' })
    }

    // ========== 流式聊天 ==========
    async *chat(
        sessionId: string,
        messageId: string,
        regeneration_mode: string | null = null,
        assistant_message_id: string | null = null,
        enableReasoning: boolean = false
    ): AsyncGenerator<StreamEvent, void, unknown> {
        try {
            this.cancelResponse(sessionId)
            const controller = new AbortController()
            this.abortControllerMap.set(sessionId, controller)
            const accessToken = this.tokenStore.value

            const response = await fetch(`${this.baseURL}/sessions/${sessionId}/messages/stream`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${accessToken}`,
                },
                body: JSON.stringify({
                    message_id: messageId,
                    assistant_message_id,
                    regeneration_mode,
                    stream: true,
                    enable_reasoning: enableReasoning,
                }),
                signal: controller.signal,
            })

            // 检查响应头中的 Content-Type
            const contentType = response.headers.get('Content-Type')

            if (contentType && contentType.includes('application/json')) {
                const errorData = await response.json()
                throw new Error(errorData.error || `获取响应失败：${response.status}`)
            }

            const reader = response.body!.getReader()
            const decoder = new TextDecoder('utf-8')
            let buffer = ''

            try {
                while (true) {
                    const { value, done } = await reader.read()
                    if (done) break

                    buffer += decoder.decode(value, { stream: true })

                    let boundary
                    while ((boundary = buffer.indexOf('\n')) !== -1) {
                        const line = buffer.substring(0, boundary).trim()
                        buffer = buffer.substring(boundary + 1)

                        if (line === 'data: [DONE]') return

                        if (line.startsWith('data: ')) {
                            try {
                                const json = JSON.parse(line.substring(6))
                                yield json as StreamEvent
                            } catch (e) {
                                console.error('JSON 解析失败:', e, line)
                            }
                        }
                    }
                }
            } finally {
                reader.releaseLock()
            }
        } finally {
            this.abortControllerMap.delete(sessionId)
        }
    }

    async cancelResponse(sessionId: string): Promise<void> {
        const abortController = this.abortControllerMap.get(sessionId)
        if (abortController) {
            abortController.abort()
        }
    }

    abortCurrentRequest(): void {
        if (this.currentAbortController) {
            this.currentAbortController.abort()
            this.currentAbortController = null
        }
    }

    // ========== 文件上传 ==========
    async uploadAvatar(uid: string, file: File, type: 'character' | 'session' = 'character'): Promise<UploadResponse> {
        const formData = new FormData()
        formData.append('avatar', file)

        try {
            const url = type === 'character' ? 'characters' : 'sessions'
            return await this.axiosInstance.post(`/${url}/${uid}/avatars`, formData, {
                headers: {
                    'Content-Type': 'multipart/form-data',
                },
            })
        } catch (error) {
            console.error('上传错误:', error)
            throw error
        }
    }

    async uploadUserAvatar(file: File): Promise<UploadResponse> {
        const formData = new FormData()
        formData.append('avatar', file)

        try {
            return await this.axiosInstance.post('/user/avatars', formData, {
                headers: {
                    'Content-Type': 'multipart/form-data',
                },
            })
        } catch (error) {
            console.error('上传错误:', error)
            throw error
        }
    }

    async uploadFile(sessionId: string, file: File): Promise<UploadResponse> {
        const formData = new FormData()
        formData.append('file', file)

        try {
            return await this.axiosInstance.post(`/sessions/${sessionId}/files`, formData, {
                headers: {
                    'Content-Type': 'multipart/form-data',
                },
            })
        } catch (error) {
            console.error('上传错误:', error)
            throw error
        }
    }

    async copyMessageFile(messageId: string, fileId: string): Promise<any> {
        return await this._request(`/files/${fileId}`, {
            method: 'PUT',
            data: { type: 'copy', message_id: messageId },
        })
    }

    async webSearch(messageId: string): Promise<any> {
        return await this._request(`/messages/${messageId}/web_serach`, { method: 'GET' })
    }

    // ========== 认证相关 ==========
    async login(credentials: LoginRequest): Promise<LoginResponse> {
        return await this._request('/auth/login', { method: 'POST', data: credentials })
    }

    async register(data: RegisterRequest): Promise<LoginResponse> {
        return await this._request('/auth/register', { method: 'POST', data })
    }

    async getProfile(): Promise<User> {
        return await this._request('/user/profile')
    }

    async updateProfile(data: any): Promise<User> {
        return await this._request('/user/profile', { method: 'PUT', data })
    }

    async changePassword(oldPassword: string, newPassword: string): Promise<any> {
        return await this._request('/user/password/change', {
            method: 'POST',
            data: { old_password: oldPassword, new_password: newPassword },
        })
    }

    async checkResetPassword(): Promise<ResetPasswordCheckResponse> {
        return await this._request('/user/password/reset/check')
    }

    async resetPrimayPassword(data: ResetPasswordRequest): Promise<any> {
        return await this._request('/user/password/reset', { method: 'POST', data })
    }

    // ========== 子账户管理 ==========
    async createSubaccount(data: any): Promise<Subaccount> {
        return await this._request('/subaccounts', { method: 'POST', data })
    }

    async updateSubaccount(subaccountId: string, data: any): Promise<Subaccount> {
        return await this._request(`/subaccounts/${subaccountId}`, { method: 'PUT', data })
    }

    async deleteSubaccount(subaccountId: string): Promise<boolean> {
        return await this._request(`/subaccounts/${subaccountId}`, { method: 'DELETE' })
    }

    async fetchSubaccounts(): Promise<Subaccount[]> {
        return await this._request('/subaccounts')
    }

    // ========== 设置管理 ==========
    async fetchSettings(): Promise<GlobalSettings> {
        return await this._request('/settings')
    }

    async updateSettings(data: any): Promise<GlobalSettings> {
        return await this._request('/settings', { method: 'PUT', data })
    }

    // ========== MCP 服务器管理 ==========
    async fetchMcpServers(): Promise<PaginatedResponse<McpServer>> {
        return await this._request('/mcp-servers')
    }

    async fetchMcpServer(serverId: string): Promise<McpServer> {
        return await this._request(`/mcp-servers/${serverId}`)
    }

    async fetchMcpServerById(serverId: string): Promise<McpServer> {
        return this.fetchMcpServer(serverId)
    }

    async createMcpServer(data: any): Promise<McpServer> {
        return await this._request('/mcp-servers', { method: 'POST', data })
    }

    async updateMcpServer(serverId: string, data: any): Promise<McpServer> {
        return await this._request(`/mcp-servers/${serverId}`, { method: 'PUT', data })
    }

    async deleteMcpServer(serverId: string): Promise<boolean> {
        return await this._request(`/mcp-servers/${serverId}`, { method: 'DELETE' })
    }

    async toggleMcpServer(serverId: string, enabled: boolean): Promise<McpServer> {
        return await this._request(`/mcp-servers/${serverId}/toggle`, {
            method: 'POST',
            data: { enabled },
        })
    }

    async refreshMcpTools(serverId: string): Promise<McpServer> {
        return await this._request(`/mcp-servers/${serverId}/refresh`, { method: 'POST' })
    }

    async getMcpServers(): Promise<PaginatedResponse<McpServer>> {
        return this.fetchMcpServers()
    }

    // ========== 知识库管理 ==========

    /**
     * 获取知识库列表
     */
    async fetchKnowledgeBases(): Promise<PaginatedResponse<KnowledgeBase>> {
        return await this._request('/knowledge-bases')
    }

    /**
     * 创建知识库
     */
    async createKnowledgeBase(data: {
        name: string
        description?: string
        embedding_model_id: string
        chunk_max_size?: number
        chunk_overlap_size?: number
        chunk_min_size?: number
        is_public?: boolean
    }): Promise<KnowledgeBase> {
        return await this._request('/knowledge-bases', { method: 'POST', data })
    }

    /**
     * 更新知识库
     */
    async updateKnowledgeBase(kbId: string, data: Partial<KnowledgeBase>): Promise<KnowledgeBase> {
        return await this._request(`/knowledge-bases/${kbId}`, { method: 'PUT', data })
    }

    /**
     * 删除知识库
     */
    async deleteKnowledgeBase(kbId: string): Promise<{ success: boolean }> {
        return await this._request(`/knowledge-bases/${kbId}`, { method: 'DELETE' })
    }

    /**
     * 获取单个知识库详情
     */
    async getKnowledgeBase(kbId: string): Promise<KnowledgeBase> {
        return await this._request(`/knowledge-bases/${kbId}`)
    }

    // ========== 知识库文件管理 ==========

    /**
     * 获取知识库文件列表
     */
    async fetchKBFiles(kbId: string): Promise<PaginatedResponse<KBFile>> {
        return await this._request(`/knowledge-bases/${kbId}/files`)
    }

    /**
     * 上传文件到知识库
     */
    async uploadKBFile(kbId: string, file: File): Promise<KBFile> {
        const formData = new FormData()
        formData.append('file', file)

        try {
            // 使用 _request 方法确保携带认证信息
            return await this._request(
                `/knowledge-bases/${kbId}/files/upload`,
                {
                    method: 'POST',
                    data: formData,
                    headers: {
                        'Content-Type': 'multipart/form-data',
                    },
                }
            )
        } catch (error) {
            console.error('上传文件失败:', error)
            throw error
        }
    }

    /**
     * 获取文件详情
     */
    async getKBFile(kbId: string, fileId: string): Promise<KBFile> {
        return await this._request(`/knowledge-bases/${kbId}/files/${fileId}`)
    }

    /**
     * 删除知识库文件
     */
    async deleteKBFile(kbId: string, fileId: string): Promise<{ success: boolean }> {
        return await this._request(`/knowledge-bases/${kbId}/files/${fileId}`, { method: 'DELETE' })
    }

    /**
     * 查询文件处理状态
     */
    async getFileProcessingStatus(kbId: string, fileId: string): Promise<KBFile> {
        return await this._request(`/knowledge-bases/${kbId}/files/${fileId}/status`)
    }

    /**
     * 批量查询文件处理状态（推荐用于多文件轮询）
     * @param kbId 知识库 ID
     * @param fileIds 文件 ID 列表
     * @returns 文件状态列表
     */
    async batchGetFileProcessingStatus(kbId: string, fileIds: string[]): Promise<KBFile[]> {
        return await this._request(`/knowledge-bases/${kbId}/files/status/batch`, {
            method: 'POST',
            data: { file_ids: fileIds },
        })
    }

    /**
     * 重新处理文件（用于失败或已完成的文件）
     * @param kbId 知识库 ID
     * @param fileId 文件 ID
     * @returns 操作结果
     */
    async retryKBFile(kbId: string, fileId: string): Promise<{ success: boolean; message: string }> {
        return await this._request(`/knowledge-bases/${kbId}/files/${fileId}/retry`, {
            method: 'POST',
        })
    }

    // ========== 知识库搜索 ==========

    /**
     * 在知识库中搜索
     */
    async searchKnowledgeBase(
        kbId: string,
        query: string,
        topK: number = 5,
        filterFileId?: string
    ): Promise<any> {
        return await this._request(`/knowledge-bases/${kbId}/search`, {
            method: 'POST',
            data: {
                query,
                top_k: topK,
                filter_file_id: filterFileId,
            },
        })
    }

    // ========== 工具方法 ============
    debounce<T extends (...args: any[]) => any>(func: T, delay: number): T {
        let timer: number | undefined
        return function (this: any, ...args: Parameters<T>) {
            clearTimeout(timer)
            timer = window.setTimeout(() => {
                func.apply(this, args)
            }, delay)
        } as T
    }
}

// 创建默认实例并导出
export const apiService = new ApiService('/api/v1')
