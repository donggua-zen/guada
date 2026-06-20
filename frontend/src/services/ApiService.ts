/**
 * API 客户端服务
 * 提供完整的后端 API 接口调用
 */

import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
} from "axios";
import { useStorage } from "@vueuse/core";
import type {
  StreamEvent,
  LoginRequest,
  LoginResponse,
  User,
  ResetPasswordCheckResponse,
  ResetPasswordRequest,
  Subaccount,
  GlobalSettings,
  UploadResponse,
} from "@/types/service";

import type { Model, McpServer, ModelProvider } from "@/types/api";
import type {
  Character,
  CharacterListResponse,
  CharacterGroup,
} from "@/types/character";
import type { Session, SessionGroup, SessionListResponse } from "@/types/session";
import type { Message } from "@/types/message";
import type { PaginatedResponse } from "@/types/common";
import type { KnowledgeBase, KBFile } from "@/stores/knowledgeBase";
import type {
  BotInstance,
  PlatformMetadata,
  CreateBotRequest,
  UpdateBotRequest,
} from "@/types/bot";
import { fixFrontendAssetUrl } from "@/utils/url";
import { getClientId } from "@/utils/clientId";
import { ChatStreamService } from "./modules/ChatStreamService";
import {
  WorkspaceWatcherService,
  type FileChangeEvent,
} from "./modules/WorkspaceWatcherService";
import {
  SessionEventsService,
  type SessionEvent,
  type SessionEventType,
} from "./modules/SessionEventsService";
import { createMockMethods, shouldEnableMock } from "./mock/MockApiService";

export type { FileChangeEvent };
export type { SessionEvent, SessionEventType };

class ApiService {
  baseURL: string;
  tokenStore: any;
  axiosInstance: AxiosInstance;
  chatStreamService: ChatStreamService;
  workspaceWatcherService: WorkspaceWatcherService;
  sessionEventsService: SessionEventsService;

  constructor(baseURL?: string) {
    // Electron 环境使用动态获取的后端地址，Web 环境使用相对路径
    const isElectron =
      typeof window !== "undefined" && window.electronAPI !== undefined;

    if (baseURL) {
      this.baseURL = baseURL;
    } else if (isElectron) {
      // 在 Electron 环境下，通过 IPC 获取后端端口并构造地址
      // 注意：这里我们暂时使用一个占位符，实际地址会在 initBackendUrl 中设置
      this.baseURL = "http://localhost:3000/api/v1";
    } else {
      this.baseURL = "/api/v1";
    }

    this.tokenStore = useStorage("token", "");

    // 创建 Axios 实例
    this.axiosInstance = axios.create({
      baseURL: this.baseURL,
      timeout: 60000, // 30秒超时
      headers: {
        "Content-Type": "application/json",
      },
    });

    // 添加响应拦截器处理通用错误
    this.axiosInstance.interceptors.response.use(
      (response: AxiosResponse) => {
        return response.data ? response.data : response;
      },
      (error) => {
        console.error("API 请求失败:", error);

        // 区分连接错误和认证错误
        if (
          error.code === "ECONNREFUSED" ||
          error.code === "ERR_CONNECTION_REFUSED" ||
          !error.response
        ) {
          // 网络连接错误，不跳转到登录页
          console.warn("后端服务连接失败，请稍后重试");
          const networkError = new Error(
            "无法连接到后端服务，请确保应用已完全启动",
          );
          (networkError as any).isNetworkError = true;
          throw networkError;
        }

        // 只有真正的401认证错误才抛出特定异常（排除登录接口本身的401）
        if (
          error.response?.status === 401 &&
          !error.config?.url?.includes("/auth/login")
        ) {
          // 创建认证错误，携带特殊标记供上层识别
          const authError = new Error("Authentication required");
          (authError as any).isAuthError = true;
          (authError as any).statusCode = 401;

          // 延迟触发跳转，避免在拦截器中直接操作路由导致的问题
          setTimeout(() => {
            import("@/utils/globalErrorHandler").then(
              ({ triggerAuthRedirect }) => {
                triggerAuthRedirect();
              },
            );
          }, 0);

          return Promise.reject(authError);
        }

        // 提取友好的错误消息
        let errorMessage = "请求失败";
        if (error.response?.data) {
          const responseData = error.response.data;
          // 优先使用 message 字段
          if (responseData.message) {
            errorMessage =
              typeof responseData.message === "string"
                ? responseData.message
                : responseData.message.error || "请求失败";
          } else if (responseData.error) {
            errorMessage = responseData.error;
          }
        }

        const friendlyError = new Error(errorMessage);
        (friendlyError as any).statusCode = error.response?.status;
        throw friendlyError;
      },
    );

    // 添加请求拦截器动态设置 token 和 clientId
    this.axiosInstance.interceptors.request.use(
      (config) => {
        // 优先从 sessionStorage 读取（当前会话登录），降级到 localStorage（记住我）
        // 避免 localStorage 中的旧过期 token 被优先使用
        const token =
          sessionStorage.getItem("token") || localStorage.getItem("token");
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        // 注入全局 clientId，用于后端识别操作来源
        config.headers["X-Client-Id"] = getClientId();
        return config;
      },
      (error) => {
        return Promise.reject(error);
      },
    );

    this.chatStreamService = new ChatStreamService(() => this.baseURL);
    this.workspaceWatcherService = new WorkspaceWatcherService(
      () => this.baseURL,
    );
    this.sessionEventsService = new SessionEventsService(() => this.baseURL);
  }

