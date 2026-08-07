import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";
import * as parcelWatcher from "@parcel/watcher";

export interface FileChangeEvent {
  type: "add" | "change" | "unlink" | "addDir" | "unlinkDir";
  path: string;
  sessionId: string;
  timestamp: number;
}

interface NormalizedPath {
  key: string;
  value: string;
}

/** 每个唯一工作目录对应一份 parcel watcher 订阅，通过引用计数 + LRU/TTL 惰性释放。 */
interface WatchEntry {
  pathKey: string;
  absolutePath: string;
  subscription: parcelWatcher.AsyncSubscription | null;
  /** 引用该目录的所有 sessionId，事件广播给这些会话 */
  sessionIds: Set<string>;
  idleTimer: ReturnType<typeof setTimeout> | null;
  /** 事件合并缓冲：absolutePath → 待推送事件 */
  pendingEvents: Map<string, PendingChangeEvent>;
  coalesceTimer: ReturnType<typeof setTimeout> | null;
  /** 熔断：事件风暴时增大合并窗口 */
  degraded: boolean;
  eventTimestamps: number[];
  lastUsedAt: number;
  ready: boolean;
}

interface PendingChangeEvent {
  type: "add" | "change" | "unlink" | "addDir" | "unlinkDir";
  path: string;
  timestamp: number;
}

interface Connection {
  clientId: string;
  onForceClose?: () => void;
}

interface SessionState {
  sessionId: string;
  workspacePath: string;
  workspaceKey: string;
  pathKey: string;
  /** connectionId → Connection */
  connections: Map<symbol, Connection>;
}

const IDLE_TTL_MS = 30_000;
const MAX_IDLE_WATCHERS = 3;
const COALESCE_MS = 60;
const DEGRADED_COALESCE_MS = 500;
const EVENT_RATE_WINDOW_MS = 5_000;
const EVENT_RATE_THRESHOLD = 5_000;
const MAX_EVENTS_PER_FLUSH = 500;

/**
 * parcel watcher ignore globs —— 在 C++ 原生层生效，直接减少 inotify 句柄数量。
 * chokidar 时代的 ignored 正则迁移为 glob，行为等价但性能更优。
 */
const IGNORE_GLOBS: string[] = [
  "**/node_modules/**",
  "**/.git/**",
  "**/.next/**",
  "**/dist/**",
  "**/build/**",
  "**/.venv/**",
  "**/__pycache__/**",
  "**/node_modules_backup/**",
  "**/node_modules.bak/**",
  "**/.cache/**",
];

@Injectable()
export class WorkspaceWatcherService implements OnModuleDestroy {
  private readonly logger = new Logger(WorkspaceWatcherService.name);
  private readonly watchers = new Map<string, WatchEntry>();
  private readonly sessions = new Map<string, SessionState>();
  private readonly listeners = new Map<
    string,
    Set<(event: FileChangeEvent) => void>
  >();
  private destroyed = false;

