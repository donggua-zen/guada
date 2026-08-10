import { Logger } from "@nestjs/common";
import { IProtocolAdapter } from "./base.adapter";
import {
  ProviderConfig,
  ConnectionTestResult,
  RemoteModel,
} from "../types/provider.types";
import {
  MessageRecord,
  LLMCompletionParams,
  LLMResponseChunk,
  ToolCallItem,
} from "../types/llm.types";
import {
  createStreamTimeoutController,
  withStreamIdleTimeout,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
} from "../utils/stream-timeout.util";

/**
 * Mock 适配器 — 用于测试超时、429、网络错误等异常场景
 *
 * 根据模型名控制行为：
 * - mock-normal: 正常流式输出文本
 * - mock-timeout: 接受连接但不发送任何数据（触发 idle timeout）
 * - mock-429: 返回 429 限流错误
 * - mock-network-error: 模拟网络连接失败
 * - mock-error-500: 返回 500 服务器内部错误
 *
 * 模型名可带后缀控制行为变体，如 mock-normal-slow 表示慢速流式输出
 */
export class MockAdapter implements IProtocolAdapter {
  readonly protocol = "openai";
  private readonly logger = new Logger(MockAdapter.name);

  /** 记录每个模型名当前的尝试次数，用于 mock-429-N 行为 */
  private attemptCounters = new Map<string, number>();

  async testConnection(_config: ProviderConfig): Promise<ConnectionTestResult> {
    return { success: true, message: "Mock provider — always connected" };
  }

  async syncRemoteModels(_config: ProviderConfig): Promise<RemoteModel[]> {
    return [];
  }

  async *chatCompletion(
    params: LLMCompletionParams,
  ): AsyncGenerator<LLMResponseChunk> {
    const model = params.model;
    const behavior = this.parseBehavior(model);

    this.logger.log(`Mock adapter called: model=${model}, behavior=${behavior.type}`);

    // 与真实 adapter 一致：创建 idle timeout controller
    const streamTc = createStreamTimeoutController(
      params.abortSignal,
      DEFAULT_STREAM_IDLE_TIMEOUT_MS,
    );
    streamTc.resetIdleTimer();

    try {
      switch (behavior.type) {
        case "normal":
          yield* withStreamIdleTimeout(
            this.simulateNormalStream(behavior.slow),
            streamTc,
          );
          break;

        case "timeout":
          // 模拟服务器接受连接但永不响应
          // idle timeout 会在 createStreamTimeoutController 中触发 abort
          await this.hangForever(streamTc.signal);
          break;

        case "429": {
          // mock-429-N: 前 N 次返回 429，第 N+1 次正常输出（测试重试后恢复）
          const failCount = behavior.attempt ?? 1;
          const current = this.attemptCounters.get(model) ?? 0;
          this.attemptCounters.set(model, current + 1);

          if (current < failCount) {
            this.logger.log(`Mock 429: attempt ${current + 1}/${failCount} (will fail)`);
            throw this.createRateLimitError(current + 1);
          }

          // 达到失败次数后，正常输出并重置计数器
          this.logger.log(`Mock 429: attempt ${current + 1} — recovering with normal response`);
          this.attemptCounters.delete(model);
          yield* withStreamIdleTimeout(
            this.simulateNormalStream(false),
            streamTc,
          );
          break;
        }

        case "network_error":
          throw this.createNetworkError();

        case "error_500":
          throw this.createServerError();

        default:
          yield* withStreamIdleTimeout(
            this.simulateNormalStream(false),
            streamTc,
          );
      }
    } finally {
      streamTc.clearIdleTimer();
    }
  }

  /**
   * 解析模型名，提取行为类型和参数
   *
   * 支持的模型名格式：
   * - mock-normal / mock-normal-slow
   * - mock-timeout
   * - mock-429 / mock-429-3 (第3次才成功，前2次429)
   * - mock-network-error
   * - mock-error-500
   */
  private parseBehavior(
    model: string,
  ): {
    type: "normal" | "timeout" | "429" | "network_error" | "error_500";
    slow?: boolean;
    attempt?: number;
  } {
    const lower = model.toLowerCase();

    if (lower.startsWith("mock-timeout")) {
      return { type: "timeout" };
    }

    if (lower.startsWith("mock-429")) {
      // mock-429-3 = 返回429（测试重试，不会成功）
      const match = lower.match(/mock-429-(\d+)/);
      return { type: "429", attempt: match ? parseInt(match[1], 10) : 1 };
    }

    if (lower.startsWith("mock-network-error")) {
      return { type: "network_error" };
    }

    if (lower.startsWith("mock-error-500")) {
      return { type: "error_500" };
    }

    // 默认正常，支持 -slow 后缀
    return { type: "normal", slow: lower.includes("slow") };
  }

  /**
   * 模拟正常流式输出
   */
  private async *simulateNormalStream(
    slow: boolean,
  ): AsyncGenerator<LLMResponseChunk> {
    const text = "这是一条来自 Mock 供应商的测试消息。用于验证流式输出、超时重试等机制是否正常工作。";
    const chunks = text.split("");

    for (const char of chunks) {
      yield {
        type: "text",
        content: char,
        reasoningContent: null,
        finishReason: null,
        toolCalls: undefined,
        usage: null,
      };

      if (slow) {
        await new Promise((r) => setTimeout(r, 100));
      } else {
        await new Promise((r) => setTimeout(r, 20));
      }
    }

    // 发送 finish chunk
    yield {
      type: "finish",
      content: null,
      reasoningContent: null,
      finishReason: "stop",
      toolCalls: undefined,
      usage: {
        promptTokens: 10,
        completionTokens: 30,
        totalTokens: 40,
      },
    };
  }

  /**
   * 模拟服务器挂起 — 永不返回数据
   * idle timeout 会在 stream-timeout.util.ts 中触发 abort
   */
  private async hangForever(abortSignal?: AbortSignal): Promise<void> {
    return new Promise((_, reject) => {
      if (abortSignal) {
        abortSignal.addEventListener("abort", () => {
          reject(new Error("LLM stream idle timeout"));
        }, { once: true });
      }
      // 不 resolve，不 reject（除非被 abort）
      // idle timeout controller 会触发 abort
    });
  }

  /**
   * 创建 429 限流错误（带 Retry-After header）
   */
  private createRateLimitError(_attempt: number): Error {
    const error: any = new Error("429 Too Many Requests");
    error.status = 429;
    error.statusCode = 429;
    error.name = "APIError";
    error.headers = {
      "retry-after": "2",
      "retry-after-ms": "2000",
    };
    return error;
  }

  /**
   * 创建网络错误
   */
  private createNetworkError(): Error {
    const error: any = new Error("fetch failed: connect ECONNREFUSED 127.0.0.1:443");
    error.code = "ECONNREFUSED";
    error.name = "Error";
    return error;
  }

  /**
   * 创建 500 服务器内部错误
   */
  private createServerError(): Error {
    const error: any = new Error("Internal Server Error");
    error.status = 500;
    error.statusCode = 500;
    error.name = "APIError";
    return error;
  }
}
