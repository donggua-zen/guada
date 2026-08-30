import { Inject, Injectable } from '@nestjs/common';
import { ISessionContext } from './session-context';
import { JsonlSessionContextFactory } from './jsonl-session-context.factory';
import {
  IMessageStore,
  MESSAGE_STORE_TOKEN,
} from '../../common/persistence/message-store.interface';

/**
 * SessionContext 工厂
 *
 * 所有会话统一走持久化存储后端（由 MESSAGE_STORE_TOKEN 注入，不感知具体实现）：
 * - 已迁移会话 → 直接读现有存储
 * - 新会话 → ensureSession 自动创建（不写 DB）
 */
@Injectable()
export class SessionContextFactory {
  constructor(
    private jsonlSessionContextFactory: JsonlSessionContextFactory,
    @Inject(MESSAGE_STORE_TOKEN) private messageStore: IMessageStore,
  ) {}

  async createFromSession(session: any): Promise<ISessionContext> {
    await this.messageStore.ensureSession(session.id, { title: session.title });
    return this.jsonlSessionContextFactory.createFromSession(session);
  }
}
