import { Injectable, Logger } from "@nestjs/common";
import {
  OpenAI,
  APIConnectionError,
  APIConnectionTimeoutError,
} from "openai";
import { IProtocolAdapter } from "./base.adapter";
import { ModelCapabilityService } from '../model-capability.service';
import {
  LLMCompletionParams,
  StreamChunk,
  StreamUsage,
} from "../types/llm.types";
import type { Message, ContentBlock } from "../../../common/types/conversation.types";
import { logPreview } from "../../../common/utils/log-preview.util";
import { ToolDefinition } from "../../tools/interfaces/tool-provider.interface";
import { insecureFetch } from "../utils/tls.util";
import { withRequestBodyCompression } from "../utils/compression.util";
import { applyJsonMergePatch } from "../thinking/json-merge-patch";
import { attachmentToPart, fileBlockToText } from "../utils/attachment.util";
import { assertNoImageContent } from "../utils/content.util";
import { StreamBlockTracker } from "../utils/block-lifecycle.util";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
} from "../utils/stream-timeout.util";
import {
  UpstreamRateLimitError,
  UpstreamNetworkError,
  UpstreamRequestError,
  UpstreamStreamTruncatedError,
  UpstreamTimeoutError,
} from "../utils/upstream-errors";
import { getRetryAfterFromError } from "../utils/retry.util";
import { createAbortError } from "../utils/abort-error.util";
import { normalizeTransportError } from "../utils/retry-on-error.util";
import {
  ProviderConfig,
  ConnectionTestResult,
  RemoteModel,
} from "../types/provider.types";
import { resolveEffectiveThinkingCompat } from "./openai.adapter";

/**
 * OpenAI Responses API 适配器
 *
 * 基于 OpenAI Responses API（beta）实现，采用无状态设计，每次调用创建新客户端实例
 * 与 Chat Completions API 相比，Responses API 使用不同的事件格式和数据结构
 * 支持推理内容流式输出、工具调用增量累积等高级特性
 *
 * Provider quirks（本协议私有的兼容细节，新增兼容时在此登记）：
 * 1. 扁平 item 数组输入：message / function_call / function_call_output 三种 item，
 *    tool 结果经 call_id 关联（无 role=tool 概念）。
 * 2. 单个 input_text 时 content 收敛为字符串；空内容且无 function_call 的消息跳过。
 * 3. usage 兼容 prompt_cache_hit_tokens（与 openai adapter 同口径）。
 * 4. 图片：input_image 支持 data URL 与远程 URL。
 *
 * 职责边界：内容归一化（图片投影/reasoning 策略）在 L1 管线完成；本文件只做
 * wire 映射 + fail-loud 断言（见 docs/message-pipeline-normalization-plan.md）。
 */
// @Injectable() 不可省：emitDecoratorMetadata 只在类上有装饰器时才产出
// design:paramtypes，否则 Nest 会以零参数构造，capability 静默为 undefined
@Injectable()
export class OpenAIResponseAdapter implements IProtocolAdapter {
  readonly protocol = "openai-response";
  readonly displayName = "OpenAI Responses";
  readonly capabilities = {
    streaming: true,
    tools: true,
    vision: true,
    reasoning: true,
    promptCaching: true,
    modelDiscovery: true,
  };

  constructor(private readonly capability: ModelCapabilityService) {}

  private readonly logger = new Logger(OpenAIResponseAdapter.name);

  /**
   * 测试 OpenAI Responses API 连接
   */
  async testConnection(config: ProviderConfig): Promise<ConnectionTestResult> {
    try {
      const client = this.createClient(config);
      // 使用轻量级请求测试连接
      await client.responses.create({
        model: "gpt-4o-mini",
        input: "test",
      });
      return {
        success: true,
        message: "连接成功",
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message?.includes("401")
          ? "API Key 无效"
          : `连接失败: ${error.message}`,
        details: error,
      };
    }
  }

  /**
   * 从 OpenAI 兼容 API 同步模型列表
   * 部分第三方服务可能不支持 /v1/models，此时返回空列表
   */
  async syncRemoteModels(config: ProviderConfig): Promise<RemoteModel[]> {
    try {
      const client = this.createClient(config);
      const response = await client.models.list();
      return response.data.map((model) => ({
        id: model.id,
        created: model.created,
        owned_by: model.owned_by,
      }));
    } catch (error: any) {
      this.logger.warn(
        `Failed to sync remote models (API may not support /v1/models): ${error.message}`,
      );
      return [];
    }
  }

