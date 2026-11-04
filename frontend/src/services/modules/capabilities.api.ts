import type { ApiContext } from "./api-context";

/**
 * 后端运行时能力（公开端点 /capabilities）。
 *
 * 平台与可选档位必须由后端给出：手机浏览器/Web 端访问 Windows 后端时，
 * 客户端的 navigator.platform 不能代表后端执行环境。
 *
 * shells：各 shell 后端在 Windows 上是否可用（未安装的选项置灰）；
 * 非 Windows 平台为 null（设置页不展示该设置项）。
 */
export interface ShellAvailability {
  gitbash: boolean;
  powershell: boolean;
  cmd: boolean;
}

export interface Capabilities {
  platform: string;
  sandboxModes: string[];
  shells?: ShellAvailability | null;
}

export interface CapabilitiesApi {
  fetchCapabilities(): Promise<Capabilities>;
}

export const capabilitiesApi: CapabilitiesApi = {
  async fetchCapabilities(this: ApiContext) {
    return await this._request<Capabilities>("/capabilities");
  },
};