  /**
   * 初始化后端地址（针对 Electron 环境）
   */
  async initBackendUrl(): Promise<void> {
    const isElectron =
      typeof window !== "undefined" && window.electronAPI !== undefined;
    if (isElectron && !this.baseURL.includes("localhost:3000")) {
      // 如果已经初始化过或者不是默认占位符，则跳过
      return;
    }

    try {
      const info = await window.electronAPI!.getAppInfo();
      if (info.backendPort) {
        this.baseURL = `http://localhost:${info.backendPort}/api/v1`;
        // 更新 axios 实例的 baseURL
        this.axiosInstance.defaults.baseURL = this.baseURL;
        console.log(`🔗 API 服务已连接到后端端口: ${info.backendPort}`);
      }
    } catch (error) {
      console.error("❌ 获取后端端口失败:", error);
    }
  }

  /**
   * 通用请求方法
   */
  async _request<T = any>(
    endpoint: string,
    options?: AxiosRequestConfig,
  ): Promise<T> {
    try {
      const response = await this.axiosInstance({
        url: endpoint,
        ...options,
      });
      // 响应拦截器已经返回了 response.data，这里直接返回 response
      return response as T;
    } catch (error) {
      console.error(`API 请求失败：${endpoint}`, error);
      throw error;
    }
  }

  // ========== 模型管理 ==========
  async fetchModels(): Promise<PaginatedResponse<ModelProvider>> {
    return await this._request("/models");
  }

  async fetchAllModels(): Promise<PaginatedResponse<ModelProvider>> {
    return await this._request("/models/all");
  }

  async fetchRemoteModels(
    providerId: string,
  ): Promise<PaginatedResponse<Model>> {
    return await this._request(`/providers/${providerId}/remote_models`);
  }

  async createModel(data: any): Promise<Model> {
    return await this._request("/models", { method: "POST", data });
  }

  async updateModel(modelId: string, data: any): Promise<Model> {
    return await this._request(`/models/${modelId}`, { method: "PUT", data });
  }

  async deleteModel(modelId: string): Promise<boolean> {
    return await this._request(`/models/${modelId}`, { method: "DELETE" });
  }

  async toggleModelFavorite(modelId: string): Promise<any> {
    return await this._request(`/models/${modelId}/favorite`, {
      method: "PUT",
    });
  }

  async toggleModelActive(modelId: string): Promise<any> {
    return await this._request(`/models/${modelId}/toggle-active`, {
      method: "PUT",
    });
  }

  // ========== 提供商管理 ==========
  async createProvider(data: any): Promise<any> {
    return await this._request("/providers", { method: "POST", data });
  }

  async testProviderConnection(
    data: any,
  ): Promise<{ success: boolean; message: string }> {
    return await this._request("/providers/test-connection", {
      method: "POST",
      data,
    });
  }

  async deleteProvider(providerId: string): Promise<boolean> {
    return await this._request(`/providers/${providerId}`, {
      method: "DELETE",
    });
  }

  async updateProvider(providerId: string, data: any): Promise<any> {
    return await this._request(`/providers/${providerId}`, {
      method: "PUT",
      data,
    });
  }

  async getProviderTemplates(): Promise<any[]> {
    return await this._request("/providers/templates");
  }

  // ========== 角色相关 ==========
  async fetchCharacters(groupId?: string): Promise<CharacterListResponse> {
    const params = groupId ? `?groupId=${groupId}` : "";
    return await this._request(`/characters${params}`);
  }

  async fetchCharacterGroups(): Promise<CharacterGroup[]> {
    return await this._request("/character-groups");
  }

  async createCharacterGroup(data: { name: string }): Promise<CharacterGroup> {
    return await this._request("/character-groups", { method: "POST", data });
  }

  async updateCharacterGroup(
    groupId: string,
    data: { name: string },
  ): Promise<CharacterGroup> {
    return await this._request(`/character-groups/${groupId}`, {
      method: "PUT",
      data,
    });
  }

  async deleteCharacterGroup(groupId: string): Promise<{ success: boolean }> {
    return await this._request(`/character-groups/${groupId}`, {
      method: "DELETE",
    });
  }

  async fetchCharacter(characterId: string): Promise<Character> {
    return await this._request(`/characters/${characterId}`);
  }

  async createCharacter(characterData: any): Promise<Character> {
    return await this._request("/characters", {
      method: "POST",
      data: characterData,
    });
  }

  async updateCharacter(
    characterId: string,
    characterData: any,
  ): Promise<Character> {
    return await this._request(`/characters/${characterId}`, {
      method: "PUT",
      data: characterData,
    });
  }

  async deleteCharacter(characterId: string): Promise<{ success: boolean }> {
    return await this._request(`/characters/${characterId}`, {
      method: "DELETE",
    });
  }

  // ========== 团队相关 ==========
  async fetchTeams(): Promise<any[]> {
    return await this._request("/teams");
  }

  async fetchTeam(teamId: string): Promise<any> {
    return await this._request(`/teams/${teamId}`);
  }

  async createTeam(data: {
    name: string;
    description?: string;
    leaderCharacterId: string;
    memberCharacterIds?: string[];
  }): Promise<any> {
    return await this._request("/teams", { method: "POST", data });
  }

  async updateTeam(
    teamId: string,
    data: {
      name?: string;
      description?: string;
      leaderCharacterId?: string;
      memberCharacterIds?: string[];
    },
  ): Promise<any> {
    return await this._request(`/teams/${teamId}`, {
      method: "PUT",
      data,
    });
  }

  async deleteTeam(teamId: string): Promise<{ success: boolean }> {
    return await this._request(`/teams/${teamId}`, {
      method: "DELETE",
    });
  }

  // ========== 会话相关 ==========
  async createSession(data: any): Promise<Session> {
    return await this._request("/sessions", { method: "POST", data });
  }

  async deleteSession(
    sessionId: string,
    deleteWorkspace: boolean = false,
  ): Promise<{ success: boolean }> {
    const url = deleteWorkspace
      ? `/sessions/${sessionId}?deleteWorkspace=true`
      : `/sessions/${sessionId}`;
    return await this._request(url, { method: "DELETE" });
  }

