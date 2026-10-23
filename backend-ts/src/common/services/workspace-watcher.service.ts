import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";
import * as parcelWatcher from "@parcel/watcher";
import { gitActivity } from "./git-activity";
import { PARCEL_WATCH_OPTIONS } from "../utils/parcel-watch-options";

export interface FileChangeEvent {
  /**
   * git = 工作区 git 状态可能已变化，前端应重新拉取 git 状态。
   * 两个来源：.git 目录内容变化（外部 commit/stage/checkout 等），
   * 以及工作树文件的增删改（编辑文件不触碰 .git，只有根 watcher 看得到）。
   */
  type:
    | "add"
    | "change"
    | "unlink"
    | "addDir"
    | "unlinkDir"
    | "git"
    /**
     * 事件风暴熔断信号：不再逐文件推送，前端应整体刷新根 + 已展开目录。
     * 由 degraded 模式发出，每个会话在合并窗口内最多一条。
     */
    | "overflow";
  path: string;
  sessionId: string;
  timestamp: number;
}

/** watcher 订阅范围：file=工作区根目录文件事件；git=git 状态变化（.git 目录 + 工作树文件） */
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
  /** 订阅在途标记：parcel subscribe 的 Promise resolve 前防重复订阅（scope 快速重入竞态） */
  fileSubscribing: boolean;
  gitSubscribing: boolean;
  /** 引用该目录的所有 sessionId，事件广播给这些会话 */
  sessionIds: Set<string>;
  idleTimer: ReturnType<typeof setTimeout> | null;
  /** 事件合并缓冲：absolutePath → 待推送事件 */
  pendingEvents: Map<string, PendingChangeEvent>;
  coalesceTimer: ReturnType<typeof setTimeout> | null;
  /** .git 目录变化待推送标志（受读命令抑制窗口约束） */
  gitDirty: boolean;
  /** 工作树文件变化待推送标志（与 gitDirty 共用防抖定时器，但不受读命令抑制窗口约束） */
  gitDirtyFromWorkTree: boolean;
  gitTimer: ReturnType<typeof setTimeout> | null;
  /** 熔断：事件风暴时增大合并窗口 */
  degraded: boolean;
  /** 速率窗口（不再用数组 + shift，避免风暴下的 O(n²)） */
  eventWindowStart: number;
  eventWindowCount: number;
  /** 上一次收到事件的时间：久静后自动退出 degraded */
  lastEventAt: number;
  /** degraded 期间有待发送的 overflow 信号 */
  pendingOverflow: boolean;
  /** scope 解除宽限定时器：会话切换时避免 watcher 反复 unsubscribe/subscribe */
  rootUnsubscribeTimer: ReturnType<typeof setTimeout> | null;
  gitUnsubscribeTimer: ReturnType<typeof setTimeout> | null;
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
/**
 * scope 解除宽限：会话切换时前端会先 file=false（旧会话）再 file=true（新会话），
 * 两个请求的到达顺序不保证；立即退订会让同一工作区的 watcher 反复 unsubscribe/subscribe。
 */
const SCOPE_UNSUBSCRIBE_GRACE_MS = 5_000;
/** .git 变化防抖：一次 commit 会连续写 HEAD/refs/index 等，合并为单次「git 已变化」通知 */
const GIT_DEBOUNCE_MS = 300;
/**
 * 工作树文件变化防抖（刻意长于 GIT_DEBOUNCE_MS）：保存文件 / agent 批量写文件会连续产生大量
 * 事件，300ms 窗口仍会把一个批次拆成多轮 git status。参考成熟实现（ZCode）的取舍 —— 它的 git
 * 自动刷新防抖远长于文件 watcher 防抖，正是为了压低大工作区里的重复 Git I/O。
 */
const GIT_WORKTREE_DEBOUNCE_MS = 1000;
/** .git 内部需要忽略的路径：loose objects 每次提交大量写入（refs/HEAD 已足以触发）；
    *.lock 为 git 写操作的瞬时锁文件（index.lock 等），其 create/delete 无状态意义 */
