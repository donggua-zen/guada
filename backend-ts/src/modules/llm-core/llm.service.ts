import { Injectable, Logger } from "@nestjs/common";
import { AdapterRegistry } from "./adapter-registry.service";
import { ModelCapabilityService } from "./model-capability.service";
import type {
  LLMCompletionParams,
  LLMCompletionResult,
  StreamChunk,
  StreamUsage,
  UsageSource,
} from "./types/llm.types";
import type { Message } from "../../common/types/conversation.types";
import { RequestContext } from "../../common/context/request-context";
import { removeOrphanSurrogates } from "../../common/utils/string.utils";
import {
  createStreamTimeoutController,
  withStreamIdleTimeout,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
} from "./utils/stream-timeout.util";
import { UpstreamTimeoutError } from "./utils/upstream-errors";
import { SettingsService } from "../settings/settings.service";
import { UsageService } from "../usage/usage.service";
import {
  SG_SYSTEM,
  SK_SYS_LLM_REQUEST_TIMEOUT_MS,
  SK_SYS_LLM_IDLE_TIMEOUT_MS,
} from "../../constants/settings.constants";
import {
  buildPatchExprContext,
  evaluatePatchExpr,
} from "./thinking/cel-evaluator";

/** Default idle timeout between stream chunks (2 minutes). */
const DEFAULT_IDLE_TIMEOUT_MS = 120_000;

/** Default hard request timeout (10 minutes) — total deadline, includes streaming. */
const DEFAULT_REQUEST_TIMEOUT = 600_000;

type StreamTimeoutController = ReturnType<typeof createStreamTimeoutController>;

/** 一次 LLM 调用的采集上下文（请求开始即冻结，避免 await 后配置/模型被切换） */
interface UsageObservationContext {
  sessionId: string | null;
  turnId: string | null;
  requestId: string | null;
  assistantMessageId: string | null;
  attemptIndex: number;
  source: UsageSource;
  providerId: string;
  modelId: string;
  startedAt: number;
}

interface UsageObservationResult {
  status: "completed" | "error" | "cancelled";
  firstTokenAt: number | null;
  completedAt: number | null;
  usage: StreamUsage | null;
  finishReason: string | null;
  errorType: string | null;
  errorMessage: string | null;
}

@Injectable()
export class LLMService {
  private readonly logger = new Logger(LLMService.name);

  constructor(
    private adapterRegistry: AdapterRegistry,
    private settingsService: SettingsService,
    private capability: ModelCapabilityService,
    private usageService: UsageService,
  ) {}

  /**
   * 从系统设置读取 LLM 请求超时（整体硬截止），单位毫秒
   * 值非法或未配置时回退到默认值 600000 (10 min)
   */
  private async getRequestTimeoutMs(): Promise<number> {
    try {
      const raw = await this.settingsService.getSettingValue(
        SG_SYSTEM,
        SK_SYS_LLM_REQUEST_TIMEOUT_MS,
        DEFAULT_REQUEST_TIMEOUT,
      );
      const val = Number(raw);
      if (Number.isInteger(val) && val >= 1000) return val;
      return DEFAULT_REQUEST_TIMEOUT;
    } catch {
      return DEFAULT_REQUEST_TIMEOUT;
    }
  }

  /**
   * 从系统设置读取流式空闲超时（两个 chunk 之间无数据的最长间隔），单位毫秒
   * 值非法或未配置时回退到默认值 120000 (2 min)
   */
  private async getIdleTimeoutMs(): Promise<number> {
    try {
      const raw = await this.settingsService.getSettingValue(
        SG_SYSTEM,
        SK_SYS_LLM_IDLE_TIMEOUT_MS,
        DEFAULT_IDLE_TIMEOUT_MS,
      );
      const val = Number(raw);
      if (Number.isInteger(val) && val >= 1000) return val;
      return DEFAULT_IDLE_TIMEOUT_MS;
    } catch {
      return DEFAULT_IDLE_TIMEOUT_MS;
    }
  }

