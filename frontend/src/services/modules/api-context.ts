import type { AxiosInstance, AxiosRequestConfig } from "axios";

/**
 * 核心上下文 —— 领域 API 方法通过 `this: ApiContext` 访问底层能力。
 * 挂载到 ApiService.prototype 后，`this` 即为 ApiService 实例。
 */
export interface ApiContext {
  // 与 ApiService._request 的动态边界默认值保持一致（说明见 ApiService._request 注释）
  _request<T = any>(endpoint: string, options?: AxiosRequestConfig): Promise<T>;
  axiosInstance: AxiosInstance;
  baseURL: string;
}
