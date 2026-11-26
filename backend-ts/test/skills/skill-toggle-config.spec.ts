import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import * as yaml from "js-yaml";
import { SkillToggleConfigService } from "../../src/modules/skills/core/skill-toggle-config.service";

/**
 * 技能开关的统一持久化层
 *
 * 全局与项目用同一套 YAML（只有 `disabled` 列表），
 * 这样「项目只能收紧不能放宽」是**结构上的保证**，而不是靠代码约定。
 */
describe("SkillToggleConfigService", () => {
  let tmpDir: string;
  let settingsDir: string;
  let service: SkillToggleConfigService;
  /** SettingsStorage 替身：内存 map + 记录 delete 调用 */
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
    yaml.load(await fs.readFile(file, "utf-8")) as { disabled?: string[] };

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "skill-toggle-"));
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  beforeEach(async () => {
    // 每个用例独立设置目录，避免互相污染
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
    it("文件不存在 → 空集合，且不创建目录", async () => {
      expect(Array.from(service.getGlobalDisabledIds())).toEqual([]);
      const project = path.join(tmpDir, "no-config-proj");
      expect(Array.from(service.getProjectDisabledIds(project))).toEqual([]);
      await expect(fs.access(path.join(project, ".guada"))).rejects.toThrow();
    });

    it("正常解析 disabled 列表", async () => {
      await fs.writeFile(globalFile(), "disabled:\n  - skill-b\n  - skill-a\n", "utf-8");

      expect(service.isGlobalDisabled("skill-a")).toBe(true);
      expect(service.isGlobalDisabled("missing")).toBe(false);
      expect(service.readGlobal().disabled).toEqual(["skill-a", "skill-b"]);
    });

    it("YAML 损坏 → 空集合（退回默认启用）", async () => {
      await fs.writeFile(globalFile(), "disabled: [broken\n\t::", "utf-8");

      expect(Array.from(service.getGlobalDisabledIds())).toEqual([]);
    });

    it("结构不合法 → 空集合", async () => {
      await fs.writeFile(globalFile(), "- just\n- a\n- list\n", "utf-8");
      expect(Array.from(service.getGlobalDisabledIds())).toEqual([]);

      await fs.writeFile(globalFile(), "disabled: not-an-array\n", "utf-8");
      expect(Array.from(service.getGlobalDisabledIds())).toEqual([]);
    });

    it("逐项过滤脏数据，合法项保留", async () => {
      await fs.writeFile(
        globalFile(),
        ["disabled:", "  - good-skill", "  - 42", "  - '../escape'", "  - OK-UPPER"].join("\n"),
        "utf-8",
      );

      expect(Array.from(service.getGlobalDisabledIds()).sort()).toEqual([
        "good-skill",
        "ok-upper",
      ]);
    });

    it("mtime/size 变化后热路径立即看到新值", async () => {
      await fs.writeFile(globalFile(), "disabled:\n  - first\n", "utf-8");
      expect(service.isGlobalDisabled("first")).toBe(true);

      await fs.writeFile(globalFile(), "disabled:\n  - first\n  - second\n", "utf-8");
      expect(service.isGlobalDisabled("second")).toBe(true);
    });

    it("全局与项目互不影响", async () => {
      const projectA = path.join(tmpDir, "proj-a");
      const projectB = path.join(tmpDir, "proj-b");
      await fs.mkdir(path.join(projectA, ".guada"), { recursive: true });
      await fs.writeFile(projectFile(projectA), "disabled:\n  - only-a\n", "utf-8");

      expect(service.isProjectDisabled(projectA, "only-a")).toBe(true);
      expect(service.isProjectDisabled(projectB, "only-a")).toBe(false);
      expect(service.isGlobalDisabled("only-a")).toBe(false);
    });
  });

  describe("写入", () => {
    it("全局：禁用后写入，启用后移除", async () => {
      await service.setGlobalEnabled("my-skill", false);
      expect(service.isGlobalDisabled("my-skill")).toBe(true);
      expect((await readYaml(globalFile())).disabled).toEqual(["my-skill"]);

      await service.setGlobalEnabled("my-skill", true);
      expect(service.isGlobalDisabled("my-skill")).toBe(false);
      await expect(fs.access(globalFile())).rejects.toThrow();
    });

    it("项目：禁用只写项目文件，不影响全局", async () => {
      const project = path.join(tmpDir, "proj-write");
      await fs.mkdir(project, { recursive: true });

      await service.setProjectEnabled(project, "proj-skill", false);

      expect(service.isProjectDisabled(project, "proj-skill")).toBe(true);
      expect(service.isGlobalDisabled("proj-skill")).toBe(false);
      await expect(fs.access(globalFile())).rejects.toThrow();
    });

    it("写入带说明头，且人工追加一项后仍能解析", async () => {
      await service.setGlobalEnabled("header-skill", false);
      const raw = await fs.readFile(globalFile(), "utf-8");
      expect(raw).toContain("# 技能开关");

      await fs.writeFile(globalFile(), raw + "  - manual-skill\n", "utf-8");
      expect(service.isGlobalDisabled("manual-skill")).toBe(true);
    });

    it("幂等：重复禁用不产生重复项", async () => {
      await service.setGlobalEnabled("dup", false);
      await service.setGlobalEnabled("dup", false);
      expect((await readYaml(globalFile())).disabled).toEqual(["dup"]);
    });

    it("skillId 大小写归一", async () => {
      await service.setGlobalEnabled("Mixed-Case", false);
      expect(service.isGlobalDisabled("mixed-case")).toBe(true);
      expect(service.isGlobalDisabled("MIXED-CASE")).toBe(true);
    });

    it("非法 skillId / 无项目路径 → 抛错", async () => {
      await expect(service.setGlobalEnabled("", false)).rejects.toThrow();
      await expect(service.setGlobalEnabled("../escape", false)).rejects.toThrow();
      await expect(service.setGlobalEnabled("a b", false)).rejects.toThrow();
      await expect(service.setProjectEnabled("", "x", false)).rejects.toThrow();
    });
  });

  describe("旧版 plugins.json 迁移", () => {
    it("skills.<id>=false 搬到 skills.yaml，并从 plugins.json 删除", async () => {
      settingsStore = makeSettingsStub({
        "skills.old-disabled": false,
        "skills.old-enabled": true,
        todo: { text: "keep me" },
        mcp: { keep: true },
      });
      service = new SkillToggleConfigService(makeConfigService(), settingsStore as any);

      await service.onModuleInit();

      // 只搬 false；true 是默认态不该落盘
      expect((await readYaml(globalFile())).disabled).toEqual(["old-disabled"]);
      // 旧键必须真的被删掉，否则下次启动会看到两份真相
      expect(settingsStore.deleteSettingValue).toHaveBeenCalledTimes(2);
      expect(settingsStore._data["skills.old-disabled"]).toBeUndefined();
      expect(settingsStore._data["skills.old-enabled"]).toBeUndefined();
      // 非 skills 键原样保留
      expect(settingsStore._data.todo).toEqual({ text: "keep me" });
      expect(settingsStore._data.mcp).toEqual({ keep: true });
      // 迁移后可立即读到
      expect(service.isGlobalDisabled("old-disabled")).toBe(true);
    });

    it("skills.yaml 已存在时不再迁移（尊重用户手工编辑）", async () => {
      await fs.writeFile(globalFile(), "disabled:\n  - existing\n", "utf-8");
      settingsStore = makeSettingsStub({
        "skills.old-disabled": false,
      });
      service = new SkillToggleConfigService(makeConfigService(), settingsStore as any);

      await service.onModuleInit();

      expect((await readYaml(globalFile())).disabled).toEqual(["existing"]);
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
      settingsStore = makeSettingsStub({
        "skills.a": true,
        "skills.b": true,
      });
      service = new SkillToggleConfigService(makeConfigService(), settingsStore as any);

      await service.onModuleInit();

      await expect(fs.access(globalFile())).rejects.toThrow();
      // 但旧键仍应清理（避免两份真相）
      expect(settingsStore.deleteSettingValue).toHaveBeenCalledTimes(2);
    });
  });
});
