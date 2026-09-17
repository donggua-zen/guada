import { z } from "zod";
import { ISessionContext } from "../../chat/session-context";
import type { ToolResult } from "../api/plugin-api";
import type { WorkspaceProviderFactory } from "../../../common/workspace/workspace-provider.interface";

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
  /** 图标：相对路径（"assets/logo.png"）/ data URI / http URL */
  icon?: string;
  /** 入口文件（仅外部插件，默认 "index.js"） */
  main?: string;
  /** 插件来源（内部注入，外部插件由 loader 设置） */
  source?: "builtin" | "dev" | "user";
  /** 插件目录绝对路径（仅外部插件） */
  pluginPath?: string;
}

// ==================== 提示词 ====================

/** 提示词在 system prompt 中的变动频率 */
export type PromptFrequency = "STATIC" | "REGULAR" | "VOLATILE";

export interface PromptPiece {
  content: string;
  /** 排序优先级：STATIC 在前，VOLATILE 在后 */
  frequency: PromptFrequency;
  /** 加载模式：eager=始终注入, lazy=经 tool_learn 学习后随工具包注入, none=不注入 */
  loadMode?: ToolKitLoadMode;
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
  /** 当前工具调用 id（toolCallId，execute 内可作审批关联） */
  toolCallId?: string;
}

/** @deprecated 使用 PluginContext */
export type PromptContext = PluginContext;

// ==================== 工具（沿用现有定义） ====================

export type ToolProviderType = "core" | "extended";
export type ConditionFn = (
  context: PluginContext,
) => boolean | Promise<boolean>;
/**
 * 全局层插件条目配置（持久化于 plugins_config / SG_PLUGINS）
 * 全局层只负责插件启停，不参与工具包过滤。
 */
export interface GlobalPluginEntryConfig {
  /** 插件启停 */
  enabled?: boolean;
}

/** 全局层插件配置：{ pluginId: { enabled } } */
export type GlobalPluginConfig = Record<string, GlobalPluginEntryConfig>;

/**
 * 智能体层插件条目配置（持久化于 agent.settings.plugins）
 * 智能体层只负责工具包（能力包）黑白名单过滤，不再控制插件启停，
 * 因此条目中不包含 enabled 字段；旧智能体数据里遗留的 enabled 会被解析器忽略。
 */
export interface RolePluginEntryConfig {
  /**
   * 工具包过滤模式：
   * - "deny"（默认）黑名单：禁用 `toolkits_deny` 中列出的
   * - "allow" 白名单：先全拒，再放行 `toolkits_allow` 中列出的
   * - "deny_all" 全部禁用：压过两个列表，全部拒绝；列表原样保留，
   *   供解除全部禁用时恢复（"关掉整个能力包但不改配置"）
   */
  toolkits_filter?: "deny" | "allow" | "deny_all";
  /** 黑名单模式下禁用的工具包 ID 列表 */
  toolkits_deny?: string[];
  /** 白名单模式下允许的工具包 ID 列表 */
  toolkits_allow?: string[];
  params?: Record<string, any>;
}

/**
 * 智能体层插件配置
 * 格式：{ __strategy?, __default?, pluginId: RolePluginEntryConfig }
 * 与全局层配置（GlobalPluginConfig）完全分离解析。
 */
export type RolePluginConfig = {
  /** 未显式配置的插件其工具包默认是否放行 */
  __default?: boolean;
  /** 智能体配置策略 */
  __strategy?: string;

  [pluginId: string]: RolePluginEntryConfig | boolean | string;
};

/** @deprecated 已拆分为 GlobalPluginEntryConfig（全局）与 RolePluginEntryConfig（智能体） */
export interface PluginEntryConfig extends RolePluginEntryConfig {
  enabled?: boolean;
}