  /**
   * 注册一条会话监听连接，返回幂等释放函数。
   * 同一 (sessionId, workspacePath) 可被多个 client 多次调用。
   */
  startWatching(
    sessionId: string,
    workspacePath: string,
    clientId: string,
    onForceClose?: () => void,
  ): () => void {
    if (this.destroyed) {
      return () => undefined;
    }

    const normalized = this.normalizeAbsolutePath(workspacePath);

    let sessionState = this.sessions.get(sessionId);
    if (!sessionState) {
      sessionState = {
        sessionId,
        workspacePath: normalized.value,
        workspaceKey: normalized.key,
        pathKey: normalized.key,
        connections: new Map(),
      };
      this.sessions.set(sessionId, sessionState);
    }

    const connectionId = Symbol(clientId);
    sessionState.connections.set(connectionId, { clientId, onForceClose });

    this.acquireWatcher(sessionId, sessionState.pathKey, sessionState.workspacePath);

    this.logger.debug(
      `Client ${clientId} joined workspace watcher for session ${sessionId} ` +
        `(path ${sessionState.workspacePath}, connections ${sessionState.connections.size})`,
    );

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.releaseConnection(sessionId, connectionId);
    };
  }

  /**
   * 移除指定客户端的全部连接。
   */
  stopWatching(sessionId: string, clientId: string): void {
    if (clientId === "__force_close__") {
      this.stopWatchingSession(sessionId);
      return;
    }
    const sessionState = this.sessions.get(sessionId);
    if (!sessionState) return;

    const connectionIds: symbol[] = [];
    for (const [connId, conn] of sessionState.connections) {
      if (conn.clientId === clientId) {
        connectionIds.push(connId);
      }
    }
    for (const connId of connectionIds) {
      this.releaseConnection(sessionId, connId);
    }
  }

  /**
   * 强制移除会话的全部监听状态，用于会话删除。
   */
  stopWatchingSession(sessionId: string): void {
    const sessionState = this.sessions.get(sessionId);
    if (!sessionState) return;

    const callbacks = this.collectForceCloseCallbacks(sessionState);
    this.sessions.delete(sessionId);
    this.listeners.delete(sessionId);

    this.releaseWatcherRef(sessionState.pathKey, sessionId);
    this.logger.debug(`Stopped workspace watcher for session ${sessionId}`);
    this.invokeCallbacks(callbacks);
  }

  onFileChange(
    sessionId: string,
    callback: (event: FileChangeEvent) => void,
  ): () => void {
    if (!this.listeners.has(sessionId)) {
      this.listeners.set(sessionId, new Set());
    }
    this.listeners.get(sessionId)!.add(callback);

    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      const set = this.listeners.get(sessionId);
      set?.delete(callback);
      if (set?.size === 0) {
        this.listeners.delete(sessionId);
      }
    };
  }

  getWorkspacePath(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.workspacePath;
  }

  getActiveWatchCount(): number {
    return this.watchers.size;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;

    const allCallbacks: (() => void)[] = [];
    for (const sessionState of this.sessions.values()) {
      allCallbacks.push(...this.collectForceCloseCallbacks(sessionState));
    }
    this.sessions.clear();
    this.listeners.clear();

    const entries = Array.from(this.watchers.values());
    this.watchers.clear();
    for (const entry of entries) {
      if (entry.coalesceTimer) clearTimeout(entry.coalesceTimer);
      if (entry.idleTimer) clearTimeout(entry.idleTimer);
      try {
        await entry.subscription?.unsubscribe();
      } catch (error: unknown) {
        this.logger.warn(
          `Failed to unsubscribe watcher ${entry.absolutePath}: ${String(error)}`,
        );
      }
    }
    this.invokeCallbacks(allCallbacks);
    this.logger.log("Cleaned up global workspace watcher");
  }

  // ────────────────── 内部方法 ──────────────────

  private releaseConnection(sessionId: string, connectionId: symbol): void {
    const sessionState = this.sessions.get(sessionId);
    if (!sessionState) return;
    if (!sessionState.connections.delete(connectionId)) return;

    if (sessionState.connections.size === 0) {
      this.sessions.delete(sessionId);
      this.releaseWatcherRef(sessionState.pathKey, sessionId);
      this.logger.debug(
        `Released workspace watcher connection for session ${sessionId}`,
      );
    }
  }

  private acquireWatcher(
    sessionId: string,
    pathKey: string,
    absolutePath: string,
  ): void {
    let entry = this.watchers.get(pathKey);
    if (entry) {
      if (entry.idleTimer) {
        clearTimeout(entry.idleTimer);
        entry.idleTimer = null;
      }
      entry.sessionIds.add(sessionId);
      entry.lastUsedAt = Date.now();
      return;
    }

    entry = {
      pathKey,
      absolutePath,
      subscription: null,
      sessionIds: new Set([sessionId]),
      idleTimer: null,
      pendingEvents: new Map(),
      coalesceTimer: null,
      degraded: false,
      eventTimestamps: [],
      lastUsedAt: Date.now(),
      ready: false,
    };
    this.watchers.set(pathKey, entry);
    this.subscribeEntry(entry);
  }

  private subscribeEntry(entry: WatchEntry): void {
    parcelWatcher
      .subscribe(
        entry.absolutePath,
        (error, events) => {
          if (error) {
            this.logger.error(
              `Watcher error for ${entry.absolutePath}: ${String(error.message || error)}`,
            );
            if (/ENOSPC/.test(error.message || "")) {
              entry.degraded = true;
            }
            return;
          }
          this.handleParcelEvents(entry, events);
        },
        { ignore: IGNORE_GLOBS },
      )
      .then((subscription) => {
        entry.subscription = subscription;
        entry.ready = true;
        entry.lastUsedAt = Date.now();
        this.logger.debug(
          `Started recursive watcher for ${entry.absolutePath}`,
        );
      })
      .catch((error: unknown) => {
        this.logger.error(
          `Failed to subscribe watcher for ${entry.absolutePath}: ${String(error)}`,
        );
      });
  }

  private releaseWatcherRef(pathKey: string, sessionId: string): void {
    const entry = this.watchers.get(pathKey);
    if (!entry) return;

    entry.sessionIds.delete(sessionId);
    if (entry.sessionIds.size > 0) return;

    // 引用归零 → TTL 惰性释放
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => {
      this.disposeWatcher(entry);
    }, IDLE_TTL_MS);
    entry.idleTimer.unref?.();
    this.evictIdleWatchers();
  }

  private disposeWatcher(entry: WatchEntry): void {
    if (entry.sessionIds.size > 0) return;

    this.watchers.delete(entry.pathKey);
    if (entry.coalesceTimer) clearTimeout(entry.coalesceTimer);
    entry.subscription
      ?.unsubscribe()
      .catch((error: unknown) => {
        this.logger.warn(
          `Failed to dispose watcher ${entry.absolutePath}: ${String(error)}`,
        );
      });
    this.logger.debug(
      `Disposed idle watcher for ${entry.absolutePath} (TTL)`,
    );
  }

  /**
   * LRU 淘汰：闲置（refCount=0 且 TTL 未到期）订阅超过上限时淘汰最旧的。
   */
  private evictIdleWatchers(): void {
    const idleEntries = Array.from(this.watchers.values())
      .filter((e) => e.sessionIds.size === 0 && e.idleTimer)
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    const excess = idleEntries.length - MAX_IDLE_WATCHERS;
    if (excess <= 0) return;
    for (const entry of idleEntries.slice(0, excess)) {
      if (entry.idleTimer) {
        clearTimeout(entry.idleTimer);
        entry.idleTimer = null;
      }
      this.disposeWatcher(entry);
    }
  }

  // ────────────────── 事件处理 ──────────────────

  /**
   * parcel 事件映射到 FileChangeEvent：
   *  create → stat 判断 add/addDir
   *  update → change
   *  delete → unlink（前端对 unlink/unlinkDir 处理等价）
   * 事件先入合并缓冲，延迟批量推送。
   */
  private handleParcelEvents(
    entry: WatchEntry,
    events: parcelWatcher.Event[],
  ): void {
    if (!entry.ready) return;

    const now = Date.now();
    for (const _ of events) {
      entry.eventTimestamps.push(now);
    }
    while (
      entry.eventTimestamps.length &&
      now - entry.eventTimestamps[0] > EVENT_RATE_WINDOW_MS
    ) {
      entry.eventTimestamps.shift();
    }
    if (
      !entry.degraded &&
      entry.eventTimestamps.length > EVENT_RATE_THRESHOLD
    ) {
      entry.degraded = true;
      this.logger.warn(
        `Watcher ${entry.absolutePath} event rate high (${entry.eventTimestamps.length}/${EVENT_RATE_WINDOW_MS / 1000}s), enabling degraded mode`,
      );
    }

    for (const ev of events) {
      this.enqueueEvent(entry, ev);
    }
  }

  private enqueueEvent(entry: WatchEntry, ev: parcelWatcher.Event): void {
    const abs = this.normalizeAbsolutePath(ev.path);

    let pending: PendingChangeEvent;
    if (ev.type === "create") {
      let isDir = false;
      try {
        isDir = fs.statSync(abs.value).isDirectory();
      } catch {
        // 秒建秒删，跳过
        return;
      }
      pending = {
        type: isDir ? "addDir" : "add",
        path: abs.value,
        timestamp: Date.now(),
      };
    } else if (ev.type === "update") {
      pending = {
        type: "change",
        path: abs.value,
        timestamp: Date.now(),
      };
    } else {
      pending = {
        type: "unlink",
        path: abs.value,
        timestamp: Date.now(),
      };
    }

    // 合并：同一路径在窗口内只保留最新事件
    entry.pendingEvents.set(abs.value, pending);

    if (entry.pendingEvents.size >= MAX_EVENTS_PER_FLUSH) {
      this.flushEvents(entry);
    } else {
      this.scheduleCoalesce(entry);
    }
  }

  private scheduleCoalesce(entry: WatchEntry): void {
    if (entry.coalesceTimer) return;
    const delay = entry.degraded ? DEGRADED_COALESCE_MS : COALESCE_MS;
    entry.coalesceTimer = setTimeout(() => {
      entry.coalesceTimer = null;
      this.flushEvents(entry);
    }, delay);
  }

  private flushEvents(entry: WatchEntry): void {
    if (entry.coalesceTimer) {
      clearTimeout(entry.coalesceTimer);
      entry.coalesceTimer = null;
    }
    if (entry.pendingEvents.size === 0) return;

    const events = Array.from(entry.pendingEvents.values());
    entry.pendingEvents.clear();

    // 事件风暴平息后恢复
    if (entry.degraded) {
      const now = Date.now();
      while (
        entry.eventTimestamps.length &&
        now - entry.eventTimestamps[0] > EVENT_RATE_WINDOW_MS
      ) {
        entry.eventTimestamps.shift();
      }
      if (entry.eventTimestamps.length <= EVENT_RATE_THRESHOLD) {
        entry.degraded = false;
      }
    }

    for (const sessionId of entry.sessionIds) {
      const sessionState = this.sessions.get(sessionId);
      if (!sessionState) continue;

      for (const ev of events) {
        if (
          !this.isSameOrDescendant(sessionState.workspaceKey, ev.path)
        ) {
          continue;
        }
        const relativePath = path.relative(
          sessionState.workspacePath,
          ev.path,
        );
        if (
          !relativePath ||
          relativePath === ".." ||
          relativePath.startsWith(`..${path.sep}`)
        ) {
          continue;
        }
        this.notifyListeners(sessionId, {
          type: ev.type,
          path: relativePath,
          sessionId,
          timestamp: ev.timestamp,
        });
      }
    }
  }

  private notifyListeners(sessionId: string, event: FileChangeEvent): void {
    const set = this.listeners.get(sessionId);
    if (!set) return;
    set.forEach((cb) => {
      try {
        cb(event);
      } catch (error: unknown) {
        this.logger.error(`Error notifying listener: ${String(error)}`);
      }
    });
  }

  // ────────────────── 工具方法 ──────────────────

  private collectForceCloseCallbacks(
    sessionState: SessionState,
  ): (() => void)[] {
    const callbacks: (() => void)[] = [];
    for (const conn of sessionState.connections.values()) {
      if (conn.onForceClose) {
        callbacks.push(conn.onForceClose);
      }
    }
    return callbacks;
  }

  private invokeCallbacks(callbacks: (() => void)[]): void {
    for (const cb of callbacks) {
      try {
        cb();
      } catch (error: unknown) {
        this.logger.error(
          `Failed to close workspace watcher connection: ${String(error)}`,
        );
      }
    }
  }

  private normalizeAbsolutePath(inputPath: string): NormalizedPath {
    let normalizedPath = path.normalize(path.resolve(inputPath));
    const rootPath = path.parse(normalizedPath).root;
    while (
      normalizedPath.length > rootPath.length &&
      normalizedPath.endsWith(path.sep)
    ) {
      normalizedPath = normalizedPath.slice(0, -1);
    }
    return {
      key:
        process.platform === "win32"
          ? normalizedPath.toLowerCase()
          : normalizedPath,
      value: normalizedPath,
    };
  }

  private isSameOrDescendant(basePath: string, candidatePath: string): boolean {
    const relativePath = path.relative(basePath, candidatePath);
    return (
      relativePath === "" ||
      (relativePath !== ".." &&
        !relativePath.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relativePath))
    );
  }
}
