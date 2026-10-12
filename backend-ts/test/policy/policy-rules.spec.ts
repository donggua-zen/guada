/**
 * PolicyRulesService：YAML 双级规则的读写、合并、校验与缓存失效。
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PolicyRulesService, normalizePolicyFile } from "../../src/common/services/policy-rules.service";

function makeService(settingsDir: string): PolicyRulesService {
  const config = { get: (key: string) => (key === "SETTINGS_DIR" ? settingsDir : undefined) };
  return new PolicyRulesService(config as any);
}

describe("PolicyRulesService", () => {
  let tmpDir: string;
  let settingsDir: string;
  let wsDir: string;
  let service: PolicyRulesService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "policy-rules-"));
    settingsDir = path.join(tmpDir, "data");
    wsDir = path.join(tmpDir, "ws");
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.mkdirSync(wsDir, { recursive: true });
    service = makeService(settingsDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const writeGlobal = (text: string) =>
    fs.writeFileSync(path.join(settingsDir, "policy.yaml"), text, "utf-8");
  const writeProject = (text: string) => {
    fs.mkdirSync(path.join(wsDir, ".guada"), { recursive: true });
    fs.writeFileSync(path.join(wsDir, ".guada", "policy.yaml"), text, "utf-8");
  };

  it("normalizePolicyFile：去重 / trim / 丢弃非字符串", () => {
    const parsed = normalizePolicyFile({
      allow: ["  ffmpeg   * ", "ffmpeg *", 42, ""],
      deny: "not-a-list",
      writeAllowPaths: [" D:/out "],
    });
    expect(parsed.allow).toEqual(["ffmpeg *"]);
    expect(parsed.deny).toEqual([]);
    expect(parsed.writeAllowPaths).toEqual(["D:/out"]);
  });

  it("getEffectiveSync：两级并集（全局 + 项目）", () => {
    writeGlobal("allow:\n  - ffmpeg *\nask:\n  - git push *\n");
    writeProject("allow:\n  - yt-dlp *\ndeny:\n  - npm publish *\n");

    const rules = service.getEffectiveSync(wsDir);
    expect(rules.allow).toEqual(["ffmpeg *", "yt-dlp *"]);
    expect(rules.ask).toEqual(["git push *"]);
    expect(rules.deny).toEqual(["npm publish *"]);
  });

  it("getEffectiveSync：无工作区时只用全局；文件不存在视为空", () => {
    writeGlobal("allow:\n  - ffmpeg *\n");
    expect(service.getEffectiveSync(undefined).allow).toEqual(["ffmpeg *"]);
    expect(service.getEffectiveSync(undefined).deny).toEqual([]);
    service.clearCache();
    fs.rmSync(path.join(settingsDir, "policy.yaml"));
    expect(service.getEffectiveSync(undefined).allow).toEqual([]);
  });

  it("mtime/size 缓存：文件被改写后热路径能看到新规则", () => {
    writeGlobal("allow:\n  - ffmpeg *\n");
    expect(service.getEffectiveSync(undefined).allow).toEqual(["ffmpeg *"]);
    // 同进程内改写（内容长度不同 → 缓存必须失效）
    writeGlobal("allow:\n  - ffmpeg *\n  - ffprobe *\n");
    expect(service.getEffectiveSync(undefined).allow).toEqual(["ffmpeg *", "ffprobe *"]);
  });

  it("getWriteAllowPathsSync：两级合并", () => {
    writeGlobal("writeAllowPaths:\n  - D:/AI/out\n");
    writeProject("writeAllowPaths:\n  - D:/AI/out\n  - D:/AI/media\n");
    expect(service.getWriteAllowPathsSync(wsDir)).toEqual(["D:/AI/out", "D:/AI/media"]);
  });

  it("validate：非法条目与通配一切被拒", () => {
    const { errors } = service.validate({
      allow: ["*", "rm -rf $X", "a b c d e f g h i", ""],
      unknownKey: [],
    });
    expect(errors.some((e) => e.includes("通配一切"))).toBe(true);
    expect(errors.some((e) => e.includes("元字符"))).toBe(true);
    expect(errors.some((e) => e.includes("token 过多"))).toBe(true);
    expect(errors.some((e) => e.includes("为空"))).toBe(true);
    expect(errors.some((e) => e.includes("未知字段"))).toBe(true);
  });

  it("validate：告警——allow 命中灾难级名单 / 放通整个 shell", () => {
    const { warnings } = service.validate({
      allow: ["mkfs *", "powershell *"],
    });
    expect(warnings.some((w) => w.includes("灾难级"))).toBe(true);
    expect(warnings.some((w) => w.includes("放通整个 shell"))).toBe(true);
  });

  it("saveScope：写入后生效且能读回；校验失败则抛错且不落盘", async () => {
    await service.saveScope("global", { allow: ["ffmpeg *"], ask: [], deny: [], writeAllowPaths: [] });
    expect(fs.existsSync(path.join(settingsDir, "policy.yaml"))).toBe(true);
    expect(service.getEffectiveSync(undefined).allow).toEqual(["ffmpeg *"]);

    await expect(
      service.saveScope("global", { allow: ["*"], ask: [], deny: [], writeAllowPaths: [] }),
    ).rejects.toThrow(/规则校验失败/);
    // 原文件未被破坏
    expect(service.getEffectiveSync(undefined).allow).toEqual(["ffmpeg *"]);
  });

  it("saveScope(project)：无工作区时抛错", async () => {
    await expect(
      service.saveScope("project", { allow: [], ask: [], deny: [], writeAllowPaths: [] }, undefined),
    ).rejects.toThrow(/需要会话工作区/);
  });

  it("appendAllowRule：幂等追加（审批卡「放通此类」用）", async () => {
    await service.appendAllowRule("project", "ffmpeg *", wsDir);
    await service.appendAllowRule("project", "ffmpeg   *", wsDir);
    expect(service.getEffectiveSync(wsDir).allow).toEqual(["ffmpeg *"]);

    await service.appendAllowRule("global", "yt-dlp *", wsDir);
    expect([...service.getEffectiveSync(wsDir).allow].sort()).toEqual(["ffmpeg *", "yt-dlp *"]);
  });

  it("loadEffective：返回两级原文、文件路径与告警", async () => {
    writeGlobal("allow:\n  - mkfs *\n");
    const effective = await service.loadEffective(wsDir);
    expect(effective.paths.global).toContain("policy.yaml");
    expect(effective.paths.project).toContain(".guada");
    expect(effective.sources.global.allow).toEqual(["mkfs *"]);
    expect(effective.warnings.some((w) => w.includes("[全局]"))).toBe(true);
  });
});
