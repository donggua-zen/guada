import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { randomUUID } from "crypto";
import { EventBusService } from "../../common/events/event-bus.service";
import type {
  ContentBlock,
  FileRef,
} from "../../common/types/conversation.types";
import type { TurnSettingsOverride } from "./types/turn-settings-override";

/**
 * 用户输入队列（M3：队列所有权在后端）
 *
 * 与 ChatRunnerService 里的系统队列（scheduler/subagent/process_monitor/job 通知）
 * 刻意分开：
 * - 系统队列按 source.kind 合并批次、有会话级退避重试；
 * - 用户消息必须逐条成回合、在停止/失败后暂停等用户操作。
 *
 * 本服务只负责状态与事件，不启动回合；ChatRunner 监听 chat.user_queue_changed
 * 与 chat.turn_finished 来消费。
 *
 * 持久化：本阶段仅内存，进程重启即丢（与 ZCode 现状一致）。
 */

export type UserQueuePauseReason = "stopped" | "error" | "manual";

export type UserQueueItemStatus = "queued" | "running" | "failed";

export interface UserInputQueueItem {
  id: string;
  sessionId: string;
  content: string;
  files?: FileRef[];
  /** 命令标记解析产物（@提及等系统注入块），补发时随消息落库 */
  injectedBlocks?: ContentBlock[];
  knowledgeBaseIds?: string[];
  replaceTurnId?: string;
  settingsOverride?: TurnSettingsOverride;
  clientId?: string;
  createdAt: Date;
  status: UserQueueItemStatus;
  error?: string;
}

export interface UserQueueItemView {
  id: string;
  content: string;
  files: FileRef[];
  knowledgeBaseIds?: string[];
  replaceTurnId?: string;
  settingsOverride?: TurnSettingsOverride;
  status: UserQueueItemStatus;
  error?: string;
  createdAt: string;
}

export interface UserQueueSnapshot {
  sessionId: string;
  /** 后端进程启动标识：重启后变化，前端据此重置 revision 比较 */
  epoch: string;
  revision: number;
  paused: { reason: UserQueuePauseReason; at: string } | null;
  promotionId: string | null;
  isProcessing: boolean;
  items: UserQueueItemView[];
}

interface SessionUserQueueState {
  items: UserInputQueueItem[];
  paused: { reason: UserQueuePauseReason; at: string } | null;
  promotionId: string | null;
  revision: number;
  isProcessing: boolean;
}

export interface EnqueueUserInputParams {
  sessionId: string;
  content: string;
  files?: FileRef[];
  /** 命令标记解析产物（@提及等系统注入块），补发时随消息落库 */
  injectedBlocks?: ContentBlock[];
  knowledgeBaseIds?: string[];
  replaceTurnId?: string;
  settingsOverride?: TurnSettingsOverride;
  clientId?: string;
}

/** 单会话上限：防止长回合期间无限堆积 */
const MAX_ITEMS_PER_SESSION = 50;

@Injectable()
export class UserInputQueueService {
  private readonly logger = new Logger(UserInputQueueService.name);
  /** 进程级 epoch：重启后变化，前端据此丢弃旧 revision 比较 */
  readonly epoch = randomUUID();
  private readonly queues = new Map<string, SessionUserQueueState>();

  constructor(private readonly eventBus: EventBusService) {}

  // === 写入 ===

  enqueue(params: EnqueueUserInputParams): {
    item: UserInputQueueItem;
    snapshot: UserQueueSnapshot;
  } {
    // 保留原文（与直发路径一致）；只用 trim 做空值判定
    const content = params.content ?? "";
    const files = params.files ?? [];
    if (!content.trim() && files.length === 0) {
      throw new HttpException(
        { error: "消息内容为空", code: "QUEUE_EMPTY_INPUT" },
        HttpStatus.BAD_REQUEST,
      );
    }

    const state = this.getOrCreateState(params.sessionId);
    if (state.items.length >= MAX_ITEMS_PER_SESSION) {
      throw new HttpException(
        {
          error: `排队消息过多（上限 ${MAX_ITEMS_PER_SESSION} 条）`,
          code: "QUEUE_FULL",
        },
        HttpStatus.CONFLICT,
      );
    }

    const item: UserInputQueueItem = {
      id: randomUUID(),
      sessionId: params.sessionId,
      content,
      ...(files.length > 0 ? { files } : {}),
      ...(params.injectedBlocks?.length
        ? { injectedBlocks: params.injectedBlocks }
        : {}),
      ...(params.knowledgeBaseIds?.length
        ? { knowledgeBaseIds: params.knowledgeBaseIds }
        : {}),
      ...(params.replaceTurnId
        ? { replaceTurnId: params.replaceTurnId }
        : {}),
      ...(params.settingsOverride
        ? { settingsOverride: params.settingsOverride }
        : {}),
      ...(params.clientId ? { clientId: params.clientId } : {}),
      createdAt: new Date(),
      status: "queued",
    };
    state.items.push(item);
    this.touch(state);
    this.logger.log(
      `用户消息入队: ${params.sessionId}, item=${item.id}, pending=${state.items.length}`,
    );
    const snapshot = this.publish(params.sessionId, state);
    return { item, snapshot };
  }

