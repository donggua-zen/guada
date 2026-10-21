import { BrowserBridgeError } from "./browser-errors";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * 导航白名单：仅允许 http/https 与 about:blank。
 *
 * 自动化页面来自外部内容，file:/data:/javascript:/chrome: 都不应该成为
 * 导航目标；页面内的 window.open 转发也走同一判定。
 */
export function isNavigableUrl(raw: string): boolean {
  const value = String(raw ?? "").trim();
  if (!value) return false;
  if (value === "about:blank") return true;
  try {
    const parsed = new URL(value);
    return ALLOWED_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

export function assertNavigableUrl(raw: string, source = "navigation"): void {
  const value = String(raw ?? "").trim();
  if (isNavigableUrl(value)) return;
  throw new BrowserBridgeError(
    "NAVIGATION_BLOCKED",
    `Navigation to "${value}" is not allowed (${source}). Only http:, https:, and about:blank are permitted.`,
    { url: value, source },
  );
}
