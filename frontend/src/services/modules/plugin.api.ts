import type { ApiContext } from "./api-context";
import type { GuaDaSharedRuntime } from "@/types/plugin-runtime";

/** /plugins/slots 的条目（与 stores/pluginSlots 的 SlotItem 同构） */
export interface PluginSlotItem {
  pluginId: string
  /** 组件标识：'builtin:<key>' 走内置 import map，其余按插件产物文件名解析 */
  component: string
  order: number
  mode?: string
  props?: Record<string, any>
  meta?: Record<string, any>
}

export interface ConfigField {
  key: string;
  label: string;
  type: "text" | "password" | "number" | "select" | "textarea";
  required?: boolean;
  /** 缺省值（插件自定义，形状随字段类型变化） */
  default?: unknown;
  placeholder?: string;
  showIf?: { field: string; equals: unknown };
  options?: { label: string; value: unknown }[];
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

/** 插件主题清单条目（/plugins/slots 的 themes[]，由插件 frontend/dist 下发） */
export interface PluginThemeManifest {
  id: string;
  name: string;
  primaryColor: string;
  secondaryColor: string;
  mode?: "light" | "dark" | "all";
  pluginId: string;
  /** CSS 文件名，相对插件 frontend/dist */
  cssFile: string;
  /** 资源版本号，拼静态资源 URL 用 */
  rev?: string;
}

export interface PluginApi {
  getAttachmentTypes(): Promise<AttachmentTypeInfo[]>;
  getPluginAttachments(pluginId: string): Promise<PluginAttachmentList[]>;
  getPluginUiPages(area?: string): Promise<UiPageInfo[]>;
  /** 获取所有插件的 slot 注册清单（v2 插件 UI）与插件主题清单 */
  getPluginSlots(): Promise<{ slots: Record<string, PluginSlotItem[]>; themes?: PluginThemeManifest[] }>;
  /** 调用插件后端 RPC 方法（args/返回值形状由插件自定义） */
  call(pluginId: string, method: string, args?: unknown): Promise<unknown>;
  /** 获取共享运行时上下文（用户/会话等基础信息，形状 = plugin-runtime.d.ts 的共享 reactive） */
  getSharedContext(): Promise<{
    user: GuaDaSharedRuntime['user'];
    session: GuaDaSharedRuntime['session'];
  }>;
  /** 插件键值存储（值形状由插件自定义，动态结构） */
  getPluginData(pluginId: string): Promise<Record<string, any>>;
  setPluginData(pluginId: string, key: string, value: unknown): Promise<{ success: boolean }>;
  deletePluginData(pluginId: string, key: string): Promise<{ success: boolean }>;
  /**
   * ⚠️ 已注释：与 settings.api.ts 的同名方法重复（同一端点 POST /plugins/query）。
   * ApiService.ts:326 的 Object.assign 里 pluginApi 排在 settingsApi 之后，
   * 本版本会覆盖 settings.api.ts 的带参版本（config?, lang?），
   * 导致 AgentSettingPanel / LocalTools / SearchSettings 共 4 个调用点传入的
   * config（智能体层工具包过滤）与 lang（NLS 本地化）被静默丢弃。
   * 此处让位给 settings.api.ts 的实现；测试通过后再删除本段。
   */
  // queryPlugins(): Promise<{ plugins: any[] }>;
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
  setPluginEnabled(pluginId: string, enabled: boolean): Promise<{ success: boolean }>;
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
    return await this._request<{ slots: Record<string, PluginSlotItem[]>; themes?: PluginThemeManifest[] }>("/plugins/slots");
  },

  async call(this: ApiContext, pluginId: string, method: string, args?: unknown) {
    const sessionId = window.__GuaDaShared__?.runtime?.session?.id;
    const workspaceId = window.__GuaDaShared__?.runtime?.session?.workspaceId;
    return await this._request<unknown>(`/plugins/${pluginId}/rpc/${method}`, {
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
    return await this._request<Record<string, any>>(`/plugins/${pluginId}/data`);
  },

  async setPluginData(this: ApiContext, pluginId: string, key: string, value: unknown) {
    return await this._request<{ success: boolean }>(`/plugins/${pluginId}/data/${key}`, {
      method: "PUT",
      data: { value },
    });
  },

  async deletePluginData(this: ApiContext, pluginId: string, key: string) {
    return await this._request(`/plugins/${pluginId}/data/${key}`, {
      method: "DELETE",
    });
  },

  // ⚠️ 已注释：重复实现，与接口声明同步停用（原因见 PluginApi.queryPlugins 上方说明）。
  // 实际生效的是 settings.api.ts 的 queryPlugins(config?, lang?)。测试通过后再删除本段。
  // async queryPlugins(this: ApiContext) {
  //   return await this._request("/plugins/query", { method: "POST", data: {} });
  // },

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
    return await this._request<{ success: boolean }>("/plugins/global", {
      method: "PUT",
      data: { pluginId, enabled },
    });
  },
};