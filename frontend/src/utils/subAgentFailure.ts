/**
 * 子代理工具失败的「可读原因」
 *
 * 数据源只有工具结果正文——校验类失败（agentId 未启用/不存在、超每会话 10 个名额）
 * 根本没有子会话，连面板都打不开，正文是唯一的信息载体。覆盖两种真实形态：
 * - 执行器兜底包装：`Tool execution failed: <原始错误>`（ToolExecutor 统一包装）
 * - 插件状态标签：`[Sub-agent ended with error. Reason: <原因>.]`
 *
 * 白名单制（认不出就不显示）：正文里既有失败信息、也有**成功信息**——
 * 后台派发成功的结果正文是 `[Sub-agent running. Job ID: job-...]`，正常完成是
 * `[Sub-agent completed.]`。它们与失败同样以方括号标签呈现，若「解析不出就原样返回」，
 * 一旦裁决口径出错（例如某个正常结束原因被误判失败），这些成功文案就会被当作
 * 失败原因用红色块摊在对话流里——反而掩盖了真正的原因。因此这里只认已知失败形态，
 * 其余一律返回 undefined（调用方只渲染标题，不留空白）。
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

/** 执行器统一包装前缀（ToolExecutor 兜底） */
const EXECUTOR_PREFIX = /^Tool execution failed:\s*/i;

/** 通用错误前缀 */
const ERROR_PREFIX = /^Error:\s*/i;

/**
 * 「说结果好」的方括号标签：运行中 ACK 与正常完成。
 *
 * 它们与失败标签同样以 `[Sub-agent ...]` 呈现，必须先行排除——否则一旦裁决
 * 口径漂移（把正常结束原因误判成失败），这段成功文案就会顶替真正的原因显示出来。
 */
const NON_FAILURE_TAG = /\[Sub-agent (?:running|completed)\b/i;

/**
 * 插件状态标签 `[Sub-agent ended with error. Reason: X.]` → X
 *
 * 同时兼容历史会话里带 `One-shot sub-agent auto-closed.` / `Sub-agent auto-closed.`
 * 尾缀的旧文案（旧日志永不重写，解析必须容错）。
 * 只匹配 `ended with error`，成功/运行中的标签不算原因。
 */
function reasonFromTag(text: string): string | undefined {
  const tag = /\[Sub-agent ended with error[^\]]*\]/.exec(text)?.[0];
  if (!tag) return undefined;
  const afterReason = tag.split(/Reason:\s*/)[1];
  // 失败标签但没写 Reason：标签本身已说明「运行以错误结束」，原样保留比丢掉更有用
  if (!afterReason) return tag;
  return (
    afterReason
      .replace(
        /\.?\s*(?:One-shot sub-agent auto-closed|Sub-agent auto-closed|Session ID:\s*\S+?)\.?\]?$/,
        '',
      )
      .trim() || tag
  );
}

/**
 * 失败原因文本；取不到返回 undefined（调用方只渲染标题，不留空白）。
 *
 * 只认两类来源：
 * 1. 执行器包装的正文（`Tool execution failed: X`）——剥前缀后即为原因
 * 2. 插件的失败状态标签（`[Sub-agent ended with error. Reason: X]`）——取 Reason 段
 *
 * 无包装的裸文本不再原样返回：它同样可能是成功文案（`[Sub-agent running. ...]`）
 * 或工具的正常输出。结构化原因请优先用 `tool.subAgentError`（结算事件下发）。
 */
export function resolveSubAgentFailure(
  response?: Partial<ToolCallResponseEntry> | null,
): string | undefined {
  const text = responseText(response).trim();
  if (!text) return undefined;
  // 成功文案先行排除：它出现在正文里就说明这次调用不是失败，
  // 即使外层被兜底包了一层也一样（原因不该是「它成功了」）
  if (NON_FAILURE_TAG.test(text)) return undefined;
  const fromTag = reasonFromTag(text);
  if (fromTag) return fromTag;
  // 执行器包装：前缀之后就是原始错误，可信（工具执行真的抛了）
  if (EXECUTOR_PREFIX.test(text)) {
    const stripped = text.replace(EXECUTOR_PREFIX, '').replace(ERROR_PREFIX, '');
    return stripped.trim() || undefined;
  }
  return undefined;
}
