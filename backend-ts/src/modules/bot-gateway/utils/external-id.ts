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
