import { z } from "zod";
import { ISessionContext } from "../../chat/session-context";
import type { ToolResult } from "../api/plugin-api";
import type { WorkspaceProviderFactory } from "../../../common/workspace/workspace-provider.interface";

// ==================== 插件元数据 ====================

/**
 * 宿主支持的最高 PluginApi 版本。
 *
 * - 1：历史隐式版本（registerTool/registerPrompt/registerSlot...）
 * - 2：新增提示词段、装配 transform、动作型本地命令、Hook、插件数据目录
 * - 3：新增自定义 HTTP 路由（registerRoute）、模型调用（complete/completeStream/listModels）、
 *      `main` 与 `conversation.side.panel` 槽位
 *
 * 外部插件在 manifest.json 声明 `apiVersion`；缺省按 1 处理，
 * 大于本常量则拒绝加载（避免用新 API 的插件在旧宿主上静默降级）。
 */
export const PLUGIN_API_VERSION = 3;

/** 插件权限声明（安装确认与审计展示；本期不做运行时强制） */
export type PluginPermission =
  | "prompt"
  | "fs"
  | "net"
  | "shell"
  | "policy"
  | "session"
  /** v3：注册自定义 HTTP 路由 */
  | "http"
  /** v3：调用宿主已配置的模型 */
  | "llm";

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
  /**
   * 图标：相对路径 / data URI / http URL。
   *
   * 相对路径的基目录按插件来源区分：
   * - 内置插件（编译进 dist 的 TS 类，无插件目录）→ 相对 `STATIC_DIR`，
   *   如 `images/plugins/file.svg`；
   * - 外部插件（manifest.json + 插件目录）→ 相对插件目录，如 `assets/logo.svg`。
   *
   * TODO(plugins): 内置插件后续应改为独立资源目录 `resources/plugins/<id>/assets/`，
   * 与外部插件共用「相对插件目录」语义，届时删除 STATIC_DIR 回退分支
   * （见 docs/technical-debt.md）。
   */
  icon?: string;
  /** 入口文件（仅外部插件，默认 "index.js"） */
  main?: string;
  /**
   * 插件声明的 PluginApi 版本。
   * 缺省 = 1（历史行为）；大于宿主 PLUGIN_API_VERSION 时拒绝加载。
   */
  apiVersion?: number;
  /** 权限声明（安装确认/审计展示；运行时隔离见技术债） */
  permissions?: PluginPermission[];
  /** 配置 schema（JSON Schema，供后续市场自动生成设置面板） */
  configSchema?: Record<string, any>;
  /** 显式入口声明（缺省 main / frontend/dist） */
  entries?: {
    backend?: string;
    frontend?: string;
  };
  /**
   * Provider Pack 契约版本（缺失 = 非供应商包）。
   * 声明后该插件可按供应商包加载：声明式类型卡 + 可选协议适配器。
   */
  providerApi?: number;
  /** Provider Pack 贡献声明（providerApi 存在时有效） */
  provides?: {
    /** 相对 manifest 的 YAML/JSON 类型卡路径（支持 glob） */
    providerTypes?: string[];
    /** 代码适配器入口；缺省用 main */
    providerAdapters?: string;
    /** 资源目录（logo 等），默认 assets */
    assets?: string;
  };
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
  /** 加载模式：eager=始终注入, lazy=经 skill_learn 学习后随工具包注入, none=不注入 */
  loadMode?: ToolKitLoadMode;
  /** 所属插件 ID */
  pluginId: string;
  /** 描述（用于调试和 UI） */
  description?: string;
}

// ==================== 提示词段（v2） ====================

/**
 * 插件声明的提示词段。
 *
 * 与旧 registerPrompt 的区别：
 * - 有稳定 name（同名同作用域冲突在注册期报错，而不是静默拼接）
 * - 有数值 order（可插到内置段之前/之后）
 * - 有 scope（global/agent/session）
 * - complete=true 时表示"接管整段系统提示词"（需 manifest permissions 含 prompt）
 */
