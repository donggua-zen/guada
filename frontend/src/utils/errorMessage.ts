/**
 * 从未知抛出值中提取可展示消息。
 *
 * strict 模式下 catch 变量为 unknown（useUnknownInCatchVariables），
 * 各处 `error.message` 读取统一收敛到本工具。
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  const fallback = String(error ?? '')
  return fallback === '[object Object]' ? JSON.stringify(error) : fallback
}
