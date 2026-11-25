/**
 * API 客户端服务
 * 提供完整的后端 API 接口调用
 *
 * 领域方法按模块拆分到 services/modules/*.api.ts，
 * 通过 Object.assign 挂载到原型，通过 interface 声明合并保证类型安全。
 */
/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging -- interface+class 同名声明合并正是本文件给 ApiService 补全领域方法类型的既定手法 */

import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
} from "axios";
import { useStorage } from "@vueuse/core";
import { getClientId } from "@/utils/clientId";
import { NetworkError, AuthError, ApiError } from "@/utils/errors";
import { t } from "@/locales";
import {
  ChatStreamService,
  type ChatStreamParams,
  type ChatStreamResponse,
} from "./modules/ChatStreamService";
import {
  WorkspaceWatcherService,
  type FileChangeEvent,
} from "./modules/WorkspaceWatcherService";
import {
  SessionEventsService,
  type SessionEvent,
  type SessionEventType,
  type SidebarStateListener,
  type SidebarStateSnapshot,
} from "./modules/SessionEventsService";
import type { SessionSnapshotPayload } from "./modules/sessionSnapshot";
import { generateUuid } from "@/utils/uuid";
import { createMockMethods, shouldEnableMock } from "./mock/MockApiService";

// 领域 API 模块
import { modelApi, type ModelApi } from "./modules/model.api";
import { agentApi, type AgentApi } from "./modules/agent.api";
import { sessionApi, type SessionApi } from "./modules/session.api";
import {
  sessionQueueApi,
  type SessionQueueApi,
} from "./modules/session-queue.api";
import { workspaceApi, type WorkspaceApi } from "./modules/workspace.api";
import { messageApi, type MessageApi } from "./modules/message.api";
import { trajectoryApi, type TrajectoryApi } from "./modules/trajectory.api";
import { fileUploadApi, type FileUploadApi } from "./modules/file-upload.api";
import { authApi, type AuthApi } from "./modules/auth.api";
import { settingsApi, type SettingsApi } from "./modules/settings.api";
import { policyApi, type PolicyApi } from "./modules/policy.api";
import { capabilitiesApi, type CapabilitiesApi } from "./modules/capabilities.api";
import { mcpApi, type McpApi } from "./modules/mcp.api";
import { mcpMarketApi, type McpMarketApi } from "./modules/mcpMarket.api";
import { skillHubMarketApi, type SkillHubMarketApi } from "./modules/skillHubMarket.api";
import { skillsApi, type SkillsApi } from "./modules/skills.api";
import { knowledgeBaseApi, type KnowledgeBaseApi } from "./modules/knowledge-base.api";
import { botApi, type BotApi } from "./modules/bot.api";
import { schedulerApi, type SchedulerApi } from "./modules/scheduler.api";
import { pluginApi, type PluginApi } from "./modules/plugin.api";
import { remoteWorkspaceApi, type RemoteWorkspaceApi } from "./modules/remote-workspace.api";
import { fsApi, type FsApi } from "./modules/fs.api";
import { gitApi, type GitApi } from "./modules/git.api";
import { usageApi, type UsageApi } from "./modules/usage.api";
import { mobileAccessApi, type MobileAccessApi } from "./modules/mobile-access.api";
import { claudeImportApi, type ClaudeImportApi } from "./modules/claude-import.api";

export type { FileChangeEvent };
export type { SessionEvent, SessionEventType };
export type { UiJobInfo, UiJobOutput } from "./modules/session.api";

/**
 * JSON body 解析器（axios transformResponse）：JSON.parse 失败返回标记对象（含 body
 * 摘要）而非 axios 默认的"静默降级为原始字符串"——后者曾让调用方把 string 当解析
 * 结果用（移动端"加载消息失败 Se.events is not iterable"）。空 body 归一为 null。
 */
export function parseJsonBody(data: unknown): unknown {
  if (typeof data !== "string") return data;
  const trimmed = data.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return { __invalidJson: true, snippet: trimmed.slice(0, 160) };
  }
}

/**
 * 通过 interface 声明合并，让 ApiService 类型包含所有领域方法。
 */
