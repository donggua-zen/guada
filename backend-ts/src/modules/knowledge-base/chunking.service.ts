/**
 * 智能文本分块服务
 *
 * ## 设计要点
 *
 * 分块按**文档类型分流**（`chunking-kind.util.ts` 判定），因为"支持 Markdown/代码"
 * 与"把所有空白压成单空格"是自相矛盾的：
 *
 * | 类型 | 预处理 | 切分单元 |
 * |---|---|---|
 * | `markdown` | 保留换行/缩进，NFKC 归一化 | ATX 标题层级；每块带标题路径前缀 |
 * | `code` | 保留换行/缩进，**不**归一化 | 空行分隔的代码块，不切在块内部 |
 * | `table` | 保留换行/缩进，**不**归一化 | 行分组，每组重复表头 |
 * | `prose` | 折叠空白 + 压缩重复标点（沿用原行为） | 句子边界 |
 *
 * 所有类型共用：Token 计数（`TokenizerService`）、重叠窗口、U+FFFD 清理、尾块合并。
 *
 * 检索口径**不受类型影响**：FTS 侧统一走 `kb-tokenizer` 的 jieba 分词，
 * 所以改这里的分类不会让检索行为漂移。
 */

import { Injectable, Logger } from "@nestjs/common";
import { TokenizerService } from "../../common/utils/tokenizer.service";
import {
  CHUNK_STRATEGY_VERSION,
  ChunkKind,
  chunkKindForExtension,
  chunkStrategyTag,
  normalizesUnicode,
  preservesWhitespace,
} from "./chunking-kind.util";

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
    strategy: string; // 分块策略（带版本，见 chunking-kind.util）
  };
}

export interface ChunkingOptions {
  chunkSize?: number; // 分块大小限制（Token 数）
  overlapSize?: number; // 分块重叠大小（Token 数）
  /**
   * 尾块合并阈值（Token 数）：最后一块低于它就并进前一块，避免几十 token 的碎片块。
   *
   * 这是 `kb.json` 里 `chunkMinSize` 的落地语义——该字段此前只被读写、从未被消费。
   */
  chunkMinSize?: number;
  /**
   * 文档类型；缺省时按 `fileExtension` 推导，都没有则按 `prose`（最接近原行为）。
   */
  kind?: ChunkKind;
  /** 源文件扩展名（用于推导 kind） */
  fileExtension?: string;
  modelName?: string; // 已废弃，固定使用 cl100k_base
}

export interface ChunkTextOptions extends ChunkingOptions {
  modelName?: string; // 可以覆盖构造函数中的模型名称
}

const DEFAULT_MODEL = "default";

// 默认分块配置
const DEFAULT_CHUNK_SIZE = 1000;
const DEFAULT_OVERLAP_SIZE = 100;
const DEFAULT_CHUNK_MIN_SIZE = 50;

@Injectable()
export class ChunkingService {
  private readonly logger = new Logger(ChunkingService.name);

  constructor(private readonly tokenizerService: TokenizerService) {}

  /**
   * 计算文本的 Token 数量
   * 不走缓存——文档分块是批量一次性操作，几乎没有重复
   */
  async countTokens(text: string): Promise<number> {
    return this.tokenizerService.countTextTokens(DEFAULT_MODEL, text, false);
  }

  /**
   * 将文本编码为 Token ID 列表
   */
  async encodeText(text: string): Promise<number[]> {
    return this.tokenizerService.encode(DEFAULT_MODEL, text);
  }