/** @deprecated 已拆分为 GlobalPluginConfig / RolePluginConfig */
export type PluginConfig = {
  __default?: boolean;
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

/**
 * 工具调用渲染器声明：插件告知前端如何定制渲染该工具的参数/结果
 *
 * kind 由前端 tool-renderers 组件实现；fields 为 args 中各语义字段的映射
 * （如 diff: file=file_path, oldValue=old_text, newValue=new_text）。
 */
export interface ToolRendererDecl {
  kind: "diff" | "content" | "terminal";
  fields?: {
    /** 目标文件路径 */
    file?: string;
    /** diff：旧文本 */
    oldValue?: string;
    /** diff：新文本 */
    newValue?: string;
    /** content：写入内容 */
    content?: string;
    /** terminal：命令行 */
    command?: string;
  };
}

export interface ToolDisplay {
  /** 执行中/已完成文案 */
  text?: { executing: string; completed: string };
  /** 聚合文案（{n} 为数量占位符） */
  aggregate?: { executing: string; completed: string };
  /** 从 args 中提取摘要的字段名 */
  argsKey?: string;
  /** 前端图标标识 */
  icon?: string;
  /** 定制渲染器声明（前端按 kind 选择渲染组件） */
  renderer?: ToolRendererDecl;
  /** @deprecated 动作类型枚举（前端不再消费，保留兼容） */
  actionType?: string;
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
  ) => Promise<ToolResult> | ToolResult;
  /** @internal Zod 运行时校验 schema（inputSchema 注册时自动注入） */
  _zodSchema?: import("zod").ZodTypeAny;
  /** 危险等级标记 */
  dangerLevel?: "safe" | "info" | "normal" | "high" | "critical";
  /**
   * 所属工具集 ID（用于按工具集分组加载，由 @ToolSet 统一控制加载模式）
   */
  toolSet?: string;
  /** 前端图标标识（如 "browser"、"code"、"edit"） */
  icon?: string;
  /** @deprecated 动作类型枚举（前端不再消费，保留兼容） */
  actionType?: string;
  /** 从 args 中提取摘要的字段名（默认自动取第一个字符串参数） */
  argsKey?: string;
  /** 执行中/已完成展示文案 */
  displayText?: { executing: string; completed: string };
  /** 聚合展示文案（{n} 为数量占位符） */
  displayAggregate?: { executing: string; completed: string };
  /** 定制渲染器声明（前端按 kind 选择渲染组件） */
  displayRenderer?: ToolRendererDecl;
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
  /** 显示描述（支持 %key% NLS 引用） */
  description?: string;
  /** 加载模式（默认 eager） */
  loadMode?: ToolKitLoadMode;
  /** 是否默认启用（默认 true） */
  enabled?: boolean;
  /**
   * 自治理：标记后本工具包不参与智能体层过滤（__strategy / __default / 显式 deny 均不生效），
   * 由本工具包的 handler 依据 PluginContext.pluginsConfig 自行决定 loadMode。
   *
   * 用于"有自己管理界面"的能力包（MCP 每服务器、skills、sub_agent）：
   * 运行时过滤机制不变，只是过滤输入由自有界面写入、裁决权在该工具包自己手里。
   */
  governance?: "self";
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
    display?: ToolDisplay;
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

// ── 附件类型（AttachmentType）──

export interface AttachmentItem {
  id: string;
  name: string;
  description?: string;
  meta?: Record<string, any>;
}

export interface AttachmentTypeRegistration {
  id: string;
  label: string;
  icon: string;
  list(): Promise<AttachmentItem[]>;
  describe?(items: AttachmentItem[]): string;
}

// ── UI 页面注册（UiPage）──

export interface UiPageRegistration {
  id: string;
  area: "settings";
  group: string;
  tab: string;
  icon: string;
  component: string;
  order?: number;
}

// ── Slot 注册（v2：插件前端 UI 能力）──

export interface SlotRegistration {
  /** 命名 slot，点号分层：'settings.my-plugin'、'chat.toolbar.actions' */
  name: string;
  /** 组件名（对应插件 frontend/dist/<component>.js） */
  component: string;
  /** 渲染模式：'single'（唯一）/ 'list'（并列，默认）/ 'chain'（selector 路由，暂缓） */
  mode?: "single" | "list" | "chain";
  /** 排序，默认 100 */
  order?: number;
  /** 加载策略：'immediate' / 'lazy'（默认） */
  loadMode?: "immediate" | "lazy";
  /** 静态 props（可序列化 JSON，与渲染时注入的 inject 合并，inject 覆盖） */
  props?: Record<string, unknown>;
  /** 显示用元信息（tab 标题/图标等，%key% 走 NLS 解析） */
  meta?: { label?: string; icon?: string; group?: string };
}

// ── 主题注册（v2：插件主题能力）──

export interface ThemeRegistration {
  /** 主题全局唯一 ID（建议 `${pluginId}.${name}`，防跨插件冲突） */
  id: string;
  /** 展示名；支持 %key% NLS 引用 */
  name: string;
  /** 可选 i18n key（优先于 name，走 NlsService） */
  nameKey?: string;
  /** 主色（下拉预览圆点） */
  primaryColor?: string;
  /** 副色（下拉预览圆点） */
  secondaryColor?: string;
  /** 适用模式：'light' / 'dark' / 'all'（默认 all） */
  mode?: "light" | "dark" | "all";
  /** 主题 CSS 文件名，相对插件 frontend/dist/（如 "neon.css"） */
  cssFile: string;
}

/** RPC 方法 handler：参数与返回值为可序列化 JSON */
export type RpcHandler = (
  args: any,
  ctx: { sessionId?: string; workspaceId?: string },
) => unknown | Promise<unknown>;

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
  /**
   * 全部工具包的运行时信息（含被智能体层禁用的，以 enabled=false 标记；
   * 被禁用的工具包不解析 handler，loadMode/activator 取注册默认值）
   */
  enabledToolKits: Array<{
    id: string;
    name: string;
    description?: string;
    loadMode: ToolKitLoadMode;
    activator?: string;
    enabled: boolean;
    /** 该工具包注册的工具数量 */
    toolCount: number;
    /** 该工具包注册的提示词数量 */
    promptCount: number;
  }>;
  /** 注册的 WorkspaceProvider 工厂 */
  workspaceProviders: WorkspaceProviderFactory[];
  /** 注册的附件类型 */
  attachmentTypes: AttachmentTypeRegistration[];
  /** 注册的 UI 页面 */
  uiPages: UiPageRegistration[];
  /** 插件来源 */
  source?: "builtin" | "dev" | "user";
  /** 插件目录路径（仅外部插件） */
  pluginPath?: string;
}
