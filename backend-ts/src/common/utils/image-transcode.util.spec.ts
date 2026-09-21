import * as zlib from "zlib";
import * as crypto from "crypto";
import sharp from "sharp";
import {
  IMAGE_LIMIT_INPUT_PIXELS,
  transcodeImage,
  transcodePreview,
} from "./image-transcode.util";

// ─── 构造样本 ───

/**
 * 生成一张噪声图。
 * 必须是**真随机**字节：伪随机的周期性会让 PNG 压缩率高达 100:1，
 * 造出来的"大图"其实只有几十 KB，阶梯根本跑不起来。
 */
async function noisePng(size: number): Promise<Buffer> {
  const raw = crypto.randomBytes(size * size * 3);
  return sharp(raw, { raw: { width: size, height: size, channels: 3 } })
    .png()
    .toBuffer();
}

/** 小 JPEG（体积远小于目标预算，用于验证快速通道） */
function smallJpeg(withOrientation?: number): Promise<Buffer> {
  let img = sharp({
    create: { width: 60, height: 40, channels: 3, background: "#3366cc" },
  });
  if (withOrientation) img = img.withMetadata({ orientation: withOrientation });
  return img.jpeg({ quality: 70 }).toBuffer();
}

// ─── 伪造 PNG（只为了触发像素上限，不真的分配内存） ───

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBytes = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([len, typeBytes, data, crc]);
}

/** 声明尺寸极大但字节极小的 PNG：解码前就该被 limitInputPixels 拦下 */
function pixelBombPng(width: number, height: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolour
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(Buffer.alloc(4096))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ─── 断言辅助 ───

/** 读回首像素，用于验证 alpha 拍平结果 */
async function firstPixel(
  data: Buffer,
): Promise<{ channels: number; rgb: number[] }> {
  const { data: raw, info } = await sharp(data)
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { channels: info.channels, rgb: [raw[0], raw[1], raw[2]] };
}

// ─── 测试 ───

describe("transcodeImage", () => {
  it("快速通道：已够小的 JPEG 原字节复用（零编码）", async () => {
    const input = await smallJpeg();

    const result = await transcodeImage(input);

    expect(result.passthrough).toBe(true);
    expect(result.encodes).toBe(0);
    expect(result.overBudget).toBe(false);
    // 原字节复用：不是"内容相同"，而是同一个 Buffer
    expect(result.data).toBe(input);
    expect(result.width).toBe(60);
    expect(result.height).toBe(40);
  });

  it("快速通道不适用于带 EXIF 方向的 JPEG（方向必须烤进像素）", async () => {
    const input = await smallJpeg(6);

    const result = await transcodeImage(input);

    expect(result.passthrough).toBe(false);
    expect(result.encodes).toBeGreaterThan(0);
    // orientation 6 = 顺时针 90°：宽高应被交换
    expect(result.width).toBe(40);
    expect(result.height).toBe(60);
    // 输出不再带 orientation（方向已烤进像素，留着会被再转一次）
    const meta = await sharp(result.data).metadata();
    expect(meta.orientation ?? 1).toBe(1);
  });

  it("超过目标体积时逐级降质/降边长，直到达标", async () => {
    const input = await noisePng(1000);
    expect(input.byteLength).toBeGreaterThan(300 * 1024);

    const result = await transcodeImage(input, { targetBytes: 100 * 1024 });

    expect(result.overBudget).toBe(false);
    expect(result.data.byteLength).toBeLessThanOrEqual(100 * 1024);
    // 至少编码一次（不可能命中快速通道：源是 PNG）
    expect(result.encodes).toBeGreaterThan(0);
    expect(result.passthrough).toBe(false);
    // 仍然是一张合法 JPEG
    expect(result.data[0]).toBe(0xff);
    expect(result.data[1]).toBe(0xd8);
  }, 30_000);

  it("不会放大：源图小于最长边时保持原尺寸", async () => {
    const input = await sharp({
      create: { width: 120, height: 90, channels: 3, background: "#aa5500" },
    })
      .png()
      .toBuffer();

    const result = await transcodeImage(input, { maxEdge: 1920 });

    expect(result.width).toBe(120);
    expect(result.height).toBe(90);
  });

  it("alpha 被拍平到白底（JPEG 没有 alpha 通道，不拍平会变黑）", async () => {
    const input = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 4,
        background: { r: 0, g: 0, b: 255, alpha: 0 },
      },
    })
      .png()
      .toBuffer();

    const result = await transcodeImage(input);
    const { channels, rgb } = await firstPixel(result.data);

    expect(channels).toBe(3);
    expect(rgb).toEqual([255, 255, 255]);
  });

  it("所有档位都超目标体积时返回最小档，不抛错（上传不该因压不到目标而失败）", async () => {
    const input = await noisePng(200);

    const result = await transcodeImage(input, { targetBytes: 1 });

    expect(result.overBudget).toBe(true);
    // 仍然给出可用结果（最小档 = 128px 或收敛后的源图边长）
    expect(result.data.byteLength).toBeGreaterThan(0);
    expect(result.data[0]).toBe(0xff);
    expect(result.data[1]).toBe(0xd8);
    // 跑满了全部档位
    expect(result.encodes).toBeGreaterThan(1);
  }, 30_000);

  it("解压炸弹防护：声明像素数超过上限的输入被拒绝", async () => {
    // 10000 x 10000 = 100MP > 64MP，但字节只有几 KB —— 正是要防的形态
    const bomb = pixelBombPng(10_000, 10_000);
    expect(bomb.byteLength).toBeLessThan(64 * 1024);
    expect(10_000 * 10_000).toBeGreaterThan(IMAGE_LIMIT_INPUT_PIXELS);

    await expect(transcodeImage(bomb)).rejects.toThrow();
  }, 30_000);

  it("并发调用被串行化，且都返回有效 JPEG", async () => {
    const inputs = await Promise.all([noisePng(300), noisePng(320), noisePng(340)]);

    const results = await Promise.all(
      inputs.map((buf) => transcodeImage(buf, { targetBytes: 60 * 1024 })),
    );

    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.data[0]).toBe(0xff);
      expect(r.data[1]).toBe(0xd8);
      expect(r.data.byteLength).toBeLessThanOrEqual(60 * 1024);
    }
  }, 30_000);
});

describe("transcodePreview", () => {
  it("缩略图不超过 256px，且体积落在 64KB 预算内", async () => {
    const input = await noisePng(900);

    const result = await transcodePreview(input);

    expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(256);
    expect(result.data.byteLength).toBeLessThanOrEqual(64 * 1024);
    expect(result.data[0]).toBe(0xff);
    expect(result.data[1]).toBe(0xd8);
  }, 30_000);
});
