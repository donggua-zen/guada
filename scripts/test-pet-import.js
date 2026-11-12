/**
 * 桌宠导入逻辑的单元测试（纯 node，不需要 Electron）。
 *
 * 覆盖：图片尺寸头解析、素材校验、id 净化、重名去重、真实复制。
 * 用法：node scripts/test-pet-import.js
 */
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { readImageSize, parseImageSize } = require("../electron/dist/image-size.js");
const {
  inspectPetDir,
  importPetDir,
  sanitizeAvatarId,
  resolveImportTarget,
} = require("../electron/dist/pet-import-core.js");
const {
  deriveAtlasCell,
  isOfficialAtlasSize,
} = require("../electron/dist/atlas-geometry.js");

const ROOT = path.join(__dirname, "..");
const REAL_ATLAS = path.join(os.homedir(), ".petdex", "pets", "lulu-capybara-2");
const OUR_FRAMES = path.join(ROOT, "build-resources", "pets", "silver-haired");

/** 造一张最小 WebP 头（只测尺寸解析，不需要真像素） */
function fakeWebp(variant, width, height) {
  const buf = Buffer.alloc(32, 0);
  buf.write("RIFF", 0, "ascii");
  buf.write("WEBP", 8, "ascii");
  if (variant === "VP8X") {
    buf.write("VP8X", 12, "ascii");
    const w = width - 1;
    const h = height - 1;
    buf[24] = w & 0xff;
    buf[25] = (w >> 8) & 0xff;
    buf[26] = (w >> 16) & 0xff;
    buf[27] = h & 0xff;
    buf[28] = (h >> 8) & 0xff;
    buf[29] = (h >> 16) & 0xff;
  } else if (variant === "VP8L") {
    buf.write("VP8L", 12, "ascii");
    buf[20] = 0x2f;
    const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
    buf.writeUInt32LE(bits >>> 0, 21);
  } else {
    buf.write("VP8 ", 12, "ascii");
    buf[23] = 0x9d;
    buf[24] = 0x01;
    buf[25] = 0x2a;
    buf.writeUInt16LE(width, 26);
    buf.writeUInt16LE(height, 28);
  }
  return buf;
}