  async *chatCompletion(
    params: LLMCompletionParams,
  ): AsyncGenerator<StreamChunk> {
    // fail-loud 最终防线：L1 管线绕过时，图片不得静默发给纯文本模型
    assertNoImageContent(
      params.messages,
      params.modelCapabilities?.supportsImageInput,
      this.protocol,
      params.model,
    );

    const client = this.createClient(params.providerConfig);
    const formattedInput = await this.formatInput(params.messages, params.system);
    const requestParams = this.buildRequestParam(params, formattedInput);

    // 条目 thinkingEffortsPatch：拼装完成后整体打 patch（RFC 7386，patch 优先）
    const finalRequestParams = params.thinkingPatch
      ? applyJsonMergePatch(requestParams, params.thinkingPatch)
      : requestParams;

    const requestTimeout = params.timeout ?? DEFAULT_REQUEST_TIMEOUT_MS;

    let response: any = null;

    try {
      // 单次尝试，重试由 AgentEngine 统一处理
      response = await client.responses.create(finalRequestParams, {
        signal: params.abortSignal,
        timeout: requestTimeout,
      });

      if (params.stream) {
        yield* this.handleStreamResponse(response, params.abortSignal);
      } else {
        yield* this.handleNonStreamResponse(response);
      }
    } catch (error) {
      this.logger.error(
        `LLM Responses API error (${params.stream ? "stream" : "non-stream"}):`,
        error,
      );
      this.handleError(error, params.stream);
    } finally {
      this.cleanup(response);
    }
  }

  /**
   * 创建 OpenAI 客户端实例
   */
  private createClient(providerConfig: any) {
    return new OpenAI({
      baseURL: providerConfig?.apiUrl || process.env.OPENAI_BASE_URL,
      apiKey:
        providerConfig?.apiKey ||
        process.env.OPENAI_API_KEY ||
        "sk-placeholder",
      // 请求体压缩（通用传输能力，按供应商配置启用：实例 > 类型卡）
      fetch: providerConfig?.requestCompression
        ? withRequestBodyCompression(insecureFetch)
        : insecureFetch,
      timeout: DEFAULT_REQUEST_TIMEOUT_MS,
      maxRetries: 0, // 禁用 SDK 内置重试，由 AgentEngine 统一处理重试
    });
  }

  /**
   * 将内部三层消息格式转换为 Responses API 输入格式
   *
   * Responses API 使用扁平化的 item 数组结构，支持 message、function_call、function_call_output 三种类型
   * 工具调用结果通过 function_call_output 类型传递，需要关联 call_id
   * 多模态内容（文本、图片）统一映射为 input_text 和 input_image 类型
   */
  private async formatInput(messages: Message[], system?: string): Promise<any[]> {
    const items: any[] = [];
    // Responses API：system 以首条 message item 形式出现（无 system 时不插）
    if (system) {
      items.push({ type: "message", role: "system", content: system });
    }

    for (const msg of messages) {
      // tool 结果消息（source.kind === 'tool'）→ function_call_output
      if (msg.source.kind === "tool") {
        const tr = msg.content.find(
          (b): b is Extract<ContentBlock, { type: "tool-result" }> =>
            b.type === "tool-result",
        );
        items.push({
          type: "function_call_output",
          call_id: msg.source.toolCallId,
          output: tr?.content ?? "",
        });
        continue;
      }

      const baseMessage: any = {
        type: "message",
        role: msg.role === "assistant" ? "assistant" : "user",
      };

      // 按 ContentBlock 块拆分 content
      const contentParts: any[] = [];
      for (const block of msg.content) {
        if (block.type === "text") {
          if (block.text) contentParts.push({ type: "input_text", text: block.text });
        } else if (block.type === "image") {
          // 统一助手解析字节（本地文件带 LRU 缓存），此处只做协议映射；
          // 传整个附件对象：attachmentToPart 按 refType 分派物理路径。
          const part = await attachmentToPart(
            block.attachment,
            block.attachment.mediaType,
          );
          if (part?.kind === "base64") {
            contentParts.push({
              type: "input_image",
              image_url: `data:${part.mimeType};base64,${part.base64}`,
              detail: "auto",
            });
          } else if (part?.kind === "url") {
            contentParts.push({
              type: "input_image",
              image_url: part.url,
              detail: "auto",
            });
          }
        } else if (block.type === "file") {
          contentParts.push({
            type: "input_text",
            text: fileBlockToText(block.attachment),
          });
        }
      }
      if (contentParts.length === 1 && contentParts[0].type === "input_text") {
        baseMessage.content = contentParts[0].text;
      } else if (contentParts.length > 0) {
        baseMessage.content = contentParts;
      } else {
        baseMessage.content = "";
      }

      // tool-call 块 → function_call items
      const toolCalls = msg.content.filter(
        (b): b is Extract<ContentBlock, { type: "tool-call" }> =>
          b.type === "tool-call",
      );

      // 跳过空内容且无工具调用的消息
      if (baseMessage.content === "" && toolCalls.length === 0) {
        continue;
      }

      if (baseMessage.content !== "" || toolCalls.length === 0) {
        items.push(baseMessage);
      }

      for (const tc of toolCalls) {
        items.push({
          type: "function_call",
          call_id: tc.toolCallId,
          name: tc.name,
          arguments: tc.arguments,
        });
      }
    }

    return items;
  }