export interface PromptSectionDef {
  /** 段名；建议 `${pluginId}.${name}`。同作用域同名视为冲突 */
  name: string;
  /** 排序，越小越靠前；内置段使用 0 附近，插件段建议 1000+ */
  order?: number;
  /** 作用域，默认 global */
  scope?: "global" | "agent" | "session";
  /**
   * 来自工具包时填工具包 id（由 `toolkit.registerPrompt` 自动折算）。
   * 装配器据此检查该工具包在本轮是否为 eager：lazy/none 的段不进系统提示词。
   */
  toolkitId?: string;
  /** 是否允许同作用域同名覆盖（默认 false） */
  shadowable?: boolean;
  /** 接管整段系统提示词（等价 DSH complete:true） */
  complete?: boolean;
  /** 文本或动态文本；返回空串表示本轮不注入 */
  text: string | ((ctx: PluginContext) => string | Promise<string>);
  /** 描述（调试/UI） */
  description?: string;
}

/** 装配后的段（已求值） */
export interface AssembledPromptSection {
  name: string;
  order: number;
  text: string;
  /** 来源插件；内置段为空 */
  pluginId?: string;
  complete?: boolean;
}

/** 一次系统提示词装配的输入/输出 */
export interface PromptAssembly {
  sections: AssembledPromptSection[];
  systemText: string;
}

/**
 * 装配后整体变换（waterfall 语义，按 order 串行）。
 *
 * 默认禁止删除 `builtin.*` 段；需要 manifest permissions 含 "prompt"
 * 且插件自行提供用户开关时才允许改写。
 */
export interface PromptTransformDef {
  id: string;
  order?: number;
  transform: (
    assembly: PromptAssembly,
    ctx: PluginContext,
  ) => PromptAssembly | void | Promise<PromptAssembly | void>;
}

// ==================== 动作型本地命令（v2） ====================

export interface LocalCommandResult {
  /** 回显给用户的文本（toast / 事件卡） */
  text?: string;
  /** 附加结构化数据（插件前端可读取） */
  data?: Record<string, unknown>;
}

export interface LocalCommandDef {
  /** 命令名（不含 /），^[a-z][a-z0-9-]*$ */
  name: string;
  description: string;
  /** 别名（同样参与冲突检测） */
  aliases?: string[];
  /** 执行；命令文本不落库、不调模型 */
  handler: (
    ctx: {
      sessionId: string;
      clientId?: string;
      args?: string;
      raw: string;
    },
    context?: PluginContext,
  ) => LocalCommandResult | Promise<LocalCommandResult>;
}

// ==================== Hook（v2） ====================

/** 首批向插件开放的钩子（白名单） */
export type PluginHookName =
  | "agent.pre_step"
  | "agent.request_error"
  | "turn.stopping"
  | "session.created";

