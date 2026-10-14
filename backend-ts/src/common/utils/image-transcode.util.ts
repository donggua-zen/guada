/**
 * 会话图片转码 —— 「体积优先」的自适应质量阶梯（单一来源）。
 *
 * 设计取向（参考 Qoder CN 的模型侧转码，见 outputs/QoderCN-图片上传机制-逆向与对比.md）：
 * 目标约束是**输出体积**，不是最长边。边长只是达成体积的手段——固定「1024px + q85」
 * 无法回答「这张图到底多大」，大图很容易产出数百 KB，直接变成模型的图片 token 成本。
 *
 * 预算分两条渠道（见 getImageTargetBytes / getToolImageTargetBytes）：
 * 用户上传偏画质（384KB），工具产出图偏成本（150KB）。
 *
 * 四个刻意的设计点：
 *
 * 1. **快速通道**：已是安全 JPEG、已 ≤ 目标体积、已 ≤ 最长边，且没有 EXIF 方向待修正
 *    → 原字节直接复用（零编码）。既省 CPU，也避免对已经够小的图做二次有损压缩。
 *    有 EXIF orientation 时**不能**走这条：方向必须真的烤进像素，否则下游按原始像素
 *    显示会躺倒（`.rotate()` 才是修正它的地方）。
 *
 * 2. **档位收敛到源图边长**：阶梯里的档位若超过源图实际最长边就收敛到源图边长。
 *    否则一张 1024px 的图会把 1920/1280 两档都跑一遍——同一尺寸反复编码，纯浪费。
 *    收敛后可能产生重复档位，按 (边长, 质量) 去重。
 *
 * 3. **EXIF 旋转 + alpha 拍平**：`.rotate()` 把方向烤进像素；`.flatten({background:'#ffffff'})`
 *    把透明区拍到白底（JPEG 没有 alpha 通道，不拍平的话透明区会变黑）。
 *
 * 4. **串行化**：sharp 背后是 libvips，编码是 CPU 密集调用。并发转多张会互相抢核，
 *    反而更慢；这里用一条模块级 promise 链保证同一时刻只转一张。
 *
 * 解压炸弹防护：`limitInputPixels` 卡在 64MP，避免一张声明尺寸很小的 PNG 在解码时
 * 撑爆内存（PNG/WebP 的压缩比可以极高）。
 */

import sharp from "sharp";

// ─── 参数（env 可覆盖） ───

/** 默认最长边（px）。超过则等比缩小 */
export const DEFAULT_IMAGE_MAX_EDGE = 1920;
/** 默认单图目标体积（KB）——用户上传路径（聊天附件等） */
export const DEFAULT_IMAGE_TARGET_KB = 384;
/**
 * 工具产出图片的目标体积（KB）——引擎物化的落盘副本（MCP 图、浏览器截图、
 * image_view 查看的外部图）。比上传预算收紧一档：工具图多为一次性信息载体，
 * 一次会话可能积累很多张，token 成本的优先级高于画质。
 * 参考：ZCode 工具图预算 ≈200KB base64（raw ≈150KB）；Qoder 上传取 100KB。
 */
export const DEFAULT_TOOL_IMAGE_TARGET_KB = 150;

/** 解压炸弹防护：输入像素上限（64MP，与 Qoder 取值一致） */
export const IMAGE_LIMIT_INPUT_PIXELS = 64 * 1024 * 1024;

/** 缩略图参数（会话列表 / 附件卡片展示用，与模型侧无关） */
export const PREVIEW_MAX_EDGE = 256;
export const PREVIEW_TARGET_BYTES = 64 * 1024;

/**
 * 质量阶梯：[最长边, JPEG 质量]。
 * 首档给两次质量尝试（保边长、只降质量），之后每档同时降边长与质量。
 * 档位会按源图边长收敛（见 buildSteps），所以这里的 1920 是「上限」而非「必跑」。
 */
const LADDER: ReadonlyArray<readonly [number, number]> = [
  [1920, 85],
  [1920, 70],
  [1280, 70],
  [960, 60],
  [720, 50],
  [480, 40],
  [240, 40],
  [128, 40],
];

function readIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const parsed = raw === undefined ? NaN : Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/** 最长边（px）：env CHAT_IMAGE_MAX_EDGE，非法/缺省回退 1920，夹在 128..8192 */
export function getImageMaxEdge(): number {
  return readIntEnv("CHAT_IMAGE_MAX_EDGE", DEFAULT_IMAGE_MAX_EDGE, 128, 8192);
}

/**
 * 上传路径单图目标体积（字节）：env CHAT_IMAGE_TARGET_KB，非法/缺省回退 384KB，夹在 8KB..4MB。
 * 调大 → 画质更好但模型图片 token 成本更高；调小 → 反之。
 */
export function getImageTargetBytes(): number {
  return readIntEnv("CHAT_IMAGE_TARGET_KB", DEFAULT_IMAGE_TARGET_KB, 8, 4096) * 1024;
}

/**
 * 工具产出图片目标体积（字节）：env CHAT_TOOL_IMAGE_TARGET_KB，非法/缺省回退 150KB，夹在 8KB..4MB。
 * 与上传预算分开的原因：工具图（截图/识别图）单次会话可能积累很多张且多是一次性信息，
 * 收紧一档可显著压低 token 成本；用户上传则画质优先。
 */
export function getToolImageTargetBytes(): number {
  return readIntEnv("CHAT_TOOL_IMAGE_TARGET_KB", DEFAULT_TOOL_IMAGE_TARGET_KB, 8, 4096) * 1024;
}

