/**
 * API 客户端服务
 * 提供完整的后端 API 接口调用
 */

import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from 'axios'
import { useStorage } from '@vueuse/core'
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
import type { Model, McpServer, ModelProvider } from '@/types/api'
import type { Character, CharacterListResponse, CharacterGroup } from '@/types/character'
import type { Session, SessionListResponse } from '@/types/session'
import type { Message } from '@/types/message'
import type { PaginatedResponse } from '@/types/common'
import type { KnowledgeBase, KBFile } from '@/stores/knowledgeBase'
import type { BotInstance, PlatformMetadata, CreateBotRequest, UpdateBotRequest } from '@/types/bot'

class ApiService implements IApiService {
  baseURL: string
  tokenStore: any
  axiosInstance: AxiosInstance
  currentAbortController: AbortController | null
  abortControllerMap: Map<string, AbortController>

  constructor(baseURL?: string) {
    // Electron 环境使用动态获取的后端地址，Web 环境使用相对路径
    const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined
    
    if (baseURL) {
      this.baseURL = baseURL
    } else if (isElectron) {
      // 在 Electron 环境下，通过 IPC 获取后端端口并构造地址
      // 注意：这里我们暂时使用一个占位符，实际地址会在 initBackendUrl 中设置
      this.baseURL = 'http://localhost:3000/api/v1'
    } else {
      this.baseURL = '/api/v1'
    }
    
    this.tokenStore = useStorage('token', '')

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
        
        // 区分连接错误和认证错误
        if (error.code === 'ECONNREFUSED' || error.code === 'ERR_CONNECTION_REFUSED' || !error.response) {
          // 网络连接错误，不跳转到登录页
          console.warn('后端服务连接失败，请稍后重试')
          throw new Error('无法连接到后端服务，请确保应用已完全启动')
        }
        
        // 只有真正的401认证错误才跳转登录
        if (error.response?.status === 401) {
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
        // 优先从 localStorage 读取（记住我），否则使用 sessionStorage
        const token = localStorage.getItem('token') || sessionStorage.getItem('token')
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
   * 初始化后端地址（针对 Electron 环境）
   */
  async initBackendUrl(): Promise<void> {
    const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined
    if (isElectron && !this.baseURL.includes('localhost:3000')) {
      // 如果已经初始化过或者不是默认占位符，则跳过
      return
    }
    
    try {
      const info = await window.electronAPI!.getAppInfo()
      if (info.backendPort) {
        this.baseURL = `http://localhost:${info.backendPort}/api/v1`
        // 更新 axios 实例的 baseURL
        this.axiosInstance.defaults.baseURL = this.baseURL
        console.log(`🔗 API 服务已连接到后端端口: ${info.backendPort}`)
      }
    } catch (error) {
      console.error('❌ 获取后端端口失败:', error)
    }
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
  async fetchModels(): Promise<PaginatedResponse<ModelProvider>> {
    return await this._request('/models')
  }

  async fetchRemoteModels(providerId: string): Promise<PaginatedResponse<Model>> {
    return await this._request(`/providers/${providerId}/remote_models`)
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

  async testProviderConnection(data: any): Promise<{ success: boolean; message: string }> {
    return await this._request('/providers/test-connection', { method: 'POST', data })
  }

  async deleteProvider(providerId: string): Promise<boolean> {
    return await this._request(`/providers/${providerId}`, { method: 'DELETE' })
  }

  async updateProvider(providerId: string, data: any): Promise<any> {
    return await this._request(`/providers/${providerId}`, { method: 'PUT', data })
  }

  async getProviderTemplates(): Promise<any[]> {
    return await this._request('/providers/templates')
  }

  // ========== 角色相关 ==========
  async fetchCharacters(groupId?: string): Promise<CharacterListResponse> {
    const params = groupId ? `?groupId=${groupId}` : ''
    return await this._request(`/characters${params}`)
  }

  async fetchCharacterGroups(): Promise<CharacterGroup[]> {
    return await this._request('/character-groups')
  }

  async createCharacterGroup(data: { name: string }): Promise<CharacterGroup> {
    return await this._request('/character-groups', { method: 'POST', data })
  }

  async updateCharacterGroup(groupId: string, data: { name: string }): Promise<CharacterGroup> {
    return await this._request(`/character-groups/${groupId}`, { method: 'PUT', data })
  }

  async deleteCharacterGroup(groupId: string): Promise<{ success: boolean }> {
    return await this._request(`/character-groups/${groupId}`, { method: 'DELETE' })
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

  async fetchSessions(skip?: number, limit?: number): Promise<SessionListResponse> {
    const params = new URLSearchParams()
    if (skip !== undefined) params.append('skip', skip.toString())
    if (limit !== undefined) params.append('limit', limit.toString())

    const queryString = params.toString()
    const url = queryString ? `/sessions?${queryString}` : '/sessions'

    return await this._request(url)
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
    replaceMessageId: string | null = null,
    knowledgeBaseIds?: string[]
  ): Promise<Message> {
    return await this._request(`/sessions/${sessionId}/messages`, {
      method: 'POST',
      data: {
        content,
        files,
        replaceMessageId: replaceMessageId,
        knowledgeBaseIds: knowledgeBaseIds,
      },
    })
  }


  async clearSessionMessages(sessionId: string): Promise<boolean> {
    return await this._request(`/sessions/${sessionId}/messages`, { method: 'DELETE' })
  }

  async updateSession(sessionId: string, data: any): Promise<Session> {
    return await this._request(`/sessions/${sessionId}`, { method: 'PUT', data })
  }

  async generateSessionTitle(sessionId: string): Promise<{ title: string; skipped?: boolean }> {
    return await this._request(`/sessions/${sessionId}/generate-title`, { method: 'POST' })
  }

  async compressSessionHistory(
    sessionId: string,
    compressionRatio: number = 50,
    minRetainedTurns: number = 3,
    cleaningStrategy: string = 'moderate'
  ): Promise<any> {
    return await this._request(`/sessions/${sessionId}/compress-history`, {
      method: 'POST',
      data: { compressionRatio, minRetainedTurns, cleaningStrategy },
    })
  }

  async fetchSessionSummaries(sessionId: string): Promise<any[]> {
    return await this._request(`/sessions/${sessionId}/summaries`, { method: 'GET' })
  }

  async updateSummary(summaryId: string, data: { summaryContent?: string }): Promise<any> {
    return await this._request(`/sessions/summaries/${summaryId}`, {
      method: 'PUT',
      data,
    })
  }

  async deleteSummary(summaryId: string): Promise<{ success: boolean }> {
    return await this._request(`/sessions/summaries/${summaryId}`, { method: 'DELETE' })
  }

  async fetchSessionTokenStats(sessionId: string): Promise<{
    usedTokens: number
    totalTokens: number
    remainingTokens: number
    percentage: number
    modelName: string
    messageCount: number
  }> {
    return await this._request(`/sessions/${sessionId}/token-stats`)
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
    regenerationMode: string | null = null,
    assistantMessageId: string | null = null,
    enableReasoning: boolean = false
  ): AsyncGenerator<StreamEvent, void, unknown> {
    try {
      this.cancelResponse(sessionId)
      const controller = new AbortController()
      this.abortControllerMap.set(sessionId, controller)
      // 优先从 localStorage 读取（记住我），否则使用 sessionStorage
      const accessToken = localStorage.getItem('token') || sessionStorage.getItem('token')

      const response = await fetch(`${this.baseURL}/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          sessionId: sessionId,
          messageId: messageId,
          assistantMessageId: assistantMessageId,
          regenerationMode: regenerationMode,
          stream: true,
          enableReasoning: enableReasoning,
        }),
        signal: controller.signal,
      })

      // 检查响应头中的 Content-Type
      const contentType = response.headers.get('Content-Type')

      if (contentType && contentType.includes('application/json')) {
        const errorData = await response.json()
        if (response.status === 409) {
          throw new Error('SessionBusyError: ' + (errorData.error || 'Session is busy'))
        }
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
    // 确保文件名在 FormData 中正确编码
    formData.append('file', file, file.name)

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
      data: { type: 'copy', messageId: messageId },
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

  async getAutoLoginStatus(): Promise<{ enabled: boolean }> {
    return await this._request('/settings/auto-login')
  }

  async setAutoLoginStatus(enabled: boolean): Promise<void> {
    return await this._request('/settings/auto-login', { 
      method: 'POST', 
      data: { enabled } 
    })
  }

  async autoLogin(): Promise<{ accessToken: string; user: User }> {
    return await this._request('/auth/auto-login', { method: 'POST' })
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
      data: { oldPassword: oldPassword, newPassword: newPassword },
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

  /**
   * 获取指定分组的设置
   */
  async fetchGroupSettings(group: string): Promise<any> {
    return await this._request(`/settings/${group}`)
  }

  /**
   * 更新指定分组的设置
   */
  async updateGroupSettings(group: string, data: any): Promise<any> {
    return await this._request(`/settings/${group}`, { method: 'PUT', data })
  }

  async fetchGlobalTools(): Promise<any> {
    return await this._request('/settings/tools/global')
  }

  async updateGlobalToolStatus(namespace: string, enabled: boolean): Promise<{ success: boolean }> {
    return await this._request('/settings/tools/global', {
      method: 'PUT',
      data: { namespace, enabled },
    })
  }

  async fetchCharacterTools(characterId: string): Promise<any> {
    return await this._request(`/characters/${characterId}/tools`)
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
      method: 'PATCH',
      data: { enabled },
    })
  }

  async refreshMcpTools(serverId: string): Promise<McpServer> {
    return await this._request(`/mcp-servers/${serverId}/refresh-tools`, { method: 'POST' })
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
    embeddingModelId: string
    chunkMaxSize?: number
    chunkOverlapSize?: number
    chunkMinSize?: number
    isPublic?: boolean
  }): Promise<KnowledgeBase> {

    return await this._request('/knowledge-bases', { method: 'POST', data: data })
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
   * @param kbId 知识库 ID
   * @param skip 跳过数量（用于分页）
   * @param limit 返回数量限制（用于分页）
   */
  async fetchKBFiles(kbId: string, skip?: number, limit?: number): Promise<PaginatedResponse<KBFile>> {
    const params = new URLSearchParams()
    if (skip !== undefined) params.append('skip', skip.toString())
    if (limit !== undefined) params.append('limit', limit.toString())

    const queryString = params.toString()
    const url = queryString ? `/knowledge-bases/${kbId}/files?${queryString}` : `/knowledge-bases/${kbId}/files`

    return await this._request(url)
  }

  /**
   * 按父文件夹ID获取文件列表(支持懒加载)
   */
  async fetchKBFilesByParent(
    kbId: string,
    parentFolderId: string | null,
    skip?: number,
    limit?: number
  ): Promise<PaginatedResponse<KBFile>> {
    const params = new URLSearchParams()
    
    // parentFolderId 为 null 表示根目录
    if (parentFolderId !== null && parentFolderId !== undefined) {
      params.append('parentFolderId', parentFolderId)
    }
    
    if (skip !== undefined) params.append('skip', skip.toString())
    if (limit !== undefined) params.append('limit', limit.toString())

    const queryString = params.toString()
    const url = queryString 
      ? `/knowledge-bases/${kbId}/files/by-parent?${queryString}` 
      : `/knowledge-bases/${kbId}/files/by-parent`

    return await this._request(url)
  }

  /**
   * 通过相对路径获取文件夹内容
   */
  async fetchKBFilesByPath(
    kbId: string,
    relativePath: string | null,
    skip?: number,
    limit?: number
  ): Promise<PaginatedResponse<KBFile>> {
    const params = new URLSearchParams()
    
    // relativePath 为空表示根目录
    if (relativePath !== null && relativePath !== undefined && relativePath !== '') {
      params.append('path', relativePath)
    }
    
    if (skip !== undefined) params.append('skip', skip.toString())
    if (limit !== undefined) params.append('limit', limit.toString())

    const queryString = params.toString()
    const url = queryString 
      ? `/knowledge-bases/${kbId}/files/by-path?${queryString}` 
      : `/knowledge-bases/${kbId}/files/by-path`

    return await this._request(url)
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
   * 重命名知识库文件
   */
  async renameKBFile(
    kbId: string,
    fileId: string,
    newName: string,
  ): Promise<{ success: boolean; message: string; data: any }> {
    return await this._request(`/knowledge-bases/${kbId}/files/${fileId}/rename`, {
      method: 'POST',
      data: { newName },
    })
  }

  /**
   * 移动知识库文件
   */
  async moveKBFile(
    kbId: string,
    fileId: string,
    targetParentFolderId: string | null,
  ): Promise<{ success: boolean; message: string; data: any }> {
    return await this._request(`/knowledge-bases/${kbId}/files/${fileId}/move`, {
      method: 'POST',
      data: { targetParentFolderId },
    })
  }

  /**
   * 创建知识库文件夹
   */
  async createKBFolder(
    kbId: string,
    folderName: string,
    parentFolderId: string | null = null,
  ): Promise<any> {
    return await this._request(`/knowledge-bases/${kbId}/files/folder`, {
      method: 'POST',
      data: { folderName, parentFolderId },
    })
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
      data: { fileIds: fileIds }
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

  /**
   * 获取文件的分块内容
   * @param kbId 知识库 ID
   * @param fileId 文件 ID
   * @param skip 跳过的分块数
   * @param limit 返回的最大分块数（默认 10 个，最多 50 个）
   * @returns 分块列表
   */
  async getKBFileChunks(
    kbId: string,
    fileId: string,
    skip: number = 0,
    limit: number = 10
  ): Promise<any[]> {
    return await this._request(`/knowledge-bases/${kbId}/files/${fileId}/chunks?skip=${skip}&limit=${limit}`)
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
        topK: topK,
        filterFileId: filterFileId,
      },
    })
  }

  // ========== 机器人管理 ==========

  /**
   * 获取所有支持的平台列表(包含配置字段定义)
   */
  async fetchBotPlatforms(): Promise<PlatformMetadata[]> {
    return await this._request('/bot-admin/platforms')
  }

  /**
   * 获取当前用户的所有机器人实例列表
   */
  async fetchBotInstances(): Promise<BotInstance[]> {
    return await this._request('/bot-admin/instances')
  }

  /**
   * 获取单个机器人详情
   */
  async fetchBotInstance(id: string): Promise<BotInstance> {
    return await this._request(`/bot-admin/instances/${id}`)
  }

  /**
   * 创建新机器人
   */
  async createBotInstance(data: CreateBotRequest): Promise<BotInstance> {
    return await this._request('/bot-admin/instances', { method: 'POST', data })
  }

  /**
   * 更新机器人配置
   */
  async updateBotInstance(id: string, data: UpdateBotRequest): Promise<BotInstance> {
    return await this._request(`/bot-admin/instances/${id}`, { method: 'PUT', data })
  }

  /**
   * 启动机器人
   */
  async startBotInstance(id: string): Promise<{ success: boolean }> {
    return await this._request(`/bot-admin/instances/${id}/start`, { method: 'POST' })
  }

  /**
   * 停止机器人
   */
  async stopBotInstance(id: string): Promise<{ success: boolean }> {
    return await this._request(`/bot-admin/instances/${id}/stop`, { method: 'POST' })
  }

  /**
   * 重启机器人
   */
  async restartBotInstance(id: string): Promise<{ success: boolean }> {
    return await this._request(`/bot-admin/instances/${id}/restart`, { method: 'POST' })
  }

  /**
   * 删除机器人
   */
  async deleteBotInstance(id: string): Promise<{ success: boolean }> {
    return await this._request(`/bot-admin/instances/${id}`, { method: 'DELETE' })
  }

  /**
   * 获取 Bot 专属会话列表（sessionType='bot'）
   */
  async fetchBotSessions(skip?: number, limit?: number): Promise<PaginatedResponse<Session>> {
    const params = new URLSearchParams()
    if (skip !== undefined) params.append('skip', skip.toString())
    if (limit !== undefined) params.append('limit', limit.toString())

    const queryString = params.toString()
    const url = queryString ? `/bot-admin/sessions?${queryString}` : '/bot-admin/sessions'

    return await this._request(url)
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

/**
 * 创建 Mock 模式的 chat 方法
 */
/**
 * 创建 Mock 模式的方法集合（延迟加载配置）
 */
function createMockMethods() {
  // 缓存配置，避免重复加载
  let cachedConfig: any = null
  let configPromise: Promise<any> | null = null

  // 异步加载配置的函数
  async function loadMockConfig(): Promise<any> {
    if (cachedConfig) return cachedConfig
    if (configPromise) return configPromise

    configPromise = (async () => {
      let defaultConfig: any = {}
      const scenarioName = localStorage.getItem('VITE_MOCK_SCENARIO') || import.meta.env.VITE_MOCK_SCENARIO

      if (scenarioName) {
        try {
          const { getScenarioConfig } = await import('./mockStreamService')
          defaultConfig = getScenarioConfig(scenarioName as any)
        } catch (e) {
          console.warn('⚠️ [Mock] 场景配置加载失败:', e)
        }
      }

      // 支持自定义配置覆盖
      const customConfigStr = localStorage.getItem('VITE_MOCK_CUSTOM_CONFIG') || import.meta.env.VITE_MOCK_CUSTOM_CONFIG
      if (customConfigStr) {
        try {
          defaultConfig = { ...defaultConfig, ...JSON.parse(customConfigStr) }
        } catch (e) {
          console.warn('⚠️ [Mock] 自定义配置解析失败:', e)
        }
      }

      cachedConfig = defaultConfig
      console.log('🎭 [Mock] 配置已加载', defaultConfig)
      return defaultConfig
    })()

    return configPromise
  }

  // Mock 的 chat 方法
  const mockChat = async function* (
    sessionId: string,
    messageId: string,
    regenerationMode?: string | null,
    assistantMessageId?: string | null,
    enableReasoning?: boolean
  ): AsyncGenerator<any, void, unknown> {
    // 首次调用时加载配置
    const config = await loadMockConfig()

    console.log(`🎭 [Mock] 拦截 chat 请求:`, {
      sessionId,
      messageId,
      regenerationMode,
      assistantMessageId
    })

    // 如果启用了 reasoning，自动启用 thinking
    if (enableReasoning && !config.enableThinking) {
      config.enableThinking = true
    }

    // 动态导入 Mock 服务
    const { mockChatStream } = await import('./mockStreamService')

    try {
      yield* mockChatStream(
        sessionId,
        messageId,
        config,
        assistantMessageId,
        regenerationMode
      )
    } catch (error) {
      console.error('🎭 [Mock] 模拟错误:', error)
      throw error
    }
  }

  // Mock 的 createMessage 方法
  const mockCreateMessage = async (
    sessionId: string,
    content: string,
    files: any[] = [],
    replaceMessageId: string | null = null,
    knowledgeBaseIds?: string[]
  ): Promise<any> => {
    console.log(`🎭 [Mock] 拦截 createMessage 请求:`, {
      sessionId,
      content: content.substring(0, 50) + (content.length > 50 ? '...' : ''),
      filesCount: files.length,
      replaceMessageId,
      knowledgeBaseIds
    })

    // 模拟延迟
    await new Promise(resolve => setTimeout(resolve, 100))

    // 生成模拟的消息 ID
    const mockMessageId = `mock_msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const now = new Date().toISOString()

    // 返回模拟的用户消息
    return {
      id: mockMessageId,
      sessionId,
      role: 'user',
      content,
      files: files || [],
      parentId: replaceMessageId,
      currentTurnsId: null,
      state: {
        isStreaming: false,
        isThinking: false
      },
      createdAt: now,
      updatedAt: now,
      contents: [
        {
          content: content,
          additionalKwargs: {}
        }
      ]
    }
  }

  return {
    chat: mockChat,
    createMessage: mockCreateMessage
  }
}

/**
 * 检查是否应该启用 Mock
 */
function shouldEnableMock(): boolean {
  // 生产环境强制禁用
  if (import.meta.env.PROD) {
    return false
  }

  // 优先从 localStorage 读取
  const localStorageEnabled = localStorage.getItem('VITE_ENABLE_MOCK')
  if (localStorageEnabled !== null) {
    return localStorageEnabled === 'true'
  }

  // 降级到环境变量
  return import.meta.env.VITE_ENABLE_MOCK === 'true'
}

/**
 * 创建 API Service 实例（同步）
 * - 生产环境：直接使用真实 ApiService
 * - 开发环境：根据配置决定是否启用 Mock
 */
function createApiServiceInstance() {
  // 不传 baseURL，让构造函数自动检测环境
  const realService = new ApiService()

  // 生产环境强制使用真实服务
  if (import.meta.env.PROD) {
    console.log('✅ 生产环境：使用真实 API Service')
    return realService
  }

  // 开发环境：检查是否启用 Mock
  const enabled = shouldEnableMock()

  if (!enabled) {
    console.log('✅ 开发环境：使用真实 API Service（Mock 已禁用）')
    return realService
  }

  console.log('🎭 开发环境：使用 Mock API Service（配置将在首次调用时加载）')

  // 创建包装后的实例，仅覆盖 chat 和 createMessage 方法
  // 使用 Object.create 确保原型链正确继承
  const mockService = Object.create(Object.getPrototypeOf(realService))

  // 复制所有实例属性
  Object.assign(mockService, realService)

  // 获取 Mock 方法集合
  const mockMethods = createMockMethods()

  // 覆盖 chat 和 createMessage 方法
  mockService.chat = mockMethods.chat
  mockService.createMessage = mockMethods.createMessage

  return mockService
}

// 创建默认实例并导出（同步创建，无竞态条件）
export let apiService: ApiService = createApiServiceInstance()

/**
 * 重新初始化 API Service（用于动态切换 Mock 模式）
 * 调用此方法后，需要刷新页面或重新获取 apiService
 */
export function reinitApiService() {
  apiService = createApiServiceInstance()
  console.log('🔄 API Service 已重新初始化')
  return apiService
}
