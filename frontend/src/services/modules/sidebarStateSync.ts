import type {
  SidebarStateChangeMeta,
  SidebarStateSnapshot,
} from "./SessionEventsService";

const DEFAULT_DEBOUNCE_MS = 400;
const DEFAULT_RETRY_DELAYS_MS = [5_000, 15_000, 30_000];
/** 对账因分页/初始化忙被跳过时的重试间隔 */
const BUSY_RETRY_MS = 1_000;

export interface SidebarStateSyncOptions {
  /** 当前已知修订号（`bootId:revision`）；未连接时为 null */
  getStateKey: () => string | null;
  /** 订阅传输层修订号变化 */
  subscribe: (
    listener: (state: SidebarStateSnapshot, meta: SidebarStateChangeMeta) => void,
  ) => () => void;
  /** 主动核对一次（回前台补一次） */
  ping: () => void;
  /**
   * 执行一次侧栏对账。
   * 返回 false = 本次因忙/代际冲突跳过了应用，稍后重试。
   */
  refresh: () => Promise<boolean>;
  isVisible?: () => boolean;
  debounceMs?: number;
  retryDelaysMs?: number[];
  onError?: (error: unknown) => void;
}

/**
 * 侧栏修订号 → 快照对账的协调器。
 *
 * - 修订号变化：400ms 防抖后刷新（同一次用户操作的多条变更合并）
 * - 重连：无条件刷新一次（兜住离线期间没有修订号变化的会话增删改）
 * - 页面隐藏：只记 pending，恢复可见后再刷新
 * - 单飞 + trailing rerun：刷新期间再来变更，结束后只补跑一次
 * - 失败按 5s/15s/30s 退避（封顶后按 30s 继续），成功后复位
 */
export class SidebarStateSync {
  private readonly debounceMs: number;
  private readonly retryDelaysMs: number[];

  private unsubscribe: (() => void) | null = null;
  private visibilityHandler: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private rerun = false;
  private pending = false;
  private forceNext = false;
  private retryIndex = 0;
  private hasApplied = false;
  private lastAppliedKey: string | null = null;
  private started = false;

  constructor(private readonly options: SidebarStateSyncOptions) {
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.unsubscribe = this.options.subscribe((state, meta) =>
      this.handleState(state, meta),
    );
    if (typeof document !== "undefined") {
      this.visibilityHandler = () => {
        if (this.isVisible()) this.handleVisible();
      };
      document.addEventListener("visibilitychange", this.visibilityHandler);
    }
    // 启动前若已经完成过一次加载、且期间修订号又变了，补一次对账
    if (this.hasApplied) {
      const current = this.options.getStateKey();
      if (current && current !== this.lastAppliedKey) this.schedule(false);
    }
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.visibilityHandler && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
    }
    this.visibilityHandler = null;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.running = false;
    this.rerun = false;
    this.pending = false;
    this.forceNext = false;
  }

  /**
   * 首屏/对账应用成功后标记已消费的修订号。
   * 传请求开始时的 key：若读页期间又来了新修订号，会立刻再排一次对账。
   */
  markApplied(key: string | null = this.options.getStateKey()): void {
    this.hasApplied = true;
    this.lastAppliedKey = key;
    this.retryIndex = 0;
    const current = this.options.getStateKey();
    if (current && current !== key) this.schedule(false);
  }

  private isVisible(): boolean {
    return this.options.isVisible?.() ?? true;
  }

  private handleState(
    _state: SidebarStateSnapshot,
    meta: SidebarStateChangeMeta,
  ): void {
    if (!this.hasApplied) return; // 首屏加载还没完成，由 loadSessions 自己收敛
    if (meta.reconnected) {
      // 重连时修订号可能没变，但离线期间的会话增删改需要一次对账
      this.schedule(true);
      return;
    }
    const current = this.options.getStateKey();
    if (current && current !== this.lastAppliedKey) {
      this.schedule(false);
    }
  }

  private handleVisible(): void {
    const current = this.options.getStateKey();
    const force = this.forceNext;
    if (
      this.pending ||
      (current !== null && current !== this.lastAppliedKey) ||
      force
    ) {
      this.options.ping();
      this.schedule(force, 0);
    }
  }

  private schedule(force: boolean, delay = this.debounceMs): void {
    if (!this.started) return;
    if (force) this.forceNext = true;
    if (this.timer) {
      // 强制触发（重连/失败重试后的新变更）可以提前覆盖已有的退避等待
      if (!force) return;
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.isVisible()) {
      this.pending = true;
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, delay);
  }

  private async run(): Promise<void> {
    if (!this.started) return;
    if (this.running) {
      this.rerun = true;
      return;
    }
    if (!this.isVisible()) {
      this.pending = true;
      return;
    }
    if (!this.hasApplied) {
      this.pending = true;
      return;
    }

    const targetKey = this.options.getStateKey();
    const force = this.forceNext;
    this.forceNext = false;
    if (!force && targetKey !== null && targetKey === this.lastAppliedKey) {
      this.pending = false;
      return;
    }

    this.running = true;
    this.pending = false;
    try {
      const applied = await this.options.refresh();
      if (!applied) {
        this.pending = true;
        // 强制重跑：忙跳过的这次不能因为“修订号没变”被下一次 run 直接短路
        this.schedule(true, BUSY_RETRY_MS);
        return;
      }
      this.lastAppliedKey = targetKey ?? this.options.getStateKey();
      this.retryIndex = 0;
      const current = this.options.getStateKey();
      if (current && current !== this.lastAppliedKey) this.rerun = true;
    } catch (error) {
      this.options.onError?.(error);
      const delay =
        this.retryDelaysMs[
          Math.min(this.retryIndex, this.retryDelaysMs.length - 1)
        ] ?? BUSY_RETRY_MS;
      if (this.retryIndex < this.retryDelaysMs.length) this.retryIndex += 1;
      // 失败时修订号通常没变：强制重跑，否则下一次 run 会因 key 相同直接返回
      this.schedule(true, delay);
    } finally {
      this.running = false;
      if (this.rerun) {
        this.rerun = false;
        this.schedule(false, 0);
      }
    }
  }
}
