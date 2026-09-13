import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";
import { AgentEngine } from "./agent-engine.service";
import { SessionStreamManager } from "./session-stream.manager";
import { SessionService } from "./session.service";
import { SessionContextFactory } from "./session-context.factory";
import { WireStreamEvent } from "./types/event-chunk.types";
import {
  StreamStatusChangedEvent,
} from "../../common/events/stream.events";
import { ISessionContext } from "./session-context";
import type { ContentBlock } from "../../common/types/conversation.types";
import { RemoteBindingStateService } from "../remote-workspace/remote-binding-state.service";
import { EventBusService } from "../../common/events/event-bus.service";

/**
 * 流订阅回调
 */
export interface StreamCallbacks {
  onEvent: (data: WireStreamEvent) => void;
  onComplete: (reason: string) => void;
  onError: (err: any) => void;
}

/**
 * 队列消息来源（P4a：与 Message.source.kind 同一词汇；kind 为合并分组键）
 *
 * 约定：投递方必须用 kind 而非 type 标记来源，与三层消息的 MessageSource 对齐；
 * 附加业务字段经索引签名保留。
 */
export type QueueSource =
  | { kind: "sub_agent"; subSessionId?: string; agentName?: string; [key: string]: any }
  | { kind: "scheduler"; schedulerId?: string; dryRun?: boolean; [key: string]: any }
  | { kind: "process_monitor"; processId?: string; event?: string; [key: string]: any };

/**
 * QueueSource → MessageSource（P4b：队列来源真正进入三层消息的 source）
 *
 * 仅映射有明确语义的非用户来源；未识别 kind（含缺省）→ undefined，
 * 折叠时走默认 kind='user'（即真实用户输入）。
 */
export function toMessageSource(
  source: Record<string, any> | undefined,
): import("../../common/types/conversation.types").MessageSource | undefined {
  const kind = source?.kind as string | undefined;
  switch (kind) {
    case "sub_agent":
      return {
        kind: "sub_agent",
        subSessionId: source.subSessionId,
        agentName: source.agentName ?? source.subAgentName,
      };
    case "scheduler":
      return { kind: "scheduler", schedulerId: source.schedulerId };
    case "process_monitor":
      return { kind: "process_monitor", processId: source.processId };
    default:
      return undefined;
  }
}

/**
 * 队列消息项
 */
export interface QueueItem {
  id: string;
  sessionId: string;
  /** 原生内容块（S2：结构化入站消息统一载体；文本即 text 块） */
  blocks: ContentBlock[];
  source: QueueSource;
  createdAt: Date;
  callbacks?: StreamCallbacks;
  /** 有效性检查：返回 false 时 processQueue 丢弃此消息 */
  isValid?: () => boolean;
  /** 消息被消费后回调（startStream 成功后调用） */
  onConsumed?: () => void;
}

/**
 * 会话队列状态
 */
interface SessionQueueState {
  items: QueueItem[];
  isProcessing: boolean;
}

/**
 * Chat 运行器服务
 *
 * 封装完整的对话执行业务逻辑，供 HTTP 请求和定时任务复用。
 * 集成消息队列能力，支持异步任务完成后自动注入消息并唤醒 Agent 循环。
 */
@Injectable()
export class ChatRunnerService {
  private readonly logger = new Logger(ChatRunnerService.name);
  private readonly queues = new Map<string, SessionQueueState>();

  constructor(
    private streamManager: SessionStreamManager,
    private sessionService: SessionService,
    private agentEngine: AgentEngine,
    private sessionContextFactory: SessionContextFactory,
    private eventBus: EventBusService,
    private bindingState: RemoteBindingStateService,
  ) {}

