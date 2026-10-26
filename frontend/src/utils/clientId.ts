/**
 * 全局客户端 ID 管理
 * 每次页面加载生成新的 UUID，刷新自动更新
 */
import { generateUuid } from "./uuid";

function generateClientId(): string {
  return generateUuid();
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
