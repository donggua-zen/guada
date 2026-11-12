/**
 * 把我们的逐帧素材（manifest.json + <anim>/frame_001.webp）导出成 Codex 图集，
 * 让这只宠物也能在 Codex / dsh-desktop-pet 等支持该格式的地方使用。
 *
 * 用法：
 *   node scripts/export-codex-pet.mjs --id silver-haired [--src build-resources/pets] [--out <dir>]
 *
 * 契约见 docs/pet-format-codex.md。缺对应动画的行用 idle 帧占位（会逐行告警），
 * 保证产物仍是合法图集——Codex 侧不会因为缺行而拒绝加载。
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import {
  ATLAS_HEIGHT,
  ATLAS_ROWS,
  ATLAS_WIDTH,
  CELL_HEIGHT,
  CELL_WIDTH,
} from "./validate-pet-atlas.mjs";
import { zeroTransparentRgb } from "./lib/rgba.mjs";

const require = createRequire(import.meta.url);
const sharp = require("../backend-ts/node_modules/sharp");

/**
 * 行 → 我们的动画来源。
 * mirror=true 表示整行水平翻转（用于 running-left）。
 */
const ROW_SOURCE = {
  idle: { anim: "idle" },
  "running-right": { anim: "run" },
  "running-left": { anim: "run", mirror: true },
  waving: { anim: "idle" },
  jumping: { anim: "idle" },
  failed: { anim: "idle" },
  waiting: { anim: "idle" },
  running: { anim: "walk" },
  review: { anim: "idle" },
};

function parseArgs(argv) {
  const args = { id: null, src: "build-resources/pets", out: null, name: null };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (key === "--id" && next) { args.id = next; i += 1; }
    else if (key === "--src" && next) { args.src = next; i += 1; }
    else if (key === "--out" && next) { args.out = next; i += 1; }
    else if (key === "--name" && next) { args.name = next; i += 1; }
  }
  return args;
}

/** 读某个动画的帧文件列表 */
function framesOf(petDir, manifest, anim) {
  const entry = manifest.animations?.[anim];
  if (!entry) return [];
  const dir = path.join(petDir, entry.dir || anim);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".webp"))
    .sort()
    .map((f) => path.join(dir, f));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.id) {
    console.error("用法: node scripts/export-codex-pet.mjs --id <形象目录名> [--out <目录>]");
    process.exit(1);
  }

  const petDir = path.join(path.resolve(args.src), args.id);
  const manifestPath = path.join(petDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    console.error(`[export] 找不到 manifest.json: ${petDir}`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  const outDir = path.resolve(args.out || path.join("build-resources", "pet-exports", args.id));
  fs.mkdirSync(outDir, { recursive: true });

  const composites = [];
  const warnings = [];

  for (let row = 0; row < ATLAS_ROWS.length; row += 1) {
    const spec = ATLAS_ROWS[row];
    const source = ROW_SOURCE[spec.state] ?? { anim: "idle" };
    const files = framesOf(petDir, manifest, source.anim);
    if (files.length === 0) {
      console.error(`[export] 形象缺少动画 ${source.anim}，无法生成 ${spec.state} 行`);
      process.exit(1);
    }
    if (source.anim !== spec.state) {
      warnings.push(`${spec.state} 行用 ${source.anim} 的帧占位`);
    }

    for (let col = 0; col < spec.frames; col += 1) {
      // 帧数不足就循环取（同一段动画复用），保证每格都有内容
      const file = files[col % files.length];
      let pipeline = sharp(file)
        .resize(CELL_WIDTH, CELL_HEIGHT, {
          fit: "contain",
          position: "south",
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        });
      if (source.mirror) pipeline = pipeline.flop();
      const buf = await pipeline.png().toBuffer();
      composites.push({
        input: buf,
        left: col * CELL_WIDTH,
        top: row * CELL_HEIGHT,
      });
    }
  }

  const sheetPath = path.join(outDir, "spritesheet.webp");
  // 合成后必须清掉 alpha=0 处的残留 RGB：Codex 契约把它当硬错误，
  // 而且缩放后会渗出彩色描边（我们的原始素材里确实有残留）。
  const { data, info } = await sharp({
    create: {
      width: ATLAS_WIDTH,
      height: ATLAS_HEIGHT,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const cleaned = zeroTransparentRgb(data);
  await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .webp({ lossless: true })
    .toFile(sheetPath);
  if (cleaned > 0) {
    console.log(`[export]   清理透明残留 RGB ${cleaned} 处`);
  }

  const displayName = args.name || manifest.name || args.id;
  const config = {
    id: args.id,
    displayName,
    description: manifest.description || `${displayName} 桌面宠物`,
    spritesheetPath: "spritesheet.webp",
  };
  fs.writeFileSync(path.join(outDir, "pet.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");

  console.log(`[export] ✔ ${displayName} → ${outDir}`);
  for (const w of warnings) console.log(`[export]   ⚠ ${w}`);
  console.log(`[export]   用 node scripts/validate-pet-atlas.mjs "${outDir}" 校验产物`);
}

main().catch((error) => {
  console.error("[export] 失败:", error);
  process.exit(1);
});
