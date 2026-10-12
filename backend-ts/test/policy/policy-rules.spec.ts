/**
 * PolicyRulesService（v3）：出厂规则 + 用户文件（只存改动）/ 迁移 / 校验 / 重置。
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as yaml from "js-yaml";
import {
  PolicyRulesService,
  isLegacySchema,
  normalizeUserFile,
  migrateLegacyToUserFile,
} from "../../src/common/services/policy-rules.service";
import { loadFactoryPolicy } from "../../src/common/services/command-policy";

function makeService(settingsDir: string): PolicyRulesService {
  const config = { get: (key: string) => (key === "SETTINGS_DIR" ? settingsDir : undefined) };
  return new PolicyRulesService(config as any);
}

describe("PolicyRulesService（v3）", () => {
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

  const globalFile = () => path.join(settingsDir, "policy.yaml");
  const writeGlobal = (text: string) => fs.writeFileSync(globalFile(), text, "utf-8");
  const readGlobal = () => yaml.load(fs.readFileSync(globalFile(), "utf-8")) as any;
  const writeProject = (text: string) => {
    fs.mkdirSync(path.join(wsDir, ".guada"), { recursive: true });
    fs.writeFileSync(path.join(wsDir, ".guada", "policy.yaml"), text, "utf-8");
  };

  it("用户文件不存在 → 用出厂规则（不写文件）", () => {
    const policy = service.getEffectivePolicySync(undefined);
    expect(fs.existsSync(globalFile())).toBe(false);
    expect(policy.userRules).toEqual([]);
    expect(policy.factoryRules.length).toBeGreaterThan(50);
    expect(policy.readOnly.factory.length).toBe(loadFactoryPolicy().readOnly.length);
  });

  it("normalizeUserFile：两种条目 + readOnlyRemove 去重", () => {
    const parsed = normalizeUserFile({
      rules: [
        { action: "allow", match: "  ffmpeg   * " },
        { action: "ask", path: " ~/.ssh/** " },
        { action: "deny", match: "" },
        { action: "nope", match: "x" },
        "garbage",
      ],
      readOnlyRemove: ["cat", " cat ", 42],
    });
    expect(parsed.rules).toEqual([
      { action: "allow", match: "ffmpeg *" },
      { action: "ask", path: "~/.ssh/**" },
    ]);
    expect(parsed.readOnlyRemove).toEqual(["cat"]);
  });

  it("isLegacySchema：v1 平铺 / v2 物化都算旧 schema，v3 不算", () => {
    expect(isLegacySchema({ allow: ["ffmpeg *"] })).toBe(true);
    expect(isLegacySchema({ readOnly: { allow: [] } })).toBe(true);
    expect(isLegacySchema({ writeAllowPaths: [] })).toBe(true);
    expect(isLegacySchema({ rules: [], readOnlyRemove: [] })).toBe(false);
    expect(isLegacySchema(null)).toBe(false);
  });

  it("迁移 v2 物化文件：删掉的必问项 → allow 覆盖；删掉的只读条目 → readOnlyRemove；writeAllowPaths → 路径规则", () => {
    const factory = loadFactoryPolicy();
    const file = migrateLegacyToUserFile({
      readOnly: { allow: factory.readOnly.filter((e) => e !== "cat"), deny: ["curl *"] },
      workspaceWrite: {
        allow: ["ffmpeg *"],
        // 物化的必问项里少了 git push（= 用户删过）
        ask: factory.ask.filter((a) => a !== "git push *"),
        deny: [],
      },
      writeAllowPaths: ["D:/AI/videos/out", factory.writeRoots[0]],
    });
    expect(file.rules).toContainEqual({ action: "allow", match: "ffmpeg *" });
    expect(file.rules).toContainEqual({ action: "allow", match: "git push *" });
    expect(file.rules).toContainEqual({ action: "deny", match: "curl *" });
    expect(file.rules).toContainEqual({ action: "allow", path: "D:/AI/videos/out" });
    // 出厂已有的可写根不重复写进用户文件
    expect(file.rules.filter((r) => "path" in r && r.path === factory.writeRoots[0])).toEqual([]);
    expect(file.readOnlyRemove).toEqual(["cat"]);
  });

  it("启动迁移：旧 schema 文件被改写为 v3 并留 .bak", () => {
    writeGlobal("allow:\n  - ffmpeg *\nask:\n  - git push *\n");
    expect(isLegacySchema(yaml.load(fs.readFileSync(globalFile(), "utf-8")))).toBe(true);
    service.onModuleInit();
    const migrated = readGlobal();
    expect(migrated.rules).toContainEqual({ action: "allow", match: "ffmpeg *" });
    expect(fs.existsSync(`${globalFile()}.bak`)).toBe(true);
    expect(isLegacySchema(migrated)).toBe(false);
  });

  it("getEffectivePolicySync：项目级规则排在用户规则前面（项目优先）", () => {
    writeGlobal("rules:\n  - { action: ask, match: 'ssh *' }\n");
    writeProject("rules:\n  - { action: allow, match: 'ssh *' }\n");
    const policy = service.getEffectivePolicySync(wsDir);
    expect(policy.userRules[0]).toEqual({ action: "allow", match: "ssh *" });
    expect(policy.userRules[1]).toEqual({ action: "ask", match: "ssh *" });
  });

  it("readOnlyRemove：两级并集", () => {
    writeGlobal("readOnlyRemove:\n  - cat\n");
    writeProject("readOnlyRemove:\n  - ls\n");
    expect(service.getEffectivePolicySync(wsDir).readOnly.removed).toEqual(["cat", "ls"]);
  });

  it("mtime 缓存：文件改写后热路径能看到新内容", () => {
    writeGlobal("rules:\n  - { action: allow, match: 'a *' }\n");
    expect(service.getEffectivePolicySync(undefined).userRules).toHaveLength(1);
    writeGlobal("rules:\n  - { action: allow, match: 'a *' }\n  - { action: deny, match: 'b *' }\n");
    expect(service.getEffectivePolicySync(undefined).userRules).toHaveLength(2);
  });

  it("validate：未知字段 / 非法 action / 元字符 / 通配一切 → errors", () => {
    const { errors } = service.validate({
      rules: [
        { action: "allow", match: "*" },
        { action: "allow", match: "rm -rf $X" },
        { action: "allow" },
        { action: "nope", match: "x" },
      ],
      unknownKey: [],
    });
    expect(errors.some((e) => e.includes("未知字段"))).toBe(true);
    expect(errors.some((e) => e.includes("通配一切"))).toBe(true);
    expect(errors.some((e) => e.includes("元字符"))).toBe(true);
    expect(errors.some((e) => e.includes("二选一"))).toBe(true);
  });

  it("validate：告警——放行命中灾难级 / 放通整个 shell；readOnlyRemove 里有不存在的条目", () => {
    const { warnings } = service.validate({
      rules: [
        { action: "allow", match: "mkfs *" },
        { action: "allow", match: "powershell *" },
      ],
      readOnlyRemove: ["cat", "not-a-command"],
    });
    expect(warnings.some((w) => w.includes("灾难级"))).toBe(true);
    expect(warnings.some((w) => w.includes("放通整个 shell"))).toBe(true);
    expect(warnings.some((w) => w.includes("不在出厂只读名单里"))).toBe(true);
  });

  it("saveUser：写入后生效且能读回；校验失败则抛错且不落盘", async () => {
    await service.saveUser("global", {
      rules: [{ action: "allow", match: "ffmpeg *" }],
      readOnlyRemove: ["cat"],
    });
    const policy = service.getEffectivePolicySync(undefined);
    expect(policy.userRules).toEqual([{ action: "allow", match: "ffmpeg *" }]);
    expect(policy.readOnly.removed).toEqual(["cat"]);

    await expect(
      service.saveUser("global", { rules: [{ action: "allow", match: "*" }] }),
    ).rejects.toThrow(/规则校验失败/);
    expect(service.getEffectivePolicySync(undefined).userRules).toEqual([
      { action: "allow", match: "ffmpeg *" },
    ]);
  });

  it("saveUser(project)：无工作区时抛错", async () => {
    await expect(
      service.saveUser("project", { rules: [] }, undefined),
    ).rejects.toThrow(/需要会话工作区/);
  });

  it("appendRule：幂等追加（审批卡「放通此类」用）", async () => {
    await service.appendRule("global", { action: "allow", match: "ssh *" }, undefined);
    await service.appendRule("global", { action: "allow", match: "ssh *" }, undefined);
    await service.appendRule("global", { action: "allow", path: "~/.ssh/**" }, undefined);
    const policy = service.getEffectivePolicySync(undefined);
    expect(policy.userRules).toEqual([
      { action: "allow", match: "ssh *" },
      { action: "allow", path: "~/.ssh/**" },
    ]);
  });

  it("resetUser：清空改动并留 .bak（出厂规则不受影响）", async () => {
    writeGlobal("rules:\n  - { action: allow, match: 'ffmpeg *' }\n");
    const view = await service.resetUser("global", undefined);
    expect(view.userRules).toEqual([]);
    expect(fs.readFileSync(`${globalFile()}.bak`, "utf-8")).toContain("ffmpeg *");
    expect(service.getEffectivePolicySync(undefined).factoryRules.length).toBeGreaterThan(50);
  });

  it("isPathAllowedSync / matchPathRuleSync：可写根与敏感路径", () => {
    const localAppData = process.env.LOCALAPPDATA || "";
    if (localAppData) {
      expect(service.isPathAllowedSync(undefined, `${localAppData}\\npm-cache\\x`)).toBe(true);
    } else {
      // 环境变量缺失时退化为"用户规则命中"
      expect(service.isPathAllowedSync(undefined, "D:/AI/out/x")).toBe(false);
    }
    const home = os.homedir();
    expect(service.matchPathRuleSync(undefined, `${home}\\.ssh\\id_rsa`)?.action).toBe("ask");
    expect(service.isPathAllowedSync(undefined, "D:/AI/elsewhere/x")).toBe(false);
  });

  it("loadEffective：出厂清单 + 用户改动 + 生效只读名单 + 告警", async () => {
    writeGlobal("rules:\n  - { action: allow, match: 'mkfs *' }\nreadOnlyRemove:\n  - cat\n");
    const view = await service.loadEffective(wsDir);
    expect(view.paths.global).toContain("policy.yaml");
    expect(view.paths.project).toContain(".guada");
    expect(view.factory.readOnly.length).toBeGreaterThan(100);
    expect(view.readOnlyRemove).toEqual(["cat"]);
    expect(view.readOnlyEffective).not.toContain("cat");
    expect(view.warnings.some((w) => w.includes("[全局]"))).toBe(true);
  });
});
