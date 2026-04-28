/**
 * QQ官方机器人SDK封装
 * 
 * 基于QQ官方API实现，支持WebSocket和Webhook两种模式
 * 参考: https://bot.q.qq.com/wiki/
 */
import { EventEmitter } from 'events';
import WebSocket from 'ws';

/**
 * QQ机器人配置
 */
export interface QQBotConfig {
  /** 应用ID */
  appId: string;
  /** 应用密钥 */
  secret: string;
  /** Token（可选，用于Webhook模式） */
  token?: string;
  /** 是否为沙箱环境 */
  sandbox?: boolean;
  /** 接收模式：websocket | webhook */
  mode?: 'websocket' | 'webhook';
  /** 订阅的事件类型 */
  intents?: string[];
  /** 自动移除@机器人内容 */
  removeAt?: boolean;
  /** 最大重试次数 */
  maxRetry?: number;
}

/**
 * QQ用户信息
 */
export interface QQUser {
  id: string;
  username: string;
  avatar: string;
  bot: boolean;
}

/**
 * QQ频道信息
 */
export interface QQGuild {
  id: string;
  name: string;
  icon: string;
  owner_id: string;
  member_count: number;
}

/**
 * QQ子频道信息
 */
export interface QQChannel {
  id: string;
  guild_id: string;
  name: string;
  type: number;
  position: number;
  parent_id: string;
  owner_id: string;
}

/**
 * 群消息事件
 */
export interface QQGroupMessageEvent {
  id: string;
  timestamp: string;
  group_openid: string;
  author: {
    id: string;
    member_openid: string;
  };
  content: string;
  attachments?: any[];
}

/**
 * 私聊消息事件 (C2C)
 */
export interface QQC2CMessageEvent {
  id: string;
  timestamp: string;
  author: {
    id: string;
    user_openid: string;
  };
  content: string;
  attachments?: any[];
}

/**
 * 频道消息事件
 */
export interface QQMessageEvent {
  id: string;
  timestamp: string;
  guild_id: string;
  channel_id: string;
  author: QQUser;
  content: string;
  attachments?: any[];
}

/**
 * 频道私信事件
 */
export interface QQDirectMessageEvent {
  id: string;
  timestamp: string;
  guild_id: string;
  author: QQUser;
  content: string;
  attachments?: any[];
}

/**
 * 发送消息参数
 */
export interface SendMessageParams {
  /** 消息类型：0=文本, 1=图文混排, 2=markdown, 3=模板, 4=ark, 7=富媒体 */
  msg_type?: number;
  /** 文本内容 */
  content?: string;
  /** 图片URL（已废弃，使用 media 代替） */
  image?: string;
  /** 富媒体信息 */
  media?: {
    file_info: string;  // 媒体文件ID
  };
  /** 消息引用 */
  message_reference?: {
    message_id: string;
  };
}

/**
 * 发送结果
 */
export interface MessageSendResult {
  id: string;
  timestamp: string;
}

/**
 * WebSocket Payload
 */
interface WSPayload {
  op: number;
  d?: any;
  s?: number;
  t?: string;
}

/**
 * Gateway响应
 */
interface GatewayResponse {
  url: string;
  shards: number;
  session_start_limit: {
    total: number;
    remaining: number;
    reset_after: number;
    max_concurrency: number;
  };
}

/**
 * QQ官方机器人客户端
 */
export class QQBot extends EventEmitter {
  private config: Required<QQBotConfig>;
  private accessToken: string = '';
  private tokenExpireTime: number = 0;
  private ws: WebSocket | null = null;
  private sessionId: string = '';
  private lastSeq: number = 0;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private reconnectAttempts: number = 0;
  private isResuming: boolean = false;
  private resumeFailCount: number = 0;
  private user: QQUser | null = null;

  private readonly baseURL: string;
  private readonly wsURL: string;

