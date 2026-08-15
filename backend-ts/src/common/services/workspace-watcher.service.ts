import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";
import * as parcelWatcher from "@parcel/watcher";
import { gitActivity } from "./git-activity";

export interface FileChangeEvent {
  /** git = 工作区 .git 目录内容变化（外部 commit/stage/checkout 等），前端应刷新 git 状态 */
  type: "add" | "change" | "unlink" | "addDir" | "unlinkDir" | "git";
  path: string;
  sessionId: string;
  timestamp: number;
}

/** watcher 订阅范围：file=工作区根目录文件事件；git=.git 目录变化（独立 watcher） */
export type WatchScope = "file" | "git";

/** 订阅范围校验/规范化 */
export function normalizeWatchScope(scope: string | undefined): WatchScope | null {
  if (scope === "file" || scope === "git") return scope;
  return null;
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
  /** .git 目录的独立订阅（外部 git 操作检测，见 subscribeGitEntry） */
  gitSubscription: parcelWatcher.AsyncSubscription | null;
  /** 引用该目录的所有 sessionId，事件广播给这些会话 */
  sessionIds: Set<string>;
  idleTimer: ReturnType<typeof setTimeout> | null;
  /** 事件合并缓冲：absolutePath → 待推送事件 */
  pendingEvents: Map<string, PendingChangeEvent>;
  coalesceTimer: ReturnType<typeof setTimeout> | null;
  /** .git 变化待推送标志 + 防抖定时器 */
  gitDirty: boolean;
  gitTimer: ReturnType<typeof setTimeout> | null;
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
  /**
   * clientId → 订阅范围集合（连接级引用计数）：
   * - REST setWatchScope 增删；
   * - 对应连接关闭时整项清除（SSE 断开即取消订阅）；
   * - watcher 激活 = 任一在线的 clientId 订阅了该范围。
   */
  scopes: Map<string, Set<WatchScope>>;
}

const IDLE_TTL_MS = 30_000;
const MAX_IDLE_WATCHERS = 3;
const COALESCE_MS = 60;
const DEGRADED_COALESCE_MS = 500;
const EVENT_RATE_WINDOW_MS = 5_000;
const EVENT_RATE_THRESHOLD = 5_000;
const MAX_EVENTS_PER_FLUSH = 500;
/** .git 变化防抖：一次 commit 会连续写 HEAD/refs/index 等，合并为单次「git 已变化」通知 */
const GIT_DEBOUNCE_MS = 300;
/** .git 内部需要忽略的路径：loose objects 每次提交大量写入（refs/HEAD 已足以触发）；
    *.lock 为 git 写操作的瞬时锁文件（index.lock 等），其 create/delete 无状态意义 */
const GIT_IGNORE_GLOBS = ["**/objects/**", "**/*.lock"];
/**
 * 读命令噪声抑制窗口：git 读命令（status/diff/show）在 stat 缓存过期时会写 index
 * （创建 index.lock + 写 index），这些是「本端读命令引发的噪声」；窗口内到达的
 * .git 事件一律忽略，避免 读命令 → 事件 → 刷新 → 读命令 的死循环。
 * 窗口外的 index 变化（外部 git add / reset）仍会正常推送。
 */
