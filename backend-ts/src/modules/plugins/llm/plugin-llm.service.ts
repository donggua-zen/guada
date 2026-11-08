import { Injectable, Logger, Optional } from "@nestjs/common";
import type { Message } from "../../../common/types/conversation.types";
import { LLMService } from "../../llm-core/llm.service";
import { ProviderFileStore } from "../../llm-core/provider-file.store";
import { toRuntimeProviderConfig } from "../../llm-core/utils/provider-runtime.util";
import type {
  PluginLlmCompleteOptions,
  PluginLlmModelInfo,
  PluginLlmResult,
  PluginLlmStreamChunk,
} from "../types/plugin.types";

/**
 * 插件 LLM 能力（v3）
 *
 * 目标：让插件复用**用户已配置**的模型与 key，不需要自己管理凭据。
 *
 * 约束：
 * - 不隐式推断"当前会话模型"（多会话并发时会串模型）；调用方必须显式给 `modelId`，
 *   或接受"第一个可用模型"这个确定行为。
 * - `modelId` 给了但不存在 → 明确报错，不静默换模型。
 * - 用量按 `purpose`（默认 `plugin:<id>`）归集，不改用量统计结构。
 */
@Injectable()
export class PluginLlmService {
  private readonly logger = new Logger(PluginLlmService.name);

  constructor(
    @Optional() private readonly llm?: LLMService,
    @Optional() private readonly providerStore?: ProviderFileStore,
  ) {}

  /** 宿主已配置的模型清单（供插件选择） */
  async listModels(): Promise<PluginLlmModelInfo[]> {
    if (!this.providerStore) return [];
    try {
      return this.providerStore.listModels(false).map((model: any) => ({
        id: String(model.id),
        name: String(model.modelName || model.name || model.id),
        providerId: String(model.provider?.id || model.providerId || ""),
        providerName: String(model.provider?.name || model.provider?.id || ""),
        contextWindow: model.config?.contextWindow,
        maxOutputTokens: model.config?.maxOutputTokens,
        features: Array.isArray(model.config?.features) ? model.config.features : undefined,
      }));
    } catch (error: any) {
      this.logger.warn(`listModels failed: ${error?.message ?? error}`);
      return [];
    }
  }

  /** 非流式补全 */
  async complete(
    pluginId: string,
    options: PluginLlmCompleteOptions,
  ): Promise<PluginLlmResult> {
    const resolved = this.resolveModel(pluginId, options.modelId);
    const messages = toMessages(options);
    const result = await this.callCompletions(pluginId, resolved, options, messages, false);

    // LLMService 在 stream=false 时返回 LLMCompletionResult（非 async iterable）
    const typed = result as { content?: string; usage?: any };
    const usage = typed?.usage
      ? {
          promptTokens: typed.usage.promptTokens ?? typed.usage.inputTokens,
          completionTokens: typed.usage.completionTokens ?? typed.usage.outputTokens,
        }
      : undefined;
    return {
      text: String(typed?.content ?? ""),
      model: resolved.modelName,
      usage,
    };
  }

  /** 流式补全：chunk 已归一化为 text / reasoning / finish */
  async *completeStream(
    pluginId: string,
    options: PluginLlmCompleteOptions,
  ): AsyncGenerator<PluginLlmStreamChunk, void, unknown> {
    const resolved = this.resolveModel(pluginId, options.modelId);
    const messages = toMessages(options);
    const stream = await this.callCompletions(pluginId, resolved, options, messages, true);

    for await (const chunk of stream as AsyncGenerator<any, void, unknown>) {
      if (chunk?.type === "text_delta" && chunk.text) {
        yield { type: "text", text: String(chunk.text) };
      } else if (chunk?.type === "reasoning_delta" && chunk.text) {
        yield { type: "reasoning", text: String(chunk.text) };
      } else if (chunk?.type === "finish") {
        yield { type: "finish", finishReason: chunk.finishReason };
      }
    }
  }

  // ── 内部 ──

  private resolveModel(pluginId: string, modelId?: string): any {
    if (!this.providerStore) {
      throw new Error(`plugin ${pluginId}: LLM service is not available in this host build`);
    }
    if (modelId) {
      const found = this.providerStore.findModel(String(modelId));
      if (!found) {
        throw new Error(
          `plugin ${pluginId}: model "${modelId}" is not configured; call listModels() to see available ids`,
        );
      }
      return found;
    }
    const all = this.providerStore.listModels(false);
    if (all.length === 0) {
      throw new Error(
        `plugin ${pluginId}: no model configured; add one in Settings → Model providers`,
      );
    }
    return all[0];
  }

  private async callCompletions(
    pluginId: string,
    model: any,
    options: PluginLlmCompleteOptions,
    messages: Message[],
    stream: boolean,
  ): Promise<unknown> {
    if (!this.llm) {
      throw new Error(`plugin ${pluginId}: LLM service is not available in this host build`);
    }
    const providerConfig = toRuntimeProviderConfig(model.provider);
    return this.llm.completions({
      model: model.modelName,
      system: options.system,
      messages,
      stream,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      providerConfig,
      abortSignal: options.signal,
      purpose: options.purpose || `plugin:${pluginId}`,
    } as any);
  }
}

/** `{role, content}` → 三层 Message[]（只依赖 text 块，adapter 自行映射 wire 形状） */
export function toMessages(options: PluginLlmCompleteOptions): Message[] {
  const list: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const item of options.messages || []) {
    if (!item || typeof item.content !== "string") continue;
    if (item.role !== "user" && item.role !== "assistant") continue;
    list.push({ role: item.role, content: item.content });
  }
  if (typeof options.prompt === "string" && options.prompt.trim()) {
    list.push({ role: "user", content: options.prompt });
  }
  if (list.length === 0) {
    throw new Error("plugin llm: prompt or messages is required");
  }
  return list.map((item, index) => ({
    id: `plugin_msg_${index}`,
    role: item.role,
    kind: item.role,
    source: { kind: item.role === "user" ? "user" : "assistant" } as any,
    metadata: {},
    content: [{ type: "text", text: item.content }],
  })) as Message[];
}