const GIT_IGNORE_GLOBS = ["**/objects/**", "**/*.lock"];
/**
 * 读命令噪声抑制窗口：git 读命令（status/diff/show）在 stat 缓存过期时会写 index
 * （创建 index.lock + 写 index），这些是「本端读命令引发的噪声」；窗口内到达的
 * .git 事件一律忽略，避免 读命令 → 事件 → 刷新 → 读命令 的死循环。
 * 窗口外的 index 变化（外部 git add / reset）仍会正常推送。
 *
 * 只作用于 .git 目录来源的事件：工作树文件来源的事件由编辑动作直接产生，与读命令无关，
 * 必须放行 —— 否则刚保存的文件若落在窗口内会被静默丢弃（表现为变更数停在旧值）。
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
  // 常见构建产物 / 缓存目录：不参与实时文件事件（需要时可在 .guada/watch-ignore 追加）
  "**/.nuxt/**",
  "**/.output/**",
  "**/coverage/**",
  "**/target/**",
  "**/vendor/**",
  "**/out/**",
  "**/.turbo/**",
  "**/.gradle/**",
  "**/.parcel-cache/**",
  "**/.svelte-kit/**",
  "**/.angular/**",
  "**/.idea/**",
  "**/.vs/**",
  "**/bin/**",
  "**/obj/**",
];

/**
 * 解析工作区级 `.guada/watch-ignore`：每行一个 gitignore 风格 glob，`#` 注释。
 * - 以 `/` 结尾：整目录忽略；
 * - 含 `.` 的文件名：按文件 glob 忽略；
 * - 其余：按目录忽略。
 * 只做常见子集，不实现 gitignore 的否定/锚定语义。
 */
export function parseWatchIgnoreLines(content: string): string[] {
  const globs: string[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    if (line.endsWith("/")) {
      globs.push(`**/${line.replace(/^\/+/, "").replace(/\/+$/, "")}/**`);
      continue;
    }
    const normalized = line.replace(/^\/+/, "");
    const basename = normalized.split("/").pop() ?? normalized;
    if (basename.includes(".")) {
      globs.push(`**/${normalized}`);
    } else {
      globs.push(`**/${normalized}/**`);
    }
  }
  return globs;
}

@Injectable()
export class WorkspaceWatcherService implements OnModuleDestroy {
  private readonly logger = new Logger(WorkspaceWatcherService.name);
  private scopeUnsubscribeGraceMs = SCOPE_UNSUBSCRIBE_GRACE_MS;
  private eventRateThreshold = EVENT_RATE_THRESHOLD;
  private readonly watchers = new Map<string, WatchEntry>();
  private readonly sessions = new Map<string, SessionState>();
  /** REST 订阅先于 SSE 连接时暂存：sessionId → clientId → scopes（连接建立后迁入 sessionState） */
  private readonly pendingScopes = new Map<string, Map<string, Set<WatchScope>>>();
  private readonly listeners = new Map<
    string,
    Set<(event: FileChangeEvent) => void>
  >();
  private destroyed = false;

  /** 仅供单测调整阈值/宽限期；生产使用默认常量（构造参数会触发 Nest DI 解析） */
  setOptionsForTesting(options: {
    scopeUnsubscribeGraceMs?: number;
    eventRateThreshold?: number;
  }): void {
    if (options.scopeUnsubscribeGraceMs !== undefined) {
      this.scopeUnsubscribeGraceMs = options.scopeUnsubscribeGraceMs;
    }
    if (options.eventRateThreshold !== undefined) {
      this.eventRateThreshold = options.eventRateThreshold;
    }
  }

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
      if (entry.rootUnsubscribeTimer) clearTimeout(entry.rootUnsubscribeTimer);
      if (entry.gitUnsubscribeTimer) clearTimeout(entry.gitUnsubscribeTimer);
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
      fileSubscribing: false,
      gitSubscribing: false,
      sessionIds: new Set([sessionId]),
      idleTimer: null,
      pendingEvents: new Map(),
      coalesceTimer: null,
      gitDirty: false,
      gitDirtyFromWorkTree: false,
      gitTimer: null,
      degraded: false,
      eventWindowStart: 0,
      eventWindowCount: 0,
      lastEventAt: 0,
      pendingOverflow: false,
      rootUnsubscribeTimer: null,
      gitUnsubscribeTimer: null,
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

  /** 会话是否至少有一个在线 client 订阅了指定范围 */
  private hasScope(sessionState: SessionState, scope: WatchScope): boolean {
    for (const scopes of sessionState.scopes.values()) {
      if (scopes.has(scope)) return true;
    }
    return false;
  }