  /**
   * 启动会话的流式对话（完整业务逻辑）
   *
   * 处理以下全部流程：
   * 1. 获取会话
   * 2. overwrite 模式下创建用户消息
   * 3. 检查活跃流状态
   * 4. 情况1：已有活跃流 → 加入订阅
   * 5. 情况2：无活跃流 → 启动新流 + 运行 AgentEngine
   *
   * Controller 只需提供回调函数处理 HTTP 响应，无需关心内部实现。
   *
   * @param params 启动参数
   * @param callbacks 流事件回调（Controller 提供 HTTP 响应处理）
   * @returns 订阅清理函数
   * @throws HttpException 各种业务错误（会话不存在、活跃流冲突、缺少内容等）
   *
   * @warning 该方法只为发起流/订阅流，本身不会阻塞到流结束
   */
  async startStream(
    params: {
      sessionId: string;
      userMessage?: {
        id?: string;
        content?: string;
        /** 原生内容块（S2：结构化入站消息，存在时优先于 content 构造） */
        blocks?: ContentBlock[];
        /** 命令标记解析产物注入块（TagParserPipeline 产出，origin='system'，随消息落库） */
        injectedBlocks?: ContentBlock[];
        /** 三层消息来源（P4b：队列投递显式写入；缺省按 kind 推导） */
        source?: import("../../common/types/conversation.types").MessageSource;
        files?: import("../../common/types/conversation.types").FileRef[];
        replaceTurnId?: string;
        knowledgeBaseIds?: string[];
        metadata?: Record<string, any>;
      };
      regenerationMode?: string;
      resumeData?: any;
      source?: Record<string, any>;
      /** 预解析的会话对象（跳过 DB 重查，保留内存挂载的 model/character） */
      preloadedSession?: any;
    },
    callbacks?: StreamCallbacks,
  ): Promise<() => void> {
    const {
      sessionId,
      userMessage,
      regenerationMode = "overwrite",
      resumeData,
      source,
      preloadedSession,
    } = params;

    // 提取前端传入的 clientId，用于广播事件的 source 字段
    const clientId = source?.clientId as string | undefined;
    if (userMessage) {
      userMessage.metadata = { ...userMessage?.metadata, ...source };
      // 命令标记解析产物注入块：显式传递通道（不藏在 metadata），由 agent-engine 透传给 addUserMessage 落库
      if (source?.injectedBlocks?.length) {
        userMessage.injectedBlocks = source.injectedBlocks;
      }
    }
    // 获取会话：优先使用预加载的会话（如 Bot 场景已 enrich），否则从 DB 查询
    const session =
      preloadedSession ??
      (await this.sessionService.getSessionById(sessionId));
    if (!session) {
      throw new HttpException(
        { error: "会话不存在", code: "SESSION_NOT_FOUND" },
        HttpStatus.NOT_FOUND,
      );
    }

    // 远程连接绑定变更检测：变更以 origin='system' 注入块跟随本条用户消息
    //（不改系统提示词——提示词中的连接清单按冻结快照渲染，保护 LLM 前缀缓存）。
    // 覆盖 HTTP 与 bot/队列路径（均经 startStream）；失败不阻塞回合。
    if (userMessage) {
      try {
        const liveIds: string[] =
          session?.settings?.attachments?.["ssh-connection"] || [];
        const bindingBlocks = await this.bindingState.detectAndBuildInjection(
          sessionId,
          liveIds,
        );
        if (bindingBlocks.length > 0) {
          userMessage.injectedBlocks = [
            ...(userMessage.injectedBlocks || []),
            ...bindingBlocks,
          ];
        }
      } catch (err: any) {
        this.logger.warn(
          `Remote binding state detection failed (session ${sessionId}): ${err?.message || err}`,
        );
      }
    }

    // 更新会话最后活跃时间，用于会话管理和清理策略
    await this.sessionService.updateLastActiveAt(sessionId);

    const hasActiveStream = this.streamManager.hasActiveStream(sessionId);

    // 已有活跃流则拒绝（subscribe 模式已由前端常驻接收链路取代，不再有加入订阅的路径）
    if (hasActiveStream) {
      throw new HttpException(
        { error: "当前已有任务正在进行，请等待结束", code: "SESSION_BUSY" },
        HttpStatus.CONFLICT,
      );
    }

    const subscriberId = `${sessionId}_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    // 启动新流
    const abortController = new AbortController();

    const started = this.streamManager.startStream(sessionId, abortController);
    if (!started) {
      throw new HttpException(
        { error: "Session is busy", code: "STREAM_START_FAILED" },
        HttpStatus.CONFLICT,
      );
    }

    // 注册订阅者（如果提供了回调）
    let unsubscribe: (() => void) | null = null;
    if (callbacks) {
      unsubscribe = this.streamManager.subscribe(
        sessionId,
        subscriberId,
        callbacks.onEvent,
        callbacks.onComplete,
        callbacks.onError,
      );
      if (!unsubscribe) {
        throw new HttpException(
          { error: "Stream not available", code: "SUBSCRIBE_FAILED" },
          HttpStatus.CONFLICT,
        );
      }
    }

    // 回合开括号 turn_start 由 agent-engine 在 executeAgentLoop 内广播(与 turn_end 成对,同一文件)。
    // 不再单独构造 stream_started(携带 session 对象) — 规范化:回合开始语义统一为 stream/turn_start。
    const sessionContext =
      await this.sessionContextFactory.createFromSession(session);

    // 在后台启动 Agent 循环
    this.runAgentEngine(
      sessionContext,
      userMessage,
      abortController,
      regenerationMode,
      resumeData,
      clientId,
    ).catch((error) => {
      this.logger.error(`Agent engine error stack:`, error?.stack);
      this.streamManager.publish(sessionId, {
        type: "error",
        error: error.message,
      } as any);
      this.streamManager.stopStream(sessionId, "error");
    });

    return unsubscribe || (() => {});
  }

  /**
   * 投递消息到队列
   *
   * 供定时任务、子Agent等异步任务调用。
   * 根据会话Agent状态决定立即执行或排队等待。
   */
  async enqueueMessage(params: {
    sessionId: string;
    /** 原生内容块（S2：结构化入站消息统一载体；文本即 [{type:'text',text}]） */
    blocks: ContentBlock[];
    /** 队列消息来源（P4a：kind 风格，与 Message.source.kind 同一词汇） */
    source: QueueSource;
    callbacks?: StreamCallbacks;
    isValid?: () => boolean;
    onConsumed?: () => void;
  }): Promise<void> {
    const { sessionId, blocks, source, callbacks, isValid, onConsumed } = params;

    const queueItem: QueueItem = {
      id: `${sessionId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      sessionId,
      blocks,
      source,
      createdAt: new Date(),
      callbacks,
      isValid,
      onConsumed,
    };

    const queueState = this.getOrCreateQueueState(sessionId);

    // 使用 hasActiveStream 判断 Agent 是否正在运行，与 startStream 的冲突检测逻辑保持一致
    const hasActiveStream = this.streamManager.hasActiveStream(sessionId);

    queueState.items.push(queueItem);

    if (hasActiveStream) {
      this.logger.log(
        `消息已入队(Agent运行中): ${sessionId}, 队列长度: ${queueState.items.length}`,
      );
      return;
    }

    // 不阻塞调用方，后台消费队列并自行处理错误
    this.processQueue(sessionId).catch((error) => {
      this.logger.error(
        `队列消费异常: ${sessionId}, 错误: ${error?.message || error}`,
      );
    });
  }

