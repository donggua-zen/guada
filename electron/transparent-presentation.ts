/**
 * 窗口隐藏到托盘时的临时「透明 presentation」。
 *
 * Electron/Chromium 的主窗口隐藏（而不是最小化）后，窗口合成器不再产帧，
 * webview guest 连首帧都没有，capturePage / CDP 截图只能等超时。
 * 这里在截图生命周期内做一次对用户不可见的 show：
 *
 *   保存 opacity → setOpacity(0) → Windows 先 setSkipTaskbar(true)
 *   → showInactive() → 等待 PRESENTATION_GRACE_MS 再截图
 *
 * release 时恢复 opacity/taskbar，若用户没有重新聚焦窗口则再 hide 回去。
 * 用户中途 focus 说明窗口所有权已回到用户，release 不再 hide。
 */

export interface PresentationWindow {
  isDestroyed(): boolean;
  isVisible?(): boolean;
  isMinimized?(): boolean;
  isFocused?(): boolean;
  getOpacity?(): number;
  setOpacity?(opacity: number): void;
  showInactive?(): void;
  hide?(): void;
  setSkipTaskbar?(skip: boolean): void;
  on?(event: "focus", listener: () => void): void;
  removeListener?(event: "focus", listener: () => void): void;
}

export interface TransparentPresentation {
  release(): void;
}

export interface TransparentPresentationOptions {
  /** Windows 上 showInactive 前先隐藏任务栏图标，避免任务栏闪烁 */
  hideTaskbar?: boolean;
  log?(message: string): void;
}

/** showInactive 后 Viz surface 建立前的有界等待（与 zcode 保持一致） */
export const PRESENTATION_GRACE_MS = 100;

export function acquireTransparentPresentation(
  win: PresentationWindow,
  options: TransparentPresentationOptions = {},
): TransparentPresentation | undefined {
  if (win.isDestroyed() || win.isVisible?.() !== false) return undefined;
  // 最小化窗口无法安全地用 showInactive 拿帧，直接放弃（与 zcode 一致）。
  if (win.isMinimized?.() === true) return undefined;
  if (
    !win.isFocused ||
    !win.getOpacity ||
    !win.setOpacity ||
    !win.showInactive ||
    !win.hide ||
    !win.on ||
    !win.removeListener
  ) {
    options.log?.("[transparent-presentation] window capabilities unavailable");
    return undefined;
  }
  if (options.hideTaskbar && !win.setSkipTaskbar) {
    options.log?.("[transparent-presentation] skipTaskbar unavailable");
    return undefined;
  }

  let originalOpacity: number;
  try {
    originalOpacity = win.getOpacity();
  } catch {
    options.log?.("[transparent-presentation] opacity read failed");
    return undefined;
  }

  let released = false;
  let taskbarHidden = false;

  const release = (preserveVisibility: boolean): void => {
    if (released) return;
    released = true;
    try {
      win.removeListener?.("focus", handleFocus);
    } catch {
      options.log?.("[transparent-presentation] focus listener cleanup failed");
    }
    if (win.isDestroyed()) return;

    try {
      if (!preserveVisibility && !win.isFocused?.()) {
        win.hide?.();
      }
    } catch {
      options.log?.("[transparent-presentation] hide failed");
    } finally {
      if (!win.isDestroyed()) {
        try {
          win.setOpacity?.(originalOpacity);
        } catch {
          options.log?.("[transparent-presentation] opacity restore failed");
        }
        if (taskbarHidden) {
          try {
            win.setSkipTaskbar?.(false);
          } catch {
            options.log?.("[transparent-presentation] taskbar restore failed");
          }
        }
      }
    }
  };

  function handleFocus(): void {
    // 用户主动恢复窗口：只恢复透明度，后续 release 不允许再 hide。
    release(true);
  }

  try {
    if (options.hideTaskbar) {
      win.setSkipTaskbar?.(true);
      taskbarHidden = true;
    }
    win.setOpacity(0);
    win.on("focus", handleFocus);
    win.showInactive!();
  } catch {
    release(true);
    options.log?.("[transparent-presentation] bootstrap failed");
    return undefined;
  }

  return { release: () => release(false) };
}
