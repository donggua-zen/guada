import { Injectable, Logger } from "@nestjs/common";
import { CommandProviderRegistry } from "../../commands/command-provider-registry.service";
import { ParserResult, CommandContext } from "../../commands/interfaces/command-provider.interface";
import { ContentBlock } from "../../../common/types/conversation.types";

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
  /** 原始文本（不变；正文永不改写，标记保留供前端徽章渲染与历史稳定） */
  originalText: string;
  /** 解析产物注入块（origin='system' 文本块，随消息落库；LLM 可见、前端不渲染） */
  injectionBlocks: ContentBlock[];
}

/**
 * 标签解析器管道
 *
 * 从原始文本中提取 [/type:name attr="val"] 标签，按 type 派发给命令提供者的
 * parse 方法，把解析产物冻结为消息伴随注入块（对齐 DSH skill-invocation：
 * 用户正文原样保留，技能/代理内容以独立注入上下文跟随，写入时一次成形、
 * 历史不再依赖插件存活）。
 *
 * 使用方式：
 *   由 ChatController 注入并调用 parse("请使用[/skill:coder label=\"coder\"]技能")
 *   // result.originalText === result 原文（含标记）
 *   // result.injectionBlocks = [{ type:'text', text:'<skill_content>…', origin:'system' }]
 */
@Injectable()
export class TagParserPipeline {
  private readonly logger = new Logger(TagParserPipeline.name);

  constructor(private readonly commandRegistry: CommandProviderRegistry) {}

  /**
   * 解析完整文本：
   * 1. 提取所有 [/type:name ...] 标签
   * 2. 按 type 派发给对应命令提供者的 parse 方法
   * 3. 相同标签多次出现：只解析一次，注入文案只生成一份
   * 4. 解析返回 undefined / 提供者未注册 / 抛错：该标记无注入文案，正文原样保留
   *
   * @param text 原始文本（含标签）
   * @returns 原始文本（不变）+ 注入块（所有标记的注入文案合并为单个 system 文本块）
   */
  async parse(text: string, ctx?: CommandContext): Promise<PipelineResult> {
    const tags = this.extractTags(text);
    if (tags.length === 0) {
      return { originalText: text, injectionBlocks: [] };
    }

    // 标记总数透传给 parse 上下文（供 provider 判断单/多命令的注入策略）
    const enrichedCtx: CommandContext = { ...ctx, commandCount: tags.length };

    // 按 raw 去重，相同标签只解析一次
    const seen = new Map<string, string>();

    for (const tag of tags) {
      if (seen.has(tag.raw)) continue;

      const parseFn = this.commandRegistry.getParser(tag.type);
      if (!parseFn) {
        // 未注册的命令提供者：无注入文案，正文原样保留
        this.logger.warn(`未注册的命令提供者: [${tag.type}]，保留原始文本`);
        continue;
      }

      let result: ParserResult | undefined;
      try {
        result = await parseFn(tag.attrs, enrichedCtx);
      } catch (error) {
        this.logger.error(`标签解析失败: [${tag.type}] ${tag.raw}`, error);
        continue;
      }

      if (result?.appendix) {
        seen.set(tag.raw, result.appendix);
      }
    }

    // 所有注入文案合并为单个 system 文本块（消息尾部单块追加，KV 前缀零损失）
    const injectionBlocks: ContentBlock[] = [];
    const appendixTexts = [...seen.values()];
    if (appendixTexts.length > 0) {
      const mergedText = appendixTexts.join("\n\n");
      injectionBlocks.push({
        type: "text",
        text: mergedText,
        origin: "system",
      });
      this.logger.debug(
        `标签解析完成: ${tags.length} 个标签(去重${seen.size})，注入文案 ${mergedText.length} 字符`,
      );
    }

    return { originalText: text, injectionBlocks };
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