  /**
   * 构建请求参数并注入供应商特定配置（可被子类覆盖）
   *
   * 根据模型特性动态注入 thinking 配置，仅当供应商声明支持且模型配置包含 thinking 特性时才启用
   * Responses API 使用 max_output_tokens 替代 max_tokens，其他参数保持兼容
   */
  protected buildRequestParam(params: any, formattedInput: any[]) {
    const requestParams: any = {
      model: params.model,
      input: formattedInput,
      stream: params.stream,
    };

    Object.assign(requestParams, params.extraBody || {});

    if (params.temperature !== undefined && params.temperature !== null) {
      requestParams.temperature = params.temperature;
    }
    if (params.topP !== undefined && params.topP !== null) {
      requestParams.top_p = params.topP;
    }
    if (
      params.frequencyPenalty !== undefined &&
      params.frequencyPenalty !== null
    ) {
      requestParams.frequency_penalty = params.frequencyPenalty;
    }
    if (params.maxTokens !== undefined && params.maxTokens !== null) {
      requestParams.max_output_tokens = params.maxTokens;
    }

    if (params.tools?.length) {
      requestParams.tools = this.convertTools(params.tools);
      requestParams.tool_choice = "auto";
    }

    // 处理思考强度（对齐 DSH/pi-ai 的 openai-responses 分派）：
    // - 强度档（非 none/on）→ reasoning:{effort: 映射值 ?? 档位名}
    // - 关闭（none，且模型声明可关）→ reasoning:{effort: off 映射值 ?? 'none'}
    //   Responses 协议没有独立开关字段，"关闭"就是一个 effort 值；
    //   不提供 thinkingFormat（DSH 的 responses 门控不含它）。
    // 拼法表达式接管时（thinkingPatchReplacesFormat）跳过内置写入，完全由表达式输出决定
    const compat = resolveEffectiveThinkingCompat(params.providerConfig);
    if (!params.thinkingPatchReplacesFormat) {
      if (params.thinkingEffort === 'none') {
        const off = this.capability.resolveThinkingOff(
          params.providerConfig?.id,
          params.model,
        );
        if (off.supported) {
          requestParams.reasoning = { effort: off.wire ?? 'none' };
        }
      } else if (
        params.thinkingEffort &&
        params.thinkingEffort !== 'on'
      ) {
        // OpenAI Responses API 使用 reasoning.effort 参数；
        // wire 值向能力服务查（缺省=档位名）
        requestParams.reasoning = {
          effort:
            this.capability.resolveThinkingWireValue(
              params.providerConfig?.id,
              params.model,
              params.thinkingEffort,
            ) ?? params.thinkingEffort,
        };
      }
      if (compat.includeEncryptedReasoning) {
        requestParams.include = ["reasoning.encrypted_content"];
      }
    }

    return requestParams;
  }

  /**
   * 将内部扁平化工具定义转换为 OpenAI Responses API 格式
   */
  private convertTools(tools: ToolDefinition[]): any[] {
    return tools.map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }

