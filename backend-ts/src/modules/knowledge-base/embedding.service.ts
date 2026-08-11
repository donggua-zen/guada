import { Injectable, Logger } from "@nestjs/common";
import OpenAI from "openai";
import { retryWithBackoff } from "../llm-core/utils/retry.util";

/**
 * 向量化进度回调
 * @param current 已处理的条数
 * @param total 总条数
 */
export type EmbeddingProgressCallback = (
  current: number,
  total: number,
) => Promise<void> | void;

/** 每批最大条数 */
const BATCH_SIZE = 10;

/**
 * Embedding 请求超时（毫秒）
 * 单次 embedding 请求通常很快，60s 足够应对大 batch 或慢模型
 */
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * 判断错误是否为可重试的 Embedding 请求错误
 *
 * 可重试（临时性）：
 * - 429 Too Many Requests
 * - 5xx 服务器错误
 * - 网络连接错误（ECONNRESET, ETIMEDOUT, ENOTFOUND 等）
 * - 请求超时
 *
 * 不可重试（永久性，直接抛出）：
 * - 4xx 客户端错误（400, 401, 403, 404 等）
 * - 无效请求、认证错误等
 */
export function isRetryableEmbeddingError(error: any): boolean {
  if (!error) return false;

  // 1. 429 限流 / 5xx 服务器错误 — 可重试
  const status = error.status ?? error.statusCode ?? error.code;
  if (status === 429) return true;
  if (status && status >= 500 && status < 600) return true;

  // 2. OpenAI SDK 的连接错误 — 可重试
  // 包括：APIConnectionError（网络问题）、APIConnectionTimeoutError（超时）
  if (error instanceof OpenAI.APIConnectionError) return true;

  // 3. 错误消息中包含网络/超时关键词 — 可重试
  const msg = error.message?.toLowerCase() ?? "";
  const retryableKeywords = [
    "econnreset",
    "econnrefused",
    "etimedout",
    "enotfound",
    "eai_again",
    "socket hang up",
    "fetch failed",
    "network error",
    "network timeout",
    "request aborted",
    "connection lost",
    "connection closed",
    "timeout",
  ];
  if (retryableKeywords.some((kw) => msg.includes(kw))) return true;

  return false;
}

/**
 * Embedding 服务
 *
 * 职责：
 * - 将文本转换为向量嵌入
 * - 支持批量处理（BATCH_SIZE = 10）
 * - 自动重试可恢复错误（网络抖动、限流、5xx）
 * - 批量失败后降级为逐条请求（提高成功率）
 * - 统一超时控制
 *
 * 设计原则：
 * - 重试策略由 retryWithBackoff 统一处理，SDK 内置重试禁用（maxRetries: 0）
 * - 降级仅在"可重试错误耗尽"后触发，不可重试错误直接抛出
 * - 降级后仍返回完整结果，降级事件通过日志记录
 */
