import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnApplicationShutdown,
} from "@nestjs/common";
import { EventBusService } from "../../common/events/event-bus.service";
import { mintId } from "../../common/utils/id.util";
import {
  JOB_MAX_CONCURRENT_PER_SESSION,
  JOB_READ_DEFAULT_MAX_BYTES,
  JOB_READ_MAX_MAX_BYTES,
  JOB_READ_MIN_MAX_BYTES,
  JOB_TERMINAL_TTL_MS,
  type JobId,
  type JobListSnapshot,
  type JobOutcome,
  type JobOutputRead,
  type JobReadOptions,
  type JobSettledEvent,
  type JobSnapshot,
  type JobStartSpec,
  type JobsSnapshotEvent,
} from "./job.types";

interface JobRecord {
  id: JobId;
  spec: JobStartSpec;
  status: JobSnapshot["status"];
  detail?: string;
  exitCode?: number | null;
  output?: string;
  logFilePath?: string;
  logSize?: number;
  startedAt: number;
  finishedAt?: number;
  reported: boolean;
  settled: boolean;
  /**
   * 模型侧自动增量游标（字节日志类 job 专用）：上次 job_read 已读到的字节位置。
   * 只挂模型路径；REST/前端继续显式传 offset，互不干扰。随 JobRecord 存灭。
   */
  modelReadOffset?: number;
  /**
   * 完成通知挂起标记：settle 时会话不空闲（运行中/队列非空）→ 不投递，
   * 等回合正常收尾或下一次空闲边界再投。回合开始时统一清除。
   */
  noticePending?: boolean;
  /** 正在 wait 的调用者数量；结算时若有等待者，输出视为已交付 */
  waiters: number;
  settledPromise: Promise<void>;
  settledResolve: () => void;
  cleanupTimer?: NodeJS.Timeout;
}

/**
 * 进程内后台作业注册表。
 *
 * 设计边界：
 * - 不执行实际工作，不持有输出；read/cancel/isAlive 都由执行器通过 start 时传入的钩子提供。
 * - 只做控制面：稳定 jobId、状态机、归属校验、每会话配额、TTL、通知事件。
 * - 不持久化：重启后 job 丢失，但执行器自己的日志文件仍可读。
 */