  /**
   * 统一的补全执行方法（支持流式和非流式）
   *
   * 在此层统一创建 stream idle timeout controller，所有 adapter 无需各自处理超时。
   * adapter 收到的 abortSignal 已合并了用户信号 + idle timer，
   * SDK 调用直接使用此信号即可。
   */
  async completions(
    params: LLMCompletionParams,
  ): Promise<AsyncGenerator<StreamChunk, void, unknown> | LLMCompletionResult> {
    const providerType = params.providerConfig?.type;
    const protocol = params.providerConfig?.protocol || "openai";

    if (!providerType) {
      throw new Error("Provider type is required in providerConfig");
    }

    const userSignal = params.abortSignal || RequestContext.abortSignal();

    // 按 wire 协议取适配器（供应商差异经 providerConfig.thinking 传入，
    // 对齐 DSH thinkingFormat；供应商类型仅用于 custom 转发判定与日志）
    let adapter = this.adapterRegistry.getAdapter(protocol);

    if (!adapter && providerType === 'custom') {
      // custom 网关声明了协议但网关本身只讲另一种 wire：协议转发（非故障切换）
      this.logger.log(`Custom provider doesn't support ${protocol}, forwarding to official protocol adapter`);
      if (protocol === 'gemini') {
        adapter = this.adapterRegistry.getAdapter('gemini');
      }
      if (protocol === 'anthropic') {
        adapter = this.adapterRegistry.getAdapter('anthropic');
      }
    }

    this.logger.log(
      `Using ${protocol} adapter for provider ${params.providerConfig?.id || providerType}`,
    );

    if (!adapter) {
      throw new Error(`Unsupported protocol: ${protocol} (provider ${providerType})`);
    }

    // ===== 思考选择校验（能力向 ModelCapabilityService 要，不由调用方搬运） =====
    // 折中语义：模型无思考能力却请求非 none → fail-loud；
    //           档位不受支持（换模型后的存量设置）→ 静默调整到合法档。
    const thinkingEffort = this.capability.resolveThinkingEffort(
      params.providerConfig?.id,
      params.model,
      params.thinkingEffort,
    );
    if (thinkingEffort !== params.thinkingEffort) {
      this.logger.log(
        `thinkingEffort adjusted: '${params.thinkingEffort}' → '${thinkingEffort}' (invalid for model)`,
      );
    }

    // 档位 patch：条目 thinkingEffortsPatch 的该档声明，adapter 装配完请求体后
    // 整体应用（null 删键）。能力解析与 effort 同层，适配器只消费不查询。
    let thinkingPatch = this.capability.resolveThinkingPatch(
      params.providerConfig?.id,
      params.model,
      thinkingEffort,
    );

    // 拼法表达式（CEL）：存在时按当前档位求值为 patch，并接管内置拼法分派
    // （适配器跳过 thinkingFormat/协议固定形状的思考字段写入）。
    // 求值失败 fail-open：log 告警并回落内置拼法——思考字段是增强，
    // 不因表达式问题阻断整轮请求（配置错误已在保存时 400 拦下）。
    let thinkingPatchReplacesFormat = false;
    const patchExpr = this.capability.resolveThinkingPatchExpr(
      params.providerConfig?.id,
      params.model,
    );
    if (patchExpr && thinkingEffort) {
      try {
        const mappedValue = this.capability.resolveThinkingWireValue(
          params.providerConfig?.id,
          params.model,
          thinkingEffort,
        );
        const off = this.capability.resolveThinkingOff(
          params.providerConfig?.id,
          params.model,
        );
        thinkingPatch = evaluatePatchExpr(
          patchExpr,
          buildPatchExprContext(thinkingEffort, {
            mappedValue,
            offWire: off.wire,
          }),
        );
        thinkingPatchReplacesFormat = true;
      } catch (err: any) {
        this.logger.warn(
          `拼法表达式求值失败，回落内置拼法（provider=${params.providerConfig?.id} model=${params.model}）：${err?.message ?? err}`,
        );
      }
    }

    // 清洗消息（三层 Message[]：清洗各 text/reasoning 块中的孤儿代理字符）
    const sanitizedMessages: Message[] = params.messages.map((msg) => ({
      ...msg,
      content: msg.content.map((block) => {
        if (block.type === "text" && block.text) {
          return { ...block, text: removeOrphanSurrogates(block.text) };
        }
        if (block.type === "reasoning" && block.summary) {
          return { ...block, summary: removeOrphanSurrogates(block.summary) };
        }
        if (block.type === "tool-result" && block.content) {
          return { ...block, content: removeOrphanSurrogates(block.content) };
        }
        return block;
      }),
    }));

    // ===== 统一 idle timeout 控制（在 service 层创建，adapter 只需使用 signal） =====
    const idleTimeoutMs = await this.getIdleTimeoutMs();
    const requestTimeoutMs = params.timeout ?? (await this.getRequestTimeoutMs());

    const streamTc = createStreamTimeoutController(
      userSignal,
      idleTimeoutMs,
    );
    streamTc.resetIdleTimer();

    const isStream = params.stream === true;
    const usageContext = this.buildUsageContext(params);
    const adapterResult = await adapter.chatCompletion({
      ...params,
      messages: sanitizedMessages,
      thinkingEffort,
      thinkingPatch,
      thinkingPatchReplacesFormat,
      abortSignal: streamTc.signal,
      timeout: requestTimeoutMs,
    });

    if (isStream) {
      // 流式：用 withStreamIdleTimeout 包装，每个 chunk 重置 idle timer；
      // 外层再包一层用量观测，chunk 原样透传，终端统一落账本。
      const timed = withStreamIdleTimeout(
        adapterResult as AsyncGenerator<StreamChunk, void, unknown>,
        streamTc,
      );
      return this.observeStream(timed, usageContext, userSignal, streamTc);
    }

    // 非流式：旧实现只 await 一次 next()，usage/finish 全部丢失，
    // 标题生成也读不到 content。这里排空 generator 后组装完整结果。
    return this.collectNonStream(
      adapterResult,
      usageContext,
      userSignal,
      streamTc,
    );
  }

