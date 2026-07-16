/**
 * API 客户端服务
 * 提供完整的后端 API 接口调用
 *
 * 领域方法按模块拆分到 services/modules/*.api.ts，
 * 通过 Object.assign 挂载到原型，通过 interface 声明合并保证类型安全。
 */

import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
} from "axios";
import { useStorage } from "@vueuse/core";
import type { StreamEvent } from "@/types/service";
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

// 领域 API 模块
import { modelApi, type ModelApi } from "./modules/model.api";
import { characterApi, type CharacterApi } from "./modules/character.api";
import { sessionApi, type SessionApi } from "./modules/session.api";
import { workspaceApi, type WorkspaceApi } from "./modules/workspace.api";
import { messageApi, type MessageApi } from "./modules/message.api";
import { fileUploadApi, type FileUploadApi } from "./modules/file-upload.api";
import { authApi, type AuthApi } from "./modules/auth.api";
import { settingsApi, type SettingsApi } from "./modules/settings.api";
import { mcpApi, type McpApi } from "./modules/mcp.api";
import { skillsApi, type SkillsApi } from "./modules/skills.api";
import { knowledgeBaseApi, type KnowledgeBaseApi } from "./modules/knowledge-base.api";
import { botApi, type BotApi } from "./modules/bot.api";
import { schedulerApi, type SchedulerApi } from "./modules/scheduler.api";

export type { FileChangeEvent };
export type { SessionEvent, SessionEventType };

/**
 * 通过 interface 声明合并，让 ApiService 类型包含所有领域方法。
 */
interface ApiService
  extends ModelApi,
    CharacterApi,
    SessionApi,
    WorkspaceApi,
    MessageApi,
    FileUploadApi,
    AuthApi,
    SettingsApi,
    McpApi,
    SkillsApi,
    KnowledgeBaseApi,
    BotApi,
    SchedulerApi {}

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
      this.baseURL = "http://localhost:3000/api/v1";
    } else {
      this.baseURL = "/api/v1";
    }

    this.tokenStore = useStorage("token", "");

    // 创建 Axios 实例
    this.axiosInstance = axios.create({
      baseURL: this.baseURL,
      timeout: 60000,
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

        if (
          error.code === "ECONNREFUSED" ||
          error.code === "ERR_CONNECTION_REFUSED" ||
          !error.response
        ) {
          console.warn("后端服务连接失败，请稍后重试");
          const networkError = new Error(
            "无法连接到后端服务，请确保应用已完全启动",
          );
          (networkError as any).isNetworkError = true;
          throw networkError;
        }

        if (
          error.response?.status === 401 &&
          !error.config?.url?.includes("/auth/login")
        ) {
          const authError = new Error("Authentication required");
          (authError as any).isAuthError = true;
          (authError as any).statusCode = 401;

          setTimeout(() => {
            import("@/utils/globalErrorHandler").then(
              ({ triggerAuthRedirect }) => {
                triggerAuthRedirect();
              },
            );
          }, 0);

          return Promise.reject(authError);
        }

        let errorMessage = "请求失败";
        if (error.response?.data) {
          const responseData = error.response.data;
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
        const token =
          sessionStorage.getItem("token") || localStorage.getItem("token");
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
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
      return;
    }

    try {
      const info = await window.electronAPI!.getAppInfo();
      if (info.backendPort) {
        this.baseURL = `http://localhost:${info.backendPort}/api/v1`;
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
      return response as T;
    } catch (error) {
      console.error(`API 请求失败：${endpoint}`, error);
      throw error;
    }
  }

  // ========== 流式聊天 ==========
  async *chat(params: {
    sessionId: string;
    regenerationMode?: string | null;
    assistantMessageId?: string | null;
    resumeData?: any;
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

// 将领域方法挂载到原型
Object.assign(
  ApiService.prototype,
  modelApi,
  characterApi,
  sessionApi,
  workspaceApi,
  messageApi,
  fileUploadApi,
  authApi,
  settingsApi,
  mcpApi,
  skillsApi,
  knowledgeBaseApi,
  botApi,
  schedulerApi,
);

/**
 * 创建 API Service 实例（同步）
 * - 生产环境：直接使用真实 ApiService
 * - 开发环境：根据配置决定是否启用 Mock
 */
function createApiServiceInstance() {
  const realService = new ApiService();

  if (import.meta.env.PROD) {
    console.log("生产环境：使用真实 API Service");
    return realService;
  }

  const enabled = shouldEnableMock();

  if (!enabled) {
    console.log("开发环境：使用真实 API Service（Mock 已禁用）");
    return realService;
  }

  console.log("开发环境：使用 Mock API Service（配置将在首次调用时加载）");

  const mockService = Object.create(Object.getPrototypeOf(realService));
  Object.assign(mockService, realService);

  const mockMethods = createMockMethods();
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
