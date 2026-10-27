import { Module, Global } from '@nestjs/common';
import { JsonlBackend } from './jsonl-backend';
import { JsonlMessageService } from './jsonl-message.service';
import { MESSAGE_STORE_TOKEN } from './message-store.interface';
import {
  PERSISTENCE_BACKEND_TOKEN,
  PersistenceBackend,
} from './types';

/**
 * 持久化机制层（全局）
 *
 * 本模块只装「机制」，不装任何域 store——各域 FileStore 的文件、注册、生命周期
 * 一律归各自域模块（文件在哪、注册就在哪），跨域消费者显式 import 对方域模块。
 * 唯一例外是基座层的 ProviderFileStore（留在 LlmCoreModule @Global：它是被几乎
 * 所有域读的模型引用解析底座）。
 *
 * 装配内容：
 * - PERSISTENCE_BACKEND_TOKEN：物理后端（文件/数据库），当前注册 JsonlBackend
 * - MESSAGE_STORE_TOKEN：业务存储（三层模型），经工厂按 STORAGE_BACKEND 环境变量
 *   选择实现（默认 'jsonl'；未来新增后端（如 sqlite/postgres）只需实现
 *   IMessageStore / PersistenceBackend 并在下方工厂注册分支，chat 层零改动）
 *
 * 会话元信息（`sessions/_meta.db`）与知识库（`kb.db`）的 SQLite 读写由各域
 * store 直接用 better-sqlite3 完成，不经过本模块。
 */
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
