import type { AxiosRequestConfig } from "axios";
import type { ApiContext } from "./api-context";
import type { Model, ModelProvider } from "@/types/api";
import type { PaginatedResponse } from "@/types/common";

export interface ModelApi {
  fetchModels(): Promise<PaginatedResponse<ModelProvider>>;
  fetchAllModels(): Promise<PaginatedResponse<ModelProvider>>;
  fetchRemoteModels(providerId: string): Promise<PaginatedResponse<Model>>;
  createModel(data: any): Promise<Model>;
  updateModel(modelId: string, data: any): Promise<Model>;
  deleteModel(modelId: string): Promise<boolean>;
  toggleModelFavorite(modelId: string): Promise<any>;
  toggleModelActive(modelId: string): Promise<any>;
  createProvider(data: any): Promise<any>;
  testProviderConnection(data: any): Promise<{ success: boolean; message: string }>;
  deleteProvider(providerId: string): Promise<boolean>;
  setProviderEnabled(providerId: string, enabled: boolean): Promise<any>;
  updateProvider(providerId: string, data: any): Promise<any>;
  getProviderTemplates(): Promise<any[]>;
  getModelPresets(): Promise<any[]>;
  /** 按 apiUrl 推荐思考格式（仅供提示，用户确认后才写入 compat） */
  getThinkingFormatSuggestion(
    apiUrl: string,
  ): Promise<{ suggestion?: { format: string; vendor: string } }>;
  /** 拼法模板（请求拼法：模板下拉 + CEL 表达式编辑器的数据源） */
  getThinkingPatchTemplates(): Promise<ThinkingPatchTemplatesResponse>;
}

/** 拼法模板响应（与后端 THINKING_PATCH_TEMPLATES / PATCH_EXPR_VARIABLES 同构） */
export interface ThinkingPatchTemplate {
  /** 内置拼法名（= thinkingFormat 值，模板即其等价表达式） */
  format: string;
  /** CEL 表达式（档位 → JSON 对象） */
  expression: string;
  /** true = 模板下拉展示的预制项（覆盖主流场景的 3 条）；其余仅用于等价测试与「填入」桥接 */
  curated?: boolean;
  /** true = 依赖 compat 字段（chatTemplateArgs/Kwargs），选后需自行补全 */
  requiresCustomization?: boolean;
}

export interface ThinkingPatchTemplatesResponse {
  templates: ThinkingPatchTemplate[];
  /** 表达式可用变量（name/type，语义在编辑器提示文案里） */
  variables: Array<{ name: string; type: string }>;
  /** 表达式长度上限 */
  maxLength: number;
}

export const modelApi: ModelApi = {
  async fetchModels(this: ApiContext) {
    return await this._request("/models");
  },

  async fetchAllModels(this: ApiContext) {
    return await this._request("/models/all");
  },

  async fetchRemoteModels(this: ApiContext, providerId: string) {
    return await this._request(`/providers/${encodeURIComponent(providerId)}/remote_models`);
  },

  async createModel(this: ApiContext, data: any) {
    return await this._request("/models", { method: "POST", data });
  },

  async updateModel(this: ApiContext, modelId: string, data: any) {
    return await this._request(`/models/${encodeURIComponent(modelId)}`, { method: "PUT", data });
  },

  async deleteModel(this: ApiContext, modelId: string) {
    return await this._request(`/models/${encodeURIComponent(modelId)}`, { method: "DELETE" });
  },

  async toggleModelFavorite(this: ApiContext, modelId: string) {
    return await this._request(`/models/${encodeURIComponent(modelId)}/favorite`, {
      method: "PUT",
    });
  },

  async toggleModelActive(this: ApiContext, modelId: string) {
    return await this._request(`/models/${encodeURIComponent(modelId)}/toggle-active`, {
      method: "PUT",
    });
  },

  async createProvider(this: ApiContext, data: any) {
    return await this._request("/providers", { method: "POST", data });
  },

  async testProviderConnection(this: ApiContext, data: any) {
    return await this._request("/providers/test-connection", {
      method: "POST",
      data,
    });
  },

  async setProviderEnabled(this: ApiContext, providerId: string, enabled: boolean) {
    return await this._request(`/providers/${providerId}/enabled`, { method: "PUT", data: { enabled } });
  },

  async deleteProvider(this: ApiContext, providerId: string) {
    return await this._request(`/providers/${encodeURIComponent(providerId)}`, {
      method: "DELETE",
    });
  },

  async updateProvider(this: ApiContext, providerId: string, data: any) {
    return await this._request(`/providers/${encodeURIComponent(providerId)}`, {
      method: "PUT",
      data,
    });
  },

  async getProviderTemplates(this: ApiContext) {
    return await this._request("/providers/templates");
  },

  async getModelPresets(this: ApiContext) {
    return await this._request("/models/presets");
  },

  async getThinkingFormatSuggestion(this: ApiContext, apiUrl: string) {
    return await this._request(
      `/models/thinking-format-suggestion?apiUrl=${encodeURIComponent(apiUrl)}`,
    );
  },

  async getThinkingPatchTemplates(this: ApiContext) {
    return await this._request("/models/thinking-patch-templates");
  },
};