  async fetchSession(sessionId: string): Promise<Session> {
    return await this._request(`/sessions/${sessionId}`);
  }

  async fetchSessions(
    skip?: number,
    limit?: number,
    groupId?: string | null,
  ): Promise<SessionListResponse> {
    const params = new URLSearchParams();
    if (skip !== undefined) params.append("skip", skip.toString());
    if (limit !== undefined) params.append("limit", limit.toString());
    if (groupId !== undefined) params.append("groupId", groupId === null ? "null" : groupId);

    const queryString = params.toString();
    const url = queryString ? `/sessions?${queryString}` : "/sessions";

    return await this._request(url);
  }

  async fetchSessionMessages(
    sessionId: string,
    options?: {
      limit?: number;
      beforeMessageId?: string;
      afterMessageId?: string;
    },
  ): Promise<PaginatedResponse<Message>> {
    const params = new URLSearchParams();
    if (options?.limit !== undefined) params.append("limit", options.limit.toString());
    if (options?.beforeMessageId) params.append("beforeMessageId", options.beforeMessageId);
    if (options?.afterMessageId) params.append("afterMessageId", options.afterMessageId);

    const queryString = params.toString();
    const url = queryString
      ? `/sessions/${sessionId}/messages?${queryString}`
      : `/sessions/${sessionId}/messages`;

    return await this._request(url);
  }

  async importMessages(sessionId: string, messages: any[]): Promise<any> {
    return await this._request(`/sessions/${sessionId}/messages/import`, {
      method: "POST",
      data: messages,
    });
  }

  async createMessage(
    sessionId: string,
    content: string,
    files: any[] = [],
    replaceMessageId: string | null = null,
    knowledgeBaseIds?: string[],
  ): Promise<Message> {
    return await this._request(`/sessions/${sessionId}/messages`, {
      method: "POST",
      data: {
        content,
        files,
        replaceMessageId: replaceMessageId,
        knowledgeBaseIds: knowledgeBaseIds,
      },
    });
  }

  async clearSessionMessages(sessionId: string): Promise<boolean> {
    return await this._request(`/sessions/${sessionId}/messages`, {
      method: "DELETE",
    });
  }

  async updateSession(sessionId: string, data: any): Promise<Session> {
    return await this._request(`/sessions/${sessionId}`, {
      method: "PUT",
      data,
    });
  }

  // ========== 会话分组管理 ==========

  /**
   * 获取当前用户的所有会话分组
   */
  async fetchSessionGroups(): Promise<SessionGroup[]> {
    return await this._request("/session-groups");
  }

  /**
   * 创建新分组
   */
  async createSessionGroup(data: { name: string }): Promise<SessionGroup> {
    return await this._request("/session-groups", {
      method: "POST",
      data,
    });
  }

  /**
   * 更新分组名称
   */
  async updateSessionGroup(
    groupId: string,
    data: { name: string },
  ): Promise<SessionGroup> {
    return await this._request(`/session-groups/${groupId}`, {
      method: "PUT",
      data,
    });
  }

  /**
   * 删除分组
   */
  async deleteSessionGroup(groupId: string): Promise<{ success: boolean }> {
    return await this._request(`/session-groups/${groupId}`, {
      method: "DELETE",
    });
  }

  /**
   * 批量更新分组排序
   */
  async reorderSessionGroups(groupIds: string[]): Promise<{ success: boolean }> {
    return await this._request("/session-groups/reorder", {
      method: "POST",
      data: { groupIds },
    });
  }

  async generateSessionTitle(
    sessionId: string,
  ): Promise<{ title: string; skipped?: boolean }> {
    return await this._request(`/sessions/${sessionId}/generate-title`, {
      method: "POST",
    });
  }

  /**
   * 手动触发会话压缩（强制压缩，不受阈值限制）
   */
  async compressSession(sessionId: string): Promise<any> {
    return await this._request(`/sessions/${sessionId}/compress`, {
      method: "POST",
    });
  }

  async fetchSessionSummaries(sessionId: string): Promise<any[]> {
    return await this._request(`/sessions/${sessionId}/summaries`, {
      method: "GET",
    });
  }

  async updateSummary(
    summaryId: string,
    data: { summaryContent?: string },
  ): Promise<any> {
    return await this._request(`/sessions/summaries/${summaryId}`, {
      method: "PUT",
      data,
    });
  }

  async deleteSummary(summaryId: string): Promise<{ success: boolean }> {
    return await this._request(`/sessions/summaries/${summaryId}`, {
      method: "DELETE",
    });
  }

  async fetchSessionTokenStats(sessionId: string): Promise<{
    usedTokens: number;
    totalTokens: number;
    remainingTokens: number;
    percentage: number;
    modelName: string;
    messageCount: number;
  }> {
    return await this._request(`/sessions/${sessionId}/token-stats`);
  }

  /**
   * 获取会话的工作目录路径
   */
  async getWorkspacePath(
    sessionId: string,
  ): Promise<{ workspacePath: string }> {
    return await this._request(`/sessions/${sessionId}/workspace-path`);
  }

  /**
   * 获取工作目录树结构
   */
  async getWorkspaceTree(sessionId: string): Promise<{ tree: any[] }> {
    return await this._request(`/sessions/${sessionId}/workspace/tree`);
  }

  /**
   * 获取指定目录的子节点（用于懒加载）
   */
  async getWorkspaceChildren(
    sessionId: string,
    dirPath: string,
  ): Promise<{ children: any[] }> {
    return await this._request(
      `/sessions/${sessionId}/workspace/children?path=${encodeURIComponent(dirPath)}`,
    );
  }

