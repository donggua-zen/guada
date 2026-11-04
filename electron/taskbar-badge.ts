/**
 * 任务栏未读角标（Windows overlay / macOS Dock）
 *
 * 原理参考 zcode（packages/desktop/src/main/unreadBadge.ts）：
 * - Windows 的 app.setBadgeCount 是 no-op，任务栏角标必须走
 *   BrowserWindow.setOverlayIcon(nativeImage, description)；
 * - overlay 图由主进程纯像素绘制（无第三方依赖），输出预乘 alpha 的 BGRA，
 *   与 nativeImage.addRepresentation({ buffer }) 的契约一致；
 * - Windows 固定把 overlay 显示为 16×16，直接传硬边圆再让 Shell 缩放会发糊，
 *   因此在目标尺寸上做 4× 超采样，产出抗锯齿纯红圆点，并同时提供
 *   1x(16px) + 2x(32px) 两档 representation 适配高 DPI；
 * - Win10 与 Win11 的 Shell 对 16×16 overlay 的任务栏落点不同：
 *   Win10 需要画布内右下锚定（圆心 11.25），Win11 已把整张 overlay 放到
 *   图标角上（画布内居中），否则形成二次偏移。
 */

/** zcode 实测的任务栏角标红色（Material Red 600）。 */
const BADGE_DOT_COLOR = { red: 229, green: 57, blue: 53 } as const;

export type TaskbarOverlayLayout = "windows-10" | "windows-11";

export interface AntialiasedDotOptions {
  size: number;
  centerX: number;
  centerY: number;
  radius: number;
  /** 超采样倍数，默认 4。 */
  supersample?: number;
}

/**
 * 4× 超采样的纯红预乘 BGRA 圆点。
 * 圆内红色、边缘按覆盖率半透明（抗锯齿），圆外全透明，不遮挡底图。
 */
export function renderAntialiasedStatusDotPixels(
  options: AntialiasedDotOptions,
): Uint8Array {
  const supersample = options.supersample ?? 4;
  const pixels = new Uint8Array(options.size * options.size * 4);
  const samplesPerPixel = supersample * supersample;

  for (let y = 0; y < options.size; y += 1) {
    for (let x = 0; x < options.size; x += 1) {
      let coveredSamples = 0;
      for (let sy = 0; sy < supersample; sy += 1) {
        for (let sx = 0; sx < supersample; sx += 1) {
          const sampleX = x + (sx + 0.5) / supersample;
          const sampleY = y + (sy + 0.5) / supersample;
          const dx = sampleX - options.centerX;
          const dy = sampleY - options.centerY;
          if (dx * dx + dy * dy <= options.radius * options.radius) {
            coveredSamples += 1;
          }
        }
      }

      if (coveredSamples === 0) continue;
      const coverage = coveredSamples / samplesPerPixel;
      const offset = (y * options.size + x) * 4;
      // 预乘 alpha：out = color × coverage，边缘保持同一红色，不与底图混成白边。
      pixels[offset] = Math.round(BADGE_DOT_COLOR.blue * coverage);
      pixels[offset + 1] = Math.round(BADGE_DOT_COLOR.green * coverage);
      pixels[offset + 2] = Math.round(BADGE_DOT_COLOR.red * coverage);
      pixels[offset + 3] = Math.round(coverage * 255);
    }
  }

  return pixels;
}

/**
 * 任务栏 overlay 圆点。scale=1 产出原生 16px 表示，scale=2 产出 32px 高 DPI 表示；
 * layout 决定画布内圆心落点（见文件头注释）。
 */
export function renderTaskbarStatusDotPixels(
  scale: 1 | 2 = 1,
  layout: TaskbarOverlayLayout = "windows-11",
): Uint8Array {
  const center = layout === "windows-10" ? 11.25 : 8;
  return renderAntialiasedStatusDotPixels({
    size: 16 * scale,
    centerX: center * scale,
    centerY: center * scale,
    radius: 3.5 * scale,
  });
}

/** Windows build 号 ≥ 22000 为 Windows 11。 */
export function resolveTaskbarOverlayLayout(
  platform: NodeJS.Platform,
  osRelease: string,
): TaskbarOverlayLayout {
  if (platform !== "win32") return "windows-11";
  const build = Number.parseInt(osRelease.split(".")[2] ?? "", 10);
  return Number.isFinite(build) && build >= 22000 ? "windows-11" : "windows-10";
}

/** createTaskbarOverlayImage 所需的 nativeImage 最小能力面，便于单测注入（type-only import，运行时零依赖）。 */
export interface OverlayImageFactory {
  createEmpty(): import("electron").NativeImage;
}

/**
 * 组装 1x + 2x 两档 representation 的 overlay 图。
 * nativeImage 实例由调用方注入，保持本模块不依赖 electron 运行时、可独立测试。
 */
export function createTaskbarOverlayImage(
  layout: TaskbarOverlayLayout,
  nativeImageFactory: OverlayImageFactory,
): import("electron").NativeImage {
  const image = nativeImageFactory.createEmpty();
  image.addRepresentation({
    scaleFactor: 1,
    width: 16,
    height: 16,
    buffer: Buffer.from(renderTaskbarStatusDotPixels(1, layout)),
  });
  image.addRepresentation({
    scaleFactor: 2,
    width: 32,
    height: 32,
    buffer: Buffer.from(renderTaskbarStatusDotPixels(2, layout)),
  });
  return image;
}
