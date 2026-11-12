/**
 * 通用「烘焙产物 → 桌宠形象」转换器。
 *
 * 吃 cube-pets-demo/bake_out/<id>/ 下的 <clip>_NNN.webp（bake.html / 自建烘焙页的
 * 输出格式），产出 build-resources/pets/<id>/（manifest.json + <anim>/ + avatar.webp + pet.html）。
 *
 * 与 adopt-cube-pet.mjs 的区别：那个专给 Kenney Cube Pets 做 eat→yawn 映射；
 * 这个直接按 idle/walk/run/yawn 四段取帧，适合动画名已对齐的素材（如 Taila）。
 *
 * 关键处理：
 * - 联合包围盒裁剪：bake 画布里人物只占中间一块，不裁会显得很小；
 *   取所有启用动画帧的并集（同一平移，切动画不跳位）。
 * - 底部对齐：运行时 img 是底对齐的，脚底悬空会像浮在半空。
 * - 各动画单独算紧包围盒（主进程穿透判定用）。
 *
 * 用法：
 *   node scripts/adopt-baked-pet.mjs --id taila --name "Taila" \
 *     [--desc "CC-BY 4.0 by Partaevil"] [--size 384] [--fps idle=8,walk=12,run=12,yawn=10]
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = require("../backend-ts/node_modules/sharp");

/** alpha > 该阈值才算「有像素」（与 bake-pet-assets.mjs 一致） */
const ALPHA_THRESHOLD = 16;

/** 桌宠四段的标准配置（fps 可按素材节奏覆盖） */
const ANIMATIONS = {
  idle: { label: "待机", fps: 8, loop: true },
  walk: { label: "快走", fps: 12, loop: true },
  run: { label: "奔跑", fps: 12, loop: true },
  yawn: { label: "打哈欠", fps: 10, loop: false },
};

function parseArgs(argv) {
  const args = { id: null, name: null, desc: "", size: 384, fps: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i], v = argv[i + 1];
    if (k === "--id") { args.id = v; i += 1; }
    else if (k === "--name") { args.name = v; i += 1; }
    else if (k === "--desc") { args.desc = v; i += 1; }
    else if (k === "--size") { args.size = Number(v); i += 1; }
    else if (k === "--fps") {
      v.split(",").forEach((pair) => {
        const [key, val] = pair.split("=");
        if (key && val) args.fps[key] = Number(val);
      });
      i += 1;
    }
  }
  if (!args.id || !/^[a-zA-Z0-9_-]{1,64}$/.test(args.id)) {
    throw new Error("用法: node scripts/adopt-baked-pet.mjs --id <taila> --name <显示名>");
  }
  args.name = args.name || args.id;
  return args;
}

async function measureBBox(files) {
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (const file of files) {
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        if (data[(y * info.width + x) * 4 + 3] > ALPHA_THRESHOLD) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w: 1, h: 1 };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const srcDir = path.resolve("cube-pets-demo/bake_out", args.id);
  const outDir = path.resolve("build-resources/pets", args.id);
  if (!fs.existsSync(srcDir)) throw new Error(`烘焙产物不存在: ${srcDir}`);

  // ── 1. 各动画帧清单 ──
  const perAnim = {};
  for (const key of Object.keys(ANIMATIONS)) {
    const files = fs.readdirSync(srcDir)
      .filter((f) => f.startsWith(`${key}_`) && f.endsWith(".webp"))
      .sort()
      .map((f) => path.join(srcDir, f));
    if (files.length === 0) throw new Error(`缺少动画帧: ${key}（在 ${srcDir}）`);
    perAnim[key] = files;
  }

  // ── 2. 全动画并集包围盒 ──
  const allFiles = Object.values(perAnim).flat();
  const union = await measureBBox(allFiles);
  console.log(`[adopt] 联合包围盒 ${JSON.stringify(union)}（共 ${allFiles.length} 帧）`);

  const target = args.size;
  const scale = target / union.h;
  const scaledW = Math.round(union.w * scale);
  const leftPad = Math.max(0, Math.floor((target - scaledW) / 2));
  const extract = { left: union.x, top: union.y, width: union.w, height: union.h };

  // ── 3. 裁剪 → 缩放 → 底对齐 ──
  for (const [key, files] of Object.entries(perAnim)) {
    const to = path.join(outDir, key);
    fs.rmSync(to, { recursive: true, force: true });
    fs.mkdirSync(to, { recursive: true });
    for (let i = 0; i < files.length; i += 1) {
      // 帧命名跟美术侧规范（frame_001.webp，三位补零）
      const n = String(i + 1).padStart(3, "0");
      await sharp(files[i])
        .extract(extract)
        .resize(scaledW, target, { fit: "fill" })
        .extend({
          top: 0, bottom: 0, left: leftPad, right: target - scaledW - leftPad,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .webp({ quality: 82, alphaQuality: 90, effort: 5 })
        .toFile(path.join(to, `frame_${n}.webp`));
    }
    console.log(`[adopt] ${key}: ${files.length} 帧 → ${target}²`);
  }

  // ── 4. 各动画紧包围盒 + manifest.json ──
  const animations = {};
  for (const [key] of Object.entries(perAnim)) {
    const dir = path.join(outDir, key);
    const outFiles = fs.readdirSync(dir).filter((f) => f.endsWith(".webp")).sort()
      .map((f) => path.join(dir, f));
    const bbox = await measureBBox(outFiles);
    const meta = ANIMATIONS[key];
    animations[key] = {
      label: meta.label,
      fps: args.fps[key] || meta.fps,
      loop: meta.loop,
      count: outFiles.length,
      dir: key,
      bbox,
    };
    console.log(`[adopt] ${key} bbox ${JSON.stringify(bbox)}`);
  }

  const config = {
    name: args.name,
    version: "1.0.0",
    description: args.desc || undefined,
    frameSize: { w: target, h: target },
    anchor: { x: 0.5, y: 1.0 },
    animations,
  };
  fs.writeFileSync(path.join(outDir, "manifest.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");

  // ── 5. 预览图（idle 第一帧） ──
  await sharp(path.join(outDir, "idle", "frame_001.webp"))
    .resize(256, 256, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 88, alphaQuality: 95 })
    .toFile(path.join(outDir, "avatar.webp"));

  // 运行时页面不复制：所有形象共用 build-resources/pet-ui/pet.html，
  // 素材路径由主进程下发的 baseUrl 解析（素材目录只放素材）。
  console.log(`[adopt] 完成 → ${outDir}`);
}

main().catch((error) => {
  console.error("[adopt] 失败:", error);
  process.exit(1);
});