  /** 按激活范围增删两个独立 parcel watcher（root / .git），幂等、防重入 */
  private updateWatcherSubscriptions(entry: WatchEntry): void {
    const { file, git } = this.computeEntryScopes(entry);
    // git 目录只解析一次，供根 watcher 与 .git watcher 共用
    const gitDir = git ? this.resolveGitDir(entry.absolutePath) : null;
    // 根 watcher 对 git scope 同样必要：工作树文件的增删改不触碰 .git（index 只由 git 命令写），
    // 但同样改变 git 状态/变更数，而这类变化只有根 watcher 看得到。
    // 非仓库工作区没有 git 状态可刷新，不为 git 订阅整棵树。
    const wantRoot = file || gitDir !== null;

    // 根 watcher（工作区文件事件）
    // 在途标记（fileSubscribing）防止 subscribe Promise resolve 前 scope 重入造成重复订阅
    if (wantRoot) {
      this.clearUnsubscribeTimer(entry, "root");
      if (!entry.subscription && !entry.fileSubscribing) {
        this.subscribeRoot(entry);
      }
    } else if (entry.subscription) {
      // 会话切换时旧 file=false / 新 file=true 的到达顺序不保证：
      // 给 5s 宽限，期间 scope 恢复则取消退订。
      this.scheduleRootUnsubscribe(entry);
    }

    // .git watcher（git 事件，独立订阅）
    if (gitDir) {
      this.clearUnsubscribeTimer(entry, "git");
      if (!entry.gitSubscription && !entry.gitSubscribing) {
        this.subscribeGitEntry(entry, gitDir);
      }
    } else if (entry.gitSubscription) {
      this.scheduleGitUnsubscribe(entry);
    }
  }

  private clearUnsubscribeTimer(
    entry: WatchEntry,
    kind: "root" | "git",
  ): void {
    const timer =
      kind === "root" ? entry.rootUnsubscribeTimer : entry.gitUnsubscribeTimer;
    if (timer) clearTimeout(timer);
    if (kind === "root") entry.rootUnsubscribeTimer = null;
    else entry.gitUnsubscribeTimer = null;
  }

  private scheduleRootUnsubscribe(entry: WatchEntry): void {
    if (entry.rootUnsubscribeTimer) return;
    if (this.scopeUnsubscribeGraceMs <= 0) {
      this.unsubscribeRoot(entry);
      return;
    }
    entry.rootUnsubscribeTimer = setTimeout(() => {
      entry.rootUnsubscribeTimer = null;
      if (this.needsRootWatcher(entry)) return;
      this.unsubscribeRoot(entry);
    }, this.scopeUnsubscribeGraceMs);
    entry.rootUnsubscribeTimer.unref?.();
  }

  private scheduleGitUnsubscribe(entry: WatchEntry): void {
    if (entry.gitUnsubscribeTimer) return;
    if (this.scopeUnsubscribeGraceMs <= 0) {
      this.unsubscribeGit(entry);
      return;
    }
    entry.gitUnsubscribeTimer = setTimeout(() => {
      entry.gitUnsubscribeTimer = null;
      if (this.computeEntryScopes(entry).git) return;
      this.unsubscribeGit(entry);
    }, this.scopeUnsubscribeGraceMs);
    entry.gitUnsubscribeTimer.unref?.();
  }

  private unsubscribeRoot(entry: WatchEntry): void {
    const sub = entry.subscription;
    if (!sub) return;
    entry.subscription = null;
    entry.ready = false;
    this.logger.debug(`Unsubscribing root watcher for ${entry.absolutePath}`);
    sub.unsubscribe().catch((error: unknown) => {
      this.logger.warn(
        `Failed to unsubscribe root watcher ${entry.absolutePath}: ${String(error)}`,
      );
    });
  }

  private unsubscribeGit(entry: WatchEntry): void {
    const sub = entry.gitSubscription;
    if (!sub) return;
    entry.gitSubscription = null;
    this.logger.debug(`Unsubscribing git watcher for ${entry.absolutePath}`);
    sub.unsubscribe().catch((error: unknown) => {
      this.logger.warn(
        `Failed to unsubscribe git watcher ${entry.absolutePath}: ${String(error)}`,
      );
    });
  }

  /**
   * 根目录 watcher 是否需要：file scope，或（git scope + 该目录确实是仓库）。
   * 后者用于「工作树文件变化也要刷新 git 状态」—— 编辑文件不触碰 .git。
   */
  private needsRootWatcher(entry: WatchEntry): boolean {
    const { file, git } = this.computeEntryScopes(entry);
    return file || (git && this.resolveGitDir(entry.absolutePath) !== null);
  }

  /** 订阅工作区根目录（文件事件），激活期间有效 */
  private subscribeRoot(entry: WatchEntry): void {
    entry.fileSubscribing = true;
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
        { ignore: this.resolveIgnoreGlobs(entry), ...PARCEL_WATCH_OPTIONS },
      )
      .then((subscription) => {
        entry.fileSubscribing = false;
        // 订阅完成前 scope 可能已撤销 → 撤销后立刻退订
        if (!this.needsRootWatcher(entry)) {
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
        entry.fileSubscribing = false;
        this.logger.error(
          `Failed to subscribe watcher for ${entry.absolutePath}: ${String(error)}`,
        );
      });
  }

