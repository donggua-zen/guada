import { Injectable, Logger } from "@nestjs/common";
import { Tokenizer as HFTokenizer } from "@huggingface/tokenizers";
import * as tiktoken from "tiktoken";
import * as path from "path";
import * as fs from "fs";
import { MessageRecord } from "../types/message.types";
import { TokenCacheService } from "./token-cache.service";

interface TokenizerResult {
  tokens: number;
  initTime?: number;
  encodeTime?: number;
}

@Injectable()
export class TokenizerService {
  private readonly logger = new Logger(TokenizerService.name);
  private hfTokenizers: Map<string, HFTokenizer> = new Map();
  private ttEncoders: Map<string, tiktoken.Tiktoken> = new Map();

  constructor(private readonly cache: TokenCacheService) {}

  // 模型名称到 tokenizer 文件夹路径的映射 (HuggingFace)
  private readonly hfTokenizerMapping: Record<string, string> = {
    deepseek: "deepseek-ai/DeepSeek-V3.2",
    qwen3: "Qwen/Qwen3.5-397B-A17B",
    qwen2: "Qwen/Qwen3.5-397B-A17B", // 暂时使用 Qwen3.5
    qwen: "Qwen/Qwen3.5-397B-A17B",
    "Ring-1T": "inclusionAI/Ring-2.5-1T",
    "Ling-1T": "inclusionAI/Ling-2.5-1T",
    GLM: "ZhipuAI/GLM-5.1",
    MinMax: "MiniMax/MiniMax-M2.7",
    ERNIE: "PaddlePaddle/ERNIE-4.5-300B-A47B-PT",
    Hunyuan: "moonshotai/Kimi-K2.5", // 假设 Kimi 对应 Hunyuan 或根据实际模型调整
    LongCat: "meituan-longcat/LongCat-Flash-Thinking-2601",
    kimi: "MiniMax/MiniMax-M2.7", // 经测试，MiniMax-M2.7 与 Kimi 分词结果最接近（误差约 2.5%）
  };

  // Tiktoken 编码映射
  private readonly ttEncodingMapping: Record<string, tiktoken.TiktokenEncoding> = {
    default: "cl100k_base",
    gpt4: "cl100k_base",
    gpt35: "cl100k_base",
  };

  /**
   * 根据模型名称查找匹配的 Tokenizer Key
   * 逻辑：去掉命名空间（/前面的部分），全小写，匹配映射表中的 key 开头
   */
  private findMatchingKey(modelName: string): string | undefined {
    // 1. 提取模型名（去掉命名空间）并转为小写
    const simpleName = modelName.split('/').pop()?.toLowerCase() || '';

    // 2. 遍历映射表寻找前缀匹配
    for (const key of Object.keys(this.hfTokenizerMapping)) {
      if (simpleName.startsWith(key.toLowerCase())) {
        return key;
      }
    }
    return undefined;
  }

  /**
   * 获取或初始化 HuggingFace Tokenizer
   */
  private async getHFTokenizer(modelName: string): Promise<HFTokenizer> {
    // 尝试直接匹配
    let targetKey = this.hfTokenizerMapping[modelName] ? modelName : this.findMatchingKey(modelName);

    if (!targetKey) {
      throw new Error(`Unsupported model for HF tokenization: ${modelName}`);
    }

    const folderPath = this.hfTokenizerMapping[targetKey];
    if (!folderPath) {
      throw new Error(`Tokenizer mapping not found for key: ${targetKey}`);
    }

    // 使用原始 modelName 作为缓存 Key，确保不同完整名称但匹配到同一方案的模型能复用实例
    if (this.hfTokenizers.has(modelName)) {
      return this.hfTokenizers.get(modelName)!;
    }

    const tokenizerPath = path.join(__dirname, "tokenizers", folderPath, "tokenizer.json");
    if (!fs.existsSync(tokenizerPath)) {
      throw new Error(`Tokenizer file not found: ${tokenizerPath}`);
    }

    try {
      // 异步读取大文件，避免阻塞事件循环
      const tokenizerJson = JSON.parse(await fs.promises.readFile(tokenizerPath, "utf-8"));

      // 尝试读取并传入 tokenizer_config.json (如果存在)
      let options: any = {};
      const configPath = path.join(__dirname, "tokenizers", folderPath, "tokenizer_config.json");
      if (fs.existsSync(configPath)) {
        try {
          options = JSON.parse(await fs.promises.readFile(configPath, "utf-8"));
        } catch (e) {
          this.logger.warn(`Failed to parse tokenizer_config.json for ${modelName}, using default options.`);
        }
      }

      const tokenizer = new HFTokenizer(tokenizerJson, options);
      this.hfTokenizers.set(modelName, tokenizer);
    } catch (error) {
      this.logger.error(`Failed to initialize HF tokenizer for ${modelName}`, error);
      throw error;
    }
    return this.hfTokenizers.get(modelName)!;
  }

