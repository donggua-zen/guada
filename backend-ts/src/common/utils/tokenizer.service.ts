import { Injectable, Logger } from "@nestjs/common";
import * as tiktoken from "tiktoken";
import type { Message, ContentBlock } from "../types/conversation.types";
import { TokenCacheService } from "./token-cache.service";

/**
 * 统一 token 计量服务（tiktoken-only，dsh 式）。
 *
 * 设计说明：
 * - 精确真值由 provider 返回的 usage（promptTokens/completionTokens/cachedTokens）
 *   驱动，见 persistent-session-context.usageAnchor；本地计数仅作估算/投影/兜底。
 * - 本地统一使用 tiktoken：轻量、~2.3x 于旧 HF tokenizer、对中文多算 => 压缩门控保守安全。
 * - encode/decode 供知识库 RAG 分块使用（DEFAULT_MODEL="default"，恒走 tiktoken）。
 */
@Injectable()
export class TokenizerService {
  private readonly logger = new Logger(TokenizerService.name);
  private ttEncoders: Map<string, tiktoken.Tiktoken> = new Map();

  /** 共享的 tiktoken 计数编码器（全模型统一，o200k_base；失败时回退 chars/4） */
  private tiktokenHeuristicEncoder: tiktoken.Tiktoken | undefined;

  constructor(private readonly cache: TokenCacheService) {}

  // tiktoken 编码选择：default/gpt 家族映射，其余统一 o200k_base
  private readonly ttEncodingMapping: Record<
    string,
    tiktoken.TiktokenEncoding
  > = {
    default: "o200k_base",
    gpt4: "cl100k_base",
    gpt35: "cl100k_base",
  };

  /** 懒加载共享 tiktoken 计数编码器；失败时回退 chars/4（同 dsh estimate） */
  private getHeuristicEncoder(): tiktoken.Tiktoken | undefined {
    if (this.tiktokenHeuristicEncoder === undefined) {
      try {
        this.tiktokenHeuristicEncoder = tiktoken.get_encoding("o200k_base");
      } catch (e) {
        this.logger.warn(
          `tiktoken o200k_base init failed, fallback to chars/4: ${e}`,
        );
        return undefined;
      }
    }
    return this.tiktokenHeuristicEncoder;
  }

  /**
   * tiktoken 轻量计数（含缓存）。用于 dsh 式的估算/投影；
   * 精确真值由 provider 返回的 usage 提供，见 persistent-session-context.usageAnchor。
   */
  private async countTiktokenHeuristic(
    modelName: string,
    text: string,
    useCache: boolean = true,
  ): Promise<number> {
    try {
      const cacheKey = this.cache.generateKey(modelName, text);
      if (useCache) {
        const cached = this.cache.get(cacheKey);
        if (cached !== null) return cached;
      }
      const enc = this.getHeuristicEncoder();
      const n = enc ? enc.encode(text, "all").length : Math.ceil(text.length / 4);
      if (useCache) {
        this.cache.set(cacheKey, n, modelName, text);
      }
      return n;
    } catch (error) {
      this.logger.error(
        `Failed to count tiktoken tokens for ${modelName}: ${error}`,
      );
      return 0;
    }
  }

  /**
   * 获取或初始化 Tiktoken Encoder（用于 encode/decode 的真实分词）
   */
  private getTTEncoder(
    encodingName: tiktoken.TiktokenEncoding,
  ): tiktoken.Tiktoken {
    if (!this.ttEncoders.has(encodingName)) {
      try {
        const enc = tiktoken.get_encoding(encodingName);
        this.ttEncoders.set(encodingName, enc);
      } catch (error) {
        this.logger.error(
          `Failed to initialize Tiktoken encoder for ${encodingName}`,
          error,
        );
        throw error;
      }
    }
    return this.ttEncoders.get(encodingName)!;
  }

  private resolveEncoding(modelName: string): tiktoken.TiktokenEncoding {
    return this.ttEncodingMapping[modelName] || this.ttEncodingMapping.default;
  }

  /**
   * 将文本编码为 Token ID 列表
   * 不走缓存——encode 是底层操作，调用方自行管理。
   * @param modelName 模型名称
   * @param text 待编码的文本
   */
  async encode(modelName: string, text: string): Promise<number[]> {
    const enc = this.getTTEncoder(this.resolveEncoding(modelName));
    return Array.from(enc.encode(text, "all"));
  }

  /**
   * 将 Token ID 列表解码为文本
   * @param modelName 模型名称
   * @param tokenIds Token ID 列表
   */
  async decode(modelName: string, tokenIds: number[]): Promise<string> {
    const enc = this.getTTEncoder(this.resolveEncoding(modelName));
    const decoded = enc.decode(new Uint32Array(tokenIds));
    return new TextDecoder().decode(decoded);
  }

  /**
   * 计算纯文本的 Token 数量（核心实现，tiktoken 轻量启发式）
   * @param modelName 模型名称
   * @param text 待计算的纯文本字符串
   * @param useCache 是否使用缓存（默认 true；一次性文本应传 false 避免挤占缓存名额）
   */
  async countTextTokens(
    modelName: string,
    text: string,
    useCache: boolean = true,
  ): Promise<number> {
    return this.countTiktokenHeuristic(modelName, text, useCache);
  }

  /**
   * 计算消息数组的 Token 数量（按 ContentBlock 块级计数，含工具调用、图片）。
   * @param modelName 模型名称
   * @param messages 待计算的消息数组（三层 Message[]）
   * @param useCache 是否使用缓存（默认 true；一次性文本应传 false 避免挤占缓存名额）
   */
  async countTokens(
    modelName: string,
    messages: Message[],
    useCache: boolean = true,
  ): Promise<number> {
    let totalTokens = 0;

    for (const item of messages) {
      if (typeof item !== "object" || item === null) continue;

      // 按 ContentBlock 块级计数
      if (Array.isArray(item.content)) {
        totalTokens += await this.countMessageBlocks(
          modelName,
          item.content,
          useCache,
        );
      }
    }

    return totalTokens;
  }

  /** 按 ContentBlock 判别联合逐块计数 */
  private async countMessageBlocks(
    modelName: string,
    content: ContentBlock[],
    useCache: boolean,
  ): Promise<number> {
    let total = 0;
    for (const block of content) {
      switch (block.type) {
        case "text":
          total += await this.countTextTokens(modelName, block.text, useCache);
          break;
        case "reasoning":
          total += await this.countTextTokens(modelName, block.summary, useCache);
          break;
        case "tool-call":
          total += await this.countTextTokens(
            modelName,
            `${block.name}\n${block.arguments}`,
            useCache,
          );
          break;
        case "tool-result":
          total += await this.countTextTokens(modelName, block.content, useCache);
          // 工具结果内嵌图片与 image 块同口径
          total += (block.images?.length ?? 0) * 1500;
          break;
        case "image":
          total += 1500; // 图片统一按 1500 估算
          break;
        case "file":
          total += await this.countTextTokens(
            modelName,
            block.inline ?? block.attachment.name ?? block.attachment.url ?? "",
            useCache,
          );
          break;
      }
    }
    return total;
  }

  /**
   * 批量计算多个文本片段的 Token 数
   * @param useCache 是否使用缓存（默认 true；一次性文本应传 false 避免挤占缓存名额）
   */
  async countBatchTokens(
    modelName: string,
    texts: string[],
    useCache: boolean = true,
  ): Promise<number> {
    let total = 0;
    for (const text of texts) {
      total += await this.countTextTokens(modelName, text, useCache);
    }
    return total;
  }
}