function main() {
  // ── 1. 尺寸头解析：三种 WebP + PNG ──
  assert.deepStrictEqual(parseImageSize(fakeWebp("VP8X", 1536, 1872)), { width: 1536, height: 1872 });
  assert.deepStrictEqual(parseImageSize(fakeWebp("VP8L", 384, 384)), { width: 384, height: 384 });
  assert.deepStrictEqual(parseImageSize(fakeWebp("VP8 ", 320, 240)), { width: 320, height: 240 });

  const png = Buffer.alloc(32, 0);
  png.writeUInt32BE(0x89504e47, 0);
  png.writeUInt32BE(256, 16);
  png.writeUInt32BE(128, 20);
  assert.deepStrictEqual(parseImageSize(png), { width: 256, height: 128 });
  assert.strictEqual(parseImageSize(Buffer.alloc(32, 1)), null, "无法识别的头返回 null");
  console.log("PET_IMPORT_OK image-size-header");

  // ── 2. 真实文件（本地素材）──
  assert.deepStrictEqual(
    readImageSize(path.join(OUR_FRAMES, "idle", "frame_001.webp")),
    { width: 384, height: 384 },
  );
  assert.deepStrictEqual(readImageSize(path.join(OUR_FRAMES, "avatar.webp")), {
    width: 256,
    height: 256,
  });
  console.log("PET_IMPORT_OK image-size-real");

  // ── 2b. 图集几何推导：官方规格 + ChatGPT 导出 ──
  assert.deepStrictEqual(deriveAtlasCell(1536, 1872), { width: 192, height: 208 });
  const chatgpt = deriveAtlasCell(1536, 2288);
  assert.ok(chatgpt && Math.abs(chatgpt.height - 254.222) < 0.01, "1536×2288 → 单格 192×254.2");
  assert.strictEqual(isOfficialAtlasSize(1536, 1872), true);
  assert.strictEqual(isOfficialAtlasSize(1536, 2288), false);
  // 太小 / 比例离谱 / 非法输入
  assert.strictEqual(deriveAtlasCell(768, 936), null, "单格 96×104 太小");
  assert.strictEqual(deriveAtlasCell(1600, 400), null, "比例离谱");
  assert.strictEqual(deriveAtlasCell(0, 0), null);
  assert.strictEqual(deriveAtlasCell(Number.NaN, 1872), null);
  console.log("PET_IMPORT_OK atlas-geometry");

  // ── 3. 素材识别：我们的 frames ──
  const frames = inspectPetDir(OUR_FRAMES);
  assert.ok(typeof frames === "object", `frames 素材应通过，实际 ${frames}`);
  assert.strictEqual(frames.format, "frames");
  assert.ok(frames.name.length > 0);
  console.log("PET_IMPORT_OK inspect-frames");

  // ── 4. 素材识别：真实 Petdex 图集（装了才测）──
  if (fs.existsSync(REAL_ATLAS)) {
    const atlas = inspectPetDir(REAL_ATLAS);
    assert.ok(typeof atlas === "object", `真实图集应通过，实际 ${atlas}`);
    assert.strictEqual(atlas.format, "atlas");
    console.log("PET_IMPORT_OK inspect-real-atlas", atlas.name);
  } else {
    console.log("PET_IMPORT_SKIP inspect-real-atlas（本机没有 ~/.petdex/pets/lulu-capybara-2）");
  }

  // ── 5. 各类坏目录 ──
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pet-import-"));
  const empty = path.join(tmp, "empty");
  fs.mkdirSync(empty);
  assert.strictEqual(typeof inspectPetDir(empty), "string", "空目录应报错");

  const badSize = path.join(tmp, "bad-size");
  fs.mkdirSync(badSize);
  fs.writeFileSync(
    path.join(badSize, "pet.json"),
    JSON.stringify({ displayName: "x", spritesheetPath: "s.webp" }),
  );
  fs.writeFileSync(path.join(badSize, "s.webp"), fakeWebp("VP8X", 512, 512));
  assert.match(String(inspectPetDir(badSize)), /尺寸不合法.*512×512/);

  const escape = path.join(tmp, "escape");
  fs.mkdirSync(escape);
  fs.writeFileSync(
    path.join(escape, "pet.json"),
    JSON.stringify({ displayName: "x", spritesheetPath: "../x.webp" }),
  );
  assert.match(String(inspectPetDir(escape)), /同目录文件名/);

  const noAnim = path.join(tmp, "no-anim");
  fs.mkdirSync(noAnim);
  fs.writeFileSync(path.join(noAnim, "manifest.json"), JSON.stringify({ name: "x" }));
  assert.match(String(inspectPetDir(noAnim)), /缺少 animations/);
  console.log("PET_IMPORT_OK inspect-invalid");

  // ── 6. id 净化与重名去重 ──
  assert.strictEqual(sanitizeAvatarId("Lulu Capybara!"), "lulu-capybara");
  assert.strictEqual(sanitizeAvatarId("  "), "pet");
  assert.strictEqual(sanitizeAvatarId("../../etc"), "etc", "路径片段被压平");
  console.log("PET_IMPORT_OK sanitize-id");

  const destRoot = path.join(tmp, "dest");
  const first = importPetDir(OUR_FRAMES, destRoot);
  assert.strictEqual(first.ok, true);
  assert.strictEqual(first.id, "silver-haired");
  const second = importPetDir(OUR_FRAMES, destRoot);
  assert.strictEqual(second.ok, true);
  assert.strictEqual(second.id, "silver-haired-2", "重名应自动加 -2，不覆盖");
  assert.ok(fs.existsSync(path.join(destRoot, "silver-haired-2", "manifest.json")));
  assert.strictEqual(
    resolveImportTarget(destRoot, "silver-haired"),
    path.join(destRoot, "silver-haired-3"),
  );
  console.log("PET_IMPORT_OK import-and-dedupe");

  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* Windows 上可能被占用，忽略 */
  }
  console.log("PET_IMPORT_TEST_OK");
}

main();
