/**
 * Codex 图集的几何推导。
 *
 * 契约固定「8 列 × 9 行」，但**单格尺寸并不唯一**：
 * - Codex 官方/hatch-pet 产物：1536×1872 → 192×208
 * - ChatGPT 桌面端导出：1536×2288 → 192×254.22（不是整数！）
 * 所以不能把 192×208 写死，按图片宽高除以网格数现算，画的时候用浮点坐标即可。
 */

/** 图集列数（固定） */
export const ATLAS_COLS = 8;
/** 图集行数 = 状态数（固定） */
export const ATLAS_ROWS_COUNT = 9;

export interface AtlasCell {
  /** 单格宽（可能不是整数，如 1536/8=192 是整数，但高度常常不是） */
  width: number;
  height: number;
}

/**
 * 由整图尺寸推导单格尺寸。
 * 返回 null 表示不是合法图集（宽高比太离谱 / 单元格过小）。
 */
export function deriveAtlasCell(width: number, height: number): AtlasCell | null {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;

  const cellW = width / ATLAS_COLS;
  const cellH = height / ATLAS_ROWS_COUNT;
  // 单格至少 128×128：再小的图集在桌面上糊成一片
  if (cellW < 128 || cellH < 128) return null;
  // 单格不能太扁/太瘦（官方 0.92，ChatGPT 导出 0.76）
  const ratio = cellW / cellH;
  if (ratio < 0.5 || ratio > 1.6) return null;

  return { width: cellW, height: cellH };
}

/** 是否正好是 Codex 官方规格（只用于日志/提示，不作为拒绝理由） */
export function isOfficialAtlasSize(width: number, height: number): boolean {
  return width === 1536 && height === 1872;
}
