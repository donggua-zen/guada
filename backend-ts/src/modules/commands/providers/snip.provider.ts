import { Injectable, Logger } from "@nestjs/common";
import {
  ICommandProvider,
  CommandItem,
  ParserResult,
} from "../interfaces/command-provider.interface";

/**
 * 解码 base64 字符串（支持 UTF-8）
 */
function decodeBase64(str: string): string {
  try {
    const binary = Buffer.from(str, "base64");
    return binary.toString("utf-8");
  } catch {
    return "";
  }
}

/**
 * Snip 命令提供者
 *
 * 处理 [/snip:quote path="..." start="15" end="22" content="base64..." label="..."] 标签。
 * 将选区文本作为 appendix 追加到消息末尾，供 AI 查看。
 *
 * - content 属性：base64 编码的选区文本（超长选区已在前端截断并附加提示）
 * - replacement：行内保留引用标记 `选区:label`
 * - appendix：选区内容（含文件路径和行范围标注）
 */
@Injectable()
export class SnipCommandProvider implements ICommandProvider {
  private readonly logger = new Logger("SnipCommandProvider");
  readonly id = "snip";
  readonly trigger = "slash" as const;

  fetchItems(): CommandItem[] {
    return [];
  }

  parse(attrs: Record<string, string>): ParserResult | undefined {
    const filePath = attrs.path || "";
    const start = attrs.start || "";
    const end = attrs.end || "";
    const label = attrs.label || filePath;

    // Build line range label (L15-L22 or L15 or empty)
    const range = start && end
      ? (start === end ? `L${start}` : `L${start}-L${end}`)
      : (start ? `L${start}` : "");

    // Decode selected text content
    const content = attrs.content ? decodeBase64(attrs.content) : "";

    const header = `Snippet: ${filePath}${range ? ` ${range}` : ""}`;
    const appendix = content ? `${header}\n${content}` : header;

    return {
      replacement: `\`选区:${label}\``,
      appendix,
    };
  }
}