  /**
   * 处理流式响应事件流 → 规范 StreamChunk 词表
   *
   * Responses API 的事件流映射：
   * - output_text.delta → text_delta；reasoning_*.delta → reasoning_delta
   * - output_item.added(function_call) 记录元信息并开块（id/name 首发携带）
   * - function_call_arguments.delta → tool_call_delta（火山引擎等厂商 delta 不带 call_id/name，靠 item_id 关联）
   * - completed/failed 收尾统一补发 block_end* → usage → finish
   */
  private async *handleStreamResponse(
    response: any,
    abortSignal?: AbortSignal,
  ): AsyncGenerator<StreamChunk> {
    const tracker = new StreamBlockTracker();
    let pendingFinish: string | null = null;
    let pendingUsage: StreamUsage | null = null;
    /** 是否收到过上游终止事件（completed/incomplete/failed）。
     * 没收到就结束 = 上游没发收尾事件，需进一步判断内容是否已收齐。 */
    let sawTerminal = false;
    /** 最后一个上游事件类型（含非内容事件，仅诊断用） */
    let lastEventType = "";
    /** 最后一个「内容事件」类型：忽略 created/in_progress/metadata 这类信封事件。
     * 用于区分「内容已收齐只是缺 completed」与「真截断」。 */
    let lastContentEventType = "";

    // 每工具一条 lane。并发 function_call 不能共用一个“当前工具”指针：
    // output_index 是 Responses 流里 added/done/delta 都稳定携带的关联键
    //（@ai-sdk/openai 亦以 output_index 建 ongoingToolCalls 表）；item.id/call_id 作别名。
    type ToolLane = {
      callId: string;
      name: string;
      index: number;
      outputIndex?: number;
      itemId: string;
      /** 已从 function_call_arguments.delta 累积的参数文本 */
      args: string;
      /** 来自 output_item.added / done / completed 的完整参数候选 */
      candidateArgs: string;
      /** 已由终态事件（done/completed）定型，重复事件不再追加 */
      finalized: boolean;
      /** 参数是否收齐：仅当收到终态载体（arguments.done / output_item.done /
       *  completed.output[]）才为 true。只有 delta 的 lane 可能是半截 JSON。 */
      complete: boolean;
    };
    const lanes: ToolLane[] = [];
    const byItemId = new Map<string, ToolLane>();
    const byOutputIndex = new Map<number, ToolLane>();
    const byCallId = new Map<string, ToolLane>();
    /** added 之前到达的 delta：item_id/output_index → 片段列表（不再静默丢弃） */
    const pendingDeltas = new Map<string, string[]>();
    /** done 先于 added 到达时的完整参数，待 added 建 lane 后回填 */
    const pendingFinalArgs = new Map<string, string>();
    let toolCallCounter = 0;

    const pendingKey = (itemId?: string, outputIndex?: number): string =>
      itemId ? `id:${itemId}` : `idx:${typeof outputIndex === "number" ? outputIndex : ""}`;

    const register = (lane: ToolLane): void => {
      if (lane.itemId) byItemId.set(lane.itemId, lane);
      if (typeof lane.outputIndex === "number") byOutputIndex.set(lane.outputIndex, lane);
      if (lane.callId) byCallId.set(lane.callId, lane);
    };

    const findLane = (
      itemId?: string,
      outputIndex?: number,
      callId?: string,
    ): ToolLane | undefined => {
      if (itemId) {
        const lane = byItemId.get(itemId);
        if (lane) return lane;
      }
      if (typeof outputIndex === "number") {
        const lane = byOutputIndex.get(outputIndex);
        if (lane) return lane;
      }
      if (callId) return byCallId.get(callId);
      return undefined;
    };

    const createLane = (
      item: any,
      outputIndex?: number,
    ): { lane: ToolLane; chunks: StreamChunk[] } => {
      const itemId = typeof item?.id === "string" ? item.id : "";
      const callId =
        typeof item?.call_id === "string" && item.call_id
          ? item.call_id
          : itemId || `call_${toolCallCounter}`;
      const lane: ToolLane = {
        callId,
        name: typeof item?.name === "string" ? item.name : "",
        index: toolCallCounter++,
        outputIndex: typeof outputIndex === "number" ? outputIndex : undefined,
        itemId,
        args: "",
        candidateArgs: "",
        finalized: false,
        complete: false,
      };
      lanes.push(lane);
      register(lane);
      return {
        lane,
        // 首帧带 id/name；参数随后由 delta/终态事件补
        chunks: tracker.toolCallDelta(lane.index, {
          toolCallId: lane.callId,
          name: lane.name,
        }),
      };
    };

    const appendArgs = (lane: ToolLane, delta: string): StreamChunk[] => {
      if (!delta) return [];
      lane.args += delta;
      return tracker.toolCallDelta(lane.index, { argumentsDelta: delta });
    };

    // 完整参数回填：已有参数是完整参数前缀时只补后缀（防重复拼接）；
    // 终态参数比已累积的短（说明 delta 已完整）则不覆盖；两者不一致也不覆盖，
    // 避免乱序/重复事件把 JSON 拼坏。
    //
    // 只要走到这里，就说明上游给了终态载体（arguments.done / output_item.done /
    // completed.output[]），参数视为收齐。
    const backfillArgs = (lane: ToolLane, fullArgs: string): StreamChunk[] => {
      if (!fullArgs) return [];
      lane.complete = true;
      if (lane.finalized) return [];
      if (!lane.args) {
        lane.args = fullArgs;
        lane.finalized = true;
        return tracker.toolCallDelta(lane.index, { argumentsDelta: fullArgs });
      }
      if (fullArgs.startsWith(lane.args)) {
        const suffix = fullArgs.slice(lane.args.length);
        lane.args = fullArgs;
        lane.finalized = true;
        return suffix
          ? tracker.toolCallDelta(lane.index, { argumentsDelta: suffix })
          : [];
      }
      if (lane.args.startsWith(fullArgs)) {
        lane.finalized = true;
        return [];
      }
      lane.finalized = true;
      this.logger.warn(
        `[responses.tool] ${lane.callId || "?"} final arguments mismatch accumulated prefix ` +
          `(${lane.args.length}/${fullArgs.length} chars); keep accumulated`,
      );
      return [];
    };

    // delta/done 可能先按 output_index 缓存、added 到达后才有 item.id；
    // 回放时两种键都要查，否则早到片段会丢。
    const takePending = <T>(
      map: Map<string, T>,
      lane: ToolLane,
    ): T | undefined => {
      const keys = [
        pendingKey(lane.itemId, lane.outputIndex),
        pendingKey(undefined, lane.outputIndex),
      ];
      for (const key of keys) {
        if (!map.has(key)) continue;
        const value = map.get(key) as T;
        map.delete(key);
        return value;
      }
      return undefined;
    };

    const flushPending = (lane: ToolLane): StreamChunk[] => {
      const chunks: StreamChunk[] = [];
      const deltas = takePending(pendingDeltas, lane);
      if (deltas) {
        for (const delta of deltas) chunks.push(...appendArgs(lane, delta));
      }
      const finalArgs = takePending(pendingFinalArgs, lane);
      if (finalArgs) {
        chunks.push(...backfillArgs(lane, finalArgs));
      }
      return chunks;
    };

    const handleAdded = (item: any, outputIndex?: number): StreamChunk[] => {
      if (!item || item.type !== "function_call") return [];
      let lane = findLane(
        typeof item.id === "string" ? item.id : undefined,
        outputIndex,
        typeof item.call_id === "string" ? item.call_id : undefined,
      );
      let chunks: StreamChunk[] = [];
      if (!lane) {
        const created = createLane(item, outputIndex);
        lane = created.lane;
        chunks = created.chunks;
      } else {
        if (!lane.itemId && typeof item.id === "string") lane.itemId = item.id;
        if (!lane.callId && typeof item.call_id === "string") lane.callId = item.call_id;
        if (!lane.name && typeof item.name === "string" && item.name) {
          lane.name = item.name;
          // added 之前已建 lane（done 先到）时，名字在这里补发给块头
          chunks.push(...tracker.toolCallDelta(lane.index, { name: lane.name }));
        }
        if (typeof outputIndex === "number" && typeof lane.outputIndex !== "number") {
          lane.outputIndex = outputIndex;
        }
        register(lane);
      }
      // 少数上游把完整参数直接放在 added.item.arguments；先存候选，终态再回填，
      // 避免与后续 delta 重复拼接。
      if (typeof item.arguments === "string" && item.arguments && !lane.args && !lane.candidateArgs) {
        lane.candidateArgs = item.arguments;
      }
      chunks.push(...flushPending(lane));
      return chunks;
    };

    const handleDelta = (
      itemId: string | undefined,
      outputIndex: number | undefined,
      delta: string,
    ): StreamChunk[] => {
      if (!delta) return [];
      const lane = findLane(itemId, outputIndex);
      if (!lane) {
        // delta 早于 output_item.added：按 item_id/output_index 缓存，added 到达后回放
        const key = pendingKey(itemId, outputIndex);
        const buffered = pendingDeltas.get(key) ?? [];
        buffered.push(delta);
        pendingDeltas.set(key, buffered);
        return [];
      }
      return appendArgs(lane, delta);
    };

    const handleFinal = (
      itemId: string | undefined,
      outputIndex: number | undefined,
      callId: string | undefined,
      fullArgs: string,
      item?: any,
    ): StreamChunk[] => {
      let lane = findLane(itemId, outputIndex, callId);
      const chunks: StreamChunk[] = [];
      if (!lane) {
        if (item) {
          const created = createLane(item, outputIndex);
          lane = created.lane;
          chunks.push(...created.chunks);
        } else {
          pendingFinalArgs.set(pendingKey(itemId, outputIndex), fullArgs);
          return chunks;
        }
      }
      // 名字可能只在终态 item 上出现（added 缺省），补发块头
      if (item && !lane.name && typeof item.name === "string" && item.name) {
        lane.name = item.name;
        chunks.push(...tracker.toolCallDelta(lane.index, { name: lane.name }));
      }
      chunks.push(...flushPending(lane));
      chunks.push(...backfillArgs(lane, fullArgs));
      return chunks;
    };

    // response.completed/incomplete/failed 的 output[] 是最后兜底：只出现在这里的
    // function_call 参数（有些中转不在流中发 done）也在此补齐。
    const handleOutputArray = (output: any): StreamChunk[] => {
      const chunks: StreamChunk[] = [];
      if (!Array.isArray(output)) return chunks;
      // 终态 response.output[] 的数组下标即 output_index（item 本身通常不再带该字段）
      output.forEach((item, arrayIndex) => {
        if (!item || item.type !== "function_call") return;
        chunks.push(
          ...handleFinal(
            typeof item.id === "string" ? item.id : undefined,
            typeof item.output_index === "number" ? item.output_index : arrayIndex,
            typeof item.call_id === "string" ? item.call_id : undefined,
            typeof item.arguments === "string" ? item.arguments : "",
            item,
          ),
        );
      });
      return chunks;
    };

    for await (const event of response) {
      if (typeof event?.type === "string") {
        lastEventType = event.type;
        // 只把「内容事件」纳入完成判定：created/in_progress/metadata 等信封
        // 事件不代表内容推进，不能用来判定是否收齐。
        if (
          event.type.startsWith("response.output_") ||
          event.type.startsWith("response.function_call_arguments.") ||
          event.type.startsWith("response.reasoning") ||
          event.type.startsWith("response.content_part.")
        ) {
          lastContentEventType = event.type;
        }
      }
      switch (event.type) {
        case "response.output_text.delta":
          for (const c of tracker.textDelta(event.delta)) yield c;
          continue;

        case "response.output_text.done":
        case "response.reasoning_text.done":
        case "response.reasoning_summary_text.done":
          continue;

        case "response.reasoning_text.delta":
        case "response.reasoning_summary_text.delta":
          for (const c of tracker.reasoningDelta(event.delta)) yield c;
          continue;

        case "response.output_item.added":
          for (const c of handleAdded(event.item, event.output_index)) yield c;
          continue;

        case "response.function_call_arguments.delta":
          for (const c of handleDelta(event.item_id, event.output_index, event.delta)) yield c;
          continue;

        case "response.function_call_arguments.done":
          // 标准 Responses 事件：完整 arguments 在此；旧实现直接忽略是空参数根因之一
          for (const c of handleFinal(
            event.item_id,
            event.output_index,
            undefined,
            typeof event.arguments === "string" ? event.arguments : "",
          )) {
            yield c;
          }
          continue;

        case "response.output_item.done":
          if (event.item?.type === "function_call") {
            for (const c of handleFinal(
              typeof event.item.id === "string" ? event.item.id : undefined,
              event.output_index,
              typeof event.item.call_id === "string" ? event.item.call_id : undefined,
              typeof event.item.arguments === "string" ? event.item.arguments : "",
              event.item,
            )) {
              yield c;
            }
          }
          continue;

        case "response.completed":
        case "response.incomplete":
          sawTerminal = true;
          for (const c of handleOutputArray(event.response?.output)) yield c;
          pendingFinish =
            event.type === "response.incomplete" &&
            event.response?.incomplete_details?.reason === "max_output_tokens"
              ? "length"
              : "stop";
          if (event.response?.usage) {
            pendingUsage = {
              promptTokens: event.response.usage.input_tokens,
              completionTokens: event.response.usage.output_tokens,
              totalTokens: event.response.usage.total_tokens,
              cachedTokens: extractOpenAICachedTokens(event.response.usage),
            };
          }
          continue;

        case "response.failed":
          sawTerminal = true;
          for (const c of handleOutputArray(event.response?.output)) yield c;
          this.logger.error(`Response failed: ${event.error?.message}`);
          pendingFinish = "error";
          continue;

        default:
          continue;
      }
    }

    // 收尾前回填只出现在 added/done 候选里的参数；仍为空的打诊断日志（不改变
    // 下游 {} 兜底语义，但下次可直接从日志看到是哪个 call 没收到参数）。
    for (const lane of lanes) {
      if (lane.candidateArgs) {
        for (const c of backfillArgs(lane, lane.candidateArgs)) yield c;
      }
      // 适配器出口的最终参数：与 BlockAssembler/agent-engine 的 [tool-args]
      // 日志对照，可判断模型流本身是否就没给参数。
      this.logger.log(
        `[responses.tool] final call_id=${lane.callId || "?"} name=${lane.name || "?"} ` +
          `output_index=${lane.outputIndex ?? "?"} argsLen=${lane.args.length} ` +
          `complete=${lane.complete} args=${logPreview(lane.args)}`,
      );
      if (!lane.args) {
        this.logger.warn(
          `[responses.tool] ${lane.callId || "?"} (${lane.name || "?"}, ` +
            `output_index=${lane.outputIndex ?? "?"}) finished with empty arguments`,
        );
      }
    }

    // 工具块闭合时带上参数完整性标记：下游据此拒绝执行半截参数。
    const closeAllChunks = (): StreamChunk[] => {
      const chunks = tracker.closeAll();
      for (const c of chunks) {
        if (c.type !== "block_end" || c.block?.type !== "tool-call") continue;
        const lane = c.block.toolCallId ? byCallId.get(c.block.toolCallId) : undefined;
        if (lane) c.block.argumentsComplete = lane.complete;
      }
      return chunks;
    };

    // 没有终止事件就结束了。这里不能再一刀切判截断——实测上游（兼容站）会
    // 间歇性省略 response.completed，但内容其实已经收齐（所有工具都收到
    // output_item.done / function_call_arguments.done，最后事件是 *_done）。
    // 误判会让完整回答被打成"网络中断"，用户看到明明写完的内容报错。
    //
    // 判定改为「内容是否收齐」：
    //   1. 有任一工具参数未收齐（只见过 delta/added）→ 真截断
    //   2. 全部收齐，且最后事件是 *_done → 内容完整，只是上游漏发 completed → 按成功收尾
    //   3. 全部收齐，但最后事件仍是 *_delta / output_item.added → 正文可能写到一半 → 真截断
    if (!sawTerminal) {
      // 先闭合块（携带完整性标记），让组装器拿到带 argumentsComplete 的权威块
      const closed = closeAllChunks();
      for (const c of closed) yield c;
      // 用户主动中止优先：SDK 被 abort 时 for-await 会"干净"结束，
      // 若先判截断会触发自动重试，违背用户意图。
      if (abortSignal?.aborted) {
        throw createAbortError("LLM stream aborted by user");
      }

      const incompleteTools = lanes.filter((l) => !l.complete);
      const lastIsDone = /\.(done|completed)$/.test(lastContentEventType);
      const hasVisibleContent = closed.some(
        (c) =>
          (c.type === "block_end" && c.block?.type === "tool-call") ||
          (c.type === "block_end" && c.block?.type === "text") ||
          (c.type === "block_end" && c.block?.type === "reasoning"),
      );

      if (incompleteTools.length === 0 && lastIsDone) {
        // 内容已收齐，上游只是没发 response.completed：按正常完成收尾，
        // 保留 usage 缺失（上游没给），只打 warn 供排查上游行为。
        this.logger.warn(
          `[responses.stream] ended without terminal event but content complete ` +
            `(last=${lastContentEventType || "?"}, tools=${lanes.length}); treating as stop`,
        );
        if (pendingUsage) {
          yield { type: "usage", usage: pendingUsage };
        }
        yield { type: "finish", finishReason: "stop" };
        return;
      }

      // 没有可见内容、也没有收齐的工具：上游什么都没给就断了，按截断处理
      // （上层据此重试）。
      const toolSummary = lanes
        .map((l) => `${l.name || "?"}:${l.args.length}${l.complete ? "" : "!"}`)
        .join(",");
      this.logger.warn(
        `[responses.stream] ended without terminal event ` +
          `(last=${lastContentEventType || lastEventType || "?"}, tools=[${toolSummary}], ` +
          `incomplete=${incompleteTools.length}, visible=${hasVisibleContent})`,
      );
      throw new UpstreamStreamTruncatedError(
        `Responses stream ended without terminal event ` +
          `(last=${lastContentEventType || lastEventType || "?"}, tools=[${toolSummary}])`,
      );
    }

    // 收尾：先闭所有块，再 usage，最后 finish
    for (const c of closeAllChunks()) yield c;
    if (pendingUsage) {
      yield { type: "usage", usage: pendingUsage };
    }
    yield { type: "finish", finishReason: pendingFinish || "stop" };
  }