  // ==================== 用量观测 ====================

  private buildUsageContext(params: LLMCompletionParams): UsageObservationContext {
    const ctx = params.usageContext;
    const sessionId =
      ctx?.sessionId ?? RequestContext.current()?.sessionId ?? null;
    return {
      sessionId,
      turnId: ctx?.turnId ?? null,
      requestId: ctx?.requestId ?? null,
      assistantMessageId: ctx?.assistantMessageId ?? null,
      attemptIndex: ctx?.attemptIndex ?? 0,
      // 显式 source 优先；辅助调用经 purpose 映射；其余按 session 归属主对话
      source: this.usageService.resolveSource({
        source: ctx?.source,
        purpose: params.purpose,
        sessionId,
      }),
      providerId: params.providerConfig?.id ?? "",
      modelId: params.model,
      startedAt: Date.now(),
    };
  }

  private async *observeStream(
    stream: AsyncGenerator<StreamChunk, void, unknown>,
    ctx: UsageObservationContext,
    userSignal: AbortSignal | undefined,
    streamTc: StreamTimeoutController,
  ): AsyncGenerator<StreamChunk, void, unknown> {
    let firstTokenAt: number | null = null;
    let finishedAt: number | null = null;
    let usage: StreamUsage | null = null;
    let finishReason: string | null = null;
    let errorType: string | null = null;
    let errorMessage: string | null = null;
    let status: UsageObservationResult["status"] = "completed";
    let completed = false;

    try {
      for await (const chunk of stream) {
        if (firstTokenAt == null && isContentChunk(chunk)) {
          firstTokenAt = Date.now();
        }
        if (chunk.type === "usage") usage = chunk.usage;
        if (chunk.type === "finish") {
          finishReason = chunk.finishReason;
          finishedAt = Date.now();
        }
        yield chunk;
      }
      completed = true;
      if (userSignal?.aborted) {
        status = "cancelled";
      } else if (finishReason == null) {
        // 规范词表要求 finish 是终端事件；缺失说明上游流异常中断（agent 层会重试/报错）
        status = "error";
        errorType = "MissingFinish";
        errorMessage = "LLM stream ended without a finish chunk";
      }
    } catch (error: any) {
      status = streamTc.isIdleTimeout()
        ? "error"
        : userSignal?.aborted
          ? "cancelled"
          : "error";
      errorType = error?.name ?? "Error";
      errorMessage = error?.message ?? String(error);
      throw error;
    } finally {
      // 消费者提前 break / 中止：generator.return() 会进入 finally，记 cancelled
      if (!completed && status === "completed") status = "cancelled";
      this.recordUsage(ctx, {
        status,
        firstTokenAt,
        completedAt: finishedAt,
        usage,
        finishReason,
        errorType,
        errorMessage,
      });
    }
  }

