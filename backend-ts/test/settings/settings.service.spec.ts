/**
 * SettingsService —— 此前零测试。
 *
 * 它的价值集中在「设置变更时的校验钩子」：模型引用必须可解析、知识库根必须合法、
 * 附件子目录必须单层。这些校验失败若漏掉，会被设置页的自动保存反复持久化，
 * 所以逐条钉住。
 *
 * 手法：用真实的 SettingsStorage + 临时 SETTINGS_DIR（仓库主流范式：真文件系统隔离），
 * 只把 ProviderFileStore 换成替身；断言落在「是否真的写盘」，而不是「有没有调用某方法」。
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { BadRequestException, Logger } from "@nestjs/common";
import { SettingsStorage } from "../../src/common/utils/settings-storage.util";
import { SettingsService } from "../../src/modules/settings/settings.service";
import {
  DEFAULT_CHAT_UPLOAD_SUBDIR,
  SG_APPEARANCE,
  SG_MODELS,
  SG_OCR,
  SG_PLUGINS,
  SG_SYSTEM,
  SK_MOD_CHAT,
  SK_SYS_CHAT_UPLOAD_SUBDIR,
  SK_SYS_KB_STORAGE_ROOT,
  SK_SYS_WORKSPACE_BASE_DIR,
} from "../../src/constants/settings.constants";

describe("SettingsService", () => {
  let tmpRoot: string;
  let settingsDir: string;
  let storage: SettingsStorage;
  let service: SettingsService;
  let knownModels: Set<string>;
  let warnSpy: jest.SpyInstance;

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "settings-service-"));
    settingsDir = path.join(tmpRoot, "settings");
    storage = new SettingsStorage({ get: (k: string) => (k === "SETTINGS_DIR" ? settingsDir : undefined) } as any);
    await storage.onModuleInit();

    knownModels = new Set(["model-a"]);
    const modelStore = {
      findModel: (id: string) => (knownModels.has(id) ? { id } : null),
    };
    service = new SettingsService(storage, modelStore as any);

    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  describe("updateGroupSettings：模型引用校验", () => {
    it("引用已知模型 → 写盘成功", async () => {
      await service.updateGroupSettings(SG_MODELS, { [SK_MOD_CHAT]: "model-a" });

      await expect(service.getSettingValue(SG_MODELS, SK_MOD_CHAT)).resolves.toBe("model-a");
    });

    it("引用不存在的模型 → 抛 BadRequestException 且不落盘", async () => {
      await expect(
        service.updateGroupSettings(SG_MODELS, { [SK_MOD_CHAT]: "ghost-model" }),
      ).rejects.toThrow(BadRequestException);

      await expect(service.getSettingValue(SG_MODELS, SK_MOD_CHAT)).resolves.toBeNull();
    });

    it("置空模型引用（清选择）→ 允许", async () => {
      await expect(service.updateGroupSettings(SG_MODELS, { [SK_MOD_CHAT]: null })).resolves.toBeUndefined();
    });

    it("非模型键（如上下文长度）不做模型解析", async () => {
      await expect(
        service.updateGroupSettings(SG_MODELS, { searchPromptContextLength: 5 }),
      ).resolves.toBeUndefined();
    });

    it("非 models 分组即使值看起来像模型 id 也不校验", async () => {
      await expect(
        service.updateGroupSettings(SG_SYSTEM, { someOtherKey: "ghost-model" }),
      ).resolves.toBeUndefined();
    });
  });

  describe("updateGroupSettings：知识库存储根校验", () => {
    const absKbRoot = () => path.join(tmpRoot, "kb-root");

    it("相对路径 → 抛错且不落盘", async () => {
      await expect(
        service.updateGroupSettings(SG_SYSTEM, { [SK_SYS_KB_STORAGE_ROOT]: "relative/kb" }),
      ).rejects.toThrow(/必须是绝对路径/);

      await expect(service.getKbStorageRoot()).resolves.toBeNull();
    });

    it("UNC 网络路径 → 抛错（SQLite WAL 在网络共享上锁不可靠）", async () => {
      await expect(
        service.updateGroupSettings(SG_SYSTEM, { [SK_SYS_KB_STORAGE_ROOT]: "\\\\server\\share" }),
      ).rejects.toThrow(/知识库存储根/);
    });

    it("绝对路径 → 落盘并可读回（首尾空白被裁掉）", async () => {
      await service.updateGroupSettings(SG_SYSTEM, { [SK_SYS_KB_STORAGE_ROOT]: `  ${absKbRoot()}  ` });

      await expect(service.getKbStorageRoot()).resolves.toBe(absKbRoot());
    });

    it("根发生变更 → 告警一次（提示重启后生效、需手动搬迁）", async () => {
      await service.updateGroupSettings(SG_SYSTEM, { [SK_SYS_KB_STORAGE_ROOT]: absKbRoot() });

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain("重启后生效");
    });

    it("根未变更（同值重复保存）→ 不刷无信息量日志", async () => {
      await service.updateGroupSettings(SG_SYSTEM, { [SK_SYS_KB_STORAGE_ROOT]: absKbRoot() });
      warnSpy.mockClear();

      await service.updateGroupSettings(SG_SYSTEM, { [SK_SYS_KB_STORAGE_ROOT]: absKbRoot() });

      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("清空根 → 写入 null 并提示回退默认位置", async () => {
      await service.updateGroupSettings(SG_SYSTEM, { [SK_SYS_KB_STORAGE_ROOT]: absKbRoot() });
      warnSpy.mockClear();

      await service.updateGroupSettings(SG_SYSTEM, { [SK_SYS_KB_STORAGE_ROOT]: "" });

      await expect(service.getKbStorageRoot()).resolves.toBeNull();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain("默认位置");
    });

    it("其它 system 键不触发知识库根校验（空值不被当作变更）", async () => {
      await service.updateGroupSettings(SG_SYSTEM, { [SK_SYS_WORKSPACE_BASE_DIR]: "/some/dir" });

      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe("updateGroupSettings：附件子目录校验", () => {
    it.each(["a/b", "..", "a\\b", "C:", "sub/dir"])("非法子目录 %s → 抛 BadRequestException", async (bad) => {
      await expect(
        service.updateGroupSettings(SG_SYSTEM, { [SK_SYS_CHAT_UPLOAD_SUBDIR]: bad }),
      ).rejects.toThrow(BadRequestException);
    });

    it("合法单层目录名 → 落盘并可读回", async () => {
      await service.updateGroupSettings(SG_SYSTEM, { [SK_SYS_CHAT_UPLOAD_SUBDIR]: "thumbs" });

      await expect(service.getChatUploadSubdir()).resolves.toBe("thumbs");
    });

    it("置空 → 读回时回退默认 uploads", async () => {
      await service.updateGroupSettings(SG_SYSTEM, { [SK_SYS_CHAT_UPLOAD_SUBDIR]: "thumbs" });

      await service.setChatUploadSubdir("");

      await expect(service.getChatUploadSubdir()).resolves.toBe(DEFAULT_CHAT_UPLOAD_SUBDIR);
    });

    it("setChatUploadSubdir 会裁剪空白", async () => {
      await service.setChatUploadSubdir("  files  ");

      await expect(service.getChatUploadSubdir()).resolves.toBe("files");
    });
  });

  describe("getSettings 分组映射", () => {
    it("plugins_config/ocr/appearance 归入独立键，system 与 models 平铺", async () => {
      await storage.updateSettings(SG_SYSTEM, { [SK_SYS_WORKSPACE_BASE_DIR]: "/ws" });
      await storage.updateSettings(SG_MODELS, { [SK_MOD_CHAT]: "model-a" });
      await storage.updateSettings(SG_PLUGINS, { plugins: ["p1"] });
      await storage.updateSettings(SG_OCR, { provider: "umi" });
      await storage.updateSettings(SG_APPEARANCE, { blurRadius: 8 });

      const all = await service.getSettings();

      expect(all.plugins).toEqual({ plugins: ["p1"] });
      expect(all.ocr).toEqual({ provider: "umi" });
      expect(all.appearance).toEqual({ blurRadius: 8 });
      expect(all[SK_SYS_WORKSPACE_BASE_DIR]).toBe("/ws");
      expect(all[SK_MOD_CHAT]).toBe("model-a");
      // 注意：ocr / appearance 的结果键与分组名恰好同名，属有意为之；
      // 只有 plugins_config 才是「分组名 ≠ 结果键」的那个，不能把分组名泄漏出去。
      expect(all).not.toHaveProperty(SG_PLUGINS);
    });
  });

  describe("工作目录基路径", () => {
    it("未设置时返回 null", async () => {
      await expect(service.getWorkspaceBaseDir()).resolves.toBeNull();
    });

    it("设置后可读回，也可置空", async () => {
      await service.setWorkspaceBaseDir("/data/ws");
      await expect(service.getWorkspaceBaseDir()).resolves.toBe("/data/ws");

      await service.setWorkspaceBaseDir(null);
      await expect(service.getWorkspaceBaseDir()).resolves.toBeNull();
    });
  });

  describe("getSettingValue 默认值", () => {
    it("键不存在时返回传入的默认值", async () => {
      await expect(service.getSettingValue(SG_SYSTEM, "nope", "fallback")).resolves.toBe("fallback");
    });

    it("键存在时返回真实值（即使是 falsy）", async () => {
      await storage.updateSettings(SG_SYSTEM, { zero: 0 });

      await expect(service.getSettingValue(SG_SYSTEM, "zero", 99)).resolves.toBe(0);
    });
  });
});
