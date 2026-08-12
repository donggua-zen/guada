import {
  PluginManifest,
  ToolHandlerDef,
  ToolKitRegistration,
  TurnInterceptor,
  AttachmentTypeRegistration,
  UiPageRegistration,
} from "../types/plugin.types";
import { PluginBase } from "../base-plugin";
import type { WorkspaceProviderFactory } from "../../../common/workspace/workspace-provider.interface";

interface PluginRegistration {
  manifest: PluginManifest;
  tools: ToolHandlerDef[];
  toolKits: ToolKitRegistration[];
  prompts: Array<{
    methodName: string;
    frequency: string;
    type?: "system" | "user";
    toolSet?: string;
    description: string;
    handler: (context: any) => string | Promise<string>;
  }>;
  interceptors: TurnInterceptor[];
  workspaceProviders: WorkspaceProviderFactory[];
  attachmentTypes: AttachmentTypeRegistration[];
  uiPages: UiPageRegistration[];
  ctor?: new (...args: any[]) => PluginBase;
}

class PluginRegistryImpl {
  private registrations = new Map<string, PluginRegistration>();

  registerManifest(manifest: PluginManifest) {
    if (this.registrations.has(manifest.id)) return;
    this.registrations.set(manifest.id, { manifest, tools: [], toolKits: [], prompts: [], interceptors: [], workspaceProviders: [], attachmentTypes: [], uiPages: [] });
  }

  getTools(pluginId: string): ToolHandlerDef[] {
    return this.registrations.get(pluginId)?.tools || [];
  }

  /** 注册 ToolKit */
  registerToolKit(pluginId: string, reg: ToolKitRegistration) {
    const pReg = this.registrations.get(pluginId);
    if (!pReg) return;
    if (pReg.toolKits.find((x) => x.def.id === reg.def.id)) return;
    pReg.toolKits.push(reg);
  }

  /** 获取插件的所有 ToolKit 注册 */
  getToolKits(pluginId: string): ToolKitRegistration[] {
    return this.registrations.get(pluginId)?.toolKits || [];
  }

  /** 获取所有 ToolKit（所有插件） */
  getAllToolKits(): Array<{ pluginId: string; kit: ToolKitRegistration }> {
    const result: Array<{ pluginId: string; kit: ToolKitRegistration }> = [];
    for (const [pluginId, reg] of this.registrations) {
      for (const kit of reg.toolKits) {
        result.push({ pluginId, kit });
      }
    }
    return result;
  }

  getPromptMetas(pluginId: string) {
    const reg = this.registrations.get(pluginId);
    return { prompts: reg?.prompts || [] };
  }

  /** 注册回合拦截器 */
  registerInterceptor(pluginId: string, interceptor: TurnInterceptor) {
    const reg = this.registrations.get(pluginId);
    if (!reg) return;
    if (!reg.interceptors.find((x) => x.name === interceptor.name)) {
      reg.interceptors.push(interceptor);
    }
  }

  /** 获取插件的所有回合拦截器 */
  getInterceptors(pluginId: string): TurnInterceptor[] {
    return this.registrations.get(pluginId)?.interceptors || [];
  }

  /** 注册 WorkspaceProvider 工厂 */
  registerWorkspaceProvider(pluginId: string, factory: WorkspaceProviderFactory) {
    const reg = this.registrations.get(pluginId);
    if (!reg) return;
    if (!reg.workspaceProviders.find((f) => f.scheme === factory.scheme)) {
      reg.workspaceProviders.push(factory);
    }
  }

  /** 获取插件注册的所有 WorkspaceProvider 工厂 */
  getWorkspaceProviders(pluginId: string): WorkspaceProviderFactory[] {
    return this.registrations.get(pluginId)?.workspaceProviders || [];
  }

  /** 跨所有插件查找 scheme 对应的 WorkspaceProvider 工厂 */
  findWorkspaceProviderFactory(scheme: string): WorkspaceProviderFactory | undefined {
    for (const reg of this.registrations.values()) {
      const found = reg.workspaceProviders.find((f) => f.scheme === scheme);
      if (found) return found;
    }
    return undefined;
  }

  /** 注册附件类型 */
  registerAttachmentType(pluginId: string, reg: AttachmentTypeRegistration) {
    const pReg = this.registrations.get(pluginId);
    if (!pReg) return;
    if (!pReg.attachmentTypes.find((x) => x.id === reg.id)) {
      pReg.attachmentTypes.push(reg);
    }
  }

  /** 获取插件的附件类型 */
  getAttachmentTypes(pluginId: string): AttachmentTypeRegistration[] {
    return this.registrations.get(pluginId)?.attachmentTypes || [];
  }

  /** 获取所有插件的附件类型 */
  getAllAttachmentTypes(): Array<{ pluginId: string; reg: AttachmentTypeRegistration }> {
    const result: Array<{ pluginId: string; reg: AttachmentTypeRegistration }> = [];
    for (const [pluginId, reg] of this.registrations) {
      for (const att of reg.attachmentTypes) {
        result.push({ pluginId, reg: att });
      }
    }
    return result;
  }

  /** 注册 UI 页面 */
  registerUiPage(pluginId: string, reg: UiPageRegistration) {
    const pReg = this.registrations.get(pluginId);
    if (!pReg) return;
    if (!pReg.uiPages.find((x) => x.id === reg.id)) {
      pReg.uiPages.push(reg);
    }
  }

  /** 获取插件的 UI 页面 */
  getUiPages(pluginId: string): UiPageRegistration[] {
    return this.registrations.get(pluginId)?.uiPages || [];
  }

  /** 获取所有插件的 UI 页面 */
  getAllUiPages(): Array<{ pluginId: string; reg: UiPageRegistration }> {
    const result: Array<{ pluginId: string; reg: UiPageRegistration }> = [];
    for (const [pluginId, reg] of this.registrations) {
      for (const page of reg.uiPages) {
        result.push({ pluginId, reg: page });
      }
    }
    return result;
  }

  has(pluginId: string): boolean { return this.registrations.has(pluginId); }
  getAllIds(): string[] { return Array.from(this.registrations.keys()); }
  getAll(): PluginRegistration[] { return Array.from(this.registrations.values()); }

  setCtor(pluginId: string, ctor: new (...args: any[]) => PluginBase) {
    const reg = this.registrations.get(pluginId);
    if (reg) reg.ctor = ctor;
  }

  getCtor(pluginId: string): (new (...args: any[]) => PluginBase) | undefined {
    return this.registrations.get(pluginId)?.ctor;
  }

  getManifest(pluginId: string): PluginManifest | undefined {
    return this.registrations.get(pluginId)?.manifest;
  }

  /** 清除插件注册的所有数据（用于禁用插件时清理） */
  clearPlugin(pluginId: string): void {
    this.registrations.delete(pluginId);
  }

  /** 跨所有插件、所有 ToolKit 按名称查找工具定义（用于 display 降级恢复） */
  findToolByName(toolName: string): ToolHandlerDef | undefined {
    for (const [, reg] of this.registrations) {
      const found = reg.tools.find((t) => t.name === toolName);
      if (found) return found;
      for (const kit of reg.toolKits) {
        const kitFound = kit.tools.find((t) => t.name === toolName);
        if (kitFound) return kitFound;
      }
    }
    return undefined;
  }
}

export const PluginRegistry = new PluginRegistryImpl();
