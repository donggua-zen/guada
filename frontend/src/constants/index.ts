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

/**
 * 小窗阈值（CSS px）：窗口宽度小于它时，侧边栏自动收起，避免内容区被侧栏挤成一条。
 *
 * 自动收起只切换「当前是否显示」的运行时状态，不改写用户偏好（sidebarVisible 持久化值）——
 * 窗口回到阈值以上即自动交还给偏好，所以在大窗里启动不会出现侧栏凭空少一次展开。
 *
 * 取值等于 Tailwind 默认 lg 断点，也正是原先移动端悬浮抽屉的启用宽度
 * （见 SidebarLayout 的 max-lg:absolute 与 MOBILE_DRAWER_ENABLED）：两处「小窗」必须是同一阈值，
 * 后续做移动端适配时沿用本常量，不要再另起一套断点。
 */
export const SIDEBAR_AUTO_COLLAPSE_WIDTH = 1024
