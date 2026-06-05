/**
 * 全局客户端 ID 管理
 * 每次页面加载生成新的 UUID，刷新自动更新
 * 使用 crypto.randomUUID() 保证分布式唯一性
 */

/**
 * 生成客户端唯一标识（UUID v4）
 * 优先使用 crypto.randomUUID()，降级使用 crypto.getRandomValues()
 */
function generateClientId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  // 降级方案：使用 crypto.getRandomValues 生成 UUID v4
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  // 设置 UUID v4 版本位（第7个字节的高4位为0100）
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  // 设置 UUID 变体位（第9个字节的高2位为10）
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

// 页面级单例，每次加载生成新的 clientId
let _clientId: string | null = null;

export function getClientId(): string {
  if (!_clientId) {
    _clientId = generateClientId();
  }
  return _clientId;
}

export function refreshClientId(): string {
  _clientId = generateClientId();
  return _clientId;
}
