import { Module, OnModuleInit } from '@nestjs/common';
import { BotInstanceManager } from './services/bot-instance-manager.service';
import { BotAdapterFactory } from './services/bot-adapter.factory';
import { BotOrchestrator } from './services/bot-orchestrator.service';
import { SessionMapperService } from './services/session-mapper.service';
import { BotAdminService } from './services/bot-admin.service';
import { PlatformUtilsService } from './services/platform-utils.service';
import { BotAdminController } from './controllers/bot-admin.controller';
import { ChatModule } from '../chat/chat.module';
import { AuthModule } from '../auth/auth.module';
import { AgentsModule } from '../agents/agents.module';
import { SharedModule } from '../../common/services/shared.module';
import { ToolsModule } from '../tools/tools.module';
import { PluginManager } from '../plugins';
import { SessionManagementPlugin } from './plugins/session-management.plugin';
import { BotFileSenderPlugin } from './plugins/bot-file-sender.plugin';
import { SessionMetaStore } from '../chat/session-meta.store';
import { BotFileStore } from './bot-file.store';

@Module({
  imports: [ChatModule, AgentsModule, AuthModule, SharedModule, ToolsModule],
  controllers: [BotAdminController],
  providers: [
    BotInstanceManager, BotAdapterFactory, BotOrchestrator,
    SessionMapperService, BotAdminService, PlatformUtilsService,
    BotFileStore,
  ],
  exports: [BotInstanceManager, BotFileStore],
})
export class BotGatewayModule implements OnModuleInit {
  constructor(
    private readonly pluginManager: PluginManager,
    private readonly botInstanceManager: BotInstanceManager,
    private readonly sessionStore: SessionMetaStore,
    private readonly botStore: BotFileStore,
  ) {}

  async onModuleInit() {
    // bot store 索引预热（gate 已由 PersistenceModule 迁移脚手架放行）
    await this.botStore.initialize();
    await this.pluginManager.registerPlugin(
      new SessionManagementPlugin(this.sessionStore),
    );
    await this.pluginManager.registerPlugin(new BotFileSenderPlugin(this.botInstanceManager));
  }
}