  /**
   * 获取工作目录中的文件内容
   */
  async getWorkspaceFile(
    sessionId: string,
    filePath: string,
  ): Promise<{
    path: string;
    name: string;
    extension: string;
    size: number;
    content: string;
    mimeType: string;
  }> {
    return await this._request(
      `/sessions/${sessionId}/workspace/file?path=${encodeURIComponent(filePath)}`,
    );
  }

  /**
   * 获取工作目录中原始文件的访问 URL（用于图片等资源）
   */
  getWorkspaceRawFileUrl(sessionId: string, filePath: string): string {
    const baseUrl = this.baseURL.replace(/\/$/, '');
    return `${baseUrl}/sessions/${sessionId}/workspace/raw-file?path=${encodeURIComponent(filePath)}`;
  }

  /**
   * 更新会话的工作目录路径
   */
  async updateSessionWorkspacePath(
    sessionId: string,
    workspacePath: string,
  ): Promise<{ success: boolean }> {
    return await this._request(`/sessions/${sessionId}/workspace-path`, {
      method: "PUT",
      data: { workspacePath },
    });
  }

  // ========== 消息管理 ==========
  async deleteMessage(messageId: string): Promise<{ success: boolean }> {
    return await this._request(`/messages/${messageId}`, { method: "DELETE" });
  }

  async updateMessage(messageId: string, data: any): Promise<Message> {
    return await this._request(`/messages/${messageId}`, {
      method: "PUT",
      data,
    });
  }

  async setMessageCurrentContent(
    messageId: string,
    contentId: string,
  ): Promise<any> {
    return await this._request(`/messages/${messageId}/content/${contentId}`, {
      method: "PUT",
    });
  }

  /**
   * 获取消息内容的工具调用详情（完整参数和结果）
   *
   * 用于懒加载：前端列表仅展示摘要，点击弹窗时通过此接口获取完整数据。
   */
  async fetchMessageContentToolDetails(contentId: string): Promise<{
    toolCalls: any[];
    toolCallsResponse: any[];
  }> {
    return await this._request(`/message-content/${contentId}/tool-details`);
  }

  // ========== 流式聊天 ==========
  async *chat(params: {
    sessionId: string;
    regenerationMode?: string | null;
    assistantMessageId?: string | null;
    resumeData?: any;
    // 用户消息参数
    userMessage?: {
      id?: string;
      content?: string;
      files?: string[];
      replaceMessageId?: string;
      knowledgeBaseIds?: string[];
    };
  }): AsyncGenerator<StreamEvent, void, unknown> {
    return yield* this.chatStreamService.chat(params);
  }

  async cancelResponse(sessionId: string): Promise<void> {
    return this.chatStreamService.cancelResponse(sessionId);
  }

  /**
   * 查询会话流状态
   */
  async getStreamStatus(sessionId: string): Promise<{
    isRunning: boolean;
    subscriberCount: number;
    bufferedEventCount: number;
  }> {
    return await this._request(`/chat/stream/${sessionId}/status`);
  }

  // ========== 工作目录实时监听 ==========
  connectWorkspaceWatcher(sessionId: string): void {
    this.workspaceWatcherService.connect(sessionId);
  }

  disconnectWorkspaceWatcher(): void {
    this.workspaceWatcherService.disconnect();
  }

  onWorkspaceChange(callback: (event: FileChangeEvent) => void): () => void {
    return this.workspaceWatcherService.onChange(callback);
  }

  getWorkspaceWatcherSessionId(): string | null {
    return this.workspaceWatcherService.getSessionId();
  }

  /**
   * 更新工作目录展开状态
   * 用于动态调整后端监听范围
   */
  async updateWorkspaceExpandedPaths(sessionId: string, expandedPaths: string[]): Promise<void> {
    await this._request(`/sessions/${sessionId}/workspace/expanded-paths`, {
      method: "POST",
      data: { expandedPaths },
    });
  }

  // ========== 会话事件实时推送 ==========
  connectSessionEvents(): void {
    this.sessionEventsService.connect();
  }

  disconnectSessionEvents(): void {
    this.sessionEventsService.disconnect();
  }

  onSessionEvent(
    eventType: SessionEventType | "*",
    callback: (event: SessionEvent) => void,
  ): () => void {
    return this.sessionEventsService.on(eventType, callback);
  }

  getClientId(): string {
    return getClientId();
  }

