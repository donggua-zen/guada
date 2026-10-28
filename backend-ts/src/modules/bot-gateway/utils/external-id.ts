/**
 * 外部会话信息
 */
export interface ExternalSessionInfo {
  platform: string;
  type: 'private' | 'group';
  nativeId: string;
}

/**
 * 构建外部会话唯一标识
 * 格式: platform:type:nativeId
 * 示例: qq:private:AA7F81..., qq:group:12345...
 */
export function buildExternalId(
  platform: string,
  type: 'private' | 'group',
  nativeId: string,
): string {
  return `${platform}:${type}:${nativeId}`;
}

/**
 * 解析外部会话标识
 */
export function parseExternalId(externalId: string): ExternalSessionInfo | null {
  const parts = externalId.split(':');
  if (parts.length !== 3) {
    return null;
  }

  const [platform, type, nativeId] = parts;

  if (type !== 'private' && type !== 'group') {
    return null;
  }

  return { platform, type, nativeId };
}

/**
 * 判断是否是 Bot 会话的外部标识
 */
export function isExternalId(value: string): boolean {
  return value.includes(':');
}

/**
 * 为 externalId 添加重置标记（用于清空会话场景）
 * @param externalId 原始 externalId
 * @returns 带时间戳后缀的新 externalId
 */
export function appendResetMarker(externalId: string): string {
  const timestamp = Date.now();
  return `${externalId}@${timestamp}`;
}

/**
 * 清空标记：externalId 末尾的 `@<毫秒时间戳>`。
 *
 * 不能只判断 `includes('@')`：微信个人号的 externalId 本身可能带
 * `@im.wechat` 这类平台后缀，误判会让用户行错误标记为「已清空」。
 */
const RESET_MARKER_PATTERN = /@(\d{10,})$/;

/**
 * 从 externalId 中提取基础部分（去除重置标记）
 * @param externalId 可能包含重置标记的 externalId
 * @returns 基础 externalId
 */
export function extractBaseExternalId(externalId: string): string {
  const match = RESET_MARKER_PATTERN.exec(externalId);
  if (!match) {
    return externalId;
  }
  return externalId.slice(0, match.index);
}

/**
 * 检查 externalId 是否包含重置标记
 */
export function hasResetMarker(externalId: string): boolean {
  return RESET_MARKER_PATTERN.test(externalId);
}

/**
 * 获取重置时间戳（如果存在）
 */
export function getResetTimestamp(externalId: string): number | null {
  const match = RESET_MARKER_PATTERN.exec(externalId);
  if (!match) {
    return null;
  }
  const timestamp = parseInt(match[1], 10);
  return isNaN(timestamp) ? null : timestamp;
}
