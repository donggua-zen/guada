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
      {
        key: 'token',
        label: 'Bot Token',
        type: 'password',
        required: false,
        placeholder: 'WebSocket 模式可留空',
        description: 'WebSocket 模式下 SDK 会自动获取,Webhook 模式必填',
      },
      {
        key: 'mode',
        label: '连接模式',
        type: 'select',
        required: true,
        options: [
          { value: 'websocket', label: 'WebSocket (推荐)' },
          { value: 'webhook', label: 'Webhook' },
        ],
        defaultValue: 'websocket',
      },
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
    displayName: '微信机器人',
    icon: 'wechat',
    description: '接入企业微信或微信公众号',
    fields: [
      {
        key: 'corpId',
        label: '企业 ID',
        type: 'text',
        required: true,
        placeholder: '请输入企业微信 CorpID',
      },
      {
        key: 'agentId',
        label: 'Agent ID',
        type: 'text',
        required: true,
        placeholder: '请输入应用 AgentID',
      },
      {
        key: 'secret',
        label: 'Secret',
        type: 'password',
        required: true,
        placeholder: '请输入应用 Secret',
      },
      {
        key: 'token',
        label: 'Token',
        type: 'password',
        required: false,
        description: '用于验证消息签名',
      },
      {
        key: 'encodingAESKey',
        label: 'EncodingAESKey',
        type: 'password',
        required: false,
        description: '消息加解密密钥',
      },
    ],
  },
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
};
