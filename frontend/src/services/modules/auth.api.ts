import type { ApiContext } from "./api-context";
import type { LoginRequest, LoginResponse, User } from "@/types/service";

/**
 * 认证与账户 API（单账户）
 *
 * 密码可选：未设密码时 `/auth/auto-login` 直接签发凭据（免登录），
 * 设了密码则必须走 `/auth/login`。`/auth/status` 供前端判断是否需要强制登录。
 */
export interface AuthApi {
  getAuthStatus(): Promise<{ passwordSet: boolean }>;
  login(credentials: LoginRequest): Promise<LoginResponse>;
  autoLogin(): Promise<{ accessToken: string; user: User }>;
  getProfile(): Promise<User>;
  updateProfile(data: any): Promise<User>;
  checkUsername(username: string): Promise<{ available: boolean }>;
  changePassword(
    oldPassword: string | undefined,
    newPassword: string,
  ): Promise<any>;
  clearPassword(): Promise<any>;
}

export const authApi: AuthApi = {
  async getAuthStatus(this: ApiContext) {
    return await this._request("/auth/status");
  },

  async login(this: ApiContext, credentials: LoginRequest) {
    return await this._request("/auth/login", {
      method: "POST",
      data: credentials,
    });
  },

  async autoLogin(this: ApiContext) {
    return await this._request("/auth/auto-login", { method: "POST" });
  },

  async getProfile(this: ApiContext) {
    return await this._request("/user/profile");
  },

  async updateProfile(this: ApiContext, data: any) {
    return await this._request("/user/profile", { method: "PUT", data });
  },

  async checkUsername(this: ApiContext, username: string) {
    return await this._request("/user/check-username", {
      params: { username },
    });
  },

  async changePassword(
    this: ApiContext,
    oldPassword: string | undefined,
    newPassword: string,
  ) {
    return await this._request("/user/password/change", {
      method: "POST",
      data: { oldPassword, newPassword },
    });
  },

  /** 清除密码 → 回到免登录模式 */
  async clearPassword(this: ApiContext) {
    return await this._request("/user/password", { method: "DELETE" });
  },
};
