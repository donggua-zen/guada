/**
 * 工作目录实时监听服务
 * 通过 SSE 连接监听指定会话的工作目录文件变化
 */

import { EventSourcePolyfill } from "event-source-polyfill";
import { getClientId } from "@/utils/clientId";

/**
 * 工作目录文件变化事件
 */
export interface FileChangeEvent {
  /** git = git 状态可能已变化（.git 目录变化，或工作树文件被增删改），消费方应刷新 git 状态 */
  type: "add" | "change" | "unlink" | "addDir" | "unlinkDir" | "heartbeat" | "git";
  path: string;
  sessionId: string;
  timestamp: number;
}

/** 订阅范围（与后端 POST /workspace/watch 的 scope 对齐） */
export type WatchScope = "file" | "git";

/** polyfill 放弃连接后自行重建的延迟（避免后端重启期间打满请求） */
const RECONNECT_DELAY_MS = 3000;
/** EventSource.CLOSED */
const READY_STATE_CLOSED = 2;

export class WorkspaceWatcherService {
  private eventSource: EventSourcePolyfill | null = null;
  private listeners: Set<(event: FileChangeEvent) => void> = new Set();
  private currentSessionId: string | null = null;
  private currentClientId: string;
  /**
   * 期望订阅范围（按会话）。
   * 后端把 scope 记在「连接」上，SSE 一断开该 clientId 的 scope 就被清空
   * （releaseConnection），因此重连后必须重放，否则 watcher 静默停用、
   * 文件变更事件全部丢失直到组件重新挂载。
   */
  private desiredScopes: Map<string, Set<WatchScope>> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private getBaseURL: () => string) {
    // 使用页面级客户端标识，同一页面内的 SSE 和普通请求保持一致
    this.currentClientId = getClientId();
  }

  /**
   * 获取当前客户端 ID
   */
  getClientId(): string {
    return this.currentClientId;
  }

  /**
   * 连接到指定会话的工作目录事件流（SSE）
   */
  connect(sessionId: string, onConnected?: () => void): void {
    // 如果已连接同一会话，不做任何操作
    if (this.currentSessionId === sessionId && this.eventSource) {
      return;
    }

    // 断开现有连接：切到别的会话才作废期望订阅，同一会话重连需保留以便 onopen 重放
    this.teardown(this.currentSessionId !== sessionId);

    this.currentSessionId = sessionId;

    const token = localStorage.getItem("token") || sessionStorage.getItem("token") || "";
    const url = `${this.getBaseURL()}/sessions/${sessionId}/workspace/events`;
    const eventSource = new EventSourcePolyfill(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Client-Id": this.currentClientId,
      },
      heartbeatTimeout: 180000,
    });
    this.eventSource = eventSource;

    eventSource.onopen = () => {
      if (this.eventSource !== eventSource) {
        return;
      }
      console.log("[WorkspaceWatcher] SSE 连接已建立");
      // 重连同样会走到这里：后端已清掉该 clientId 的 scope，必须重放
      void this.replayScopes(sessionId);
      onConnected?.();
    };

    eventSource.onmessage = (event) => {
      if (this.eventSource !== eventSource) {
        return;
      }
      try {
        const data = JSON.parse(event.data) as FileChangeEvent;
        if (data.sessionId && data.sessionId !== this.currentSessionId) {
          return;
        }
        this.notifyListeners(data);
      } catch (error) {
        console.error("[WorkspaceWatcher] 解析事件失败:", error);
      }
    };

    eventSource.onerror = (error) => {
      if (this.eventSource !== eventSource) {
        return;
      }
      console.error("[WorkspaceWatcher] SSE 连接错误:", error);
      // polyfill 会自行重连；只有它已放弃（CLOSED）时才自行重建，
      // 重建走同一条 onopen → 重放 scope 的路径
      if (eventSource.readyState === READY_STATE_CLOSED) {
        this.scheduleReconnect(sessionId, eventSource);
      }
    };
  }

  /**
   * 断开工作目录监听连接（离开会话：期望订阅一并作废）
   */
  disconnect(): void {
    this.teardown(true);
  }

  /**
   * 关闭 SSE 连接并清空会话标记。
   * @param clearDesiredScopes 是否同时作废该会话的期望订阅
   *   （离开会话为是；同一会话重连为否——重连后要重放这些订阅）
   */
  private teardown(clearDesiredScopes: boolean): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    if (clearDesiredScopes && this.currentSessionId) {
      this.desiredScopes.delete(this.currentSessionId);
    }
    this.currentSessionId = null;
  }

  /**
   * 设置 watcher 订阅范围（连接级）：后端按本页 clientId 计数；
   * SSE 断开时该 clientId 的全部订阅自动清除。scope = 'file' | 'git'
   */
  async setWatchScope(
    sessionId: string,
    scope: WatchScope,
    enabled: boolean,
  ): Promise<void> {
    const scopes = this.desiredScopes.get(sessionId) ?? new Set<WatchScope>();
    if (enabled) {
      scopes.add(scope);
    } else {
      scopes.delete(scope);
    }
    if (scopes.size > 0) {
      this.desiredScopes.set(sessionId, scopes);
    } else {
      this.desiredScopes.delete(sessionId);
    }

    await this.postWatchScope(sessionId, scope, enabled);
  }

  /**
   * 注册文件变化监听器
   */
  onChange(callback: (event: FileChangeEvent) => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * 获取当前工作目录监听的会话ID
   */
  getSessionId(): string | null {
    return this.currentSessionId;
  }

  /** 重放当前会话的全部期望订阅（幂等：后端 scope 是集合语义） */
  private async replayScopes(sessionId: string): Promise<void> {
    const scopes = this.desiredScopes.get(sessionId);
    if (!scopes || scopes.size === 0) {
      return;
    }
    for (const scope of scopes) {
      await this.postWatchScope(sessionId, scope, true);
    }
  }

  private async postWatchScope(
    sessionId: string,
    scope: WatchScope,
    enabled: boolean,
  ): Promise<void> {
    try {
      const token =
        localStorage.getItem("token") || sessionStorage.getItem("token") || "";
      await fetch(`${this.getBaseURL()}/sessions/${sessionId}/workspace/watch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Client-Id": this.currentClientId,
        },
        body: JSON.stringify({ scope, enabled }),
      });
    } catch (error) {
      console.error(`[WorkspaceWatcher] setWatchScope(${scope}, ${enabled}) 失败:`, error);
    }
  }

  /** polyfill 已放弃连接：延时重建（期间被主动断开或已换连接则不复活） */
  private scheduleReconnect(sessionId: string, failedSource: EventSourcePolyfill): void {
    if (this.reconnectTimer) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.eventSource !== failedSource) {
        return;
      }
      this.eventSource = null;
      this.connect(sessionId);
    }, RECONNECT_DELAY_MS);
  }

  /**
   * 通知所有监听器
   */
  private notifyListeners(event: FileChangeEvent): void {
    this.listeners.forEach((callback) => {
      try {
        callback(event);
      } catch (error) {
        console.error("[WorkspaceWatcher] 监听器执行失败:", error);
      }
    });
  }
}
