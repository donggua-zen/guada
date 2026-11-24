/**
 * 工作目录实时监听服务。
 *
 * 传输复用全局 WebSocket（SessionEventsService）：本服务只维护"期望订阅范围"
 * 与监听器，scope 变更通过 WS 的 workspace/watch 下发；连接断开重连后由
 * SessionEventsService 的 onConnected 触发重放。
 */

/** 工作目录文件变化事件（与后端 FileChangeEvent 同构） */
export interface FileChangeEvent {
  /**
   * git = git 状态可能已变化（.git 目录变化，或工作树文件被增删改），消费方应刷新 git 状态；
   * overflow = 事件风暴熔断，消费方应整体刷新根 + 已展开目录，而不是逐文件处理。
   */
  type: "add" | "change" | "unlink" | "addDir" | "unlinkDir" | "heartbeat" | "git" | "overflow";
  path: string;
  sessionId: string;
  timestamp: number;
}

/** 订阅范围（与后端 workspace/watch 的 scope 对齐） */
export type WatchScope = "file" | "git";

export class WorkspaceWatcherService {
  private listeners: Set<(event: FileChangeEvent) => void> = new Set();
  private currentSessionId: string | null = null;
  /**
   * 期望订阅范围（按会话）。
   * 后端把 scope 记在「连接」上，断线重连该连接的状态会清空，因此重连后必须重放，
   * 否则 watcher 静默停用、文件变更事件全部丢失直到组件重新挂载。
   */
  private desiredScopes: Map<string, Set<WatchScope>> = new Map();
  /** 最近一次 connect 传入的 onConnected 回调（重连后复用） */
  private connectCallback: (() => void) | undefined;

  constructor(private readonly sessionEvents: import("./SessionEventsService").SessionEventsService) {
    this.sessionEvents.onWorkspaceEvent((event: FileChangeEvent) => {
      if (!event || event.sessionId !== this.currentSessionId) return;
      this.notifyListeners(event);
    });
    this.sessionEvents.onConnected(() => {
      this.replayScopes();
      this.connectCallback?.();
    });
  }

  getClientId(): string {
    return this.sessionEvents.getClientId();
  }

  /**
   * 切换到指定会话的工作目录事件（不建立新连接，只更新当前会话与订阅）。
   */
  connect(sessionId: string, onConnected?: () => void): void {
    if (this.currentSessionId !== sessionId) {
      this.desiredScopes.clear();
    }
    this.currentSessionId = sessionId;
    this.connectCallback = onConnected;
    this.replayScopes();
  }

  disconnect(): void {
    // 主动退订：连接仍在时服务端按 scope 集合计数，不清会让 watcher 继续空转
    for (const [sessionId, scopes] of this.desiredScopes) {
      for (const scope of scopes) {
        this.sessionEvents.setWorkspaceWatch(sessionId, [scope], false);
      }
    }
    this.currentSessionId = null;
    this.connectCallback = undefined;
    this.desiredScopes.clear();
  }

  /**
   * 设置 watcher 订阅范围：scope = 'file' | 'git'
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
    this.sessionEvents.setWorkspaceWatch(sessionId, [scope], enabled);
  }

  onChange(callback: (event: FileChangeEvent) => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  getSessionId(): string | null {
    return this.currentSessionId;
  }

  /** 重放全部期望订阅（幂等：后端 scope 是集合语义） */
  private replayScopes(): void {
    for (const [sessionId, scopes] of this.desiredScopes) {
      if (scopes.size === 0) continue;
      this.sessionEvents.setWorkspaceWatch(sessionId, [...scopes], true);
    }
  }

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
