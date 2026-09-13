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
import { SharedModule } from '../../common/services/shared.module';
import { ToolsModule } from '../tools/tools.module';
import { PluginManager } from '../plugins';
import { SessionManagementPlugin } from './plugins/session-management.plugin';
import { BotFileSenderPlugin } from './plugins/bot-file-sender.plugin';
import { SessionFileStore } from '../chat/session-file.store';
import { BotFileStore } from './bot-file.store';

@Module({
  imports: [ChatModule, AuthModule, SharedModule, ToolsModule],
  controllers: [BotAdminController],
  providers: [
    BotInstanceManager, BotAdapterFactory, BotOrchestrator,
    SessionMapperService, BotAdminService, PlatformUtilsService,
  ],
  exports: [BotInstanceManager],
})
export class BotGatewayModule implements OnModuleInit {
  constructor(
    private readonly pluginManager: PluginManager,
    private readonly botInstanceManager: BotInstanceManager,
    private readonly sessionStore: SessionFileStore,
  ) {}

  async onModuleInit() {
    await this.pluginManager.registerPlugin(
      new SessionManagementPlugin(this.sessionStore),
    );
    await this.pluginManager.registerPlugin(new BotFileSenderPlugin(this.botInstanceManager));
  }
}