@Injectable()
export class JobRegistryService
  implements OnModuleDestroy, OnApplicationShutdown
{
  private readonly logger = new Logger(JobRegistryService.name);
  private readonly jobs = new Map<JobId, JobRecord>();
  private readonly sessionJobs = new Map<string, Set<JobId>>();
  private readonly revisions = new Map<string, number>();
  /** 有 active job 的会话的 1s 快照 ticker */
  private readonly snapshotTimers = new Map<string, NodeJS.Timeout>();
  /** 退出收尾期间不再投递完成通知 */
  private shuttingDown = false;

  constructor(private readonly eventBus: EventBusService) {}

  beginShutdown(): void {
    this.shuttingDown = true;
  }

  isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  onApplicationShutdown(): void {
    this.beginShutdown();
  }

  onModuleDestroy(): void {
    for (const timer of this.snapshotTimers.values()) clearInterval(timer);
    this.snapshotTimers.clear();
    for (const record of this.jobs.values()) {
      if (record.cleanupTimer) {
        clearTimeout(record.cleanupTimer);
        record.cleanupTimer = undefined;
      }
    }
  }

  /**
   * 注册一个后台作业。调用方必须在工作真正开始后、返回 jobId 前调用，
   * 这样完成事件不会早于登记。
   */
  start(spec: JobStartSpec): JobId {
    if (!spec.sessionId) {
      throw new Error("job sessionId is required");
    }
    if (!spec.kind) {
      throw new Error("job kind is required");
    }
    if (!spec.label) {
      throw new Error("job label is required");
    }

    const active = this.activeCount(spec.sessionId);
    if (active >= JOB_MAX_CONCURRENT_PER_SESSION) {
      throw new Error(
        `background job limit reached for this session (limit: ${JOB_MAX_CONCURRENT_PER_SESSION}); use job_stop to stop an unneeded job first`,
      );
    }

    const id = mintId("job-") as JobId;
    let settledResolve!: () => void;
    const settledPromise = new Promise<void>((resolve) => {
      settledResolve = resolve;
    });
    const record: JobRecord = {
      id,
      spec,
      status: "running",
      startedAt: Date.now(),
      reported: false,
      settled: false,
      waiters: 0,
      settledPromise,
      settledResolve,
      logFilePath: spec.logFilePath,
    };

    this.jobs.set(id, record);
    let ids = this.sessionJobs.get(spec.sessionId);
    if (!ids) {
      ids = new Set();
      this.sessionJobs.set(spec.sessionId, ids);
    }
    ids.add(id);

    // 生产者的 done 必须被消费；reject 视为 failed，不能让 job 永久停在 running。
    void spec.done.then(
      (outcome) => this.settle(id, outcome),
      (error: unknown) =>
        this.settle(id, {
          status: "failed",
          detail: String(error instanceof Error ? error.message : error),
        }),
    );

    this.ensureSnapshotTicker(spec.sessionId);
    void this.emitSnapshot(spec.sessionId);
    return id;
  }

  /** 执行器结算入口；first-wins，重复调用无副作用。 */
  settle(id: JobId, outcome: JobOutcome): void {
    const record = this.jobs.get(id);
    if (!record || record.settled) return;

    record.settled = true;
    record.status = outcome.status;
    record.detail = outcome.detail;
    record.exitCode = outcome.exitCode;
    record.output = outcome.output;
    record.finishedAt = Date.now();
    // 有等待者时，结算后的输出由等待者读取；先置 reported，避免同时再发通知。
    if (record.waiters > 0) this.markReported(id);
    record.settledResolve();

    this.scheduleCleanup(record);
    void this.emitSnapshot(record.spec.sessionId);
    this.eventBus.emit<JobSettledEvent>("job.settled", {
      sessionId: record.spec.sessionId,
      job: this.toSnapshot(record),
      notify: record.spec.notify !== false,
    });
  }

  /**
   * 非破坏性读取。终态读取会置 reported（抑制完成通知）；running 读取不置。
   * 读取器失败且已有终态兜底输出时返回兜底输出。
   */
  async read(
    id: JobId,
    sessionId: string,
    options: JobReadOptions = {},
    readOptions: { markReported?: boolean } = {},
  ): Promise<{ output: JobOutputRead; job: JobSnapshot }> {
    const record = this.getRecord(id, sessionId);
    const normalized = normalizeReadOptions(options);

    let output: JobOutputRead;
    try {
      output = await record.spec.read(normalized);
    } catch (error) {
      if (record.settled && record.output !== undefined) {
        const text = record.output;
        output = {
          text,
          offset: 0,
          nextOffset: Buffer.byteLength(text, "utf8"),
          size: Buffer.byteLength(text, "utf8"),
          truncated: false,
          logFilePath: record.logFilePath,
        };
      } else {
        throw error;
      }
    }

    if (output.logFilePath) record.logFilePath = output.logFilePath;
    record.logSize = output.size;
    if (record.settled && readOptions.markReported !== false) {
      this.markReported(id);
    }

    return { output, job: this.toSnapshot(record) };
  }

  /**
   * 模型侧自动增量读取（job_read 专用）。
   *
   * 按 kind 分派：
   * - 字节日志类（shell/remote-shell/pty）：首次读尾部，之后读 [游标, 新末尾)，
   *   游标随返回推进——模型零参数拿到「上次没读的部分」，单次增量超上限时截断，
   *   再调一次自然续读；
   * - 内存文本类（subagent/workflow/scheduler）：无稳定字节空间（快照每次整体重生成），
   *   以最大上限一次给全。
   *
   * 终态 markReported / 兜底输出语义与 read() 一致。
   */
  async readIncremental(
    id: JobId,
    sessionId: string,
    readOptions: { markReported?: boolean } = {},
  ): Promise<{ output: JobOutputRead; job: JobSnapshot }> {
    const record = this.getRecord(id, sessionId);
    const isByteLogKind =
      record.spec.kind === "shell" ||
      record.spec.kind === "remote-shell" ||
      record.spec.kind === "pty";

    if (isByteLogKind && record.modelReadOffset !== undefined) {
      const result = await this.read(
        id,
        sessionId,
        { offset: record.modelReadOffset },
        readOptions,
      );
      record.modelReadOffset = result.output.nextOffset;
      return result;
    }
    if (isByteLogKind) {
      const result = await this.read(id, sessionId, {}, readOptions);
      record.modelReadOffset = result.output.nextOffset;
      return result;
    }
    return this.read(
      id,
      sessionId,
      { maxBytes: JOB_READ_MAX_MAX_BYTES },
      readOptions,
    );
  }

  /**
   * 有界等待。超时返回当前快照（不杀 job）；等待到终态会置 reported。
   */
  async wait(
    id: JobId,
    sessionId: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<JobSnapshot> {
    const record = this.getRecord(id, sessionId);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error(
        `invalid wait timeout: expected a positive number, got ${JSON.stringify(timeoutMs)}`,
      );
    }

    if (!record.settled) {
      if (signal?.aborted) throw new Error("wait aborted");
      record.waiters += 1;
      try {
        await this.waitForSettled(record, timeoutMs, signal);
      } finally {
        record.waiters = Math.max(0, record.waiters - 1);
      }
    }
    if (record.settled) this.markReported(id);
    return this.toSnapshot(record);
  }

  /**
   * 请求取消。终态返回 already-finished；运行中先置 stopping/reported，再调用执行器 cancel。
   * 实际终态由执行器 done 结算，避免把“已下刀”谎报成“已退出”。
   */
  kill(
    id: JobId,
    sessionId: string,
    reason?: string,
  ): "requested" | "already-finished" {
    const record = this.getRecord(id, sessionId);
    if (record.settled) {
      this.markReported(id);
      return "already-finished";
    }

    record.status = "stopping";
    this.markReported(id);
    void this.emitSnapshot(record.spec.sessionId);

    try {
      const result = record.spec.cancel(reason);
      if (result && typeof (result as Promise<void>).then === "function") {
        void (result as Promise<void>).catch((error: unknown) => {
          this.logger.warn(
            `job ${id} cancel rejected: ${String(error)}`,
          );
          this.settle(id, {
            status: "failed",
            detail: `cancel failed: ${String(error)}`,
          });
        });
      }
    } catch (error) {
      this.logger.warn(`job ${id} cancel threw: ${String(error)}`);
      this.settle(id, {
        status: "failed",
        detail: `cancel failed: ${String(error)}`,
      });
    }

    return "requested";
  }

  /**
   * 向运行中的作业投递输入（shell 写 stdin / 子 Agent 继续对话）。
   * 作业未声明 send 时明确报错，让模型换用对应的能力，而不是静默丢弃。
   */
  async send(
    id: JobId,
    sessionId: string,
    input: string,
    appendNewline = true,
  ): Promise<void> {
    const record = this.getRecord(id, sessionId);
    if (!record.spec.send) {
      throw new Error(
        `job ${id} (kind: ${record.spec.kind}) does not support send`,
      );
    }
    await record.spec.send(input, appendNewline);
  }

  list(sessionId: string): JobSnapshot[] {
    const ids = this.sessionJobs.get(sessionId);
    if (!ids || ids.size === 0) return [];
    return [...ids]
      .map((id) => this.jobs.get(id))
      .filter((record): record is JobRecord => !!record)
      .sort((a, b) => a.startedAt - b.startedAt)
      .map((record) => this.toSnapshot(record));
  }

  /** 前端 jobs 快照：全量元数据 + 实时 logSize（有 getLogSize 的执行器）。 */
  async snapshot(sessionId: string): Promise<JobListSnapshot> {
    const ids = this.sessionJobs.get(sessionId);
    if (!ids || ids.size === 0) {
      return { revision: this.revisions.get(sessionId) ?? 0, jobs: [] };
    }
    const records = [...ids]
      .map((id) => this.jobs.get(id))
      .filter((record): record is JobRecord => !!record)
      .sort((a, b) => a.startedAt - b.startedAt);

    const jobs = await Promise.all(
      records.map(async (record) => {
        let logSize = record.logSize;
        if (record.spec.getLogSize) {
          try {
            logSize = await record.spec.getLogSize();
          } catch {
            // 日志文件可能已被 GC：沿用最后已知大小
          }
        }
        return {
          ...this.toSnapshot(record),
          ...(logSize !== undefined ? { logSize } : {}),
        };
      }),
    );
    return {
      revision: this.revisions.get(sessionId) ?? 0,
      jobs,
    };
  }

  get(id: JobId, sessionId?: string): JobSnapshot | null {
    const record = this.jobs.get(id);
    if (!record) return null;
    if (sessionId && record.spec.sessionId !== sessionId) {
      throw new Error(`job ${id} belongs to another session`);
    }
    return this.toSnapshot(record);
  }

  has(id: JobId): boolean {
    return this.jobs.has(id);
  }

  markReported(id: JobId): void {
    const record = this.jobs.get(id);
    if (!record || record.reported) return;
    record.reported = true;
    this.invokeHook(record.spec.onReported, `onReported(${id})`);
  }

  /**
   * 完成通知挂起：settle 时会话不空闲，本轮由 turn.stopping drain / 模型读取负责，
   * 回合正常收尾或下一次空闲边界再决定是否投递。
   */
  markNoticePending(id: JobId): void {
    const record = this.jobs.get(id);
    if (!record || record.reported || !record.settled) return;
    record.noticePending = true;
  }

  /** 回合开始：会话重新运行，挂起标记全部作废（模型可 job_list 自行发现）。 */
  clearPendingNotices(sessionId: string): void {
    for (const id of this.sessionJobs.get(sessionId) ?? []) {
      const record = this.jobs.get(id);
      if (record) record.noticePending = false;
    }
  }

  /**
   * 取出并清除该会话的挂起通知（只返回已结算且未被读取的记录）。
   * 调用方负责投递；投递即 markReported。
   */
  takePendingNotices(sessionId: string): JobSnapshot[] {
    const out: JobSnapshot[] = [];
    for (const id of this.sessionJobs.get(sessionId) ?? []) {
      const record = this.jobs.get(id);
      if (!record || !record.noticePending) continue;
      record.noticePending = false;
      if (!record.settled || record.reported) continue;
      out.push(this.toSnapshot(record));
    }
    return out;
  }

  hasActiveJobs(): boolean {
    for (const record of this.jobs.values()) {
      if (record.status === "running" || record.status === "stopping") return true;
    }
    return false;
  }

  /**
   * 会话销毁时取消并移除该会话全部 job。返回移除数量。
   * 取消最多等待 2s；超时后只移除登记，执行器可能仍在收尾。
   */
  async disposeSession(sessionId: string): Promise<number> {
    const ids = [...(this.sessionJobs.get(sessionId) ?? [])];
    if (ids.length === 0) return 0;

    const records = ids
      .map((id) => this.jobs.get(id))
      .filter((record): record is JobRecord => !!record);

    for (const record of records) {
      if (!record.settled) this.kill(record.id, sessionId, "session disposed");
    }

    await this.raceWithTimeout(
      Promise.all(records.map((record) => record.settledPromise)),
      2_000,
    );

    for (const record of records) {
      this.removeRecord(record);
    }
    void this.emitSnapshot(sessionId);
    return records.length;
  }

  private getRecord(id: JobId, sessionId?: string): JobRecord {
    const record = this.jobs.get(id);
    if (!record) throw new Error(`unknown job ${id}`);
    if (sessionId && record.spec.sessionId !== sessionId) {
      throw new Error(`job ${id} belongs to another session`);
    }
    return record;
  }

  private activeCount(sessionId: string): number {
    const ids = this.sessionJobs.get(sessionId);
    if (!ids) return 0;
    let count = 0;
    for (const id of ids) {
      const record = this.jobs.get(id);
      if (record && (record.status === "running" || record.status === "stopping")) {
        count += 1;
      }
    }
    return count;
  }

  private waitForSettled(
    record: JobRecord,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let finished = false;
      const cleanup = (): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      };
      const onAbort = (): void => {
        cleanup();
        reject(new Error("wait aborted"));
      };
      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, timeoutMs);
      timer.unref?.();

      signal?.addEventListener("abort", onAbort, { once: true });
      void record.settledPromise.then(() => {
        cleanup();
        resolve();
      });
    });
  }

  /** 有界等待一个 promise；超时或完成后都清掉定时器，避免 Jest/退出被挂住。 */
  private raceWithTimeout(
    promise: Promise<unknown>,
    timeoutMs: number,
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      let finished = false;
      const finish = (): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      timer.unref?.();
      void promise.then(finish, finish);
    });
  }

  private scheduleCleanup(record: JobRecord): void {
    if (record.cleanupTimer) clearTimeout(record.cleanupTimer);
    record.cleanupTimer = setTimeout(() => {
      record.cleanupTimer = undefined;
      if (!record.settled) return;
      this.removeRecord(record);
      this.bumpRevision(record.spec.sessionId);
    }, JOB_TERMINAL_TTL_MS);
    record.cleanupTimer.unref?.();
  }

  private removeRecord(record: JobRecord): void {
    // TTL timer 与 disposeSession 可能同时移除同一个 record：只处理第一次。
    if (this.jobs.get(record.id) !== record) return;
    if (record.cleanupTimer) {
      clearTimeout(record.cleanupTimer);
      record.cleanupTimer = undefined;
    }
    this.jobs.delete(record.id);
    const ids = this.sessionJobs.get(record.spec.sessionId);
    if (ids) {
      ids.delete(record.id);
      if (ids.size === 0) this.sessionJobs.delete(record.spec.sessionId);
    }
    this.invokeHook(record.spec.onDisposed, `onDisposed(${record.id})`);
    void this.emitSnapshot(record.spec.sessionId);
  }

  private invokeHook(hook: (() => void) | undefined, label: string): void {
    if (!hook) return;
    try {
      hook();
    } catch (error: unknown) {
      this.logger.warn(`job ${label} threw: ${String(error)}`);
    }
  }

  private bumpRevision(sessionId: string): number {
    const next = (this.revisions.get(sessionId) ?? 0) + 1;
    this.revisions.set(sessionId, next);
    return next;
  }

  /** 有 active job 的会话每 1s 推一次全量快照（含日志大小）。 */
  private ensureSnapshotTicker(sessionId: string): void {
    if (this.snapshotTimers.has(sessionId)) return;
    const timer = setInterval(() => {
      if (this.activeCount(sessionId) === 0) {
        clearInterval(timer);
        this.snapshotTimers.delete(sessionId);
        return;
      }
      void this.emitSnapshot(sessionId);
    }, 1_000);
    timer.unref?.();
    this.snapshotTimers.set(sessionId, timer);
  }

  private async emitSnapshot(sessionId: string): Promise<void> {
    let jobs: JobSnapshot[];
    try {
      jobs = (await this.snapshot(sessionId)).jobs;
    } catch (error) {
      this.logger.warn(
        `build jobs snapshot failed (${sessionId}): ${String(error)}`,
      );
      return;
    }
    const revision = this.bumpRevision(sessionId);
    this.eventBus.emit<JobsSnapshotEvent>("jobs.changed", {
      sessionId,
      revision,
      timestamp: new Date().toISOString(),
      jobs,
    });
  }

  private toSnapshot(record: JobRecord): JobSnapshot {
    return {
      id: record.id,
      kind: record.spec.kind,
      label: record.spec.label,
      sessionId: record.spec.sessionId,
      status: record.status,
      ...(record.detail !== undefined ? { detail: record.detail } : {}),
      ...(record.spec.handle !== undefined ? { handle: record.spec.handle } : {}),
      startedAt: record.startedAt,
      ...(record.finishedAt !== undefined
        ? { finishedAt: record.finishedAt }
        : {}),
      ...(record.exitCode !== undefined ? { exitCode: record.exitCode } : {}),
      ...(record.logFilePath !== undefined
        ? { logFilePath: record.logFilePath }
        : {}),
      ...(record.logSize !== undefined ? { logSize: record.logSize } : {}),
      reported: record.reported,
    };
  }
}

/** 夹取 offset/maxBytes，避免模型传入 0、负数或超大值。 */
function normalizeReadOptions(options: JobReadOptions): JobReadOptions {
  const normalized: JobReadOptions = {};
  if (options.offset !== undefined) {
    if (!Number.isFinite(options.offset)) {
      throw new Error("offset must be a finite number");
    }
    normalized.offset = Math.max(0, Math.floor(options.offset));
  }
  if (options.maxBytes !== undefined) {
    if (!Number.isFinite(options.maxBytes)) {
      throw new Error("maxBytes must be a finite number");
    }
    normalized.maxBytes = Math.min(
      JOB_READ_MAX_MAX_BYTES,
      Math.max(JOB_READ_MIN_MAX_BYTES, Math.floor(options.maxBytes)),
    );
  } else {
    normalized.maxBytes = JOB_READ_DEFAULT_MAX_BYTES;
  }
  return normalized;
}
