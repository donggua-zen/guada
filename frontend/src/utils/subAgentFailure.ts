/**
 * 子代理工具失败的「可读原因」
 *
 * 数据源只有工具结果正文——校验类失败（agentId 未启用/不存在、超每会话 10 个名额）
 * 根本没有子会话，连面板都打不开，正文是唯一的信息载体。覆盖两种真实形态：
 * - 执行器兜底包装：`Tool execution failed: <原始错误>`（ToolExecutor 统一包装）
 * - 插件状态标签：`[Sub-agent ended with error. Reason: <原因>. One-shot ...]`
 *   （后者要等后端在 status==='error' 时补 isError 才会进失败态，先按同一规则解析好）
 *
 * 注意不走 extractResultContent：它内部用 partial-json 容错解析，会把 `[Sub-agent ...]`
 * 这类方括号开头的纯文本误当 JSON 数组解析，正是本函数要保留的形态。
 */
import type { ToolCallResponseEntry } from '@/types/message';

/** 结果正文取字符串（协议上 content 恒为字符串，非法形态兜底序列化，不抛错） */
function responseText(response?: Partial<ToolCallResponseEntry> | null): string {
  const content = response?.content;
  if (typeof content === 'string') return content;
  if (content === null || content === undefined) return '';
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

/** 插件状态标签 `[Sub-agent ended with error. Reason: X. One-shot sub-agent auto-closed.]` → X */
function reasonFromTag(text: string): string | undefined {
  const tag = /\[Sub-agent [^\]]*\]/.exec(text)?.[0];
  if (!tag) return undefined;
  const afterReason = tag.split(/Reason:\s*/)[1];
  if (!afterReason) return undefined;
  return (
    afterReason
      .replace(/\.?\s*(?:One-shot sub-agent auto-closed|Session ID:\s*\S+?)\.?\]?$/, '')
      .trim() || undefined
  );
}

/**
 * 失败原因文本；取不到返回 undefined（调用方只渲染标题，不留空白）。
 */
export function resolveSubAgentFailure(
  response?: Partial<ToolCallResponseEntry> | null,
): string | undefined {
  const text = responseText(response).trim();
  if (!text) return undefined;
  // 执行器兜底前缀先剥掉，剩下的才是真正的原因
  const stripped = text
    .replace(/^Tool execution failed:\s*/i, '')
    .replace(/^Error:\s*/i, '');
  return (reasonFromTag(stripped) ?? stripped).trim() || undefined;
}