interface ApiService
  extends ModelApi,
    AgentApi,
    SessionApi,
    SessionQueueApi,
    WorkspaceApi,
    MessageApi,
    TrajectoryApi,
    FileUploadApi,
    AuthApi,
    SettingsApi,
    PolicyApi,
    CapabilitiesApi,
    McpApi,
    McpMarketApi,
    SkillHubMarketApi,
    SkillsApi,
    KnowledgeBaseApi,
    BotApi,
    SchedulerApi,
    PluginApi,
    RemoteWorkspaceApi,
    FsApi,
    GitApi,
    UsageApi,
    MobileAccessApi,
    ClaudeImportApi {}

/**
 * 把数据里的 http://localhost:<port>/ 前缀资源 URL 改写为相对路径。
 * 仅用于 Web（局域网访问）模式：后端 auto BASE_URL 下发的绝对资源 URL 指向
 * 后端本机的 localhost，手机等局域网客户端无法解析。改写为相对路径后由浏览器
 * 按当前页面 origin 解析（局域网模式下前端就由后端 serve，同源即后端）。
 * 浅递归遍历字符串字段，只命中 http://localhost: 开头的值，其余原样保留。
 */
function rewriteLocalhostUrls(data: unknown, depth = 0): void {
  if (!data || depth > 4) return;
  if (Array.isArray(data)) {
    for (const item of data) rewriteLocalhostUrls(item, depth + 1);
    return;
  }
  if (typeof data !== "object") return;
  for (const key of Object.keys(data as Record<string, unknown>)) {
    const value = (data as Record<string, unknown>)[key];
    if (typeof value === "string" && value.startsWith("http://localhost:")) {
      try {
        const url = new URL(value);
        (data as Record<string, unknown>)[key] = url.pathname + url.search + url.hash;
      } catch {
        // 非法 URL 原样保留
      }
    } else if (value && typeof value === "object") {
      rewriteLocalhostUrls(value, depth + 1);
    }
  }
}

