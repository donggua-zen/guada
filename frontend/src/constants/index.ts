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

/**
 * 新建会话的路由哨兵 id（路径 `/chat/new-session`）。
 *
 * 它只是路由占位，**不是会话 id**：可以赋给 activeSessionId 或用作路由参数，但绝不能拿它
 * 去调后端接口——后端的会话存储是懒创建的，会因此凭空建出 `<data>/sessions/new-session/`
 * 幽灵目录，会话类接口也会按未知会话报错（曾实测出现该目录；后端已加 assertValidId 兜底）。
 */
export const NEW_SESSION_ID = 'new-session' as const

/** 压缩档位选项（i18n key 指向 agents.setting.*） */
export const COMPRESSION_TIER_OPTIONS = [
  { value: 'off', labelKey: 'agents.setting.tierOff', descKey: 'agents.setting.tierOffDesc' },
  { value: 'conservative', labelKey: 'agents.setting.tierConservative', descKey: 'agents.setting.tierConservativeDesc' },
  { value: 'aggressive', labelKey: 'agents.setting.tierAggressive', descKey: 'agents.setting.tierAggressiveDesc' },
] as const