@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);

  /**
   * 批量获取文本嵌入向量
   *
   * 处理流程：
   * 1. 按 BATCH_SIZE 分组
   * 2. 每组先尝试批量请求（带重试）
   * 3. 批量请求失败（重试耗尽）→ 降级为逐条请求
   * 4. 汇总所有结果返回
   *
   * @param texts 待向量化的文本数组
   * @param baseUrl API 基础 URL
   * @param apiKey API 密钥
   * @param modelName 模型名称
   * @param onProgress 进度回调（每处理完一批触发）
   * @returns 向量数组，每个元素对应一个输入文本的嵌入向量
   */
  async getEmbeddings(
    texts: string[],
    baseUrl: string,
    apiKey: string,
    modelName: string,
    onProgress?: EmbeddingProgressCallback,
  ): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const client = this.createClient(baseUrl, apiKey);
    const embeddings: number[][] = [];
    const totalTexts = texts.length;
    // 记录所有降级批次中失败的文本索引
    const allDegradedIndices: number[] = [];

    this.logger.log(`开始批量向量化 ${totalTexts} 个文本片段...`);

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(totalTexts / BATCH_SIZE);
      const startIdx = i + 1;
      const endIdx = Math.min(i + BATCH_SIZE, totalTexts);

      try {
        // 先尝试批量请求（带重试）
        const batchEmbeddings = await this.attemptBatch(
          client,
          modelName,
          batch,
        );
        embeddings.push(...batchEmbeddings);
      } catch (error: any) {
        // 批量请求失败，降级为逐条请求
        this.logger.warn(
          `第 ${startIdx}-${endIdx} 个文本批量向量化失败（${error.message}），` +
          `降级为逐条请求`,
        );

        const degradedIndices = await this.degradeToSingle(
          client,
          modelName,
          batch,
          startIdx,
        );
        embeddings.push(...degradedIndices.embeddings);
        allDegradedIndices.push(...degradedIndices.degradedIndices);
      }

      // 进度回调
      const processed = Math.min(i + BATCH_SIZE, totalTexts);
      if (onProgress) {
        await onProgress(processed, totalTexts);
      }

      this.logger.log(
        `向量化进度：${processed}/${totalTexts}（批次 ${batchNum}/${totalBatches}）`,
      );
    }

    // 如果发生过降级，记录日志（不影响正常返回）
    if (allDegradedIndices.length > 0) {
      this.logger.warn(
        `向量化完成，但 ${allDegradedIndices.length} 个文本通过降级（逐条）方式完成，` +
        `索引: [${allDegradedIndices.join(", ")}]`,
      );
    }

    this.logger.log(`批量向量化完成，共生成 ${embeddings.length} 个向量`);
    return embeddings;
  }

  /**
   * 获取单个文本的嵌入向量
   *
   * @param text 待向量化的文本
   * @param baseUrl API 基础 URL
   * @param apiKey API 密钥
   * @param modelName 模型名称
   * @returns 嵌入向量
   */
  async getEmbedding(
    text: string,
    baseUrl: string,
    apiKey: string,
    modelName: string,
  ): Promise<number[]> {
    const embeddings = await this.getEmbeddings(
      [text],
      baseUrl,
      apiKey,
      modelName,
    );
    return embeddings[0];
  }

  /**
   * 创建 OpenAI 客户端（统一超时和重试策略）
   */
  private createClient(baseUrl: string, apiKey: string): OpenAI {
    return new OpenAI({
      baseURL: baseUrl,
      apiKey: apiKey,
      timeout: REQUEST_TIMEOUT_MS,
      maxRetries: 0, // 禁用 SDK 内置重试，由 retryWithBackoff 统一控制
    });
  }

  /**
   * 尝试批量向量化请求（带重试）
   *
   * 使用 retryWithBackoff 包裹批量请求，
   * 仅对可重试错误（网络/5xx/429/超时）进行指数退避重试。
   */
  private async attemptBatch(
    client: OpenAI,
    modelName: string,
    batch: string[],
  ): Promise<number[][]> {
    return retryWithBackoff(
      async () => {
        const response = await client.embeddings.create({
          model: modelName,
          input: batch,
        });

        // 按 index 排序确保顺序一致（API 可能不保证返回顺序）
        const sorted = response.data.sort((a, b) => a.index - b.index);
        return sorted.map((item) => item.embedding);
      },
      {
        logger: this.logger,
        context: `Embedding batch(${batch.length})`,
        maxRetries: 3,
        baseDelayMs: 1000,
        maxDelayMs: 10000,
        shouldRetry: (error) => isRetryableEmbeddingError(error),
      },
    );
  }

  /**
   * 降级为逐条请求
   *
   * 当批量请求失败后，将 batch 中的每条文本单独请求。
   * 每条请求也使用 retryWithBackoff 包裹。
   * 逐条仍然失败（不可重试错误）→ 抛出汇总错误。
   *
   * @returns 包含所有嵌入向量和降级索引的对象
   */
  private async degradeToSingle(
    client: OpenAI,
    modelName: string,
    batch: string[],
    globalStartIdx: number,
  ): Promise<{ embeddings: number[][]; degradedIndices: number[] }> {
    const embeddings: number[][] = [];
    const degradedIndices: number[] = [];
    const errors: Array<{ index: number; error: string }> = [];

    for (let j = 0; j < batch.length; j++) {
      const text = batch[j];
      const globalIdx = globalStartIdx + j;

      try {
        const embedding = await retryWithBackoff(
          async () => {
            const response = await client.embeddings.create({
              model: modelName,
              input: text,
            });
            return response.data[0].embedding;
          },
          {
            logger: this.logger,
            context: `Embedding single[${globalIdx}]`,
            maxRetries: 2, // 逐条请求重试次数少一些，减少总等待时间
            baseDelayMs: 500,
            maxDelayMs: 5000,
            shouldRetry: (error) => isRetryableEmbeddingError(error),
          },
        );
        embeddings.push(embedding);
        degradedIndices.push(globalIdx);
      } catch (error: any) {
        // 逐条也失败（不可重试错误），记录错误
        errors.push({ index: globalIdx, error: error.message });
        this.logger.error(
          `第 ${globalIdx} 个文本向量化最终失败（降级后仍失败）：${error.message}`,
        );
      }
    }

    // 如果逐条请求全部失败，抛出汇总错误
    if (embeddings.length === 0) {
      const errorDetail = errors
        .map((e) => `[${e.index}] ${e.error}`)
        .join("; ");
      throw new Error(
        `降级后逐条向量化全部失败（${batch.length} 条）：${errorDetail}`,
      );
    }

    // 部分成功：记录警告
    if (errors.length > 0) {
      this.logger.warn(
        `降级后逐条向量化部分失败：成功 ${embeddings.length}/${batch.length} 条，` +
        `失败索引: [${errors.map((e) => e.index).join(", ")}]`,
      );
    }

    return { embeddings, degradedIndices };
  }
}