import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { OnEvent } from "@nestjs/event-emitter";
import {
  StreamStatusChangedEvent,
  SessionCreatedEvent,
  SessionUpdatedEvent,
  SessionDeletedEvent,
  SessionClearedEvent,
  SubAgentCreatedEvent,
  SubAgentRunEndedEvent,
  TodoUpdatedEvent,
  GoalUpdatedEvent,
  UserQueueChangedEvent,
  BotStatusChangedEvent,
  BotChangedEvent,
  SchedulerTaskFinishedEvent,
  toSessionEvent,
} from "../../common/events/stream.events";
import {
  EVENT_METHOD,
  createUnifiedEvent,
  type EventMethod,
} from "../../common/events/unified-event.types";
import type { SessionStreamEvent } from "./types/event-chunk.types";
import { SessionStreamManager } from "./session-stream.manager";
import { APP_BOOT_ID } from "../../common/utils/boot-id.util";
import { SESSION_STORE_TOKEN } from './session-store.facade';
import type { SessionStoreFacade } from './session-store.facade';
import { HOOKS } from "./types/hooks.contract";
import type { JobsSnapshotEvent } from "../jobs/job.types";
import { UserInputQueueService } from "./user-input-queue.service";
/**
 * 会话事件类型
 */
export type SessionEventType =
  | "connected"
  | "session_snapshot"
  | "session_created"
  | "session_deleted"
  | "session_cleared"
  | "session_renamed"
  | "session_updated"
  | "stream_status_changed"
  | "user_message_created"
  | "sub_agent_create"
  | "sub_agent_ended"
  | "todo_updated"
  | "goal_updated"
  | "jobs_snapshot"
  | "plugins_changed"
  | "queue_updated"
  | "queues_snapshot"
  | "bot_status_changed"
  | "bot_changed"
  | "scheduler_task_finished";

/**
 * 会话事件
 */
export interface SessionEvent {
  type: SessionEventType;
  sessionId: string;
  timestamp: string;
  // 事件负载，根据 type 不同而变化
  payload?: Record<string, any>;
  // 发起者标识，用于前端忽略自身消息
  source?: string;
}

/** 终态墓碑保留时长：覆盖移动端切后台的典型时长；更久由 status 探测/详情快照兜底 */
const RECENT_TERMINAL_TTL_MS = 10 * 60_000;
/** 终态墓碑上限（单账户、每会话一条；超限淘汰最旧） */
const MAX_RECENT_TERMINALS = 200;

/**
 * 终态墓碑：最近结束的流。
 *
 * stopStream 会删除 ActiveStream + eventBuffer，而终态帧只在完成那一刻广播一次；
 * 客户端后台/断线期间跑完的回合拿不到任何终态信号，只能靠 status 探测/详情快照猜。
 * 保留短 TTL 的终态快照，在 SSE 连接建立时补发，客户端即可直接收敛。
 */
interface RecentTerminal {
  event: SessionEvent;
  terminalId: string;
  endedAt: number;
}

/**
 * 带内历史快照的待提交状态。
 *
 * 读页是异步的（磁盘 IO），期间的 live 帧必须先积压在连接级队列里，
 * 等 snapshot 帧写入同一 Subject 之后再按序排空——这是"快照与后续事件同通道"
 * 的全部意义：客户端不需要自己缓冲。
 */
interface PendingSnapshot {
  requestId: string;
  sessionId: string;
  queue: Array<{ data: string; logSeq?: number }>;
}

/**
 * 实时事件连接（一条 WebSocket）。
 *
 * 由 WsEventsGateway 注册；本服务只依赖 `send(data: string)`，便于测试替身。
 * `watchedSessions` 决定内容帧是否下发；`pendingSnapshot` 在读页期间积压该连接的帧。
 */
