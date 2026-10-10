import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";

/**
 * authStore 免密入口决策（ensureEntry / fetchPasswordSet）
 *
 * 覆盖修复的 bug：免密实例上查询失败曾被误判为"已设密码"而把用户踢到登录页；
 * 现在入口统一由 ensureEntry 决策，查询失败不再等于"需要密码"。
 */

// store 模块初始化即读 localStorage/sessionStorage，window.setInterval 也在其中，
// 必须在 import 之前把 node 环境缺失的浏览器全局桩就位。
vi.hoisted(() => {
  const makeStorage = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
      setItem: (k: string, v: string) => {
        m.set(k, String(v));
      },
      removeItem: (k: string) => {
        m.delete(k);
      },
      clear: () => {
        m.clear();
      },
    };
  };
  const g = globalThis as any;
  g.localStorage = makeStorage();
  g.sessionStorage = makeStorage();
  g.window = { setInterval: () => 0, clearInterval: () => {} };
});

vi.mock("@/locales", () => ({ t: (k: string) => k }));

vi.mock("@/utils/errors", () => ({
  NetworkError: class NetworkError extends Error {},
  AuthError: class AuthError extends Error {},
  ApiError: class ApiError extends Error {},
}));

vi.mock("@/utils/errorMessage", () => ({
  getApiErrorStatus: (e: any) => e?.statusCode ?? e?.status,
  getErrorMessage: (e: any) => e?.message ?? String(e),
}));

vi.mock("@/services/ApiService", () => ({
  apiService: {
    getAuthStatus: vi.fn(),
    autoLogin: vi.fn(),
    getProfile: vi.fn(),
    login: vi.fn(),
  },
}));

import { useAuthStore } from "./auth";
import { apiService } from "@/services/ApiService";

const api = apiService as any;

function tokenResponse(user: Record<string, unknown> = {}) {
  return {
    accessToken: "tok",
    user: { username: "guada", passwordSet: false, ...user },
  };
}

describe("authStore 免密入口决策", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  it("fetchPasswordSet：未设密码返回 false", async () => {
    api.getAuthStatus.mockResolvedValue({ passwordSet: false });
    const store = useAuthStore();

    await expect(store.fetchPasswordSet()).resolves.toBe(false);
    expect(store.passwordSet).toBe(false);
  });

  it("fetchPasswordSet：查询失败重试后返回 null，且不误判为已设密码", async () => {
    api.getAuthStatus.mockRejectedValue(new Error("network down"));
    const store = useAuthStore();

    await expect(store.fetchPasswordSet()).resolves.toBeNull();
    expect(store.passwordSet).toBe(false);
    expect(api.getAuthStatus).toHaveBeenCalledTimes(3);
  });

  it("ensureEntry：免密 → 自动进入并持有 token", async () => {
    api.getAuthStatus.mockResolvedValue({ passwordSet: false });
    api.autoLogin.mockResolvedValue(tokenResponse());
    const store = useAuthStore();

    await expect(store.ensureEntry()).resolves.toBe("entered");
    expect(store.isAuthenticated).toBe(true);
    expect(api.autoLogin).toHaveBeenCalledTimes(1);
  });

  it("ensureEntry：已设密码 → 走登录页，不再尝试免密", async () => {
    api.getAuthStatus.mockResolvedValue({ passwordSet: true });
    const store = useAuthStore();

    await expect(store.ensureEntry()).resolves.toBe("login");
    expect(api.autoLogin).not.toHaveBeenCalled();
  });

  it("ensureEntry：状态查询失败 + auto-login 400 → 走登录页", async () => {
    api.getAuthStatus.mockRejectedValue(new Error("down"));
    api.autoLogin.mockRejectedValue({ statusCode: 400 });
    const store = useAuthStore();

    await expect(store.ensureEntry()).resolves.toBe("login");
  });

  it("ensureEntry：状态查询失败 + 后端不可达 → unavailable（不误判为需要密码）", async () => {
    api.getAuthStatus.mockRejectedValue(new Error("down"));
    api.autoLogin.mockRejectedValue(new Error("unreachable"));
    const store = useAuthStore();

    await expect(store.ensureEntry()).resolves.toBe("unavailable");
  });

  it("ensureEntry：已有有效 token → 直接进入，不查免密状态", async () => {
    sessionStorage.setItem("token", "existing");
    api.getProfile.mockResolvedValue({ username: "guada", passwordSet: true });
    const store = useAuthStore();

    await expect(store.ensureEntry()).resolves.toBe("entered");
    expect(store.passwordSet).toBe(true);
    expect(api.getAuthStatus).not.toHaveBeenCalled();
  });

  it("ensureEntry：陈旧 token 失效 → 清 token 后按免密进入（不再卡登录页）", async () => {
    sessionStorage.setItem("token", "stale");
    api.getProfile.mockRejectedValue({ statusCode: 401 });
    api.getAuthStatus.mockResolvedValue({ passwordSet: false });
    api.autoLogin.mockResolvedValue(tokenResponse());
    const store = useAuthStore();

    await expect(store.ensureEntry()).resolves.toBe("entered");
    expect(store.isAuthenticated).toBe(true);
  });
});
