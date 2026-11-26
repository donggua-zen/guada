import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import * as yaml from "js-yaml";
import { SkillToggleConfigService } from "../../src/modules/skills/core/skill-toggle-config.service";

/**
 * 技能开关的统一持久化层（覆盖表格式）
 *
 * 全局与项目用同一套 YAML，只有作用域不同：
 * ```yaml
 * skills:
 *   some-skill: false   # 关掉
 *   other-skill: true   # 显式启用（可覆盖上层）
 * ```
 * 键不存在 = 继承上层；全局是顶层，继承落空时默认启用。
 */
describe("SkillToggleConfigService", () => {
  let tmpDir: string;
  let settingsDir: string;
  let service: SkillToggleConfigService;
  let settingsStore: {
    getSettings: jest.Mock;
    updateSettings: jest.Mock;
    deleteSettingValue: jest.Mock;
    _data: Record<string, any>;
  };

  const makeSettingsStub = (initial: Record<string, any> = {}) => {
    const data = { ...initial };
    return {
      getSettings: jest.fn(async () => ({ ...data })),
      updateSettings: jest.fn(async (_group: string, patch: Record<string, any>) => {
        Object.assign(data, patch);
      }),
      deleteSettingValue: jest.fn(async (_group: string, key: string) => {
        delete data[key];
      }),
      _data: data,
    };
  };

  const makeConfigService = () =>
    ({ get: jest.fn((key: string) => (key === "SETTINGS_DIR" ? settingsDir : undefined)) }) as any;

  const globalFile = () => path.join(settingsDir, "skills.yaml");
  const projectFile = (p: string) => path.join(p, ".guada", "skills.yaml");

  const readYaml = async (file: string) =>
    yaml.load(await fs.readFile(file, "utf-8")) as {
      skills?: Record<string, boolean>;
      disabled?: string[];
    };

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "skill-toggle-"));
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  beforeEach(async () => {
    settingsDir = await fs.mkdtemp(path.join(tmpDir, "settings-"));
    settingsStore = makeSettingsStub();
    service = new SkillToggleConfigService(makeConfigService(), settingsStore as any);
  });

  describe("路径", () => {
    it("全局文件在 SETTINGS_DIR 下，项目在 .guada 下", () => {
      expect(service.globalFilePath()).toBe(path.join(settingsDir, "skills.yaml"));
      expect(service.projectFilePath("/work/proj")).toBe(
        path.join("/work/proj", ".guada", "skills.yaml"),
      );
      expect(service.projectFilePath(null)).toBeNull();
      expect(service.projectFilePath("")).toBeNull();
    });
  });

  describe("读取", () => {
    it("文件不存在 → 空覆盖表，且不创建目录", async () => {
      expect(service.getGlobalOverrides().size).toBe(0);
      const project = path.join(tmpDir, "no-config-proj");
      expect(service.getProjectOverrides(project).size).toBe(0);
      await expect(fs.access(path.join(project, ".guada"))).rejects.toThrow();
    });

    it("解析 skills 覆盖表（true 与 false 并存）", async () => {
      await fs.writeFile(
        globalFile(),
        "skills:\n  off-skill: false\n  on-skill: true\n",
        "utf-8",
      );

      expect(service.getGlobalOverride("off-skill")).toBe(false);
      expect(service.getGlobalOverride("on-skill")).toBe(true);
      expect(service.getGlobalOverride("missing")).toBeUndefined();
      expect(service.readGlobal().overrides).toEqual({
        "off-skill": false,
        "on-skill": true,
      });
    });

    it("旧格式 disabled 列表 兼容：等价于 skills: {id: false}", async () => {
      await fs.writeFile(globalFile(), "disabled:\n  - old-a\n  - old-b\n", "utf-8");

      expect(service.getGlobalOverride("old-a")).toBe(false);
      expect(service.getGlobalOverride("old-b")).toBe(false);
      expect(service.readGlobal().overrides).toEqual({ "old-a": false, "old-b": false });
    });

    it("YAML 损坏 → 空覆盖表（退回默认启用）", async () => {
      await fs.writeFile(globalFile(), "skills: [broken\n\t::", "utf-8");
      expect(service.getGlobalOverrides().size).toBe(0);
    });

    it("结构不合法 → 空表", async () => {
      await fs.writeFile(globalFile(), "- just\n- a\n- list\n", "utf-8");
      expect(service.getGlobalOverrides().size).toBe(0);

      await fs.writeFile(globalFile(), "skills: not-a-map\n", "utf-8");
      expect(service.getGlobalOverrides().size).toBe(0);

      await fs.writeFile(globalFile(), "disabled: not-an-array\n", "utf-8");
      expect(service.getGlobalOverrides().size).toBe(0);
    });

    it("逐项过滤脏数据：非法 id 与非布尔值丢弃，合法项保留", async () => {
      await fs.writeFile(
        globalFile(),
        [
          "skills:",
          "  good-skill: false",
          "  OK-UPPER: true",
          "  bad-value: 'yes'",
          "  ../escape: false",
          "",
        ].join("\n"),
        "utf-8",
      );

      expect(service.readGlobal().overrides).toEqual({
        "good-skill": false,
        "ok-upper": true,
      });
    });

    it("mtime/size 变化后热路径立即看到新值", async () => {
      await fs.writeFile(globalFile(), "skills:\n  first: false\n", "utf-8");
      expect(service.getGlobalOverride("first")).toBe(false);

      await fs.writeFile(
        globalFile(),
        "skills:\n  first: false\n  second: true\n",
        "utf-8",
      );
      expect(service.getGlobalOverride("second")).toBe(true);
    });

    it("全局与项目互不影响", async () => {
      const projectA = path.join(tmpDir, "proj-a");
      const projectB = path.join(tmpDir, "proj-b");
      await fs.mkdir(path.join(projectA, ".guada"), { recursive: true });
      await fs.writeFile(projectFile(projectA), "skills:\n  only-a: false\n", "utf-8");

      expect(service.getProjectOverride(projectA, "only-a")).toBe(false);
      expect(service.getProjectOverride(projectB, "only-a")).toBeUndefined();
      expect(service.getGlobalOverride("only-a")).toBeUndefined();
    });
  });

  describe("写入", () => {
    it("全局：关闭写 false，重新启用则删键（不留 id: true 噪音）", async () => {
      await service.setGlobalEnabled("my-skill", false);
      expect(service.getGlobalOverride("my-skill")).toBe(false);
      expect((await readYaml(globalFile())).skills).toEqual({ "my-skill": false });

      await service.setGlobalEnabled("my-skill", true);
      expect(service.getGlobalOverride("my-skill")).toBeUndefined();
      await expect(fs.access(globalFile())).rejects.toThrow();
    });

    it("项目：可写 true（启用）与 false（关闭）", async () => {
      const project = path.join(tmpDir, "proj-write");
      await fs.mkdir(project, { recursive: true });

      await service.setProjectOverride(project, "enable-me", true);
      await service.setProjectOverride(project, "disable-me", false);

      expect(service.getProjectOverride(project, "enable-me")).toBe(true);
      expect(service.getProjectOverride(project, "disable-me")).toBe(false);
      // 全局始终未被写入
      await expect(fs.access(globalFile())).rejects.toThrow();
    });

    it("项目：传 undefined 删除覆盖（回到继承）", async () => {
      const project = path.join(tmpDir, "proj-clear");
      await fs.mkdir(project, { recursive: true });
      await service.setProjectOverride(project, "temp", true);

      await service.setProjectOverride(project, "temp", undefined);

      expect(service.getProjectOverride(project, "temp")).toBeUndefined();
      await expect(fs.access(projectFile(project))).rejects.toThrow();
    });

    it("写入带说明头，且人工追加一项后仍能解析", async () => {
      await service.setGlobalEnabled("header-skill", false);
      const raw = await fs.readFile(globalFile(), "utf-8");
      expect(raw).toContain("# 技能开关");

      await fs.writeFile(globalFile(), raw + "  manual-skill: true\n", "utf-8");
      expect(service.getGlobalOverride("manual-skill")).toBe(true);
    });

    it("幂等：重复写同一值不产生重复项", async () => {
      await service.setGlobalEnabled("dup", false);
      await service.setGlobalEnabled("dup", false);
      expect((await readYaml(globalFile())).skills).toEqual({ dup: false });
    });

    it("skillId 大小写归一", async () => {
      await service.setGlobalEnabled("Mixed-Case", false);
      expect(service.getGlobalOverride("mixed-case")).toBe(false);
      expect(service.getGlobalOverride("MIXED-CASE")).toBe(false);
    });

    it("非法 skillId / 无项目路径 → 抛错", async () => {
      await expect(service.setGlobalEnabled("", false)).rejects.toThrow();
      await expect(service.setGlobalEnabled("../escape", false)).rejects.toThrow();
      await expect(service.setGlobalEnabled("a b", false)).rejects.toThrow();
      await expect(service.setProjectOverride("", "x", true)).rejects.toThrow();
    });

    it("首次写入旧格式文件会被转成新格式", async () => {
      await fs.writeFile(globalFile(), "disabled:\n  - legacy\n", "utf-8");
      expect(service.getGlobalOverride("legacy")).toBe(false);

      await service.setGlobalEnabled("new-one", false);

      const parsed = await readYaml(globalFile());
      expect(parsed.skills).toEqual({ legacy: false, "new-one": false });
      expect(parsed.disabled).toBeUndefined();
    });
  });

  describe("旧版 plugins.json 迁移", () => {
    it("skills.<id>=false 搬到 skills.yaml 覆盖表，并从 plugins.json 删除", async () => {
      settingsStore = makeSettingsStub({
        "skills.old-disabled": false,
        "skills.old-enabled": true,
        todo: { text: "keep me" },
        mcp: { keep: true },
      });
      service = new SkillToggleConfigService(makeConfigService(), settingsStore as any);

      await service.onModuleInit();

      // 只搬 false；true 是默认态不该落盘
      expect((await readYaml(globalFile())).skills).toEqual({ "old-disabled": false });
      expect(settingsStore.deleteSettingValue).toHaveBeenCalledTimes(2);
      expect(settingsStore._data["skills.old-disabled"]).toBeUndefined();
      expect(settingsStore._data["skills.old-enabled"]).toBeUndefined();
      expect(settingsStore._data.todo).toEqual({ text: "keep me" });
      expect(settingsStore._data.mcp).toEqual({ keep: true });
      expect(service.getGlobalOverride("old-disabled")).toBe(false);
    });

    it("skills.yaml 已存在时不再迁移（尊重用户手工编辑）", async () => {
      await fs.writeFile(globalFile(), "skills:\n  existing: false\n", "utf-8");
      settingsStore = makeSettingsStub({ "skills.old-disabled": false });
      service = new SkillToggleConfigService(makeConfigService(), settingsStore as any);

      await service.onModuleInit();

      expect((await readYaml(globalFile())).skills).toEqual({ existing: false });
      expect(settingsStore.deleteSettingValue).not.toHaveBeenCalled();
    });

    it("没有旧键时是 no-op", async () => {
      settingsStore = makeSettingsStub({ todo: {} });
      service = new SkillToggleConfigService(makeConfigService(), settingsStore as any);

      await service.onModuleInit();

      expect(settingsStore.deleteSettingValue).not.toHaveBeenCalled();
      await expect(fs.access(globalFile())).rejects.toThrow();
    });

    it("全部是启用状态时不创建文件（无需迁移任何禁用项）", async () => {
      settingsStore = makeSettingsStub({ "skills.a": true, "skills.b": true });
      service = new SkillToggleConfigService(makeConfigService(), settingsStore as any);

      await service.onModuleInit();

      await expect(fs.access(globalFile())).rejects.toThrow();
      expect(settingsStore.deleteSettingValue).toHaveBeenCalledTimes(2);
    });
  });
});
