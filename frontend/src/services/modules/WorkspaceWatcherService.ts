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
  type: "add" | "change" | "unlink" | "addDir" | "unlinkDir";
  path: string;
  sessionId: string;
  timestamp: number;
}

export class WorkspaceWatcherService {
  private eventSource: EventSourcePolyfill | null = null;
  private listeners: Set<(event: FileChangeEvent) => void> = new Set();
  private currentSessionId: string | null = null;
  private currentClientId: string;

  constructor(private getBaseURL: () => string) {
    // 使用全局客户端标识（localStorage 持久化，刷新页面保持不变）
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
  connect(sessionId: string): void {
    // 如果已连接同一会话，不做任何操作
    if (this.currentSessionId === sessionId && this.eventSource) {
      return;
    }

    // 断开现有连接
    this.disconnect();

    this.currentSessionId = sessionId;

    const token = localStorage.getItem("token") || sessionStorage.getItem("token") || "";
    const url = `${this.getBaseURL()}/sessions/${sessionId}/workspace/events`;

    this.eventSource = new EventSourcePolyfill(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Client-Id": this.currentClientId,
      },
      heartbeatTimeout: 180000,
    });

    this.eventSource.onopen = () => {
      console.log("[WorkspaceWatcher] SSE 连接已建立");
    };

    this.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as FileChangeEvent;
        this.notifyListeners(data);
      } catch (error) {
        console.error("[WorkspaceWatcher] 解析事件失败:", error);
      }
    };

    this.eventSource.onerror = (error) => {
      console.error("[WorkspaceWatcher] SSE 连接错误:", error);
    };
  }

  /**
   * 断开工作目录监听连接
   */
  disconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.currentSessionId = null;
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
