import { Module, Global, Logger } from '@nestjs/common';
import { JsonlBackend } from './jsonl-backend';
import { JsonlMessageService } from './jsonl-message.service';
import { MESSAGE_STORE_TOKEN } from './message-store.interface';
import { MESSAGE_EVENT_LOG } from './event-log.port';
import type { MessageEventLog } from './event-log.port';
import {
  createStoreDriver,
  resolveStoreDriverName,
} from '../store/driver-registry';

const logger = new Logger('PersistenceModule');

/**
 * 持久化机制层（全局）
 *
 * 本模块只装「机制」，不装任何域 store——各域 FileStore 的文件、注册、生命周期
 * 一律归各自域模块（文件在哪、注册就在哪），跨域消费者显式 import 对方域模块。
 * 唯一例外是基座层的 ProviderFileStore（留在 LlmCoreModule @Global：它是被几乎
 * 所有域读的模型引用解析底座）。
 *
 * 装配内容：
 * - `MESSAGE_EVENT_LOG`：**介质**（事件日志后端）。经驱动注册表按
 *   `GUADA_STORE_DRIVER_MESSAGES` / `GUADA_STORE_DRIVER` 选择；缺省 `jsonl`
 *   （JsonlBackend）。企业包启动前 `registerStoreDriver('messages', 'postgres', …)`
 *   即可换库。
 * - `MESSAGE_STORE_TOKEN`：**业务存储**（三层模型）。业务实现只有 JsonlMessageService
 *   一个——seq 分配、折叠、快照、写互斥都留在这里，换介质不会长出第二套语义。
 *
 * 会话元信息（`sessions/_meta.db`）与知识库（`kb.db`）的读写由各域 store 经
 * `common/store` 的端口完成，不经过本模块。
 */
@Global()
@Module({
  providers: [
    // 内置 JSONL 驱动：既是默认实现，也是 `createStoreDriver` 的 fallback
    JsonlBackend,
    {
      provide: MESSAGE_EVENT_LOG,
      inject: [JsonlBackend],
      useFactory: (jsonl: JsonlBackend): MessageEventLog =>
        createStoreDriver<MessageEventLog>('messages', () => jsonl),
    },
    {
      provide: MESSAGE_STORE_TOKEN,
      inject: [MESSAGE_EVENT_LOG],
      useFactory: (eventLog: MessageEventLog) => {
        // 业务实现唯一；驱动差异全部收在 MessageEventLog 之后。
        return new JsonlMessageService(eventLog);
      },
    },
  ],
  exports: [MESSAGE_EVENT_LOG, MESSAGE_STORE_TOKEN],
})
export class PersistenceModule {
  constructor() {
    // 归属本模块的域：只报 messages（sessions/usage 由 StoreModule 报），
    // 避免两处各报一遍、也避免某处报出未接线的域。
    logger.log(`事件日志驱动 messages=${resolveStoreDriverName('messages')}`);
  }
}
