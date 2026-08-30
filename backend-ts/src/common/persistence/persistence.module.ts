/**
 * 持久化存储模块（全局）
 *
 * 存储抽象独立于 chat 业务层：
 * - PERSISTENCE_BACKEND_TOKEN：物理后端（文件/数据库），当前注册 JsonlBackend
 * - MESSAGE_STORE_TOKEN：业务存储（三层模型），经工厂按 STORAGE_BACKEND 环境变量选择实现
 *   （默认 'jsonl'；未来新增后端（如 sqlite/postgres）只需实现 IMessageStore /
 *   PersistenceBackend 并在下方工厂注册分支，chat 层零改动）
 */
import { Module, Global } from '@nestjs/common';
import { JsonlBackend } from './jsonl-backend';
import { JsonlMessageService } from './jsonl-message.service';
import { MESSAGE_STORE_TOKEN } from './message-store.interface';
import {
  PERSISTENCE_BACKEND_TOKEN,
  PersistenceBackend,
} from './types';

@Global()
@Module({
  providers: [
    JsonlBackend,
    { provide: PERSISTENCE_BACKEND_TOKEN, useExisting: JsonlBackend },
    {
      provide: MESSAGE_STORE_TOKEN,
      inject: [PERSISTENCE_BACKEND_TOKEN],
      useFactory: (backend: PersistenceBackend) => {
        const backendName = process.env.STORAGE_BACKEND ?? 'jsonl';
        switch (backendName) {
          case 'jsonl':
            return new JsonlMessageService(backend);
          default:
            throw new Error(
              `Unknown STORAGE_BACKEND: ${backendName} (supported: jsonl)`,
            );
        }
      },
    },
  ],
  exports: [PERSISTENCE_BACKEND_TOKEN, MESSAGE_STORE_TOKEN],
})
export class PersistenceModule {}