/**
 * iLink context_token：按 OneBots 账号 + 对端 peer 存 SQLite，会话 JSON 不再写入 contextTokens。
 */
/**
 * iLink context_token 内存存储
 * 简化为内存 Map 实现，不依赖外部 SQLite
 */

/**
 * 读写 context_token
 * - `accountKey`：OneBots 配置里的 `account_id`
 * - `ilinkBotId`：会话中的机器人 `accountId`
 */
export interface ClawbotContextTokenStore {
    get(accountKey: string, ilinkBotId: string, peerId: string): string | undefined;
    set(accountKey: string, ilinkBotId: string, peerId: string, token: string): void;
}

/** 内存实现 */
export class MemoryClawbotContextTokenStore implements ClawbotContextTokenStore {
    private store = new Map<string, string>();

    private key(accountKey: string, peerId: string): string {
        return `${accountKey}:${peerId}`;
    }

    get(accountKey: string, _ilinkBotId: string, peerId: string): string | undefined {
        return this.store.get(this.key(accountKey, peerId));
    }

    set(accountKey: string, _ilinkBotId: string, peerId: string, token: string): void {
        this.store.set(this.key(accountKey, peerId), token);
    }
}
