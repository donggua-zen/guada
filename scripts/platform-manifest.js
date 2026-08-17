/**
 * 平台二进制裁剪清单
 *
 * 集中定义所有按平台分发的可选包/二进制文件，供依赖优化脚本
 * （optimize-electron-deps.js）与原生模块校验脚本（rebuild-native-electron.js）复用。
 *
 * 目标平台语义（TARGET_PLATFORMS / SHARP_TARGET_PLATFORMS）：
 *   - 平台粒度：darwin / linux / win32（多值用逗号分隔）
 *   - 例如 darwin 会保留 darwin-x64 与 darwin-arm64 两套二进制
 *   - 不传时默认只保留当前构建平台
 */

const PLATFORM_ALIASES = {
  win: "win32",
  windows: "win32",
  mac: "darwin",
  macos: "darwin",
  darwin: "darwin",
  linux: "linux",
  freebsd: "freebsd",
};

/**
 * 规范化平台名
 * @param {string|string[]} platforms
 * @returns {string[]}
 */
function normalizePlatforms(platforms) {
  const list = Array.isArray(platforms) ? platforms : String(platforms || "").split(",");
  const normalized = new Set();
  for (const item of list) {
    const key = item.trim().toLowerCase();
    if (!key) continue;
    normalized.add(PLATFORM_ALIASES[key] || key);
  }
  return [...normalized];
}

/**
 * 解析目标平台列表。
 * 优先级：TARGET_PLATFORMS > SHARP_TARGET_PLATFORMS > 当前构建平台。
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
function resolveTargetPlatforms(env = process.env) {
  const raw = env.TARGET_PLATFORMS || env.SHARP_TARGET_PLATFORMS || process.platform;
  return normalizePlatforms(raw);
}

/**
 * 按平台分发的可选 npm 包族（optionalDependencies）。
 * scanDir：包族所在目录（scoped 包在对应 scope 目录下，否则在 node_modules 根）。
 * keep(entryName, platforms)：返回该平台包名是否应保留。
 */
const PACKAGE_FAMILIES = [
  {
    name: "@img/sharp-libvips",
    prefix: "sharp-libvips-",
    describe: "sharp libvips 预编译二进制",
    keep: (name, platforms) =>
      platforms.some((p) => name.startsWith(`sharp-libvips-${p}`)),
  },
  {
    name: "@img/sharp",
    prefix: "sharp-",
    describe: "sharp 预编译二进制",
    keep: (name, platforms) =>
      platforms.some((p) => name.startsWith(`sharp-${p}`)),
  },
  {
    name: "sqlite-vec",
    prefix: "sqlite-vec-",
    describe: "sqlite-vec 预编译二进制",
    keep: (name, platforms) =>
      platforms.some((p) => {
        const token = p === "win32" ? "windows" : p;
        return name.startsWith(`sqlite-vec-${token}`);
      }),
  },
  {
    name: "@node-rs/jieba",
    prefix: "jieba-",
    describe: "@node-rs/jieba 预编译二进制",
    keep: (name, platforms) =>
      platforms.some((p) => name.startsWith(`jieba-${p}`)),
  },
  {
    name: "@parcel/watcher",
    prefix: "watcher-",
    describe: "@parcel/watcher 预编译二进制",
    keep: (name, platforms) =>
      platforms.some((p) => name.startsWith(`watcher-${p}`)),
  },
];

/**
 * 单包内嵌多平台二进制文件的模块（npm 层面只有一个包，包内含多平台 .node 文件）。
 */
const IN_PACKAGE_BINARIES = [
  {
    name: "@huggingface/tokenizers",
    describe: "@huggingface/tokenizers 内嵌平台二进制",
    match: (name) =>
      name.endsWith(".node") &&
      /(darwin|linux|win32|win-x64|freebsd|android)/i.test(name),
    platformOf: (name) => {
      const lower = name.toLowerCase();
      if (lower.includes("darwin")) return "darwin";
      if (lower.includes("linux")) return "linux";
      if (lower.includes("win32") || lower.includes("win-x64")) return "win32";
      if (lower.includes("freebsd")) return "freebsd";
      if (lower.includes("android")) return "android";
      return null;
    },
  },
];

/**
 * Prisma 引擎文件名中的平台标记 → 目标平台。
 * 无平台标记的文件返回 null（视为通用文件，保留）。
 * @param {string} name 文件名
 * @returns {string|null}
 */
function prismaEnginePlatform(name) {
  const lower = name.toLowerCase();
  if (lower.includes("windows") || lower.includes("win32")) return "win32";
  if (lower.includes("linux")) return "linux";
  if (lower.includes("darwin") || lower.includes("macos")) return "darwin";
  return null;
}

module.exports = {
  PLATFORM_ALIASES,
  normalizePlatforms,
  resolveTargetPlatforms,
  PACKAGE_FAMILIES,
  IN_PACKAGE_BINARIES,
  prismaEnginePlatform,
};
