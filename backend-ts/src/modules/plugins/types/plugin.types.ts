import { z } from "zod";
import { ISessionContext } from "../../chat/session-context";

// ==================== 插件元数据 ====================

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  /** 依赖的其他插件 ID */
  dependencies?: string[];
  /** 插件分类 */
  category?: "system" | "core" | "extended" | "user";
  /** 系统必需，不可被任何方式禁用 */
  essential?: boolean;
}

// ==================== 提示词 ====================

/** 提示词在 system prompt 中的变动频率 */
export type PromptFrequency = "STATIC" | "REGULAR" | "VOLATILE";

export interface PromptPiece {
  content: string;
  /** 排序优先级：STATIC 在前，VOLATILE 在后 */
  frequency: PromptFrequency;
  /** 加载模式：eager=始终注入, lazy=tool_load时注入, none=不注入 */
  loadMode?: ToolLoadMode;
  /** 注入位置：system=system prompt, user=user消息（插件级提示词专用） */
  type?: "system" | "user";
  /** 所属插件 ID */
  pluginId: string;
  /** 描述（用于调试和 UI） */
  description?: string;
}

export interface PluginContext {
  /** 会话上下文 */
  session: ISessionContext;
  /** 插件原始配置（原 roles.tools / settings.plugins 的原始配置） */
  pluginsConfig?: any;
}

/** @deprecated 使用 PluginContext */
export type PromptContext = PluginContext;

// ==================== 工具（沿用现有定义） ====================

export type ToolLoadMode = "eager" | "lazy" | "user" | "none";
export type ToolProviderType = "core" | "extended";
export type ConditionFn = (
  context: PluginContext,
) => boolean | Promise<boolean>;
/**
 * 插件级配置项（新格式 v2）
 * - enabled: 是否启用插件（默认 true）
 * - toolkits_filter: 工具包过滤模式，"deny"=黑名单（默认）|"allow"=白名单
 * - toolkits_deny: 黑名单：禁用的工具包 ID 列表
 * - toolkits_allow: 白名单：允许的工具包 ID 列表
 * - params: 插件私有参数（预留）
 */
export interface PluginEntryConfig {
  enabled?: boolean;
  toolkits_filter?: "deny" | "allow";
  toolkits_deny?: string[];
  toolkits_allow?: string[];
  params?: Record<string, any>;
}

/**
 * 插件配置类型
 * 格式：{ pluginId: PluginEntryConfig }
 */
export type PluginConfig = {
  /** 未配置的插件默认值 */
  __default?: boolean;
  /** 插件配置策略 */
  __strategy?: string;

  [key: string]: PluginEntryConfig | boolean | string;
};

export interface ToolParamSchema {
  type: string;
  description?: string;
  enum?: any[];
  default?: any;
  required?: boolean;
  properties?: Record<string, ToolParamSchema>;
}

export interface ToolHandlerDef {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, ToolParamSchema>;
    required?: string[];
  };
  handler: (
    args: Record<string, any>,
    context?: PluginContext,
    abortSignal?: AbortSignal,
  ) => Promise<string> | string;
  /** @internal Zod 运行时校验 schema（inputSchema 注册时自动注入） */
  _zodSchema?: import("zod").ZodTypeAny;
  /** 危险等级标记 */
  dangerLevel?: "safe" | "info" | "normal" | "high" | "critical";
  /**
   * 自定义工具调用展示文案
   * @param args 工具参数
   * @param isExecuting 是否正在执行
   * @returns 展示文案
   */
  formatDisplayMessage?(
    args: Record<string, any>,
    isExecuting: boolean,
  ): string;
  /**
   * 所属工具集 ID（用于按工具集分组加载，由 @ToolSet 统一控制加载模式）
   */
  toolSet?: string;
  /** 前端图标标识（如 "browser"、"code"、"edit"） */
  icon?: string;
  /** 可读动作描述（如 "访问网页"、"点击元素"） */
  action?: string;
  /** 从 args 中提取摘要的字段名（默认自动取第一个字符串参数） */
  argsKey?: string;
}

// ==================== 工具集定义（旧版，已废弃） ====================

