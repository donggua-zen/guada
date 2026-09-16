import {
  PluginContext,
  ToolHandlerDef,
  ToolKitDef,
  ToolKitHandle,
  AttachmentTypeRegistration,
  UiPageRegistration,
  SlotRegistration,
  ThemeRegistration,
  RpcHandler,
} from "../types/plugin.types";
import { PluginRegistry } from "../registry/plugin-registry";
import { Toolkit } from "../toolkit/toolkit";
import { SkillRegistry } from "../../skills/core/skill-registry.service";
import { createHash } from "crypto";
import { z } from "zod";
import { ICommandProvider } from "../../commands/interfaces/command-provider.interface";
import type { WorkspaceProviderFactory } from "../../../common/workspace/workspace-provider.interface";
import type { ToolDisplay } from "../types/plugin.types";
import { NlsService } from "../i18n/nls.service";
import { SettingsStorage } from "../../../common/utils/settings-storage.util";

// ── PluginApi ──

export interface ImageContent {
  media_type: string;
  data: string; // base64, no data: prefix
}

export interface ToolResultObject {
  content: string;
  images?: ImageContent[];
  /**
   * UI 渲染元数据（仅前端消费，不进 LLM 上下文）。
   * card 标识结果卡片类型（terminal/diff/read/...），其余为该卡片的结构化字段。
   */
  meta?: Record<string, any>;
}

export type ToolResult = string | ToolResultObject | Record<string, any>;

export interface ToolExecCtx extends PluginContext {}

export interface PluginApi {
  /**
   * 注册工具（Zod 方式）：inputSchema 自动推导 execute 第一个参数类型 + 运行时校验
   */
  registerTool<Z extends z.ZodTypeAny>(def: {
    name: string;
    description: string;
    inputSchema: Z;
    toolSet?: string;
    execute: (
      args: z.output<Z>,
      ctx?: ToolExecCtx,
      signal?: AbortSignal,
    ) => ToolResult | Promise<ToolResult>;
      display?: ToolDisplay;
      dangerLevel?: "safe" | "info" | "normal" | "high" | "critical";
    }): void;

    /**
     * 注册工具（旧版 JSOM Schema 方式，仅 MCP 等动态工具使用）
     * @deprecated 使用 inputSchema 替代
     */
    registerTool(def: {
      name: string;
      description: string;
      parameters?: Record<string, any>;
      toolSet?: string;
      execute: (
        args: any,
        ctx?: ToolExecCtx,
        signal?: AbortSignal,
      ) => ToolResult | Promise<ToolResult>;
      display?: ToolDisplay;
    dangerLevel?: "safe" | "info" | "normal" | "high" | "critical";
  }): void;

  registerPrompt(def: {
    content: string | ((ctx: PluginContext) => string | Promise<string>);
    frequency?: "STATIC" | "REGULAR" | "VOLATILE";
    toolSet?: string;
    description?: string;
  }): void;

  registerRawTool(def: ToolHandlerDef): void;

  /**
   * 注册工具包（ToolKit）
   *
   * 支持两种用法：
   * 1. 回调方式：registerToolKit({ onLoad: (toolkit) => { toolkit.registerTool({...}) } })
   * 2. 返回值方式：const tk = registerToolKit({}); tk.registerTool({...})
   */
  registerToolKit(def: ToolKitDef): ToolKitHandle;

  /**
   * 注册命令提供者（斜杠命令 / 艾特命令）
   * 插件通过此接口注册后，前端即可通过 / 或 @ 触发该命令的补全列表。
   */
  registerCommandProvider(def: ICommandProvider): void;

  /**
   * 注册 WorkspaceProvider 工厂（旧接口，保留兼容）
   */
  registerWorkspaceProvider(factory: WorkspaceProviderFactory): void;

