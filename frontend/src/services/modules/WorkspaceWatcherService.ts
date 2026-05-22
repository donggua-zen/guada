/**
 * 工作目录实时监听服务
 * 通过 SSE 连接监听指定会话的工作目录文件变化
 */

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
  private abortController: AbortController | null = null;
  private listeners: Set<(event: FileChangeEvent) => void> = new Set();
  private reconnectTimer: number | null = null;
  private reconnectAttempts = 0;
  private currentSessionId: string | null = null;
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  private readonly RECONNECT_DELAY = 3000;

  constructor(private getBaseURL: () => string) {}

  /**
   * 连接到指定会话的工作目录事件流（SSE）
   * 使用 fetch API 实现，支持自定义 Authorization header
   */
  connect(sessionId: string): void {
    // 如果已连接同一会话，不做任何操作
    if (this.currentSessionId === sessionId && this.abortController) {
      return;
    }

    // 断开现有连接
    this.disconnect();

    this.currentSessionId = sessionId;
    this.reconnectAttempts = 0;

    const url = `${this.getBaseURL()}/sessions/${sessionId}/workspace/events`;

    this.startFetchStream(url);
  }

  /**
   * 使用 fetch API 启动 SSE 流
   */
  private async startFetchStream(url: string): Promise<void> {
    this.abortController = new AbortController();
    const { signal } = this.abortController;
    try {
      // 优先从 localStorage 读取（记住我），否则使用 sessionStorage
      const token =
        localStorage.getItem("token") || sessionStorage.getItem("token") || "";

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "text/event-stream",
          Authorization: `Bearer ${token}`,
        },
        signal: signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error("Response body is null");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") continue;
            try {
              const event = JSON.parse(data) as FileChangeEvent;
              this.notifyListeners(event);
            } catch (error) {
              console.error(
                "[WorkspaceWatcher] Failed to parse event data:",
                error,
              );
            }
          }
        }
      }
    } catch (error: any) {
      if (error.name === "AbortError") {
        // 只有主动断开时才不重连
        if (signal.aborted) {
          return;
        }
        // 非主动断开（如后端重启），触发重连
      }
      this.handleReconnect(url);
    }
  }

  /**
   * 断开工作目录监听连接
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    this.currentSessionId = null;
    this.reconnectAttempts = 0;
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
   * 处理重连
   */
  private handleReconnect(url: string): void {
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      console.error("[WorkspaceWatcher] Max reconnection attempts reached");
      return;
    }

    this.reconnectAttempts++;
    this.reconnectTimer = window.setTimeout(() => {
      this.startFetchStream(url);
    }, this.RECONNECT_DELAY);
  }

  /**
   * 通知所有监听器
   */
  private notifyListeners(event: FileChangeEvent): void {
    this.listeners.forEach((callback) => {
      try {
        callback(event);
      } catch (error) {
        console.error("[WorkspaceWatcher] Listener error:", error);
      }
    });
  }
}
