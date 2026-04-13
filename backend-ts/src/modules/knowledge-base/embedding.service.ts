import { Injectable, Logger } from "@nestjs/common";
import OpenAI from "openai";

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
   * @param texts 待向量化的文本数组
   * @param baseUrl API 基础 URL
   * @param apiKey API 密钥
   * @param modelName 模型名称
   * @returns 向量数组，每个元素对应一个输入文本的嵌入向量
   */
  async getEmbeddings(
    texts: string[],
    baseUrl: string,
    apiKey: string,
    modelName: string,
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

    for (let i = 0; i < texts.length; i++) {
      try {
        const response = await client.embeddings.create({
          model: modelName,
          input: texts[i],
        });

        const embedding = response.data[0].embedding;
        embeddings.push(embedding);

        // 每处理 10 个或最后一个时记录进度
        if ((i + 1) % 10 === 0 || i === totalTexts - 1) {
          this.logger.log(`向量化进度：${i + 1}/${totalTexts}`);
        }
      } catch (error: any) {
        this.logger.error(`第 ${i + 1} 个文本向量化失败：${error.message}`);
        throw new Error(`文本 ${i + 1} 向量化失败：${error.message}`);
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
