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
  /** 原始平台事件对象(用于扩展) */
  rawEvent?: any;
  /** 时间戳 */
  timestamp: Date;
}

/**
 * 机器人响应消息
 */
export interface BotResponse {
  /** 目标会话ID */
  conversationId: string;
  /** 回复内容 */
  content: string;
  /** 引用消息ID(可选,用于回复特定消息) */
  replyToMessageId?: string;
  /** 消息来源类型(从BotMessage传递过来) */
  sourceType?: 'private' | 'group' | 'channel';
  /** 原始消息帧(用于企业微信等需要上下文的平台) */
  rawFrame?: any;
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
 * 机器人实例运行时状态（管理器层面的生命周期状态）
 *
 * 与 BotStatus（适配器层面）的区别：
 * - BotStatus 反映适配器的连接状态，由适配器内部维护
 * - BotRuntimeStatus 由 BotInstanceManager 维护，反映管理器层面的生命周期
 *
 * 例如：适配器断开后状态为 DISCONNECTED，但管理器可能立即调度重连，
 * 此时 runtimeStatus = RECONNECTING，而 adapter.getStatus() = DISCONNECTED。
 */
export enum BotRuntimeStatus {
  /** 首次连接中（startBot 后、onConnect 前） */
  CONNECTING = 'connecting',
  /** 已连接，正常工作 */
  CONNECTED = 'connected',
  /** 断开后正在重连（含等待重连定时器的时间窗口） */
  RECONNECTING = 'reconnecting',
  /** 已停止或已清理 */
  STOPPED = 'stopped',
}

/**
 * 编排器可见的机器人实例视图
 *
 * 结构化类型——ManagedBotInstance 兼容此接口，可直接传入编排器。
 * 编排器仅能访问此接口声明的字段，无法触及 reconnectAttempts、subscriptions 等内部状态。
 */
export interface BotInstanceView {
  /** 适配器实例 */
  adapter: IBotPlatform;
  /** 机器人配置 */
  config: BotConfig;
  /** 运行时状态 */
  status: BotRuntimeStatus;
}

/**
 * 机器人配置
 */
export interface BotConfig {
  /** 机器人ID */
  id: string;
  /** 平台类型 */
  platform: 'qq' | 'discord' | 'lark' | 'wecom' | 'wechat-personal' | 'mock';
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
  /** 
   * 关联的默认角色ID
   * 
   * 注意：此字段在每次创建会话时动态读取，修改后无需重启机器人
   */
  defaultCharacterId: string;
  /** 
   * 关联的默认模型ID
   * 
   * 注意：此字段在每次创建会话时动态读取，修改后无需重启机器人
   * 优先级：Bot实例配置 > 角色配置 > 全局默认设置
   */
  defaultModelId?: string;
  /**
   * 关联的默认思考强度
   *
   * 注意：此字段在每次创建会话时动态注入到 session.settings.thinkingEffort，修改后无需重启机器人
   * 仅对支持 thinking feature 的模型生效，不支持时自动忽略
   */
  defaultThinkingEffort?: string;
  /**
   * 扩展配置（如知识库ID列表等）
   * 
   * 注意：此字段在每次处理消息时动态读取，修改后无需重启机器人
   */
  additionalKwargs?: Record<string, any>;
  /** 关联的知识库ID列表(从 additionalKwargs 中读取) */
  knowledgeBaseIds?: string[];
}

/**
 * 流式回复选项
 */
export interface StreamReplyOptions {
  /** 是否为最终回复 */
  finish?: boolean;
  /** 流ID(用于关联同一流式回复的多个片段) */
  streamId?: string;
}

/**
 * 平台能力声明
 */
export interface PlatformCapabilities {
  /** 是否支持流式回复 */
  supportsStreaming: boolean;
  /** 是否支持主动推送(无需消息上下文) */
  supportsPushMessage: boolean;
  /** 是否支持模板卡片 */
  supportsTemplateCard: boolean;
  /** 是否支持多媒体消息 */
  supportsMultimedia: boolean;
  /**
   * SDK 是否自行处理重连
   * - true: SDK 内部有完善的重连机制,外部管理器不应干预
   * - false: 需要外部 BotInstanceManager 统一管理重连逻辑
   */
  handlesReconnectInternally?: boolean;
  /** 两次发送之间的最小间隔(ms)，0 或不填表示不限流 */
  sendIntervalMs?: number;
}

/**
 * 断开连接事件信息
 */
export interface BotDisconnectEvent {
  /** 断开原因码 */
  code: number;
  /** 断开原因描述 */
  reason?: string;
  /** 时间戳 */
  timestamp: Date;
}

/**
 * 媒体发送请求
 */
export interface BotMediaRequest {
  /** 目标会话ID */
  conversationId: string;
  /** 媒体类型 */
  mediaType: "image" | "video" | "file";
  /** 本地文件路径或网络 URL */
  filePath: string;
  /** 文件名（可选，不传则从路径推断） */
  filename?: string;
  /** MIME 类型（可选） */
  contentType?: string;
  /** 附带文字说明（可选） */
  caption?: string;
  /** 消息来源类型（部分平台需要区分群聊/私聊） */
  sourceType?: "private" | "group" | "channel";
  /** 引用消息 ID（部分平台被动回复时需要） */
  replyToMessageId?: string;
  /** 原始消息帧（部分平台需要上下文） */
  rawFrame?: any;
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
   * 获取平台能力声明
   */
  getCapabilities(): PlatformCapabilities;

