import type { ApiContext } from "./api-context";

/**
 * 后端运行时能力（公开端点 /capabilities）。
 *
 * 平台与可选档位必须由后端给出：手机浏览器/Web 端访问 Windows 后端时，
 * 客户端的 navigator.platform 不能代表后端执行环境。
 */
export interface Capabilities {
  platform: string;
  sandboxModes: string[];
}

export interface CapabilitiesApi {
  fetchCapabilities(): Promise<Capabilities>;
}

export const capabilitiesApi: CapabilitiesApi = {
  async fetchCapabilities(this: ApiContext) {
    return await this._request<Capabilities>("/capabilities");
  },
};
