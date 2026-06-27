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
  category?: 'system' | 'core' | 'extended' | 'user';
}

// ==================== 提示词 ====================

/** 提示词在 system prompt 中的变动频率 */
export type PromptFrequency = 'STATIC' | 'REGULAR' | 'VOLATILE';

export interface PromptPiece {
  content: string;
  /** 排序优先级：STATIC 在前，VOLATILE 在后 */
  frequency: PromptFrequency;
  /** 加载模式：eager=始终注入, lazy=tool_load时注入, none=不注入 */
  loadMode?: ToolLoadMode;
  /** 所属插件 ID */
  pluginId: string;
  /** 描述（用于调试和 UI） */
  description?: string;
}

export interface PluginContext {
  sessionId: string;
  sessionType: string;
  workspacePath: string;
  userId?: string;
  /** 角色信息（动态挂载） */
  character?: any;
  /** 模型信息（动态挂载） */
  model?: any;
  /** 发送者昵称（Bot 消息） */
  senderName?: string;
  /** 是否管理员（Bot 消息） */
  isAdmin?: boolean;
  /** 扩展字段 */
  [key: string]: any;
}

/** @deprecated 使用 PluginContext */
export type PromptContext = PluginContext;

// ==================== 工具（沿用现有定义） ====================

export type ToolLoadMode = 'eager' | 'lazy' | 'none';
export type ToolProviderType = 'core' | 'extended';
export type ConditionFn = (context: PluginContext) => boolean | Promise<boolean>;
/** 插件/工具配置类型：{ pluginId: true/false } 或 { pluginId: string[] } */
export type PluginConfig = Record<string, boolean | string[]>;

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
  dangerLevel?: 'info' | 'normal' | 'high' | 'critical';
  /**
   * 自定义工具调用展示文案
   * @param args 工具参数
   * @param isExecuting 是否正在执行
   * @returns 展示文案
   */
  formatDisplayMessage?(args: Record<string, any>, isExecuting: boolean): string;
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

// ==================== 工具集定义 ====================

export interface ToolSetDef {
  /** 工具集 ID */
  id: string;
  /** 工具集名称 */
  name: string;
  /** 该工具集包含的工具名列表 */
  tools: string[];
  /** 加载模式（默认 lazy） */
  loadMode?: ToolLoadMode;
  /** 激活词/触发说明：告诉 AI 何时加载本工具集 */
  activator?: string;
  /** 运行时解析器：返回此工具集的动态属性 */
  handler?: (context: PluginContext) => Promise<ToolSetRuntime> | ToolSetRuntime;
}

export interface ToolSetRuntime {
  loadMode?: ToolLoadMode;
  activator?: string;
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
