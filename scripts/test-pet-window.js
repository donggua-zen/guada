const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const {
  resolvePetsRootDir,
  resolvePetUiHtmlPath,
  findPetAvatarDir,
  firstPetAvatarId,
  isValidAvatarId,
  listPetAvatars,
  pointInRect,
  resolvePetHit,
  clampNumber,
  clampPetScale,
  computePetWindowSize,
  clampPetPosition,
  defaultPetPosition,
  findDisplayForPoint,
  readPetPositionFile,
  PET_WINDOW_WIDTH,
  PET_WINDOW_HEIGHT,
  PET_AVATAR_DEFAULT,
} = require("../electron/dist/pet-window.js");

function main() {
  // ── 形象目录 ──────────────────────────────────────────────
  const devRoot = resolvePetsRootDir(true, "/app/electron/dist", "/res");
  assert.ok(
    devRoot.replace(/\\/g, "/").endsWith("build-resources/pets"),
    `dev 根目录应指向 build-resources/pets，实际 ${devRoot}`,
  );
  assert.ok(!devRoot.includes("/res"), `dev 不应使用 resourcesPath，实际 ${devRoot}`);
  console.log("PET_OK resolvePetsRootDir:dev");

  const prodRoot = resolvePetsRootDir(false, "/app/electron/dist", "/app/resources");
  assert.ok(
    prodRoot.replace(/\\/g, "/").endsWith("resources/build-resources/pets"),
    `prod 根目录应指向 resources/build-resources/pets，实际 ${prodRoot}`,
  );
  console.log("PET_OK resolvePetsRootDir:prod");

  // 桌宠页面（所有形象共用）：dev 走仓库、prod 走 resources（打包后路径）
  const devUi = resolvePetUiHtmlPath(true, "/app/electron/dist", "/res");
  assert.ok(
    devUi.replace(/\\/g, "/").endsWith("build-resources/pet-ui/pet.html"),
    `dev 页面路径应是 build-resources/pet-ui/pet.html，实际 ${devUi}`,
  );
  assert.ok(!devUi.startsWith("/res"), "dev 不应使用 resourcesPath");
  const prodUi = resolvePetUiHtmlPath(false, "/app/electron/dist", "/app/resources");
  assert.strictEqual(
    prodUi.replace(/\\/g, "/"),
    "/app/resources/build-resources/pet-ui/pet.html",
    "prod 页面路径必须在 resources 下（extraResources 拷 build-resources 到 resources/）",
  );
  console.log("PET_OK resolvePetUiHtmlPath");

  // ── 形象目录解析（多根，用户优先） ──────────────────────
  const bundledRoot = path.join(__dirname, "..", "build-resources", "pets");
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "pet-roots-"));
  const userRoot = path.join(scratch, "user");
  fs.mkdirSync(userRoot, { recursive: true });

  // 用户目录里放一个同名形象，应当覆盖内置的同 id
  const shadow = path.join(userRoot, PET_AVATAR_DEFAULT);
  fs.mkdirSync(shadow, { recursive: true });
  fs.writeFileSync(path.join(shadow, "manifest.json"), JSON.stringify({ name: "用户版" }));

  const roots = [
    { dir: userRoot, source: "user" },
    { dir: bundledRoot, source: "bundled" },
  ];
  const resolved = findPetAvatarDir(roots, PET_AVATAR_DEFAULT);
  assert.ok(resolved && resolved.includes("user"), `应优先命中用户目录，实际 ${resolved}`);
  assert.strictEqual(
    findPetAvatarDir(roots, "../../etc"),
    null,
    "非法 id 不解析（不做路径穿越）",
  );
  assert.strictEqual(firstPetAvatarId([]), null, "没有素材根时返回 null");

  // 同名 id 去重：用户目录胜出
  const listed = listPetAvatars(roots);
  const defaultEntry = listed.find((a) => a.id === PET_AVATAR_DEFAULT);
  assert.strictEqual(defaultEntry.source, "user", "同名形象应以用户目录为准");
  assert.strictEqual(listed.filter((a) => a.id === PET_AVATAR_DEFAULT).length, 1, "不应重复列出");
  fs.rmSync(scratch, { recursive: true, force: true });
  console.log("PET_OK findPetAvatarDir:multi-root");

  // ── 形象 id 校验 ──────────────────────────────────────────
  assert.strictEqual(isValidAvatarId("silver-haired"), true);
  assert.strictEqual(isValidAvatarId("a1"), true);
  assert.strictEqual(isValidAvatarId("../x"), false);
  assert.strictEqual(isValidAvatarId("a/b"), false);
  assert.strictEqual(isValidAvatarId(""), false);
  assert.strictEqual(isValidAvatarId("x".repeat(65)), false);
  console.log("PET_OK isValidAvatarId");

  // ── 形象扫描（真实素材目录） ──────────────────────────────
  const realRoot = path.join(__dirname, "..", "build-resources", "pets");
  const avatars = listPetAvatars([{ dir: realRoot, source: "bundled" }]);
  assert.ok(avatars.length >= 1, `至少应扫描到一个形象，实际 ${avatars.length}`);
  assert.strictEqual(avatars[0].id, PET_AVATAR_DEFAULT, "默认形象应排在最前");
  assert.ok(avatars[0].name.length > 0, "形象应有名称（取自 manifest.json）");
  assert.strictEqual(avatars[0].format, "frames", "我们自己的素材是 frames 格式");
  assert.strictEqual(avatars[0].source, "bundled", "来自内置目录");
  assert.ok(
    avatars[0].previewDataUrl?.startsWith("data:image/webp;base64,"),
    "预览图应是 webp data URL",
  );
  // 空目录 → 空数组（不抛错）；不存在的目录也会走同一兜底分支
  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pet-empty-"));
  assert.deepStrictEqual(
    listPetAvatars([{ dir: emptyRoot, source: "user" }]),
    [],
    "空目录返回空数组",
  );
  fs.rmSync(emptyRoot, { recursive: true, force: true });
  console.log("PET_OK listPetAvatars", JSON.stringify(avatars.map((a) => a.id)));

  // ── 点命中（半开区间） ─────────────────────────────────────
  const rect = { x: 10, y: 20, w: 100, h: 80 };
  assert.strictEqual(pointInRect({ x: 10, y: 20 }, rect), true, "左上角算命中");
  assert.strictEqual(pointInRect({ x: 109, y: 99 }, rect), true, "右下内侧算命中");
  assert.strictEqual(pointInRect({ x: 110, y: 20 }, rect), false, "右边界不算命中");
  assert.strictEqual(pointInRect({ x: 10, y: 100 }, rect), false, "下边界不算命中");
  assert.strictEqual(pointInRect({ x: 9, y: 20 }, rect), false, "左侧外不算命中");
  console.log("PET_OK pointInRect");

  // ── 光标 → 是否可交互 ─────────────────────────────────────
  const bounds = { x: 1000, y: 500, width: 280, height: 300 };
  // 宠物紧包围盒（idle 时只占画布中间一条）与气泡
  const geometry = {
    image: { x: 100, y: 80, w: 65, h: 202 },
    bubble: { x: 15, y: 26, w: 250, h: 56 },
  };

  assert.strictEqual(
    resolvePetHit({ x: 1100, y: 700 }, bounds, geometry),
    true,
    "命中宠物本体",
  );
  assert.strictEqual(
    resolvePetHit({ x: 1100, y: 560 }, bounds, geometry),
    true,
    "命中气泡",
  );
  // 画布两侧的透明区（立绘左右各约 100px）必须穿透，否则会挡住桌面点击
  assert.strictEqual(
    resolvePetHit({ x: 1020, y: 700 }, bounds, geometry),
    false,
    "立绘左侧透明区应穿透",
  );
  assert.strictEqual(
    resolvePetHit({ x: 1250, y: 700 }, bounds, geometry),
    false,
    "立绘右侧透明区应穿透",
  );
  assert.strictEqual(
    resolvePetHit({ x: 1010, y: 510 }, bounds, geometry),
    false,
    "窗口空白区应穿透",
  );
  assert.strictEqual(
    resolvePetHit({ x: 500, y: 300 }, bounds, geometry),
    false,
    "窗口外应穿透",
  );
  assert.strictEqual(
    resolvePetHit({ x: 1100, y: 700 }, bounds, null),
    false,
    "尚未上报几何时保持穿透",
  );
  // 气泡收起时不应命中气泡位置
  assert.strictEqual(
    resolvePetHit(
      { x: 1100, y: 560 },
      bounds,
      { image: geometry.image, bubble: null },
    ),
    false,
    "气泡收起后该区域应穿透",
  );
  console.log("PET_OK resolvePetHit");

  // ── 宠物大小 → 窗口尺寸 ──────────────────────────────────
  assert.strictEqual(clampPetScale(1), 1);
  assert.strictEqual(clampPetScale(0.1), 0.6, "低于下限收到 0.6");
  assert.strictEqual(clampPetScale(9), 2, "高于上限收到 2");
  assert.strictEqual(clampPetScale(Number.NaN), 1, "NaN 回落到 1");
  assert.strictEqual(clampPetScale(undefined), 1);

  const base = computePetWindowSize(210);
  assert.deepStrictEqual(
    base,
    { width: PET_WINDOW_WIDTH, height: PET_WINDOW_HEIGHT },
    "基准尺寸应与常量一致（向后兼容）",
  );
  const big = computePetWindowSize(420);
  assert.ok(big.width > base.width, "宠物变大窗口应变宽");
  assert.ok(big.height > base.height, "宠物变大窗口应变高");
  assert.strictEqual(big.height, 420 + 170, "高度 = 宠物 + 气泡区");
  const small = computePetWindowSize(126);
  assert.strictEqual(small.width, PET_WINDOW_WIDTH, "小宠物时宽度不小于气泡所需");
  console.log("PET_OK pet-scale", JSON.stringify({ base, big, small }));

  // ── 数值夹取 ──────────────────────────────────────────────
  assert.strictEqual(clampNumber(5, 0, 10), 5);
  assert.strictEqual(clampNumber(-5, 0, 10), 0);
  assert.strictEqual(clampNumber(50, 0, 10), 10);
  // 区间反转（内容比工作区还宽）时取下界，保证至少一侧可见
  assert.strictEqual(clampNumber(50, 100, 10), 100);
  console.log("PET_OK clampNumber");

  // ── 位置夹取 ──────────────────────────────────────────────
  const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
  const size = { width: PET_WINDOW_WIDTH, height: PET_WINDOW_HEIGHT };

  const clampedLeft = clampPetPosition({ x: -300, y: 500 }, workArea, size);
  assert.deepStrictEqual(clampedLeft, { x: 0, y: 500 }, "越左边界回夹到 0");
  const clampedRight = clampPetPosition({ x: 9999, y: 500 }, workArea, size);
  assert.strictEqual(
    clampedRight.x,
    1920 - PET_WINDOW_WIDTH,
    "越右边界夹到最右可见位置",
  );
  const clampedBottom = clampPetPosition({ x: 100, y: 9999 }, workArea, size);
  assert.strictEqual(
    clampedBottom.y,
    1040 - PET_WINDOW_HEIGHT,
    "越下边界夹到最下可见位置",
  );
  console.log("PET_OK clampPetPosition");

  // 副屏工作区（负坐标，主屏在右侧）
  const secondary = { x: -1920, y: 0, width: 1920, height: 1040 };
  const inSecondary = clampPetPosition({ x: -1500, y: 500 }, secondary, size);
  assert.deepStrictEqual(inSecondary, { x: -1500, y: 500 }, "副屏内位置原样保留");
  // 副屏内但越过下边界（1040 - 窗高）→ 夹到边界
  const maxY = 1040 - PET_WINDOW_HEIGHT;
  const secondaryOverflow = clampPetPosition({ x: -1500, y: maxY + 60 }, secondary, size);
  assert.deepStrictEqual(
    secondaryOverflow,
    { x: -1500, y: maxY },
    "副屏内越下边界按该屏工作区夹取",
  );
  console.log("PET_OK clampPetPosition:secondary");

  // ── 默认落点 ──────────────────────────────────────────────
  const fallback = defaultPetPosition(workArea, size);
  assert.strictEqual(fallback.x, 1920 - PET_WINDOW_WIDTH - 24, "右下角留 24px");
  assert.strictEqual(fallback.y, 1040 - PET_WINDOW_HEIGHT - 24, "右下角留 24px");
  console.log("PET_OK defaultPetPosition");

  // ── 显示器定位 ────────────────────────────────────────────
  const displays = [
    { bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
    { bounds: { x: -1920, y: 0, width: 1920, height: 1080 } },
  ];
  assert.strictEqual(
    findDisplayForPoint({ x: 100, y: 100 }, displays).bounds.x,
    0,
    "落在主屏",
  );
  assert.strictEqual(
    findDisplayForPoint({ x: -1000, y: 100 }, displays).bounds.x,
    -1920,
    "落在副屏",
  );
  assert.strictEqual(
    findDisplayForPoint({ x: 5000, y: 5000 }, displays),
    undefined,
    "屏幕外返回 undefined",
  );
  console.log("PET_OK findDisplayForPoint");

  // ── 位置文件容错 ──────────────────────────────────────────
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pet-pos-"));

  assert.strictEqual(
    readPetPositionFile(path.join(tmpDir, "missing.json")),
    null,
    "文件不存在返回 null",
  );

  const brokenPath = path.join(tmpDir, "broken.json");
  fs.writeFileSync(brokenPath, "{not json", "utf8");
  assert.strictEqual(readPetPositionFile(brokenPath), null, "损坏 JSON 返回 null");

  const badFieldsPath = path.join(tmpDir, "bad-fields.json");
  fs.writeFileSync(badFieldsPath, JSON.stringify({ x: "12", y: 34 }), "utf8");
  assert.strictEqual(readPetPositionFile(badFieldsPath), null, "字段类型非法返回 null");

  const nanPath = path.join(tmpDir, "nan.json");
  fs.writeFileSync(nanPath, JSON.stringify({ x: 1, y: 2 }).replace("2", "null"), "utf8");
  assert.strictEqual(readPetPositionFile(nanPath), null, "null 字段返回 null");

  const goodPath = path.join(tmpDir, "good.json");
  fs.writeFileSync(goodPath, JSON.stringify({ x: 100, y: 200 }), "utf8");
  assert.deepStrictEqual(readPetPositionFile(goodPath), { x: 100, y: 200 }, "合法文件正常读取");
  console.log("PET_OK readPetPositionFile");

  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log("PET_WINDOW_TEST_OK");
}

main();
