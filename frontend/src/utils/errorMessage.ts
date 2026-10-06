import { isAxiosError } from 'axios'
import { ApiError, AuthError } from './errors'

/**
 * 从未知抛出值中提取可展示消息。
 *
 * strict 模式下 catch 变量为 unknown（useUnknownInCatchVariables），
 * 各处 `error.message` 读取统一收敛到本工具。
 *
 * 服务端消息的两个来源（按优先级）：
 * - ApiService 拦截器已把 response.data.message/error 提取进 ApiError.message，直接读 message 即可；
 * - 少数绕过拦截器的直连 axios 调用抛原生 AxiosError，这里补提 response.data.message/detail。
 */
export function getErrorMessage(error: unknown): string {
  if (isAxiosError(error)) {
    const data = error.response?.data as { message?: unknown; detail?: unknown } | undefined
    const server =
      typeof data?.message === 'string' && data.message
        ? data.message
        : typeof data?.detail === 'string' && data.detail
          ? data.detail
          : undefined
    return server ?? error.message
  }
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  const fallback = String(error ?? '')
  return fallback === '[object Object]' ? JSON.stringify(error) : fallback
}

/**
 * 提取 API 错误的 HTTP 状态码（404/409 等分支判断用），非 API 错误返回 undefined。
 *
 * 拦截器产物 ApiError/AuthError 自带 statusCode；直连 axios 抛出的原生错误读 response.status。
 * NetworkError 无状态码（连接都没建立），正确地落到 undefined。
 */
export function getApiErrorStatus(error: unknown): number | undefined {
  if (error instanceof ApiError) return error.statusCode
  if (error instanceof AuthError) return error.statusCode
  if (isAxiosError(error)) return error.response?.status
  return undefined
}
