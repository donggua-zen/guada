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
 * （`backend-ts/node_modules_production/node_modules` 那条按设计 `to ≠ from`，不在本清单内。）
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