class ApiService {
  baseURL: string;
  /** useStorage('token') 的引用（读写 .value） */
  tokenStore: { value: string };
  axiosInstance: AxiosInstance;
  chatStreamService: ChatStreamService;
  workspaceWatcherService: WorkspaceWatcherService;
  sessionEventsService: SessionEventsService;
  /** Electron 环境下后端地址是否已初始化（幂等标记） */
  private backendUrlInitialized = false;

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
      // 默认 transformResponse 在 JSON.parse 失败时静默返回原始字符串：移动端弱网/
      // 后台唤醒后的半开连接、或网络中间层注入 200+HTML 时，业务代码会把 string 当
      // 解析结果用（曾致“加载消息失败 Se.events is not iterable”）。这里显式标记
      // 解析失败，由响应拦截器统一 reject；空 body 归一为 null。
      transformResponse: [parseJsonBody],
    });

    // 添加响应拦截器处理通用错误
    this.axiosInstance.interceptors.response.use(
      (response: AxiosResponse) => {
        // transformResponse 标记的解析失败：2xx 但 body 不是 JSON（中间层注入/响应截断）
        const body = response.data as
          | { __invalidJson?: boolean; snippet?: string }
          | null
          | undefined;
        if (body && typeof body === "object" && body.__invalidJson) {
          console.error("API 返回非 JSON 响应体:", body.snippet);
          throw new ApiError(
            `${t("session.api.invalidJsonBody")}: ${body.snippet}`,
            response.status,
          );
        }
        // Web（局域网访问）模式：后端 auto BASE_URL 把资源 URL 定格成
        // http://localhost:<port>/uploads/...，手机浏览器解析不了 localhost，
        // 改写为相对路径
        if (
          typeof window !== "undefined" &&
          window.electronAPI === undefined &&
          response.data
        ) {
          rewriteLocalhostUrls(response.data);
        }
        // 空 body（204/空串）归一为 null：原来 `data ? data : response` 会把整个
        // AxiosResponse 对象当业务结果返回（无业务字段 → 调用方解构报错）
        return response.data ?? null;
      },
      (error) => {
        console.error("API 请求失败:", error);

        if (
          error.code === "ECONNREFUSED" ||
          error.code === "ERR_CONNECTION_REFUSED" ||
          !error.response
        ) {
          console.warn("后端服务连接失败，请稍后重试");
          throw new NetworkError(
            t("session.api.cannotConnect"),
          );
        }

        if (
          error.response?.status === 401 &&
          !error.config?.url?.includes("/auth/login")
        ) {
          const authError = new AuthError("Authentication required", 401);

          setTimeout(() => {
            import("@/utils/globalErrorHandler").then(
              ({ triggerAuthRedirect }) => {
                triggerAuthRedirect();
              },
            );
          }, 0);

          return Promise.reject(authError);
        }

        let errorMessage = t("session.api.requestFailed");
        if (error.response?.data) {
          const responseData = error.response.data;
          if (responseData.message) {
            errorMessage =
              typeof responseData.message === "string"
                ? responseData.message
                : responseData.message.error || t("session.api.requestFailed");
          } else if (responseData.error) {
            errorMessage = responseData.error;
          }
        }

        throw new ApiError(errorMessage, error.response?.status);
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
    this.sessionEventsService = new SessionEventsService(() => this.baseURL);
    this.workspaceWatcherService = new WorkspaceWatcherService(
      this.sessionEventsService,
    );
  }

  /**
   * 初始化后端地址（针对 Electron 环境）
   * @param knownPort 已同步获取到的后端端口；传入时直接同步设置 baseURL，避免异步 IPC 竞态
   */
  async initBackendUrl(knownPort?: number | null): Promise<void> {
    const isElectron =
      typeof window !== "undefined" && window.electronAPI !== undefined;
    if (isElectron && !this.baseURL.includes("localhost:3000")) {
      return;
    }

    // 刷新场景：端口已通过同步 IPC 拿到，直接设置，无需再走异步 getAppInfo()
    if (knownPort) {
      this.baseURL = `http://localhost:${knownPort}/api/v1`;
      this.axiosInstance.defaults.baseURL = this.baseURL;
      this.backendUrlInitialized = true;
      console.log(`🔗 API 服务已连接到后端端口: ${knownPort}`);
      return;
    }

    try {
      const info = await window.electronAPI!.getAppInfo();
      if (info.backendPort) {
        this.baseURL = `http://localhost:${info.backendPort}/api/v1`;
        this.axiosInstance.defaults.baseURL = this.baseURL;
        this.backendUrlInitialized = true;
        console.log(`🔗 API 服务已连接到后端端口: ${info.backendPort}`);
      }
    } catch (error) {
      console.error("❌ 获取后端端口失败:", error);
    }
  }

  /**
   * 确保后端地址已初始化（幂等）。
   * Electron 环境下任何请求发出前等待端口确定，避免抢在默认 localhost:3000 上
   */
  async ensureBackendUrlReady(): Promise<void> {
    if (this.backendUrlInitialized) return;
    const isElectron =
      typeof window !== "undefined" && window.electronAPI !== undefined;
    if (!isElectron) return;
    await this.initBackendUrl();
  }

  /**
   * 通用请求方法
   * 泛型默认保持 any：这是 API 层唯一的动态逃逸口 —— 16 个领域模块与个别组件
   * （如 LocalTools）存在 80+ 处不带泛型实参的裸调用，依赖默认 any 落到各自的
   * 接口声明返回类型上；改成 unknown 会把错误成片推向本任务范围外的文件。
   */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 白名单：动态边界，见上方说明
  async _request<T = any>(
    endpoint: string,
    options?: AxiosRequestConfig,
  ): Promise<T> {
    // Electron 环境下确保后端地址已初始化，避免请求抢在端口就绪前发出
    await this.ensureBackendUrlReady();
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
  /** 触发后端流(合并后为 RPC,立即返回;流式事件经全局 SSE → StreamEventHub) */
  async chat(params: ChatStreamParams): Promise<ChatStreamResponse> {
    return this.chatStreamService.chat(params);
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
  connectWorkspaceWatcher(sessionId: string, onConnected?: () => void): void {
    this.workspaceWatcherService.connect(sessionId, onConnected);
  }

  disconnectWorkspaceWatcher(): void {
    this.workspaceWatcherService.disconnect();
  }

  onWorkspaceChange(callback: (event: FileChangeEvent) => void): () => void {
    return this.workspaceWatcherService.onChange(callback);
  }

  /**
   * 设置 watcher 订阅范围（连接级；SSE 断开时后端自动清除本页订阅，
   * 重连成功后由客户端自动重放，调用方无需重建）
   */
  setWorkspaceWatchScope(
    sessionId: string,
    scope: "file" | "git",
    enabled: boolean,
  ): Promise<void> {
    return this.workspaceWatcherService.setWatchScope(sessionId, scope, enabled);
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

  /**
   * 带内打开会话历史：POST 只负责触发，历史快照 + 后续事件从同一条 SSE 返回。
   *
   * 消除"读的事件页 vs 并发的 live 帧"的往返竞态——读页期间的帧由服务端
   * 按连接积压，快照先落地、随后按序排空，客户端不再需要邮箱抑或 stash。
   *
   * SSE 是基础设施：未连接时先短暂等待建连，超时/409/读页失败直接抛错，
   * 调用方保留 loaded=false，由 resync/重开重试（没有 HTTP 降级路径）。
   */
  async requestSessionSnapshot(
    sessionId: string,
    options: { turns?: number; beforeSeq?: number } = {},
    timeoutMs = 10_000,
  ): Promise<SessionSnapshotPayload> {
    await this.sessionEventsService.waitUntilConnected();
    if (!this.sessionEventsService.isConnected()) {
      throw new Error("SSE_NOT_CONNECTED");
    }
    const requestId = generateUuid();
    return (await this.sessionEventsService.requestOpen(sessionId, {
      requestId,
      ...options,
    }, timeoutMs)) as SessionSnapshotPayload;
  }

  // ========== 侧栏结构修订号 ==========

  onSidebarState(listener: SidebarStateListener): () => void {
    return this.sessionEventsService.onSidebarState(listener);
  }

  getSidebarState(): SidebarStateSnapshot | null {
    return this.sessionEventsService.getSidebarState();
  }

  getSidebarStateKey(): string | null {
    return this.sessionEventsService.getSidebarStateKey();
  }

  /** 主动核对一次侧栏修订号（周期兜底由 SessionEventsService 内部定时触发） */
  requestSidebarStateCheck(): void {
    this.sessionEventsService.requestSidebarStateCheck();
  }

  /** 声明关注某会话（内容帧只下发给关注者）；重连后自动重放 */
  watchSession(sessionId: string): void {
    this.sessionEventsService.watchSession(sessionId);
  }

  /** 返回 true 表示已无消费者，该会话的内容订阅已停止。 */
  unwatchSession(sessionId: string): boolean {
    return this.sessionEventsService.unwatchSession(sessionId);
  }

  /** workspace 控制面（文件/git 订阅范围） */
  setWorkspaceWatch(
    sessionId: string,
    scopes: string[],
    enabled = true,
  ): void {
    this.sessionEventsService.setWorkspaceWatch(sessionId, scopes, enabled);
  }

  onWorkspaceEvent(callback: (event: any) => void): () => void {
    return this.sessionEventsService.onWorkspaceEvent(callback);
  }

  /** （重）建连监听（返回取消订阅函数）：用于补拉挂起中的交互卡等 */
  onConnected(callback: () => void): () => void {
    return this.sessionEventsService.onConnected(callback);
  }

  /** SSE 连接被判死（polyfill 放弃重试，常见于 401）时通知，用于触发鉴权校验 */
  onSessionEventsFatal(callback: () => void): () => void {
    return this.sessionEventsService.onConnectionFatal(callback);
  }

  getClientId(): string {
    return getClientId();
  }

  // ========== 工具方法 ============
  debounce<T extends (...args: never[]) => unknown>(func: T, delay: number): T {
    let timer: number | undefined;
    return function (this: ThisParameterType<T>, ...args: Parameters<T>) {
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
  agentApi,
  sessionApi,
  sessionQueueApi,
  workspaceApi,
  messageApi,
  trajectoryApi,
  fileUploadApi,
  authApi,
  settingsApi,
  policyApi,
  capabilitiesApi,
  mcpApi,
  mcpMarketApi,
  skillHubMarketApi,
  skillsApi,
  knowledgeBaseApi,
  botApi,
  schedulerApi,
  pluginApi,
  remoteWorkspaceApi,
  fsApi,
  gitApi,
  usageApi,
  mobileAccessApi,
  claudeImportApi,
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