  constructor(config: QQBotConfig) {
    super();
    this.config = {
      sandbox: false,
      removeAt: true,
      maxRetry: 10,
      mode: 'websocket',
      token: '', // 提供默认值
      intents: [
        'GUILDS',
        'GUILD_MEMBERS',
        'GUILD_MESSAGE_REACTIONS',
        'DIRECT_MESSAGE',
        'GROUP_AT_MESSAGE_CREATE',
        'C2C_MESSAGE_CREATE',
        'PUBLIC_GUILD_MESSAGES',
      ],
      ...config,
    };

    // 根据是否为沙箱环境选择API地址
    this.baseURL = this.config.sandbox
      ? 'https://sandbox.api.sgroup.qq.com'
      : 'https://api.sgroup.qq.com';
    this.wsURL = this.config.sandbox
      ? 'wss://sandbox.api.sgroup.qq.com'
      : 'wss://api.sgroup.qq.com';
  }

  /**
   * 获取Access Token
   */
  async getAccessToken(): Promise<string> {
    const now = Date.now();

    // Token有效期检查（提前5分钟刷新）
    if (this.accessToken && this.tokenExpireTime - now > 5 * 60 * 1000) {
      return this.accessToken;
    }

    try {
      // QQ官方Token获取端点
      const response = await fetch('https://bots.qq.com/app/getAppAccessToken', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          appId: this.config.appId,
          clientSecret: this.config.secret,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to get access token: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.access_token) {
        throw new Error(`Invalid token response: ${JSON.stringify(data)}`);
      }

      this.accessToken = data.access_token;
      // expires_in 是秒数，提前300秒刷新
      this.tokenExpireTime = now + (data.expires_in - 300) * 1000;

      this.emit('token_refreshed');
      return this.accessToken;
    } catch (error) {
      console.error('Failed to refresh access token:', error);
      throw error;
    }
  }

  /**
   * 启动机器人
   */
  async start(): Promise<void> {
    if (this.config.mode === 'webhook') {
      // Webhook模式不需要启动WebSocket连接
      this.emit('ready', { user: null });
      return;
    }

    // WebSocket模式
    await this.connectWebSocket();
  }

  /**
   * 停止机器人
   */
  async stop(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.sessionId = '';
    this.lastSeq = 0;
    this.isResuming = false;
    this.resumeFailCount = 0;
  }