  /**
   * 处理非流式响应 → 同一词表的 chunk 数组（block_end* → usage → finish）
   *
   * 从 response.output 数组中提取文本、工具调用和推理内容
   */
  private *handleNonStreamResponse(response: any): Generator<StreamChunk> {
    if (!response || !response.output) {
      throw new Error("Invalid response from LLM Responses API");
    }

    let index = 0;
    const outputs = response.output || [];
    for (const output of outputs) {
      if (output.type === "message") {
        const content = output.content?.[0];
        if (content?.type === "output_text") {
          yield {
            type: "block_end",
            index: index++,
            block: { type: "text", text: content.text },
          };
        }
      } else if (output.type === "function_call") {
        yield {
          type: "block_end",
          index: index++,
          block: {
            type: "tool-call",
            toolCallId: output.call_id || output.id,
            name: output.name,
            arguments: output.arguments || "{}",
          },
        };
      } else if (output.type === "reasoning") {
        const summary =
          typeof output.summary === "string"
            ? output.summary
            : Array.isArray(output.summary)
              ? output.summary.map((s: any) => s?.text || "").join("")
              : output.summary;
        if (summary) {
          yield {
            type: "block_end",
            index: index++,
            block: { type: "reasoning", summary },
          };
        }
      }
    }

    if (response.usage) {
      yield {
        type: "usage",
        usage: {
          promptTokens: response.usage.input_tokens,
          completionTokens: response.usage.output_tokens,
          totalTokens: response.usage.total_tokens,
          cachedTokens: extractOpenAICachedTokens(response.usage),
        },
      };
    }
    yield { type: "finish", finishReason: "stop" };
  }