  /**
   * 将文本解码为文本
   */
  async decodeTokens(tokenIds: number[]): Promise<string> {
    return this.tokenizerService.decode(DEFAULT_MODEL, tokenIds);
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
   *
   * 合并所有页面为连续文本后统一分块（不再按页边界切割）。
   * 注意：对 `markdown` / `code` 类型，跨页拼接会插入换行（而不是空格），
   * 否则结构会被页边界破坏。
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
        "chunkMinSize" in optionsOrMetadata ||
        "kind" in optionsOrMetadata ||
        "fileExtension" in optionsOrMetadata ||
        "modelName" in optionsOrMetadata
      ) {
        chunkOptions = optionsOrMetadata as ChunkTextOptions;
        chunkMetadata = metadata;
      } else {
        chunkMetadata = optionsOrMetadata as Record<string, any>;
      }
    }

    const kind: ChunkKind =
      chunkOptions.kind ?? chunkKindForExtension(chunkOptions.fileExtension);

    const finalOptions: ChunkingOptions = {
      chunkSize: chunkOptions.chunkSize ?? DEFAULT_CHUNK_SIZE,
      overlapSize: chunkOptions.overlapSize ?? DEFAULT_OVERLAP_SIZE,
      chunkMinSize: chunkOptions.chunkMinSize ?? DEFAULT_CHUNK_MIN_SIZE,
      kind,
    };

    // 合并所有页面文本为连续文档。分隔符按类型选择：
    // 结构化格式用换行（保住结构），散文用换行也无妨（随后会被折叠）。
    const combinedText = pages
      .map((p) => p.text)
      .filter((t) => t && t.trim().length > 0)
      .join("\n");

    if (!combinedText.trim()) {
      return [];
    }

    const processedText = this.preprocessText(combinedText, kind);
    if (!processedText.trim()) {
      return [];
    }

    const strategyTag = chunkStrategyTag(kind);
    let rawChunks = await this.splitByKind(processedText, finalOptions, kind);

    // 尾块合并：低于 chunkMinSize 的最后一块并进前一块。
    // 只处理**尾块**——中间块若也合并，可能把相邻块拼到超过 chunkSize，
    // 反而破坏"每块不超限"这个更重要的不变式。
    rawChunks = await this.mergeShortTail(
      rawChunks,
      finalOptions.chunkMinSize!,
    );

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
          strategy: strategyTag,
        },
      };

      result.push(chunk);
      prevTokensList = await this.encodeText(finalContent);
    }

    this.logger.log(
      `文本分块完成：共${result.length}个分块，类型=${kind}，策略=${strategyTag}（${CHUNK_STRATEGY_VERSION}）`,
    );
    return result;
  }

  // ==========================================================================
  // 预处理（按类型分流）
  // ==========================================================================

  /**
   * 预处理文本。
   *
   * 结构化格式（markdown / code / table）**保留换行与缩进**，只做最小整理；
   * 散文沿用原有的空白折叠 + 重复标点压缩。
   */
  private preprocessText(text: string, kind: ChunkKind): string {
    if (!text) return text;

    let processed = text;

    // 步骤1: Unicode 归一化（代码与表格跳过——字符本身可能有意义，
    // 例如全角字符出现在字符串字面量里）
    if (normalizesUnicode(kind)) {
      processed = processed.normalize("NFKC");
    }

    // 步骤2: 删除控制字符（除空格、制表符、换行符外）
    // 使用 Array.from 而非 split("")，避免拆散 UTF-16 代理对
    processed = Array.from(processed)
      .filter((char) => {
        const code = char.codePointAt(0) ?? 0;
        return code >= 32 || char === "\t" || char === "\n" || char === "\r";
      })
      .join("");

    if (preservesWhitespace(kind)) {
      // 步骤3a: 结构化格式——保住结构与缩进
      processed = processed
        .replace(/\r\n?/g, "\n") // 行尾归一（CRLF / CR → LF）
        .replace(/[ \t]+$/gm, "") // 去行尾空白（无语义，且干扰 FTS）
        .replace(/\n{3,}/g, "\n\n") // 3 个以上连续空行压成 1 个空行
        .replace(/^\n+/, "")
        .replace(/\n+$/, "");
    } else {
      // 步骤3b: 散文——沿用原行为（把换行也压成空格）
      processed = processed.replace(/\s+/g, " ").trim();
      // 步骤4: 压缩重复的标点符号（保留一个）
      processed = processed.replace(/([!?.,;:])\1+/g, "$1");
    }

    // 步骤5: 清除因编码问题产生的替换字符（U+FFFD）
    // 可能来源：PDF 自定义字体映射异常、tiktoken 不完整 token 反解
    processed = processed.replace(/\uFFFD/g, "");

    return processed;
  }

  // ==========================================================================
  // 切分（按类型分流）
  // ==========================================================================

  private async splitByKind(
    text: string,
    options: ChunkingOptions,
    kind: ChunkKind,
  ): Promise<string[]> {
    switch (kind) {
      case "markdown":
        return this.splitMarkdown(text, options);
      case "code":
        return this.splitCode(text, options);
      case "table":
        return this.splitTable(text, options);
      default:
        return this.splitProse(text, options);
    }
  }

  /**
   * 散文：按句子边界切分，保持语义完整性
   *
   * 策略：
   * 1. 按句子边界分割文本，保持语义完整性
   * 2. 累加句子到当前分块，直到加入下一个句子会超出 chunkSize
   * 3. 严禁将一个句子强行拆分或合并进已满的分块
   */
  private async splitProse(
    text: string,
    options: ChunkingOptions,
  ): Promise<string[]> {
    // (?<=[。！？.!?]) 表示在句号、感叹号、问号之后分割，但保留标点在句子末尾
    const sentences = text.split(/(?<=[。！？.!?])/);
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
      const separator = " ";
      const separatorTokens =
        currentChunkSentences.length > 0 ? await this.countTokens(separator) : 0;
      const totalNeeded = currentTokens + separatorTokens + sentenceTokens;

      if (totalNeeded > options.chunkSize! && currentChunkSentences.length > 0) {
        chunks.push(currentChunkSentences.join(" "));
        currentChunkSentences = [sentence];
        currentTokens = sentenceTokens;
      } else {
        currentChunkSentences.push(sentence);
        currentTokens +=
          currentChunkSentences.length > 1
            ? separatorTokens + sentenceTokens
            : sentenceTokens;
      }
    }

    if (currentChunkSentences.length > 0) {
      chunks.push(currentChunkSentences.join(" "));
    }
    return chunks;
  }

  /**
   * Markdown：按 ATX 标题层级切分，每块带**标题路径前缀**。
   *
   * 标题路径（如 `# 项目\n## 安装`）注入每块开头有两个好处：
   * 1. 检索命中后看到的内容自带上下文，不用回看文档结构；
   * 2. 标题词进入向量与 FTS，提升"按章节名搜"的召回。
   *
   * 只产出**有正文**的段落：纯标题节点本身不含内容，其标题已体现在子段的路径前缀里。
   */
  private async splitMarkdown(
    text: string,
    options: ChunkingOptions,
  ): Promise<string[]> {
    const lines = text.split("\n");
    const headingRe = /^(#{1,6})\s+(.*)$/;
    const sections: Array<{ path: string; body: string[] }> = [];
    const stack: Array<{ level: number; title: string }> = [];
    let current: { path: string; body: string[] } = { path: "", body: [] };

    const flush = () => {
      if (current.body.some((l) => l.trim())) sections.push(current);
    };

    for (const line of lines) {
      const m = headingRe.exec(line);
      if (m) {
        flush();
        const level = m[1].length;
        while (stack.length > 0 && stack[stack.length - 1].level >= level) {
          stack.pop();
        }
        stack.push({ level, title: line.trim() });
        current = { path: stack.map((s) => s.title).join("\n"), body: [] };
      } else {
        current.body.push(line);
      }
    }
    flush();

    if (sections.length === 0) {
      // 没有标题的 Markdown：退化为按段落累加
      return this.splitByParagraphs(text, options);
    }

    const out: string[] = [];
    for (const section of sections) {
      const bodyText = section.body.join("\n").trim();
      const full = section.path ? `${section.path}\n${bodyText}` : bodyText;
      if (!full.trim()) continue;

      if ((await this.countTokens(full)) <= options.chunkSize!) {
        out.push(full);
        continue;
      }
      // 超限：按空行段落累加，每块仍带标题路径
      const parts = await this.splitByParagraphs(bodyText, options);
      for (const part of parts) {
        out.push(section.path ? `${section.path}\n${part}` : part);
      }
    }
    return out;
  }

  /** 按空行分隔的段落累加到 chunkSize（markdown 超限段落与无标题文档共用） */
  private async splitByParagraphs(
    text: string,
    options: ChunkingOptions,
  ): Promise<string[]> {
    const paragraphs = text
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    if (paragraphs.length === 0) return [];

    const out: string[] = [];
    let buf: string[] = [];
    let bufTokens = 0;

    for (const para of paragraphs) {
      const paraTokens = await this.countTokens(para);
      if (paraTokens > options.chunkSize!) {
        // 单个段落就超限：先冲刷缓冲区，再按行切这一段落
        if (buf.length > 0) {
          out.push(buf.join("\n\n"));
          buf = [];
          bufTokens = 0;
        }
        out.push(...(await this.splitByLines(para, options)));
        continue;
      }
      if (bufTokens + paraTokens > options.chunkSize! && buf.length > 0) {
        out.push(buf.join("\n\n"));
        buf = [];
        bufTokens = 0;
      }
      buf.push(para);
      bufTokens += paraTokens + 1;
    }
    if (buf.length > 0) out.push(buf.join("\n\n"));
    return out;
  }

  /** 按行累加切分（超大块的最后手段，保证不无限增长） */
  private async splitByLines(
    text: string,
    options: ChunkingOptions,
  ): Promise<string[]> {
    const lines = text.split("\n");
    const out: string[] = [];
    let buf: string[] = [];
    let bufTokens = 0;

    for (const line of lines) {
      const lineTokens = await this.countTokens(line);
      if (bufTokens + lineTokens > options.chunkSize! && buf.length > 0) {
        out.push(buf.join("\n"));
        buf = [];
        bufTokens = 0;
      }
      buf.push(line);
      bufTokens += lineTokens + 1;
    }
    if (buf.length > 0) out.push(buf.join("\n"));
    return out;
  }

  /**
   * 代码：按**空行分隔的代码块**聚合，不在块内部切开。
   *
   * 这是代码语料里最接近"语义单元"的廉价近似：函数/类/配置节之间通常有空行，
   * 而空行内部的连续行（一个函数体、一个 YAML 映射）不该被切断。
   * 单个块自身超限时才退化为按行切（并记录，因为那意味着这个"块"其实很大）。
   */
  private async splitCode(
    text: string,
    options: ChunkingOptions,
  ): Promise<string[]> {
    const blocks: string[] = [];
    let buf: string[] = [];
    for (const line of text.split("\n")) {
      if (line.trim() === "") {
        if (buf.length > 0) {
          blocks.push(buf.join("\n"));
          buf = [];
        }
      } else {
        buf.push(line);
      }
    }
    if (buf.length > 0) blocks.push(buf.join("\n"));

    if (blocks.length === 0) return [];

    const out: string[] = [];
    let cur: string[] = [];
    let curTokens = 0;

    for (const block of blocks) {
      const blockTokens = await this.countTokens(block);

      if (blockTokens > options.chunkSize!) {
        if (cur.length > 0) {
          out.push(cur.join("\n\n"));
          cur = [];
          curTokens = 0;
        }
        this.logger.debug(
          `单个代码块超过 chunkSize（${blockTokens} > ${options.chunkSize}），按行切分`,
        );
        out.push(...(await this.splitByLines(block, options)));
        continue;
      }

      if (curTokens + blockTokens > options.chunkSize! && cur.length > 0) {
        out.push(cur.join("\n\n"));
        cur = [];
        curTokens = 0;
      }
      cur.push(block);
      curTokens += blockTokens + 1;
    }
    if (cur.length > 0) out.push(cur.join("\n\n"));
    return out;
  }

  /**
   * 表格（CSV/TSV）：按行分组，**每组重复表头**。
   *
   * 重复表头是必要的：否则除第一组外的所有分块都只有裸数据行，
   * 向量与 FTS 都无法知道每列是什么，检索质量会明显下降。
   */
  private async splitTable(
    text: string,
    options: ChunkingOptions,
  ): Promise<string[]> {
    const lines = text.split("\n").filter((l) => l.trim() !== "");
    if (lines.length === 0) return [];
    if (lines.length === 1) return [lines[0]];

    const header = lines[0];
    const headerTokens = await this.countTokens(header);

    // 表头本身就超限（极宽表）：退化为按行切，不强求重复表头
    if (headerTokens > options.chunkSize!) {
      return this.splitByLines(lines.join("\n"), options);
    }

    const out: string[] = [];
    let cur: string[] = [header];
    let curTokens = headerTokens;

    for (const row of lines.slice(1)) {
      const rowTokens = await this.countTokens(row);
      if (curTokens + rowTokens > options.chunkSize! && cur.length > 1) {
        out.push(cur.join("\n"));
        cur = [header];
        curTokens = headerTokens;
      }
      cur.push(row);
      curTokens += rowTokens + 1;
    }
    if (cur.length > 1) out.push(cur.join("\n"));
    return out;
  }

  /**
   * 尾块合并：最后一块低于 `minTokens` 时并进前一块。
   *
   * 动机：按标题/空行切分很容易在文档末尾留下一个只有几十 token 的碎片块，
   * 它既占一次嵌入调用，又几乎没有检索价值。
   */
  private async mergeShortTail(
    chunks: string[],
    minTokens: number,
  ): Promise<string[]> {
    if (minTokens <= 0 || chunks.length < 2) return chunks;

    const out = [...chunks];
    const tail = out[out.length - 1];
    if ((await this.countTokens(tail)) >= minTokens) return out;

    out.pop();
    out[out.length - 1] = `${out[out.length - 1]}\n${tail}`;
    return out;
  }
}
