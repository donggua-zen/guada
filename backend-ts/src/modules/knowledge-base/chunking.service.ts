/**
 * 智能文本分块服务
 *
 * 基于 Token 数量进行文本分块，保持语义连贯性：
 * - 使用 tiktoken 计算 Token 数
 * - 优先在句子或段落边界处分块
 * - 支持分块重叠（避免信息丢失）
 */

import { Logger } from "@nestjs/common";
import * as tiktoken from "tiktoken";

/**
 * 页码文本条目
 */
export interface PageEntry {
  pageNum: number; // 页码（从1开始）
  text: string; // 该页文本内容
}

export interface ChunkResult {
  content: string; // 分块文本内容（可能含前块末尾重叠，用于向量化）
  chunkIndex: number; // 分块索引
  metadata: {
    overlapLength: number; // 重叠部分的 Token 数
    chunkSize: number; // 原始内容长度（字符数）
    tokenCount: number; // Token 数量
    strategy: string; // 分块策略
  };
}

export interface ChunkingOptions {
  chunkSize?: number; // 分块大小限制（Token 数）
  overlapSize?: number; // 分块重叠大小（Token 数）
  modelName?: string; // 用于计算 Token 的模型名称（已废弃，固定使用 cl100k_base）
}

export interface ChunkTextOptions extends ChunkingOptions {
  modelName?: string; // 可以覆盖构造函数中的模型名称
}

export class ChunkingService {
  private readonly logger = new Logger(ChunkingService.name);
  private tokenizer: tiktoken.Tiktoken | null = null;
  // 固定使用 cl100k_base 编码
  private readonly encodingName: tiktoken.TiktokenEncoding =
    "cl100k_base" as tiktoken.TiktokenEncoding;

  constructor(private options: ChunkingOptions = {}) {
    this.options = {
      chunkSize: options.chunkSize || 1000,
      overlapSize: options.overlapSize || 100,
      modelName: options.modelName || "gpt-4o", // 保留但不再使用
    };
  }

  /**
   * 根据模型名称获取对应的 tiktoken 编码
   */
  private getEncodingForModel(modelName: string): tiktoken.TiktokenEncoding {
    const model = modelName.toLowerCase();

    // OpenAI 模型映射
    if (model.includes("gpt-4o") || model.includes("gpt-4-turbo")) {
      return "o200k_base" as tiktoken.TiktokenEncoding;
    }
    if (model.includes("gpt-4") || model.includes("gpt-3.5")) {
      return "cl100k_base" as tiktoken.TiktokenEncoding;
    }

    // 默认使用 cl100k_base
    return "cl100k_base" as tiktoken.TiktokenEncoding;
  }

  /**
   * 获取或初始化 tokenizer（固定使用 cl100k_base 编码）
   */
  private async getTokenizer(): Promise<tiktoken.Tiktoken> {
    if (!this.tokenizer) {
      try {
        this.tokenizer = await tiktoken.get_encoding(this.encodingName);
        this.logger.debug("Tokenizer initialized with cl100k_base encoding");
      } catch (error: any) {
        this.logger.error(`Failed to initialize tokenizer: ${error.message}`);
        throw error;
      }
    }
    return this.tokenizer;
  }

  /**
   * 计算文本的 Token 数量
   */
  async countTokens(text: string): Promise<number> {
    const tokenizer = await this.getTokenizer();
    return tokenizer.encode(text).length;
  }

  /**
   * 将文本编码为 Token ID 列表
   */
  async encodeText(text: string): Promise<number[]> {
    const tokenizer = await this.getTokenizer();
    const tokens = tokenizer.encode(text);
    return Array.from(tokens);
  }

  /**
   * 将 Token ID 列表解码为文本
   */
  async decodeTokens(tokenIds: number[]): Promise<string> {
    const tokenizer = await this.getTokenizer();
    const uint32Array = new Uint32Array(tokenIds);
    const decoded = tokenizer.decode(uint32Array);
    return new TextDecoder().decode(decoded);
  }

  /**
   * 对文本进行基于 Token 的分块
   *
   * @param text 待分块的纯文本（兼容旧接口，不含页码信息）
   * @param optionsOrMetadata 分块选项或元数据
   * @param metadata 元数据（会添加到每个分块中）
   * @returns 分块结果列表
   */
  async chunkText(
    text: string,
    optionsOrMetadata?: ChunkTextOptions | Record<string, any>,
    metadata?: Record<string, any>,
  ): Promise<ChunkResult[]> {
    // 兼容旧接口：纯文本视为单页
    const pages: PageEntry[] = text ? [{ pageNum: 1, text }] : [];
    return this.chunkPages(pages, optionsOrMetadata, metadata);
  }

