import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { normalizePluginSource, parsePluginSource } from "./plugin-source";

describe("normalizePluginSource（安装源自动识别）", () => {
  // ── 规范前缀：原样透传（市场收录的 install 串不受影响） ──
  it.each([
    "github:owner/repo",
    "github:owner/repo#v1.2.0",
    "gitee:owner/repo#main",
    "git:https://gitcode.com/owner/repo.git#main",
    "local:/abs/path",
  ])("透传规范源 %s", (source) => {
    expect(normalizePluginSource(source)).toBe(source);
  });

  // ── 双斜杠笔误 ──
  it.each([
    ["github://owner/repo", "github:owner/repo"],
    ["gitee://owner/repo#main", "gitee:owner/repo#main"],
    ["LOCAL://D:/plugins/demo", "local:D:/plugins/demo"],
  ])("归一双斜杠笔误 %s -> %s", (input, expected) => {
    expect(normalizePluginSource(input)).toBe(expected);
  });

  // ── GitHub/Gitee 网页与 clone 地址 ──
  it.each([
    ["https://github.com/owner/repo", "github:owner/repo"],
    ["https://github.com/owner/repo.git", "github:owner/repo"],
    ["https://github.com/owner/repo/tree/main", "github:owner/repo#main"],
    ["https://github.com/owner/repo/tree/v1.2.0", "github:owner/repo#v1.2.0"],
    ["https://gitee.com/owner/repo", "gitee:owner/repo"],
    ["https://gitee.com/owner/repo.git", "gitee:owner/repo"],
    ["https://gitee.com/owner/repo/tree/dev", "gitee:owner/repo#dev"],
  ])("归一仓库 URL %s -> %s", (input, expected) => {
    expect(normalizePluginSource(input)).toBe(expected);
  });

  // ── 其他 https git 仓库（GitCode、自建 GitLab） ──
  it.each([
    ["https://gitcode.com/owner/repo.git", "git:https://gitcode.com/owner/repo"],
    ["https://git.example.com/group/sub/repo", "git:https://git.example.com/group/sub/repo"],
    ["https://gitcode.com/owner/repo/tree/main", "git:https://gitcode.com/owner/repo#main"],
  ])("归一任意 https git URL %s -> %s", (input, expected) => {
    expect(normalizePluginSource(input)).toBe(expected);
  });

  // ── owner/repo 短写法 ──
  it.each([
    ["owner/repo", "github:owner/repo"],
    ["owner/repo#v1.2", "github:owner/repo#v1.2"],
    ["donggua-zen/guada-plugin-qi-dusk-skin", "github:donggua-zen/guada-plugin-qi-dusk-skin"],
  ])("归一短写法 %s -> %s", (input, expected) => {
    expect(normalizePluginSource(input)).toBe(expected);
  });

  // ── 本地路径（目录必须真实存在） ──
  describe("本地路径", () => {
    let dir: string;
    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "guada-src-norm-"));
    });
    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it("file:// scheme 归一为 local:", () => {
      expect(normalizePluginSource(`file:///${dir.replace(/\\/g, "/")}`)).toBe(
        `local:${dir.replace(/\\/g, "/")}`,
      );
    });

    it("Windows 盘符绝对路径归一为 local:（正斜杠）", () => {
      expect(normalizePluginSource("D:\\AI\\guada_plugins\\demo")).toBe("local:D:/AI/guada_plugins/demo");
    });

    it("POSIX 绝对路径归一为 local:", () => {
      const posix = dir.replace(/\\/g, "/");
      expect(normalizePluginSource(posix)).toBe(`local:${posix}`);
    });

    it("带规范 local: 前缀的反斜杠路径统一为正斜杠", () => {
      expect(normalizePluginSource("local:D:\\a\\b")).toBe("local:D:/a/b");
    });
  });

  // ── 不识别的输入：原样返回（既有解析负责报错） ──
  it.each([
    "https://github.com/owner/repo/blob/main/index.js", // 单文件页面
    "https://github.com/owner/repo/issues/12", // 网页路径三段以上
    "https://github.com/owner/repo?tab=readme", // 带 query
    "https://user:pass@github.com/owner/repo", // 带凭据
    "owner/repo/extra", // 三段裸路径
    "not a source",
    "",
  ])("不识别 %j（原样透传给既有解析报错）", (input) => {
    expect(normalizePluginSource(input)).toBe(input);
  });
});

describe("parsePluginSource（归一层接入后的端到端解析）", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "guada-src-parse-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("网页地址 → github 协议 + ref", () => {
    const parsed = parsePluginSource("https://github.com/owner/repo/tree/main");
    expect(parsed.protocol).toBe("github");
    expect(parsed.cloneUrl).toBe("https://github.com/owner/repo.git");
    expect(parsed.ref).toBe("main");
    expect(parsed.dirName).toBe("repo");
  });

  it("owner/repo 短写法 → github 协议", () => {
    const parsed = parsePluginSource("owner/repo");
    expect(parsed.protocol).toBe("github");
    expect(parsed.cloneUrl).toBe("https://github.com/owner/repo.git");
  });

  it("GitCode clone 地址 → git 协议", () => {
    const parsed = parsePluginSource("https://gitcode.com/owner/repo.git");
    expect(parsed.protocol).toBe("git");
    expect(parsed.cloneUrl).toBe("https://gitcode.com/owner/repo");
    expect(parsed.dirName).toBe("repo");
  });

  it("真实本地目录 → local 协议", () => {
    const parsed = parsePluginSource(dir.replace(/\\/g, "/"));
    expect(parsed.protocol).toBe("local");
    expect(parsed.localPath).toBe(dir.replace(/\\/g, "/"));
    expect(parsed.dirName).toBe(path.basename(dir).toLowerCase());
  });

  it("ref 注入仍被 SAFE_REF 拒绝（回归）", () => {
    expect(() => parsePluginSource("owner/repo#--upload-pack=evil")).toThrow(/Invalid ref/);
    expect(() => parsePluginSource("github:owner/repo#..\\..\\evil")).toThrow(/Invalid ref/);
  });

  it("非法仓库段（带空格）走既有 Unsupported 报错（既有正则不匹配含空格输入）", () => {
    expect(() => parsePluginSource("github:bad/repo name")).toThrow(/Unsupported source/);
  });

  it("无法识别的输入保持原报错（回归）", () => {
    expect(() => parsePluginSource("abc")).toThrow(/Unsupported source/);
    expect(() => parsePluginSource("https://github.com/owner/repo/blob/main/index.js")).toThrow(
      /Unsupported source/,
    );
  });

  it("不存在的本地路径报路径不存在（而非 Unsupported）", () => {
    // dir 本身存在，其下不存在的子路径 → doInstall 阶段才检查；
    // 解析层 local: 协议本身允许任何路径，存在性由安装流程校验
    const missing = path.join(dir, "not-exist").replace(/\\/g, "/");
    const parsed = parsePluginSource(missing);
    expect(parsed.protocol).toBe("local");
    expect(parsed.localPath).toBe(missing);
  });
});
