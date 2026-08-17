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
  /** 获取所有插件的 slot 注册清单（v2 插件 UI） */
  getPluginSlots(): Promise<{ slots: Record<string, any[]> }>;
  /** 调用插件后端 RPC 方法 */
  call(pluginId: string, method: string, args?: any): Promise<any>;
  /** 获取共享运行时上下文（用户/会话等基础信息） */
  getSharedContext(): Promise<{ user?: any; session?: any }>;
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
  async getPluginSlots(this: ApiContext) {
    return await this._request("/plugins/slots");
  },

  async call(this: ApiContext, pluginId: string, method: string, args?: any) {
    const sessionId = window.__GuaDaShared__?.runtime?.session?.id;
    const workspaceId = window.__GuaDaShared__?.runtime?.session?.workspaceId;
    return await this._request(`/plugins/${pluginId}/rpc/${method}`, {
      method: "POST",
      data: { args, sessionId, workspaceId },
    });
  },

  async getSharedContext(this: ApiContext) {
    return {
      user: window.__GuaDaShared__?.runtime?.user,
      session: window.__GuaDaShared__?.runtime?.session,
    };
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