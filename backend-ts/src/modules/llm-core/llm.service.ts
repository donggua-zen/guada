import { Injectable, Logger } from "@nestjs/common";
import { AdapterRegistry } from "./adapter-registry.service";
import { ModelCapabilityService } from "./model-capability.service";
import { LLMCompletionParams } from "./types/llm.types";
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
    private adapterRegistry: AdapterRegistry,
    private settingsService: SettingsService,
    private capability: ModelCapabilityService,
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
    const thinkingPatch = this.capability.resolveThinkingPatch(
      params.providerConfig?.id,
      params.model,
      thinkingEffort,
    );

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
    const iterator = adapter.chatCompletion({
      ...params,
      messages: sanitizedMessages,
      thinkingEffort,
      thinkingPatch,
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
