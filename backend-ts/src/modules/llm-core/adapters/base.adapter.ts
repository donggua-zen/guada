import { LLMCompletionParams, StreamChunk } from "../types/llm.types";
import { ProviderConfig, ConnectionTestResult, RemoteModel } from "../types/provider.types";

/**
 * 协议能力标记
 *
 * 供管理面展示与前端能力提示使用；未声明一律视为「未知/未支持」，
 * 运行时不做强制校验（能力的真实约束由适配器自己 fail-loud）。
 */
export interface ProtocolCapabilities {
  /** 是否支持流式响应 */
  streaming?: boolean;
  /** 是否支持工具调用 */
  tools?: boolean;
  /** 是否支持图片输入 */
  vision?: boolean;
  /** 是否支持思考/推理内容 */
  reasoning?: boolean;
  /** 是否支持 embedding */
  embeddings?: boolean;
  /** 是否支持 prompt caching */
  promptCaching?: boolean;
  /** 是否支持远程模型列表同步 */
  modelDiscovery?: boolean;
}

/** embedding 请求参数（知识库向量化走适配器，不再直连 OpenAI SDK） */
export interface EmbeddingParams {
  model: string;
  input: string | string[];
  providerConfig: ProviderConfig;
  dimensions?: number;
  abortSignal?: AbortSignal;
}

export interface EmbeddingResult {
  embeddings: number[][];
  usage?: {
    promptTokens?: number;
    totalTokens?: number;
  };
}

/**
 * 调用前快照（对齐 DSH prepareCall）
 *
 * 适配器可在 prepareCall 中把「模型能力解析」与「本次 dispatch 的连接配置」
 * 绑定到同一代快照，避免热更新/配置切换导致能力与 endpoint 混代。
 * 未实现时由 LLMService 直接使用当次参数。
 */
export interface PreparedAdapterCall {
  /** 已解析的模型标识（可选，仅用于诊断） */
  model?: string;
  /** 适配器自定义的快照字段 */
  [key: string]: any;
}

/**
 * 协议适配器接口
 *
 * 所有协议适配器（OpenAI, Anthropic, Gemini 以及插件贡献的协议）都必须实现
 * 本接口。只有 `protocol` + `chatCompletion` 是必选能力；其余方法按协议实现。
 *
 * 职责：封装底层通信细节，提供统一的聊天和模型查询接口。
 */
export interface IProtocolAdapter {
  /**
   * 协议标识符 (e.g., 'openai', 'anthropic', 'gemini')
   */
  readonly protocol: string;

  /** 展示名（缺省用 protocol） */
  readonly displayName?: string;

  /** 协议能力标记（管理面/前端提示用） */
  readonly capabilities?: ProtocolCapabilities;

  /**
   * 测试供应商连接（可选）
   * @param config 供应商配置
   * @returns 测试结果
   */
  testConnection?(config: ProviderConfig): Promise<ConnectionTestResult>;

  /**
   * 执行聊天补全
   * @param params 请求参数
   * @returns 流式响应生成器（StreamChunk 词表）或非流式响应（chunk 数组：block_end* → usage → finish）
   */
  chatCompletion(
    params: LLMCompletionParams,
  ): AsyncGenerator<StreamChunk> | Promise<StreamChunk[]>;

  /**
   * 从远程 API 同步该协议下的可用模型列表（可选）
   * @param config 供应商配置
   * @returns 远程模型列表
   */
  syncRemoteModels?(config: ProviderConfig): Promise<RemoteModel[]>;

  /**
   * 文本向量化（可选）
   *
   * 知识库等消费方通过此方法获得 embedding；未实现时由调用方给出明确错误，
   * 不再假设存在 OpenAI 兼容的 /v1/embeddings 端点。
   */
  embeddings?(params: EmbeddingParams): Promise<EmbeddingResult>;

  /**
   * 调用前快照（可选）
   */
  prepareCall?(
    params: LLMCompletionParams,
  ): PreparedAdapterCall | Promise<PreparedAdapterCall>;
}