  /**
   * 对分页文本进行基于 Token 的分块
   * 合并所有页面为连续文本后统一分块（不再按页边界切割）
   *
   * @param pages 页码文本列表
   * @param optionsOrMetadata 分块选项或元数据
   * @param metadata 元数据（会添加到每个分块中）
   * @returns 分块结果列表
   */
  async chunkPages(
    pages: PageEntry[],
    optionsOrMetadata?: ChunkTextOptions | Record<string, any>,
    metadata?: Record<string, any>,
  ): Promise<ChunkResult[]> {
    if (!pages || pages.length === 0) {
      return [];
    }

    // 处理参数重载
    let chunkOptions: ChunkTextOptions = {};
    let chunkMetadata: Record<string, any> | undefined;

    if (optionsOrMetadata) {
      if (
        "chunkSize" in optionsOrMetadata ||
        "overlapSize" in optionsOrMetadata ||
        "modelName" in optionsOrMetadata
      ) {
        chunkOptions = optionsOrMetadata as ChunkTextOptions;
        chunkMetadata = metadata;
      } else {
        chunkMetadata = optionsOrMetadata as Record<string, any>;
      }
    }

    const finalOptions: ChunkingOptions = {
      chunkSize: chunkOptions.chunkSize ?? this.options.chunkSize,
      overlapSize: chunkOptions.overlapSize ?? this.options.overlapSize,
      modelName: this.options.modelName,
    };

    // 合并所有页面文本为连续文档（用换行分隔），不再按页边界单独分块
    const combinedText = pages
      .map((p) => p.text)
      .filter((t) => t && t.trim().length > 0)
      .join("\n");

    if (!combinedText.trim()) {
      return [];
    }

    const processedText = this.preprocessText(combinedText);
    const rawChunks = await this.tokenBasedChunking(processedText, finalOptions);

    // 对连续文档统一应用重叠逻辑
    const result: ChunkResult[] = [];
    let prevTokensList: number[] | null = null;

    for (let idx = 0; idx < rawChunks.length; idx++) {
      const content = rawChunks[idx];
      const currentTokensList = await this.encodeText(content);
      let tokenCount = currentTokensList.length;
      let overlapLength = 0;
      let finalContent = content;

      // 重叠逻辑（可跨前页面边界）
      if (idx > 0 && finalOptions.overlapSize! > 0 && prevTokensList) {
        const overlapTokenIds =
          prevTokensList.length >= finalOptions.overlapSize!
            ? prevTokensList.slice(-finalOptions.overlapSize!)
            : prevTokensList;

        const overlapText = await this.decodeTokens(overlapTokenIds);

        // BPE tokenizer 可能将汉字切为多个 token，截取末尾 token 反解时
        // 会产生不完整 UTF-8 序列 → TextDecoder 注入 U+FFFD（�）
        // 此处清理替换字符，确保后续 startsWith 判断不受干扰
        const cleanOverlapText = overlapText.replace(/\uFFFD/g, "");

        if (content.startsWith(cleanOverlapText)) {
          overlapLength = overlapTokenIds.length;
          finalContent = content;
        } else {
          const fullEmbeddingContent = overlapText + content;
          overlapLength = overlapTokenIds.length;
          tokenCount = await this.countTokens(fullEmbeddingContent);
          // 清理拼接处可能因 token 边界产生的替换字符
          finalContent = fullEmbeddingContent.replace(/\uFFFD/g, "");
        }
      }

      // 清理分块首尾：去除可能因预处理引入的前导空格/不可见字符
      finalContent = finalContent.trimStart();

      const chunk: ChunkResult = {
        content: finalContent,
        chunkIndex: idx,
        metadata: {
          ...(chunkMetadata || {}),
          overlapLength,
          chunkSize: finalContent.length,
          tokenCount,
          strategy: "token",
        },
      };

      result.push(chunk);
      prevTokensList = await this.encodeText(finalContent);
    }

    this.logger.log(`文本分块完成：共${result.length}个分块，跨页合并分块策略`);
    return result;
  }

