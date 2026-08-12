import { Injectable, Logger } from "@nestjs/common";
import { ProviderHub } from "./provider-hub.service";
import { IProtocolAdapter } from "./adapters/base.adapter";
import { LLMCompletionParams, MessageRecord } from "./types/llm.types";
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
import {
  SG_SYSTEM,
  SK_SYS_LLM_REQUEST_TIMEOUT_MS,
  SK_SYS_LLM_IDLE_TIMEOUT_MS,
} from "../../constants/settings.constants";

/** Default idle timeout between stream chunks (2 minutes). */
const DEFAULT_IDLE_TIMEOUT_MS = 120_000;

/** Default hard request timeout (10 minutes) — total deadline, includes streaming. */
const DEFAULT_REQUEST_TIMEOUT = 600_000;

@Injectable()
export class LLMService {
  private readonly logger = new Logger(LLMService.name);

  constructor(
    private providerHub: ProviderHub,
    private settingsService: SettingsService,
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
  ): Promise<AsyncGenerator<any, void, unknown> | any> {
    const providerId = params.providerConfig?.provider;
    const protocol = params.providerConfig?.protocol || "openai";

    if (!providerId) {
      throw new Error("Provider ID is required in providerConfig");
    }

    const userSignal = params.abortSignal || RequestContext.abortSignal();

    let provider = this.providerHub.getProvider(providerId);
    let adapter = provider.getAdapter(protocol);

    if (!adapter && providerId === 'custom') {
      this.logger.log(`Custom provider doesn't support ${protocol}, forwarding to official provider`);
      if (protocol === 'gemini') {
        provider = this.providerHub.getProvider('google');
        adapter = provider.getAdapter(protocol);
      }
      if (protocol === 'anthropic') {
        provider = this.providerHub.getProvider('anthropic');
        adapter = provider.getAdapter(protocol);
      }
    }

    this.logger.log(`Using ${protocol} adapter from provider ${provider.id}`);

    if (!adapter) {
      throw new Error(`Provider ${providerId} does not support protocol: ${protocol}`);
    }

    // ===== 思考参数二次校验 =====
    let thinkingEffort = params.thinkingEffort;
    if (thinkingEffort !== undefined) {
      const validEfforts = provider.getModelThinkingEfforts(params.model);
      if (validEfforts.length > 0 && !validEfforts.includes(thinkingEffort)) {
        const nonOffOptions = validEfforts.filter(e => e !== 'none');
        if (thinkingEffort === 'none') {
          thinkingEffort = nonOffOptions.length > 0 ? nonOffOptions[0] : undefined;
          this.logger.log(`thinkingEffort adjusted: 'none' → '${thinkingEffort}' (not supported by model)`);
        } else {
          thinkingEffort = nonOffOptions.length > 0
            ? nonOffOptions[Math.floor(nonOffOptions.length / 2)]
            : undefined;
          this.logger.log(`thinkingEffort adjusted: '${params.thinkingEffort}' → '${thinkingEffort}' (invalid for model)`);
        }
      }
    }

    // 清洗消息
    const sanitizedMessages = params.messages.map((msg) => {
      const sanitized: MessageRecord = { ...msg };
      if (typeof sanitized.content === "string") {
        sanitized.content = removeOrphanSurrogates(sanitized.content);
      } else if (Array.isArray(sanitized.content)) {
        sanitized.content = sanitized.content.map((part) =>
          part.type === "text" && part.text
            ? { ...part, text: removeOrphanSurrogates(part.text) }
            : part,
        );
      }
      if (sanitized.reasoningContent) {
        sanitized.reasoningContent = removeOrphanSurrogates(sanitized.reasoningContent);
      }
      return sanitized;
    });

    // ===== 统一 idle timeout 控制（在 service 层创建，adapter 只需使用 signal） =====
    const idleTimeoutMs = await this.getIdleTimeoutMs();
    const requestTimeoutMs = params.timeout ?? (await this.getRequestTimeoutMs());

    const streamTc = createStreamTimeoutController(
      userSignal,
      idleTimeoutMs,
    );
    streamTc.resetIdleTimer();

    const isStream = params.stream === true;
    const iterator = adapter.chatCompletion({
      ...params,
      messages: sanitizedMessages,
      thinkingEffort,
      abortSignal: streamTc.signal,
      timeout: requestTimeoutMs,
    });

    if (isStream) {
      // 流式：用 withStreamIdleTimeout 包装，每个 chunk 重置 idle timer
      return withStreamIdleTimeout(
        iterator as AsyncGenerator<any, void, unknown>,
        streamTc,
      );
    } else {
      // 非流式：等待单次响应，idle timeout 通过 signal 中止 SDK 请求
      return (async () => {
        try {
          const result = await (iterator as AsyncIterator<any>).next();
          streamTc.clearIdleTimer();
          return result.value;
        } catch (error: any) {
          streamTc.clearIdleTimer();
          if (streamTc.isIdleTimeout()) {
            throw new UpstreamTimeoutError(
              `Stream idle timeout: no data received for ${streamTc.idleTimeoutMs / 1000}s`,
              error,
            );
          }
          throw error;
        }
      })();
    }
  }
}
