import {
  PluginManifest,
  ToolHandlerDef,
  ToolKitRegistration,
} from "../types/plugin.types";
import { PluginBase } from "../base-plugin";

interface PluginRegistration {
  manifest: PluginManifest;
  tools: ToolHandlerDef[];
  toolKits: ToolKitRegistration[];
  prompts: Array<{
    methodName: string;
    frequency: string;
    toolSet?: string;
    description: string;
    handler: (context: any) => string | Promise<string>;
  }>;
  ctor?: new (...args: any[]) => PluginBase;
}

class PluginRegistryImpl {
  private registrations = new Map<string, PluginRegistration>();

  registerManifest(manifest: PluginManifest) {
    if (this.registrations.has(manifest.id)) return;
    this.registrations.set(manifest.id, { manifest, tools: [], toolKits: [], prompts: [] });
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
}

export const PluginRegistry = new PluginRegistryImpl();