  /**
   * 连接到机器人平台(建立连接、注册事件监听器等)
   * @param config 机器人配置
   */
  connect(config: BotConfig): Promise<void>;

  /**
   * 发送消息到指定会话
   * @param response 响应消息
   */
  sendMessage(response: BotResponse): Promise<void>;

  /**
   * 发送流式回复(如果平台支持)
   * @param response 响应消息
   * @param options 流式回复选项
   * @returns 是否成功发送
   */
  sendStreamReply?(response: BotResponse, options?: StreamReplyOptions): Promise<boolean>;

  /**
   * 监听 incoming 消息流
   * @returns 消息 observable 流
   */
  onMessage(): Observable<BotMessage>;

  /**
   * 监听连接成功事件(必须实现)
   * 
   * 注意: 此事件应在业务层面真正连接成功后触发(如认证成功、会话建立),而非仅 WS 连接
   * 所有适配器必须实现此方法,即使返回空 Observable 也要提供
   * 
   * @returns 连接成功事件 observable 流
   */
  onConnect(): Observable<void>;

  /**
   * 监听断开连接事件(必须实现)
   * 
   * 所有适配器必须实现此方法,用于通知上层管理器连接状态变化
   * 即使平台不支持主动断开检测,也应返回一个空的 Observable
   * 
   * @returns 断开连接事件 observable 流
   */
  onDisconnect(): Observable<BotDisconnectEvent>;

  /**
   * 获取当前连接状态
   */
  getStatus(): BotStatus;

  /**
   * 获取登录二维码 URL（仅扫码登录平台实现，如微信个人号）
   */
  getQrCodeUrl?(): string | null;

  /**
   * 退出登录并清除平台会话（仅扫码登录平台实现）
   */
  logout?(): Promise<void>;

  /**
   * 下载消息附件到指定目录
   * @param message 机器人消息（包含 rawEvent 和 attachments）
   * @param saveDir 保存目录的绝对路径
   * @returns 下载后的本地路径列表，失败返回空数组
   */
  downloadAttachment?(message: BotMessage, saveDir: string): Promise<string[]>;

  /**
   * 优雅关闭(断开连接、清理资源)
   */
  shutdown(): Promise<void>;

  /**
   * 重新连接
   */
  reconnect?(): Promise<void>;

  /**
   * 发送媒体文件（可选实现）
   * @param request 媒体发送请求
   */
  sendMedia?(request: BotMediaRequest): Promise<void>;
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
}
