import {
  PluginManifest,
  ToolHandlerDef,
  ToolKitRegistration,
  AttachmentTypeRegistration,
  UiPageRegistration,
  SlotRegistration,
  ThemeRegistration,
  RpcHandler,
  PromptSectionDef,
  PromptTransformDef,
  SkinRegistration,
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
    toolSet?: string;
    description: string;
    handler: (context: any) => string | Promise<string>;
  }>;
  workspaceProviders: WorkspaceProviderFactory[];
  attachmentTypes: AttachmentTypeRegistration[];
  uiPages: UiPageRegistration[];
  slots: SlotRegistration[];
  themes: ThemeRegistration[];
  /** v2.2：皮肤注册（v3 起并入 themes，保留字段仅为类型兼容） */
  skins: SkinRegistration[];
  /** v2：命名提示词段 */
  promptSections: PromptSectionDef[];
  /** v2：装配后变换 */
  promptTransforms: PromptTransformDef[];
  rpcHandlers: Record<string, RpcHandler>;
  ctor?: new (...args: any[]) => PluginBase;
}

class PluginRegistryImpl {
  private registrations = new Map<string, PluginRegistration>();

  registerManifest(manifest: PluginManifest) {
    if (this.registrations.has(manifest.id)) return;
    this.registrations.set(manifest.id, { manifest, tools: [], toolKits: [], prompts: [], workspaceProviders: [], attachmentTypes: [], uiPages: [], slots: [], themes: [], skins: [], promptSections: [], promptTransforms: [], rpcHandlers: {} });
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

  /** v2：注册命名提示词段（同插件同名同作用域幂等） */
  registerPromptSection(pluginId: string, reg: PromptSectionDef) {
    const pReg = this.registrations.get(pluginId);
    if (!pReg) return;
    const scope = reg.scope || "global";
    const dup = pReg.promptSections.find(
      (x) => x.name === reg.name && (x.scope || "global") === scope,
    );
    if (dup) return;
    pReg.promptSections.push({ ...reg, scope });
  }

  /** v2：获取插件的提示词段 */
  getPromptSections(pluginId: string): PromptSectionDef[] {
    return this.registrations.get(pluginId)?.promptSections || [];
  }

  /** v2：注册装配后变换（同插件同 id 幂等） */
  registerPromptTransform(pluginId: string, reg: PromptTransformDef) {
    const pReg = this.registrations.get(pluginId);
    if (!pReg) return;
    if (pReg.promptTransforms.find((x) => x.id === reg.id)) return;
    pReg.promptTransforms.push(reg);
  }

  /** v2：获取插件的装配变换 */
  getPromptTransforms(pluginId: string): PromptTransformDef[] {
    return this.registrations.get(pluginId)?.promptTransforms || [];
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
  /** 注册 slot */
  registerSlot(pluginId: string, reg: SlotRegistration) {
    const pReg = this.registrations.get(pluginId);
    if (!pReg) return;
    if (!pReg.slots.find((x) => x.name === reg.name && x.component === reg.component)) {
      pReg.slots.push(reg);
    }
  }

  /** 获取插件的所有 slot */
  getSlots(pluginId: string): SlotRegistration[] {
    return this.registrations.get(pluginId)?.slots || [];
  }

  /** 获取所有插件的 slot */
  getAllSlots(): Array<{ pluginId: string; reg: SlotRegistration }> {
    const result: Array<{ pluginId: string; reg: SlotRegistration }> = [];
    for (const [pluginId, reg] of this.registrations) {
      for (const slot of reg.slots) result.push({ pluginId, reg: slot });
    }
    return result;
  }

  /** 注册主题（插件扩展点，幂等：同插件同 id 不重复追加） */
  registerTheme(pluginId: string, reg: ThemeRegistration) {
    const pReg = this.registrations.get(pluginId);
    if (!pReg) return;
    if (!pReg.themes.find((x) => x.id === reg.id)) {
      pReg.themes.push(reg);
    }
  }

  /** 获取插件的所有主题 */
  getThemes(pluginId: string): ThemeRegistration[] {
    return this.registrations.get(pluginId)?.themes || [];
  }

  /** 获取所有插件的主题 */
  getAllThemes(): Array<{ pluginId: string; reg: ThemeRegistration }> {
    const result: Array<{ pluginId: string; reg: ThemeRegistration }> = [];
    for (const [pluginId, reg] of this.registrations) {
      for (const theme of reg.themes) result.push({ pluginId, reg: theme });
    }
    return result;
  }

  // ── 皮肤（v2.2；v3 起并入主题） ──

  /**
   * @deprecated v3 起主题与皮肤统一：等价于 registerTheme。
   */
  registerSkin(pluginId: string, reg: SkinRegistration) {
    this.registerTheme(pluginId, reg);
  }

  /**
   * 获取插件的「富主题」（带 runtimeScript 或 assetBase）。
   * 兼容 v2.2 的 getSkins 语义；新代码请直接用 getThemes。
   */
  getSkins(pluginId: string): SkinRegistration[] {
    return this.getThemes(pluginId).filter(
      (theme) => theme.runtimeScript || theme.assetBase,
    );
  }

  /**
   * 获取所有插件的「富主题」（跨插件互斥由前端保证）
   */
  getAllSkins(): Array<{ pluginId: string; reg: SkinRegistration }> {
    return this.getAllThemes().filter(({ reg }) => reg.runtimeScript || reg.assetBase);
  }

  /** 注册 RPC handler */
  registerRpc(pluginId: string, methods: Record<string, RpcHandler>) {
    const pReg = this.registrations.get(pluginId);
    if (!pReg) return;
    Object.assign(pReg.rpcHandlers, methods);
  }

  /** 获取 RPC handler */
  getRpcHandler(pluginId: string, method: string): RpcHandler | undefined {
    return this.registrations.get(pluginId)?.rpcHandlers?.[method];
  }

  /** 枚举插件注册的 RPC 方法名（详情/诊断用，不返回 handler） */
  getRpcMethods(pluginId: string): string[] {
    const handlers = this.registrations.get(pluginId)?.rpcHandlers;
    return handlers ? Object.keys(handlers) : [];
  }
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
