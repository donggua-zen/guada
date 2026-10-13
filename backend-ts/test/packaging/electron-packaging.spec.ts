/**
 * 打包契约：后端在运行时按 `process.cwd()`（生产环境 = `<resources>/backend-ts`）解析的随包资源，
 * 必须出现在 electron-builder 的 `extraResources` 里，且 `to` 与 `from` 同路径。
 *
 * 为什么需要这个测试：`bundled-*` 三个目录曾经漏出打包清单——它们在 git 里有内容、运行时读得到
 * （开发环境 cwd = 仓库 backend-ts），所以本地一切正常；但安装版会静默缺少内置技能 / 助手模板 /
 * 供应商目录（三处读取点都是"缺目录就跳过/只 warn"），一直没人发现。
 */
import * as fs from "fs";
import * as path from "path";

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf-8"));

/**
 * 运行时按 cwd / `__dirname` 解析、必须随包分发的资源目录。
 * （`backend-ts/node_modules_production/node_modules` 不在本清单内：它按设计 `to ≠ from`，
 * 且已从 extraResources 改为走 `build.files` 打进 app.asar，见文件末尾的 asar 契约。）
 */
const REQUIRED_RESOURCE_DIRS = [
  // 编译产物：__dirname 相对定位（main.js、迁移 SQL、policy-defaults.yaml）
  "backend-ts/dist",
  // STATIC_DIR 的兜底：__dirname/../static
  "backend-ts/static",
  // cwd()/bundled-skills：skill-creator / skill-installer + scripts/validate-skill.mjs
  "backend-ts/bundled-skills",
  // cwd()/bundled-agents：内置助手模板（首启补种）
  "backend-ts/bundled-agents",
  // cwd()/bundled-providers："可添加供应商"目录 + README 补种
  "backend-ts/bundled-providers",
];

const BUNDLED_DIRS = ["bundled-skills", "bundled-agents", "bundled-providers"];

interface ResourceEntry {
  from: string;
  to?: string;
  filter?: string[];
}

const extraResources: ResourceEntry[] = pkg.build?.extraResources ?? [];

describe("Electron 打包契约：随包后端资源", () => {
  it("必需资源目录都在 build.extraResources 里，且 to === from（cwd 相对解析能命中的前提）", () => {
    for (const dir of REQUIRED_RESOURCE_DIRS) {
      const entry = extraResources.find((e) => e.from === dir);
      expect(entry).toBeDefined();
      expect(entry?.to).toBe(dir);
    }
  });

  it("三个 bundled-* 目录在仓库里非空（防空目录被静默打包）", () => {
    for (const dir of BUNDLED_DIRS) {
      const abs = path.join(repoRoot, "backend-ts", dir);
      expect(fs.existsSync(abs)).toBe(true);
      expect(fs.readdirSync(abs).length).toBeGreaterThan(0);
    }
  });

  it("Docker 分发与 electron 包对齐：每个 bundled-* 都有 COPY", () => {
    const dockerfile = fs.readFileSync(path.join(repoRoot, "backend-ts", "Dockerfile"), "utf-8");
    for (const dir of BUNDLED_DIRS) {
      expect(dockerfile).toMatch(new RegExp(`^COPY[^\\n]*backend-ts/${dir}\\b`, "m"));
    }
  });
});

/**
 * 后端依赖进 app.asar 的契约。
 *
 * 背景：安装耗时 ≈ 盘上文件数 × 18ms（实测：GuaDa 17,211 文件/347s，ZCode 1,108 文件/16.4s，
 * 包体字节数几乎不影响）。把 1.5 万个 node_modules 文件打进 asar 后安装只需写 1 个文件。
 * 代价是"依赖不再在真实目录里"，几处约束一旦被改坏，安装版会在启动或加载原生模块时才炸：
 *   - 入口 `dist/main.js` 仍是真实路径 → 必须靠 NODE_PATH 指路（electron/main.ts）
 *   - walker 默认丢弃嵌套 node_modules → 必须 includeSubNodeModules
 *   - asarUnpack 的 glob 按【源路径】匹配（appDir 相对），不是 `to` 路径
 */
describe("Electron 打包契约：后端依赖打进 app.asar", () => {
  const build = pkg.build ?? {};
  const NODE_MODULES_SRC = "backend-ts/node_modules_production/node_modules";
  const filesEntry = (build.files ?? []).find(
    (f: unknown) =>
      typeof f === "object" && (f as { from?: string }).from === NODE_MODULES_SRC,
  ) as { from: string; to: string; filter?: string[] } | undefined;

  it("node_modules 走 files 进 asar，且不再出现在 extraResources 里", () => {
    expect(filesEntry).toBeDefined();
    expect(filesEntry?.to).toBe("backend-ts/node_modules");
    expect(extraResources.some((e) => e.from.includes("node_modules"))).toBe(false);
  });

  it("过滤规则随条目一起搬过来了（否则会打进 test/docs/*.map 等一堆废文件）", () => {
    expect(filesEntry?.filter).toContain("!**/*.map");
    expect(filesEntry?.filter).toContain("!**/__tests__/**");
  });

  it("includeSubNodeModules 必须为 true：walker 默认丢弃嵌套 node_modules（20+ 个）", () => {
    expect(build.includeSubNodeModules).toBe(true);
  });

  it("asarUnpack 覆盖所有需要真实文件的原生包", () => {
    const patterns: string[] = build.asarUnpack ?? [];
    for (const need of [
      "better-sqlite3",
      "node-pty",
      "sqlite-vec-",
      "@parcel/watcher-",
      "@img/sharp-",
      "@napi-rs/canvas-",
      "@node-rs/jieba-",
    ]) {
      expect(patterns.some((p) => p.includes(need))).toBe(true);
    }
  });

  it("asarUnpack 的 glob 按源路径书写（electron-builder 匹配 appDir 相对路径，不是 to 路径）", () => {
    for (const p of build.asarUnpack ?? []) {
      expect(p.startsWith(`${NODE_MODULES_SRC}/`)).toBe(true);
    }
  });
});
