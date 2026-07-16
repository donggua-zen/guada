import type { ApiContext } from "./api-context";
import type {
  LoginRequest,
  LoginResponse,
  User,
  ResetPasswordCheckResponse,
  ResetPasswordRequest,
  Subaccount,
} from "@/types/service";

export interface AuthApi {
  login(credentials: LoginRequest): Promise<LoginResponse>;
  getAutoLoginStatus(): Promise<{ enabled: boolean }>;
  setAutoLoginStatus(enabled: boolean): Promise<void>;
  autoLogin(): Promise<{ accessToken: string; user: User }>;
  getProfile(): Promise<User>;
  updateProfile(data: any): Promise<User>;
  changePassword(oldPassword: string, newPassword: string): Promise<any>;
  checkResetPassword(): Promise<ResetPasswordCheckResponse>;
  resetPrimayPassword(data: ResetPasswordRequest): Promise<any>;
  createSubaccount(data: any): Promise<Subaccount>;
  updateSubaccount(subaccountId: string, data: any): Promise<Subaccount>;
  deleteSubaccount(subaccountId: string): Promise<boolean>;
  fetchSubaccounts(): Promise<Subaccount[]>;
}

export const authApi: AuthApi = {
  async login(this: ApiContext, credentials: LoginRequest) {
    return await this._request("/auth/login", {
      method: "POST",
      data: credentials,
    });
  },

  async getAutoLoginStatus(this: ApiContext) {
    return await this._request("/settings/auto-login");
  },

  async setAutoLoginStatus(this: ApiContext, enabled: boolean) {
    return await this._request("/settings/auto-login", {
      method: "POST",
      data: { enabled },
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

  async changePassword(this: ApiContext, oldPassword: string, newPassword: string) {
    return await this._request("/user/password/change", {
      method: "POST",
      data: { oldPassword: oldPassword, newPassword: newPassword },
    });
  },

  async checkResetPassword(this: ApiContext) {
    return await this._request("/user/password/reset/check");
  },

  async resetPrimayPassword(this: ApiContext, data: ResetPasswordRequest) {
    return await this._request("/user/password/reset", {
      method: "POST",
      data,
    });
  },

  async createSubaccount(this: ApiContext, data: any) {
    return await this._request("/subaccounts", { method: "POST", data });
  },

  async updateSubaccount(this: ApiContext, subaccountId: string, data: any) {
    return await this._request(`/subaccounts/${subaccountId}`, {
      method: "PUT",
      data,
    });
  },

  async deleteSubaccount(this: ApiContext, subaccountId: string) {
    return await this._request(`/subaccounts/${subaccountId}`, {
      method: "DELETE",
    });
  },

  async fetchSubaccounts(this: ApiContext) {
    return await this._request("/subaccounts");
  },
};
