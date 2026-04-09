/**
 * LLM 交互相关的统一类型定义
 */

// ==================== 消息结构 ====================

/**
 * 消息内容片段（支持多模态）
 */
export interface MessagePart {
    type: 'text' | 'image_url';
    text?: string;
    image_url?: {
        url: string;
        detail?: 'auto' | 'low' | 'high';
    };
}

/**
 * 工具调用项（系统内部通用格式）
 */
export interface ToolCallItem {
    id: string;
    index?: number;
    type: 'function';
    name: string;
    arguments: string; // JSON 字符串
}

/**
 * 统一的对话消息记录
 */
export interface MessageRecord {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | MessagePart[];
    reasoningContent?: string;
    toolCalls?: ToolCallItem[];
    toolCallId?: string; // 当 role 为 'tool' 时使用
    name?: string;       // 当 role 为 'tool' 时使用，对应调用的函数名
    metadata?: Record<string, any>;
    usage?: any;
    finishReason?: string;
    error?: string;
    toolCallsResponse?: any;
}

// ==================== 工具定义结构 ====================

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
}

/**
 * 系统内部使用的扁平化工具定义（不带 function 包装层）
 */
export interface InternalToolDefinition {
    name: string;
    description: string;
    parameters?: {
        type: 'object';
        properties: Record<string, ToolParameterProperty>;
        required?: string[];
    };
}

// ==================== 适配器接口与参数 ====================

export interface LLMCompletionParams {
    model: string;
    messages: MessageRecord[];
    temperature?: number;
    topP?: number;           // 原 top_p
    frequencyPenalty?: number; // 原 frequency_penalty
    maxTokens?: number;      // 原 max_tokens
    tools?: InternalToolDefinition[];
    thinkingEnabled?: boolean;
    extraBody?: Record<string, any>;
    abortSignal?: AbortSignal;
    providerConfig?: any;
    modelConfig?: any;
    stream?: boolean;
}

export interface LLMResponseChunk {
    content?: string | null;
    reasoningContent?: string | null;
    finishReason?: string | null;
    toolCalls?: ToolCallItem[];
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}