  /**
   * 错误处理与转换
   */
  private handleError(
    error: any,
    isStream: boolean,
  ): never {
    this.logger.error(
      `LLM Responses API error (${isStream ? "stream" : "non-stream"}):`,
      error,
    );

    const status = error.status;
    const msg = `LLM Responses API Error: ${status} - ${error.message}`;

    // 连接阶段失败没有 HTTP status，需单独归一化才能被 AgentEngine 重试
    if (error instanceof APIConnectionTimeoutError) {
      throw new UpstreamTimeoutError(`LLM Responses API 连接超时: ${error.message}`, error);
    }
    if (error instanceof APIConnectionError) {
      throw new UpstreamNetworkError(`LLM Responses API 连接失败: ${error.message}`, error);
    }

    // 429 → UpstreamRateLimitError（可重试）
    if (status === 429) {
      throw new UpstreamRateLimitError(msg, error, getRetryAfterFromError(error));
    }
    // 5xx → UpstreamNetworkError（可重试）
    if (status >= 500 && status < 600) {
      throw new UpstreamNetworkError(msg, error, status);
    }
    // 4xx → UpstreamRequestError（不可重试）
    if (status >= 400 && status < 500) {
      throw new UpstreamRequestError(msg, error, status);
    }

    // 其他错误原样抛出
    throw normalizeTransportError(error);
  }

