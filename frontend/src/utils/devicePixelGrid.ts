/**
 * 设备像素网格：把「1 个设备像素 = 多少 CSS px」写进 --gd-device-px。
 *
 * 为什么需要：窗口 CSS 高 = 物理像素 ÷ devicePixelRatio，非整数缩放下常是小数
 * （125% 下 1039 物理像素 → 831.2px），而整数 CSS 偏移换算成设备像素是 n × dpr 个
 * （1px 边框在 125% 下 = 1.25 个设备像素）。于是卡片**内边**、消息滚动口底边会落在
 * 设备像素之间：裁剪按 ceil 外扩、实色填充按 floor 内收，两者差 1 个设备像素 →
 * 滚动内容最后那不足 1 像素的「半行」漏在输入区底边（看着像一条虚线）。
 * 详见 docs/输入区底部泄漏与sticky抖动-亚像素专项留档.md。
 *
 * CSS 侧用 `round(up, <设计值>, var(--gd-device-px))` 把关键偏移吸附到设备网格上
 * （当前消费方：style.css 的 .content-card 底边距）。
 *
 * 只写一次变量，不做每帧测量；跨显示器/改系统缩放时 dpr 会变，由 matchMedia 重算。
 * 未调用（或 SSR）时 CSS 回退 --gd-device-px: 1px：100/125/150/175/200% 这些
 * 「25% 的整数倍」档下 4px 底边距本身就在网格上（4 × dpr 为整数），同样不泄漏。
 */

/** 写入 --gd-device-px 并跟随 dpr 变化（消费方：style.css 的 .content-card） */
export function initDevicePixelGrid(): void {
  if (typeof window === "undefined") return;

  let watcher: MediaQueryList | null = null;

  const apply = () => {
    const dpr = window.devicePixelRatio || 1;
    document.documentElement.style.setProperty("--gd-device-px", `${1 / dpr}px`);

    // dpr 变化（窗口拖到另一块显示器、系统改缩放）时重算：
    // 监听「当前 dpr」的分辨率查询，离开该 dpr 即触发 change
    watcher?.removeEventListener("change", apply);
    watcher = window.matchMedia(`(resolution: ${dpr}dppx)`);
    watcher.addEventListener("change", apply);
  };

  apply();
}
