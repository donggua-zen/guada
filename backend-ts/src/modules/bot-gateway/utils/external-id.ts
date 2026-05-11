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
 * 从 externalId 中提取基础部分（去除重置标记）
 * @param externalId 可能包含重置标记的 externalId
 * @returns 基础 externalId
 */
export function extractBaseExternalId(externalId: string): string {
  const atIndex = externalId.indexOf('@');
  if (atIndex === -1) {
    return externalId;
  }
  return externalId.substring(0, atIndex);
}

/**
 * 检查 externalId 是否包含重置标记
 */
export function hasResetMarker(externalId: string): boolean {
  return externalId.includes('@');
}

/**
 * 获取重置时间戳（如果存在）
 */
export function getResetTimestamp(externalId: string): number | null {
  const atIndex = externalId.indexOf('@');
  if (atIndex === -1) {
    return null;
  }
  const timestampStr = externalId.substring(atIndex + 1);
  const timestamp = parseInt(timestampStr, 10);
  return isNaN(timestamp) ? null : timestamp;
}
