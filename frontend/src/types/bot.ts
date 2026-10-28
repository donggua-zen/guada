import type { Session } from './session';

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
  /** 后端 BotStatus 枚举实际返回小写（connected/connecting/...），此处放宽避免契约漂移 */
  runtimeStatus: string | null;
  lastStartedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 聚合后同一用户的单个历史会话 */
export interface BotChatSessionRef {
  id: string;
  title: string;
  lastActiveAt: string | null;
  /** 是否已被 clear_session 清空（externalId 带 @timestamp） */
  cleared: boolean;
}

/** 聚合后的用户会话行（同一 Bot 下的同一外部用户/群） */
export interface BotChatConversation {
  key: string;
  /** 默认打开的最新会话 */
  sessionId: string;
  /** 该用户全部会话，按活跃时间倒序 */
  sessions: BotChatSessionRef[];
  sessionCount: number;
  botId: string | null;
  platform: string | null;
  externalId: string | null;
  sourceType: 'private' | 'group' | null;
  nativeId: string | null;
  displayName: string;
  /** 平台提供的用户头像；缺失时前端回退到 IM 平台图标 */
  avatarUrl: string | null;
  lastActiveAt: string | null;
  cleared: boolean;
  /** 该用户名下任一会话被置顶，整行置顶显示 */
  pinned: boolean;
}

/** 机器人分组（左侧一级分组） */
export interface BotChatGroup {
  botId: string;
  name: string;
  platform: string;
  enabled: boolean;
  status: string;
  runtimeStatus: string | null;
  online: boolean;
  conversations: BotChatConversation[];
  total: number;
  hasMore: boolean;
  unknownBot: boolean;
}

export interface BotChatGroupsResponse {
  groups: BotChatGroup[];
}

export interface BotSessionDetailBot {
  id: string;
  name: string;
  platform: string;
  enabled: boolean;
  runtimeStatus: string | null;
  online: boolean;
  supportsPushMessage: boolean;
}

/**
 * 单个 Bot 会话详情。
 *
 * 注意：当 canReply=false（机器人已删除/未配置智能体）时，
 * session.agent 运行时可能为 null；ChatPanel 侧已做空值保护。
 */
export interface BotSessionDetail {
  session: Session;
  bot: BotSessionDetailBot | null;
  canReply: boolean;
  warning: string | null;
}

export interface BotSendMessageRequest {
  content: string;
  files?: unknown[];
  knowledgeBaseIds?: string[];
  replaceTurnId?: string;
  settingsOverride?: Record<string, unknown>;
  forwardToPlatform?: boolean;
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
