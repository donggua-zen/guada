import { Injectable, Logger } from "@nestjs/common";
import OpenAI from "openai";

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
 * Embedding 服务
 *
 * 专门负责将文本转换为向量嵌入，不涉及向量存储逻辑。
 * 支持批量处理和独立的错误处理。
 */
@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);

  /**
   * 批量获取文本嵌入向量
   *
   * 使用 OpenAI SDK 的批量 input 参数，每批最多 BATCH_SIZE 条，
   * 显著减少 API 调用次数。
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

    const client = new OpenAI({
      baseURL: baseUrl,
      apiKey: apiKey,
    });

    const embeddings: number[][] = [];
    const totalTexts = texts.length;

    this.logger.log(`开始批量向量化 ${totalTexts} 个文本片段...`);

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(totalTexts / BATCH_SIZE);

      try {
        const response = await client.embeddings.create({
          model: modelName,
          input: batch,
        });

        // 按 index 排序确保顺序一致（API 可能不保证返回顺序）
        const sorted = response.data.sort((a, b) => a.index - b.index);
        for (const item of sorted) {
          embeddings.push(item.embedding);
        }

        const processed = Math.min(i + BATCH_SIZE, totalTexts);
        if (onProgress) {
          await onProgress(processed, totalTexts);
        }

        this.logger.log(
          `向量化进度：${processed}/${totalTexts}（批次 ${batchNum}/${totalBatches}）`,
        );
      } catch (error: any) {
        const startIdx = i + 1;
        const endIdx = Math.min(i + BATCH_SIZE, totalTexts);
        this.logger.error(
          `第 ${startIdx}-${endIdx} 个文本向量化失败：${error.message}`,
        );
        throw new Error(
          `文本 ${startIdx}-${endIdx} 向量化失败：${error.message}`,
        );
      }
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
}
