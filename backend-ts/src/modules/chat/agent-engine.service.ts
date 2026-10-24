import { Injectable, Logger, Optional } from "@nestjs/common";
import * as path from "path";
import * as fs from "fs";
import { ToolExecutor } from "../tools/tool-executor.service";
import type {
  Message,
  ContentBlock,
  FileRef,
} from "../../common/types/conversation.types";
import {
  normalizeMediaType,
  mimeFromExtension,
} from "../../common/utils/media-type.util";
import { normalizeRefType } from "../llm-core/utils/attachment.util";
import { FileNamingService } from "../../common/services/file-naming.service";
import { SessionImageStore } from "../../common/services/session-image.store";
import { getSessionDir } from "../../common/utils/session-path.util";
import {
  getImageTargetBytes,
  getToolImageTargetBytes,
} from "../../common/utils/image-transcode.util";
import type {
  ImageContent,
  ImageRefContent,
} from "../plugins/api/plugin-api";
import { RequestContext } from "../../common/context/request-context";
import { ISessionContext } from "./session-context";
import { SessionStreamEvent } from "./types/event-chunk.types";
import { BlockAssembler } from "./block-assembler";
import {
  isToolCallBlock,
  SYNTHETIC_TOOL_INTERRUPTED_TEXT,
  toolResultCallIdOf,
} from "../../common/utils/tool-pairing.util";
import { SessionLlmRequestBuilder } from "./session-llm-request.builder";
import { EventBusService } from "../../common/events/event-bus.service";
import { TurnReminderRegistry } from "../plugins/turn-reminders/turn-reminder.registry";
import { PluginManager } from "../plugins/plugin.manager";
import {
  HOOKS,
  type RequestErrorAction,
  type TurnStoppingDecision,
  type TurnStoppingPayload,
} from "./types/hooks.contract";
import {
  UpstreamRateLimitError,
  UpstreamTimeoutError,
  UpstreamRequestError,
} from "../llm-core/utils/upstream-errors";
import { LLMService } from "../llm-core/llm.service";
import type {
  LLMCompletionParams,
  StreamChunk,
} from "../llm-core/types/llm.types";
import {
  classifyError,
  computeRetryDelayMs,
  retrySleep,
  buildRetryMessage,
  createAbortError,
  type RetryableErrorType,
} from "../llm-core/utils/retry-on-error.util";

/**
 * data: URL 形态的 FileRef——工具图片物化失败时的 legacy 降级形态（字节在手的兜底）。
 * 正常路径不应产出：持久化契约是快照/事件日志只存路径指针不存 base64。
 */
function inlineDataRef(mediaType: string, base64: string, byteLength: number): FileRef {
  const mime = mediaType || "image/png";
  return {
    mediaType: mime,
    bytes: byteLength,
    url: `data:${mime};base64,${base64}`,
  };
}

/**
 * data: URL 兜底的单图字节上限（512KB）。
 * 这条降级路径会把完整 base64 内嵌进 tool-result.images 并落 JSONL、随每次请求重发，
 * 是唯一能绕过单图转码预算的入口；超限时宁可如实告知模型「图不可用」，也不写进去。
 */
const INLINE_FALLBACK_MAX_BYTES = 512 * 1024;

/** 判定绝对路径是否位于会话数据目录内；是则返回目录内相对路径（POSIX 分隔），否则 null */
function relativeToSessionDir(sessionDir: string, absolutePath: string): string | null {
  const rel = path.relative(sessionDir, path.resolve(absolutePath));
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}

/**
 * Agent 推理引擎
 *
 * 负责协调会话级别的 AI 代理执行流程，包括多轮工具调用循环、流式响应管理。
 * 不管理会话生命周期——配置合并、上下文构建等数据准备工作由 ISessionContext 统一提供。
 *
 * 核心职责：
 * - 管理会话级别的并发锁，防止同一会话的多次请求冲突
 * - 协调 LLM 流式请求、工具执行和消息持久化的完整生命周期
 * - 实现安全的 JSON 解析和工具调用参数累加机制
 * - 支持对话再生模式（overwrite / resume）
 *
 * 设计原则：
 * - 直发模式：流式事件经 sessionContext.publishStream 直发（对齐 DSH session.append 深层直发），
 *   不经生成器 yield 冒泡——主循环与深层模块（钩子订阅者/审批服务）共用同一发布面
 * - 容错降级：完善的错误捕获和分类处理机制，确保异常不会导致会话崩溃
 * - 防御性编程：多重安全检查（JSON 解析容错、空值保护）
 */
@Injectable()
export class AgentEngine {
  private readonly logger = new Logger(AgentEngine.name);

  constructor(
    private toolExecutor: ToolExecutor,
    private llmService: LLMService,
    private eventBus: EventBusService,
    /**
     * 每轮提醒 provider 注册表（插件自行注册；引擎只收集/落库/临时追加）。
     * Optional：大量测试手工 new AgentEngine(...)，无 registry 时行为等价于空集合。
     */
    @Optional()
    private readonly turnReminders?: TurnReminderRegistry,
    /** 插件启用态过滤（运行时开关；缺省时由 provider 自行门控） */
    @Optional()
    private readonly pluginManager?: PluginManager,
  ) {}

  /**
   * 文件命名服务（无 DI 依赖的无状态工具）：与上传路径共用「日期目录 + 清洗 + 去重」
   * 命名策略。字段初始化手工实例化——避免为纯工具依赖改动构造签名（多处测试手工 new 本类）。
   */
  private readonly fileNaming = new FileNamingService();

  /**
   * 会话图片落盘（与 browser-script 截图共用同一实现）。
   * 同样手工实例化：构造签名保持不变，测试里的 `new AgentEngine(...)` 无需改动。
   */
  private readonly sessionImages = new SessionImageStore(this.fileNaming);

