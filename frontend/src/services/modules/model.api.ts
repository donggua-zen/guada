import type { ApiContext } from "./api-context";
import type { Model, ModelPreset, ModelProvider, ProviderTemplate, ThinkingCompatConfig } from "@/types/api";
import type { PaginatedResponse } from "@/types/common";

/** 模型 config 块（与后端 addModel 的 config 白名单同构） */
export interface ModelConfigPayload {
    inputCapabilities?: string[]
    outputCapabilities?: string[]
    features?: string[]
    contextWindow?: number | null
    maxOutputTokens?: number | null
    customParameters?: Record<string, unknown>
}

/**
 * 思考声明块（后端 parseThinkingPatch 逐字段校验，fail-loud）。
 * null 语义 = 清除条目级覆盖、回退继承链；undefined = 不动。
 */
export interface ThinkingPatchPayload {
    supportsThinking?: boolean | null
    thinkingEfforts?: string[] | false | null
    thinkingEffortsMap?: Record<string, string> | null
    thinkingEffortsPatch?: Record<string, Record<string, unknown>> | null
    thinkingPatchExpr?: string | null
    /** legacy thinking 块：{ style } 归一到 compat.thinkingFormat；null = 清除 compat */
    thinking?: { style?: string } | null
    compat?: ThinkingCompatConfig | null
}

/** createModel 请求体（镜像后端 model.service.addModel 手写校验：providerId/modelName 必填） */
export interface CreateModelPayload extends ThinkingPatchPayload {
    providerId: string
    modelName: string
    modelType?: string
    name?: string
    isFavorite?: boolean
    isActive?: boolean
    config?: ModelConfigPayload | null
}

/** updateModel 请求体（镜像后端 buildModelPatch 白名单：全部可选，null 语义同上） */
export interface UpdateModelPayload extends ThinkingPatchPayload {
    modelType?: string
    name?: string | null
    config?: ModelConfigPayload | null
    isFavorite?: boolean
    isActive?: boolean
    deleted?: boolean
}

/** createProvider 请求体（镜像后端 addProvider 参数表：name 必填） */
export interface CreateProviderPayload {
    name: string
    apiKey?: string
    apiUrl?: string
    /** bundled 类型标识（如 dsh/openai）或 "custom"；决定实例 id 生成策略 */
    provider?: string
    protocol?: string
    avatarUrl?: string
    attributes?: { headers?: Record<string, string> }
    compat?: ThinkingCompatConfig
}

/** updateProvider 请求体（镜像后端 updateProvider 白名单） */
export interface UpdateProviderPayload {
    name?: string
    apiKey?: string
    apiUrl?: string
    protocol?: string
    enabled?: boolean
    attributes?: { headers?: Record<string, string> }
    /** null = 清除实例级 compat 覆盖、回退类型卡声明 */
    compat?: ThinkingCompatConfig | null
}

/** testProviderConnection 请求体（后端直接解构 apiUrl/apiKey/attributes/protocol） */
export interface TestProviderConnectionPayload {
    apiUrl?: string
    apiKey?: string
    protocol?: string
    attributes?: { headers?: Record<string, string> }
}

export interface ModelApi {
  fetchModels(): Promise<PaginatedResponse<ModelProvider>>;
  fetchAllModels(): Promise<PaginatedResponse<ModelProvider>>;
  fetchRemoteModels(providerId: string): Promise<PaginatedResponse<Model>>;
  createModel(data: CreateModelPayload): Promise<Model>;
  updateModel(modelId: string, data: UpdateModelPayload): Promise<{ id: string }>;
  deleteModel(modelId: string): Promise<boolean>;
  toggleModelFavorite(modelId: string): Promise<{ id: string; isFavorite: boolean }>;
  toggleModelActive(modelId: string): Promise<{ id: string; isActive: boolean }>;
  createProvider(data: CreateProviderPayload): Promise<ModelProvider>;
  testProviderConnection(data: TestProviderConnectionPayload): Promise<{ success: boolean; message: string }>;
  deleteProvider(providerId: string): Promise<boolean>;
  setProviderEnabled(providerId: string, enabled: boolean): Promise<{ id: string; enabled: boolean }>;
  updateProvider(providerId: string, data: UpdateProviderPayload): Promise<ModelProvider>;
  getProviderTemplates(): Promise<ProviderTemplate[]>;
  getModelPresets(): Promise<ModelPreset[]>;
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
    return await this._request<PaginatedResponse<ModelProvider>>("/models");
  },

  async fetchAllModels(this: ApiContext) {
    return await this._request<PaginatedResponse<ModelProvider>>("/models/all");
  },

  async fetchRemoteModels(this: ApiContext, providerId: string) {
    return await this._request<PaginatedResponse<Model>>(
      `/providers/${encodeURIComponent(providerId)}/remote_models`,
    );
  },

  async createModel(this: ApiContext, data: CreateModelPayload) {
    return await this._request<Model>("/models", { method: "POST", data });
  },

  async updateModel(this: ApiContext, modelId: string, data: UpdateModelPayload) {
    return await this._request<{ id: string }>(`/models/${encodeURIComponent(modelId)}`, {
      method: "PUT",
      data,
    });
  },

  async deleteModel(this: ApiContext, modelId: string) {
    return await this._request<boolean>(`/models/${encodeURIComponent(modelId)}`, {
      method: "DELETE",
    });
  },

  async toggleModelFavorite(this: ApiContext, modelId: string) {
    return await this._request<{ id: string; isFavorite: boolean }>(
      `/models/${encodeURIComponent(modelId)}/favorite`,
      { method: "PUT" },
    );
  },

  async toggleModelActive(this: ApiContext, modelId: string) {
    return await this._request<{ id: string; isActive: boolean }>(
      `/models/${encodeURIComponent(modelId)}/toggle-active`,
      { method: "PUT" },
    );
  },

  async createProvider(this: ApiContext, data: CreateProviderPayload) {
    return await this._request<ModelProvider>("/providers", { method: "POST", data });
  },

  async testProviderConnection(this: ApiContext, data: TestProviderConnectionPayload) {
    return await this._request<{ success: boolean; message: string }>("/providers/test-connection", {
      method: "POST",
      data,
    });
  },

  async setProviderEnabled(this: ApiContext, providerId: string, enabled: boolean) {
    return await this._request<{ id: string; enabled: boolean }>(`/providers/${providerId}/enabled`, {
      method: "PUT",
      data: { enabled },
    });
  },

  async deleteProvider(this: ApiContext, providerId: string) {
    return await this._request<boolean>(`/providers/${encodeURIComponent(providerId)}`, {
      method: "DELETE",
    });
  },

  async updateProvider(this: ApiContext, providerId: string, data: UpdateProviderPayload) {
    return await this._request<ModelProvider>(`/providers/${encodeURIComponent(providerId)}`, {
      method: "PUT",
      data,
    });
  },

  async getProviderTemplates(this: ApiContext) {
    return await this._request<ProviderTemplate[]>("/providers/templates");
  },

  async getModelPresets(this: ApiContext) {
    return await this._request<ModelPreset[]>("/models/presets");
  },

  async getThinkingFormatSuggestion(this: ApiContext, apiUrl: string) {
    return await this._request<{ suggestion?: { format: string; vendor: string } }>(
      `/models/thinking-format-suggestion?apiUrl=${encodeURIComponent(apiUrl)}`,
    );
  },

  async getThinkingPatchTemplates(this: ApiContext) {
    return await this._request<ThinkingPatchTemplatesResponse>("/models/thinking-patch-templates");
  },
};
