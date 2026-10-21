/**
 * 摘要输入序列化（无稳定前缀时的紧凑文本方案）
 *
 * 与"原样消息"分支的区别：
 * - 跳过思考块（体积大且非事实）
 * - 工具结果按 MAX_TOOL_RESULT_CHARS 头尾截断（保留"做过什么"的事实，不保留全文）
 * - 图片/文件以轻量标记保留（不把附件本体塞进摘要请求）
 *
 * 该函数同时被两处消费，必须保持单一实现：
 * - LLMSummaryProvider：真的组装序列化摘要请求
 * - CompressionEngine：按序列化后的体积做摘要输入预算判断（否则会按原始消息
 *   的 token 数误判超预算，白白丢弃本可保留的内容）
 */
import type { Message } from '../../../common/types/conversation.types';
import { kbRefsToText } from '../../../common/utils/kb-ref.util';

/** 单条 tool-result 入摘要的最大长度（头尾各半） */
export const SUMMARY_TOOL_RESULT_MAX_CHARS = 2000;

/** 将待遮蔽消息序列化为摘要输入的紧凑文本 */
export function serializeSummaryMessages(
  messages: readonly Message[],
): string {
  const lines: string[] = [];
  for (const msg of messages) {
    // 消息角色已无 event（检查点是 user + source.plugin='compact'，自然进入序列化——模型看到旧摘要做增量合并）
    const parts: string[] = [];
    for (const block of msg.content) {
      switch (block.type) {
        case 'text':
          parts.push(block.text);
          break;
        case 'reasoning':
          break; // 思考块不入摘要（体积大且非事实）
        case 'tool-call':
          parts.push(`[tool_call ${block.name}(${block.arguments})]`);
          break;
        case 'tool-result': {
          const content = block.isError
            ? `[error] ${block.content}`
            : block.content;
          parts.push(
            `[tool_result ${block.name}] ${truncate(
              content,
              SUMMARY_TOOL_RESULT_MAX_CHARS,
            )}`,
          );
          // 工具图片不拆分落库：在摘要里保留轻量标记，避免"工具产出过图片"这一事实丢失
          for (const image of block.images ?? []) {
            parts.push(`[image ${image.name ?? '(attachment)'}]`);
          }
          break;
        }
        case 'image':
          parts.push(`[image ${block.attachment.name ?? '(attachment)'}]`);
          break;
        case 'file':
          parts.push(`[file ${block.attachment.name ?? '(attachment)'}]`);
          break;
        case 'kb-ref':
          // 与请求视图投影口径一致（kbRefProjectionStep）：引用清单进摘要
          parts.push(kbRefsToText(block.kbRefs));
          break;
      }
    }
    const text = parts.join('\n').replace(/\n\s*\n/g, '\n').trim();
    if (text) lines.push(`${msg.role}: ${text}`);
  }
  return lines.join('\n');
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return `${str.slice(0, Math.floor(max / 2))}...[omitted ${str.length - max} chars]...${str.slice(-Math.floor(max / 2))}`;
}