  /**
   * 注册连接类型（附加连接方案）
   *
   * 插件声明支持的连接类型（如 ssh、docker），前端设置页据此渲染表单。
   * configSchema 定义连接配置表单字段。
   */
  registerConnectionType(factory: WorkspaceProviderFactory): void;

  /**
   * 注册附件类型
   *
   * 插件声明一种可绑定到会话的附件类型（如 SSH 连接、知识库等）。
   * 前端 AttachmentPopover 据此动态渲染选择列表。
   * describe() 返回的文本会注入到 AI prompt 中。
   */
  registerAttachmentType(reg: import("../types/plugin.types").AttachmentTypeRegistration): void;

  /**
   * 注册 UI 页面
   *
   * 插件声明一个自定义页面，渲染到指定区域（如设置页）。
   * 前端通过 PluginSlot 加载插件 frontend/ 目录下的组件。
   */
  registerUiPage(reg: import("../types/plugin.types").UiPageRegistration): void;

  /**
   * 注册前端 slot（插件 UI 能力声明）
   */
  registerSlot(reg: import("../types/plugin.types").SlotRegistration): void;

  /**
   * 注册主题（插件主题能力声明）
   *
   * CSS 文件放插件 frontend/dist/ 下，通过 assets 端点静态服务；
   * 前端下拉列表与启动应用均以本声明为准。
   */
  registerTheme(reg: import("../types/plugin.types").ThemeRegistration): void;

  /**
   * 注册技能（第三方插件注册技能，内嵌正文，无需文件/复制）
   */
  registerSkill(input: {
    name: string;
    description: string;
    content: string;
    version?: string;
    dependencies?: string[];
    author?: string;
    tags?: string[];
    resourceBase?: { kind: "directory" | "url" | "opaque"; path?: string; url?: string; description?: string };
  }): void;

  /**
   * 注册 RPC 方法（插件 UI 通过 pluginApi.call 调用）
   */
  registerRpc(methods: Record<string, import("../types/plugin.types").RpcHandler>): void;

  /**
   * 注册语言包（NLS）
   *
   * 每个插件注册自己的 key→string 字典，插件间隔离。
   * display 字段中的 "%key%" 引用会在返回前端前就地解析。
   *
   * @param locale 语言代码（如 "zh"、"en"）
   * @param messages 扁平 key→string 字典
   */
  registerNls(locale: string, messages: Record<string, string>): void;

  // ── PluginDataApi: 插件数据自治 ──

  /** 读取插件所有数据 */
  getData(): Promise<Record<string, any>>;
  /** 读取单个 key */
  getValue<T>(key: string, defaultValue?: T): Promise<T>;
  /** 写入单个 key */
  setValue(key: string, value: any): Promise<void>;
  /** 删除单个 key */
  deleteValue(key: string): Promise<void>;
}

// ── PluginApi 实现 ──

export class PluginApiImpl implements PluginApi {
  private _toolDefs: ToolHandlerDef[] = [];
  private _toolKits: Toolkit[] = [];
  private _promptMetas: Array<{
    methodName: string;
    frequency: string;
    toolSet?: string;
    description: string;
    handler: (context: any) => string | Promise<string>;
  }> = [];
  private _commandProviders: ICommandProvider[] = [];
  private _workspaceProviders: WorkspaceProviderFactory[] = [];

  constructor(
    private pluginId: string,
    private pluginName: string,
    private nlsService?: NlsService,
    private settingsStorage?: SettingsStorage,
    /** 插件来源；非 builtin 的外部插件不得自封 governance（见 registerToolKit） */
    private pluginSource?: "builtin" | "dev" | "user",
  ) {}

