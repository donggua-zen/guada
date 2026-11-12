/**
 * RGBA 像素小工具（脚本侧共用）。
 *
 * 为什么需要：美术素材的透明像素常残留 RGB（alpha=0 但颜色非 0），
 * 缩放/合成/贴到浅色背景时会渗出彩色描边。GPU 上通常看不出来，
 * 但 Codex 契约把它当硬错误，我们的导出/烘焙也应该顺手清掉。
 */

/**
 * 就地把 alpha=0 的像素 RGB 归零。
 * 传入的是 4 通道（RGBA）连续的 Buffer/Uint8Array，原地修改。
 */
export function zeroTransparentRgb(data) {
  let cleaned = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] !== 0) continue;
    if (data[i] !== 0 || data[i + 1] !== 0 || data[i + 2] !== 0) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      cleaned += 1;
    }
  }
  return cleaned;
}