  /**
   * 消费会话队列
   *
   * Agent循环结束后调用，按来源合并处理消息。
   * 只取出队首连续同来源的消息合并为一条执行，
   * 剩余消息留给 startStream 的 finally 再次触发消费。
   */
  async processQueue(sessionId: string): Promise<void> {
    const state = this.queues.get(sessionId);
    if (!state || state.isProcessing || state.items.length === 0) {
      return;
    }

    state.isProcessing = true;

    try {
      if (this.streamManager.hasActiveStream(sessionId)) {
        this.logger.warn(`会话 ${sessionId} 在队列处理期间被占用，暂停消费`);
        return;
      }

      // 过滤掉已失效的消息（被 poll/drain 等其他路径消费过）
      state.items = state.items.filter((item) => {
        if (item.isValid && !item.isValid()) {
          this.logger.debug(`丢弃已失效的队列消息: ${item.id}`);
          return false;
        }
        return true;
      });

      if (state.items.length === 0) return;

      // 提取队首连续同来源的消息进行合并（P4a：按 source.kind 分组）
      const firstSourceKind = state.items[0].source.kind;
      const batch: QueueItem[] = [];
      while (
        state.items.length > 0 &&
        state.items[0].source.kind === firstSourceKind
      ) {
        batch.push(state.items.shift()!);
      }

      await this.executeQueueItem(batch);
    } catch (error) {
      this.logger.error(`队列处理出错: ${sessionId}`, error);
    } finally {
      state.isProcessing = false;

      if (state.items.length === 0 && !state.isProcessing) {
        this.queues.delete(sessionId);
      }
    }
  }

  /**
   * 获取队列状态（用于监控）
   */
  getQueueStatus(sessionId: string): {
    pendingCount: number;
    isProcessing: boolean;
  } | null {
    const state = this.queues.get(sessionId);
    if (!state) return null;
    return {
      pendingCount: state.items.length,
      isProcessing: state.isProcessing,
    };
  }