  /**
   * 基于 Token 数量和句子边界的智能分块逻辑
   *
   * 策略：
   * 1. 按句子边界分割文本，保持语义完整性
   * 2. 累加句子到当前分块，直到加入下一个句子会超出 chunkSize
   * 3. 严禁将一个句子强行拆分或合并进已满的分块
   */
  private async tokenBasedChunking(
    text: string,
    options: ChunkingOptions,
  ): Promise<string[]> {
    // 使用正则表达式按句子边界分割（支持中英文标点）
    // (?<=[。！？.!?]) 表示在句号、感叹号、问号之后分割，但保留标点在句子末尾
    const sentences = text.split(/(?<=[。！？.!?])/);

    // 过滤掉空字符串并去除首尾空白
    const filteredSentences = sentences
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (filteredSentences.length === 0) {
      return text ? [text] : [];
    }

    const chunks: string[] = [];
    let currentChunkSentences: string[] = [];
    let currentTokens = 0;

    for (const sentence of filteredSentences) {
      const sentenceTokens = await this.countTokens(sentence);

      // 检查加入当前句子后是否超出限制
      const separator = " ";
      const separatorTokens =
        currentChunkSentences.length > 0
          ? await this.countTokens(separator)
          : 0;

      const totalNeeded = currentTokens + separatorTokens + sentenceTokens;

      if (
        totalNeeded > options.chunkSize! &&
        currentChunkSentences.length > 0
      ) {
        // 如果超出限制且当前分块已有内容，则结束当前分块
        chunks.push(currentChunkSentences.join(" "));

        // 开始新分块，当前句子作为起始
        currentChunkSentences = [sentence];
        currentTokens = sentenceTokens;
      } else {
        // 加入当前句子
        if (currentChunkSentences.length > 0) {
          currentChunkSentences.push(sentence);
          currentTokens += separatorTokens + sentenceTokens;
        } else {
          currentChunkSentences.push(sentence);
          currentTokens += sentenceTokens;
        }
      }
    }

    // 处理最后一个分块
    if (currentChunkSentences.length > 0) {
      chunks.push(currentChunkSentences.join(" "));
    }

    return chunks;
  }

  /**
   * 预处理文本，删除多余空白字符，同时保持语义完整性
   */
  private preprocessText(
    text: string,
    options: {
      removeExtraWhitespace?: boolean;
      normalizeUnicode?: boolean;
      removeControlChars?: boolean;
      collapseRepeatedChars?: boolean;
    } = {},
  ): string {
    const {
      removeExtraWhitespace = true,
      normalizeUnicode = true,
      removeControlChars = true,
      collapseRepeatedChars = true,
    } = options;

    if (!text) {
      return text;
    }

    let processed = text;

    // 步骤1: 标准化 Unicode 字符（将全角字符转为半角等）
    if (normalizeUnicode) {
      processed = processed.normalize("NFKC");
    }

    // 步骤2: 删除控制字符（除空格、制表符、换行符外）
    // 使用 Array.from 而非 split("")，避免拆散 UTF-16 代理对
    if (removeControlChars) {
      processed = Array.from(processed)
        .filter((char) => {
          const code = char.codePointAt(0) ?? 0;
          // 保留可打印字符和常见空白字符
          return (
            code >= 32 || // 空格及以上
            char === "\t" || // 制表符
            char === "\n" || // 换行符
            char === "\r" // 回车符
          );
        })
        .join("");
    }

    // 步骤3: 处理多余空白字符
    if (removeExtraWhitespace) {
      // 将所有空白字符（包括换行、制表符）替换为单个空格
      processed = processed.replace(/\s+/g, " ");
      // 去除首尾空格
      processed = processed.trim();
    }

    // 步骤4: 压缩重复的标点符号
    if (collapseRepeatedChars) {
      // 压缩重复的标点符号（保留一个）
      processed = processed.replace(/([!?.,;:])\1+/g, "$1");
    }

    // 步骤5: 清除因编码问题产生的替换字符（U+FFFD）
    // 可能来源：PDF 自定义字体映射异常、tiktoken 不完整 token 反解
    processed = processed.replace(/\uFFFD/g, "");

    return processed;
  }

  /**
   * 释放 tokenizer 资源
   */
  dispose() {
    if (this.tokenizer) {
      this.tokenizer.free();
      this.tokenizer = null;
    }
  }
}
