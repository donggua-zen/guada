/**
 * 桌宠素材烘焙：把美术侧的 `animations/` 目录（manifest.json 序列帧规范 v1.0）
 * 转成仓库内的运行时素材。
 *
 * 两件事：
 * 1. **缩到 384²**：720² 解码后单帧约 2.07MB（RGBA），idle 33 帧就是 68MB，
 *    四段动画全加载能到 180MB —— 对一只桌面宠物完全没必要。显示尺寸只有 210 CSS px
 *    （HiDPI 下约 315 设备像素），384 足够清晰，内存降到约 1/3.5。
 * 2. **补 bbox**：每段动画的透明像素包围盒。运行时靠它做命中判定
 *    （鼠标是否该穿透），美术侧不关心这个字段。
 *
 * 输入格式（美术侧，见其 README「序列帧动画目录规范 v1.0」）：
 *   <src>/manifest.json
 *   <src>/<dir>/anim.json
 *   <src>/<dir>/frame_001.webp   ← 三位补零，数字即播放顺序
 *
 * 输出（仓库内，运行时直接读）：
 *   <out>/manifest.json          ← 同 schema + frameSize 改 384 + 每段 bbox
 *   <out>/<dir>/frame_001.webp   ← 已缩放
 *   <out>/avatar.webp            ← 设置页卡片的预览图
 *
 * 用法：
 *   node scripts/bake-pet-assets.mjs \
 *     --src "F:/视频项目/吉祥物/桌面宠物立绘/银发女_Q版/animations" \
 *     --out build-resources/pets/silver-haired \
 *     --name "柒（Q版）" \
 *     --fps idle=6 \
 *     --avatar "F:/视频项目/吉祥物/桌面宠物立绘/银发女_Q版/01_基础站立-nobg.webp"
 *
 * 幂等：可反复执行；--src 缺省时只按现有帧重算 manifest（不再缩放）。
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// sharp 只装在 backend-ts 里（后端图片处理用），这里直接借它的原生模块
const sharp = require("../backend-ts/node_modules/sharp");

/** 设置页形象卡片的预览图尺寸（正方形，透明底） */
const AVATAR_SIZE = 256;
/** alpha > 该阈值才算「有像素」，避开半透明边缘的 1px 噪点 */
const ALPHA_THRESHOLD = 16;