const GIT_READ_SUPPRESS_MS = 1000;

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
  /** REST 订阅先于 SSE 连接时暂存：sessionId → clientId → scopes（连接建立后迁入 sessionState） */
  private readonly pendingScopes = new Map<string, Map<string, Set<WatchScope>>>();
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
        scopes: new Map(),
      };
      // 迁入连接建立前已到达的订阅（REST 先于 SSE 的场景）
      const pending = this.pendingScopes.get(sessionId);
      if (pending) {
        for (const [cid, scopes] of pending) {
          sessionState.scopes.set(cid, new Set(scopes));
        }
        this.pendingScopes.delete(sessionId);
      }
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
    this.pendingScopes.delete(sessionId);

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
    this.pendingScopes.clear();

    const entries = Array.from(this.watchers.values());
    this.watchers.clear();
    for (const entry of entries) {
      if (entry.coalesceTimer) clearTimeout(entry.coalesceTimer);
      if (entry.idleTimer) clearTimeout(entry.idleTimer);
      if (entry.gitTimer) clearTimeout(entry.gitTimer);
      try {
        await entry.subscription?.unsubscribe();
      } catch (error: unknown) {
        this.logger.warn(
          `Failed to unsubscribe watcher ${entry.absolutePath}: ${String(error)}`,
        );
      }
      try {
        await entry.gitSubscription?.unsubscribe();
      } catch (error: unknown) {
        this.logger.warn(
          `Failed to unsubscribe git watcher ${entry.absolutePath}: ${String(error)}`,
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
    const conn = sessionState.connections.get(connectionId);
    if (!conn) return;
    sessionState.connections.delete(connectionId);

    // SSE 断开 → 该 clientId 的订阅整项清除（无需显式取消订阅）
    if (conn.clientId) {
      sessionState.scopes.delete(conn.clientId);
    }

    if (sessionState.connections.size === 0) {
      this.sessions.delete(sessionId);
      this.releaseWatcherRef(sessionState.pathKey, sessionId);
      this.logger.debug(
        `Released workspace watcher connection for session ${sessionId}`,
      );
    } else {
      // 还有其他连接：重算 watcher 激活（可能因 scope 减少而停用部分 watcher）
      const entry = this.watchers.get(sessionState.pathKey);
      if (entry) this.updateWatcherSubscriptions(entry);
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
      this.updateWatcherSubscriptions(entry);
      return;
    }

    entry = {
      pathKey,
      absolutePath,
      subscription: null,
      gitSubscription: null,
      sessionIds: new Set([sessionId]),
      idleTimer: null,
      pendingEvents: new Map(),
      coalesceTimer: null,
      gitDirty: false,
      gitTimer: null,
      degraded: false,
      eventTimestamps: [],
      lastUsedAt: Date.now(),
      ready: false,
    };
    this.watchers.set(pathKey, entry);
    // 不自动订阅：watcher 由连接级 scope（setWatchScope）驱动激活
    this.updateWatcherSubscriptions(entry);
  }

  /**
   * 设置某连接的订阅范围（连接级引用计数）：
   * - 同一 clientId 的多个 scope 取并集；
   * - 只要还有任一在线 clientId 订阅某 scope，对应 watcher 就保持激活；
   * - SSE 断开时该 clientId 的 scopes 整项清除（releaseConnection）。
   */
  setWatchScope(
    sessionId: string,
    clientId: string,
    scope: WatchScope,
    enabled: boolean,
  ): void {
    const sessionState = this.sessions.get(sessionId);
    if (!sessionState) {
      // 连接尚未建立（REST 先于 SSE）：暂存，SSE join 时迁入
      let pending = this.pendingScopes.get(sessionId);
      if (!pending) {
        pending = new Map();
        this.pendingScopes.set(sessionId, pending);
      }
      let scopes = pending.get(clientId);
      if (!scopes) {
        scopes = new Set();
        pending.set(clientId, scopes);
      }
      if (enabled) scopes.add(scope);
      else scopes.delete(scope);
      if (scopes.size === 0) pending.delete(clientId);
      if (pending.size === 0) this.pendingScopes.delete(sessionId);
      return;
    }
    let scopes = sessionState.scopes.get(clientId);
    if (!scopes) {
      scopes = new Set();
      sessionState.scopes.set(clientId, scopes);
    }
    if (enabled) scopes.add(scope);
    else scopes.delete(scope);
    if (scopes.size === 0) sessionState.scopes.delete(clientId);

    const entry = this.watchers.get(sessionState.pathKey);
    if (entry) {
      this.updateWatcherSubscriptions(entry);
    }
    this.logger.debug(
      `setWatchScope(${sessionId}, ${clientId}, ${scope}, ${enabled}) → scopes ${JSON.stringify(
        Array.from(sessionState.scopes.values()).map((s) => Array.from(s)),
      )}`,
    );
  }

  /** 聚合 entry 关联全部会话的激活范围（任一在线 clientId 订阅即激活） */
  private computeEntryScopes(entry: WatchEntry): { file: boolean; git: boolean } {
    let file = false;
    let git = false;
    for (const sessionId of entry.sessionIds) {
      const ss = this.sessions.get(sessionId);
      if (!ss) continue;
      for (const scopes of ss.scopes.values()) {
        if (scopes.has("file")) file = true;
        if (scopes.has("git")) git = true;
        if (file && git) return { file, git };
      }
      if (file && git) return { file, git };
    }
    return { file, git };
  }

  /** 按激活范围增删两个独立 parcel watcher（root / .git），幂等、防重入 */
  private updateWatcherSubscriptions(entry: WatchEntry): void {
    const { file, git } = this.computeEntryScopes(entry);

    // 根 watcher（工作区文件事件）
    if (file && !entry.subscription && !entry.ready) {
      this.subscribeRoot(entry);
    } else if (!file && entry.subscription) {
      const sub = entry.subscription;
      entry.subscription = null;
      entry.ready = false;
      sub.unsubscribe().catch((error: unknown) => {
        this.logger.warn(
          `Failed to unsubscribe root watcher ${entry.absolutePath}: ${String(error)}`,
        );
      });
    }

    // .git watcher（git 事件，独立订阅）
    if (git && !entry.gitSubscription) {
      this.subscribeGitEntry(entry);
    } else if (!git && entry.gitSubscription) {
      const sub = entry.gitSubscription;
      entry.gitSubscription = null;
      sub.unsubscribe().catch((error: unknown) => {
        this.logger.warn(
          `Failed to unsubscribe git watcher ${entry.absolutePath}: ${String(error)}`,
        );
      });
    }
  }

  /** 订阅工作区根目录（文件事件），激活期间有效 */
  private subscribeRoot(entry: WatchEntry): void {
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
        // 订阅完成前 scope 可能已撤销 → 撤销后立刻退订
        if (!this.computeEntryScopes(entry).file) {
          subscription.unsubscribe().catch(() => undefined);
          return;
        }
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

  /**
   * 解析工作区的 git 目录：
   * - 常规仓库：workspace/.git 目录；
   * - worktree/submodule：workspace/.git 是文件，内容为 `gitdir: <path>`；
   * - 非仓库：null（不订阅）。
   */
  private resolveGitDir(workspacePath: string): string | null {
    const dotGit = path.join(workspacePath, ".git");
    try {
      const stat = fs.statSync(dotGit);
      if (stat.isDirectory()) return dotGit;
      if (stat.isFile()) {
        const content = fs.readFileSync(dotGit, "utf-8");
        const m = content.match(/^gitdir:\s*(.+)$/m);
        return m ? path.resolve(workspacePath, m[1].trim()) : null;
      }
    } catch {
      // 不是 git 仓库
    }
    return null;
  }

  /**
   * 订阅 .git 目录：内部任一文件变化 → 防抖（合并一次 commit 的连续写入）→
   * 向该工作区的全部会话推送 type:"git" 事件（前端刷新 git 状态，对齐 VS Code 的
   * 「监听 .git + 防抖 + status」自动刷新机制）。
   */
  private subscribeGitEntry(entry: WatchEntry): void {
    const gitDir = this.resolveGitDir(entry.absolutePath);
    if (!gitDir) return;

    parcelWatcher
      .subscribe(
        gitDir,
        (error) => {
          if (error) {
            this.logger.warn(
              `Git watcher error for ${gitDir}: ${String(error.message || error)}`,
            );
            return;
          }
          if (entry.gitDirty) return;
          entry.gitDirty = true;
          if (entry.gitTimer) clearTimeout(entry.gitTimer);
          entry.gitTimer = setTimeout(() => {
            entry.gitTimer = null;
            entry.gitDirty = false;
            // 本端读命令刚写过 index（stat 缓存刷新）→ 这是自己引发的噪声，忽略
            if (Date.now() - gitActivity.lastReadAt < GIT_READ_SUPPRESS_MS) {
              return;
            }
            const now = Date.now();
            for (const sessionId of entry.sessionIds) {
              const sessionState = this.sessions.get(sessionId);
              if (!sessionState) continue;
              this.notifyListeners(sessionId, {
                type: "git",
                path: "",
                sessionId,
                timestamp: now,
              });
            }
          }, GIT_DEBOUNCE_MS);
          entry.gitTimer.unref?.();
        },
        { ignore: GIT_IGNORE_GLOBS },
      )
      .then((subscription) => {
        // 订阅完成前 scope 可能已撤销 → 撤销后立刻退订
        if (!this.computeEntryScopes(entry).git) {
          subscription.unsubscribe().catch(() => undefined);
          return;
        }
        entry.gitSubscription = subscription;
        this.logger.debug(`Started git watcher for ${gitDir}`);
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `Failed to subscribe git watcher for ${gitDir}: ${String(error)}`,
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
    if (entry.gitTimer) clearTimeout(entry.gitTimer);
    entry.subscription
      ?.unsubscribe()
      .catch((error: unknown) => {
        this.logger.warn(
          `Failed to dispose watcher ${entry.absolutePath}: ${String(error)}`,
        );
      });
    entry.gitSubscription
      ?.unsubscribe()
      .catch((error: unknown) => {
        this.logger.warn(
          `Failed to dispose git watcher ${entry.absolutePath}: ${String(error)}`,
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