  /**
   * 从会话队列中查找并移除匹配指定条件的消息
   *
   * 适用于 waitForComplete、poll 撤回等场景：已通过其他方式获取了消息内容，
   * 需要从队列中移除以防止 processQueue 再次消费导致重复。
   *
   * @param sessionId 会话 ID
   * @param predicate 匹配条件函数，返回 true 的消息将被移除并返回
   * @returns 被移除的消息数组
   */
  peekQueuedMessage(
    sessionId: string,
    predicate: (item: QueueItem) => boolean,
  ): QueueItem[] {
    const state = this.queues.get(sessionId);
    if (!state || state.items.length === 0) return [];

    const removed: QueueItem[] = [];
    const kept: QueueItem[] = [];
    for (const item of state.items) {
      if (predicate(item)) {
        removed.push(item);
      } else {
        kept.push(item);
      }
    }
    state.items = kept;

    if (removed.length > 0) {
      this.logger.log(`从队列中移除了 ${removed.length} 条消息: ${sessionId}`);
    }

    // 清理空状态
    if (state.items.length === 0 && !state.isProcessing) {
      this.queues.delete(sessionId);
    }

    return removed;
  }

  /**
   * 检查会话是否有活跃流
   */
  hasActiveStream(sessionId: string): boolean {
    return this.streamManager.hasActiveStream(sessionId);
  }

  /**
   * 取消指定会话的活跃流（用于子 Agent 在父 Agent 中止时同步停止）
   */
  cancelStream(sessionId: string): void {
    this.streamManager.stopStream(sessionId, "user_cancel");
  }

  /**
   * 执行队列项（支持单条或同来源合并）
   */
  private async executeQueueItem(items: QueueItem[]): Promise<void> {
    const firstItem = items[0];
    const sessionId = firstItem.sessionId;
    const sourceKind = firstItem.source.kind;

    if (items.length === 1) {
      this.logger.log(
        `执行队列消息: ${firstItem.id}, 来源: ${sourceKind}, 会话: ${sessionId}`,
      );
    } else {
      this.logger.log(
        `执行队列消息(合并${items.length}条): 来源: ${sourceKind}, 会话: ${sessionId}`,
      );
    }

    // 合并内容块：扁平拼接 + 相邻 text 块合并（保持原"多条消息换行分隔"语义）
    const mergedBlocks = mergeAdjacentTextBlocks(
      items.flatMap((item) => item.blocks),
    );

    // 合并 source：其他字段保留第一条（P5：systemPayload 已移除，业务数据统一在 blocks）
    // 队列消息由后端构造、不含命令标记，无注入块；parseResult 通道已废除
    const mergedSource = {
      ...firstItem.source,
      queueItemCount: items.length,
      queueItemIds: items.map((item) => item.id),
      queuedAt: firstItem.createdAt.toISOString(),
    };
    // P4b：队列来源 → 三层消息 source（sub_agent/scheduler/process_monitor 显式写入）
    const messageSource = toMessageSource(mergedSource);

    // 取第一个带回调的项作为执行回调（合并场景下只取一个，避免重复触发）
    const callbacks = items.find((item) => item.callbacks)?.callbacks;

    try {
      await this.startStream(
        {
          sessionId,
          userMessage: {
            blocks: mergedBlocks,
            ...(messageSource ? { source: messageSource } : {}),
          },
          regenerationMode: "overwrite",
          source: mergedSource,
        },
        callbacks,
      );
      // 派发成功 → 通知调用方资源可释放
      for (const item of items) {
        item.onConsumed?.();
      }
    } catch (error: any) {
      const code = error?.response?.code || error?.code;

      if (code === "SESSION_BUSY" || code === "STREAM_START_FAILED") {
        this.logger.warn(`启动失败(会话忙碌)，${items.length}条消息重新入队`);
        const state = this.queues.get(sessionId);
        if (state) {
          // 按原顺序塞回队列头部
          state.items.unshift(...items);
        }
        throw error;
      }

      this.logger.error(`执行队列消息失败: ${firstItem.id}`, error);
      // 非忙碌错误也视为已消费，避免消息卡死
      for (const item of items) {
        item.onConsumed?.();
      }
    }
  }

