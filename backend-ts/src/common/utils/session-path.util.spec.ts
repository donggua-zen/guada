import * as os from "os";
import * as path from "path";
import {
  resolveSessionsBasePath,
  assertValidId,
  getSessionDir,
  resolveSessionAttachmentPath,
} from "./session-path.util";

/**
 * 会话数据目录路径解析与取图路径校验。
 *
 * resolveSessionAttachmentPath 是「服务任意会话字节」的唯一入口（取图路由），
 * 穿越/越界/非法 id 必须全拒——这是安全面，宁可多拒不可漏放。
 */
describe("session-path.util", () => {
  const saved: Record<string, string | undefined> = {};

  beforeAll(() => {
    saved.SESSION_DATA_DIR = process.env.SESSION_DATA_DIR;
    saved.USERDATA_DIR = process.env.USERDATA_DIR;
    saved.UPLOAD_ROOT_DIR = process.env.UPLOAD_ROOT_DIR;
    process.env.SESSION_DATA_DIR = "/data/sess";
  });

  afterAll(() => {
    if (saved.SESSION_DATA_DIR === undefined) delete process.env.SESSION_DATA_DIR;
    else process.env.SESSION_DATA_DIR = saved.SESSION_DATA_DIR;
    if (saved.USERDATA_DIR === undefined) delete process.env.USERDATA_DIR;
    else process.env.USERDATA_DIR = saved.USERDATA_DIR;
    if (saved.UPLOAD_ROOT_DIR === undefined) delete process.env.UPLOAD_ROOT_DIR;
    else process.env.UPLOAD_ROOT_DIR = saved.UPLOAD_ROOT_DIR;
  });

  describe("resolveSessionsBasePath（优先级）", () => {
    it("SESSION_DATA_DIR 显式优先", () => {
      expect(resolveSessionsBasePath()).toBe(path.join("/data/sess", "sessions"));
    });

    it("回退链：USERDATA_DIR → dirname(UPLOAD_ROOT_DIR) → ./data", () => {
      delete process.env.SESSION_DATA_DIR;
      try {
        process.env.USERDATA_DIR = "/ud";
        expect(resolveSessionsBasePath()).toBe(path.join("/ud", "sessions"));

        delete process.env.USERDATA_DIR;
        process.env.UPLOAD_ROOT_DIR = "/root/file_stores";
        expect(resolveSessionsBasePath()).toBe(path.join("/root", "sessions"));

        delete process.env.UPLOAD_ROOT_DIR;
        expect(resolveSessionsBasePath()).toBe(path.join(process.cwd(), "data", "sessions"));
      } finally {
        process.env.SESSION_DATA_DIR = "/data/sess";
        delete process.env.USERDATA_DIR;
        delete process.env.UPLOAD_ROOT_DIR;
      }
    });
  });

  describe("assertValidId", () => {
    it("合法 id（cuid / session-<uuid> 形态）通过", () => {
      expect(() => assertValidId("session-a1b2c3")).not.toThrow();
      expect(() => assertValidId("clx1234567890abcdefghij")).not.toThrow();
    });

    it("分隔符 / 点前缀 / 历史缺陷值 / 空值 全拒", () => {
      const bad = [
        "",
        "a/b",
        "a\\b",
        "..",
        ".hidden",
        "undefined",
        "null",
        "a:b",
        'a"b',
        "a|b",
      ];
      // 失败时直接列出"被错误放行"的 id
      expect(bad.filter((id) => { try { assertValidId(id); return true } catch { return false } })).toEqual([]);
    });
  });

  describe("getSessionDir", () => {
    it("拼接 base 与 id，并做 id 校验", () => {
      expect(getSessionDir("s1")).toBe(path.join("/data/sess", "sessions", "s1"));
      expect(() => getSessionDir("../escape")).toThrow();
    });
  });

  describe("resolveSessionAttachmentPath（取图路由的安全面）", () => {
    it("正常相对路径 → 会话目录下绝对路径", () => {
      expect(resolveSessionAttachmentPath("s1", "images/20260915/a.jpg")).toBe(
        path.resolve("/data/sess", "sessions", "s1", "images/20260915/a.jpg"),
      );
    });

    it("`..` 上跳一律拒绝", () => {
      expect(resolveSessionAttachmentPath("s1", "images/../../other")).toBeNull();
      expect(resolveSessionAttachmentPath("s1", "../../etc/passwd")).toBeNull();
      expect(resolveSessionAttachmentPath("s1", "images/../..//x")).toBeNull();
    });

    it("绝对路径 / 盘符 / 空路径 拒绝", () => {
      expect(resolveSessionAttachmentPath("s1", "/etc/passwd")).toBeNull();
      expect(resolveSessionAttachmentPath("s1", "C:\\windows\\x")).toBeNull();
      expect(resolveSessionAttachmentPath("s1", "")).toBeNull();
      expect(resolveSessionAttachmentPath("s1", undefined as any)).toBeNull();
    });

    it("非法 id 拒绝（不进 path.join）", () => {
      expect(resolveSessionAttachmentPath("../evil", "images/x.jpg")).toBeNull();
      expect(resolveSessionAttachmentPath("a/b", "images/x.jpg")).toBeNull();
      expect(resolveSessionAttachmentPath("undefined", "images/x.jpg")).toBeNull();
    });

    it("解析结果恰为会话目录本身时仍返回（目录判定交给路由的 stat.isDirectory）", () => {
      // 与 workspace raw-file 同语义：函数只保证"在会话目录内"，目录/文件判定在路由
      expect(resolveSessionAttachmentPath("s1", ".")).toBe(path.resolve(getSessionDir("s1")));
    });
  });
});
