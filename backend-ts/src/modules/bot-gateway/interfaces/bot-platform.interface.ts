import { Observable } from 'rxjs';

/**
 * 机器人消息结构(标准化)
 */
export interface BotMessage {
  /** 平台唯一消息ID */
  messageId: string;
  /** 发送者ID(用户OpenID/UIN等) */
  senderId: string;
  /** 发送者昵称 */
  senderName?: string;
  /** 会话ID(群聊为群ID,私聊为用户ID) */
  conversationId: string;
  /** 消息内容文本 */
  content: string;
  /** 消息类型 */
  messageType: 'text' | 'image' | 'voice' | 'file' | 'mixed';
  /** 消息来源类型 */
  sourceType?: 'private' | 'group' | 'channel';
  /** 附件信息(图片/文件等) */
  attachments?: BotAttachment[];
  /** 原始平台事件对象(用于扩展) */
  rawEvent?: any;
  /** 时间戳 */
  timestamp: Date;
}

/**
 * 附件信息
 */
export interface BotAttachment {
  type: 'image' | 'file' | 'voice';
  url?: string;
  fileId?: string;
  fileName?: string;
  fileSize?: number;
}

/**
 * 机器人响应消息
 */
export interface BotResponse {
  /** 目标会话ID */
  conversationId: string;
  /** 回复内容 */
  content: string;
  /** 附件(可选) */
  attachments?: BotAttachment[];
  /** 引用消息ID(可选,用于回复特定消息) */
  replyToMessageId?: string;
  /** 消息来源类型(从BotMessage传递过来) */
  sourceType?: 'private' | 'group' | 'channel';
}

/**
 * 机器人平台状态
 */
export enum BotStatus {
  STOPPED = 'stopped',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  ERROR = 'error',
  DISCONNECTED = 'disconnected',
}

/**
 * 机器人配置
 */
export interface BotConfig {
  /** 机器人ID */
  id: string;
  /** 平台类型 */
  platform: 'qq' | 'wechat' | 'discord';
  /** 机器人名称 */
  name: string;
  /** 平台特定配置(包含认证信息和其他平台相关配置) */
  platformConfig: Record<string, any>;
  /** 是否启用 */
  enabled: boolean;
  /** 自动重连配置 */
  reconnectConfig?: {
    enabled: boolean;
    maxRetries: number;
    retryInterval: number;
  };
  /** 关联的默认角色ID(必填,用于对话流程) */
  defaultCharacterId: string;
  /** 关联的默认模型ID(可选) */
  defaultModelId?: string;
}

/**
 * 统一机器人平台接口
 *
 * 所有平台适配器必须实现此接口,屏蔽底层差异
 */
export interface IBotPlatform {
  /**
   * 获取平台标识
   */
  getPlatform(): string;

  /**
   * 初始化机器人(建立连接、注册事件监听器等)
   * @param config 机器人配置
   */
  initialize(config: BotConfig): Promise<void>;

  /**
   * 发送消息到指定会话
   * @param response 响应消息
   */
  sendMessage(response: BotResponse): Promise<void>;

  /**
   * 监听 incoming 消息流
   * @returns 消息 observable 流
   */
  onMessage(): Observable<BotMessage>;

  /**
   * 获取当前连接状态
   */
  getStatus(): BotStatus;

  /**
   * 优雅关闭(断开连接、清理资源)
   */
  shutdown(): Promise<void>;

  /**
   * 重新连接
   */
  reconnect?(): Promise<void>;
}

/**
 * 适配器工厂接口
 */
export interface IBotAdapterFactory {
  /**
   * 创建适配器实例
   * @param platform 平台类型
   * @param config 机器人配置
   */
  createAdapter(platform: string, config: BotConfig): IBotPlatform;

  /**
   * 注册新的适配器类型
   * @param platform 平台标识
   * @param adapterClass 适配器类
   */
  registerAdapter(platform: string, adapterClass: new () => IBotPlatform): void;
}