  registerTool(def: any): void {
    if (def.inputSchema) {
      // Zod 方式：从 Zod schema 生成 JSON Schema（Zod v4 原生 z.toJSONSchema）
      const zodSchema = def.inputSchema as any;
      const rawJson = z.toJSONSchema(zodSchema) as any;

      // 提取 required、properties（兼容不同输出格式）
      const root =
        rawJson.type === "object"
          ? rawJson
          : rawJson.$defs?.[Object.keys(rawJson.$defs || {})[0]] || rawJson;
      const required: string[] = root.required || [];
      const properties: Record<string, any> = {};
      const rawProps = root.properties || {};
      for (const [key, val] of Object.entries(rawProps)) {
        const p = val as any;
        const clean: Record<string, any> = {
          type: p.type || "string",
          description: p.description || key,
        };
        if (p.enum) clean.enum = p.enum;
        if (p.default !== undefined) clean.default = p.default;
        properties[key] = clean;
      }

      const argsKey =
        def.display?.argsKey ??
        Object.keys(properties).find((k) => properties[k]?.type === "string");

      const entry: ToolHandlerDef = {
        name: def.name,
        description: def.description,
        parameters: {
          type: "object",
          properties,
          required: required.length > 0 ? required : undefined,
        },
        _zodSchema: zodSchema,
        handler: async (args, ctx, signal) => {
          const parsed = zodSchema.parse(args);
          return def.execute(parsed, ctx, signal);
        },
        dangerLevel: def.dangerLevel,
        toolSet: def.toolSet,
        icon: def.display?.icon,
        actionType: def.display?.actionType,
        argsKey,
        displayText: def.display?.text,
        displayAggregate: def.display?.aggregate,
        displayRenderer: def.display?.renderer,
      };

      if (!this._toolDefs.find((x) => x.name === entry.name)) {
        this._toolDefs.push(entry);
      }
      return;
    }

    // 旧方式：parameters 手写 JSON Schema 或从 execute toString 推断
    const schema = def.parameters
      ? {
          type: "object" as const,
          properties: def.parameters,
          required:
            Object.entries(def.parameters)
              .filter(([_, v]) => (v as any).required !== false)
              .map(([k]) => k)
              .filter((k) => k.length > 0) || undefined,
        }
      : {
          type: "object" as const,
          properties: {} as Record<string, any>,
        };

    const argsKey =
      def.display?.argsKey ||
      (() => {
        const fnStr = def.execute.toString();
        const match = fnStr.match(/async\s*\(\s*\{\s*(\w+)/);
        return match?.[1];
      })();

    const entry: ToolHandlerDef = {
      name: def.name,
      description: def.description,
      parameters: schema,
      handler: (args: any, ctx?: PluginContext, signal?: AbortSignal) => {
        return def.execute(args, ctx, signal);
      },
      dangerLevel: def.dangerLevel,
      toolSet: def.toolSet,
      icon: def.display?.icon,
      actionType: def.display?.actionType,
      argsKey,
      displayText: def.display?.text,
      displayAggregate: def.display?.aggregate,
      displayRenderer: def.display?.renderer,
    };

    if (!this._toolDefs.find((x) => x.name === entry.name)) {
      this._toolDefs.push(entry);
    }
  }

  registerPrompt(def: {
    content: string | ((ctx: PluginContext) => string | Promise<string>);
    frequency?: "STATIC" | "REGULAR" | "VOLATILE";
    toolSet?: string;
    description?: string;
  }): void {
    const meta = {
      methodName: "",
      frequency: def.frequency || "REGULAR",
      toolSet: def.toolSet,
      description: def.description || "",
      handler: (typeof def.content === "function"
        ? def.content
        : () => def.content) as (ctx: any) => string | Promise<string>,
    };
    this._promptMetas.push(meta);
  }

  registerRawTool(def: ToolHandlerDef): void {
    if (!this._toolDefs.find((x) => x.name === def.name)) {
      this._toolDefs.push(def);
    }
  }

  registerToolKit(def: ToolKitDef): ToolKitHandle {
    // 自治理会使其工具包逃逸角色层治理，因此只允许内建插件声明。
    // 外部插件（dev/user）的 manifest 由插件自己提供，不能据此自封。
    const safeDef: ToolKitDef =
      this.pluginSource && this.pluginSource !== "builtin"
        ? { ...def, governance: undefined }
        : def;
    const toolkit = new Toolkit(safeDef, this.pluginId);
    if (!this._toolKits.find((x) => x.id === toolkit.id)) {
      this._toolKits.push(toolkit);
    }
    return toolkit;
  }

  registerCommandProvider(def: ICommandProvider): void {
    if (!this._commandProviders.find((x) => x.id === def.id)) {
      this._commandProviders.push(def);
    }
  }

  registerWorkspaceProvider(factory: WorkspaceProviderFactory): void {
    if (!this._workspaceProviders.find((f) => f.scheme === factory.scheme)) {
      this._workspaceProviders.push(factory);
    }
  }

  registerConnectionType(factory: WorkspaceProviderFactory): void {
    // Same as registerWorkspaceProvider — connection types are stored in the same registry
    // and surfaced via GET /workspace/providers for the settings page
    if (!this._workspaceProviders.find((f) => f.scheme === factory.scheme)) {
      this._workspaceProviders.push(factory);
    }
  }

  private _attachmentTypes: AttachmentTypeRegistration[] = [];
  private _uiPages: UiPageRegistration[] = [];
  private _slots: SlotRegistration[] = [];
  private _themes: ThemeRegistration[] = [];
  private _rpcHandlers: Record<string, RpcHandler> = {};

  registerAttachmentType(reg: AttachmentTypeRegistration): void {
    if (!this._attachmentTypes.find((x) => x.id === reg.id)) {
      this._attachmentTypes.push(reg);
    }
  }

  registerUiPage(reg: UiPageRegistration): void {
    if (!this._uiPages.find((x) => x.id === reg.id)) {
      this._uiPages.push(reg);
    }
  }
  registerSlot(reg: SlotRegistration): void {
    if (!this._slots.find((x) => x.name === reg.name && x.component === reg.component)) {
      this._slots.push(reg);
    }
  }
  registerTheme(reg: ThemeRegistration): void {
    if (!this._themes.find((x) => x.id === reg.id)) {
      this._themes.push(reg);
    }
  }

  /**
   * 注册技能（第三方插件）：构造 SkillDefinition（内嵌 content）并注入技能注册表。
   */
  registerSkill(input: {
    name: string;
    description: string;
    content: string;
    version?: string;
    dependencies?: string[];
    author?: string;
    tags?: string[];
    resourceBase?: { kind: "directory" | "url" | "opaque"; path?: string; url?: string; description?: string };
  }): void {
    const registry = SkillRegistry.getInstance();
    if (!registry) {
      console.warn(`[plugin:${this.pluginId}] SkillRegistry not ready, cannot register skill: ${input.name}`);
      return;
    }
    const rb = input.resourceBase;
    registry.register({
      id: input.name.toLowerCase(),
      baseDir: "",
      basePath: "__plugin__",
      manifest: {
        name: input.name.toLowerCase(),
        description: input.description,
        ...(input.version ? { version: input.version } : {}),
        ...(input.dependencies ? { dependencies: input.dependencies } : {}),
        ...(input.author ? { author: input.author } : {}),
        ...(input.tags ? { tags: input.tags } : {}),
      },
      contentHash: createHash("sha256").update(input.content).digest("hex"),
      content: input.content,
      source: "system",
      enabled: true,
      provider: `plugin:${this.pluginId}`,
      ...(rb
        ? {
            resourceBase:
              rb.kind === "directory" ? { kind: "directory", path: rb.path } :
              rb.kind === "url" ? { kind: "url", url: rb.url } :
              { kind: "opaque", description: rb.description },
          }
        : {}),
    });
    console.log(`[plugin:${this.pluginId}] registered skill: ${input.name}`);
  }

  registerRpc(methods: Record<string, RpcHandler>): void {
    Object.assign(this._rpcHandlers, methods);
  }

  /** 获取附件类型（供 PluginManager 消费） */
  getAttachmentTypes(): AttachmentTypeRegistration[] {
    return this._attachmentTypes;
  }

  /** 获取 UI 页面（供 PluginManager 消费） */
  getUiPages(): UiPageRegistration[] {
    return this._uiPages;
  }
  /** 获取插件声明的 slots（供 PluginManager 消费） */
  getSlots(): SlotRegistration[] {
    return this._slots;
  }

  /** 获取插件声明的 RPC handlers（供 PluginManager 消费） */
  getRpcHandlers(): Record<string, RpcHandler> {
    return this._rpcHandlers;
  }

  registerNls(locale: string, messages: Record<string, string>): void {
    this.nlsService?.registerBundle(this.pluginId, locale, messages);
  }

  // ── PluginDataApi 实现 ──

  private get dataGroup(): string {
    return `plugin:${this.pluginId}`;
  }

  async getData(): Promise<Record<string, any>> {
    if (!this.settingsStorage) return {};
    return this.settingsStorage.getSettings(this.dataGroup);
  }

  async getValue<T>(key: string, defaultValue?: T): Promise<T> {
    if (!this.settingsStorage) return defaultValue as T;
    return this.settingsStorage.getSettingValue(
      this.dataGroup,
      key,
      defaultValue,
    );
  }

  async setValue(key: string, value: any): Promise<void> {
    if (!this.settingsStorage) return;
    await this.settingsStorage.updateSettings(this.dataGroup, {
      [key]: value,
    });
  }

  async deleteValue(key: string): Promise<void> {
    if (!this.settingsStorage) return;
    await this.settingsStorage.deleteSettingValue(this.dataGroup, key);
  }

  /** 注册到 PluginRegistry */
  flush(): void {
    // 注册 manifest
    if (!PluginRegistry.has(this.pluginId)) {
      PluginRegistry.registerManifest({
        id: this.pluginId,
        name: this.pluginName,
        description: "",
        version: "1.0.0",
        category: "core",
      });
    }

    // 注册 tools（顶层）
    const reg = (PluginRegistry as any).registrations.get(this.pluginId);
    if (reg) {
      for (const td of this._toolDefs) {
        if (!reg.tools.find((x: any) => x.name === td.name)) {
          reg.tools.push(td);
        }
      }
    }

    // 注册 ToolKits
    for (const tk of this._toolKits) {
      PluginRegistry.registerToolKit(this.pluginId, tk.toRegistration());
    }

    // 注册 prompts
    if (reg) {
      for (const pm of this._promptMetas) {
        if (!reg.prompts.find((x) => x.description === pm.description)) {
          reg.prompts.push(pm);
        }
      }
    }

    // 注册 workspace providers
    for (const factory of this._workspaceProviders) {
      PluginRegistry.registerWorkspaceProvider(this.pluginId, factory);
    }

    // 注册 attachment types
    for (const att of this._attachmentTypes) {
      PluginRegistry.registerAttachmentType(this.pluginId, att);
    }

    // 注册 slots
    for (const slot of this._slots) {
      PluginRegistry.registerSlot(this.pluginId, slot);
    }

    // 注册 themes
    for (const theme of this._themes) {
      PluginRegistry.registerTheme(this.pluginId, theme);
    }

    // 注册 rpc handlers
    PluginRegistry.registerRpc(this.pluginId, this._rpcHandlers);

    // 注册 ui pages
    for (const page of this._uiPages) {
      PluginRegistry.registerUiPage(this.pluginId, page);
    }
  }

  /** 获取命令提供者 供 PluginManager 消费 */
  getCommandProviders(): ICommandProvider[] {
    return this._commandProviders;
  }

  /** 获取 WorkspaceProvider 工厂 供 PluginManager 消费 */
  getWorkspaceProviders(): WorkspaceProviderFactory[] {
    return this._workspaceProviders;
  }
}