  remove(sessionId: string, itemId: string): UserQueueSnapshot {
    const state = this.queues.get(sessionId);
    if (!state) {
      throw new HttpException(
        { error: "排队消息不存在", code: "QUEUE_ITEM_NOT_FOUND" },
        HttpStatus.NOT_FOUND,
      );
    }
    const idx = state.items.findIndex((item) => item.id === itemId);
    if (idx < 0) {
      throw new HttpException(
        { error: "排队消息不存在", code: "QUEUE_ITEM_NOT_FOUND" },
        HttpStatus.NOT_FOUND,
      );
    }
    if (state.items[idx].status === "running") {
      throw new HttpException(
        { error: "消息已开始发送，无法撤回", code: "QUEUE_ITEM_ALREADY_STARTED" },
        HttpStatus.CONFLICT,
      );
    }
    state.items.splice(idx, 1);
    if (state.promotionId === itemId) state.promotionId = null;
    this.touch(state);
    return this.publish(sessionId, state);
  }

  reorder(
    sessionId: string,
    itemId: string,
    direction: -1 | 1,
  ): UserQueueSnapshot {
    const state = this.queues.get(sessionId);
    if (!state) {
      throw new HttpException(
        { error: "排队消息不存在", code: "QUEUE_ITEM_NOT_FOUND" },
        HttpStatus.NOT_FOUND,
      );
    }
    const idx = state.items.findIndex((item) => item.id === itemId);
    if (idx < 0) {
      throw new HttpException(
        { error: "排队消息不存在", code: "QUEUE_ITEM_NOT_FOUND" },
        HttpStatus.NOT_FOUND,
      );
    }

    // 可移动区间：[队首 running 前缀之后, 第一个 failed 之前)
    let lower = 0;
    while (
      lower < state.items.length &&
      state.items[lower].status === "running"
    ) {
      lower++;
    }
    const failedIdx = state.items.findIndex((item) => item.status === "failed");
    const upper = failedIdx < 0 ? state.items.length : failedIdx;
    const target = idx + direction;

    if (
      state.items[idx].status !== "queued" ||
      idx < lower ||
      target < lower ||
      target >= upper ||
      state.items[target].status !== "queued"
    ) {
      throw new HttpException(
        { error: "该位置不可移动", code: "QUEUE_REORDER_OUT_OF_RANGE" },
        HttpStatus.BAD_REQUEST,
      );
    }

    const tmp = state.items[idx];
    state.items[idx] = state.items[target];
    state.items[target] = tmp;
    this.touch(state);
    return this.publish(sessionId, state);
  }

  pause(sessionId: string, reason: UserQueuePauseReason): UserQueueSnapshot {
    const state = this.getOrCreateState(sessionId);
    state.paused = { reason, at: new Date().toISOString() };
    this.touch(state);
    return this.publish(sessionId, state);
  }

  resume(sessionId: string): UserQueueSnapshot {
    const state = this.getOrCreateState(sessionId);
    if (state.paused) {
      state.paused = null;
      this.touch(state);
    }
    return this.publish(sessionId, state);
  }

  /**
   * 记录"立即发送"意图：把目标移到队首（failed 项恢复为 queued）。
   *
   * 真正的抢断由 ChatRunner 执行：有活跃流时 abort 当前回合，
   * 终态里 consumePromotion 后恢复消费。
   */
  requestSendNow(sessionId: string, itemId: string): UserQueueSnapshot {
    const state = this.queues.get(sessionId);
    if (!state) {
      throw new HttpException(
        { error: "排队消息不存在", code: "QUEUE_ITEM_NOT_FOUND" },
        HttpStatus.NOT_FOUND,
      );
    }
    const idx = state.items.findIndex((item) => item.id === itemId);
    if (idx < 0) {
      throw new HttpException(
        { error: "排队消息不存在", code: "QUEUE_ITEM_NOT_FOUND" },
        HttpStatus.NOT_FOUND,
      );
    }
    if (state.items[idx].status === "running") {
      throw new HttpException(
        { error: "消息已开始发送", code: "QUEUE_ITEM_ALREADY_STARTED" },
        HttpStatus.CONFLICT,
      );
    }

    if (state.items[idx].status === "failed") {
      state.items[idx].status = "queued";
      state.items[idx].error = undefined;
    }
    const [item] = state.items.splice(idx, 1);
    let insertAt = 0;
    while (
      insertAt < state.items.length &&
      state.items[insertAt].status === "running"
    ) {
      insertAt++;
    }
    state.items.splice(insertAt, 0, item);
    state.promotionId = itemId;
    state.paused = null;
    this.touch(state);
    return this.publish(sessionId, state);
  }

  /** 消费"立即发送"意图（当前回合结束后调用） */
  consumePromotion(sessionId: string): string | null {
    const state = this.queues.get(sessionId);
    if (!state?.promotionId) return null;
    const id = state.promotionId;
    state.promotionId = null;
    this.touch(state);
    this.publish(sessionId, state);
    return id;
  }

  // === 供 ChatRunner 消费 ===