function parseArgs(argv) {
  const args = {
    out: "build-resources/pets/silver-haired",
    size: 384,
    src: null,
    avatar: null,
    name: null,
    /** 覆盖美术侧 manifest 的 fps（源数据写错时的逃生口），如 idle=6,run=12 */
    fps: {},
  };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (key === "--src" && next) { args.src = next; i += 1; }
    else if (key === "--out" && next) { args.out = next; i += 1; }
    else if (key === "--size" && next) { args.size = Number(next); i += 1; }
    else if (key === "--avatar" && next) { args.avatar = next; i += 1; }
    else if (key === "--name" && next) { args.name = next; i += 1; }
    else if (key === "--fps" && next) {
      next.split(",").forEach((pair) => {
        const [k, v] = pair.split("=");
        if (k && v) args.fps[k] = Number(v);
      });
      i += 1;
    }
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

/** 读美术侧 manifest；缺字段直接报错，不做静默兜底（错的素材该在烘焙期暴露） */
function readSourceManifest(srcDir) {
  const file = path.join(srcDir, "manifest.json");
  if (!fs.existsSync(file)) {
    throw new Error(`源目录缺少 manifest.json: ${srcDir}`);
  }
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!raw || typeof raw !== "object" || !raw.animations) {
    throw new Error(`manifest.json 结构非法: ${file}`);
  }
  return raw;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(args.out);
  const manifestPath = path.join(outDir, "manifest.json");

  let canvas = args.size;
  let sourceManifest = null;

  if (args.src) {
    const srcDir = path.resolve(args.src);
    if (!fs.existsSync(srcDir)) throw new Error(`源目录不存在: ${srcDir}`);
    sourceManifest = readSourceManifest(srcDir);

    for (const [key, anim] of Object.entries(sourceManifest.animations)) {
      const dirName = anim.dir || key;
      const from = path.join(srcDir, dirName);
      const to = path.join(outDir, dirName);
      if (!fs.existsSync(from)) throw new Error(`缺少动画目录: ${from}`);

      fs.rmSync(to, { recursive: true, force: true });
      fs.mkdirSync(to, { recursive: true });

      const files = fs
        .readdirSync(from)
        .filter((f) => f.endsWith(".webp"))
        .sort();
      for (const file of files) {
        await sharp(path.join(from, file))
          .resize(args.size, args.size, { fit: "fill" })
          .webp({ quality: 82, alphaQuality: 90, effort: 5 })
          .toFile(path.join(to, file));
      }

      // 数量校验：manifest.count 与磁盘帧数不一致时告警（美术侧改帧后忘了更新索引）
      if (typeof anim.count === "number" && anim.count !== files.length) {
        console.warn(
          `[bake] ⚠ ${key}: manifest.count=${anim.count} 但目录里有 ${files.length} 帧`,
        );
      }
      console.log(`[bake] ${key}: ${files.length} 帧 → ${args.size}²`);
    }
  } else {
    console.log("[bake] 未指定 --src，按现有帧重算 bbox");
    const sampleDir = path.join(outDir, "idle");
    const sample = fs.readdirSync(sampleDir).filter((f) => f.endsWith(".webp"))[0];
    const meta = await sharp(path.join(sampleDir, sample)).metadata();
    canvas = meta.width;
  }

  // 动画索引：源 manifest 为准（缺源时按目录里现有动画重建）
  const animIds = sourceManifest
    ? Object.keys(sourceManifest.animations)
    : fs
        .readdirSync(outDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);

  const animations = {};
  for (const key of animIds) {
    const src = sourceManifest?.animations?.[key] ?? {};
    const dirName = src.dir || key;
    const dir = path.join(outDir, dirName);
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".webp"))
      .sort()
      .map((f) => path.join(dir, f));

    // 包围盒是桌宠可交互区域（主进程据此判穿透），每段动画各自算：
    // 取并集会 run 张开的手臂也套到 idle 身上，人物两侧大片透明会挡住桌面点击。
    const bbox = await measureBBox(files);
    animations[key] = {
      label: src.label ?? key,
      // --fps 覆盖优先：美术侧 manifest 的 fps 偶有笔误（如 idle 写成 8 实为 6），
      // 有逃生口就不必为了一个数字去改源素材
      fps: typeof args.fps[key] === "number" && Number.isFinite(args.fps[key])
        ? args.fps[key]
        : typeof src.fps === "number"
          ? src.fps
          : 8,
      loop: src.loop !== false,
      dir: dirName,
      count: files.length,
      bbox,
    };
    console.log(`[bake] ${key} fps=${animations[key].fps} bbox ${JSON.stringify(bbox)}`);
  }

  const manifest = {
    name: args.name ?? sourceManifest?.name ?? "桌宠",
    version: sourceManifest?.version ?? "1.0.0",
    frameSize: { w: canvas, h: canvas },
    // 锚点沿用美术约定（脚底中心）；运行时靠 img 底对齐实现，这里只做记录
    anchor: sourceManifest?.anchor ?? { x: 0.5, y: 1.0 },
    animations,
    bakedAt: new Date().toISOString(),
    ...(args.src ? { source: path.resolve(args.src) } : {}),
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`[bake] 写入 ${manifestPath}`);

  // 预览图：--avatar 显式指定，否则按素材目录约定向上两级找「01_基础站立-nobg.webp」
  let avatarSrc = args.avatar;
  if (!avatarSrc && args.src) {
    const guess = path.resolve(args.src, "..", "01_基础站立-nobg.webp");
    if (fs.existsSync(guess)) avatarSrc = guess;
  }
  if (avatarSrc && fs.existsSync(avatarSrc)) {
    await writeAvatar(avatarSrc, path.join(outDir, "avatar.webp"));
  } else {
    console.log("[bake] 跳过预览图（可用 --avatar 指定）");
  }
}

main().catch((error) => {
  console.error("[bake] 失败:", error);
  process.exit(1);
});
