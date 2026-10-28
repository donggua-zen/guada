/**
 * 平台适配器常用的占位昵称。
 * 这些值不是用户身份，写入 session.data.botUser 会污染会话列表展示。
 */
const PLACEHOLDER_SENDER_NAMES = new Set([
  '用户',
  'user',
  'User',
  'USER',
  'unknown',
  'Unknown',
  'UNKNOWN',
]);

/**
 * 判断 senderName 是否值得作为用户昵称持久化：
 * - 空值/纯空白 → false
 * - 与 senderId 相同（部分平台用 ID 兜底）→ false
 * - 平台占位文案（微信个人号“用户”、QQ/飞书/企微“Unknown”）→ false
 */
export function isMeaningfulSenderName(
  name?: string | null,
  senderId?: string | null,
): boolean {
  const value = name?.trim();
  if (!value) return false;
  if (senderId && value === senderId) return false;
  return !PLACEHOLDER_SENDER_NAMES.has(value);
}
