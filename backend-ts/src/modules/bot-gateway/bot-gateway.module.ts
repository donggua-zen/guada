import { Module } from '@nestjs/common';
import { BotInstanceManager } from './services/bot-instance-manager.service';
import { BotAdapterFactory } from './services/bot-adapter.factory';
import { BotOrchestrator } from './services/bot-orchestrator.service';
import { SessionMapperService } from './services/session-mapper.service';
import { BotAdminService } from './services/bot-admin.service';
import { BotAdminController } from './controllers/bot-admin.controller';
import { QQBotAdapter } from './adapters/qq-bot.adapter';
import { ChatModule } from '../chat/chat.module';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../../common/database/database.module';
import { SharedModule } from '../../common/services/shared.module';
import { MessageRepository } from '../../common/database/message.repository';
import { PrismaService } from '../../common/database/prisma.service';

@Module({
  imports: [
    ChatModule, // 引入 AgentService
    AuthModule, // 引入 AuthGuard (需要 JwtService)
    DatabaseModule, // 引入数据库访问(包含 PrismaService 和 Repositories)
    SharedModule, // 引入 SettingsStorage
  ],
  controllers: [BotAdminController],
  providers: [
    BotInstanceManager,
    BotAdapterFactory,
    BotOrchestrator,
    SessionMapperService,
    BotAdminService, // 新增
    QQBotAdapter, // 注册QQ适配器
    MessageRepository, // 提供 MessageRepository
    PrismaService, // 提供 PrismaService
    // 未来扩展: WeChatBotAdapter, DiscordBotAdapter
  ],
  exports: [BotInstanceManager], // 导出供其他模块使用
})
export class BotGatewayModule {}
