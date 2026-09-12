/**
 * 应用常量定义
 * 统一管理各功能模块的默认值，修改一处即可全局生效
 */

/** 压缩策略档位（与后端 compression-tiers.ts 的 CompressionTier 值一致） */
export type CompressionTier = 'off' | 'conservative' | 'aggressive'

/** 默认压缩档位，未显式设置时使用 */
export const DEFAULT_COMPRESSION_TIER: CompressionTier = 'conservative'

/** 附加工作目录附件类型：session.settings.attachments 的键，值为远程连接 ID 数组 */
export const SSH_CONNECTION_ATTACHMENT_TYPE = 'ssh-connection' as const

/** 压缩档位选项（i18n key 指向 characters.setting.*） */
export const COMPRESSION_TIER_OPTIONS = [
  { value: 'off', labelKey: 'characters.setting.tierOff', descKey: 'characters.setting.tierOffDesc' },
  { value: 'conservative', labelKey: 'characters.setting.tierConservative', descKey: 'characters.setting.tierConservativeDesc' },
  { value: 'aggressive', labelKey: 'characters.setting.tierAggressive', descKey: 'characters.setting.tierAggressiveDesc' },
] as const