  /**
   * 建立WebSocket连接
   */
  private async connectWebSocket(): Promise<void> {
    try {
      // 获取Gateway URL
      const gatewayUrl = await this.getGatewayUrl();

      // 创建WebSocket连接
      this.ws = new WebSocket(gatewayUrl);

      this.ws.on('open', () => {
        console.log('QQ Bot WebSocket connected');
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        const payload: WSPayload = JSON.parse(data.toString());
        this.handleWSPayload(payload);
      });

      this.ws.on('close', (code: number, reason: string) => {
        console.log(`QQ Bot WebSocket closed: ${code} - ${reason}`);
        this.emit('ws_close', code, reason);
        this.handleReconnect(code);
      });

      this.ws.on('error', (error: Error) => {
        console.error('QQ Bot WebSocket error:', error);
        this.emit('error', error);
      });
    } catch (error) {
      console.error('Failed to connect WebSocket:', error);
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * 处理WebSocket Payload
   */
  private handleWSPayload(payload: WSPayload): void {
    this.lastSeq = payload.s || this.lastSeq;

    switch (payload.op) {
      case 10: // Hello
        this.startHeartbeat(payload.d?.heartbeat_interval);
        this.identify();
        break;

      case 11: // Heartbeat ACK
        // 心跳响应，无需处理
        break;

      case 0: // Dispatch
        if (payload.t) {
          this.handleEvent(payload.t, payload.d);
        }
        break;

      case 7: // Reconnect
        this.reconnect();
        break;

      case 9: // Invalid Session
        this.sessionId = '';
        this.identify();
        break;
    }
  }

  /**
   * 开始心跳
   */
  private startHeartbeat(interval: number): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(
          JSON.stringify({
            op: 1,
            d: this.lastSeq,
          }),
        );
      }
    }, interval);
  }

  /**
   * 身份验证
   */
  private async identify(): Promise<void> {
    const token = await this.getAccessToken();

    const identifyPayload = {
      op: 2,
      d: {
        token: `QQBot ${token}`,  // QQ官方要求使用 QQBot
        intents: this.getIntentsValue(),
        shard: [0, 1],
        properties: {
          $os: 'linux',
          $browser: 'my_library',
          $device: 'my_library',
        },
      },
    };

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(identifyPayload));
    }
  }

  /**
   * 恢复会话
   */
  private async resume(): Promise<void> {
    const token = await this.getAccessToken();

    const resumePayload = {
      op: 6,
      d: {
        token: `QQBot ${token}`,  // QQ官方要求使用 QQBot
        session_id: this.sessionId,
        seq: this.lastSeq,
      },
    };

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(resumePayload));
    }
  }

  /**
   * 处理事件
   */
  private handleEvent(eventType: string, data: any): void {
    switch (eventType) {
      case 'READY':
        this.user = data.user;
        this.sessionId = data.session_id;
        this.reconnectAttempts = 0;
        this.resumeFailCount = 0;
        this.emit('ready', { user: this.user });
        break;

      case 'RESUMED':
        this.isResuming = false;
        this.resumeFailCount = 0;
        break;

      case 'AT_MESSAGE_CREATE':
      case 'GROUP_AT_MESSAGE_CREATE':
        this.emit('message.group', data as QQGroupMessageEvent);
        break;

      case 'C2C_MESSAGE_CREATE':
        this.emit('message.private', data as QQC2CMessageEvent);
        break;

      case 'MESSAGE_CREATE':
        this.emit('message.guild', data as QQMessageEvent);
        break;

      case 'DIRECT_MESSAGE_CREATE':
        this.emit('message.direct', data as QQDirectMessageEvent);
        break;

      default:
        // 其他事件透传
        this.emit(eventType, data);
        break;
    }
  }

  /**
   * 重新连接
   */
  private async handleReconnect(code: number): Promise<void> {
    // 清除心跳
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // 判断是否需要重连
    if (code === 1000 || code === 1001) {
      // 正常关闭，不重连
      return;
    }

    // 尝试恢复会话
    if (this.sessionId && this.resumeFailCount < 3) {
      this.isResuming = true;
      this.resumeFailCount++;

      setTimeout(async () => {
        try {
          await this.connectWebSocket();
          await this.resume();
        } catch (error) {
          console.error('Resume failed:', error);
          this.handleReconnect(4000);
        }
      }, 1000);
      return;
    }

    // 重新Identify
    this.reconnectAttempts++;

    if (this.reconnectAttempts > this.config.maxRetry) {
      console.error('Max retry attempts reached');
      return;
    }

    // 指数退避重连
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

    setTimeout(async () => {
      try {
        await this.connectWebSocket();
      } catch (error) {
        console.error('Reconnect failed:', error);
        this.handleReconnect(4000);
      }
    }, delay);
  }

  /**
   * 主动重连
   */
  private async reconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close();
    }

    await this.handleReconnect(4000);
  }

  /**
   * 获取Gateway URL
   */
  private async getGatewayUrl(): Promise<string> {
    const token = await this.getAccessToken();

    const response = await fetch(`${this.baseURL}/gateway`, {
      headers: {
        'Authorization': `QQBot ${token}`,  // QQ官方要求使用 QQBot
        'X-Union-Appid': this.config.appId,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get gateway URL: ${response.status} ${response.statusText}`);
    }

    const data: GatewayResponse = await response.json();
    return `${data.url}?v=1&format=json`;
  }

  /**
   * 计算Intents值
   */
  private getIntentsValue(): number {
    const intentMap: Record<string, number> = {
      GUILDS: 1 << 0,
      GUILD_MEMBERS: 1 << 1,
      GUILD_BANS: 1 << 2,
      GUILD_EMOJIS_AND_STICKERS: 1 << 3,
      GUILD_INTEGRATIONS: 1 << 4,
      GUILD_WEBHOOKS: 1 << 5,
      GUILD_INVITES: 1 << 6,
      GUILD_VOICE_STATES: 1 << 7,
      GUILD_PRESENCES: 1 << 8,
      GUILD_MESSAGES: 1 << 9,
      GUILD_MESSAGE_REACTIONS: 1 << 10,
      GUILD_MESSAGE_TYPING: 1 << 11,
      DIRECT_MESSAGES: 1 << 12,
      DIRECT_MESSAGE_REACTIONS: 1 << 13,
      DIRECT_MESSAGE_TYPING: 1 << 14,
      INTERACTION: 1 << 26,
      MESSAGE_AUDIT: 1 << 27,
      FORUMS_EVENT: 1 << 28,
      AUDIO_ACTION: 1 << 29,
      PUBLIC_GUILD_MESSAGES: 1 << 30,
      GROUP_AT_MESSAGE_CREATE: 1 << 25,
      C2C_MESSAGE_CREATE: 1 << 25,
    };

    let value = 0;
    for (const intent of this.config.intents) {
      if (intentMap[intent]) {
        value |= intentMap[intent];
      }
    }

    return value;
  }

  /**
   * HTTP请求封装
   */
  private async request<T>(
    method: string,
    path: string,
    data?: any,
  ): Promise<T> {
    const token = await this.getAccessToken();

    const response = await fetch(`${this.baseURL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `QQBot ${token}`,  // QQ官方要求使用 QQBot
        'X-Union-Appid': this.config.appId,  // 需要添加此头
      },
      body: data ? JSON.stringify(data) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Request failed: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    return response.json();
  }

  // ============================================
  // 消息发送API
  // ============================================

  /**
   * 上传媒体文件（图片、视频等）
   * QQ官方要求先上传媒体获取file_info，然后在发送消息时引用
   */
  async uploadMedia(
    filePath: string,
    fileType: 'image' | 'video' = 'image',
  ): Promise<{ file_info: string }> {
    const token = await this.getAccessToken();

    // 读取文件
    const fs = await import('fs');
    const path = await import('path');
    const fileBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);

    // 构建 FormData
    const formData = new FormData();
    const blob = new Blob([fileBuffer], {
      type: fileType === 'image' ? 'image/jpeg' : 'video/mp4'
    });
    formData.append('media', blob, fileName);
    formData.append('srv_send_msg', 'false');  // 不立即发送

    // 上传到QQ服务器
    const response = await fetch(`${this.baseURL}/v2/groups/0/files`, {
      method: 'POST',
      headers: {
        'Authorization': `QQBot ${token}`,
        'X-Union-Appid': this.config.appId,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to upload media: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    return { file_info: data.file_info };
  }

  /**
   * 发送群消息
   */
  async sendGroupMessage(
    groupOpenid: string,
    params: SendMessageParams,
  ): Promise<MessageSendResult> {
    return this.request('POST', `/v2/groups/${groupOpenid}/messages`, params);
  }

  /**
   * 发送私聊消息 (C2C)
   */
  async sendC2CMessage(
    userOpenid: string,
    params: SendMessageParams,
  ): Promise<MessageSendResult> {
    return this.request('POST', `/v2/users/${userOpenid}/messages`, params);
  }

  /**
   * 发送频道消息
   */
  async sendChannelMessage(
    channelId: string,
    params: SendMessageParams,
  ): Promise<MessageSendResult> {
    return this.request(
      'POST',
      `/channels/${channelId}/messages`,
      params,
    );
  }

  /**
   * 发送频道私信
   */
  async sendDMSMessage(
    guildId: string,
    params: SendMessageParams,
  ): Promise<MessageSendResult> {
    // 需要先创建DM会话
    const dms = await this.createDMS(guildId);
    return this.request(
      'POST',
      `/dms/${dms.guild_id}/messages`,
      params,
    );
  }

  /**
   * 创建私信会话
   */
  async createDMS(guildId: string): Promise<{ guild_id: string; channel_id: string }> {
    return this.request('POST', `/users/@me/dms`, {
      recipient_id: guildId,
      source_guild_id: guildId,
    });
  }

  /**
   * 撤回频道消息
   */
  async recallChannelMessage(
    channelId: string,
    messageId: string,
  ): Promise<void> {
    await this.request(
      'DELETE',
      `/channels/${channelId}/messages/${messageId}`,
    );
  }

  /**
   * 撤回频道私信
   */
  async recallDMSMessage(
    guildId: string,
    messageId: string,
  ): Promise<void> {
    await this.request(
      'DELETE',
      `/dms/${guildId}/messages/${messageId}`,
    );
  }

  // ============================================
  // 频道管理API
  // ============================================

  /**
   * 获取机器人信息
   */
  async getSelfInfo(): Promise<QQUser> {
    return this.request('GET', '/v2/users/@me');
  }

  /**
   * 获取频道列表
   */
  async getGuilds(): Promise<QQGuild[]> {
    return this.request('GET', '/users/@me/guilds');
  }

  /**
   * 获取频道信息
   */
  async getGuild(guildId: string): Promise<QQGuild> {
    return this.request('GET', `/guilds/${guildId}`);
  }

  /**
   * 获取子频道列表
   */
  async getChannels(guildId: string): Promise<QQChannel[]> {
    return this.request('GET', `/guilds/${guildId}/channels`);
  }

  /**
   * 获取子频道信息
   */
  async getChannel(channelId: string): Promise<QQChannel> {
    return this.request('GET', `/channels/${channelId}`);
  }

  /**
   * 创建子频道
   */
  async createChannel(
    guildId: string,
    params: {
      name: string;
      type: number;
      parent_id?: string;
    },
  ): Promise<QQChannel> {
    return this.request('POST', `/guilds/${guildId}/channels`, params);
  }

  /**
   * 更新子频道
   */
  async updateChannel(
    channelId: string,
    params: {
      name?: string;
      parent_id?: string;
    },
  ): Promise<void> {
    await this.request('PATCH', `/channels/${channelId}`, params);
  }

  /**
   * 删除子频道
   */
  async deleteChannel(channelId: string): Promise<void> {
    await this.request('DELETE', `/channels/${channelId}`);
  }

  /**
   * 获取频道成员信息
   */
  async getGuildMember(
    guildId: string,
    userId: string,
  ): Promise<any> {
    return this.request('GET', `/guilds/${guildId}/members/${userId}`);
  }

  /**
   * 踢出频道成员
   */
  async kickGuildMember(
    guildId: string,
    userId: string,
    addBlacklist?: boolean,
  ): Promise<void> {
    await this.request(
      'DELETE',
      `/guilds/${guildId}/members/${userId}`,
      { add_blacklist: addBlacklist },
    );
  }

  /**
   * 禁言频道成员
   */
  async muteGuildMember(
    guildId: string,
    userId: string,
    muteEndTime?: string,
    seconds?: string,
  ): Promise<void> {
    await this.request(
      'PATCH',
      `/guilds/${guildId}/members/${userId}/mute`,
      {
        mute_end_timestamp: muteEndTime,
        mute_seconds: seconds,
      },
    );
  }

  /**
   * 全员禁言
   */
  async muteGuild(
    guildId: string,
    muteEndTime?: string,
    seconds?: string,
  ): Promise<void> {
    await this.request(
      'PATCH',
      `/guilds/${guildId}/mute`,
      {
        mute_end_timestamp: muteEndTime,
        mute_seconds: seconds,
      },
    );
  }
}