// ─── 串行化 ───

let chain: Promise<unknown> = Promise.resolve();

/** 把一次转码挂到串行链尾。链自身永不 reject（吞掉结果），调用方各自拿自己的 promise */
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// ─── 转码 ───

export interface TranscodeOptions {
  /** 最长边上限（px），缺省读 env */
  maxEdge?: number;
  /** 目标体积（字节），缺省读 env */
  targetBytes?: number;
}

export interface TranscodeResult {
  data: Buffer;
  width: number;
  height: number;
  /** 实际执行的编码次数（0 = 走快速通道，未重编码） */
  encodes: number;
  /** 是否命中快速通道（原字节直接复用） */
  passthrough: boolean;
  /**
   * 是否所有档位都超过目标体积（此时返回的是最小档结果）。
   * 不抛错：上传不该因为「压不到目标」而失败，但调用方应记录以便观测。
   */
  overBudget: boolean;
}

/** EXIF orientation 是否需要真的把方向烤进像素（1 / 缺省 = 正立，无需处理） */
function needsOrientation(orientation?: number): boolean {
  return orientation !== undefined && orientation !== 1;
}

/** 该 orientation 是否会交换宽高轴（5-8 含 90°/270° 旋转） */
function swapsAxes(orientation?: number): boolean {
  return orientation === 5 || orientation === 6 || orientation === 7 || orientation === 8;
}

/**
 * 生成本次可用的档位表：把超过源图边长的档位收敛到源图边长（不放大），并按
 * (边长, 质量) 去重——收敛后可能撞出完全相同的档位，重复跑一次纯属浪费。
 */
function buildSteps(
  maxEdge: number,
  srcMaxEdge: number,
): Array<readonly [number, number]> {
  const cap = Math.max(1, Math.min(maxEdge, srcMaxEdge || maxEdge));
  const seen = new Set<string>();
  const steps: Array<readonly [number, number]> = [];
  for (const [edge, quality] of LADDER) {
    const e = Math.max(1, Math.min(edge, cap));
    const key = `${e}:${quality}`;
    if (seen.has(key)) continue;
    seen.add(key);
    steps.push([e, quality]);
  }
  return steps;
}

/** sharp 输入选项（单一来源，保证探测与转码用同一套防护） */
const INPUT_OPTS = {
  failOn: "error" as const,
  limitInputPixels: IMAGE_LIMIT_INPUT_PIXELS,
  sequentialRead: true,
};

/**
 * 把图片转成「≤ 目标体积」的 JPEG。
 *
 * 输入可以是任意 sharp 可解码的位图；输出**恒为 JPEG**（因此调用方可以把
 * name / fileExtension / mediaType 一起声明成 jpg / image/jpeg 而不撒谎）。
 *
 * 调用方无需自己串行化——内部已挂到模块级串行链。
 */
export async function transcodeImage(
  input: Buffer,
  opts: TranscodeOptions = {},
): Promise<TranscodeResult> {
  const maxEdge = opts.maxEdge ?? getImageMaxEdge();
  const targetBytes = opts.targetBytes ?? getImageTargetBytes();

  return serialize(async () => {
    // 1. 探测元数据（拿真实边长与 EXIF 方向）
    const meta = await sharp(input, INPUT_OPTS).metadata();
    const oriented = swapsAxes(meta.orientation);
    const srcWidth = (oriented ? meta.height : meta.width) ?? 0;
    const srcHeight = (oriented ? meta.width : meta.height) ?? 0;
    const srcMaxEdge = Math.max(srcWidth, srcHeight);

    // 2. 快速通道：已是安全 JPEG、够小、边长够小、无待修正方向 → 原字节复用
    if (
      meta.format === "jpeg" &&
      !needsOrientation(meta.orientation) &&
      input.byteLength <= targetBytes &&
      srcMaxEdge <= maxEdge
    ) {
      return {
        data: input,
        width: srcWidth,
        height: srcHeight,
        encodes: 0,
        passthrough: true,
        overBudget: false,
      };
    }

    // 3. 阶梯：逐级降质量/降边长，第一个达标的胜出
    const steps = buildSteps(maxEdge, srcMaxEdge);
    let last: { data: Buffer; width: number; height: number } | null = null;
    let encodes = 0;

    for (const [edge, quality] of steps) {
      const out = await sharp(input, INPUT_OPTS)
        .rotate() // 把 EXIF 方向烤进像素（必须先于 resize 语义生效）
        .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#ffffff" }) // alpha 拍平到白底
        .jpeg({ quality })
        .toBuffer({ resolveWithObject: true });
      encodes += 1;
      last = { data: out.data, width: out.info.width, height: out.info.height };
      if (out.data.byteLength <= targetBytes) {
        return { ...last, encodes, passthrough: false, overBudget: false };
      }
    }

    // 4. 全部档位都超目标：返回最小档，不抛错
    if (!last) {
      // buildSteps 至少产出一档，走到这里说明 LADDER 被清空（改坏了）
      throw new Error("图片转码失败：无可用档位");
    }
    return { ...last, encodes, passthrough: false, overBudget: true };
  });
}

/** 生成缩略图（恒为 JPEG）。参数固定为展示用的小尺寸小体积。 */
export function transcodePreview(input: Buffer): Promise<TranscodeResult> {
  return transcodeImage(input, {
    maxEdge: PREVIEW_MAX_EDGE,
    targetBytes: PREVIEW_TARGET_BYTES,
  });
}
