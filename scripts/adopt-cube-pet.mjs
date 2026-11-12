/**
 * 把 cube-pets-demo/bake_out/<animal>/ 的烘焙产物「领养」为桌宠正式形象。
 *
 * 与 bake-pet-assets.mjs 的分工：那条管线吃「已抠好背景、人物撑满画布」的帧；
 * 这里吃 bake.html 的输出 —— 人物只占画布中间一小块（四周是取景 pad），
 * 所以必须先裁到联合包围盒，否则 200px 的小动物放进 210px 的显示框只剩一半大。
 *
 * 裁剪策略：取所有启用动画帧的**并集**包围盒（各帧取景参数完全一致，
 * 并集裁剪 = 同一平移，切动画时不会跳位），并让联合盒的底边贴住输出画布下缘
 * （运行时 img 底对齐于 stage，脚底悬空会像浮在半空）。
 *
 * 动画映射（桌宠只有 idle/walk/run/yawn 四段）：
 *   idle → idle, walk → walk, run → run, eat → yawn
 *
 * 用法：
 *   node scripts/adopt-cube-pet.mjs --animal tiger [--size 384]
 * 产物：build-resources/pets/cube-<animal>/（manifest.json + <anim>/ + avatar.webp + pet.html）
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// sharp 只装在 backend-ts 里（后端图片处理用），这里直接借它的原生模块
const sharp = require("../backend-ts/node_modules/sharp");

/** alpha > 该阈值才算「有像素」（与 bake-pet-assets.mjs 保持一致） */
const ALPHA_THRESHOLD = 16;

/** 烘焙段 → 桌宠段映射；yawn 用 eat 冒充（慢节奏、低头的动作最接近犯困） */
const ANIMATIONS = {
  idle: { label: "待机", fps: 6, loop: true, from: "idle" },
  walk: { label: "快走", fps: 10, loop: true, from: "walk" },
  run: { label: "奔跑", fps: 8, loop: true, from: "run" },
  yawn: { label: "打哈欠", fps: 8, loop: false, from: "eat" },
};

function parseArgs(argv) {
  const args = { animal: null, size: 384 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--animal") { args.animal = argv[i + 1]; i += 1; }
    else if (argv[i] === "--size") { args.size = Number(argv[i + 1]); i += 1; }
  }
  if (!args.animal || !/^[a-z]+$/.test(args.animal)) {
    throw new Error("用法: node scripts/adopt-cube-pet.mjs --animal <tiger|panda|...> [--size 384]");
  }
  return args;
}

/** 一组帧文件的透明像素并集包围盒 */
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
  const srcDir = path.resolve("cube-pets-demo/bake_out", args.animal);
  const outDir = path.resolve("build-resources/pets", `cube-${args.animal}`);
  if (!fs.existsSync(srcDir)) throw new Error(`烘焙产物不存在: ${srcDir}（先跑 bake.html）`);

  // ── 1. 收集各动画的帧文件 ──
  const perAnim = {};
  for (const [key, meta] of Object.entries(ANIMATIONS)) {
    const files = fs.readdirSync(srcDir)
      .filter((f) => f.startsWith(`${meta.from}_`) && f.endsWith(".webp"))
      .sort()
      .map((f) => path.join(srcDir, f));
    if (files.length === 0) throw new Error(`缺少动画帧: ${meta.from}（在 ${srcDir}）`);
    perAnim[key] = { files, meta };
  }

  // ── 2. 全动画并集包围盒（同一平移，切动画不跳位） ──
  const allFiles = Object.values(perAnim).flatMap((a) => a.files);
  const union = await measureBBox(allFiles);
  console.log(`[adopt] 联合包围盒 ${JSON.stringify(union)}（源画布 ${allFiles.length} 帧）`);

  // ── 3. 裁剪：人物区域居中放，底部对齐输出画布下缘 ──
  // 底边距设 0：img 在 stage 里 flex-end 对齐，脚底就是画布底
  const target = args.size;
  const scale = target / union.h;
  const scaledW = Math.round(union.w * scale);
  const leftPad = Math.max(0, Math.floor((target - scaledW) / 2));
  const extract = {
    left: union.x,
    top: union.y,
    width: Math.min(union.w, 4096),
    height: union.h,
  };

  for (const [key, { files, meta }] of Object.entries(perAnim)) {
    const to = path.join(outDir, key);
    fs.rmSync(to, { recursive: true, force: true });
    fs.mkdirSync(to, { recursive: true });
    for (let i = 0; i < files.length; i += 1) {
      // 帧命名跟美术侧规范（frame_001.webp，三位补零）
      const n = String(i + 1).padStart(3, "0");
      await sharp(files[i])
        .extract(extract) // 先裁出联合盒（源分辨率下操作，无损缩放精度）
        // 联合盒按 target/union.h 精确等比缩放（fit:fill + 预算好的宽高，
        // 不能用 fit:contain —— 它会自己补边，再 extend 就双重 padding）
        .resize(scaledW, target, { fit: "fill" })
        .extend({
          // 水平居中；垂直方向 scale 已保证高度恰好铺满，无需补
          top: 0, bottom: 0, left: leftPad, right: target - scaledW - leftPad,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .webp({ quality: 82, alphaQuality: 90, effort: 5 })
        .toFile(path.join(to, `frame_${n}.webp`));
    }
    console.log(`[adopt] ${key} ← ${meta.from}: ${files.length} 帧 → ${target}²`);
  }

  // ── 4. 各动画自己的紧包围盒（主进程穿透判定用） ──
  const animations = {};
  for (const [key, { meta }] of Object.entries(perAnim)) {
    const dir = path.join(outDir, key);
    const outFiles = fs.readdirSync(dir).filter((f) => f.endsWith(".webp")).sort()
      .map((f) => path.join(dir, f));
    const bbox = await measureBBox(outFiles);
    animations[key] = {
      label: meta.label,
      fps: meta.fps,
      loop: meta.loop,
      count: outFiles.length,
      dir: key,
      bbox,
    };
    console.log(`[adopt] ${key} bbox ${JSON.stringify(bbox)}`);
  }

  // ── 5. manifest.json（名称/描述按动物生成） ──
  const NAME_ZH = { tiger: "方块虎", panda: "方块熊猫" };
  const config = {
    name: NAME_ZH[args.animal] || `方块${args.animal}`,
    version: "1.0.0",
    description: `Kenney Cube Pets · ${args.animal}（CC0）`,
    frameSize: { w: target, h: target },
    anchor: { x: 0.5, y: 1.0 },
    animations,
  };
  fs.writeFileSync(path.join(outDir, "manifest.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");

  // ── 6. 预览图：取 idle 第一帧（已是透明底正方形，直接用） ──
  await sharp(path.join(outDir, "idle", "frame_001.webp"))
    .resize(256, 256, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 88, alphaQuality: 95 })
    .toFile(path.join(outDir, "avatar.webp"));
  console.log(`[adopt] avatar ← idle frame_01`);

  // 运行时页面不复制：所有形象共用 build-resources/pet-ui/pet.html，
  // 素材路径由主进程下发的 baseUrl 解析（素材目录只放素材）。
  console.log(`[adopt] 完成 → ${outDir}`);
}

main().catch((error) => {
  console.error("[adopt] 失败:", error);
  process.exit(1);
});
