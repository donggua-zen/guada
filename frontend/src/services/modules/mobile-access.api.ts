import type { ApiContext } from "./api-context";

/**
 * 移动访问（局域网 + 公网 SSH 隧道）API。
 *
 * 配置与状态都以后端为准；局域网开关的监听地址变更需重启应用（restartRequired），
 * 公网隧道的启停/重连即时生效。SSH 密码只写不读（hasPassword 表示已配置）。
 */

export type MobileAccessSshAuthMethod = "password" | "privateKey";
export type MobileAccessRemoteBindAddress = "127.0.0.1" | "0.0.0.0";
export type MobileAccessTunnelState = "stopped" | "connecting" | "connected" | "error";

export interface MobileAccessSshView {
  host: string;
  port: number;
  username: string;
  authMethod: MobileAccessSshAuthMethod;
  privateKeyPath: string;
  remoteBindAddress: MobileAccessRemoteBindAddress;
  remotePort: number;
  publicUrl: string;
  hostFingerprint: string;
}

export interface MobileAccessConfigView {
  lanEnabled: boolean;
  publicEnabled: boolean;
  hasPassword: boolean;
  passwordSet: boolean;
  /** 后端本次启动是否真的绑在 0.0.0.0（false = 局域网开关还没生效，需重启） */
  lanActive: boolean;
  port: number | null;
  /** 仅 PUT 响应：局域网开关与当前绑定状态不一致时要求重启应用 */
  restartRequired?: boolean;
  ssh: MobileAccessSshView;
}

export interface MobileAccessUpdateInput {
  lanEnabled?: boolean;
  publicEnabled?: boolean;
  ssh?: Partial<MobileAccessSshView> & {
    /** 明文 SSH 密码：仅写入，留空表示保持原密码 */
    password?: string;
    /** 显式清空主机指纹（确认服务器指纹变更后） */
    clearHostFingerprint?: boolean;
  };
}

export interface MobileAccessStatusView {
  passwordSet: boolean;
  port: number | null;
  lan: {
    enabled: boolean;
    active: boolean;
    urls: string[];
  };
  public: {
    enabled: boolean;
    status: MobileAccessTunnelState;
    url: string | null;
    lastError: string | null;
  };
}

export interface MobileAccessApi {
  getMobileAccessConfig(): Promise<MobileAccessConfigView>;
  updateMobileAccessConfig(input: MobileAccessUpdateInput): Promise<MobileAccessConfigView>;
  getMobileAccessStatus(): Promise<MobileAccessStatusView>;
  reconnectMobileAccessTunnel(): Promise<{ success: boolean }>;
}

export const mobileAccessApi: MobileAccessApi = {
  async getMobileAccessConfig(this: ApiContext) {
    return await this._request<MobileAccessConfigView>("/mobile-access/config");
  },

  async updateMobileAccessConfig(this: ApiContext, input: MobileAccessUpdateInput) {
    return await this._request<MobileAccessConfigView>("/mobile-access/config", {
      method: "PUT",
      data: input,
    });
  },

  async getMobileAccessStatus(this: ApiContext) {
    return await this._request<MobileAccessStatusView>("/mobile-access/status");
  },

  async reconnectMobileAccessTunnel(this: ApiContext) {
    return await this._request<{ success: boolean }>("/mobile-access/tunnel/reconnect", {
      method: "POST",
    });
  },
};
