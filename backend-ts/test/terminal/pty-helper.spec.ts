/**
 * pty-helper —— 此前零测试。
 *
 * 关注两件事：
 *  1. toUnpackedPath 的 asar 路径改写（打包版里最经典的踩坑点）
 *  2. ensureSpawnHelperExecutable 的 darwin 前置守卫：helper 缺 x 位时原生层会
 *     std::terminate 直接 abort 整个后端进程（JS 层拦不住），所以这条路径值得钉住。
 *
 * fs 用 jest.mock 注入（ts-jest 的 __importStar 命名空间属性是只读 getter，
 * 直接 jest.spyOn(fs, ...) 会报 Cannot redefine property）。
 */
jest.mock("node:fs", () => {
  const actual = jest.requireActual("node:fs");
  return {
    ...actual,
    existsSync: jest.fn(),
    statSync: jest.fn(),
    chmodSync: jest.fn(),
  };
});

import * as fs from "node:fs";
import {
  toUnpackedPath,
  PtyHelperError,
  ensureSpawnHelperExecutable,
} from "../../src/modules/terminal/pty-helper";

const mockedExistsSync = fs.existsSync as unknown as jest.Mock;
const mockedStatSync = fs.statSync as unknown as jest.Mock;
const mockedChmodSync = fs.chmodSync as unknown as jest.Mock;

/**
 * 重新加载一份模块副本，拿到干净的模块级 verified 缓存。
 *
 * 注意：副本里的 PtyHelperError 与顶层 import 的不是同一个类对象，
 * 因此断言 instanceof 时必须用副本自己导出的那个类。
 */
function loadFreshModule(): {
  ensure: () => void;
  PtyHelperError: typeof PtyHelperError;
} {
  let mod: any;
  jest.isolateModules(() => {
    mod = require("../../src/modules/terminal/pty-helper");
  });
  return { ensure: mod.ensureSpawnHelperExecutable, PtyHelperError: mod.PtyHelperError };
}

function usePlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
}

/** 让 existsSync 认为 pty.node 与 spawn-helper 都存在 */
function pretendNativeFilesExist(): void {
  mockedExistsSync.mockImplementation(
    (p: string) => typeof p === "string" && (p.endsWith("pty.node") || p.endsWith("spawn-helper")),
  );
}

describe("PtyHelperError", () => {
  it("携带可读 message、name 与 fixHint", () => {
    const err = new PtyHelperError("helper 不可执行", "chmod +x /path/helper");

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("PtyHelperError");
    expect(err.message).toBe("helper 不可执行");
    expect(err.fixHint).toBe("chmod +x /path/helper");
  });
});

describe("toUnpackedPath", () => {
  it("app.asar 改写为 app.asar.unpacked", () => {
    expect(
      toUnpackedPath("/Applications/GuaDa.app/Contents/Resources/app.asar/node_modules/node-pty"),
    ).toBe("/Applications/GuaDa.app/Contents/Resources/app.asar.unpacked/node_modules/node-pty");
  });

  it("node_modules.asar 改写为 node_modules.asar.unpacked", () => {
    expect(toUnpackedPath("/opt/app/node_modules.asar/node-pty/build/Release")).toBe(
      "/opt/app/node_modules.asar.unpacked/node-pty/build/Release",
    );
  });

  it("已是 unpacked 的路径不被二次改写（幂等）", () => {
    const already = "/opt/app/app.asar.unpacked/node_modules/node-pty";

    expect(toUnpackedPath(already)).toBe(already);
  });

  it("不含 asar 的普通路径原样返回", () => {
    const plain = "D:/proj/node_modules/node-pty/build/Release";

    expect(toUnpackedPath(plain)).toBe(plain);
  });

  it("只改写第一处 app.asar（正则无 g 标志，此为既有行为）", () => {
    // 记录行为而非背书：路径里出现两次 app.asar 时只改写第一处。
    expect(toUnpackedPath("/a/app.asar/b/app.asar/c")).toBe("/a/app.asar.unpacked/b/app.asar/c");
  });
});

describe("ensureSpawnHelperExecutable", () => {
  const realPlatform = Object.getOwnPropertyDescriptor(process, "platform");

  beforeEach(() => {
    mockedExistsSync.mockReset();
    mockedStatSync.mockReset();
    mockedChmodSync.mockReset();
  });

  afterEach(() => {
    if (realPlatform) Object.defineProperty(process, "platform", realPlatform);
  });

  it("非 darwin 平台直接返回（no-op，连文件系统都不碰）", () => {
    usePlatform("win32");

    expect(() => ensureSpawnHelperExecutable()).not.toThrow();
    expect(mockedExistsSync).not.toHaveBeenCalled();
  });

  it("linux 平台同样是 no-op", () => {
    usePlatform("linux");

    expect(() => ensureSpawnHelperExecutable()).not.toThrow();
    expect(mockedExistsSync).not.toHaveBeenCalled();
  });

  it("darwin：找不到 pty.node 时不抛错也不 chmod（不在本检查范围）", () => {
    usePlatform("darwin");
    mockedExistsSync.mockReturnValue(false);

    expect(() => loadFreshModule().ensure()).not.toThrow();
    expect(mockedChmodSync).not.toHaveBeenCalled();
  });

  it("darwin：helper 已带 x 位时只确认、不 chmod", () => {
    usePlatform("darwin");
    pretendNativeFilesExist();
    mockedStatSync.mockReturnValue({ mode: 0o755 });

    expect(() => loadFreshModule().ensure()).not.toThrow();
    expect(mockedChmodSync).not.toHaveBeenCalled();
    expect(mockedStatSync).toHaveBeenCalledTimes(1);
  });

  it("darwin：helper 缺 x 位时自动 chmod 0o755 修复", () => {
    usePlatform("darwin");
    pretendNativeFilesExist();
    mockedStatSync
      .mockReturnValueOnce({ mode: 0o644 }) // 首次检查：不可执行
      .mockReturnValue({ mode: 0o755 }); // 修复后复查：可执行

    expect(() => loadFreshModule().ensure()).not.toThrow();
    expect(mockedChmodSync).toHaveBeenCalledWith(expect.stringContaining("spawn-helper"), 0o755);
  });

  it("darwin：chmod 失败时抛 PtyHelperError 并附可操作的 fixHint", () => {
    usePlatform("darwin");
    pretendNativeFilesExist();
    mockedStatSync.mockReturnValue({ mode: 0o644 });
    mockedChmodSync.mockImplementation(() => {
      throw new Error("EPERM: operation not permitted");
    });

    let caught: any;
    const fresh = loadFreshModule();
    try {
      fresh.ensure();
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(fresh.PtyHelperError);
    expect(caught.message).toContain("spawn-helper 不可执行且无法自动修复");
    expect(caught.fixHint).toContain("rebuild:backend-native");
  });

  it("darwin：chmod 后仍不可执行 → 抛 PtyHelperError（拒绝带着坏 helper 继续）", () => {
    usePlatform("darwin");
    pretendNativeFilesExist();
    mockedStatSync.mockReturnValue({ mode: 0o644 }); // chmod 前后都不可执行
    mockedChmodSync.mockImplementation(() => undefined);

    let caught: any;
    const fresh = loadFreshModule();
    try {
      fresh.ensure();
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(fresh.PtyHelperError);
    expect(caught.message).toContain("仍不可执行");
  });
});
