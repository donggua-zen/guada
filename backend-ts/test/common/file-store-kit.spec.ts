import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

jest.mock("fs/promises", () => {
  const actual = jest.requireActual("fs/promises");
  return {
    ...actual,
    rename: jest.fn(actual.rename),
    unlink: jest.fn(actual.unlink),
    writeFile: jest.fn(actual.writeFile),
  };
});

import * as fsp from "fs/promises";
import {
  atomicWriteFile,
  iso,
  mintId,
  removeFileWithRetry,
} from "../../src/common/persistence/file-store-kit";

const mockedRename = fsp.rename as jest.Mock;
const mockedUnlink = fsp.unlink as jest.Mock;

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "file-store-kit-"));
  mockedRename.mockImplementation((...args: any[]) => (fsp as any).__origRename(...args));
  mockedUnlink.mockImplementation((...args: any[]) => (fsp as any).__origUnlink(...args));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  jest.clearAllMocks();
});

// 保留原始实现引用，供 mock 转发
((fsp as any).__origRename ??= (jest.requireActual("fs/promises") as typeof fsp).rename);
((fsp as any).__origUnlink ??= (jest.requireActual("fs/promises") as typeof fsp).unlink);

describe("atomicWriteFile", () => {
  it("写入后目标文件内容完整且无 tmp 残留", async () => {
    const target = path.join(tmpDir, "a.json");
    await atomicWriteFile(target, '{"x":1}');
    await expect(fs.readFile(target, "utf8")).resolves.toBe('{"x":1}');
    const files = await fs.readdir(tmpDir);
    expect(files).toEqual(["a.json"]);
  });

  it("覆盖已有文件（先 unlink 再 rename 语义）", async () => {
    const target = path.join(tmpDir, "b.txt");
    await fs.writeFile(target, "old");
    await atomicWriteFile(target, "new");
    await expect(fs.readFile(target, "utf8")).resolves.toBe("new");
  });

  it("EPERM 抖动时退避重试直至成功", async () => {
    const target = path.join(tmpDir, "c.txt");
    let calls = 0;
    mockedRename.mockImplementation(async (from: string, to: string) => {
      calls += 1;
      if (calls <= 2) {
        const err: any = new Error("busy");
        err.code = "EPERM";
        throw err;
      }
      await (fsp as any).__origRename(from, to);
    });
    await atomicWriteFile(target, "ok");
    await expect(fs.readFile(target, "utf8")).resolves.toBe("ok");
    expect(calls).toBe(3);
  }, 10000);

  it("非可重试错误立即失败且清理 tmp", async () => {
    const target = path.join(tmpDir, "d", "e.txt"); // 目标目录不存在 → rename 失败（ENOENT）
    await expect(atomicWriteFile(target, "x")).rejects.toBeTruthy();
    const leftovers = await fs.readdir(tmpDir);
    expect(leftovers.filter((f) => f.includes(".tmp-"))).toEqual([]);
  });
});

describe("removeFileWithRetry", () => {
  it("ENOENT 视为成功", async () => {
    await expect(
      removeFileWithRetry(path.join(tmpDir, "nope.txt")),
    ).resolves.toBeUndefined();
  });

  it("存在的文件被删除", async () => {
    const target = path.join(tmpDir, "gone.txt");
    await fs.writeFile(target, "x");
    await removeFileWithRetry(target);
    await expect(fs.access(target)).rejects.toBeTruthy();
  });
});

describe("mintId", () => {
  it("前缀 + uuid v4 形态", () => {
    const id = mintId("bot-");
    expect(id).toMatch(/^bot-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("两次铸造互异", () => {
    expect(mintId("session-")).not.toBe(mintId("session-"));
  });
});

describe("iso", () => {
  it("接受 ISO 字符串并归一", () => {
    expect(iso("2026-09-16T00:00:00.000Z")).toBe("2026-09-16T00:00:00.000Z");
  });

  it("接受 Date 对象（js-yaml 未加引号 ISO 的产物）", () => {
    const d = new Date("2026-09-16T00:00:00.000Z");
    expect(iso(d)).toBe("2026-09-16T00:00:00.000Z");
  });

  it("接受时间戳数字", () => {
    expect(iso(0)).toBe("1970-01-01T00:00:00.000Z");
  });

  it("空值与非法输入返回 null", () => {
    expect(iso(null)).toBeNull();
    expect(iso(undefined)).toBeNull();
    expect(iso("")).toBeNull();
    expect(iso("not-a-date")).toBeNull();
    expect(iso({})).toBeNull();
  });
});
