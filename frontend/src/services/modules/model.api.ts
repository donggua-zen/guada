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
  updateProvider(providerId: string, data: any): Promise<any>;
  getProviderTemplates(): Promise<any[]>;
}

export const modelApi: ModelApi = {
  async fetchModels(this: ApiContext) {
    return await this._request("/models");
  },

  async fetchAllModels(this: ApiContext) {
    return await this._request("/models/all");
  },

  async fetchRemoteModels(this: ApiContext, providerId: string) {
    return await this._request(`/providers/${providerId}/remote_models`);
  },

  async createModel(this: ApiContext, data: any) {
    return await this._request("/models", { method: "POST", data });
  },

  async updateModel(this: ApiContext, modelId: string, data: any) {
    return await this._request(`/models/${modelId}`, { method: "PUT", data });
  },

  async deleteModel(this: ApiContext, modelId: string) {
    return await this._request(`/models/${modelId}`, { method: "DELETE" });
  },

  async toggleModelFavorite(this: ApiContext, modelId: string) {
    return await this._request(`/models/${modelId}/favorite`, {
      method: "PUT",
    });
  },

  async toggleModelActive(this: ApiContext, modelId: string) {
    return await this._request(`/models/${modelId}/toggle-active`, {
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

  async deleteProvider(this: ApiContext, providerId: string) {
    return await this._request(`/providers/${providerId}`, {
      method: "DELETE",
    });
  },

  async updateProvider(this: ApiContext, providerId: string, data: any) {
    return await this._request(`/providers/${providerId}`, {
      method: "PUT",
      data,
    });
  },

  async getProviderTemplates(this: ApiContext) {
    return await this._request("/providers/templates");
  },
};
