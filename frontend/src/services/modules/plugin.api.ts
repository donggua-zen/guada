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
  /** 查询插件列表（分发管理） */
  queryPlugins(): Promise<{ plugins: any[] }>;
  /** 从分发源安装插件（后台任务，返回 jobId，轮询 install-log 看进度） */
  installPlugin(source: string): Promise<{ jobId: string }>;
  /** 查询安装任务日志（假终端） */
  getInstallLog(jobId: string): Promise<{ log: string[]; done: boolean; result?: { success: boolean; id?: string } }>;
  /** 取消安装任务 */
  cancelInstall(jobId: string): Promise<{ cancelled: boolean }>;
  /** 卸载插件 */
  uninstallPlugin(pluginId: string): Promise<{ success: boolean }>;
  /** 更新插件（git 分发） */
  updatePlugin(pluginId: string): Promise<{ success: boolean }>;
  /** 启用/停用插件 */
  setPluginEnabled(pluginId: string, enabled: boolean): Promise<any>;
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

  async queryPlugins(this: ApiContext) {
    return await this._request("/plugins/query", { method: "POST", data: {} });
  },

  async installPlugin(this: ApiContext, source: string) {
    return await this._request("/plugins/install", {
      method: "POST",
      data: { source },
    });
  },

  async getInstallLog(this: ApiContext, jobId: string) {
    return await this._request(`/plugins/install-log/${jobId}`);
  },

  async cancelInstall(this: ApiContext, jobId: string) {
    return await this._request(`/plugins/install-cancel/${jobId}`, { method: "POST" });
  },

  async uninstallPlugin(this: ApiContext, pluginId: string) {
    return await this._request(`/plugins/${pluginId}`, { method: "DELETE" });
  },

  async updatePlugin(this: ApiContext, pluginId: string) {
    return await this._request(`/plugins/${pluginId}/update`, { method: "POST" });
  },

  async setPluginEnabled(this: ApiContext, pluginId: string, enabled: boolean) {
    return await this._request("/plugins/global", {
      method: "PUT",
      data: { pluginId, enabled },
    });
  },
};