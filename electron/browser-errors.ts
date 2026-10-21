/**
 * 浏览器 Bridge 的结构化错误。
 *
 * 通过 bridge-server 序列化为 { code, message, details }，
 * 让 backend 能把 NOT_FOUND / STALE_REF / TIMEOUT 等语义透传给脚本。
 */
export class BrowserBridgeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "BrowserBridgeError";
  }
}
