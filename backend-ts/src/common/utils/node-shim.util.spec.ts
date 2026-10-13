import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { applyNodeShim, resolveNodeShimDir } from "./node-shim.util";

// 让「没有可用 Electron 运行时」这条分支可确定复现：electron 包不可解析时 require 返回非字符串。
jest.mock("electron", () => ({}), { virtual: true });

describe("node-shim.util", () => {
  let tmpRoot: string;
  const savedEnv: Record<string, string | undefined> = {};
  const ENV_KEYS = [
    "GUADA_ELECTRON_BIN",
    "GUADA_RUNTIME_BIN_DIR",
    "ELECTRON_APP",
    "PATH",
  ];

  beforeEach(() => {
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "guada-shim-"));
    process.env.GUADA_RUNTIME_BIN_DIR = path.join(tmpRoot, "runtime-bin");
    // 固定运行时，避免测试依赖 electron 包能否被解析
    process.env.GUADA_ELECTRON_BIN = process.execPath;
    delete process.env.ELECTRON_APP;
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  describe("resolveNodeShimDir", () => {
    it("posix shim 落盘为可执行脚本，内部设置 ELECTRON_RUN_AS_NODE", () => {
      const dir = resolveNodeShimDir("posix");
      expect(dir).not.toBeNull();

      const file = path.join(dir!, "node");
      const content = fs.readFileSync(file, "utf8");
      expect(content).toContain("ELECTRON_RUN_AS_NODE=1");
      expect(content).toContain('exec "$GUADA_ELECTRON_BIN" "$@"');

      if (process.platform !== "win32") {
        expect(fs.statSync(file).mode & 0o111).not.toBe(0);
      }
    });

    it("win shim 落盘为 node.cmd，内部设置 ELECTRON_RUN_AS_NODE", () => {
      const dir = resolveNodeShimDir("win");
      expect(dir).not.toBeNull();

      const content = fs.readFileSync(path.join(dir!, "node.cmd"), "utf8");
      expect(content).toContain('set "ELECTRON_RUN_AS_NODE=1"');
      expect(content).toContain("%GUADA_ELECTRON_BIN%");
    });

    it("重复调用内容不变（幂等）", () => {
      const first = resolveNodeShimDir("posix");
      const second = resolveNodeShimDir("posix");
      expect(second).toBe(first);
      expect(fs.readdirSync(first!)).toEqual(["node"]);
    });

    it("目录写不进去时返回 null 而不抛错", () => {
      // 把落盘根指到一个已存在的文件上，mkdir 必然失败
      const blocked = path.join(tmpRoot, "blocked");
      fs.writeFileSync(blocked, "not a dir");
      process.env.GUADA_RUNTIME_BIN_DIR = blocked;

      expect(resolveNodeShimDir("posix")).toBeNull();
    });
  });

  describe("applyNodeShim", () => {
    it("把 shim 目录追加到 PATH 末尾，并注入可执行文件路径", () => {
      const env: NodeJS.ProcessEnv = { PATH: ["/usr/bin", "/bin"].join(path.delimiter) };

      const result = applyNodeShim(env, "posix");

      const entries = result.PATH!.split(path.delimiter);
      expect(entries[0]).toBe("/usr/bin");
      expect(entries[entries.length - 1]).toBe(resolveNodeShimDir("posix"));
      expect(result.GUADA_ELECTRON_BIN).toBe(process.execPath);
    });

    it("用户自己的 node 目录排在前面（不遮蔽）", () => {
      const userNodeDir = path.join(tmpRoot, "user-node");
      const env: NodeJS.ProcessEnv = {
        PATH: [userNodeDir, "/usr/bin"].join(path.delimiter),
      };

      const result = applyNodeShim(env, "posix");

      const entries = result.PATH!.split(path.delimiter);
      expect(entries.indexOf(userNodeDir)).toBeLessThan(entries.length - 1);
    });

    it("重复应用不会在 PATH 里出现重复项", () => {
      const env: NodeJS.ProcessEnv = { PATH: "/usr/bin" };

      applyNodeShim(env, "posix");
      const after = applyNodeShim(env, "posix");

      const entries = after.PATH!.split(path.delimiter);
      expect(new Set(entries).size).toBe(entries.length);
    });

    it("把 Windows 上大小写不一致的 Path 收敛成单个 PATH 键", () => {
      const env: NodeJS.ProcessEnv = { Path: "/usr/bin" };

      const result = applyNodeShim(env, "win");

      expect(Object.keys(result).filter((k) => k.toUpperCase() === "PATH")).toEqual([
        "PATH",
      ]);
      expect(result.PATH!.startsWith("/usr/bin")).toBe(true);
    });

    it("shim 不可用时原样返回环境", () => {
      const blocked = path.join(tmpRoot, "blocked2");
      fs.writeFileSync(blocked, "not a dir");
      process.env.GUADA_RUNTIME_BIN_DIR = blocked;

      const env: NodeJS.ProcessEnv = { PATH: "/usr/bin" };
      const result = applyNodeShim(env, "posix");

      expect(result.PATH).toBe("/usr/bin");
      expect(result.GUADA_ELECTRON_BIN).toBeUndefined();
    });

    it("运行在 Electron 运行时里时用 process.execPath（打包态）", () => {
      delete process.env.GUADA_ELECTRON_BIN;
      const versions = process.versions as Record<string, string | undefined>;
      const saved = versions.electron;
      versions.electron = "41.10.7";
      try {
        const env: NodeJS.ProcessEnv = { PATH: "/usr/bin" };
        const result = applyNodeShim(env, "posix");

        expect(result.GUADA_ELECTRON_BIN).toBe(process.execPath);
        expect(result.PATH!.endsWith(resolveNodeShimDir("posix")!)).toBe(true);
      } finally {
        if (saved === undefined) delete versions.electron;
        else versions.electron = saved;
      }
    });

    it("没有可用的 Electron 可执行文件时不改动环境", () => {
      process.env.GUADA_ELECTRON_BIN = path.join(tmpRoot, "does-not-exist");

      const env: NodeJS.ProcessEnv = { PATH: "/usr/bin" };
      const result = applyNodeShim(env, "posix");

      expect(result).toEqual({ PATH: "/usr/bin" });
      expect(result.GUADA_ELECTRON_BIN).toBeUndefined();
    });
  });
});