  // ========== 文件上传 ==========
  async uploadAvatar(
    uid: string,
    file: File,
    type: "character" | "session" = "character",
  ): Promise<UploadResponse> {
    const formData = new FormData();
    formData.append("avatar", file);

    try {
      const url = type === "character" ? "characters" : "sessions";
      return await this.axiosInstance.post(`/${url}/${uid}/avatars`, formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });
    } catch (error) {
      console.error("上传错误:", error);
      throw error;
    }
  }

  async uploadUserAvatar(file: File): Promise<UploadResponse> {
    const formData = new FormData();
    formData.append("avatar", file);

    try {
      return await this.axiosInstance.post("/user/avatars", formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });
    } catch (error) {
      console.error("上传错误:", error);
      throw error;
    }
  }

  async uploadWallpaper(file: File): Promise<UploadResponse> {
    const formData = new FormData();
    formData.append("wallpaper", file);

    try {
      return await this.axiosInstance.post("/user/wallpaper", formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });
    } catch (error) {
      console.error("壁纸上传错误:", error);
      throw error;
    }
  }

  async deleteWallpaper(): Promise<{ success: boolean }> {
    try {
      return await this.axiosInstance.delete("/user/wallpaper");
    } catch (error) {
      console.error("壁纸删除错误:", error);
      throw error;
    }
  }

  async uploadFile(sessionId: string, file: File): Promise<UploadResponse> {
    const formData = new FormData();
    // 确保文件名在 FormData 中正确编码
    formData.append("file", file, file.name);

    try {
      return await this.axiosInstance.post(
        `/sessions/${sessionId}/files`,
        formData,
        {
          headers: {
            "Content-Type": "multipart/form-data",
          },
        },
      );
    } catch (error) {
      console.error("上传错误:", error);
      throw error;
    }
  }

  async copyMessageFile(messageId: string, fileId: string): Promise<any> {
    return await this._request(`/files/${fileId}`, {
      method: "PUT",
      data: { type: "copy", messageId: messageId },
    });
  }

  async webSearch(messageId: string): Promise<any> {
    return await this._request(`/messages/${messageId}/web_serach`, {
      method: "GET",
    });
  }

  // ========== 认证相关 ==========
  async login(credentials: LoginRequest): Promise<LoginResponse> {
    return await this._request("/auth/login", {
      method: "POST",
      data: credentials,
    });
  }

  async getAutoLoginStatus(): Promise<{ enabled: boolean }> {
    return await this._request("/settings/auto-login");
  }

  async setAutoLoginStatus(enabled: boolean): Promise<void> {
    return await this._request("/settings/auto-login", {
      method: "POST",
      data: { enabled },
    });
  }

  async autoLogin(): Promise<{ accessToken: string; user: User }> {
    return await this._request("/auth/auto-login", { method: "POST" });
  }

  async getProfile(): Promise<User> {
    return await this._request("/user/profile");
  }

  async updateProfile(data: any): Promise<User> {
    return await this._request("/user/profile", { method: "PUT", data });
  }

  async changePassword(oldPassword: string, newPassword: string): Promise<any> {
    return await this._request("/user/password/change", {
      method: "POST",
      data: { oldPassword: oldPassword, newPassword: newPassword },
    });
  }

  async checkResetPassword(): Promise<ResetPasswordCheckResponse> {
    return await this._request("/user/password/reset/check");
  }

  async resetPrimayPassword(data: ResetPasswordRequest): Promise<any> {
    return await this._request("/user/password/reset", {
      method: "POST",
      data,
    });
  }

  // ========== 子账户管理 ==========
  async createSubaccount(data: any): Promise<Subaccount> {
    return await this._request("/subaccounts", { method: "POST", data });
  }

  async updateSubaccount(subaccountId: string, data: any): Promise<Subaccount> {
    return await this._request(`/subaccounts/${subaccountId}`, {
      method: "PUT",
      data,
    });
  }

  async deleteSubaccount(subaccountId: string): Promise<boolean> {
    return await this._request(`/subaccounts/${subaccountId}`, {
      method: "DELETE",
    });
  }

  async fetchSubaccounts(): Promise<Subaccount[]> {
    return await this._request("/subaccounts");
  }

  // ========== 设置管理 ==========
  async fetchSettings(): Promise<GlobalSettings> {
    return await this._request("/settings");
  }

  async updateSettings(data: any): Promise<GlobalSettings> {
    return await this._request("/settings", { method: "PUT", data });
  }

  /**
   * 获取指定分组的设置
   */
  async fetchGroupSettings(group: string): Promise<any> {
    return await this._request(`/settings/${group}`);
  }

  /**
   * 更新指定分组的设置
   */
  async updateGroupSettings(group: string, data: any): Promise<any> {
    return await this._request(`/settings/${group}`, { method: "PUT", data });
  }

  /**
   * 获取全局工作目录基路径
   */
  async fetchWorkspaceBaseDir(): Promise<{ workspaceBaseDir: string | null }> {
    return await this._request("/settings/workspace-base-dir");
  }

  /**
   * 设置全局工作目录基路径
   */
  async updateWorkspaceBaseDir(
    workspaceBaseDir: string | null,
  ): Promise<{ success: boolean }> {
    return await this._request("/settings/workspace-base-dir", {
      method: "PUT",
      data: { workspaceBaseDir },
    });
  }

  async fetchGlobalTools(): Promise<any> {
    return await this._request("/settings/plugins/global");
  }

  async updateGlobalToolStatus(
    pluginId: string,
    enabled: boolean,
  ): Promise<{ success: boolean }> {
    return await this._request("/settings/plugins/global", {
      method: "PUT",
      data: { pluginId, enabled },
    });
  }

  async fetchCharacterTools(characterId: string): Promise<any> {
    return await this._request(`/characters/${characterId}/tools`);
  }

  // ========== MCP 服务器管理 ==========
  async fetchMcpServers(): Promise<PaginatedResponse<McpServer>> {
    return await this._request("/mcp-servers");
  }

  async fetchMcpServer(serverId: string): Promise<McpServer> {
    return await this._request(`/mcp-servers/${serverId}`);
  }

  async fetchMcpServerById(serverId: string): Promise<McpServer> {
    return this.fetchMcpServer(serverId);
  }

  async createMcpServer(data: any): Promise<McpServer> {
    return await this._request("/mcp-servers", { method: "POST", data });
  }

  async updateMcpServer(serverId: string, data: any): Promise<McpServer> {
    return await this._request(`/mcp-servers/${serverId}`, {
      method: "PUT",
      data,
    });
  }

  async deleteMcpServer(serverId: string): Promise<boolean> {
    return await this._request(`/mcp-servers/${serverId}`, {
      method: "DELETE",
    });
  }

  async toggleMcpServer(
    serverId: string,
    enabled: boolean,
  ): Promise<McpServer> {
    return await this._request(`/mcp-servers/${serverId}/toggle`, {
      method: "PATCH",
      data: { enabled },
    });
  }

  async refreshMcpTools(serverId: string): Promise<McpServer> {
    return await this._request(`/mcp-servers/${serverId}/refresh-tools`, {
      method: "POST",
    });
  }

  async getMcpServers(): Promise<PaginatedResponse<McpServer>> {
    return this.fetchMcpServers();
  }

  // ========== Skills 管理 ==========
  /**
   * 获取所有已加载的 Skills 列表
   */
  async fetchSkills(): Promise<PaginatedResponse<any>> {
    return await this._request("/skills");
  }

  /**
   * 获取单个 Skill 详情
   */
  async fetchSkillDetail(skillId: string): Promise<any> {
    return await this._request(`/skills/${skillId}`);
  }

  /**
   * 获取 Skill 的文档内容（SKILL.md）
   */
  async fetchSkillDocumentation(skillId: string): Promise<{ content: string }> {
    return await this._request(`/skills/${skillId}/documentation`);
  }

  /**
   * 触发手动扫描 Skills
   */
  async scanSkills(): Promise<any> {
    return await this._request("/skills/scan", { method: "POST" });
  }

  /**
   * 热加载指定 Skill
   */
  async reloadSkill(skillId: string): Promise<any> {
    return await this._request(`/skills/${skillId}/reload`, { method: "POST" });
  }

  /**
   * 获取自动扫描状态
   */
  async getAutoScanStatus(): Promise<{ enabled: boolean }> {
    return await this._request("/skills/watcher/status");
  }

  /**
   * 切换自动扫描开关
   */
  async toggleAutoScan(enabled: boolean): Promise<{ enabled: boolean }> {
    return await this._request("/skills/watcher/toggle", {
      method: "POST",
      data: { enabled },
    });
  }

  /**
   * 安装 Skill（上传 ZIP 文件）
   */
  async installSkill(
    file: File,
    force: boolean = false,
  ): Promise<{ success: boolean; skillId?: string; message: string }> {
    const formData = new FormData();
    formData.append("file", file);
    if (force) {
      formData.append("force", "true");
    }

    try {
      // 使用 _request 方法确保携带认证信息
      return await this._request("/skills/install", {
        method: "POST",
        data: formData,
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });
    } catch (error) {
      console.error("安装 Skill 失败:", error);
      throw error;
    }
  }

  /**
   * 卸载 Skill
   */
  async uninstallSkill(
    skillId: string,
  ): Promise<{ success: boolean; message: string }> {
    return await this._request(`/skills/${skillId}/uninstall`, {
      method: "POST",
    });
  }

  /**
   * 启用 Skill
   */
  async enableSkill(
    skillId: string,
  ): Promise<{ success: boolean; message: string }> {
    return await this._request(`/skills/${skillId}/enable`, {
      method: "POST",
    });
  }

  /**
   * 禁用 Skill
   */
  async disableSkill(
    skillId: string,
  ): Promise<{ success: boolean; message: string }> {
    return await this._request(`/skills/${skillId}/disable`, {
      method: "POST",
    });
  }

  /**
   * 批量启用/禁用 Skills
   */
  async batchToggleSkills(ids: string[], enabled: boolean): Promise<{ success: boolean; message: string }> {
    return await this._request("/skills/batch-toggle", {
      method: "POST",
      data: { ids, enabled },
    });
  }

  /**
   * 获取所有技能的启用状态
   */
  async fetchSkillsEnabledStatus(): Promise<Array<{ id: string; enabled: boolean }>> {
    return await this._request("/skills/enabled-status");
  }

  // ========== 知识库管理 ==========

  /**
   * 获取知识库列表
   */
  async fetchKnowledgeBases(): Promise<PaginatedResponse<KnowledgeBase>> {
    return await this._request("/knowledge-bases");
  }

  /**
   * 创建知识库
   */
  async createKnowledgeBase(data: {
    name: string;
    description?: string;
    embeddingModelId: string;
    chunkMaxSize?: number;
    chunkOverlapSize?: number;
    chunkMinSize?: number;
    isPublic?: boolean;
  }): Promise<KnowledgeBase> {
    return await this._request("/knowledge-bases", {
      method: "POST",
      data: data,
    });
  }

  /**
   * 更新知识库
   */
  async updateKnowledgeBase(
    kbId: string,
    data: Partial<KnowledgeBase>,
  ): Promise<KnowledgeBase> {
    return await this._request(`/knowledge-bases/${kbId}`, {
      method: "PUT",
      data,
    });
  }

  /**
   * 删除知识库
   */
  async deleteKnowledgeBase(kbId: string): Promise<{ success: boolean }> {
    return await this._request(`/knowledge-bases/${kbId}`, {
      method: "DELETE",
    });
  }

  /**
   * 获取单个知识库详情
   */
  async getKnowledgeBase(kbId: string): Promise<KnowledgeBase> {
    return await this._request(`/knowledge-bases/${kbId}`);
  }

  // ========== 知识库文件管理 ==========

  /**
   * 获取知识库文件列表
   * @param kbId 知识库 ID
   * @param skip 跳过数量（用于分页）
   * @param limit 返回数量限制（用于分页）
   */
  async fetchKBFiles(
    kbId: string,
    skip?: number,
    limit?: number,
  ): Promise<PaginatedResponse<KBFile>> {
    const params = new URLSearchParams();
    if (skip !== undefined) params.append("skip", skip.toString());
    if (limit !== undefined) params.append("limit", limit.toString());

    const queryString = params.toString();
    const url = queryString
      ? `/knowledge-bases/${kbId}/files?${queryString}`
      : `/knowledge-bases/${kbId}/files`;

    return await this._request(url);
  }

  /**
   * 按父文件夹ID获取文件列表(支持懒加载)
   */
  async fetchKBFilesByParent(
    kbId: string,
    parentFolderId: string | null,
    skip?: number,
    limit?: number,
  ): Promise<PaginatedResponse<KBFile>> {
    const params = new URLSearchParams();

    // parentFolderId 为 null 表示根目录
    if (parentFolderId !== null && parentFolderId !== undefined) {
      params.append("parentFolderId", parentFolderId);
    }

    if (skip !== undefined) params.append("skip", skip.toString());
    if (limit !== undefined) params.append("limit", limit.toString());

    const queryString = params.toString();
    const url = queryString
      ? `/knowledge-bases/${kbId}/files/by-parent?${queryString}`
      : `/knowledge-bases/${kbId}/files/by-parent`;

    return await this._request(url);
  }

  /**
   * 通过相对路径获取文件夹内容
   */
  async fetchKBFilesByPath(
    kbId: string,
    relativePath: string | null,
    skip?: number,
    limit?: number,
  ): Promise<PaginatedResponse<KBFile>> {
    const params = new URLSearchParams();

    // relativePath 为空表示根目录
    if (
      relativePath !== null &&
      relativePath !== undefined &&
      relativePath !== ""
    ) {
      params.append("path", relativePath);
    }

    if (skip !== undefined) params.append("skip", skip.toString());
    if (limit !== undefined) params.append("limit", limit.toString());

    const queryString = params.toString();
    const url = queryString
      ? `/knowledge-bases/${kbId}/files/by-path?${queryString}`
      : `/knowledge-bases/${kbId}/files/by-path`;

    return await this._request(url);
  }

  /**
   * 上传文件到知识库
   */
  async uploadKBFile(kbId: string, file: File): Promise<KBFile> {
    const formData = new FormData();
    formData.append("file", file);

    try {
      // 使用 _request 方法确保携带认证信息
      return await this._request(`/knowledge-bases/${kbId}/files/upload`, {
        method: "POST",
        data: formData,
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });
    } catch (error) {
      console.error("上传文件失败:", error);
      throw error;
    }
  }

  /**
   * 获取文件详情
   */
  async getKBFile(kbId: string, fileId: string): Promise<KBFile> {
    return await this._request(`/knowledge-bases/${kbId}/files/${fileId}`);
  }

  /**
   * 删除知识库文件
   */
  async deleteKBFile(
    kbId: string,
    fileId: string,
  ): Promise<{ success: boolean }> {
    return await this._request(`/knowledge-bases/${kbId}/files/${fileId}`, {
      method: "DELETE",
    });
  }

  /**
   * 重命名知识库文件
   */
  async renameKBFile(
    kbId: string,
    fileId: string,
    newName: string,
  ): Promise<{ success: boolean; message: string; data: any }> {
    return await this._request(
      `/knowledge-bases/${kbId}/files/${fileId}/rename`,
      {
        method: "POST",
        data: { newName },
      },
    );
  }

  /**
   * 移动知识库文件
   */
  async moveKBFile(
    kbId: string,
    fileId: string,
    targetParentFolderId: string | null,
  ): Promise<{ success: boolean; message: string; data: any }> {
    return await this._request(
      `/knowledge-bases/${kbId}/files/${fileId}/move`,
      {
        method: "POST",
        data: { targetParentFolderId },
      },
    );
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
      method: "POST",
      data: { folderName, parentFolderId },
    });
  }

  /**
   * 查询文件处理状态
   */
  async getFileProcessingStatus(kbId: string, fileId: string): Promise<KBFile> {
    return await this._request(
      `/knowledge-bases/${kbId}/files/${fileId}/status`,
    );
  }

  /**
   * 批量查询文件处理状态（推荐用于多文件轮询）
   * @param kbId 知识库 ID
   * @param fileIds 文件 ID 列表
   * @returns 文件状态列表
   */
  async batchGetFileProcessingStatus(
    kbId: string,
    fileIds: string[],
  ): Promise<KBFile[]> {
    return await this._request(`/knowledge-bases/${kbId}/files/status/batch`, {
      method: "POST",
      data: { fileIds: fileIds },
    });
  }

  /**
   * 重新处理文件（用于失败或已完成的文件）
   * @param kbId 知识库 ID
   * @param fileId 文件 ID
   * @returns 操作结果
   */
  async retryKBFile(
    kbId: string,
    fileId: string,
  ): Promise<{ success: boolean; message: string }> {
    return await this._request(
      `/knowledge-bases/${kbId}/files/${fileId}/retry`,
      {
        method: "POST",
      },
    );
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
    limit: number = 10,
  ): Promise<any[]> {
    return await this._request(
      `/knowledge-bases/${kbId}/files/${fileId}/chunks?skip=${skip}&limit=${limit}`,
    );
  }

  // ========== 知识库搜索 ==========

  /**
   * 在知识库中搜索
   */
  async searchKnowledgeBase(
    kbId: string,
    query: string,
    topK: number = 5,
    filterFileId?: string,
  ): Promise<any> {
    return await this._request(`/knowledge-bases/${kbId}/search`, {
      method: "POST",
      data: {
        query,
        topK: topK,
        filterFileId: filterFileId,
      },
    });
  }

  // ========== 机器人管理 ==========

  /**
   * 获取所有支持的平台列表(包含配置字段定义)
   */
  async fetchBotPlatforms(): Promise<PlatformMetadata[]> {
    return await this._request("/bot-admin/platforms");
  }

  /**
   * 获取当前用户的所有机器人实例列表
   */
  async fetchBotInstances(): Promise<BotInstance[]> {
    return await this._request("/bot-admin/instances");
  }

  /**
   * 获取单个机器人详情
   */
  async fetchBotInstance(id: string): Promise<BotInstance> {
    return await this._request(`/bot-admin/instances/${id}`);
  }

  /**
   * 创建新机器人
   */
  async createBotInstance(data: CreateBotRequest): Promise<BotInstance> {
    return await this._request("/bot-admin/instances", {
      method: "POST",
      data,
    });
  }

  /**
   * 更新机器人配置
   */
  async updateBotInstance(
    id: string,
    data: UpdateBotRequest,
  ): Promise<BotInstance> {
    return await this._request(`/bot-admin/instances/${id}`, {
      method: "PUT",
      data,
    });
  }

  /**
   * 启动机器人
   */
  async startBotInstance(id: string): Promise<{ success: boolean }> {
    return await this._request(`/bot-admin/instances/${id}/start`, {
      method: "POST",
    });
  }

  /**
   * 停止机器人
   */
  async stopBotInstance(id: string): Promise<{ success: boolean }> {
    return await this._request(`/bot-admin/instances/${id}/stop`, {
      method: "POST",
    });
  }

  /**
   * 重启机器人
   */
  async restartBotInstance(id: string): Promise<{ success: boolean }> {
    return await this._request(`/bot-admin/instances/${id}/restart`, {
      method: "POST",
    });
  }

  /**
   * 获取机器人登录二维码状态
   * @returns status: 'logged_in' | 'qr_ready' | 'pending' | 'unavailable'
   */
  async fetchBotQrCode(id: string): Promise<
    | { status: 'qr_ready'; qrCodeUrl: string }
    | { status: 'logged_in' | 'pending' | 'unavailable'; message: string }
  > {
    return await this._request(`/bot-admin/instances/${id}/qr`);
  }

  /**
   * 退出机器人登录
   */
  async logoutBot(id: string): Promise<{ success: boolean; message: string }> {
    return await this._request(`/bot-admin/instances/${id}/logout`, {
      method: 'POST',
    });
  }

  /**
   * 删除机器人
   */
  async deleteBotInstance(id: string): Promise<{ success: boolean }> {
    return await this._request(`/bot-admin/instances/${id}`, {
      method: "DELETE",
    });
  }

  /**
   * 获取 Bot 专属会话列表（sessionType='bot'）
   */
  async fetchBotSessions(
    skip?: number,
    limit?: number,
    botId?: string,
  ): Promise<PaginatedResponse<Session>> {
    const params = new URLSearchParams();
    if (skip !== undefined) params.append("skip", skip.toString());
    if (limit !== undefined) params.append("limit", limit.toString());
    if (botId) params.append("botId", botId);

    const queryString = params.toString();
    const url = queryString
      ? `/bot-admin/sessions?${queryString}`
      : "/bot-admin/sessions";

    return await this._request(url);
  }

  // ========== 定时任务管理 ==========

  async fetchScheduledTasks(): Promise<PaginatedResponse<any>> {
    return await this._request("/scheduler/tasks");
  }

  async fetchScheduledTask(taskId: string): Promise<any> {
    return await this._request(`/scheduler/tasks/${taskId}`);
  }

  async createScheduledTask(data: any): Promise<any> {
    return await this._request("/scheduler/tasks", { method: "POST", data });
  }

  async updateScheduledTask(taskId: string, data: any): Promise<any> {
    return await this._request(`/scheduler/tasks/${taskId}`, {
      method: "PUT",
      data,
    });
  }

  async deleteScheduledTask(taskId: string): Promise<void> {
    return await this._request(`/scheduler/tasks/${taskId}`, {
      method: "DELETE",
    });
  }

  async toggleScheduledTask(taskId: string): Promise<any> {
    return await this._request(`/scheduler/tasks/${taskId}/toggle`, {
      method: "POST",
    });
  }

  async runScheduledTask(taskId: string): Promise<{ success: boolean; message: string }> {
    return await this._request(`/scheduler/tasks/${taskId}/run`, {
      method: "POST",
    });
  }

  async testScheduledTask(taskId: string): Promise<{ success: boolean; message: string }> {
    return await this._request(`/scheduler/tasks/${taskId}/test`, {
      method: "POST",
    });
  }

  async fetchScheduledTaskLogs(taskId: string): Promise<PaginatedResponse<any>> {
    return await this._request(`/scheduler/tasks/${taskId}/logs`);
  }

  async fetchCronPresets(): Promise<{ label: string; value: string }[]> {
    return await this._request("/scheduler/cron-presets");
  }

  // ========== 工具方法 ============
  debounce<T extends (...args: any[]) => any>(func: T, delay: number): T {
    let timer: number | undefined;
    return function (this: any, ...args: Parameters<T>) {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        func.apply(this, args);
      }, delay);
    } as T;
  }
}

