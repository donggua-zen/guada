import { Module, Global } from '@nestjs/common';
import { JsonlBackend } from './jsonl-backend';
import { JsonlMessageService } from './jsonl-message.service';
import { MESSAGE_STORE_TOKEN } from './message-store.interface';
import {
  PERSISTENCE_BACKEND_TOKEN,
  PersistenceBackend,
} from './types';
import { PrismaService } from '../database/prisma.service';
import { MigrationRunner } from '../database/migration-runner.service';
import { MetadataBootstrapGate } from '../database/metadata-bootstrap.gate';
import { AgentFileBootstrapService } from '../database/bootstrap/agent-file-bootstrap.service';
import { ProviderBootstrapService } from '../database/bootstrap/provider-bootstrap.service';
import { AccountBootstrapService } from '../database/bootstrap/account-bootstrap.service';
import { MetadataFileBootstrapService } from '../database/bootstrap/metadata-file-bootstrap.service';
import { MigrationBootstrapService } from '../database/bootstrap/migration-bootstrap.service';
import { KbMigrationBootstrapService } from '../database/bootstrap/kb-migration-bootstrap.service';
import { SessionMessageDbMigratorService } from '../database/bootstrap/session-message-db-migrator.service';
import { SessionMessageMigrationBootstrapService } from '../database/bootstrap/session-message-migration-bootstrap.service';

/**
 * 持久化机制层（全局）
 *
 * 本模块只装「机制」与**临时**迁移脚手架，不装任何域 store——各域 FileStore
 * 的文件、注册、生命周期一律归各自域模块（文件在哪、注册就在哪），跨域消费者
 * 显式 import 对方域模块。唯一例外是基座层的 ProviderFileStore（留在
 * LlmCoreModule @Global：它是被几乎所有域读的模型引用解析底座）。
 *
 * 装配内容：
 * - PERSISTENCE_BACKEND_TOKEN：物理后端（文件/数据库），当前注册 JsonlBackend
 * - MESSAGE_STORE_TOKEN：业务存储（三层模型），经工厂按 STORAGE_BACKEND 环境变量
 *   选择实现（默认 'jsonl'；未来新增后端（如 sqlite/postgres）只需实现
 *   IMessageStore / PersistenceBackend 并在下方工厂注册分支，chat 层零改动）
 * - PrismaService / MigrationRunner / MetadataBootstrapGate：冻结主库与门控
 * - bootstrap/ 一次性 DB→文件迁移脚手架（⚠️ 临时，两个版本后随主库整体移除）。
 *   脚手架**自持构造**所需 store（不经 DI），因此本模块不 import 任何域模块——
 *   反向 import 会把域模块初始化提到迁移导出之前（AgentSeedService 在
 *   init 期读写 store，会在空目录上补种）。
 *
 * ⚠️ 初始化顺序约束：本模块在 app.module.ts 必须位于所有域模块之前
 * （迁移导出与 gate 放行先于域模块的 onModuleInit——AgentSeedService 补种、
 * 各 store 索引预热都依赖该顺序）。
 */
const SCAFFOLD_PROVIDERS = [
  // 门控必须先于各 bootstrap 提供（bootstrap 构造期注入）
  MetadataBootstrapGate,
  AgentFileBootstrapService,
  ProviderBootstrapService,
  AccountBootstrapService,
  MetadataFileBootstrapService,
  KbMigrationBootstrapService,
  // 会话消息 DB → JSONL（含 meta 骨架修复；编排顺序见 MigrationBootstrapService）
  SessionMessageDbMigratorService,
  SessionMessageMigrationBootstrapService,
  // 编排器必须最后注册：唯一 OnModuleInit，按序调用上面各 bootstrap 的 run()
  MigrationBootstrapService,
];

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
    PrismaService,
    MigrationRunner,
    ...SCAFFOLD_PROVIDERS,
  ],
  exports: [
    PERSISTENCE_BACKEND_TOKEN,
    MESSAGE_STORE_TOKEN,
    PrismaService,
    MigrationRunner,
    ...SCAFFOLD_PROVIDERS,
  ],
})
export class PersistenceModule {}
