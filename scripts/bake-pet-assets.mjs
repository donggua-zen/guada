/**
 * 桌宠素材烘焙：把原始 720² 序列帧缩到目标边长，并重写 sprites.json 的包围盒。
 *
 * 为什么要缩：720×720 解码后单帧约 2.07MB（RGBA），idle 33 帧就是 68MB，
 * 四段动画全加载能到 180MB —— 对一只桌面宠物来说完全没必要。
 * 显示尺寸只有 210 CSS px（HiDPI 下约 315 设备像素），384 源足够清晰，
 * 内存降到约 1/3.5，仓库里的 webp 体积也降到约 1/4。
 *
 * 用法：
 *   node scripts/bake-pet-assets.mjs \
 *     --src "F:/视频项目/吉祥物/桌面宠物立绘/银发女_Q版/sprites/frames" \
 *     --out build-resources/pets/silver-haired \
 *     --size 384
 *
 * 幂等：可反复执行；--src 缺省时只按现有帧重算 sprites.json（不再缩放）。
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// sharp 只装在 backend-ts 里（后端图片处理用），这里直接借它的原生模块
const sharp = require("../backend-ts/node_modules/sharp");

/** 设置页形象卡片的预览图尺寸（正方形，透明底） */
const AVATAR_SIZE = 256;

const ANIMATIONS = {
  idle: { label: "待机", fps: 6, loop: true },
  walk: { label: "快走", fps: 10, loop: true },
  run: { label: "奔跑", fps: 8, loop: true },
  yawn: { label: "打哈欠", fps: 8, loop: false },
};

/** alpha > 该阈值才算「有像素」，避开半透明边缘的 1px 噪点 */
const ALPHA_THRESHOLD = 16;

function parseArgs(argv) {
  const args = {
    out: "build-resources/pets/silver-haired",
    size: 384,
    src: null,
    avatar: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (key === "--src" && next) { args.src = next; i += 1; }
    else if (key === "--out" && next) { args.out = next; i += 1; }
    else if (key === "--size" && next) { args.size = Number(next); i += 1; }
    else if (key === "--avatar" && next) { args.avatar = next; i += 1; }
  }
  return args;
}

/** 生成设置页用的形象预览图（透明底 256²） */
async function writeAvatar(sourcePath, outPath) {
  await sharp(sourcePath)
    .resize(AVATAR_SIZE, AVATAR_SIZE, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .webp({ quality: 88, alphaQuality: 95 })
    .toFile(outPath);
  console.log(`[bake] avatar ← ${path.basename(sourcePath)}`);
}

/** 计算一组帧的透明像素包围盒（并集） */
async function measureBBox(files) {
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (const file of files) {
    const { data, info } = await sharp(file)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
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
  const outDir = path.resolve(args.out);
  const framesDir = path.join(outDir, "frames");
  const configPath = path.join(outDir, "sprites.json");

  // 目标边长：--src 缺省时按已有帧推断（不缩放）
  let canvas = args.size;

  if (args.src) {
    const srcDir = path.resolve(args.src);
    if (!fs.existsSync(srcDir)) {
      throw new Error(`源目录不存在: ${srcDir}`);
    }
    for (const [key, meta] of Object.entries(ANIMATIONS)) {
      const from = path.join(srcDir, key);
      const to = path.join(framesDir, key);
      if (!fs.existsSync(from)) {
        throw new Error(`缺少动画目录: ${from}`);
      }
      fs.rmSync(to, { recursive: true, force: true });
      fs.mkdirSync(to, { recursive: true });

      const files = fs.readdirSync(from).filter((f) => f.endsWith(".webp")).sort();
      for (const file of files) {
        await sharp(path.join(from, file))
          .resize(args.size, args.size, { fit: "fill" })
          .webp({ quality: 82, alphaQuality: 90, effort: 5 })
          .toFile(path.join(to, file));
      }
      console.log(`[bake] ${key}: ${files.length} 帧 → ${args.size}²`);
      void meta;
    }
  } else {
    // 未给源：按现有帧读一次尺寸，只重写包围盒
    const sample = fs
      .readdirSync(path.join(framesDir, "idle"))
      .filter((f) => f.endsWith(".webp"))[0];
    const meta = await sharp(path.join(framesDir, "idle", sample)).metadata();
    canvas = meta.width;
    console.log(`[bake] 未指定 --src，按现有帧尺寸 ${canvas} 重算包围盒`);
  }

  // 重算包围盒（缩放后必须重算，不能按比例乘——边缘抗锯齿会变）。
  // 包围盒就是桌宠的「可交互矩形」：主进程用它判定鼠标是否该穿透，
  // 所以每段动画各自算，而不是取四段的并集（并集会把 run 张开的手臂宽度
  // 也算到 idle 身上，导致人物两侧大片透明区域挡住桌面点击）。
  const animations = {};
  for (const [key, meta] of Object.entries(ANIMATIONS)) {
    const dir = path.join(framesDir, key);
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".webp"))
      .sort()
      .map((f) => path.join(dir, f));
    const bbox = await measureBBox(files);
    animations[key] = {
      ...meta,
      count: files.length,
      dir: `frames/${key}`,
      bbox,
    };
    console.log(`[bake] ${key} bbox ${JSON.stringify(bbox)}`);
  }

  const config = {
    name: "银发少女_Q版",
    version: "1.0.0",
    description: "Q版银发少女桌面宠物动画序列",
    canvas: { w: canvas, h: canvas },
    animations,
  };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  console.log(`[bake] 写入 ${configPath}`);

  // 设置页形象卡片的预览图：--avatar 显式指定，
  // 否则按素材目录约定向上两级找「01_基础站立-nobg.webp」
  let avatarSrc = args.avatar;
  if (!avatarSrc && args.src) {
    const guess = path.resolve(args.src, "..", "..", "01_基础站立-nobg.webp");
    if (fs.existsSync(guess)) avatarSrc = guess;
  }
  if (avatarSrc && fs.existsSync(avatarSrc)) {
    await writeAvatar(avatarSrc, path.join(outDir, "avatar.webp"));
  } else {
    console.log("[bake] 跳过预览图（未找到 01_基础站立-nobg.webp，可用 --avatar 指定）");
  }
}

main().catch((error) => {
  console.error("[bake] 失败:", error);
  process.exit(1);
});