export interface PluginHookDef {
  event: PluginHookName;
  /** 同事件内执行顺序，越小越先；缺省 0 */
  order?: number;
  /**
   * 与宿主内部钩子同签名：
   * - serial 语义（pre_step/request_error）：返回非 undefined 即接管
   * - parallel 语义（turn.stopping）：返回续跑决策
   * - emit 语义（session.created/preset.selected）：忽略返回值
   */
  handler: (payload: any) => unknown | Promise<unknown>;
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
  /**
   * `argsKey` 指向**数组**时，项数后缀（如"个问题"）。
   * 前端渲染为「3 个问题」；随 display 一起走 NLS（%key%）。
   */
  argsCountUnit?: string;
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
   * 只读执行能力：本工具不会改动用户的工作区或系统状态。
   * 计划模式权限门的唯一依据；缺省 false（保守：未声明即视为可写）。
   * 与 dangerLevel 无关——后者是风险展示语义，本字段是执行能力判定。
   */
  readOnly?: boolean;
  /**
   * 计划模式逃生舱：非只读工具但需在计划模式下放行的少数特例
   * （计划审批工具、浏览器调研、只读子代理等）。
   * 子会话（sub_agent）对"需要人类应答"的工具不享受本豁免——见 ToolExecutor 的计划门。
   */
  allowedInPlanMode?: boolean;
  /**
   * 本工具会阻塞等待人类应答（审批 / 提问）。
   * 子会话没有独立的应答面：在子会话里放行这类工具会把交互卡挂到用户看不见的子会话上、
   * 卡死父回合。计划门据此对子会话收窄 allowedInPlanMode。
   */
  requiresUserInteraction?: boolean;
  /**
   * 豁免通用大结果裁剪：本工具自行管理返回长度（自带上限与续读提示）。
   * read、skill_learn 属此类——它们的正文就是模型要用的内容，被换成预览等于报废。
   * 缺省 false（保守：未声明即接受通用裁剪）。
   */
  exemptFromLargeResult?: boolean;
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
  /** argsKey 指向数组时的项数后缀（如「个问题」；随 display 走 NLS 解析） */
  argsCountUnit?: string;
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
  /**
   * 依赖的生产者工具包（"pluginId:kitId"）。OR 语义：任一可用则本包可用，
   * 全部不可用 → loadMode:"none"（工具与提示词均不进入运行时，等价于"从未注册"）。
   *
   * 判定刻意只基于配置层（插件全局启停 + 智能体层裁剪/自治理条目），
   * 不递归执行依赖工具包的 handler——依赖包的运行时动态条件（如 agents 白名单）
   * 不参与，避免预览/无 session 路径（/plugins/query）无法判定。
   */
  requiresAnyKits?: string[];
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
    /** 只读执行能力（计划模式权限门依据）；缺省 false */
    readOnly?: boolean;
    /** 计划模式逃生舱；缺省 false。子会话对 requiresUserInteraction 的工具不享受本豁免 */
    allowedInPlanMode?: boolean;
    /** 本工具会阻塞等待人类应答（审批/提问）；子会话放行会卡死父回合 */
    requiresUserInteraction?: boolean;
    /** 豁免通用大结果裁剪：本工具自行管理返回长度（自带上限与续读提示）；缺省 false */
    exemptFromLargeResult?: boolean;
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

// ==================== 后台作业（v2.1） ====================

/**
 * 插件声明的后台作业。
 *
 * 宿主用 JobRegistry 统一登记：模型可用现成的 job_read / job_list / job_stop 读取、
 * 轮询与取消，无需插件自己造轮子。
 *
 * 语义说明：插件作业按 `kind: "shell"` 登记（字节日志 + 默认完成通知），
 * 因此 read 的 offset/nextOffset 必须是稳定的字节偏移。
 */
export interface PluginJobReadResult {
  text: string;
  offset: number;
  nextOffset: number;
  size: number;
  truncated: boolean;
  logFilePath?: string;
}

export interface PluginJobOutcome {
  status: "completed" | "killed" | "failed";
  detail?: string;
  output?: string;
  exitCode?: number | null;
}

export interface PluginJobDef {
  /** 作业标签（job_list 里显示） */
  label: string;
  /** 是否投递完成通知；默认 true */
  notify?: boolean;
  /** 日志文件路径（可选；给了 job_read 就能增量读） */
  logFilePath?: string;
  read: (opts: { offset?: number; maxBytes?: number }) => Promise<PluginJobReadResult>;
  cancel: (reason?: string) => void | Promise<void>;
  /** 可选：向运行中的作业投递原始输入 */
  send?: (input: string) => Promise<void>;
  /** 结算（进程结束时 resolve） */
  done: Promise<PluginJobOutcome>;
}

// ==================== 插件配置（v2.1） ====================

/** 配置字段类型（与前端 SchemaForm 一致） */
export type PluginConfigFieldType =
  | "text"
  | "password"
  | "number"
  | "select"
  | "textarea"
  | "boolean";

export interface PluginConfigField {
  key: string;
  label: string;
  type: PluginConfigFieldType;
  required?: boolean;
  /** 缺省值 */
  default?: unknown;
  placeholder?: string;
  /** 条件显示 */
  showIf?: PluginConfigShowIf;
  /** select 选项 */
  options?: Array<{ label: string; value: unknown }>;
  /** 帮助文本 */
  description?: string;
}

/**
 * 条件显示（v2.2 扩展 anyOf）
 *
 * - 单键形式：`{ field, equals }` —— 字段值等于 equals 时显示
 * - 组合形式：`{ anyOf: [{field, equals}, ...] }` —— 任一满足即显示
 *   （对齐 dsh 皮肤的 `visibleWhen.anyOf`，用于「桌面端或移动端任一开启」这类条件）
 */
export type PluginConfigShowIf =
  | { field: string; equals: unknown }
  | { anyOf: Array<{ field: string; equals: unknown }> };

export interface PluginConfigSchema {
  fields: PluginConfigField[];
}

// ==================== 插件 HTTP 路由（v3） ====================

/** 插件路由 handler 拿到的上下文 */
export interface PluginHttpContext {
  pluginId: string;
  /** `:name` 段解析结果 */
  params: Record<string, string>;
  query: Record<string, string | string[]>;
  /** 已解析的 JSON body（无 body 时为 undefined） */
  body: unknown;
  /** 插件数据目录（同 getDataDir） */
  dataDir: string;
  method: string;
  /** 原始 url（含 query） */
  url: string;
  headers: Record<string, string | string[] | undefined>;
}

/**
 * 插件自定义 HTTP 路由定义。
 *
 * 对外 URL：`/api/v1/plugins/<pluginId>/http/<path>`
 * handler 拿到原生 req/res，可以直接写流（SSE / 大文件 pipe）。
 */
export interface PluginHttpRouteDef {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "ALL";
  /** 相对插件命名空间，不含前导 `/`；支持 `:param` 与末尾 `*` */
  path: string;
  handler: (req: any, res: any, ctx: PluginHttpContext) => void | Promise<void>;
}

// ==================== 插件 LLM（v3） ====================

export interface PluginLlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface PluginLlmCompleteOptions {
  /** 指定模型 id；缺省用第一个可用模型 */
  modelId?: string;
  system?: string;
  /** 单轮便捷写法；与 messages 二选一（同时给时 prompt 追加为最后一条 user） */
  prompt?: string;
  messages?: PluginLlmMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /** 用量统计标签，默认 `plugin:<id>` */
  purpose?: string;
}

export interface PluginLlmResult {
  text: string;
  model: string;
  usage?: { promptTokens?: number; completionTokens?: number };
}

export interface PluginLlmStreamChunk {
  type: "text" | "reasoning" | "finish";
  text?: string;
  finishReason?: string;
}

export interface PluginLlmModelInfo {
  id: string;
  name: string;
  providerId: string;
  providerName: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  features?: string[];
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

/**
 * 主题注册（v3：主题与皮肤统一）
 *
 * 一个「主题」可以只是配色（传统 CSS 变量覆盖），也可以是完整展示层：
 * 多份 CSS（亮/暗）+ 运行时脚本（挂自建 DOM）+ 资源目录 + 设置项。
 *
 * 分层语义（统一模型）：
 * - 纯 CSS 主题：只给 cssFile / cssFiles，靠变量覆盖；
 * - 富主题（原「皮肤」）：额外给 runtimeScript / assetBase / bodyAttribute / settings，
 *   由宿主在 `html[data-theme]` 之上再打 body 作用域属性并执行脚本。
 *
 * 互斥：同一时间只启用一个主题；切换时宿主必须先卸载前一个并还原其全部 DOM 写入。
 */
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

