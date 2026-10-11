/**
 * 工具参数属性定义
 */
export interface ToolParameterProperty {
  type: string;
  description?: string;
  enum?: any[];
  properties?: Record<string, ToolParameterProperty>;
  required?: string[];
  items?: ToolParameterProperty;
  default?: any;
  maxLength?: number;
}

/**
 * 系统内部使用的扁平化工具定义（不带 function 包装层）
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters?: {
    type: "object";
    properties: Record<string, ToolParameterProperty>;
    required?: string[];
  };
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface ToolCallResponse {
  toolCallId: string;
  name: string;
  content: string;
  isError?: boolean;
  /** 工具执行结果状态，由 agent-engine 在执行后设置 */
  outcome?: "success" | "error" | "rejected";
  /** 工具返回的图片（base64），由 agent-engine 注入为隐藏 user 消息 */
  images?: import("../../plugins/api/plugin-api").ImageContent[];
  /**
   * 工具返回的图片**引用**（字节已在磁盘，如 image_view / browser_screenshot）。
   * 由 agent-engine 物化/转正为会话 images 引用后注入——持久化只落路径指针，
   * 不落 base64。优先级高于 images。
   */
  imageRefs?: import("../../plugins/api/plugin-api").ImageRefContent[];
  /**
   * 工具转交的用户输入正文。语义是一体的：**非空 ⇒ 引擎终止当前轮**（finishReason=plan_rejected），
   * 文字随 run() 返回值交回 chat-runner，作为**真实用户消息入队开启新轮次**（与手打消息同一条
   * 准入路径：可见、独立回合壳、成为模式切换检测的新基准）。
   *
   * 生产者：ExitPlanMode 被拒且用户留下文字反馈。想往**当前轮**注入模型可见内容的场景
   * 不该用本字段——那是 injectUserPrompt / TURN_STOPPING 拦截器的职责。
   */
  followUpUserInput?: string;
  /**
   * UI 渲染元数据（仅前端消费，不进 LLM 上下文）。
   * card 标识结果卡片类型（terminal/diff/read/...），其余为该卡片的结构化字段。
   */
  meta?: Record<string, any>;
}
