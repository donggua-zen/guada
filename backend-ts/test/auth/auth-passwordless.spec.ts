import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { AuthService } from "../../src/modules/auth/auth.service";
import { AuthController } from "../../src/modules/auth/auth.controller";

/**
 * 免密（passwordHash=null）登录语义。
 *
 * 背景：免密实例上 /auth/login 曾对任何密码都返回 401，
 * 一旦前端落到登录页用户就被永久锁在门外（见 docs/design/single-account.md
 * "不该有把用户锁在门外自己的数据之外的设计"）。
 * 这里锁定修复后的语义：未设密码时用户名匹配即放行。
 */

function makeAccountStore(overrides: Record<string, unknown> = {}) {
  return {
    get: jest.fn(),
    isPasswordSet: jest.fn(),
    verifyPassword: jest.fn(),
    getView: jest.fn(() => ({
      username: "guada",
      nickname: null,
      avatarUrl: null,
      wallpaperUrl: null,
      passwordSet: false,
    })),
    ensureReady: jest.fn(),
    ...overrides,
  };
}

describe("AuthService 免密模式", () => {
  const jwt = { sign: jest.fn(() => "signed-token") } as any;
  const url = { toResourceAbsoluteUrl: (u: string) => u } as any;

  it("未设密码：用户名匹配即放行（任意密码，不校验密码）", async () => {
    const store = makeAccountStore({
      get: jest.fn(() => ({ username: "guada", passwordHash: null })),
      isPasswordSet: jest.fn(() => false),
    });
    const svc = new AuthService(jwt, store as any, url);

    await expect(svc.validateCredentials("guada", "whatever")).resolves.toBe(
      true,
    );
    // 免密分支不应触碰密码校验
    expect(store.verifyPassword).not.toHaveBeenCalled();
  });

  it("未设密码：用户名不匹配仍拒绝", async () => {
    const store = makeAccountStore({
      get: jest.fn(() => ({ username: "guada", passwordHash: null })),
      isPasswordSet: jest.fn(() => false),
    });
    const svc = new AuthService(jwt, store as any, url);

    await expect(svc.validateCredentials("someone", "x")).resolves.toBe(false);
  });

  it("已设密码：委托 verifyPassword 校验", async () => {
    const store = makeAccountStore({
      get: jest.fn(() => ({ username: "guada", passwordHash: "hash" })),
      isPasswordSet: jest.fn(() => true),
      verifyPassword: jest.fn(async (p: string) => p === "secret"),
    });
    const svc = new AuthService(jwt, store as any, url);

    await expect(svc.validateCredentials("guada", "secret")).resolves.toBe(true);
    await expect(svc.validateCredentials("guada", "wrong")).resolves.toBe(false);
  });

  it("autoLoginIfPasswordless：已设密码返回 null", () => {
    const store = makeAccountStore({ isPasswordSet: jest.fn(() => true) });
    const svc = new AuthService(jwt, store as any, url);

    expect(svc.autoLoginIfPasswordless()).toBeNull();
  });

  it("autoLoginIfPasswordless：未设密码签发凭据", () => {
    const store = makeAccountStore({ isPasswordSet: jest.fn(() => false) });
    const svc = new AuthService(jwt, store as any, url);

    expect(svc.autoLoginIfPasswordless()?.accessToken).toBe("signed-token");
  });

  it("getStatus / isPasswordSet 反映账户状态", () => {
    const store = makeAccountStore({ isPasswordSet: jest.fn(() => false) });
    const svc = new AuthService(jwt, store as any, url);

    expect(svc.getStatus()).toEqual({ passwordSet: false });
    expect(svc.isPasswordSet()).toBe(false);
  });
});

describe("AuthController.login 免密放行", () => {
  it("免密模式：不传密码也放行（用户名匹配）", async () => {
    const auth = {
      ensureReady: jest.fn(),
      isPasswordSet: jest.fn(() => false),
      validateCredentials: jest.fn(async () => true),
      login: jest.fn(() => ({
        accessToken: "t",
        user: { username: "guada", passwordSet: false },
      })),
    };
    const controller = new AuthController(auth as any);

    await expect(controller.login({ username: "guada" })).resolves.toEqual({
      accessToken: "t",
      user: { username: "guada", passwordSet: false },
    });
    expect(auth.validateCredentials).toHaveBeenCalledWith("guada", "");
  });

  it("已设密码：缺密码 → 400", async () => {
    const auth = {
      ensureReady: jest.fn(),
      isPasswordSet: jest.fn(() => true),
      validateCredentials: jest.fn(async () => true),
      login: jest.fn(),
    };
    const controller = new AuthController(auth as any);

    await expect(controller.login({ username: "guada" })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("缺用户名 → 400", async () => {
    const auth = { ensureReady: jest.fn(), isPasswordSet: jest.fn(() => false) };
    const controller = new AuthController(auth as any);

    await expect(controller.login({ password: "x" })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("校验失败 → 401（不区分用户名或密码错误）", async () => {
    const auth = {
      ensureReady: jest.fn(),
      isPasswordSet: jest.fn(() => true),
      validateCredentials: jest.fn(async () => false),
      login: jest.fn(),
    };
    const controller = new AuthController(auth as any);

    await expect(
      controller.login({ username: "guada", password: "wrong" }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
