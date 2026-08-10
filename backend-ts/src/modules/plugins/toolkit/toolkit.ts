import { z } from "zod";
import {
  ToolKitDef,
  ToolKitHandle,
  ToolKitRegistration,
  ToolHandlerDef,
  ToolDisplay,
  PluginContext,
} from "../types/plugin.types";

/**
 * ToolKit 实现 —— 工具包容器
 *
 * 每个 ToolKit 实例独立管理自己的工具和提示词注册，
 * 通过 registerToolKit() 创建后由插件持有。
 */
export class Toolkit implements ToolKitHandle {
  readonly id: string;
  readonly name: string;

  /** 内部存储 */
  private _tools: ToolHandlerDef[] = [];
  private _prompts: Array<{
    frequency: string;
    description: string;
    handler: (ctx: any) => string | Promise<string>;
  }> = [];

  constructor(
    public readonly def: ToolKitDef,
    private pluginId: string,
  ) {
    this.id = def.id;
    this.name = def.name || def.id;
  }

  // ── ToolKitHandle 接口实现 ──

  registerTool<Z extends z.ZodTypeAny>(def: {
    name: string;
    description: string;
    inputSchema: Z;
    execute: (
      args: z.output<Z>,
      ctx?: PluginContext,
      signal?: AbortSignal,
    ) => string | Record<string, any> | Promise<string | Record<string, any>>;
    





























































    display?: ToolDisplay;
    dangerLevel?: "safe" | "info" | "normal" | "high" | "critical";
  }): void {
    const zodSchema = def.inputSchema as any;
    const rawJson = z.toJSONSchema(zodSchema) as any;

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
        const result = await def.execute(parsed, ctx, signal);
        // Pass through ToolResultObject { content, images } as-is;
        // ToolExecutor.executeTool handles the split.
        // Legacy plain objects are stringified here for backward compat.
        if (typeof result === 'object' && result !== null) {
          const obj = result as Record<string, any>;
          if (typeof obj['content'] === 'string') {
            return result; // ToolResultObject — let ToolExecutor handle
          }
          return JSON.stringify(result);
        }
        return String(result ?? '');
      },
      dangerLevel: def.dangerLevel,
      toolSet: this.id,
      icon: def.display?.icon,
      actionType: def.display?.actionType,
      argsKey,
      displayText: def.display?.text,
      displayAggregate: def.display?.aggregate,
    };

    if (!this._tools.find((x) => x.name === entry.name)) {
      this._tools.push(entry);
    }
  }

  registerRawTool(def: ToolHandlerDef): void {
    const entry = { ...def, toolSet: def.toolSet || this.id };
    if (!this._tools.find((x) => x.name === entry.name)) {
      this._tools.push(entry);
    }
  }

  registerPrompt(def: {
    content: string | ((ctx: PluginContext) => string | Promise<string>);
    frequency?: "STATIC" | "REGULAR" | "VOLATILE";
    description?: string;
  }): void {
    this._prompts.push({
      frequency: def.frequency || "REGULAR",
      description: def.description || "",
      handler: (
        typeof def.content === "function"
          ? def.content
          : () => def.content
      ) as (ctx: any) => string | Promise<string>,
    });
  }

  // ── 内部方法（供 PluginApiImpl 使用） ──

  /** 获取注册的工具列表 */
  getTools(): ToolHandlerDef[] {
    return this._tools;
  }

  /** 获取注册的提示词列表 */
  getPrompts(): Array<{
    frequency: string;
    description: string;
    handler: (ctx: any) => string | Promise<string>;
  }> {
    return this._prompts;
  }

  /** 导出为注册存储结构 */
  toRegistration(): ToolKitRegistration {
    return {
      def: this.def,
      tools: [...this._tools],
      prompts: [...this._prompts],
    };
  }
}
