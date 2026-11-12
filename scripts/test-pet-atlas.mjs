/**
 * Codex 图集契约校验器的测试：用合成素材验证「能过」与「各类坏输入都能拦住」。
 *
 * 用法：node scripts/test-pet-atlas.mjs
 */
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import {
  ATLAS_HEIGHT,
  ATLAS_ROWS,
  ATLAS_WIDTH,
  CELL_HEIGHT,
  CELL_WIDTH,
  validatePetDir,
} from "./validate-pet-atlas.mjs";

const require = createRequire(import.meta.url);
const sharp = require("../backend-ts/node_modules/sharp");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pet-atlas-"));

/**
 * 造一张图集。options 用来注入各类坏数据：
 * - skipCell: [row, col] 该「已用格」留空
 * - dirtyUnused: [row, col] 在「未用格」画东西
 * - residue: 在透明像素上写 RGB
 * - width/height: 覆盖画布尺寸
 */
function buildAtlasBuffer(options = {}) {
  const width = options.width ?? ATLAS_WIDTH;
  const height = options.height ?? ATLAS_HEIGHT;
  // 单格尺寸按整图现算（与校验器一致）：ChatGPT 导出是 1536×2288 → 192×254.2
  const cellW = width / 8;
  const cellH = height / 9;
  const buf = Buffer.alloc(width * height * 4, 0);

  const put = (x, y, r, g, b, a) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const o = (y * width + x) * 4;
    buf[o] = r;
    buf[o + 1] = g;
    buf[o + 2] = b;
    buf[o + 3] = a;
  };

  const fillCell = (row, col) => {
    // 一格中间画一个实心块，模拟「有像素」（按当前格尺寸缩放）
    const cx = Math.round(col * cellW + cellW / 2);
    const cy = Math.round(row * cellH + cellH / 2);
    const halfW = Math.max(4, Math.round(cellW * 0.17));
    const halfH = Math.max(4, Math.round(cellH * 0.19));
    for (let dy = -halfH; dy < halfH; dy += 1) {
      for (let dx = -halfW; dx < halfW; dx += 1) {
        put(cx + dx, cy + dy, 200, 120, 80, 255);
      }
    }
  };

  ATLAS_ROWS.forEach((row, r) => {
    for (let c = 0; c < row.frames; c += 1) {
      if (options.skipCell && options.skipCell[0] === r && options.skipCell[1] === c) continue;
      fillCell(r, c);
    }
  });

  if (options.dirtyUnused) {
    const [r, c] = options.dirtyUnused;
    fillCell(r, c);
  }

  if (options.residue) {
    // 找一个透明的格子外区域，写 RGB 但 alpha=0
    put(5, 5, 255, 0, 0, 0);
  }

  return { buf, width, height };
}

async function writePet(dir, { atlas = {}, petJson, format = "webp" } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const { buf, width, height } = buildAtlasBuffer(atlas);
  const sheetName = format === "png" ? "spritesheet.png" : "spritesheet.webp";
  const pipeline = sharp(buf, { raw: { width, height, channels: 4 } });
  await (format === "png" ? pipeline.png() : pipeline.webp({ lossless: true })).toFile(
    path.join(dir, sheetName),
  );

  const config = petJson ?? {
    id: path.basename(dir),
    displayName: "测试宠物",
    description: "合成素材",
    spritesheetPath: sheetName,
  };
  fs.writeFileSync(path.join(dir, "pet.json"), JSON.stringify(config, null, 2), "utf8");
}