  /**
   * 主循环 LLM 流式请求：纯传输 + 重试壳（agent 循环局部语义，对齐 DSH retryPolicy 在 agent 层）。
   *
   * 仅主对话循环使用——影子轮次/压缩摘要是失败容忍的辅助调用，单次请求不重试
   * （重试退避会拖慢压缩，且 DSH 辅助调用同样单次）。
   * 不做任何累积——累积由调用方持有的 BlockAssembler 完成；
   * 收到 retry 信号时调用方应 assembler.reset()（重试不保留半截内容）。
   *
   * @param params 已由 SessionLlmRequestBuilder 组装的请求参数
   * @yields StreamChunk | retry 信号
   */
  private async *streamWithRetry(params: LLMCompletionParams): AsyncGenerator<
    | StreamChunk
    | {
        type: "retry";
        retryReason: RetryableErrorType;
        attempt: number;
        maxRetries: number;
        delayMs: number;
        message: string;
      },
    void,
    unknown
  > {
    const maxRetries = 5;
    let attempt = 0;
    const { abortSignal } = params;

    this.logger.debug(
      `[LLM] ${params.model} temperature=${params.temperature} topP=${params.topP} frequencyPenalty=${params.frequencyPenalty}`,
    );

    while (true) {
      // 本次尝试是否已产出可见内容/finish（重试决策依据）
      let sawContent = false;
      let sawFinish = false;

      try {
        const stream = (await this.llmService.completions({
          ...params,
          stream: true,
          // 同一 messageId 的重试尝试各自落一行，靠 attemptIndex 区分
          usageContext: { ...params.usageContext, attemptIndex: attempt },
        })) as AsyncGenerator<StreamChunk>;

        for await (const chunk of stream) {
          if (chunk.type === "finish") {
            sawFinish = true;
          } else if (chunk.type !== "usage") {
            sawContent = true;
          }
          yield chunk;
        }

        // 流"干净地提前结束"检测：for-await 正常退出但没有 finish chunk。
        // 某些不稳定平台可能输出一半就断开。注意：用户手动 abort 时部分
        // provider/SDK 也会"干净地结束"流，必须先排除 abort 场景。
        if (abortSignal?.aborted) {
          throw createAbortError("LLM stream aborted by user");
        }

        if (!sawFinish) {
          if (sawContent) {
            // 有内容但无 finish — 不重试（避免连续 assistant 消息），抛出明确错误
            this.logger.warn(
              `[LLM] Stream ended prematurely without finish (partial content present), not retrying`,
            );
            throw new Error(
              "LLM stream ended prematurely without finish signal",
            );
          }

          // 无内容且无 finish — 视为网络错误，可重试
          if (attempt < maxRetries) {
            attempt++;
            const delayMs = computeRetryDelayMs(attempt - 1, {
              code: "ECONNRESET",
            });
            const message = buildRetryMessage(
              "network_error",
              attempt,
              maxRetries,
            );

            this.logger.warn(
              `[LLM] Stream ended without finish or content (attempt ${attempt}/${maxRetries}), retrying`,
            );

            yield {
              type: "retry",
              retryReason: "network_error",
              attempt,
              maxRetries,
              delayMs,
              message,
            };

            await retrySleep(delayMs, abortSignal);
            continue;
          }

          // 重试耗尽（retrySleep 已处理 abort，此处仅防御性检查）
          if (abortSignal?.aborted) {
            throw createAbortError("LLM stream aborted by user");
          }
          throw new Error(
            "LLM stream ended prematurely without finish signal (retries exhausted)",
          );
        }

        // 流正常结束，退出重试循环
        return;
      } catch (error: any) {
        // 用户手动中止：无论 provider 以何种方式结束（抛错/干净结束/重试等待），
        // 只要 abort 信号已触发，一律归一化为 AbortError，避免误判为流异常或触发重试
        if (abortSignal?.aborted) {
          throw createAbortError("LLM stream aborted by user");
        }

        const errorType = classifyError(error);

        // 不可重试 或 重试耗尽 → 直接抛出
        if (!errorType || attempt >= maxRetries) {
          if (attempt > 0) {
            this.logger.warn(
              `[LLM] ${errorType ?? "non-retryable"} 重试耗尽 (${attempt}/${maxRetries})，放弃: ${error.message?.substring(0, 200)}`,
            );
          }
          throw error;
        }

        // 已产生部分内容则不重试 — 重试会导致消息历史中出现连续 assistant 消息，
        // 部分平台（如 Anthropic）不允许连续 assistant 消息
        if (sawContent) {
          this.logger.warn(
            `[LLM] ${errorType} 错误但已有部分内容输出，不重试以避免连续 assistant 消息: ${error.message?.substring(0, 200)}`,
          );
          throw error;
        }

        attempt++;
        const delayMs = computeRetryDelayMs(attempt - 1, error);
        const message = buildRetryMessage(errorType, attempt, maxRetries);

        this.logger.warn(
          `[LLM] ${errorType} (attempt ${attempt}/${maxRetries}), 等待 ${Math.round(delayMs)}ms 后重试: ${error.message?.substring(0, 200)}`,
        );

        // yield retry 事件给前端
        yield {
          type: "retry",
          retryReason: errorType,
          attempt,
          maxRetries,
          delayMs,
          message,
        };

        // 可取消的退避等待
        await retrySleep(delayMs, abortSignal);
      }
    }
  }

  /**
   * 执行会话补全请求（主入口）
   *
   * 该方法采用异步生成器模式，实时向前端推送 LLM 的流式响应。
   * 整个流程受会话锁保护，确保同一时刻只有一个请求在处理该会话。
   *
   * 执行流程：
   * - 加载会话并更新最后活跃时间
   * - 委托 ISessionContext 提供所有运行配置
   * - 进入多轮工具调用循环，逐轮生成响应
   *
   * @param sessionContext 类型安全的会话上下文
   * @param userMessage 本次用户消息(含 id/content/files;非新建回合模式带 turnId=复用回合外壳 id)
   * @param regenerationMode 再生模式（"overwrite" 覆盖旧回复 / "resume" 断点续传）
   * @param abortSignal 中断信号，用于客户端断开连接时中止 LLM 请求
   * @param resumeData 断点续传数据（如审批决策、表单数据等）
   * @returns 回合结束原因（finishReason，供调用方做队列消费等收尾决策）
   */
  async run(
    sessionContext: ISessionContext,
    userMessage: {
      id?: string;
      content?: string;
      files?: FileRef[];
      replaceTurnId?: string;
      knowledgeBaseIds?: string[];
      metadata?: Record<string, any>;
      /** 非新建回合模式(resume/regenerate)复用既有回合时,由前端传入回合外壳 id */
      turnId?: string;
    },
    regenerationMode: string = "overwrite",
    abortSignal?: AbortSignal,
    resumeData?: any,
  ): Promise<{ finishReason: string; followUpUserInput?: string }> {
    const sessionId = sessionContext.sessionId;

    // overwrite 模式:开回合(turn/start)与用户消息(user/message)的入库 + 发布移入
    // executeAgentLoop 开头(turn_start 与 turn_end 配对在同一方法);run() 只负责
    // 重答删除(turn/delete 入库 + 发布)与历史加载(两者无配对闭合事件,留在此处)。
    // 非 overwrite(resume/regenerate)复用既有回合,不新建 turn/start,不追加用户消息;
    // 回合外壳 id 由前端传入 userMessage.turnId(与消息 id 解耦,不新建回合因此无新 turnId)。
    const preGenAssistantId = sessionContext.generateMessageId();
    let turnId = "";
    if (regenerationMode === "overwrite") {
      // ── 1. 重答:先删除(turn/delete 入库 + 发布),再加载 ──
      // 删除先于加载:turn/delete 事件落库后,replayer 重放时 splice 移除该回合,
      // 后续 loadHistory 从 JSONL 重建(LLM 上下文自然不含被删回合,无需失效缓存 hack)。
      if (userMessage?.replaceTurnId) {
        await sessionContext.deleteTurn(userMessage.replaceTurnId);
        // turn 事件纯净:只携带回合外壳 id(turnId),不携带任何 Message 字段
        await sessionContext.publishStream({
          type: "turn_delete",
          turnId: userMessage.replaceTurnId,
        });
      }
    }

    const { finishReason, followUpUserInput } = await RequestContext.run(
      {
        abortSignal,
        sessionId,
        requestId: crypto.randomUUID(),
      },
      () =>
        this.executeAgentLoop(
          sessionContext,
          turnId,
          regenerationMode,
          abortSignal,
          resumeData,
          preGenAssistantId,
          userMessage,
        ),
    );
    return {
      finishReason,
      ...(followUpUserInput ? { followUpUserInput } : {}),
    };
  }