export interface EventConnection {
  clientId: string;
  connectionId: string;
  send: (data: string) => void;
  /** 本连接关注的会话（内容帧只发给订阅者） */
  watchedSessions: Set<string>;
  /** 非空 = 正在为该连接生成历史快照，期间所有帧进 queue */
  pendingSnapshot?: PendingSnapshot;
  /** 快照串行化：同一连接上的 open 请求依次执行（多 pane 同时打开不互相抢占） */
  openChain: Promise<void>;
  connectedAt: Date;
}

/** 快照读页期间允许积压的帧上限（超过丢最旧并告警；正常读页是毫秒级） */
const MAX_PENDING_SNAPSHOT_QUEUE = 2000;

/**
 * 必须全局广播的流帧类型（不按 watch 过滤）。
 *
 * 这些帧服务于"即使不在看该会话也要知道"的功能：
 * - ask_requested / ask_resolved：未读红点、侧栏待答胶囊、托盘/桌宠、多窗口收卡；
 * - workflow_event：workflowRuns store 全量消费（未加载会话也照收）；
 * - compression_error：任意会话的压缩失败全局提示。
 */
const ALWAYS_BROADCAST_STREAM_TYPES: ReadonlySet<string> = new Set([
  "ask_requested",
  "ask_resolved",
  "workflow_event",
  "compression_error",
]);

/**
 * 内部事件监听器
 */
interface InternalEventListener {
  type: SessionEventType;
  callback: (event: SessionEvent) => void;
}

/**
 * 用户级会话事件服务
 *
 * 职责：
 * - 为每个在线用户维护 SSE 事件流
 * - 聚合所有会话相关事件（CRUD + 流式状态变更）
 * - 支持多客户端同时连接（同用户多窗口/多设备）
 */