async function main() {
  // ── 1. 合法素材 ──
  const okDir = path.join(TMP, "ok");
  await writePet(okDir);
  const ok = await validatePetDir(okDir);
  assert.strictEqual(ok.ok, true, `合法素材应通过，实际 ${JSON.stringify(ok.errors)}`);
  console.log("PET_ATLAS_OK valid");

  // ── 2. 已用格为空 ──
  const emptyDir = path.join(TMP, "empty-cell");
  await writePet(emptyDir, { atlas: { skipCell: [7, 5] } }); // running 行最后一帧
  const empty = await validatePetDir(emptyDir);
  assert.strictEqual(empty.ok, false);
  assert.ok(
    empty.errors.some((e) => e.includes("第 7 行") && e.includes("第 5 帧")),
    `错误信息应定位到具体帧，实际 ${JSON.stringify(empty.errors)}`,
  );
  console.log("PET_ATLAS_OK empty-cell");

  // ── 3. 未用格画了东西 ──
  const dirtyDir = path.join(TMP, "dirty-unused");
  await writePet(dirtyDir, { atlas: { dirtyUnused: [3, 6] } }); // waving 只有 4 帧，第 6 列应空
  const dirty = await validatePetDir(dirtyDir);
  assert.strictEqual(dirty.ok, false);
  assert.ok(
    dirty.errors.some((e) => e.includes("第 3 行") && e.includes("第 6 列")),
    `错误信息应定位到具体列，实际 ${JSON.stringify(dirty.errors)}`,
  );
  console.log("PET_ATLAS_OK dirty-unused");

  // ── 4. 透明像素残留 RGB ──
  // 用 PNG：WebP 编码器会做 alpha 预处理，可能把 alpha=0 处的 RGB 抹掉，
  // 那样就测不到校验逻辑本身了。
  const residueDir = path.join(TMP, "residue");
  await writePet(residueDir, { atlas: { residue: true }, format: "png" });
  const residue = await validatePetDir(residueDir);
  assert.strictEqual(residue.ok, false);
  assert.ok(
    residue.errors.some((e) => e.includes("残留 RGB")),
    `应报出透明残留，实际 ${JSON.stringify(residue.errors)}`,
  );
  console.log("PET_ATLAS_OK residue");

  // ── 5. 尺寸不对 ──
  const smallDir = path.join(TMP, "small");
  await writePet(smallDir, { atlas: { width: 768, height: 936 } });
  const small = await validatePetDir(smallDir);
  assert.strictEqual(small.ok, false);
  assert.ok(
    small.errors.some((e) => e.includes("尺寸不合法")),
    `应报尺寸错误，实际 ${JSON.stringify(small.errors)}`,
  );
  console.log("PET_ATLAS_OK wrong-size");

  // ── 5b. ChatGPT 导出的 1536×2288（单格 192×254.2）应通过，只给警告 ──
  const chatgptDir = path.join(TMP, "chatgpt-export");
  await writePet(chatgptDir, { atlas: { width: 1536, height: 2288 } });
  const chatgpt = await validatePetDir(chatgptDir);
  assert.strictEqual(chatgpt.ok, true, `1536×2288 应通过，实际 ${JSON.stringify(chatgpt.errors)}`);
  assert.ok(
    chatgpt.warnings.some((w) => w.includes("非官方尺寸")),
    `应提示非官方尺寸，实际 ${JSON.stringify(chatgpt.warnings)}`,
  );
  console.log("PET_ATLAS_OK chatgpt-export-2288");

  // ── 6. pet.json 缺字段 / 缺文件 ──
  const noFieldDir = path.join(TMP, "no-field");
  await writePet(noFieldDir, {
    petJson: { id: "no-field", spritesheetPath: "spritesheet.webp" },
  });
  const noField = await validatePetDir(noFieldDir);
  assert.strictEqual(noField.ok, false);
  assert.ok(noField.errors.some((e) => e.includes("displayName")));
  console.log("PET_ATLAS_OK missing-field");

  const missingDir = path.join(TMP, "missing");
  fs.mkdirSync(missingDir, { recursive: true });
  const missing = await validatePetDir(missingDir);
  assert.strictEqual(missing.ok, false);
  assert.ok(missing.errors.some((e) => e.includes("缺少 pet.json")));
  console.log("PET_ATLAS_OK missing-json");

  // ── 7. spritesheetPath 指向目录外 ──
  const escapeDir = path.join(TMP, "escape");
  await writePet(escapeDir, {
    petJson: {
      id: "escape",
      displayName: "x",
      spritesheetPath: "../ok/spritesheet.webp",
    },
  });
  const escape = await validatePetDir(escapeDir);
  assert.strictEqual(escape.ok, false);
  assert.ok(escape.errors.some((e) => e.includes("只能是同目录文件名")));
  console.log("PET_ATLAS_OK path-escape");

  // Windows 上 sharp 可能短暂持有文件句柄，清理失败不影响结论
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* 忽略：临时目录留给系统清理 */
  }
  console.log("PET_ATLAS_TEST_OK");
}

main().catch((error) => {
  console.error("PET_ATLAS_TEST_FAILED", error);
  process.exit(1);
});