/**
 * 创建 API Service 实例（同步）
 * - 生产环境：直接使用真实 ApiService
 * - 开发环境：根据配置决定是否启用 Mock
 */
function createApiServiceInstance() {
  // 不传 baseURL，让构造函数自动检测环境
  const realService = new ApiService();

  // 生产环境强制使用真实服务
  if (import.meta.env.PROD) {
    console.log("生产环境：使用真实 API Service");
    return realService;
  }

  // 开发环境：检查是否启用 Mock
  const enabled = shouldEnableMock();

  if (!enabled) {
    console.log("开发环境：使用真实 API Service（Mock 已禁用）");
    return realService;
  }

  console.log("开发环境：使用 Mock API Service（配置将在首次调用时加载）");

  // 创建包装后的实例，仅覆盖 chat 和 createMessage 方法
  // 使用 Object.create 确保原型链正确继承
  const mockService = Object.create(Object.getPrototypeOf(realService));

  // 复制所有实例属性
  Object.assign(mockService, realService);

  // 获取 Mock 方法集合
  const mockMethods = createMockMethods();

  // 覆盖 chat 和 createMessage 方法
  mockService.chat = mockMethods.chat;
  mockService.createMessage = mockMethods.createMessage;

  return mockService;
}

// 创建默认实例并导出（同步创建，无竞态条件）
export let apiService: ApiService = createApiServiceInstance();

/**
 * 重新初始化 API Service（用于动态切换 Mock 模式）
 * 调用此方法后，需要刷新页面或重新获取 apiService
 */
export function reinitApiService() {
  apiService = createApiServiceInstance();
  console.log("🔄 API Service 已重新初始化");
  return apiService;
}
