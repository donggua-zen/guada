import { Injectable, Logger } from "@nestjs/common";

/**
 * 会话锁状态信息
 */
export interface SessionLockStatus {
  isLocked: boolean;
  lockedAt?: Date;
}

@Injectable()
export class SessionLockService {
  private readonly logger = new Logger(SessionLockService.name);
  private readonly locks: Map<string, boolean> = new Map();
  private readonly lockTimestamps: Map<string, Date> = new Map();

  /**
   * 尝试获取会话锁
   * @param sessionId 会话 ID
   * @returns 是否成功获取锁
   */
  tryLock(sessionId: string): boolean {
    if (this.locks.has(sessionId)) {
      this.logger.warn(`Session ${sessionId} is currently busy`);
      return false;
    }
    this.locks.set(sessionId, true);
    this.lockTimestamps.set(sessionId, new Date());
    this.logger.debug(`Locked session ${sessionId}`);
    return true;
  }

  /**
   * 释放会话锁
   * @param sessionId 会话 ID
   */
  unlock(sessionId: string): void {
    this.locks.delete(sessionId);
    this.lockTimestamps.delete(sessionId);
    this.logger.debug(`Unlocked session ${sessionId}`);
  }

  /**
   * 获取会话锁状态
   * @param sessionId 会话 ID
   * @returns 会话锁状态信息
   */
  getLockStatus(sessionId: string): SessionLockStatus {
    const isLocked = this.locks.has(sessionId);
    const lockedAt = this.lockTimestamps.get(sessionId);
    
    return {
      isLocked,
      lockedAt,
    };
  }
}
