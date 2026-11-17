/**
 * 日志里的参数预览：保留原文（便于判断模型到底写了什么），过长时截断，
 * 避免一条异常工具参数把日志文件撑爆。日志只落本地，不发给上游。
 */
export function logPreview(value: unknown, max = 4000): string {
  let text: string;
  if (typeof value === "string") {
    text = value;
  } else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…(+${text.length - max} chars)`;
}