  /** 队首（只读）；调用方需自行判断 status 与 paused */
  peekHead(sessionId: string): UserInputQueueItem | undefined {
    return this.queues.get(sessionId)?.items[0];
  }

  getState(sessionId: string): SessionUserQueueState | undefined {
    return this.queues.get(sessionId);
  }

  hasPending(sessionId: string): boolean {
    return (this.queues.get(sessionId)?.items.length ?? 0) > 0;
  }

  hasAnyPending(): boolean {
    for (const state of this.queues.values()) {
      if (state.items.length > 0) return true;
    }
    return false;
  }

  getCount(sessionId: string): number {
    return this.queues.get(sessionId)?.items.length ?? 0;
  }

  getAllCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const [sessionId, state] of this.queues) {
      if (state.items.length > 0) counts[sessionId] = state.items.length;
    }
    return counts;
  }

  isProcessing(sessionId: string): boolean {
    return this.queues.get(sessionId)?.isProcessing === true;
  }

  setProcessing(sessionId: string, value: boolean): void {
    const state = this.queues.get(sessionId);
    if (state) state.isProcessing = value;
  }

  markRunning(sessionId: string, itemId: string): void {
    const state = this.queues.get(sessionId);
    const item = state?.items.find((entry) => entry.id === itemId);
    if (!state || !item) return;
    item.status = "running";
    this.touch(state);
    this.publish(sessionId, state);
  }

  /** 启动成功：移除已进入回合的队首项 */
  completeHead(sessionId: string): void {
    const state = this.queues.get(sessionId);
    if (!state) return;
    while (state.items[0]?.status === "running") {
      state.items.shift();
    }
    if (state.promotionId === null && state.items.length === 0) {
      state.paused = null;
    }
    this.touch(state);
    this.publish(sessionId, state);
  }

  resetToQueued(sessionId: string, itemId: string): void {
    const state = this.queues.get(sessionId);
    const item = state?.items.find((entry) => entry.id === itemId);
    if (!state || !item) return;
    item.status = "queued";
    this.touch(state);
    this.publish(sessionId, state);
  }

  markFailed(sessionId: string, itemId: string, error: string): void {
    const state = this.queues.get(sessionId);
    const item = state?.items.find((entry) => entry.id === itemId);
    if (!state || !item) return;
    item.status = "failed";
    item.error = error;
    this.touch(state);
    this.publish(sessionId, state);
  }

  /** 会话删除：内存队列一并清理（不广播，前端随 session_deleted 清理） */
  clearSession(sessionId: string): void {
    this.queues.delete(sessionId);
  }

  @OnEvent("session.deleted")
  handleSessionDeleted(event: { sessionId?: string }): void {
    if (event?.sessionId) {
      this.clearSession(event.sessionId);
    }
  }

  // === 读取 ===

  getSnapshot(sessionId: string): UserQueueSnapshot {
    const state = this.queues.get(sessionId);
    return state
      ? this.toSnapshot(sessionId, state)
      : {
          sessionId,
          epoch: this.epoch,
          revision: 0,
          paused: null,
          promotionId: null,
          isProcessing: false,
          items: [],
        };
  }

  /** 仅供测试重置 */
  clearAll(): void {
    this.queues.clear();
  }

  // === 内部 ===

  private getOrCreateState(sessionId: string): SessionUserQueueState {
    let state = this.queues.get(sessionId);
    if (!state) {
      state = {
        items: [],
        paused: null,
        promotionId: null,
        revision: 0,
        isProcessing: false,
      };
      this.queues.set(sessionId, state);
    }
    return state;
  }

  private touch(state: SessionUserQueueState): void {
    state.revision++;
  }

  private toSnapshot(
    sessionId: string,
    state: SessionUserQueueState,
  ): UserQueueSnapshot {
    const snapshot: UserQueueSnapshot = {
      sessionId,
      epoch: this.epoch,
      revision: state.revision,
      paused: state.paused,
      promotionId: state.promotionId,
      isProcessing: state.isProcessing,
      items: state.items.map((item) => ({
        id: item.id,
        content: item.content,
        files: item.files ?? [],
        ...(item.knowledgeBaseIds?.length
          ? { knowledgeBaseIds: item.knowledgeBaseIds }
          : {}),
        ...(item.replaceTurnId ? { replaceTurnId: item.replaceTurnId } : {}),
        ...(item.settingsOverride
          ? { settingsOverride: item.settingsOverride }
          : {}),
        status: item.status,
        ...(item.error ? { error: item.error } : {}),
        createdAt: item.createdAt.toISOString(),
      })),
    };
    return snapshot;
  }

  /**
   * 状态变化后广播全量快照并返回同一份快照。
   * 队列通常很短，前端整块替换即可；HTTP 响应直接复用该返回值。
   */
  private publish(
    sessionId: string,
    state: SessionUserQueueState,
  ): UserQueueSnapshot {
    const snapshot = this.toSnapshot(sessionId, state);
    this.eventBus.emit("chat.user_queue_changed", {
      sessionId,
      timestamp: new Date().toISOString(),
      payload: snapshot,
    });
    return snapshot;
  }
}
