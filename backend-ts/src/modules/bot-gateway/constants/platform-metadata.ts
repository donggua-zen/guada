/**
 * 平台配置字段定义
 */
export interface ConfigField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'number' | 'select' | 'boolean';
  required: boolean;
  placeholder?: string;
  description?: string;
  options?: { value: string; label: string }[]; // for select type
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
 * 所有支持的平台元数据
 */
export const PLATFORM_METADATA: Record<string, PlatformMetadata> = {
  qq: {
    platform: 'qq',
    displayName: 'QQ 机器人',
    icon: 'qq',
    description: '接入 QQ 开放平台机器人',
    fields: [
      {
        key: 'appId',
        label: 'App ID',
        type: 'text',
        required: true,
        placeholder: '请输入 QQ 开放平台 App ID',
        description: '在 QQ 开放平台创建应用后获取',
      },
      {
        key: 'appSecret',
        label: 'App Secret',
        type: 'password',
        required: true,
        placeholder: '请输入 App Secret',
        description: '请妥善保管,泄露会导致安全问题',
      },
      // {
      //   key: 'token',
      //   label: 'Bot Token',
      //   type: 'password',
      //   required: false,
      //   placeholder: 'WebSocket 模式可留空',
      //   description: 'WebSocket 模式下 SDK 会自动获取,Webhook 模式必填',
      // },
      // {
      //   key: 'mode',
      //   label: '连接模式',
      //   type: 'select',
      //   required: true,
      //   options: [
      //     { value: 'websocket', label: 'WebSocket (推荐)' },
      //     { value: 'webhook', label: 'Webhook' },
      //   ],
      //   defaultValue: 'websocket',
      // },
      {
        key: 'sandbox',
        label: '沙箱环境',
        type: 'boolean',
        required: false,
        defaultValue: false,
        description: '开发测试时启用',
      },
    ],
  },
  wechat: {
    platform: 'wechat',
    displayName: '微信公众号',
    icon: 'wechat',
    description: '接入微信公众号机器人（服务号/订阅号）',
    fields: [
      {
        key: 'account',
        label: '微信号/手机号',
        type: 'text',
        required: true,
        placeholder: '请输入微信号或绑定的手机号',
        description: '用于登录微信个人号',
      },
      {
        key: 'password',
        label: '密码',
        type: 'password',
        required: false,
        placeholder: '可选,扫码登录可留空',
        description: '微信密码,如使用扫码登录可不填',
      },
      {
        key: 'protocol',
        label: '登录协议',
        type: 'select',
        required: true,
        options: [
          { value: 'web', label: 'Web 协议 (推荐)' },
          { value: 'pad', label: 'Pad 协议' },
        ],
        defaultValue: 'web',
        description: '选择登录协议类型',
      },
      {
        key: 'appId',
        label: 'App ID',
        type: 'text',
        required: true,
        placeholder: '请输入微信公众号 AppID',
        description: '在微信公众平台获取',
      },
      {
        key: 'appSecret',
        label: 'App Secret',
        type: 'password',
        required: true,
        placeholder: '请输入微信公众号 AppSecret',
        description: '请妥善保管',
      },
      {
        key: 'token',
        label: 'Token',
        type: 'password',
        required: true,
        placeholder: '请输入服务器 Token',
        description: '用于验证消息签名',
      },
      {
        key: 'encodingAESKey',
        label: 'EncodingAESKey',
        type: 'password',
        required: false,
        placeholder: '可选,用于消息加密',
        description: '如果启用加密模式则必填',
      },
      {
        key: 'accountType',
        label: '账号类型',
        type: 'select',
        required: true,
        options: [
          { value: 'service', label: '服务号' },
          { value: 'subscription', label: '订阅号' },
        ],
        defaultValue: 'service',
        description: '选择公众号类型',
      },
      {
        key: 'webhookPort',
        label: 'Webhook 端口',
        type: 'number',
        required: false,
        defaultValue: 3002,
        placeholder: '3002',
        description: '接收微信事件的 HTTP 服务器端口',
      },
      {
        key: 'webhookPath',
        label: 'Webhook 路径',
        type: 'text',
        required: false,
        defaultValue: '/webhook/wechat',
        placeholder: '/webhook/wechat',
        description: '接收微信事件的 URL 路径',
      },
    ],
  },
  // TODO: 待实现微信个人号适配器（基于 iLink Bot API）
  // 'wechat-personal': {
  //   platform: 'wechat-personal',
  //   displayName: '微信个人号',
  //   icon: 'wechat',
  //   description: '接入微信个人号机器人（使用 OpenClaw）',
  //   fields: [
  //     {
  //       key: 'authToken',
  //       label: '认证 Token',
  //       type: 'password',
  //       required: true,
  //       placeholder: '请输入 OpenClaw 认证 Token',
  //       description: '通过 openclaw channels login --channel openclaw-weixin 获取',
  //     },
  //     {
  //       key: 'apiUrl',
  //       label: 'API 地址',
  //       type: 'text',
  //       required: false,
  //       defaultValue: 'http://localhost:8080',
  //       placeholder: 'http://localhost:8080',
  //       description: 'OpenClaw 网关 API 地址',
  //     },
  //     {
  //       key: 'pollInterval',
  //       label: '轮询间隔',
  //       type: 'number',
  //       required: false,
  //       defaultValue: 2000,
  //       placeholder: '2000',
  //       description: '消息轮询间隔（毫秒）',
  //     },
  //   ],
  // },
  discord: {
    platform: 'discord',
    displayName: 'Discord Bot',
    icon: 'discord',
    description: '接入 Discord 机器人',
    fields: [
      {
        key: 'token',
        label: 'Bot Token',
        type: 'password',
        required: true,
        placeholder: '请输入 Discord Bot Token',
        description: '在 Discord Developer Portal 获取',
      },
      {
        key: 'clientId',
        label: 'Client ID',
        type: 'text',
        required: false,
        placeholder: '可选,用于 OAuth2',
      },
    ],
  },
  lark: {
    platform: 'lark',
    displayName: '飞书机器人',
    icon: 'lark',
    description: '接入飞书开放平台机器人（WebSocket 长连接）',
    fields: [
      {
        key: 'appId',
        label: 'App ID',
        type: 'text',
        required: true,
        placeholder: '请输入飞书应用 App ID',
        description: '在飞书开放平台创建应用后获取',
      },
      {
        key: 'appSecret',
        label: 'App Secret',
        type: 'password',
        required: true,
        placeholder: '请输入应用 App Secret',
        description: '请妥善保管,泄露会导致安全问题',
      },
      {
        key: 'domain',
        label: 'API 域名',
        type: 'text',
        required: false,
        defaultValue: 'https://open.feishu.cn',
        placeholder: 'https://open.feishu.cn',
        description: '飞书 API 请求域名,国内使用 open.feishu.cn,海外使用 open.larksuite.com',
      },
    ],
  },
  wecom: {
    platform: 'wecom',
    displayName: '企业微信智能机器人',
    icon: 'wecom',
    description: '接入企业微信智能机器人（WebSocket 长连接模式）',
    fields: [
      {
        key: 'botId',
        label: 'Bot ID',
        type: 'text',
        required: true,
        placeholder: '请输入智能机器人 Bot ID',
        description: '在企业微信管理后台「智能机器人」创建后获取',
      },
      {
        key: 'secret',
        label: 'Secret',
        type: 'password',
        required: true,
        placeholder: '请输入智能机器人 Secret',
        description: '长连接专用密钥，请妥善保管',
      },
      {
        key: 'wsUrl',
        label: 'WebSocket URL',
        type: 'text',
        required: false,
        defaultValue: 'wss://openws.work.weixin.qq.com',
        placeholder: 'wss://openws.work.weixin.qq.com',
        description: 'WebSocket 连接地址，私有部署需修改',
      },
      {
        key: 'welcomeMessage.enabled',
        label: '启用欢迎语',
        type: 'boolean',
        required: false,
        defaultValue: true,
        description: '用户首次进入会话时自动发送欢迎语',
      },
      {
        key: 'welcomeMessage.content',
        label: '欢迎语内容',
        type: 'text',
        required: false,
        defaultValue: '您好！我是智能助手，有什么可以帮您的吗？',
        placeholder: '请输入欢迎语内容',
        description: '用户首次进入会话时显示的欢迎消息',
      },
    ],
  },
};