  private async collectNonStream(
    adapterResult: AsyncGenerator<StreamChunk, void, unknown> | StreamChunk[],
    ctx: UsageObservationContext,
    userSignal: AbortSignal | undefined,
    streamTc: StreamTimeoutController,
  ): Promise<LLMCompletionResult> {
    const chunks: StreamChunk[] = [];
    let firstTokenAt: number | null = null;
    try {
      if (Array.isArray(adapterResult)) {
        chunks.push(...adapterResult);
        firstTokenAt = adapterResult.some(isContentChunk) ? Date.now() : null;
      } else {
        for await (const chunk of adapterResult) {
          if (firstTokenAt == null && isContentChunk(chunk)) {
            firstTokenAt = Date.now();
          }
          chunks.push(chunk);
        }
      }

      const blocks = chunks
        .filter(
          (chunk): chunk is Extract<StreamChunk, { type: "block_end" }> =>
            chunk.type === "block_end",
        )
        .map((chunk) => chunk.block);
      const usage =
        chunks
          .filter(
            (chunk): chunk is Extract<StreamChunk, { type: "usage" }> =>
              chunk.type === "usage",
          )
          .pop()?.usage ?? null;
      const finishReason =
        chunks
          .filter(
            (chunk): chunk is Extract<StreamChunk, { type: "finish" }> =>
              chunk.type === "finish",
          )
          .pop()?.finishReason ?? null;
      const content = blocks
        .filter((block): block is Extract<typeof block, { type: "text" }> =>
          block.type === "text",
        )
        .map((block) => block.text)
        .join("");

      const missingFinish = finishReason == null;
      this.recordUsage(ctx, {
        status: userSignal?.aborted
          ? "cancelled"
          : missingFinish
            ? "error"
            : "completed",
        firstTokenAt,
        completedAt: Date.now(),
        usage,
        finishReason,
        errorType: missingFinish && !userSignal?.aborted ? "MissingFinish" : null,
        errorMessage:
          missingFinish && !userSignal?.aborted
            ? "LLM non-stream response ended without a finish chunk"
            : null,
      });
      return { blocks, content, usage: usage ?? undefined, finishReason: finishReason ?? undefined };
    } catch (error: any) {
      const status = streamTc.isIdleTimeout()
        ? "error"
        : userSignal?.aborted
          ? "cancelled"
          : "error";
      this.recordUsage(ctx, {
        status,
        firstTokenAt,
        completedAt: Date.now(),
        usage: null,
        finishReason: null,
        errorType: error?.name ?? "Error",
        errorMessage: error?.message ?? String(error),
      });
      if (streamTc.isIdleTimeout()) {
        throw new UpstreamTimeoutError(
          `Stream idle timeout: no data received for ${streamTc.idleTimeoutMs / 1000}s`,
          error,
        );
      }
      throw error;
    } finally {
      streamTc.clearIdleTimer();
    }
  }

  /** 落账本；任何异常都不得穿透到对话链路 */
  private recordUsage(
    ctx: UsageObservationContext,
    result: UsageObservationResult,
  ): void {
    this.usageService.recordSafely({
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      logicalRequestId: ctx.requestId,
      assistantMessageId: ctx.assistantMessageId,
      attemptIndex: ctx.attemptIndex,
      source: ctx.source,
      providerId: ctx.providerId,
      modelId: ctx.modelId,
      status: result.status,
      startedAt: ctx.startedAt,
      firstTokenAt: result.firstTokenAt,
      completedAt: result.completedAt ?? Date.now(),
      finishReason: result.finishReason,
      usage: result.usage,
      errorType: result.errorType,
      errorMessage: result.errorMessage,
    });
  }
}

/** 首个"真实输出"chunk：usage/finish 不算 TTFT */
function isContentChunk(chunk: StreamChunk): boolean {
  return (
    chunk.type === "text_delta" ||
    chunk.type === "reasoning_delta" ||
    chunk.type === "tool_call_delta" ||
    chunk.type === "block_end"
  );
}
