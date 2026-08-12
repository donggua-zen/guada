import type { ApiContext } from "./api-context";

export interface ConfigField {
  key: string;
  label: string;
  type: "text" | "password" | "number" | "select" | "textarea";
  required?: boolean;
  default?: any;
  placeholder?: string;
  showIf?: { field: string; equals: any };
  options?: { label: string; value: any }[];
}

export interface AttachmentTypeInfo {
  id: string;
  label: string;
  icon: string;
  pluginId: string;
}

export interface AttachmentItem {
  id: string;
  name: string;
  description?: string;
  meta?: Record<string, any>;
}

export interface PluginAttachmentList {
  typeId: string;
  items: AttachmentItem[];
}

export interface UiPageInfo {
  id: string;
  area: string;
  group: string;
  tab: string;
  icon: string;
  component: string;
  pluginId: string;
  order: number;
}

export interface PluginApi {
  getAttachmentTypes(): Promise<AttachmentTypeInfo[]>;
  getPluginAttachments(pluginId: string): Promise<PluginAttachmentList[]>;
  getPluginUiPages(area?: string): Promise<UiPageInfo[]>;
  getPluginData(pluginId: string): Promise<Record<string, any>>;
  setPluginData(pluginId: string, key: string, value: any): Promise<{ success: boolean }>;
  deletePluginData(pluginId: string, key: string): Promise<{ success: boolean }>;
}

export const pluginApi: PluginApi = {
  async getAttachmentTypes(this: ApiContext) {
    return await this._request("/plugins/attachment-types");
  },

  async getPluginAttachments(this: ApiContext, pluginId: string) {
    return await this._request(`/plugins/${pluginId}/attachments`);
  },

  async getPluginUiPages(this: ApiContext, area?: string) {
    const q = area ? `?area=${area}` : "";
    return await this._request(`/plugins/ui-pages${q}`);
  },

  async getPluginData(this: ApiContext, pluginId: string) {
    return await this._request(`/plugins/${pluginId}/data`);
  },

  async setPluginData(this: ApiContext, pluginId: string, key: string, value: any) {
    return await this._request(`/plugins/${pluginId}/data/${key}`, {
      method: "PUT",
      data: { value },
    });
  },

  async deletePluginData(this: ApiContext, pluginId: string, key: string) {
    return await this._request(`/plugins/${pluginId}/data/${key}`, {
      method: "DELETE",
    });
  },
};