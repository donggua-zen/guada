// composables/useDevice.ts
/**
 * 设备类型判定
 *
 * 移动端适配的唯一开关。判定基准是「设备类型」而非窗口宽度：
 * Electron 窗口最窄 700-800px，若按宽度判定会把正常小窗误判成移动端，
 * 因此 Electron 环境永远不进入移动模式；桌面宽窗（Web ≥1024px）同样不受影响。
 */

/** Electron 环境：window.electronAPI 由 preload 注入 */
export const isElectron = typeof window !== "undefined" && window.electronAPI !== undefined;

/** UA 是否为移动设备（手机 / 安卓平板；iPad 的 UA 伪装成桌面 Mac，单独用触摸点数识别） */
function detectMobileUA(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isMobileUA = /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(ua);
  // iPadOS 13+ 桌面 UA：Mac 平台 + 多点触控
  const isIPadDesktopUA =
    /Macintosh/i.test(ua) && typeof navigator.maxTouchPoints === "number" && navigator.maxTouchPoints > 1;
  return isMobileUA || isIPadDesktopUA;
}

const mobileUA = detectMobileUA();

/** 纯触屏（无鼠标）：手机 / 平板。Electron 桌面（含触屏一体机）不会命中 UA 检测 */
const coarsePointer =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(pointer: coarse)").matches;

/**
 * 移动设备 = 非 Electron 且（移动 UA 或纯触屏指针）
 * index.html 内联脚本用同样的逻辑打 html.mobile / html.mobile.touch class
 *
 * dev 覆盖：URL 带 ?mobile=1 时强制按移动设备处理（桌面浏览器联调抽屉/布局用；
 * 生产构建该分支仍在但无副作用，也可配合真机调试）
 */
function detectDevOverride(): boolean {
  if (typeof location === "undefined") return false;
  try {
    return new URLSearchParams(location.search).get("mobile") === "1";
  } catch {
    return false;
  }
}

export const isMobileDevice: boolean =
  !isElectron && (mobileUA || coarsePointer || detectDevOverride());

/** 触屏优先（命中区增强用）；移动设备上基本恒真，桌面触屏一体机也可能为 true */
export const isTouchDevice: boolean = !isElectron && coarsePointer;

/** 模块加载时同步应用 html class（供非组件模块 / 早期样式使用；index.html 已提前打过，此处兜底） */
export function applyDeviceClass(): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  el.classList.toggle("mobile", isMobileDevice);
  el.classList.toggle("touch", isTouchDevice);
}
