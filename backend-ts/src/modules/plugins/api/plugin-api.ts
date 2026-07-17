import {
  PluginContext,
  ToolHandlerDef,
  PromptPiece,
  ToolLoadMode,
  ToolSetRuntime,
  ToolKitDef,
  ToolKitHandle,
  ToolKitRegistration,
} from "../types/plugin.types";
import { PluginRegistry } from "../registry/plugin-registry";
import { Toolkit } from "../toolkit/toolkit";
import { z } from "zod";
import { ICommandProvider } from "../../commands/interfaces/command-provider.interface";

// ── PluginApi ──

export type ToolResult = string | Record<string, any>;

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
    display?: {
      





























































































































































































































































































































































































































































































      action?: string;
      argsKey?: string;
      icon?: string;
    };
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
    display?: {
      action?: string;
      argsKey?: string;
      icon?: string;
    };
    dangerLevel?: "safe" | "info" | "normal" | "high" | "critical";
  }): void;

  registerToolSet(def: {
    name: string;
    loadMode?: ToolLoadMode;
    activator?: string;
    handler?: (ctx: PluginContext) => ToolSetRuntime | Promise<ToolSetRuntime>;
  }): void;

  registerPrompt(def: {
    content: string | ((ctx: PluginContext) => string | Promise<string>);
    frequency?: "STATIC" | "REGULAR" | "VOLATILE";
    type?: "system" | "user";
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
}

// ── PluginApi 实现 ──

export class PluginApiImpl implements PluginApi {
  private _toolDefs: ToolHandlerDef[] = [];
  private _toolKits: Toolkit[] = [];
  private _promptMetas: Array<{
    methodName: string;
    frequency: string;
    type?: "system" | "user";
    toolSet?: string;
    description: string;
    handler: (context: any) => string | Promise<string>;
  }> = [];
  private _commandProviders: ICommandProvider[] = [];

  constructor(
    private pluginId: string,
    private pluginName: string,
  ) {}

  registerToolSet(def: {
    name: string;
    loadMode?: ToolLoadMode;
    activator?: string;
    handler?: (ctx: PluginContext) => ToolSetRuntime | Promise<ToolSetRuntime>;
  }): void {
    throw new Error(
      "registerToolSet 已废弃，请使用 registerToolKit 替代。插件: " + this.pluginId,
    );
  }

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
        action: def.display?.action,
        argsKey,
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
      action: def.display?.action,
      argsKey,
    };

    if (!this._toolDefs.find((x) => x.name === entry.name)) {
      this._toolDefs.push(entry);
    }
  }

  registerPrompt(def: {
    content: string | ((ctx: PluginContext) => string | Promise<string>);
    frequency?: "STATIC" | "REGULAR" | "VOLATILE";
    type?: "system" | "user";
    toolSet?: string;
    description?: string;
  }): void {
    const meta = {
      methodName: "",
      frequency: def.frequency || "REGULAR",
      type: def.type,
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
    const toolkit = new Toolkit(def, this.pluginId);
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
        if (!reg.prompts.find((x: any) => x.description === pm.description)) {
          reg.prompts.push(pm);
        }
      }
    }
  }

  /** 获取 prompts 供 PluginManager 消费 */
  getPrompts(): Array<{
    frequency: string;
    description: string;
    handler: (ctx: any) => string | Promise<string>;
  }> {
    return this._promptMetas;
  }

  /** 获取命令提供者 供 PluginManager 消费 */
  getCommandProviders(): ICommandProvider[] {
    return this._commandProviders;
  }
}
