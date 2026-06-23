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
import { PrismaService } from '../../common/database/prisma.service';
import { SessionManagementPlugin } from './plugins/session-management.plugin';

@Module({
  imports: [ChatModule, AuthModule, SharedModule, ToolsModule],
  controllers: [BotAdminController],
  providers: [
    BotInstanceManager, BotAdapterFactory, BotOrchestrator,
    SessionMapperService, BotAdminService, PlatformUtilsService,
    PrismaService,
  ],
  exports: [BotInstanceManager],
})
export class BotGatewayModule implements OnModuleInit {
  constructor(
    private readonly pluginManager: PluginManager,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    await this.pluginManager.registerPlugin(new SessionManagementPlugin(this.prisma));
  }
}