@Injectable()
export class SessionEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionEventsService.name);
  /** 在线连接表：键 = connectionId（同一 clientId 的多标签页/多窗口各占一条连接） */
  private readonly connections = new Map<string, EventConnection>();
  /** 连接序号：生成 connectionId 用 */
  private connectionSeq = 0;
  /** 终态墓碑（按会话一条；running 事件与新终态都会覆盖/失效） */
  private readonly recentTerminals = new Map<string, RecentTerminal>();

  constructor(
    private readonly streamManager: SessionStreamManager,
    @Inject(SESSION_STORE_TOKEN) private readonly sessionStore: SessionStoreFacade,
    private readonly userInputQueue: UserInputQueueService,
  ) {}

  /**
   * 注册 SSE 直投回调（唯一发布入口的消费者侧）
   *
   * 流式事件的发布统一走 streamManager.publish（缓存+进程内扇出+直投三合一），
   * 本服务经此回调接收并推给该用户全部在线客户端——发布点唯一，无生产者双写。
   */
  onModuleInit() {
    this.streamManager.setStreamRelay((sessionId, chunk) =>
      this.pushStreamEvent(sessionId, chunk),
    );
  }

  /** 生成连接标识（gateway 在握手成功后调用） */
  createConnectionId(): string {
    return `conn_${++this.connectionSeq}_${Date.now()}`;
  }

  /**
   * 注册一条已认证的 WebSocket 连接。
   *
   * 注册后立即下发全局队列计数快照；会话内容等客户端发送 watch 后再补发
   * （`watchSessions`），避免把未关注会话的 buffer 推给新连接。
   */
  registerConnection(
    clientId: string,
    connectionId: string,
    send: (data: string) => void,
  ): EventConnection {
    const connection: EventConnection = {
      clientId,
      connectionId,
      send,
      watchedSessions: new Set(),
      openChain: Promise.resolve(),
      connectedAt: new Date(),
    };
    this.connections.set(connectionId, connection);

    // 用户队列计数快照：侧边栏角标在首次连接/刷新后即可恢复；
    // 具体条目按会话打开时 GET /sessions/:id/queue 拉取。
    this.deliver(
      connection,
      this.wrapEvent({
        type: "queues_snapshot",
        sessionId: "*",
        timestamp: new Date().toISOString(),
        payload: {
          epoch: this.userInputQueue.epoch,
          counts: this.userInputQueue.getAllCounts(),
        },
      } as SessionEvent),
    );

    this.logger.debug(
      `Client ${clientId} (${connectionId}) connected, total connections: ${this.connections.size}`,
    );
    return connection;
  }

  /**
   * 订阅一组会话：加入 watchedSessions 并立即补发这批会话的连接补发帧
   * （connected.streamPositions → eventBuffer 重放 → running 状态 → 终态墓碑）。
   *
   * 这是 per-session 过滤的入口：内容帧只下发给 watchedSessions；
   * 跨会话信号（ask/workflow_event/compression_error）仍全局广播。
   */
  watchSessions(connection: EventConnection, sessionIds: string[]): void {
    if (!this.connections.has(connection.connectionId)) return;
    const added: string[] = [];
    for (const sid of sessionIds) {
      if (!sid || connection.watchedSessions.has(sid)) continue;
      connection.watchedSessions.add(sid);
      added.push(sid);
    }
    if (added.length === 0) return;
    try {
      for (const data of this.buildCatchupEvents(added)) {
        this.deliver(connection, data);
      }
    } catch {
      // 连接已断开：补发失败不应影响其它连接
      this.unsubscribe(connection);
    }
  }

  /** 取消订阅一组会话：之后这些会话的内容帧不再发给该连接 */
  unwatchSessions(connection: EventConnection, sessionIds: string[]): void {
    for (const sid of sessionIds) {
      connection.watchedSessions.delete(sid);
    }
  }

  /**
   * 连接补发事件（序列化后的字符串，供 watchSessions 直接下发）：
   * connected 位置、活跃流 eventBuffer 重放、running 状态补发、终态墓碑。
   *
   * @param sessionIds 本次新订阅的会话（只补发这些会话）
   */
  private buildCatchupEvents(sessionIds: string[]): string[] {
    const events: string[] = [];
    const wanted = new Set(sessionIds);
    const activeStreams = this.streamManager
      .getActiveStreams()
      .filter((stream) => wanted.has(stream.sessionId));

    // 补发起点位置：客户端拿自己的去重游标与之比较，判断补发是否覆盖缺口。
    // 该帧先于所有重放帧到达，客户端能在处理重放前先立标记。
    const streamPositions = activeStreams
      .map((stream) => {
        const first = stream.eventBuffer[0];
        if (
          !first ||
          typeof first.baseSeq !== "number" ||
          typeof first.chunkSeq !== "number"
        ) {
          return null;
        }
        return {
          sessionId: stream.sessionId,
          baseSeq: first.baseSeq,
          chunkSeq: first.chunkSeq,
        };
      })
      .filter(
        (p): p is { sessionId: string; baseSeq: number; chunkSeq: number } =>
          p !== null,
      );

    events.push(
      this.wrapEvent({
        type: "connected",
        timestamp: new Date().toISOString(),
        payload: { streamPositions },
      } as unknown as SessionEvent),
    );

    // 活跃流 eventBuffer 重放（cleanupIntermediateEvents 已把已完成 delta 换成 block_end）
    for (const stream of activeStreams) {
      for (const chunk of stream.eventBuffer) {
        const unified = createUnifiedEvent(
          this.mapStreamMethod(chunk.type),
          { sessionId: stream.sessionId, ...chunk } as Record<string, any>,
        );
        events.push(this.wrapEvent(unified));
      }
    }

    // running 状态补发：刷新后恢复会话级 isStreaming/streamStatus
    for (const stream of activeStreams) {
      const sessionType = stream.sessionType ?? "web";
      events.push(
        this.wrapEvent(
          toSessionEvent("stream_status_changed", {
            sessionId: stream.sessionId,
            timestamp: new Date().toISOString(),
            payload: {
              status: "running",
              kind: stream.kind,
              sessionType,
              lastActiveAt: stream.lastActiveAt,
            },
          }),
        ),
      );
    }

    // 终态墓碑：对"最近结束且当前没有活跃流"的会话补发终态快照
    const now = Date.now();
    for (const [sessionId, terminal] of this.recentTerminals) {
      if (!wanted.has(sessionId)) continue;
      if (now - terminal.endedAt > RECENT_TERMINAL_TTL_MS) {
        this.recentTerminals.delete(sessionId);
        continue;
      }
      if (this.streamManager.hasActiveStream(sessionId)) continue;
      events.push(
        this.wrapEvent({
          ...terminal.event,
          payload: { ...terminal.event.payload, replayed: true },
        } as SessionEvent),
      );
    }

    return events;
  }

  /**
   * 是否有前端 SSE 连接在线（= 用户界面开着，能看见审批卡）。
   *
   * 命令策略层用它做 fail-closed 判定：审批卡经本服务的直投通道到达界面，
   * `SessionStreamManager.subscribers` 只统计**进程内**消费者，看不见前端连接，
   * 因此不能用它判断"有没有人能应答审批"。
   */
  hasConnectedClients(): boolean {
    return this.connections.size > 0;
  }

  /**
   * 注销一条连接（WebSocket close 时调用）。
   *
   * 键即身份：同 clientId 的新连接是独立条目，旧连接 close 只删自己那条。
   */
  unsubscribe(connection: EventConnection): void {
    if (this.connections.get(connection.connectionId) !== connection) return;
    this.connections.delete(connection.connectionId);
    connection.pendingSnapshot = undefined;
    this.logger.debug(
      `Client ${connection.clientId} (${connection.connectionId}) disconnected, remaining: ${this.connections.size}`,
    );
  }

  /**
   * 监听内部 stream.status_changed 事件，转发给 SSE 客户端
   *
   * 统一会话流生命周期状态（running/completed/user_cancel/error），取代旧 stream.started/stream.finished。
   */
  @OnEvent("stream.status_changed")
  handleStreamStatusChanged(event: StreamStatusChangedEvent) {
    const status = event.payload?.status;

    // 新回合开始：旧终态墓碑作废（重连补发不得用旧终态覆盖运行中的新回合）
    if (status === "running") {
      this.recentTerminals.delete(event.sessionId);
      this.broadcastToAllClients(
        toSessionEvent("stream_status_changed", event),
      );
      return;
    }

    // 终态：生成稳定 id（跨"实时帧 + 重放"去重）+ 最后入库 seq 下界，写墓碑后再广播。
    // 广播早退（无在线连接）不影响墓碑：墓碑正是在"没人连着"时才有价值。
    const terminalId = `${APP_BOOT_ID}:${event.sessionId}:${event.timestamp}:${status}`;
    const enriched: StreamStatusChangedEvent = {
      ...event,
      payload: {
        ...event.payload,
        terminalId,
        lastSeq: this.streamManager.getLastPersistedSeq(event.sessionId),
        kind: event.payload?.kind ?? "chat",
      },
    };
    const sessionEvent = toSessionEvent("stream_status_changed", enriched);

    // 先删后 set：刷新插入序，超上限淘汰时保留最近结束的
    this.recentTerminals.delete(event.sessionId);
    this.recentTerminals.set(event.sessionId, {
      event: sessionEvent,
      terminalId,
      endedAt: Date.now(),
    });
    this.pruneRecentTerminals();

    this.broadcastToAllClients(sessionEvent);
  }

  /** 惰性过期 + 超上限淘汰最旧（Map 插入序 = 结束时间序） */
  private pruneRecentTerminals(now: number = Date.now()): void {
    for (const [sessionId, terminal] of this.recentTerminals) {
      if (now - terminal.endedAt > RECENT_TERMINAL_TTL_MS) {
        this.recentTerminals.delete(sessionId);
      }
    }
    while (this.recentTerminals.size > MAX_RECENT_TERMINALS) {
      const oldest = this.recentTerminals.keys().next().value as
        | string
        | undefined;
      if (oldest === undefined) break;
      this.recentTerminals.delete(oldest);
    }
  }

  /**
   * 监听内部 session.created 事件，转发给 SSE 客户端
   */
  @OnEvent("session.created")
  handleSessionCreated(event: SessionCreatedEvent) {
    this.broadcastToAllClients(
      toSessionEvent("session_created", event),
    );
  }

  /**
   * 监听内部 session.updated 事件，转发给 SSE 客户端
   */
  @OnEvent("session.updated")
  handleSessionUpdated(event: SessionUpdatedEvent) {
    this.broadcastToAllClients(
      toSessionEvent("session_updated", event),
    );
  }

  /**
   * 监听内部 session.deleted 事件，转发给 SSE 客户端
   */
  @OnEvent("session.deleted")
  handleSessionDeleted(event: SessionDeletedEvent) {
    // 已删除会话的终态墓碑不再补发（否则重连会给不存在的会话发终态帧）
    this.recentTerminals.delete(event.sessionId);
    this.broadcastToAllClients(
      toSessionEvent("session_deleted", event),
    );
  }

  /**
   * 监听内部 session.cleared 事件，转发给 SSE 客户端
   *
   * 清空聊天记录 = 日志换代（seq 复用）：其他窗口必须清空本地树/水位/邮箱并整页重拉。
   * 终态墓碑记录的是旧日志尾，同一并作废。
   */
  @OnEvent("session.cleared")
  handleSessionCleared(event: SessionClearedEvent) {
    this.recentTerminals.delete(event.sessionId);
    this.broadcastToAllClients(
      toSessionEvent("session_cleared", event),
    );
  }

  /**
   * 监听内部 subagent.created 事件，转发给 SSE 客户端
   */
  @OnEvent("subagent.created")
  handleSubAgentCreated(event: SubAgentCreatedEvent) {
    this.broadcastToAllClients(
      toSessionEvent("sub_agent_create", event),
    );
  }

  /**
   * 监听内部 subagent.run_ended 事件，转发给 SSE 客户端
   */
  @OnEvent("subagent.run_ended")
  handleSubAgentRunEnded(event: SubAgentRunEndedEvent) {
    this.broadcastToAllClients(
      toSessionEvent("sub_agent_ended", event),
    );
  }

  /**
   * 监听内部 todo.updated 事件，转发给 SSE 客户端
   */
  @OnEvent(HOOKS.TODO_UPDATED)
  handleTodoUpdated(event: TodoUpdatedEvent) {
    this.broadcastToAllClients(
      toSessionEvent("todo_updated", event),
    );
  }

  /**
   * 会话目标更新 → SSE。非流事件、不进 catchup buffer；前端重连靠
   * `onConnected` 的 GET /sessions/:id/goal 补拉（与 todo 同款语义）。
   */
  @OnEvent(HOOKS.GOAL_UPDATED)
  handleGoalUpdated(event: GoalUpdatedEvent) {
    this.broadcastToAllClients(
      toSessionEvent("goal_updated", event),
    );
  }

  /** 后台作业全量快照（含 shell/remote/subagent/workflow/scheduler）。 */
  @OnEvent("jobs.changed")
  handleJobsChanged(event: JobsSnapshotEvent) {
    this.broadcastToAllClients({
      type: "jobs_snapshot",
      sessionId: event.sessionId,
      timestamp: event.timestamp,
      payload: {
        // bootId = 后端进程启动标识：前端看到它变化就重置 revision 语义（重启后 revision 归零）
        bootId: event.bootId,
        revision: event.revision,
        jobs: event.jobs,
      },
    });
  }

  /**
   * 用户输入队列快照变化：广播给所有在线客户端（多窗口共享同一份服务端队列）
   */
  @OnEvent("chat.user_queue_changed")
  handleUserQueueChanged(event: UserQueueChangedEvent) {
    this.broadcastToAllClients(
      toSessionEvent("queue_updated", event),
    );
  }

  /**
   * 监听内部 plugins.changed 事件（插件注册/卸载/启停），广播给所有在线用户
   */
  @OnEvent("plugins.changed")
  handlePluginsChanged(event: { pluginId: string; action: string }) {
    const sessionEvent: SessionEvent = {
      type: "plugins_changed",
      sessionId: "*",
      timestamp: new Date().toISOString(),
      payload: event,
    };
    this.broadcastToAllClients(sessionEvent);
  }

  /**
   * 机器人运行状态变化（连接/重连/停止/重连耗尽禁用）
   *
   * 会话列表里的 online 与 lastError 由此即时刷新；sessionId 用 "*" 表示宿主级事件
   * （与 plugins_changed 同一惯例），前端按 payload.botId 定位实例。
   */
  @OnEvent("bot.status_changed")
  handleBotStatusChanged(event: BotStatusChangedEvent) {
    this.broadcastToAllClients({
      type: "bot_status_changed",
      sessionId: "*",
      timestamp: event.timestamp,
      payload: event,
    });
  }

  /**
   * 机器人配置变化（增删改/排序），用于多窗口同步侧栏
   */
  @OnEvent("bot.changed")
  handleBotChanged(event: BotChangedEvent) {
    this.broadcastToAllClients({
      type: "bot_changed",
      sessionId: "*",
      timestamp: event.timestamp,
      payload: event,
    });
  }

  /**
   * 定时任务执行终态：前端据此弹桌面通知。
   *
   * sessionId 为空（执行前就失败）时用 "*" 作为宿主级事件，与 plugins_changed 同一惯例。
   */
  @OnEvent("scheduler.task_finished")
  handleSchedulerTaskFinished(event: SchedulerTaskFinishedEvent) {
    this.broadcastToAllClients({
      type: "scheduler_task_finished",
      sessionId: event.sessionId || "*",
      timestamp: event.timestamp,
      payload: event,
    });
  }

  /**
   * 向所有在线连接广播会话/宿主事件（不受 watch 过滤影响）。
   */
  private broadcastToAllClients(event: SessionEvent): void {
    if (this.connections.size === 0) return;
    const message = this.wrapEvent(event);
    for (const connection of this.connections.values()) {
      try {
        this.deliver(connection, message);
      } catch {
        this.logger.warn(
          `Failed to send event to ${connection.clientId}, removing`,
        );
        this.unsubscribe(connection);
      }
    }
  }

  /** 包成 WS `event` 信封（流帧/会话事件/workspace 事件共用） */
  private wrapEvent(event: unknown): string {
    return JSON.stringify({ kind: "event", data: event });
  }

  /**
   * 唯一投递函数：有 pendingSnapshot 时入队，否则直接写 WebSocket。
   *
   * 快照读页期间入队的帧在 commitSnapshot 里按原序排空；`logSeq` 供排空时
   * 丢弃"事件页已覆盖"的持久化帧（delta 不带 seq，保留）。
   */
  private deliver(
    connection: EventConnection,
    message: string,
    logSeq?: number,
  ): void {
    const pending = connection.pendingSnapshot;
    if (!pending) {
      connection.send(message);
      return;
    }
    pending.queue.push({ data: message, logSeq });
    if (pending.queue.length > MAX_PENDING_SNAPSHOT_QUEUE) {
      pending.queue.shift();
      this.logger.warn(
        `[snapshot] queue overflow for ${connection.clientId}, dropping oldest frame`,
      );
    }
  }

  /**
   * 带内历史快照：读页期间把该连接的帧积压，读完后先发 snapshot、再排空队列。
   *
   * 同一连接上的多个 open 请求**串行执行**（openChain）：多 pane 同时首次打开时
   * 不再互相抢占，第二个请求等第一个提交后再开始读页。
   */
  async openSnapshot(
    connection: EventConnection,
    sessionId: string,
    requestId: string,
    readPage: () => Promise<{
      events: unknown[];
      endSeq: number;
      nextBeforeSeq: number | null;
      hasMore: boolean;
    }>,
  ): Promise<{ ok: boolean; reason?: "disconnected" }> {
    const run = async (): Promise<{ ok: boolean; reason?: "disconnected" }> => {
      if (this.connections.get(connection.connectionId) !== connection) {
        return { ok: false, reason: "disconnected" };
      }
      // 打开即订阅：后续 live 帧能到达该连接（不等客户端额外发 watch）
      if (!connection.watchedSessions.has(sessionId)) {
        this.watchSessions(connection, [sessionId]);
      }
      connection.pendingSnapshot = { requestId, sessionId, queue: [] };
      // T0：在 await 之前同步截取，publish 不可能插进这两行之间
      const tail = this.streamManager.getInFlightTail(sessionId);

      try {
        const page = await readPage();
        if (this.connections.get(connection.connectionId) !== connection) {
          return { ok: false, reason: "disconnected" };
        }
        this.commitSnapshot(connection, requestId, {
          requestId,
          sessionId,
          events: page.events,
          endSeq: page.endSeq,
          nextBeforeSeq: page.nextBeforeSeq,
          hasMore: page.hasMore,
          tail,
          bootId: APP_BOOT_ID,
        });
        return { ok: true };
      } catch (error) {
        if (this.connections.get(connection.connectionId) !== connection) {
          return { ok: false, reason: "disconnected" };
        }
        this.logger.warn(
          `[snapshot] read page failed for ${sessionId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        // 仍要提交（带 error）：客户端据此报错并重试，队列不能永久卡住
        this.commitSnapshot(connection, requestId, {
          requestId,
          sessionId,
          events: [],
          endSeq: -1,
          nextBeforeSeq: null,
          hasMore: false,
          tail: [],
          bootId: APP_BOOT_ID,
          error: error instanceof Error ? error.message : String(error),
        });
        return { ok: true };
      }
    };
    const result = connection.openChain.then(run, run);
    connection.openChain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** 先写 snapshot 帧，再按原序排空队列（已落在页内的持久化帧丢弃） */
  private commitSnapshot(
    connection: EventConnection,
    requestId: string,
    payload: {
      requestId: string;
      sessionId: string;
      events: unknown[];
      endSeq: number;
      nextBeforeSeq: number | null;
      hasMore: boolean;
      tail: unknown[];
      bootId: string;
      error?: string;
    },
  ): void {
    const pending = connection.pendingSnapshot;
    if (!pending || pending.requestId !== requestId) return;
    // 先清屏障再写帧：commit 是同步块，期间不会有 publish 插进来，
    // 后续帧直接写 socket，不会排到 snapshot 之前。
    connection.pendingSnapshot = undefined;

    try {
      connection.send(
        JSON.stringify({ kind: "snapshot", requestId, payload }),
      );
    } catch {
      this.unsubscribe(connection);
      return;
    }

    for (const item of pending.queue) {
      if (typeof item.logSeq === "number" && item.logSeq < payload.endSeq) {
        continue;
      }
      try {
        connection.send(item.data);
      } catch {
        this.unsubscribe(connection);
        return;
      }
    }
  }

  /**
   * 流帧直投（唯一发布入口的消费者侧，由 streamManager relay 调用）。
   *
   * per-session 过滤：内容帧只发给 watchedSessions 含该会话的连接；
   * **跨会话信号**（ask/workflow/压缩失败）始终广播——它们服务于未读红点、
   * 侧栏待答胶囊、workflow 实时进度等"即使不在看该会话也要知道"的功能。
   */
  private pushStreamEvent(sessionId: string, chunk: SessionStreamEvent): void {
    if (this.connections.size === 0) return;

    const unified = createUnifiedEvent(
      this.mapStreamMethod(chunk.type),
      { sessionId, ...chunk } as Record<string, any>,
    );
    const message = this.wrapEvent(unified);
    const logSeq = (chunk as { logSeq?: number }).logSeq;
    const alwaysBroadcast = ALWAYS_BROADCAST_STREAM_TYPES.has(chunk.type);

    for (const connection of this.connections.values()) {
      if (!alwaysBroadcast && !connection.watchedSessions.has(sessionId)) {
        continue;
      }
      try {
        this.deliver(connection, message, logSeq);
      } catch {
        this.logger.warn(
          `Failed to send stream event to ${connection.clientId}, removing`,
        );
        this.unsubscribe(connection);
      }
    }
  }

  /** 将 SessionStreamEvent.type 映射为统一 method(stream/*，消息级与 chunk.type 一致) */
  private mapStreamMethod(type: SessionStreamEvent["type"]): EventMethod {
    switch (type) {
      case "turn_start": return EVENT_METHOD.STREAM_TURN_START;
      case "turn_end": return EVENT_METHOD.STREAM_TURN_END;
      case "context_stats": return EVENT_METHOD.STREAM_CONTEXT_STATS;
      case "turn_delete": return EVENT_METHOD.STREAM_TURN_DELETE;
      case "user_message": return EVENT_METHOD.STREAM_USER_MESSAGE;
      case "retry": return EVENT_METHOD.STREAM_RETRY;
      case "tool_calls_response": return EVENT_METHOD.STREAM_TOOL_CALLS_RESPONSE;
      // 引擎级附属（压缩）
      case "compression_start": return EVENT_METHOD.STREAM_COMPRESSION_START;
      case "compression_error": return EVENT_METHOD.STREAM_COMPRESSION_ERROR;
      case "compression_end": return EVENT_METHOD.STREAM_COMPRESSION_END;
      case "compaction_summary": return EVENT_METHOD.STREAM_COMPACTION_SUMMARY;
      case "context_window_changed": return EVENT_METHOD.STREAM_CONTEXT_WINDOW_CHANGED;
      // 统一交互（审批/询问共用）
      case "ask_requested": return EVENT_METHOD.STREAM_ASK_REQUESTED;
      case "ask_resolved": return EVENT_METHOD.STREAM_ASK_RESOLVED;
      // Workflow 编排进度
      case "workflow_event": return EVENT_METHOD.STREAM_WORKFLOW_EVENT;
      // 子代理创建（工具调用 ↔ 子会话关联键，供工具行打开面板）
      case "subagent_link": return EVENT_METHOD.STREAM_SUBAGENT_LINK;
      // 子代理完成/失败（settle 即时下发，不等整批工具结果）
      case "subagent_status": return EVENT_METHOD.STREAM_SUBAGENT_STATUS;
      // 计划模式变更（协作状态；事实源 session.settings，本帧驱动指示器与多窗口同步）
      case "plan_mode_changed": return EVENT_METHOD.STREAM_PLAN_MODE_CHANGED;
      // 工具截图裁剪完成（维护操作事件卡）
      case "tool_image_prune": return EVENT_METHOD.STREAM_TOOL_IMAGE_PRUNE;
      // 消息级:StreamChunk 直通
      case "block_start": return EVENT_METHOD.STREAM_BLOCK_START;
      case "text_delta": return EVENT_METHOD.STREAM_TEXT_DELTA;
      case "reasoning_delta": return EVENT_METHOD.STREAM_REASONING_DELTA;
      case "tool_call_delta": return EVENT_METHOD.STREAM_TOOL_CALL_DELTA;
      case "block_end": return EVENT_METHOD.STREAM_BLOCK_END;
      case "usage": return EVENT_METHOD.STREAM_USAGE;
      case "finish": return EVENT_METHOD.STREAM_FINISH;
      default: {
        const exhaustive: never = type;
        this.logger.warn(`Unknown stream event type: ${exhaustive}`);
        return EVENT_METHOD.STREAM_FINISH;
      }
    }
  }

  /** 在线客户端数量 */
  getClientCount(): number {
    return this.connections.size;
  }

  onModuleDestroy() {
    this.connections.clear();
    this.recentTerminals.clear();
  }
}
