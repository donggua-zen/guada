import {
  PluginContext,
  ToolHandlerDef,
  PromptPiece,
  ToolLoadMode,
  ToolSetRuntime,
} from "../types/plugin.types";
import { PluginRegistry } from "../registry/plugin-registry";
import { z } from "zod";

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
    dangerLevel?: "info" | "normal" | "high" | "critical";
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
    dangerLevel?: "info" | "normal" | "high" | "critical";
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
    toolSet?: string;
    description?: string;
  }): void;

  registerRawTool(def: ToolHandlerDef): void;
}

// ── PluginApi 实现 ──

export class PluginApiImpl implements PluginApi {
  private _toolSets: Array<{
    name: string;
    loadMode: ToolLoadMode;
    activator?: string;
    handler?: (
      ctx: PluginContext,
    ) => ToolSetRuntime | Promise<ToolSetRuntime>;
  }> = [];
  private _toolDefs: ToolHandlerDef[] = [];
  private _promptMetas: Array<{
    methodName: string;
    frequency: string;
    toolSet?: string;
    description: string;
    handler: (context: any) => string | Promise<string>;
  }> = [];

  constructor(
    private pluginId: string,
    private pluginName: string,
  ) {}

  registerToolSet(def: {
    name: string;
    loadMode?: ToolLoadMode;
    activator?: string;
    handler?: (
      ctx: PluginContext,
    ) => ToolSetRuntime | Promise<ToolSetRuntime>;
  }): void {
    const entry = {
      name: def.name,
      loadMode: def.loadMode || "lazy",
      activator: def.activator,
      handler: def.handler,
    };
    if (!this._toolSets.find((x) => x.name === entry.name)) {
      this._toolSets.push(entry);
    }
  }

  registerTool(def: any): void {
    if (def.inputSchema) {
      // Zod 方式：从 Zod schema 生成 JSON Schema（Zod v4 原生 z.toJSONSchema）
      const zodSchema = def.inputSchema as any;
      const rawJson = z.toJSONSchema(zodSchema) as any;

      // 提取 required、properties（兼容不同输出格式）
      const root = rawJson.type === "object" ? rawJson : rawJson.$defs?.[Object.keys(rawJson.$defs || {})[0]] || rawJson;
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

      const argsKey = def.display?.argsKey ?? Object.keys(properties).find(k => properties[k]?.type === "string");

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

    // 注册 toolSets
    for (const ts of this._toolSets) {
      PluginRegistry.registerToolSet(this.pluginId, {
        id: ts.name,
        name: ts.name,
        tools: this._toolDefs
          .filter((t) => t.toolSet === ts.name)
          .map((t) => t.name),
        loadMode: ts.loadMode,
        activator: ts.activator,
        handler: ts.handler,
      });
    }

    // 注册 tools
    const reg = (PluginRegistry as any).registrations.get(this.pluginId);
    if (reg) {
      for (const td of this._toolDefs) {
        if (!reg.tools.find((x: any) => x.name === td.name)) {
          reg.tools.push(td);
        }
      }
    }

    // 注册 prompts
    if (reg) {
      for (const pm of this._promptMetas) {
        if (
          !reg.prompts.find((x: any) => x.description === pm.description)
        ) {
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
}