  // ── 样式 ──

  /** 单份 CSS，相对插件根（如 "themes/neon.css"）。亮暗共用时用它 */
  cssFile?: string;
  /** 亮/暗分文件，相对插件根；给了就按当前模式自动切换 */
  cssFiles?: { light?: string; dark?: string };

  // ── 富主题（可选） ──

  /**
   * 运行时脚本（IIFE，相对插件根）。
   * 执行后需调用 `window.__GuaDaTheme__(api, manifest)`，返回可选 disposer。
   */
  runtimeScript?: string;
  /** 资源目录（相对插件根），前端用 /plugins/:id/assets/ 取 */
  assetBase?: string;
  /**
   * 打到 document.body 的作用域属性名（如 "data-gd-theme-maid"）。
   * 缺省 = `data-gd-theme-<id 的短横线形式>`。
   */
  bodyAttribute?: string;
  /** 主题设置项（复用配置字段格式；值存 plugin:<id> 数据） */
  settings?: PluginConfigField[];
  /** 预览图（相对插件根），用于设置页缩略 */
  preview?: { light?: string; dark?: string };
  /**
   * 主题是否接管背景层（自绘背景）。
   * 置 true 时宿主会临时清空壁纸变量，避免两层背景叠加。
   */
  ownsBackground?: boolean;
  /** 推荐搭配的主题 id（设置页仅作提示，不强制） */
  recommendedThemes?: string[];
}

/**
 * 皮肤注册（v2.2，已并入主题）
 *
 * @deprecated 从 v3 起「主题」与「皮肤」是同一个概念：请直接用
 * `ThemeRegistration`（支持 cssFiles / runtimeScript / assetBase / settings）。
 * 本类型仅为兼容旧插件保留，字段与 ThemeRegistration 完全一致。
 */
export type SkinRegistration = ThemeRegistration;

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
