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
 * 嵌套 schema 的保留深度上限。
 *
 * 此前工具参数经 z.toJSONSchema 后被"展平"成只留顶层 type/description 的扁平表，
 * **嵌套的 items/properties 全部丢失**——模型看不到数组元素与子对象的形状，只能靠先验猜
 * （ask_user 的 options 曾被写成字符串数组、todo 的 contents 形状不可见，都是这个原因）。
 * 现在改为**限深保留**：够覆盖"数组元素对象 / 一层子对象"，又不把整棵 schema 灌进提示词。
 */
const MAX_SCHEMA_DEPTH = 3;

/** 只搬运模型理解参数形状所需的关键字，丢掉 $schema/$defs 等噪音 */
function flattenJsonSchema(
  node: any,
  depth: number,
  defs?: Record<string, any>,
): any {
  if (!node || typeof node !== "object") return node;

  // Zod 对复用/递归类型产出 $defs + $ref：解引用一次（限深，防自引用死循环）
  if (typeof node.$ref === "string") {
    const name = node.$ref.replace(/^#\/\$defs\//, "");
    const target = defs?.[name];
    if (target && depth < MAX_SCHEMA_DEPTH) {
      return flattenJsonSchema(target, depth + 1, defs);
    }
    return {};
  }

  const out: Record<string, any> = {};
  if (node.type) out.type = node.type;
  if (node.description) out.description = node.description;
  if (node.enum) out.enum = node.enum;
  if (node.default !== undefined) out.default = node.default;
  if (Array.isArray(node.anyOf)) {
    out.anyOf = node.anyOf.map((n: any) => flattenJsonSchema(n, depth + 1, defs));
  }

  const hasChildren = !!(node.items || node.properties);
  if (hasChildren && depth < MAX_SCHEMA_DEPTH) {
    if (node.items) out.items = flattenJsonSchema(node.items, depth + 1, defs);
    if (node.properties) {
      const props: Record<string, any> = {};
      for (const [key, value] of Object.entries(node.properties)) {
        props[key] = flattenJsonSchema(value, depth + 1, defs);
      }
      out.properties = props;
      if (Array.isArray(node.required)) out.required = node.required;
    }
  } else if (hasChildren) {
    // 超过深度上限：只留容器类型，不把子树灌进提示词
    out.type = out.type ?? (node.items ? "array" : "object");
  }
  return out;
}

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
    /** 只读执行能力（计划模式权限门依据）；缺省 false */
    readOnly?: boolean;
    /** 计划模式逃生舱；缺省 false */
    allowedInPlanMode?: boolean;
    /** 本工具会阻塞等待人类应答（审批/提问）；子会话放行会卡死父回合 */
    requiresUserInteraction?: boolean;
    /** 豁免通用大结果裁剪：本工具自行管理返回长度（自带上限与续读提示）；缺省 false */
    exemptFromLargeResult?: boolean;
  }): void {
    const zodSchema = def.inputSchema as any;
    const rawJson = z.toJSONSchema(zodSchema) as any;

    const root =
      rawJson.type === "object"
        ? rawJson
        : rawJson.$defs?.[Object.keys(rawJson.$defs || {})[0]] || rawJson;
    const required: string[] = root.required || [];
    const defs = rawJson.$defs as Record<string, any> | undefined;
    const properties: Record<string, any> = {};
    const rawProps = root.properties || {};
    for (const [key, val] of Object.entries(rawProps)) {
      const clean = flattenJsonSchema(val, 1, defs);
      // 顶层字段缺描述时用字段名兜底：给模型一个最低限度的语义锚点（原有行为）
      if (!clean.description) clean.description = key;
      // 既无 type 也无复合形状时兜底 string（原有行为）
      if (!clean.type && !clean.anyOf) clean.type = "string";
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
      readOnly: def.readOnly,
      allowedInPlanMode: def.allowedInPlanMode,
      requiresUserInteraction: def.requiresUserInteraction,
      exemptFromLargeResult: def.exemptFromLargeResult,
      icon: def.display?.icon,
      actionType: def.display?.actionType,
      argsKey,
      displayText: def.display?.text,
      displayAggregate: def.display?.aggregate,
      displayRenderer: def.display?.renderer,
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

  /** 导出为注册存储结构 */
  toRegistration(): ToolKitRegistration {
    return {
      def: this.def,
      tools: [...this._tools],
      prompts: [...this._prompts],
    };
  }
}
