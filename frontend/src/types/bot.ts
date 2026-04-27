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
  defaultValue?: any;
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
  userId: string;
  platform: string;
  name: string;
  enabled: boolean;
  platformConfig: Record<string, any>;
  reconnectEnabled: boolean;
  maxRetries: number;
  retryInterval: number;
  defaultCharacterId: string | null;
  defaultModelId: string | null;
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
  platformConfig: Record<string, any>;
  reconnectConfig?: {
    enabled: boolean;
    maxRetries: number;
    retryInterval: number;
  };
  defaultCharacterId?: string;
  defaultModelId?: string;
  autoStart?: boolean;
}

/**
 * 更新机器人请求
 */
export interface UpdateBotRequest {
  name?: string;
  platformConfig?: Record<string, any>;
  enabled?: boolean;
  defaultCharacterId?: string;
  defaultModelId?: string;
}
