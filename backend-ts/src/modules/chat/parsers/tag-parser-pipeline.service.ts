import { Injectable, Logger } from "@nestjs/common";
import { CommandProviderRegistry } from "../../commands/command-provider-registry.service";
import { ParserResult } from "../../commands/interfaces/command-provider.interface";

/** 单个提取的标签 */
export interface ExtractedTag {
  /** 触发字符 '/' 或 '@' */
  trigger: string;
  /** 提供者 id，如 "skill" */
  type: string;
  /** 原始 attrs（name 已合并到 attrs 中供 ITagParser 使用） */
  attrs: Record<string, string>;
  /** 原始字符串 */
  raw: string;
}

/** 解析结果（最终产出） */
export interface PipelineResult {
  /** 原始文本（不变） */
  originalText: string;
  /** 最终文本（所有替换 + 所有 appendix 拼接） */
  content: string;
}

/**
 * 标签解析器管道
 *
 * 从原始文本中提取 [/type:name attr="val"] 标签，从 CommandProviderRegistry
 * 查找对应的命令提供者的 parse 方法进行解析，生成替换后的完整文本。
 *
 * 使用方式：
 *   由 ChatController 注入并调用 parse("请使用[/skill:coder description="..."]技能")
 *   // result.content = "请使用[技能: coder]技能...\n---coder 技能说明---"
 */
@Injectable()
export class TagParserPipeline {
  private readonly logger = new Logger(TagParserPipeline.name);

  constructor(private readonly commandRegistry: CommandProviderRegistry) {}

  /**
   * 解析完整文本：
   * 1. 提取所有 [/type:name ...] 标签
   * 2. 按 type 派发给对应命令提供者的 parse 方法
   * 3. 相同标签多次出现：替换全部，appendix 只附加一次
   * 4. 解析返回 undefined：原样保留，不做替换
   *
   * @param text 原始文本（含标签）
   * @returns 解析结果（原始文本 + 最终文本）
   */
  async parse(text: string): Promise<PipelineResult> {
    const tags = this.extractTags(text);
    if (tags.length === 0) {
      return { originalText: text, content: text };
    }

    // 按 raw 去重，相同标签只解析一次
    const seen = new Map<string, { replacement: string; appendix?: string }>();

    for (const tag of tags) {
      if (seen.has(tag.raw)) continue;

      const parseFn = this.commandRegistry.getParser(tag.type);
      if (!parseFn) {
        // 未注册的命令提供者：保留原始文本不变
        this.logger.warn(`未注册的命令提供者: [${tag.type}]，保留原始文本`);
        seen.set(tag.raw, { replacement: tag.raw });
        continue;
      }

      let result: ParserResult | undefined;
      try {
        result = await parseFn(tag.attrs);
      } catch (error) {
        this.logger.error(`标签解析失败: [${tag.type}] ${tag.raw}`, error);
        seen.set(tag.raw, { replacement: tag.raw });
        continue;
      }

      if (result === undefined) {
        // 解析器返回 undefined：不支持解析，原样保留
        seen.set(tag.raw, { replacement: tag.raw });
        continue;
      }

      seen.set(tag.raw, {
        replacement: result.replacement,
        appendix: result.appendix,
      });
    }

    // 执行替换（使用 replaceAll 替换全部匹配项）
    let processedText = text;
    const appendixes: string[] = [];

    for (const [raw, { replacement, appendix }] of seen) {
      // 全局替换所有相同的标签
      processedText = processedText.replaceAll(raw, replacement);
      if (appendix) {
        appendixes.push(appendix);
      }
    }

    // 拼接附录
    let finalContent = processedText;
    if (appendixes.length > 0) {
      finalContent += "\n" + appendixes.join("\n");
    }

    if (finalContent !== text) {
      this.logger.debug(
        `标签解析完成: ${tags.length} 个标签(去重${seen.size})，原始 ${text.length} 字符 → 最终 ${finalContent.length} 字符`,
      );
    }

    return { originalText: text, content: finalContent };
  }

  /**
   * 从原始文本中提取所有 [/type:name attr="val"] 和 [@type:name attr="val"] 标签
   */
  private extractTags(text: string): ExtractedTag[] {
    const tags: ExtractedTag[] = [];
    const regex = /\[([\/@])([\w\-\/]+):([\w-]+)((?:\s+\w+="[^"]*")*)\s*\]/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const raw = match[0];
      const trigger = match[1]; // '/' or '@'
      const type = match[2]; // e.g. "skill"
      const name = match[3]; // e.g. "coder"
      const attrsStr = match[4].trim();

      const attrs: Record<string, string> = { name };
      if (attrsStr) {
        const attrRegex = /(\w+)="([^"]*)"/g;
        let attrMatch: RegExpExecArray | null;
        while ((attrMatch = attrRegex.exec(attrsStr)) !== null) {
          attrs[attrMatch[1]] = attrMatch[2];
        }
      }

      tags.push({ trigger, type, attrs, raw });
    }

    return tags;
  }
}
