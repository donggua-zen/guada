import log from "electron-log/main";
import { isNavigableUrl } from "./browser-url";

export interface WindowOpenHandlerOptions {
  /**
   * 白名单 URL 的落地策略：返回 true 表示已处理（通常是开新标签）。
   * 未提供或返回 false/抛错时降级为当前页导航。
   */
  onOpenInNewTab?: (url: string, originWindowId: string) => boolean | void;
  /** 覆盖默认日志器（测试用） */
  logWarn?(message: string): void;
  logInfo?(message: string): void;
}

/**
 * 接管 window.open / target=_blank。
 *
 * 永远 deny 原生新窗口（Chromium 若真开窗会脱离 webview 管理体系）；
 * 白名单 URL 交给调用方开新内部标签，失败降级为当前页导航；
 * 非白名单协议直接拒绝。与 zcode 的 setWindowOpenHandler 语义一致。
 */
export function installWindowOpenHandler(
  webContents: Electron.WebContents,
  windowId: string,
  options: WindowOpenHandlerOptions = {},
): void {
  const warn = options.logWarn ?? ((message: string) => log.warn(message));
  const info = options.logInfo ?? ((message: string) => log.info(message));

  webContents.setWindowOpenHandler(({ url }: { url: string }) => {
    if (!isNavigableUrl(url)) {
      warn(`Blocked new window navigation to non-allowlisted URL: ${url}`);
      return { action: "deny" };
    }

    if (options.onOpenInNewTab) {
      try {
        const handled = options.onOpenInNewTab(url, windowId);
        if (handled !== false) {
          return { action: "deny" };
        }
      } catch (error: any) {
        warn(
          `Open-in-new-tab handler failed (${error?.message || error}), falling back to current-tab navigation: ${url}`,
        );
      }
    }

    info(`Intercepting new window request: ${url}, loading in current webview`);
    webContents.loadURL(url);
    return { action: "deny" };
  });
}