  /**
   * 获取或初始化 Tiktoken Encoder
   */
  private getTTEncoder(encodingName: tiktoken.TiktokenEncoding): tiktoken.Tiktoken {
    if (!this.ttEncoders.has(encodingName)) {
      try {
        const enc = tiktoken.get_encoding(encodingName);
        this.ttEncoders.set(encodingName, enc);
      } catch (error) {
        this.logger.error(`Failed to initialize Tiktoken encoder for ${encodingName}`, error);
        throw error;
      }
    }
    return this.ttEncoders.get(encodingName)!;
  }

  /**
   * 计算纯文本的 Token 数量（核心实现）
   * @param modelName 模型名称
   * @param text 待计算的纯文本字符串
   * @param useTiktoken 是否强制使用 Tiktoken
   */
  async countTextTokens(modelName: string, text: string, useTiktoken?: boolean): Promise<number> {
    // 生成缓存 Key 并尝试从缓存获取
    const cacheKey = this.cache.generateKey(modelName, text);
    const cached = this.cache.get(cacheKey);
    if (cached !== null) {
      return cached;
    }

    // 自动选择方案：如果模型在 HF 映射中（支持模糊匹配）且未强制使用 Tiktoken，则优先使用 HF
    const matchedKey = this.findMatchingKey(modelName);
    const shouldUseHF = !useTiktoken && (this.hfTokenizerMapping[modelName] || matchedKey);

    let result: number;
    if (shouldUseHF) {
      const tokenizer = await this.getHFTokenizer(modelName);
      const encoded = tokenizer.encode(text);
      result = encoded.ids.length;
    } else {
      // 默认使用 cl100k_base，也可以根据 modelName 扩展映射
      const encoding = this.ttEncodingMapping[modelName] || this.ttEncodingMapping.default;
      const enc = this.getTTEncoder(encoding);
      result = enc.encode(text).length;
    }

    // 将结果写入缓存
    this.cache.set(cacheKey, result, modelName, text);
    return result;
  }

  /**
   * 计算消息数组的 Token 数量（支持工具调用、复杂内容结构和图片）
   * @param modelName 模型名称
   * @param messages 待计算的消息数组
   * @param useTiktoken 是否强制使用 Tiktoken（默认根据模型自动选择）
   */
  async countTokens(modelName: string, messages: MessageRecord[], useTiktoken?: boolean): Promise<number> {
    let totalTokens = 0;

    for (const item of messages) {
      if (typeof item === "object" && item !== null) {
        // 1. 处理工具调用 (toolCalls)
        if (item.toolCalls && Array.isArray(item.toolCalls)) {
          for (const tc of item.toolCalls) {
            totalTokens += await this.countTextTokens(modelName, JSON.stringify(tc), useTiktoken);
          }
        }

        // 2. 处理思维链 (reasoning_content)
        if (item.reasoningContent) {
          totalTokens += await this.countTextTokens(modelName, item.reasoningContent, useTiktoken);
        }

        // 3. 处理内容 (content)
        if (Array.isArray(item.content)) {
          for (const part of item.content) {
            if (part.text) {
              totalTokens += await this.countTextTokens(modelName, part.text, useTiktoken);
            }
            // 4. 处理图片 (image_url)
            if (part.type === "image_url" && part.image_url) {
              totalTokens += 1500; // 暂时统一按照 1500 计算
            }
          }
        } else if (item.content) {
          totalTokens += await this.countTextTokens(modelName, item.content, useTiktoken);
        }
      }
    }

    return totalTokens;
  }

  /**
   * 批量计算多个文本片段的 Token 数
   */
  async countBatchTokens(modelName: string, texts: string[], useTiktoken?: boolean): Promise<number> {
    let total = 0;
    for (const text of texts) {
      total += await this.countTextTokens(modelName, text, useTiktoken);
    }
    return total;
  }
}
