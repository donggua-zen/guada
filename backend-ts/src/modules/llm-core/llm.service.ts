import { Injectable, Logger } from "@nestjs/common";
import { ProviderHub } from "./provider-hub.service";
import { IProtocolAdapter } from "./adapters/base.adapter";
import { LLMCompletionParams, MessageRecord } from "./types/llm.types";
import { RequestContext } from "../../common/context/request-context";
import { removeOrphanSurrogates } from "../../common/utils/string.utils";

@Injectable()
export class LLMService {
  private readonly logger = new Logger(LLMService.name);

  constructor(
    private providerHub: ProviderHub,
  ) {}

  /**
   * 统一的补全执行方法（支持流式和非流式）
   * 
   * 如果调用方没有传入 abortSignal，会尝试从 AsyncLocalStorage 上下文中获取。
   * 这样内部服务调用时无需显式传递 abortSignal，减少代码侵入性。
   */
  completions(
    params: LLMCompletionParams,
  ): Promise<any> | AsyncGenerator<any, void, unknown> {
    const providerId = params.providerConfig?.provider;
    const protocol = params.providerConfig?.protocol || "openai";
    
    if (!providerId) {
      throw new Error("Provider ID is required in providerConfig");
    }
    
    // 如果调用方没有传入 abortSignal，尝试从上下文获取
    const abortSignal = params.abortSignal || RequestContext.abortSignal();
    
    // 通过 ProviderHub 获取供应商
    let provider = this.providerHub.getProvider(providerId);
    
    // 通过供应商的 getAdapter 方法获取适配器
    let adapter = provider.getAdapter(protocol);
    
    // 如果 CustomProvider 不支持该协议（如 gemini），转发到对应的官方供应商
    if (!adapter && providerId === 'custom') {
      this.logger.log(`Custom provider doesn't support ${protocol}, forwarding to official provider`);
      
      // gemini 协议转发到 Google 供应商
      if (protocol === 'gemini') {
        provider = this.providerHub.getProvider('google');
        adapter = provider.getAdapter(protocol);
      }
      // anthropic 协议转发到 Anthropic 供应商
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
    // 前端传值可能不可靠（如模型切换后旧值失效），此处做安全兜底
    let thinkingEffort = params.thinkingEffort;
    if (thinkingEffort !== undefined) {
      const validEfforts = provider.getModelThinkingEfforts(params.model);
      if (validEfforts.length > 0 && !validEfforts.includes(thinkingEffort)) {
        // 当前值不在合法选项中，需要纠正
        const nonOffOptions = validEfforts.filter(e => e !== 'none');

        if (thinkingEffort === 'none') {
          // 原来是 off 但新模型不支持 → 取最小档位
          thinkingEffort = nonOffOptions.length > 0
            ? nonOffOptions[0]
            : undefined;
          this.logger.log(`thinkingEffort adjusted: 'none' → '${thinkingEffort}' (not supported by model)`);
        } else {
          // 原来的非 off 值失效 → 取中间值
          thinkingEffort = nonOffOptions.length > 0
            ? nonOffOptions[Math.floor(nonOffOptions.length / 2)]
            : undefined;
          this.logger.log(`thinkingEffort adjusted: '${params.thinkingEffort}' → '${thinkingEffort}' (invalid for model)`);
        }
      }
    }

    // 清洗消息中的孤立代理字符，防止 JSON 序列化产生无效转义导致 API 400
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

    const isStream = params.stream === true;
    const iterator = adapter.chatCompletion({
      ...params,
      messages: sanitizedMessages,
      thinkingEffort, // 使用校验后的值覆盖原始值
      abortSignal, // 使用合并后的信号
    });

    if (isStream) {
      return iterator as AsyncGenerator<any, void, unknown>;
    } else {
      return (async () => {
        const result = await (iterator as AsyncIterator<any>).next();
        return result.value;
      })();
    }
  }
}
