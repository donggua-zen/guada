/**
 * 应用常量定义
 * 统一管理各功能模块的默认值，修改一处即可全局生效
 */

/** 默认摘要模式，未显式设置时使用。当前为 memory_sync（记忆同步） */
export const DEFAULT_SUMMARY_MODE = 'memory_sync' as const

/** 附加工作目录附件类型：session.settings.attachments 的键，值为远程连接 ID 数组 */
export const SSH_CONNECTION_ATTACHMENT_TYPE = 'ssh-connection' as const