  /**
   * 获取或创建队列状态
   */
  private getOrCreateQueueState(sessionId: string): SessionQueueState {
    let state = this.queues.get(sessionId);
    if (!state) {
      state = { items: [], isProcessing: false };
      this.queues.set(sessionId, state);
    }
    return state;
  }

  /**
   * 后台运行 Agent Engine
   */

  private async runAgentEngine(
    sessionContext: ISessionContext,
    userMessage: any,
    abortController: AbortController,
    regenerationMode: string = "overwrite",
    resumeData?: any,
    clientId?: string,
  ): Promise<void> {
    const sessionId = sessionContext.sessionId;
    let lastFinishReason: string | undefined;
    try {
      // 流开始:广播会话"工作中"状态(统一状态改变事件,running)
      const startEvent: StreamStatusChangedEvent = {
        sessionId,
        timestamp: new Date().toISOString(),
        source: clientId,
        payload: {
          status: "running",
          workspacePath: sessionContext.workspacePath,
          sessionType: sessionContext.sessionType,
        },
      };
      this.eventBus.emit("stream.status_changed", startEvent);

      // 引擎直发模式：流式事件由引擎经 sessionContext.publishStream 发布（prevSeq 在发布点组装），
      // chat-runner 只 await 完成并做流生命周期收尾（supervisor 职责）
      const { finishReason } = await this.agentEngine.run(
        sessionContext,
        userMessage,
        regenerationMode,
        abortController.signal,
        resumeData,
      );
      lastFinishReason = finishReason;

      // Agent 引擎内部已捕获 abort 并发布 finish/turn_end 事件，这里自然结束
      const reason = abortController.signal.aborted
        ? "user_cancel"
        : "completed";
      this.streamManager.stopStream(sessionId, reason);

      const statusEvent: StreamStatusChangedEvent = {
        sessionId,
        timestamp: new Date().toISOString(),
        source: clientId,
        payload: {
          status: reason,
          reason,
          workspacePath: sessionContext.workspacePath,
          sessionType: sessionContext.sessionType,
        },
      };
      this.eventBus.emit("stream.status_changed", statusEvent);
    } catch (error: any) {
      if (error.name === "AbortError") {
        this.logger.log(`Stream ${sessionId} aborted`);
        this.streamManager.stopStream(sessionId, "user_cancel");

        const statusEvent: StreamStatusChangedEvent = {
          sessionId,
          timestamp: new Date().toISOString(),
          source: clientId,
          payload: {
            status: "user_cancel",
            reason: "user_cancel",
            workspacePath: sessionContext.workspacePath,
            sessionType: sessionContext.sessionType,
          },
        };
        this.eventBus.emit("stream.status_changed", statusEvent);
      } else {
        this.streamManager.stopStream(sessionId, "error");

        const statusEvent: StreamStatusChangedEvent = {
          sessionId,
          timestamp: new Date().toISOString(),
          source: clientId,
          payload: {
            status: "error",
            reason: "error",
            error: error.message,
            workspacePath: sessionContext.workspacePath,
            sessionType: sessionContext.sessionType,
          },
        };
        this.eventBus.emit("stream.status_changed", statusEvent);

        throw error;
      }
    } finally {
      // 队列消息仅在回合正常结束时自动消费。approval / 迭代暂停（max_iterations / rate_limited）
      // 均为回合内原地阻塞（回合不闭合、无暂停态 finish），无需在此处理；用户"停止"后以
      // user_cancel 收尾，同样不自动消费（暂停中的任务由用户操作解除，不重复触发）。
      const NORMAL_FINISH = new Set(["stop", undefined]);
      if (NORMAL_FINISH.has(lastFinishReason)) {
        await this.processQueue(sessionId);
      }
    }
  }
}

/**
 * 合并相邻 text 块（换行分隔），保持"多条队列消息合并为一条连贯文本"的语义。
 * 非 text 块（图片/文件等）原样保留，作为 text 之间的天然分隔。
 */
function mergeAdjacentTextBlocks(blocks: ContentBlock[]): ContentBlock[] {
  const out: ContentBlock[] = [];
  for (const block of blocks) {
    const last = out[out.length - 1];
    if (block.type === "text" && last?.type === "text") {
      last.text = last.text ? `${last.text}\n${block.text}` : block.text;
    } else {
      out.push({ ...block });
    }
  }
  return out;
}