  /**
   * 执行 Agent 多轮工具调用循环
   *
   * 该方法实现了一个完整的 ReAct（Reasoning + Acting）循环：
   * - 初始化会话上下文并加载历史消息
   * - 根据模型特性决定是否启用思维链和工具调用
   * - 在循环中交替执行 LLM 推理和工具调用，直到不再需要继续
   * - 每轮迭代都会持久化助手回复和工具响应
   *
   * 安全机制：
   * - 无迭代次数上限（对齐参考实现主循环：长任务不被上限截断，唯一出口是模型不再请求工具或用户中止）
   * - SessionStreamManager 确保同一会话不会同时启动多个流
   *
   * @param sessionContext 类型安全的会话上下文（包含对话状态）
   * @param turnId 回合外壳 id（overwrite 由 beginTurn 新建;resume 复用既有回合,由 run() 从 userMessage.turnId 取）
   * @param regenerationMode 再生模式标识（'overwrite' | 'resume'）
   * @param abortSignal 中断信号（可选）
   * @param resumeData 断点续传数据（如审批决策、表单数据等）
   * @returns 回合结束原因（businessReason 或 "stop"）；工具转交用户输入（计划审批反馈）时
   *          另带 followUpUserInput，由调用方（chat-runner）作为真实用户消息开启新轮次
   */
  private async executeAgentLoop(
    sessionContext: ISessionContext,
    turnId: string,
    regenerationMode: string,
    abortSignal?: AbortSignal,
    resumeData?: any,
    preGenAssistantId?: string,
    userMessage?: any,
  ): Promise<{ finishReason: string; followUpUserInput?: string }> {
    const resolved = sessionContext.getResolvedPlugins();
    const tools =
      resolved.length > 0
        ? ToolExecutor.toFlatToolDefs(resolved)
        : undefined;

    // 回合级状态（try/catch/finally 共享）：
    // 落盘/运行时异常不能跳过收口——否则回合永远没有 turn/finish，前端也收不到 turn_end。
    let needToContinue = false;
    // 记录 ReAct 循环开始时间，用于计算总耗时（用户消息落库后重置，保持原语义）
    let loopStartTime = Date.now();
    // 工具调用轮次计数器
    let iterationCount = 0;
    // 回合拦截器触发次数（防止无限循环）
    let interceptorCount = 0;
    const MAX_INTERCEPTOR_ITERATIONS = 3;
    let finalError: string | undefined;
    let finalUsage: any;
    // 业务层结束原因：完全独立于上游适配器的 finishReason
    // 上游 finishReason 留在 MessageContent.metadata 供审计，不参与业务判断
    let businessReason: string | undefined;
    /** 工具转交的用户输入（计划审批反馈）：终止回合时随返回值交回 chat-runner 开新轮 */
    let pendingFollowUpInput: string | undefined;
    let finalFinishReason = "stop";
    let loopError: unknown;

    try {
      // 回合开括号 turn_start / 用户消息 user_message 与入库(beginTurn / addUserMessage)
      // 在本方法开头同位置发布,与末尾 turn_end 配对成对(同一方法内成对闭合)。
      // v1.8：resume 分支已删除（审批等统一交互均为回合内原地阻塞），仅 overwrite 有效。
      if (regenerationMode !== "overwrite") {
        this.logger.warn(
          `未知的 regenerationMode "${regenerationMode}"，回退为 overwrite`,
        );
      }
      {
        // ── 3. 开回合:turn/start 入库 + 发布 turn_start ──
        turnId = await sessionContext.beginTurn({
          preGenTurnId: preGenAssistantId,
        });
        // turn 事件纯净:只携带回合级信息(turnId/modelName),不携带任何 Message 字段。
        // assistant 消息由后续 message 级事件(think/text,带 messageId)惰性创建。
        await sessionContext.publishStream({
          type: "turn_start",
          turnId,
          modelName: sessionContext.getModelConfig().modelName,
        });

        // ── 4. 用户消息:user/message 入库 + 发布 user_message(与入库同位置) ──
        // 前端按 FileRef 契约内嵌完整附件元数据（self-contained），此处仅防御性归一：
        // mediaType 非法时由扩展名兜底；refType 缺省按 'store'（历史客户端）；
        // 字符串元素为旧客户端残留，按相对路径占位并告警。
        const userFileRefs: FileRef[] = (userMessage?.files || []).map(
          (f: any): FileRef =>
            typeof f === "string"
              ? { mediaType: "application/octet-stream", bytes: 0, url: f, refType: "store" }
              : {
                  mediaType: normalizeMediaType(f.mediaType ?? f.fileType, f.fileExtension),
                  bytes: f.bytes ?? f.fileSize ?? 0,
                  name: f.name ?? f.displayName ?? f.fileName,
                  // 不拿 previewUrl 冒充实体锚点：缩略图只是展示用的小图，
                  // 当 url 用会让模型读到一张 256px 的图而不是原图。
                  url: f.url,
                  ...(f.previewUrl ? { previewUrl: f.previewUrl } : {}),
                  ...(f.fileExtension ? { fileExtension: f.fileExtension } : {}),
                  refType: normalizeRefType(f.refType),
                },
        );
        if (userMessage?.files?.some((f: any) => typeof f === "string")) {
          this.logger.warn(
            `会话 ${sessionContext.sessionId} 收到旧格式 files（string[]），请升级客户端到 FileRef 契约`,
          );
        }
        const userMsgResult = await sessionContext.addUserMessage(
          userMessage?.content,
          userFileRefs,
          {
            replaceTurnId: userMessage?.replaceTurnId,
            knowledgeBaseIds: userMessage?.knowledgeBaseIds,
            metadata: userMessage?.metadata,
            ...(userMessage?.blocks ? { blocks: userMessage.blocks } : {}),
            ...(userMessage?.injectedBlocks
              ? { injectedBlocks: userMessage.injectedBlocks }
              : {}),
            ...(userMessage?.source ? { source: userMessage.source } : {}),
          },
        );
        if (userMsgResult?.userMessage) {
          await sessionContext.publishStream({
            type: "user_message",
            messageId: userMsgResult.messageId,
            turnId,
            userMessage: userMsgResult.userMessage,
          });
        }
      }

      // 用户消息落库之后再开始计时（与原语义一致）
      loopStartTime = Date.now();
    do {
      iterationCount++;
      needToContinue = false;
      let skipLLMCall = false;

      // 通过 agent 钩子（PRE_STEP，副作用管线）让能力订阅者（压缩等）检查/执行——
      // 订阅者原地改写会话存储（store 写即更新）后放行；agent-engine 不感知压缩细节，
      // 并在钩子后重读消息（对齐 DSH：请求消息派生自会话 surface）。
      // 钩子产生的流内事件（compression_start/error）由订阅者经 sessionContext.publishStream 直发。
      {
        await this.eventBus.serial<void>(
          HOOKS.PRE_STEP,
          { sessionContext, abortSignal },
          () => undefined,
        );
      }

      // 副作用后重读完整请求消息列表（含 system prompt、摘要和历史）——压缩等已生效
      let historyMessages = await sessionContext.getHistory();

      // 每轮提醒 provider（计划模式等）：插件自己决定 persist / transient，
      // 引擎只负责把 persist 写入历史后重读、把 transient 追加到请求尾部。
      // 保持尾部注入 → system + tools 的 KV 前缀逐字节稳定。
      const reminderInjection = this.turnReminders
        ? await this.turnReminders.collect(
            { sessionContext, iterationCount, history: historyMessages },
            this.pluginManager
              ? (pluginId) => this.pluginManager!.isPluginEnabled(pluginId)
              : undefined,
          )
        : { persist: [], transient: [] };

      if (reminderInjection.persist.length > 0) {
        try {
          await sessionContext.appendMessages(reminderInjection.persist);
          historyMessages = await sessionContext.getHistory();
        } catch (error: any) {
          // 落库失败不能让模型失去约束：回退为本次请求的临时注入
          this.logger.warn(
            `Failed to persist turn reminders: ${error?.message ?? error}`,
          );
          reminderInjection.transient.unshift(
            ...reminderInjection.persist.map((message) => ({
              ...message,
              metadata: { ...(message.metadata || {}), transient: true },
            })),
          );
        }
      }

      const requestMessages =
        reminderInjection.transient.length > 0
          ? [...historyMessages, ...reminderInjection.transient]
          : historyMessages;

      // 生成本轮助手回复的内容 ID（= 落库消息 id，与 SSE 消息级事件一致）
      // 累积统一走 BlockAssembler（全链路唯一 StreamChunk→ContentBlock 组装实现），
      // 不再存在 MessageRecord 平铺累积对象与双向转换。
      // 有序消息 id：流式前预分配（SSE 全程携带），落库沿用 → 遮蔽区间按 id 比较可用
      let messageId = sessionContext.generateMessageId();
      const modelConfig = sessionContext.getModelConfig();
      const assembler = new BlockAssembler();

      // 本轮组装产物（流结束后填充；同一 Message 对象入 parts，便于后续回写元数据）
      let assistantMessage: Message | null = null;

      // LLM 流式请求（参数组装经 builder；重试为 agent 循环局部语义，对齐 DSH retryPolicy）
      {
        let streamAborted = false;

        try {
          // LLM 流式请求（参数组装经 builder；重试为 agent 循环局部语义，对齐 DSH retryPolicy）
          const streamResult = this.streamWithRetry(
            SessionLlmRequestBuilder.buildCompletionParams(sessionContext, {
              messages: requestMessages,
              abortSignal,
              usageContext: {
                turnId,
                requestId: messageId,
                assistantMessageId: messageId,
                source:
                  sessionContext.sessionType === "sub_agent"
                    ? "subagent"
                    : "main_turn",
              },
            }),
          );
          for await (const result of streamResult) {
            // 重试信号：清空本次尝试的半截累积（保留续传 seed 前缀），转发给前端
            // 轮次级瞬态：带 turnId，前端挂 turn.state.retry（与 isWorking 同层，不落库）
            if (result.type === "retry") {
              assembler.reset();
              await sessionContext.publishStream({
                type: "retry",
                turnId,
                retryReason: result.retryReason,
                retryAttempt: result.attempt,
                retryMaxAttempts: result.maxRetries,
                retryDelayMs: result.delayMs,
                message: result.message,
              });
              continue;
            }

            // 规范 StreamChunk：先喂组装器（唯一累积实现），再直通广播（消息级事件）
            let chunk = result;

            assembler.push(chunk);

            // block_end 权威块回填 assembler 打点的 timing，保证广播与持久化一致
            if (chunk.type === "block_end") {
              chunk = {
                ...chunk,
                block: assembler.getTimedBlock(chunk.index) ?? chunk.block,
              };
            }

            // 消息级事件直通：messageId 关联所属 assistant 消息，turnId 关联回合外壳
            await sessionContext.publishStream({
              ...chunk,
              messageId,
              turnId,
            } as SessionStreamEvent);
          }
        } catch (error) {
          streamAborted = true;
          const streamError =
            error instanceof Error ? error : new Error(String(error));

          // 上下文溢出恢复（对齐 DSH overflow recovery，经 agent/request-error 钩子）：
          // 能力订阅者（压缩插件）识别溢出错误并强制压缩，返回 { kind: 'retry' } 时重试该请求
          const action = await this.eventBus.serial<RequestErrorAction>(
            HOOKS.REQUEST_ERROR,
            { sessionContext, error: streamError, abortSignal },
            () => undefined,
          );
          if (action?.kind === "retry") {
            // 压缩改变存储：重载历史并重试本步（messageId/assembler 在循环头部重建，
            // 半截累积不落库，不会产生连续 assistant 消息）
            historyMessages = await sessionContext.getHistory();
            needToContinue = true;
            continue;
          }

          this.logger.error(
            `Stream error in agent loop:${streamError.message}`,
            streamError.stack,
          );
          // 业务层：异常终止（区分用户取消和真实错误）
          // 注意：executeLLMStream 已保证 abort 场景抛出 name=AbortError，
          // 这里额外检查 abortSignal 作为兜底（防第三方 adapter 抛非标准错误）
          if (
            streamError.name === "AbortError" ||
            streamError.message.toLowerCase().includes("abort") ||
            abortSignal?.aborted
          ) {
            businessReason = "user_cancel";
          } else if (streamError instanceof UpstreamTimeoutError) {
            businessReason = "timeout";
            finalError = streamError.message;
          } else if (streamError instanceof UpstreamRateLimitError) {
            businessReason = "rate_limited";
            finalError = streamError.message;
          } else {
            businessReason = "error";
            finalError = streamError.message;
          }
        }

        // LLM SDK 收到 abort 信号后可能直接关闭流（不抛异常），需手动检测
        if (!streamAborted && abortSignal?.aborted) {
          streamAborted = true;
          businessReason = "user_cancel";
        }

        // 组装三层 assistant Message（消息 id = messageId）。
        // 工具参数 JSON 修复在 assembler 内统一完成（中止截断与正常完成同规则），
        // 不再需要流后单独修复。块级计时由 assembler 打点，随块持久化/广播。
        // 【DSH 对齐（agent.ts:392）】assembler 自判内容：toMessage 在累加任何有效 chunk
        // 时返回 null（立即报错/中止无任何产出）→ 表示本轮无有效消息，跳过落库与一切消息后处理；
        // 业务错误归拢 turn 级（finalizeTurn → turn.metadata）。
        assistantMessage = assembler.toMessage({
          id: messageId,
          model: modelConfig.modelName,
          extraMetadata: {
            modelName: modelConfig.modelName,
          },
        });

        // 空消息（toMessage 返回 null）已在上方跳过；此处无需 token 统计

        // 有内容 → 落库 assistant 消息 + 中止注入合成工具响应；
        // 空（立即报错/中止无任何产出）→ 不落地、不注入——业务错误由 finalizeTurn 归拢 turn 级。
        // 注：429 限流通常发生在请求阶段（模型尚无输出）→ 空消息路径自然覆盖；罕见的流中段
        // 429（已有部分内容）按普通有内容消息处理，部分内容照常落库，不做额外拦截。
        if (assistantMessage !== null) {
          // 上游可能漏发/缓发 toolCallId：落库前合成稳定 id 并写回块。
          // 必须在 appendMessages 之前——落库后再合成，assistant 事件里的 tool_calls 就是空 id，
          // 而工具结果带的是合成 id，磁盘上即成为「tool_calls 无结果回应」（重启后上游 400）。
          const synthesizedIds = this.ensureToolCallIds(assistantMessage);
          if (synthesizedIds > 0) {
            this.logger.warn(
              `[TOOLCALL-SYNTH-ID] session=${sessionContext.sessionId} 合成 ${synthesizedIds} 个空 toolCallId（上游未颁发调用 id）`,
            );
          }

          await sessionContext.appendMessages([assistantMessage]);

          // 小轮次占用快照：每次 LLM 请求落库后立即推送，环形指示器无需等到 turn_end。
          // 统计为 O(1)（快照增量 + 前缀和），失败只告警，不影响对话主链路。
          await this.publishContextStats(sessionContext, turnId);

          const hasToolCalls = assistantMessage.content.some(
            (b) => b.type === "tool-call",
          );

          // 工具执行：仅在流正常结束且未中止时执行。流异常中止（断网/超时/限流）与用户中止
          // 都不执行——调用参数可能是半截产物（assembler 的 partialParse 会补出"可解析但残缺"
          // 的 JSON），执行风险高于收益；未执行带来的配对缺口由下方收口统一补桩。
          let execResult:
            | {
                toolParts: Message[];
                toolEvent?: SessionStreamEvent;
                followUpUserInput?: string;
              }
            | undefined;
          /** 已落库的结果消息（落库成功才登记：落库失败时配对缺口由收口补桩） */
          let appendedResults: Message[] = [];
          if (hasToolCalls && tools && !streamAborted && !abortSignal?.aborted) {
            try {
              // 执行全部工具（审批由工具 execute 内主动发起——沙盒提权/通用审批服务，
              // 引擎不再预分类挂起；拒绝/超时以 isError tool-result 反馈模型）
              const result = await this.executeToolsAndBuildParts(
                assistantMessage,
                turnId,
                sessionContext,
                abortSignal,
              );
              if (result.toolParts.length > 0) {
                await sessionContext.appendMessages(result.toolParts);
                appendedResults = result.toolParts;
                await sessionContext.publishStream(result.toolEvent!);
                // 工具结果同样计入上下文：落库后补发一次占用快照，
                // 避免长工具执行期间圆环停留在上一次请求的数值。
                await this.publishContextStats(sessionContext, turnId);
              }
              execResult = result;
            } catch (error) {
              // 执行阶段异常（含结果批内空洞等）：就地抛出会穿透本循环 → finalizeTurn 被跳过
              // （回合永不闭合、turn_end 不发），且工具结果一条不落。收敛为业务错误，
              // 配对完整性与回合闭合交给下方收口与循环后的收尾保证。
              const execError =
                error instanceof Error ? error : new Error(String(error));
              this.logger.error(
                `Tool execution failed in agent loop: ${execError.message}`,
                execError.stack,
              );
              businessReason = businessReason ?? "error";
              finalError = finalError ?? execError.message;
            }
          }

          // 收口不变量：已落库的 assistant 声明的每条 tool-call 都必须有结果。
          // 覆盖「未执行」（中止 / 流异常 / 无可用工具）与「执行后仍缺结果」（批内中断、
          // 执行阶段异常）两类残留；未配对的按补桩写入，避免历史在此后每次请求都被上游拒绝。
          await this.closeToolPairing(
            assistantMessage,
            appendedResults,
            turnId,
            sessionContext,
            abortSignal?.aborted === true,
          );

          if (execResult && appendedResults.length > 0) {
            if (execResult.followUpUserInput) {
              // 工具转交了用户的话（计划审批反馈）：用户开了口 → 本轮到此结束。
              // 输入随 run() 返回值交回 chat-runner，作为真实用户消息开启新轮次；
              // 不设 needToContinue → 循环自然退出（isNormalFinish 为 false，
              // TURN_STOPPING 拦截器不会在用户拒绝后再注入续跑消息）。
              businessReason = "plan_rejected";
              pendingFollowUpInput = execResult.followUpUserInput;
            } else {
              needToContinue = true;
            }
          }
        }
      }

      this.logger.debug(
        `Iteration ${iterationCount} completed. reason: ${assistantMessage?.metadata.finishReason} continue=${needToContinue}`,
      );

      // 【回合拦截器】仅在正常结束时检查
      // 正常结束 = 无业务原因（businessReason 未设置）+ 无 needToContinue + 无 abort
      // 【abort 及时性】每轮结束时立即检查用户停止：
      // 若已 abort（例如工具执行期间被 kill），直接以 user_cancel 结束循环，
      // 不再发起下一轮 LLM 调用，避免等待一次完整 LLM 响应造成的数秒延迟
      if (abortSignal?.aborted) {
        businessReason = "user_cancel";
        needToContinue = false;
      }

      const isNormalFinish =
        !needToContinue && !abortSignal?.aborted && !businessReason;

      if (
        isNormalFinish &&
        interceptorCount < MAX_INTERCEPTOR_ITERATIONS &&
        (await this.runTurnStoppingHook(sessionContext))
      ) {
        interceptorCount++;
        this.logger.log(
          `Turn stopping hook injected hidden message (count=${interceptorCount})`,
        );
        needToContinue = true;
      }

      finalUsage = assistantMessage?.metadata.usage;
    } while (needToContinue);
    } catch (error) {
      loopError = error;
      const loopErrorMessage =
        error instanceof Error ? error.message : String(error);
      const isAbort =
        abortSignal?.aborted === true ||
        (error instanceof Error &&
          (error.name === "AbortError" ||
            error.message.toLowerCase().includes("abort")));

      if (isAbort) {
        businessReason = businessReason ?? "user_cancel";
      } else {
        businessReason = businessReason ?? "error";
        finalError = finalError ?? loopErrorMessage;
      }
      this.logger.error(
        `Agent loop aborted (${businessReason}): ${loopErrorMessage}`,
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      // 业务层结束原因：完全独立于上游适配器
      // businessReason 在各业务决策点设置（用户中止/计划审批拒绝/超时/限流/异常）
      // 未设置且无异常 → 模型正常结束 → "stop"
      finalFinishReason = businessReason || (loopError ? "error" : "stop");

      if (turnId) {
        // 保存结束信息到 Turn 级别 metadata
        const loopDuration = Date.now() - loopStartTime;
        const finishMeta: Record<string, any> = {
          finishReason: finalFinishReason,
          ...(finalError ? { errorDetail: finalError } : {}),
          ...(finalUsage ? { usage: finalUsage } : {}),
          ...(sessionContext.getModelConfig().modelName
            ? { modelName: sessionContext.getModelConfig().modelName }
            : {}),
        };

        // 落盘失败不能阻止回合收口：存储层对 EMFILE/ENFILE 已有退避重试，
        // 这里再兜底——finalize 失败只告警，turn_end 仍然发给前端复位工作态。
        try {
          await sessionContext.finalizeTurn(
            turnId,
            loopDuration,
            finishMeta as any,
          );
        } catch (finalizeError: any) {
          this.logger.error(
            `finalizeTurn failed for ${turnId}: ${finalizeError?.message ?? finalizeError}`,
            finalizeError?.stack,
          );
        }

        try {
          await sessionContext.persist();
        } catch (persistError: any) {
          this.logger.warn(
            `persist failed after turn ${turnId}: ${persistError?.message ?? persistError}`,
          );
        }

        // 上下文统计失败不能吞掉 turn_end：前端靠它复位 isWorking。
        let contextStats:
          | Awaited<ReturnType<ISessionContext["getContextStats"]>>
          | undefined;
        try {
          contextStats = await sessionContext.getContextStats();
        } catch (statsError: any) {
          this.logger.warn(
            `getContextStats failed for turn ${turnId}: ${statsError?.message ?? statsError}`,
          );
        }

        // 发送 turn_end 事件:回合级收尾信号,只携带回合级信息(turnId/finishReason/usage/耗时/contextStats),
        // 不携带 Message 内容(content/reasoningContent/messageId 已由 message 级事件承载)。
        // totalDurationMs 与落库的 turn/finish 事件同值（finalizeTurn 的 loopDuration），
        // 前端据此写 turn.metadata，使实时与刷新两条路径的耗时展示同源。
        try {
          await sessionContext.publishStream({
            type: "turn_end",
            turnId,
            finishReason: finalFinishReason,
            error: finalError,
            usage: finalUsage,
            totalDurationMs: loopDuration,
            contextStats,
          });
        } catch (publishError: any) {
          this.logger.warn(
            `publish turn_end failed for ${turnId}: ${publishError?.message ?? publishError}`,
          );
        }
      }
    }

    // 原始异常在收口完成后重新抛出：保留 chat-runner 的 error 事件与
    // stopStream("error")；turn_end 已先于 error 到达前端，回合不会静默停住。
    if (loopError) throw loopError;

    return {
      finishReason: finalFinishReason,
      ...(pendingFollowUpInput ? { followUpUserInput: pendingFollowUpInput } : {}),
    };
  }

  /**
   * 记录单次 LLM 请求后的上下文占用快照（小轮次）。
   *
   * 调用时机必须在 assistant 消息 appendMessages 之后：最新 usage 锚点即本次请求，
   * 结果与回合结束的 turn_end.contextStats 同口径。
   * 先落盘 context/stats（意外退出后冷启动可恢复），再实时广播；
   * 任一步失败只影响环形指示器，不能中断 agent loop（否则会跳过 finalizeTurn）。
   */
  private async publishContextStats(
    sessionContext: ISessionContext,
    turnId: string,
  ): Promise<void> {
    try {
      const contextStats = await sessionContext.getContextStats();
      // 持久化锚点：流式中意外退出后，冷启动扫描事件页仍能恢复到本小轮次
      await sessionContext.appendContextStats(turnId, contextStats);
      // 实时广播：前端环形指示器立即更新
      await sessionContext.publishStream({
        type: "context_stats",
        turnId,
        contextStats,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to persist/publish per-request context stats: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * 回合关闭前续跑钩子（HOOKS.TURN_STOPPING，parallel 调度）
   *
   * 在 do...while 循环正常退出后（AI 认为对话可以结束）、回合关闭前执行。
   * 订阅者（如 shell 插件检测后台进程）返回 { kind: 'continue', messages } 时，
   * 合并为一条 hidden user 消息追加，触发新一轮 LLM 调用（对齐 DSH turn-stopping + steer）。
   *
   * @param sessionContext 会话上下文
   * @returns 是否注入了续跑消息（true → 触发新一轮 LLM 调用）
   */
  private async runTurnStoppingHook(
    sessionContext: ISessionContext,
  ): Promise<boolean> {
    const decisions = await this.eventBus.parallel<TurnStoppingDecision>(
      HOOKS.TURN_STOPPING,
      { sessionContext } satisfies TurnStoppingPayload,
    );
    const messages = decisions
      .filter((d): d is NonNullable<TurnStoppingDecision> => d != null)
      .flatMap((d) => (d.kind === "continue" ? d.messages : []));

    if (messages.length === 0) return false;

    const interceptorMessageId = sessionContext.generateMessageId();
    await sessionContext.appendMessages([
      {
        id: interceptorMessageId,
        role: "user",
        kind: "model",
        source: { kind: "plugin", plugin: "interceptor" },
        metadata: { hidden: true },
        content: [
          {
            type: "text",
            text: messages.join("\n\n"),
          },
        ],
      },
    ]);
    return true;
  }

  /**
   * 落库前补齐空 toolCallId：上游漏发/缓发时合成稳定 id 并写回块。
   *
   * 时机是契约的一部分——必须在 assistant 消息 appendMessages **之前**：
   * 落库后再合成，事件里的 tool_calls 是空 id，而工具结果携带合成 id，
   * 磁盘上即成为「无 tool 消息回应声明的 tool_call_id」的非法形状（重启后每次请求 400）。
   *
   * @returns 合成的条数（>0 时由调用方告警）
   */
  private ensureToolCallIds(message: Message): number {
    let synthesized = 0;
    for (const block of message.content) {
      if (block.type !== "tool-call" || block.toolCallId) continue;
      block.toolCallId = `call_${crypto.randomUUID()}`;
      synthesized += 1;
    }
    return synthesized;
  }

  /**
   * 收口不变量：已落库的 assistant 声明的每条 tool-call 都必须有工具结果。
   *
   * 未被真实结果覆盖的调用补一条合成结果（isError），覆盖「未执行」（中止 / 流异常 /
   * 无可用工具）与「执行后仍缺结果」（批内中断、执行阶段异常）两类残留：
   * 上游对 wire 形状有硬要求（assistant 的 tool_calls 之后必须有回应它的 tool 消息），
   * 缺口留在历史里会让此后每次请求都 400，且只有冷加载修复（还要有坏行）能救。
   *
   * 永不抛错：补桩失败只告警——本方法在回合收尾前的关键路径上，抛错会跳过
   * finalizeTurn（回合不闭合），代价高于一次补桩失败。
   *
   * @param assistantMessage 本轮已落库的 assistant 消息
   * @param appendedResults 本轮已落库的真实结果消息（未落库的不算）
   * @param aborted 用户中止（文案区分为"请求被中止"而非"中断未派发"）
   */
  private async closeToolPairing(
    assistantMessage: Message,
    appendedResults: Message[],
    turnId: string,
    sessionContext: ISessionContext,
    aborted: boolean,
  ): Promise<void> {
    try {
      const toolCalls = assistantMessage.content.filter(isToolCallBlock);
      if (toolCalls.length === 0) return;

      const paired = new Set<string>();
      for (const message of appendedResults) {
        const callId = toolResultCallIdOf(message);
        if (callId) paired.add(callId);
      }
      const missing = toolCalls.filter((call) => !paired.has(call.toolCallId));
      if (missing.length === 0) return;

      const abortText =
        "<system_reminder>Request aborted by user</system_reminder>";
      const parts: Message[] = missing.map((call) => ({
        id: sessionContext.generateMessageId(),
        role: "tool",
        kind: "model",
        source: { kind: "tool", toolCallId: call.toolCallId },
        metadata: {},
        content: [
          {
            type: "tool-result",
            toolCallId: call.toolCallId,
            name: call.name,
            content: aborted ? abortText : SYNTHETIC_TOOL_INTERRUPTED_TEXT,
            isError: true,
          },
        ],
      }));
      await sessionContext.appendMessages(parts);
      await sessionContext.publishStream({
        type: "tool_calls_response",
        turnId,
        toolCallsResponse: parts.map((message, index) => ({
          messageId: message.id,
          name: missing[index].name,
          content: String(
            (message.content[0] as Extract<ContentBlock, { type: "tool-result" }>)
              .content,
          ),
          toolCallId: missing[index].toolCallId,
          outcome: "error" as const,
        })),
      });
      this.logger.warn(
        `[tool-pairing] session=${sessionContext.sessionId} 回合 ${turnId}: ` +
          `为 ${missing.length} 条无结果的 tool-call 补合成结果 (aborted=${aborted}, ` +
          `calls=${missing.map((c) => c.toolCallId).join(",")})`,
      );
    } catch (error: any) {
      this.logger.error(
        `[tool-pairing] 补合成工具结果失败 session=${sessionContext.sessionId} turn=${turnId}: ${error?.message ?? error}`,
      );
    }
  }

  /**
   * 执行工具并构建入库数据和事件（不发布，不入库）
   *
   * 由 executeAgentLoop 调用，返回执行结果后由调用方负责发布和 persist。
   * 审批由工具 execute 内主动发起（沙盒提权/通用审批服务原地等待），引擎不再预分类挂起。
   *
   * @param assistantMessage 本轮组装的 assistant 消息（工具调用从 tool-call 内容块读取）
   * @param messageId 本轮消息 id（事件关联字段）
   * @param turnId 本轮回合外壳 id（事件关联字段）
   */
  private async executeToolsAndBuildParts(
    assistantMessage: Message,
    turnId: string,
    sessionContext: ISessionContext,
    abortSignal?: AbortSignal,
  ): Promise<{
    toolParts: Message[];
    toolEvent?: SessionStreamEvent;
    /** 工具转交的用户输入（计划审批反馈）：非空表示本轮应终止 */
    followUpUserInput?: string;
  }> {
    const toolCalls = assistantMessage.content.filter(
      (b): b is Extract<ContentBlock, { type: "tool-call" }> =>
        b.type === "tool-call",
    );
    if (toolCalls.length === 0) return { toolParts: [] };

    // toolCallId 由调用方在落库前保证（ensureToolCallIds）：此处只做不变量断言，
    // 空 id 会产出无法配对的 tool 结果，属调用契约破坏，不静默兜底。
    for (const tc of toolCalls) {
      if (!tc.toolCallId) {
        this.logger.error(
          `[TOOLCALL-ID-MISSING] tool call 进入执行时仍无 toolCallId (name=${tc.name || "(no-name)"})，配对将不完整`,
        );
      }
    }

    // 1. 过滤畸形调用（缺 name）→ invalidTools 生成错误响应，合法调用直接执行
    const validToolCalls: any[] = [];
    const invalidTools: any[] = [];
    for (const tc of toolCalls) {
      if (tc && tc.name) validToolCalls.push(tc);
      else invalidTools.push(tc);
    }

    // 执行结果收集
    const toolResponses: any[] = [];

    // 2. 直接执行全部合法工具调用（同一消息内多工具按 executeBatch 并发）
    if (validToolCalls.length > 0) {
      const results = await this.toolExecutor.executeBatch(
        validToolCalls.map((tc: any) => ({
          id: tc.toolCallId,
          name: tc.name,
          arguments: (() => {
            try {
              return typeof tc.arguments === "string"
                ? JSON.parse(tc.arguments)
                : tc.arguments;
            } catch {
              return {};
            }
          })(),
        })),
        sessionContext,
        abortSignal,
      );
      // 结果数组与请求同序（executeBatch 已把空洞补成显式中断结果）；这里再滤一次空槽，
      // 保证下面按 res.toolCallId 建消息的循环不会因 undefined 抛 TypeError（那会丢掉整批结果）
      toolResponses.push(...results.filter((result) => !!result));

      // 结果 outcome 回填到响应事件（瞬态；不写回内容块——块只承载模型产出）
      for (let i = 0; i < validToolCalls.length; i++) {
        const result = results[i];
        if (result) {
          result.outcome = result?.isError ? "error" : "success";
        }
      }
    }

    // 缺少 name 的畸形工具调用：生成错误响应反馈给模型，
    // 而不是静默丢弃导致 toolParts 为空、工具循环被直接终止
    for (const invalid of invalidTools) {
      toolResponses.push({
        toolCallId: invalid.toolCallId,
        name: "(unknown)",
        content: JSON.stringify({
          success: false,
          message:
            "Invalid tool call: missing tool name. Please call a valid registered tool.",
        }),
        isError: true,
        outcome: "error",
      });
    }

    if (toolResponses.length === 0) {
      return { toolParts: [] };
    }

    // 构建 parts（tool 结果消息，三层 Message[]）——
    // 每个工具结果是独立消息（独立 id），与含调用的 assistant 消息 id 无关（对齐 DSH：独立节点 + callId 关联）。
    // 工具产出图片不拆消息：物化后的 FileRef 内嵌在 tool-result.images，与 name/toolCallId 同块，
    // 图片归属可直接追溯；请求组装边界再派生为隐藏 user 消息（多模态模型）。
    const toolParts: Message[] = [];
    /** 本批工具结果里转交的用户输入（followUpUserInput，取第一个非空） */
    let followUpUserInput: string | undefined;
    // SSE 事件条目：携带独立 tool 结果消息 id（= 入库 tool/result.messageId），与持久化路径一致
    const responseEntries: Array<{
      messageId: string;
      name: string;
      content: string;
      toolCallId: string;
      outcome?: "success" | "error" | "rejected";
      images?: FileRef[];
    }> = [];

    for (const res of toolResponses) {
      const toolResultId = sessionContext.generateMessageId();

      // 图片物化：统一进会话 images 目录，FileRef 只落路径指针——
      // 持久化契约：快照/事件日志不存 base64（jsonl-persistence-design §3.3，dsh 明确禁止）。
      // 物化结果直接内嵌到 tool-result，不再单独生成隐藏 user 消息。
      let content = res.content ?? "";
      let images: FileRef[] | undefined;
      if ((res.images?.length ?? 0) > 0 || (res.imageRefs?.length ?? 0) > 0) {
        const materialized = await this.materializeToolImages(
          sessionContext.sessionId,
          res.images,
          res.imageRefs,
        );
        if (materialized.refs.length > 0) images = materialized.refs;
        if (materialized.failures.length > 0) {
          // 物化彻底失败（如引用路径已失效）：以文本告知模型，避免它以为图已注入
          content = `${content}${content ? "\n" : ""}[image unavailable: ${materialized.failures.join("; ")}]`;
        }
      }

      toolParts.push({
        id: toolResultId,
        role: "tool",
        kind: "model",
        source: { kind: "tool", toolCallId: res.toolCallId },
        metadata: {},
        content: [
          {
            type: "tool-result",
            toolCallId: res.toolCallId,
            name: res.name,
            content,
            isError: !!res.isError,
            ...(images ? { images } : {}),
            ...(res.meta ? { meta: res.meta } : {}),
          },
        ],
      });
      responseEntries.push({
        messageId: toolResultId,
        name: res.name,
        content,
        toolCallId: res.toolCallId,
        outcome: res.outcome,
        ...(images ? { images } : {}),
        ...(res.meta ? { meta: res.meta } : {}),
      });

      // 工具转交的用户输入（计划审批反馈）：只收集不注入——它不属于本轮，
      // 由调用方终止回合后交回 chat-runner，作为**真实用户消息开启新轮次**
      // （在本轮塞隐藏消息会让用户的话在界面上消失、且错误归属到助手轮次）。
      if (!followUpUserInput && res.followUpUserInput?.trim()) {
        followUpUserInput = res.followUpUserInput.trim();
      }
    }

    // 构建 SSE 事件：结果按 toolCallId 关联（对齐回放 tool/result 聚类语义），
    // 不使用 assistant 消息 id 作关联；每个条目携带独立 tool 结果消息 id。
    const toolEvent: SessionStreamEvent = {
      type: "tool_calls_response",
      turnId,
      toolCallsResponse: responseEntries,
    };

    return {
      toolParts,
      toolEvent,
      ...(followUpUserInput ? { followUpUserInput } : {}),
    };
  }

  /**
   * 工具产出图片统一物化进会话 images 目录，产出 FileRef 路径指针。两条入口：
   * - imageRefs：字节已在磁盘（image_view / browser_screenshot）——路径已在本会话
   *   数据目录内（如查看用户上传图）→ 直接转正为自包含引用，零复制；否则转码落副本。
   * - images（base64）：MCP 等线上字节来源的兜底——解码后走同一落盘路径。
   *
   * 单张失败先降级 data: URL（legacy 形态，仅该张图）；连字节都拿不到（如引用路径
   * 已失效）→ 记入 failures，由调用方追加到 tool-result 文本告知模型。
   * 任何情况下不抛错、不终止回合。
   */
  private async materializeToolImages(
    sessionId: string,
    images?: ImageContent[],
    imageRefs?: ImageRefContent[],
  ): Promise<{ refs: FileRef[]; failures: string[] }> {
    const refs: FileRef[] = [];
    const failures: string[] = [];

    for (const ref of imageRefs ?? []) {
      try {
        refs.push(await this.materializeImageRef(sessionId, ref));
      } catch (error: any) {
        try {
          const buf = await fs.promises.readFile(ref.url);
          if (buf.byteLength > INLINE_FALLBACK_MAX_BYTES) {
            // 体积兜底：data: URL 会原样落进 tool-result.images 并随每次请求重发，
            // 无上限时这条降级路径能绕过单图转码预算（唯一的体积控制缺口）
            failures.push(
              `${ref.url} (materialization failed: ${error.message}; file is ${buf.byteLength} bytes, too large to inline)`,
            );
            this.logger.warn(
              `工具图片物化失败且体积超限，跳过内联：${ref.url}：${error.message}`,
            );
          } else {
            this.logger.warn(
              `工具图片物化失败，降级 data: URL：${ref.url}：${error.message}`,
            );
            refs.push(
              inlineDataRef(
                ref.media_type ?? mimeFromExtension(path.extname(ref.url)),
                buf.toString("base64"),
                buf.byteLength,
              ),
            );
          }
        } catch {
          failures.push(`${ref.url} (${error.message})`);
          this.logger.warn(
            `工具图片不可用，已跳过：${ref.url}：${error.message}`,
          );
        }
      }
    }

    for (const img of images ?? []) {
      try {
        const buf = Buffer.from(img.data, "base64");
        refs.push(await this.materializeImageBuffer(sessionId, buf, "tool-image"));
      } catch (error: any) {
        const byteLength = Math.floor((img.data.length * 3) / 4);
        if (byteLength > INLINE_FALLBACK_MAX_BYTES) {
          failures.push(
            `tool-image (materialization failed: ${error.message}; ${byteLength} bytes is too large to inline)`,
          );
          this.logger.warn(
            `工具图片落盘失败且体积超限，跳过内联：${error.message}`,
          );
          continue;
        }
        this.logger.warn(`工具图片落盘失败，降级 data: URL：${error.message}`);
        refs.push(inlineDataRef(img.media_type, img.data, byteLength));
      }
    }

    return { refs, failures };
  }

  /** 磁盘引用 → 会话图片：会话目录内直接转正，会话目录外转码落副本 */
  private async materializeImageRef(
    sessionId: string,
    ref: ImageRefContent,
  ): Promise<FileRef> {
    const sessionDir = getSessionDir(sessionId);

    if (ref.refType === "session") {
      // 插件直接引用会话目录内文件（自包含 url：sessions/<id>/...）→ 校验存在后原样转正
      const rel = ref.url.replace(/^sessions\/[^/]+\//, "");
      const physical = path.join(sessionDir, rel);
      const stat = await fs.promises.stat(physical);
      return {
        mediaType: ref.media_type ?? mimeFromExtension(path.extname(physical)),
        bytes: ref.bytes ?? stat.size,
        ...(ref.name ? { name: ref.name } : {}),
        url: ref.url,
        ...(ref.previewUrl ? { previewUrl: ref.previewUrl } : {}),
        refType: "session",
      };
    }

    const insideRel = relativeToSessionDir(sessionDir, ref.url);
    if (insideRel) {
      const stat = await fs.promises.stat(ref.url);
      // 零复制转正的条件：位于 images|previews（上传/物化产物，都已过体积阶梯）且体积
      // 已合身。既有会话图可能来自上传（384KB 预算）或工具物化（150KB 预算）——
      // 取两者较大者作为合身判据，避免查看用户上传图时被再次压缩。
      // 其余情况（其他子目录 / 超体积文件）仍走转码落副本，保证直发模型的引用可控。
      const acceptBytes = Math.max(
        getImageTargetBytes(),
        getToolImageTargetBytes(),
      );
      const isCanonicalImage =
        /^(images|previews)\//.test(insideRel) && stat.size <= acceptBytes;
      if (isCanonicalImage) {
        return {
          mediaType: ref.media_type ?? mimeFromExtension(path.extname(ref.url)),
          bytes: ref.bytes ?? stat.size,
          ...(ref.name ? { name: ref.name } : {}),
          url: `sessions/${sessionId}/${insideRel}`,
          refType: "session",
        };
      }
    }

    const buf = await fs.promises.readFile(ref.url);
    return this.materializeImageBuffer(
      sessionId,
      buf,
      ref.name || path.basename(ref.url),
    );
  }

  /**
   * 字节 → 转码（工具图预算 150KB）→ 落会话 images|previews → session 引用
   * （转码/命名/落盘统一在 SessionImageStore，browser-script 截图复用同一实现）
   */
  private async materializeImageBuffer(
    sessionId: string,
    buf: Buffer,
    baseName: string,
  ): Promise<FileRef> {
    const { ref } = await this.sessionImages.save(sessionId, buf, { baseName });
    return ref;
  }
}
