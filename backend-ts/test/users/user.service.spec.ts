/**
 * UserService —— 此前零测试。
 *
 * 账户权威来源是 account.json（AccountFileStore），这里用替身聚焦 UserService 自身的契约：
 * 密码规则、返回体脱敏（绝不下发 passwordHash）、头像 MIME 白名单与失败清理。
 *
 * sharp 是原生依赖，直接 mock 掉（只关心是否被调用与参数，不关心真实图像处理）。
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { UserService } from "../../src/modules/users/user.service";

jest.mock("sharp", () => {
  const toFile = jest.fn(async () => undefined);
  const jpeg = jest.fn(() => ({ toFile }));
  const resize = jest.fn(() => ({ jpeg }));
  const sharpFn: any = jest.fn(() => ({ resize }));
  sharpFn.__chain = { resize, jpeg, toFile };
  return sharpFn;
});

const sharpMock = require("sharp");

interface FakeAccount {
  username?: string;
  nickname?: string;
  avatarUrl?: string | null;
  wallpaperUrl?: string | null;
  passwordHash?: string | null;
}

class FakeAccountStore {
  account: FakeAccount = {};
  readonly updateProfileCalls: any[] = [];
  readonly setPasswordCalls: string[] = [];
  clearPasswordCalls = 0;
  verifyPasswordImpl = async () => true;

  get(): FakeAccount {
    return this.account;
  }
  getView(): FakeAccount {
    const { passwordHash, ...safe } = this.account;
    return { ...safe, passwordSet: !!passwordHash } as any;
  }
  isPasswordSet(): boolean {
    return !!this.account.passwordHash;
  }
  async verifyPassword(pw: string): Promise<boolean> {
    return this.verifyPasswordImpl();
  }
  async setPassword(pw: string): Promise<void> {
    this.setPasswordCalls.push(pw);
    this.account.passwordHash = `hash(${pw})`;
  }
  async clearPassword(): Promise<void> {
    this.clearPasswordCalls++;
    this.account.passwordHash = null;
  }
  async updateProfile(patch: any): Promise<FakeAccount> {
    this.updateProfileCalls.push(patch);
    Object.assign(this.account, patch);
    return { ...this.account, passwordHash: this.account.passwordHash ?? undefined };
  }
}

describe("UserService", () => {
  let tmpRoot: string;
  let accountStore: FakeAccountStore;
  let urlService: any;
  let uploadPathService: any;
  let service: UserService;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "user-service-"));
    accountStore = new FakeAccountStore();
    urlService = { toResourceAbsoluteUrl: (p: string) => `http://localhost:3000${p}` };
    uploadPathService = {
      getPhysicalPath: (sub: string) => {
        const dir = path.join(tmpRoot, sub);
        fs.mkdirSync(dir, { recursive: true });
        return dir;
      },
      getStoragePath: (sub: string, name: string) => `/uploads/${sub}/${name}`,
      toPhysicalPath: (stored: string) => path.join(tmpRoot, stored.replace("/uploads/", "")),
    };
    service = new UserService(uploadPathService, accountStore as any, urlService, {
      // 密码门禁/强度要求：测试环境默认无外部入口开启（基础强度策略仍生效）
      isAnyAccessEnabled: async () => false,
      isPublicAccessEnabled: async () => false,
    } as any);
    sharpMock.mockClear();
    sharpMock.__chain.resize.mockClear();
    sharpMock.__chain.jpeg.mockClear();
    sharpMock.__chain.toFile.mockClear();
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  describe("getProfile", () => {
    it("无头像/壁纸时对应字段为 null", () => {
      accountStore.account = { username: "u" };

      expect(service.getProfile()).toMatchObject({ username: "u", avatarUrl: null, wallpaperUrl: null });
    });

    it("有头像/壁纸时转换为绝对 URL", () => {
      accountStore.account = { username: "u", avatarUrl: "/uploads/avatars/a.jpg", wallpaperUrl: "/uploads/w/b.jpg" };

      const profile = service.getProfile();

      expect(profile.avatarUrl).toBe("http://localhost:3000/uploads/avatars/a.jpg");
      expect(profile.wallpaperUrl).toBe("http://localhost:3000/uploads/w/b.jpg");
    });
  });

  describe("updateProfile", () => {
    it("用户名前后空白被 trim", async () => {
      await service.updateProfile({ username: "  冬瓜  " });

      expect(accountStore.updateProfileCalls[0]).toMatchObject({ username: "冬瓜" });
    });

    it("用户名全为空白 → 抛错且不写入", async () => {
      await expect(service.updateProfile({ username: "   " })).rejects.toThrow(/用户名不能为空/);
      expect(accountStore.updateProfileCalls).toHaveLength(0);
    });

    it("只更新传入的字段（未传的不进 patch）", async () => {
      await service.updateProfile({ nickname: "n" });

      expect(accountStore.updateProfileCalls[0]).toEqual({ nickname: "n" });
    });

    it("返回体剔除 passwordHash，并附 passwordSet 标记", async () => {
      accountStore.account = { username: "u", passwordHash: "hash" };

      const result = await service.updateProfile({ nickname: "n" });

      expect(result).not.toHaveProperty("passwordHash");
      expect(result.passwordSet).toBe(true);
    });

    it("支持置空壁纸（wallpaperUrl: null）", async () => {
      await service.updateProfile({ wallpaperUrl: null });

      expect(accountStore.updateProfileCalls[0]).toEqual({ wallpaperUrl: null });
    });
  });

  describe("setPassword", () => {
    it("新密码短于 8 位 → 抛错", async () => {
      await expect(service.setPassword(undefined, "12345")).rejects.toThrow(/至少 8 位/);
      expect(accountStore.setPasswordCalls).toHaveLength(0);
    });

    it("新密码为空 → 抛错", async () => {
      await expect(service.setPassword(undefined, "")).rejects.toThrow(/至少 8 位/);
    });

    it("只有单一字符类别 → 抛错（基础强度策略）", async () => {
      await expect(service.setPassword(undefined, "abcdefgh")).rejects.toThrow(/至少 2 类/);
    });

    it("未设密码时（免登录模式）可直接设置", async () => {
      accountStore.account = {};

      await expect(service.setPassword(undefined, "newpass123")).resolves.toEqual({
        success: true,
        passwordSet: true,
      });
      expect(accountStore.setPasswordCalls).toEqual(["newpass123"]);
    });

    it("已设密码但未提供旧密码 → 抛错", async () => {
      accountStore.account = { passwordHash: "h" };

      await expect(service.setPassword(undefined, "newpass123")).rejects.toThrow(/请输入当前密码/);
      expect(accountStore.setPasswordCalls).toHaveLength(0);
    });

    it("旧密码不正确 → 抛错且不改密码", async () => {
      accountStore.account = { passwordHash: "h" };
      accountStore.verifyPasswordImpl = async () => false;

      await expect(service.setPassword("wrong", "newpass123")).rejects.toThrow(/当前密码不正确/);
      expect(accountStore.setPasswordCalls).toHaveLength(0);
    });

    it("旧密码正确 → 更新密码", async () => {
      accountStore.account = { passwordHash: "h" };
      accountStore.verifyPasswordImpl = async () => true;

      await expect(service.setPassword("old", "newpass123")).resolves.toEqual({
        success: true,
        passwordSet: true,
      });
      expect(accountStore.setPasswordCalls).toEqual(["newpass123"]);
    });
  });

  describe("clearPassword", () => {
    it("清空密码回到免登录模式", async () => {
      accountStore.account = { passwordHash: "h" };

      await expect(service.clearPassword()).resolves.toEqual({ success: true, passwordSet: false });
      expect(accountStore.clearPasswordCalls).toBe(1);
    });
  });

  describe("assertImage（经 uploadAvatar / uploadWallpaper 的入口）", () => {
    it("非图片 MIME → 抛错，且不触发图像处理", async () => {
      await expect(
        service.uploadAvatar({ mimetype: "application/pdf", buffer: Buffer.from("x") }),
      ).rejects.toThrow(/不支持的文件类型/);

      expect(sharpMock).not.toHaveBeenCalled();
    });

    it("缺少 file → 抛错", async () => {
      await expect(service.uploadAvatar(undefined)).rejects.toThrow(/不支持的文件类型/);
    });

    it.each(["image/jpeg", "image/png", "image/gif", "image/webp"])("允许 %s", async (mimetype) => {
      await expect(service.uploadAvatar({ mimetype, buffer: Buffer.from("x") })).resolves.toBeTruthy();
    });
  });

  describe("uploadAvatar", () => {
    it("成功：缩放为 128x128 jpeg(q95) 并写回相对路径", async () => {
      const file = { mimetype: "image/jpeg", buffer: Buffer.from("img") };

      const result = await service.uploadAvatar(file);

      expect(sharpMock).toHaveBeenCalledWith(file.buffer);
      expect(sharpMock.__chain.resize).toHaveBeenCalledWith(128, 128, { fit: "cover" });
      expect(sharpMock.__chain.jpeg).toHaveBeenCalledWith({ quality: 95 });
      expect(accountStore.updateProfileCalls[0].avatarUrl).toMatch(/^\/uploads\/avatars\/.+\.jpg$/);
      expect(result.url).toMatch(/^http:\/\/localhost:3000\/uploads\/avatars\/.+\.jpg$/);
    });

    it("替换头像时清理旧文件", async () => {
      const oldRel = "/uploads/avatars/old.jpg";
      const oldAbs = uploadPathService.toPhysicalPath(oldRel);
      fs.mkdirSync(path.dirname(oldAbs), { recursive: true });
      fs.writeFileSync(oldAbs, "old");
      accountStore.account = { avatarUrl: oldRel };

      await service.uploadAvatar({ mimetype: "image/jpeg", buffer: Buffer.from("img") });

      expect(fs.existsSync(oldAbs)).toBe(false);
    });

    it("图像处理失败 → 抛出带原因的错误并清理已落盘的半成品", async () => {
      sharpMock.__chain.toFile.mockRejectedValueOnce(new Error("磁盘满"));

      await expect(
        service.uploadAvatar({ mimetype: "image/jpeg", buffer: Buffer.from("img") }),
      ).rejects.toThrow(/头像上传失败: 磁盘满/);
      expect(accountStore.updateProfileCalls).toHaveLength(0);
    });
  });

  describe("uploadWallpaper / deleteWallpaper", () => {
    it("成功：宽度 1920 inside 缩放 jpeg(q90)", async () => {
      const result = await service.uploadWallpaper({ mimetype: "image/png", buffer: Buffer.from("img") });

      expect(sharpMock.__chain.resize).toHaveBeenCalledWith(1920, null, {
        fit: "inside",
        withoutEnlargement: true,
      });
      expect(sharpMock.__chain.jpeg).toHaveBeenCalledWith({ quality: 90 });
      expect(accountStore.updateProfileCalls[0].wallpaperUrl).toMatch(/^\/uploads\/wallpapers\/.+\.jpg$/);
      expect(result.url).toContain("/uploads/wallpapers/");
    });

    it("删除壁纸：清旧文件并置空引用", async () => {
      const rel = "/uploads/wallpapers/w.jpg";
      const abs = uploadPathService.toPhysicalPath(rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, "w");
      accountStore.account = { wallpaperUrl: rel };

      await service.deleteWallpaper();

      expect(fs.existsSync(abs)).toBe(false);
      expect(accountStore.updateProfileCalls[0]).toEqual({ wallpaperUrl: null });
    });

    it("本就没有壁纸时直接返回，不写库", async () => {
      accountStore.account = {};

      await service.deleteWallpaper();

      expect(accountStore.updateProfileCalls).toHaveLength(0);
    });

    it("旧文件不存在时不抛错（清理失败不阻断主流程）", async () => {
      accountStore.account = { avatarUrl: "/uploads/avatars/ghost.jpg" };

      await expect(
        service.uploadAvatar({ mimetype: "image/jpeg", buffer: Buffer.from("img") }),
      ).resolves.toBeTruthy();
    });
  });
});
