/**
 * Codex 桌宠图集校验器（契约见 docs/pet-format-codex.md）。
 *
 * 用法：
 *   node scripts/validate-pet-atlas.mjs <petDir> [--json]
 *
 * 校验项：
 * 1. pet.json 必填字段齐全，spritesheetPath 指向的文件存在
 * 2. 图集尺寸必须 1536×1872，且是 WebP/PNG
 * 3. 每行「已用格」必须非空（有不透明像素）
 * 4. 每行「未用格」必须完全透明
 * 5. 透明像素不得残留 RGB（alpha=0 但 r/g/b≠0，缩放后会出现彩色描边）
 *
 * 退出码：0 = 通过，1 = 失败（便于 CI / 导入流程拦截）。
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const sharp = require("../backend-ts/node_modules/sharp");

/** 图集几何（格式硬约束） */
export const ATLAS_WIDTH = 1536;
export const ATLAS_HEIGHT = 1872;
export const CELL_WIDTH = 192;
export const CELL_HEIGHT = 208;
export const COLUMNS = 8;

/**
 * 行契约：顺序固定，帧数固定，逐帧时长固定。
 * 时长是格式的一部分——AtlasProvider 直接用它推进帧。
 */
export const ATLAS_ROWS = [
  { state: "idle", frames: 6, durations: [280, 110, 110, 140, 140, 320] },
  { state: "running-right", frames: 8, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  { state: "running-left", frames: 8, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  { state: "waving", frames: 4, durations: [140, 140, 140, 280] },
  { state: "jumping", frames: 5, durations: [140, 140, 140, 140, 280] },
  { state: "failed", frames: 8, durations: [140, 140, 140, 140, 140, 140, 140, 240] },
  { state: "waiting", frames: 6, durations: [150, 150, 150, 150, 150, 260] },
  { state: "running", frames: 6, durations: [120, 120, 120, 120, 120, 220] },
  { state: "review", frames: 6, durations: [150, 150, 150, 150, 150, 280] },
];

/** alpha > 该阈值才算「有像素」 */
const ALPHA_THRESHOLD = 16;

/**
 * 校验一个宠物目录。返回 { ok, errors[], warnings[], info }。
 * 不抛异常——调用方（导入流程）需要拿到结构化结果而不是异常。
 */
export async function validatePetDir(dir) {
  const errors = [];
  const warnings = [];

  // ── 1. pet.json ──
  const configPath = path.join(dir, "pet.json");
  if (!fs.existsSync(configPath)) {
    return { ok: false, errors: [`缺少 pet.json: ${configPath}`], warnings, info: null };
  }
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    return { ok: false, errors: [`pet.json 解析失败: ${error.message}`], warnings, info: null };
  }
  if (!config || typeof config !== "object") {
    return { ok: false, errors: ["pet.json 不是对象"], warnings, info: null };
  }
  for (const field of ["id", "displayName", "spritesheetPath"]) {
    if (typeof config[field] !== "string" || !config[field].trim()) {
      errors.push(`pet.json 缺少必填字段 ${field}`);
    }
  }

  const sheetName = typeof config.spritesheetPath === "string" && config.spritesheetPath.trim()
    ? config.spritesheetPath.trim()
    : "spritesheet.webp";
  const sheetPath = path.join(dir, sheetName);
  if (!fs.existsSync(sheetPath)) {
    errors.push(`图集文件不存在: ${sheetPath}`);
    return { ok: false, errors, warnings, info: null };
  }

  // 文件名带路径分隔符是危险信号（可能指向目录外）
  if (sheetName.includes("/") || sheetName.includes("\\") || sheetName.includes("..")) {
    errors.push(`spritesheetPath 只能是同目录文件名，实际 ${sheetName}`);
  }

  // ── 2. 尺寸：只要求能按 8×9 切开，不锁死 1536×1872 ──
  const meta = await sharp(sheetPath).metadata();
  if (!["webp", "png"].includes(meta.format)) {
    errors.push(`图集格式必须是 webp/png，实际 ${meta.format}`);
  }
  // 单格尺寸按整图现算：ChatGPT 导出的是 1536×2288（单格 192×254.2），同样合法
  const cellW = meta.width / COLUMNS;
  const cellH = meta.height / ATLAS_ROWS.length;
  const cellOk =
    Number.isFinite(cellW) &&
    Number.isFinite(cellH) &&
    cellW >= 128 &&
    cellH >= 128 &&
    cellW / cellH >= 0.5 &&
    cellW / cellH <= 1.6;
  if (!cellOk) {
    errors.push(
      `图集尺寸不合法：${meta.width}×${meta.height}（需要 8 列×9 行、单格至少 128×128）`,
    );
  } else if (meta.width !== ATLAS_WIDTH || meta.height !== ATLAS_HEIGHT) {
    warnings.push(
      `非官方尺寸 ${meta.width}×${meta.height}（官方 ${ATLAS_WIDTH}×${ATLAS_HEIGHT}），按单格 ${cellW.toFixed(1)}×${cellH.toFixed(1)} 处理`,
    );
  }

  if (errors.length > 0) {
    // 文件/尺寸层面的错误已经足够判定失败，不再做像素扫描（扫也定位不准）
    return { ok: false, errors, warnings, info: { config, sheetPath } };
  }

  // ── 3/4/5. 逐格扫描 ──
  const { data, info } = await sharp(sheetPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const px = (x, y) => (y * info.width + x) * 4;

  // 透明残留 RGB：整图扫一遍（alpha=0 但颜色非 0）
  let residuePixels = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0 && (data[i] !== 0 || data[i + 1] !== 0 || data[i + 2] !== 0)) {
      residuePixels += 1;
    }
  }
  if (residuePixels > 0) {
    // WebP 只是警告：libwebp 默认 exact=0，会主动改写 alpha=0 处的 RGB 来提升压缩率，
    // 这不是素材问题、也无法通过 sharp 关闭。合成时按预乘 alpha 处理不受影响。
    // PNG 则要求严格为零（无损、没有这种改写行为）。
    const message = `透明像素残留 RGB ${residuePixels} 处（alpha=0 但颜色非 0）`;
    if (meta.format === "webp") {
      warnings.push(`${message}；WebP 编码器行为，可忽略`);
    } else {
      errors.push(`${message}，缩小时会出现彩色描边`);
    }
  }

  // 扫描用的整格边界（单格可能是小数，取整后逐格扫描）
  const scanW = Math.round(cellW);
  const scanH = Math.round(cellH);

  for (let row = 0; row < ATLAS_ROWS.length; row += 1) {
    const spec = ATLAS_ROWS[row];
    for (let col = 0; col < COLUMNS; col += 1) {
      const used = col < spec.frames;
      const originX = Math.round(col * cellW);
      const originY = Math.round(row * cellH);
      let opaque = 0;
      for (let y = 0; y < scanH && (used ? opaque === 0 : true); y += 1) {
        for (let x = 0; x < scanW; x += 1) {
          const o = px(originX + x, originY + y);
          if (data[o + 3] > ALPHA_THRESHOLD) {
            opaque += 1;
            if (used) break;
          }
        }
        if (used && opaque > 0) break;
      }

      if (used && opaque === 0) {
        errors.push(`第 ${row} 行（${spec.state}）第 ${col} 帧是空的（应为已用格）`);
      }
      if (!used && opaque > 0) {
        errors.push(`第 ${row} 行（${spec.state}）第 ${col} 列应未使用但画了东西（应为全透明）`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    info: {
      config,
      sheetPath,
      size: { w: meta.width, h: meta.height },
      format: meta.format,
      stateCount: ATLAS_ROWS.length,
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const target = args.find((a) => !a.startsWith("--"));
  if (!target) {
    console.error("用法: node scripts/validate-pet-atlas.mjs <petDir> [--json]");
    process.exit(1);
  }

  const dir = path.resolve(target);
  const result = await validatePetDir(dir);

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const name = result.info?.config?.displayName || path.basename(dir);
    console.log(`[validate] ${dir}  (${name})`);
    for (const e of result.errors) console.log(`  ✖ ${e}`);
    console.log(result.ok ? "  ✔ 通过" : `  ✖ ${result.errors.length} 个问题`);
  }
  process.exit(result.ok ? 0 : 1);
}

// 仅在直接执行时跑 CLI（被 import 时只导出函数）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("[validate] 失败:", error);
    process.exit(1);
  });
}
