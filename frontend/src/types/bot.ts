/**
 * 平台配置字段类型
 */
export interface ConfigField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'number' | 'select' | 'boolean';
  required: boolean;
  placeholder?: string;
  description?: string;
  options?: { value: string; label: string }[];
  /** 配置缺省值（形状随 type 变化） */
  defaultValue?: unknown;
}

/**
 * 平台元数据
 */
export interface PlatformMetadata {
  platform: string;
  displayName: string;
  icon?: string;
  description: string;
  fields: ConfigField[];
}

/**
 * 机器人实例
 */
export interface BotInstance {
  id: string;
  platform: string;
  name: string;
  enabled: boolean;
  /** 键/值由各平台插件动态定义（后端契约），前端不感知具体形状 */
  platformConfig: Record<string, unknown>;
  reconnectEnabled: boolean;
  maxRetries: number;
  retryInterval: number;
  defaultAgentId: string | null;
  defaultModelId: string | null;
  defaultThinkingEffort: string | null;
  additionalKwargs?: {
    knowledgeBaseIds?: string[];
  };
  status: 'stopped' | 'running' | 'error' | 'connecting';
  runtimeStatus: 'CONNECTED' | 'DISCONNECTED' | 'CONNECTING' | 'ERROR' | null;
  lastStartedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * 创建机器人请求
 */
export interface CreateBotRequest {
  platform: string;
  name: string;
  /** 键/值由各平台插件动态定义（后端契约），前端不感知具体形状 */
  platformConfig: Record<string, unknown>;
  reconnectConfig?: {
    enabled: boolean;
    maxRetries: number;
    retryInterval: number;
  };
  /** 后端 CreateBotDto 必填（@IsNotEmpty），前端此前误标可选 */
  defaultAgentId: string;
  defaultModelId?: string;
  defaultThinkingEffort?: string;
  additionalKwargs?: {
    knowledgeBaseIds?: string[];
  };
  autoStart?: boolean;
}

/**
 * 更新机器人请求
 */
export interface UpdateBotRequest {
  name?: string;
  /** 键/值由各平台插件动态定义（后端契约），前端不感知具体形状 */
  platformConfig?: Record<string, unknown>;
  enabled?: boolean;
  defaultAgentId?: string;
  defaultModelId?: string;
  defaultThinkingEffort?: string;
  additionalKwargs?: {
    knowledgeBaseIds?: string[];
  };
}