/** @deprecated 使用 ToolKitDef / ToolKit */
export interface ToolSetDef {
  id: string;
  name: string;
  tools: string[];
  loadMode?: ToolLoadMode;
  activator?: string;
  handler?: (
    context: PluginContext,
  ) => Promise<ToolSetRuntime> | ToolSetRuntime;
}

/** @deprecated */
export interface ToolSetRuntime {
  loadMode?: ToolLoadMode;
  activator?: string;
}

// ==================== 工具包定义（ToolKit，新版） ====================

/** 工具包加载模式 */
export type ToolKitLoadMode = "eager" | "lazy" | "none";

/** 工具包定义（注册时传入） */
export interface ToolKitDef {
  /** 工具包唯一 ID（在同一插件内唯一） */
  id: string;
  /** 显示名称 */
  name?: string;
  /** 加载模式（默认 lazy） */
  loadMode?: ToolKitLoadMode;
  /** 是否默认启用（默认 true） */
  enabled?: boolean;
  /** 激活词/触发说明：告诉 AI 何时加载本工具包 */
  activator?: string;
  /** 运行时解析器：返回此工具包的动态属性 */
  handler?: (
    context: PluginContext,
  ) => Promise<Partial<ToolKitRuntime>> | Partial<ToolKitRuntime>;
  /** 初始化回调（可在此回调中注册工具/提示词） */
  onLoad?: (toolkit: ToolKitHandle) => void | Promise<void>;
}

/** 工具包运行时属性 */
export interface ToolKitRuntime {
  loadMode: ToolKitLoadMode;
  activator?: string;
}

/** 工具包句柄（在 onLoad 回调中暴露给插件） */
export interface ToolKitHandle {
  readonly id: string;
  readonly name: string;
  registerTool<Z extends z.ZodTypeAny>(def: {
    name: string;
    description: string;
    inputSchema: Z;
    execute: (
      args: z.output<Z>,
      ctx?: PluginContext,
      signal?: AbortSignal,
    ) => string | Record<string, any> | Promise<string | Record<string, any>>;
    display?: { action?: string; argsKey?: string; icon?: string };
    dangerLevel?: "safe" | "info" | "normal" | "high" | "critical";
  }): void;
  registerRawTool(def: ToolHandlerDef): void;
  registerPrompt(def: {
    content: string | ((ctx: PluginContext) => string | Promise<string>);
    frequency?: "STATIC" | "REGULAR" | "VOLATILE";
    description?: string;
  }): void;
}

/** 工具包注册后的内部存储结构 */
export interface ToolKitRegistration {
  def: ToolKitDef;
  tools: ToolHandlerDef[];
  prompts: Array<{
    frequency: string;
    description: string;
    handler: (ctx: any) => string | Promise<string>;
  }>;
}

export interface ToolUsingEvent {
  /** 工具名 */
  toolName: string;
  /** 工具参数 */
  args: Record<string, any>;
  /** 所属插件 ID */
  pluginId: string;
  /** 当前用户是否为管理员 */
  isAdmin: boolean;
  /** 用户 ID */
  userId?: string;
  /** 会话 ID */
  sessionId: string;
  /** 阻止执行（在钩子中设为 true） */
  denied?: boolean;
  /** 阻止原因 */
  denyReason?: string;
}

export interface LLMRequestEvent {
  messages: any[];
  systemPrompt: string;
  model: string;
  pluginId?: string;
}

export interface LLMResponseEvent {
  messages: any[];
  response: any;
  pluginId?: string;
}

// ==================== 插件决议信息 ====================

/**
 * 插件决议后的信息（统一由 PluginManager.resolvePlugins 返回）
 * 各消费方（ToolExecutor、PromptCollector 等）通过此类型消费插件运行时状态。
 */
export interface ResolvedPluginInfo {
  /** 是否启用 */
  enabled: boolean;
  /** 配置生效层级 */
  effective: string;
  /** 插件清单 */
  plugin: PluginManifest;
  /** 启用的工具（经过配置过滤后的） */
  enabledTools: ToolHandlerDef[];
  /** 所有注册的工具（不过滤） */
  allTools: ToolHandlerDef[];
  /** 工具包运行时信息 */
  enabledToolKits: Array<{
    id: string;
    name: string;
    loadMode: ToolLoadMode;
    activator?: string;
    enabled: boolean;
  }>;
}