  /** 默认忽略规则 + 工作区级 `.guada/watch-ignore` */
  private resolveIgnoreGlobs(entry: WatchEntry): string[] {
    const custom = this.readWatchIgnoreGlobs(entry.absolutePath);
    return custom.length > 0 ? [...IGNORE_GLOBS, ...custom] : IGNORE_GLOBS;
  }

  private readWatchIgnoreGlobs(workspacePath: string): string[] {
    try {
      const ignoreFile = path.join(workspacePath, ".guada", "watch-ignore");
      if (!fs.existsSync(ignoreFile)) return [];
      const globs = parseWatchIgnoreLines(
        fs.readFileSync(ignoreFile, "utf-8"),
      );
      if (globs.length > 0) {
        this.logger.debug(
          `Loaded ${globs.length} watch-ignore glob(s) from ${ignoreFile}`,
        );
      }
      return globs;
    } catch (error: unknown) {
      this.logger.warn(
        `Failed to read .guada/watch-ignore for ${workspacePath}: ${String(error)}`,
      );
      return [];
    }
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
   * 向该工作区的全部会话推送 type:"git" 事件（前端刷新 git 状态）。
   * 当前还不是 git 仓库时不订阅 —— 由前端「重新检测」按钮触发刷新感知 git init。
   *
   * 这只是 git 状态的两个触发源之一：工作树文件的增删改不会触碰 .git，由根 watcher
   * 经 scheduleGitNotify(entry, true) 补齐（见 flushEvents）。
   */
  private subscribeGitEntry(entry: WatchEntry, gitDir: string): void {
    entry.gitSubscribing = true;
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
          this.scheduleGitNotify(entry, false);
        },
        { ignore: GIT_IGNORE_GLOBS, ...PARCEL_WATCH_OPTIONS },
      )
      .then((subscription) => {
        entry.gitSubscribing = false;
        // 订阅完成前 scope 可能已撤销 → 撤销后立刻退订
        if (!this.computeEntryScopes(entry).git) {
          subscription.unsubscribe().catch(() => undefined);
          return;
        }
        entry.gitSubscription = subscription;
        this.logger.debug(`Started git watcher for ${gitDir}`);
      })
      .catch((error: unknown) => {
        entry.gitSubscribing = false;
        this.logger.warn(
          `Failed to subscribe git watcher for ${gitDir}: ${String(error)}`,
        );
      });
  }

  /**
   * 标记「git 状态可能已变化」并防抖推送（两个触发源共用同一个定时器）。
   * fromWorkTree=true 表示触发源是工作树文件变化：窗口取 GIT_WORKTREE_DEBOUNCE_MS 以合并
   * 保存/批量写文件产生的连续事件，且推送时不受读命令抑制窗口约束（见 notifyGitChangedForEntry）。
   */
  private scheduleGitNotify(entry: WatchEntry, fromWorkTree: boolean): void {
    if (fromWorkTree) entry.gitDirtyFromWorkTree = true;
    else entry.gitDirty = true;

    // 已有窗口就保留（不重置）：持续风暴/批量写文件时，纯 trailing 防抖会把 git
    // 刷新无限推迟；这里退化为「首个事件后 300ms/1s 必刷一次」的节流语义。
    if (entry.gitTimer) return;
    entry.gitTimer = setTimeout(() => {
      entry.gitTimer = null;
      const workTreeChanged = entry.gitDirtyFromWorkTree;
      entry.gitDirty = false;
      entry.gitDirtyFromWorkTree = false;
      // 定时器挂起期间 git 订阅可能已被撤销（会话切走/关闭）→ 不再推送
      if (!this.computeEntryScopes(entry).git) return;
      this.notifyGitChangedForEntry(entry, workTreeChanged);
    }, fromWorkTree ? GIT_WORKTREE_DEBOUNCE_MS : GIT_DEBOUNCE_MS);
    entry.gitTimer.unref?.();
  }

  /** 向 entry 关联的全部会话推送 type:"git"（.git 来源含读命令噪声抑制） */
  private notifyGitChangedForEntry(
    entry: WatchEntry,
    fromWorkTree: boolean,
  ): void {
    // 本端读命令刚写过 index（stat 缓存刷新）→ 这是自己引发的噪声，忽略。
    // 工作树来源的事件不是这类噪声（由编辑动作直接产生），必须放行。
    if (
      !fromWorkTree &&
      Date.now() - gitActivity.lastReadAt < GIT_READ_SUPPRESS_MS
    ) {
      return;
    }
    const now = Date.now();
    for (const sessionId of entry.sessionIds) {
      const sessionState = this.sessions.get(sessionId);
      if (!sessionState) continue;
      // 只推给真正订阅了 git 的会话：只有 file scope 的会话没必要重复拉 status
      if (!this.hasScope(sessionState, "git")) continue;
      this.notifyListeners(sessionId, {
        type: "git",
        path: "",
        sessionId,
        timestamp: now,
      });
    }
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
    if (entry.rootUnsubscribeTimer) clearTimeout(entry.rootUnsubscribeTimer);
    if (entry.gitUnsubscribeTimer) clearTimeout(entry.gitUnsubscribeTimer);
    entry.rootUnsubscribeTimer = null;
    entry.gitUnsubscribeTimer = null;
    entry.pendingOverflow = false;
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

    // 久静后退出 degraded：避免一次风暴后永久停用逐文件事件
    if (
      entry.lastEventAt > 0 &&
      now - entry.lastEventAt > EVENT_RATE_WINDOW_MS
    ) {
      entry.eventWindowStart = now;
      entry.eventWindowCount = 0;
      if (entry.degraded) {
        entry.degraded = false;
        entry.pendingOverflow = false;
        this.logger.warn(
          `Watcher ${entry.absolutePath} degraded mode recovered`,
        );
      }
    }
    entry.lastEventAt = now;

    // 速率窗口（计数器，不再维护时间戳数组）
    if (now - entry.eventWindowStart > EVENT_RATE_WINDOW_MS) {
      entry.eventWindowStart = now;
      entry.eventWindowCount = 0;
    }
    entry.eventWindowCount += events.length;

    // 单次回调超过 MAX_EVENTS_PER_FLUSH 也视为风暴：逐条 statSync/enqueue 会把
    // 事件循环卡住，直接转 degraded + overflow。
    if (
      !entry.degraded &&
      (entry.eventWindowCount > this.eventRateThreshold ||
        events.length > MAX_EVENTS_PER_FLUSH)
    ) {
      entry.degraded = true;
      entry.pendingOverflow = true;
      this.logger.warn(
        `Watcher ${entry.absolutePath} event rate high (${entry.eventWindowCount}/${EVENT_RATE_WINDOW_MS / 1000}s), enabling degraded mode`,
      );
    }

    if (entry.degraded) {
      entry.pendingOverflow = true;
      this.scheduleCoalesce(entry);
      return;
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

    // degraded：不再逐文件推送，合并为一条 overflow；git 事件仍按常规防抖发出
    if (entry.degraded) {
      const hadOverflow =
        entry.pendingOverflow || entry.pendingEvents.size > 0;
      entry.pendingOverflow = false;
      entry.pendingEvents.clear();
      if (!hadOverflow) return;
      if (this.computeEntryScopes(entry).git) {
        this.scheduleGitNotify(entry, true);
      }
      this.emitOverflow(entry);
      return;
    }

    if (entry.pendingEvents.size === 0) return;

    const events = Array.from(entry.pendingEvents.values());
    entry.pendingEvents.clear();

    // 工作树文件事件同样意味着 git 状态可能已变化（编辑文件不触碰 .git，只有根 watcher 看得到）
    if (this.computeEntryScopes(entry).git) {
      this.scheduleGitNotify(entry, true);
    }

    for (const sessionId of entry.sessionIds) {
      const sessionState = this.sessions.get(sessionId);
      if (!sessionState) continue;
      // 只给 file scope 会话发逐文件事件；git scope 会话只收 type:"git"
      if (!this.hasScope(sessionState, "file")) continue;

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

  /** degraded 模式：向 file scope 会话发一条「请整体刷新」信号 */
  private emitOverflow(entry: WatchEntry): void {
    const now = Date.now();
    let recipients = 0;
    for (const sessionId of entry.sessionIds) {
      const sessionState = this.sessions.get(sessionId);
      if (!sessionState) continue;
      if (!this.hasScope(sessionState, "file")) continue;
      recipients++;
      this.notifyListeners(sessionId, {
        type: "overflow",
        path: "",
        sessionId,
        timestamp: now,
      });
    }
    this.logger.debug(
      `Watcher ${entry.absolutePath} emitted overflow event to ${recipients} session(s)`,
    );
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