  /**
   * 清理响应资源
   */
  private cleanup(response: any) {
    if (response && typeof response.controller?.abort === "function") {
      try {
        response.controller.abort();
      } catch (e) {
        // ignore
      }
    }
  }
}

/**
 * 从 OpenAI 协议 usage 对象中提取缓存 token 字段
 * 兼容 OpenAI 官方 (prompt_tokens_details.cached_tokens) 和 DeepSeek (prompt_cache_hit_tokens) 风格
 */
function extractOpenAICachedTokens(
  rawUsage: any,
): { read?: number; missed?: number } | undefined {
  const cachedTokens: { read?: number; missed?: number } = {};

  // DeepSeek 风格: usage.prompt_cache_hit_tokens (flat in usage)
  if (rawUsage.prompt_cache_hit_tokens != null) {
    cachedTokens.read = Number(rawUsage.prompt_cache_hit_tokens);
    if (rawUsage.prompt_cache_miss_tokens != null) {
      cachedTokens.missed = Number(rawUsage.prompt_cache_miss_tokens);
    }
  } else {
    // OpenAI 官方格式: usage.prompt_tokens_details.cached_tokens
    const details = rawUsage.prompt_tokens_details;
    if (details?.cached_tokens != null) {
      cachedTokens.read = Number(details.cached_tokens);
    }
  }

  return cachedTokens.read !== undefined || cachedTokens.missed !== undefined
    ? cachedTokens
    : undefined;
}
