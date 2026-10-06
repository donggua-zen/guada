/**
 * 工具结果内容提取
 *
 * 从 MessageToolCalls.vue 抽出的共享逻辑：解包 toolResponses 条目中的
 * { content } 包装，供通用结果渲染与定制渲染器（terminal 输出）共用。
 */
import { parse as partialParse } from "partial-json";
import type { ToolCallResponseEntry } from "@/types/message";

/**
 * 解包工具结果：
 * - 字符串先 partialParse；含 content 字段则继续解包（可能为 JSON 字符串）
 * - partialParse 会把 "[ ] step1" 等非 JSON 文本误解析为空数组 []，此时回退原始字符串
 */
export function extractResultContent(
  response: ToolCallResponseEntry | string | null | undefined,
): unknown {
  if (!response) return null;
  try {
    const parsed =
      typeof response === "string" ? partialParse(response) : response;
    if (parsed.content) {
      try {
        const parsedContent =
          typeof parsed.content === "string"
            ? partialParse(parsed.content)
            : parsed.content;
        if (Array.isArray(parsedContent) && parsedContent.length === 0) {
          return parsed.content;
        }
        return parsedContent;
      } catch {
        return parsed.content;
      }
    }
    return parsed;
  } catch {
    return null;
  }
}
