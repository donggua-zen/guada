import { Module } from '@nestjs/common';
import { BotInstanceManager } from './services/bot-instance-manager.service';
import { BotAdapterFactory } from './services/bot-adapter.factory';
import { BotOrchestrator } from './services/bot-orchestrator.service';
import { SessionMapperService } from './services/session-mapper.service';
import { BotAdminService } from './services/bot-admin.service';
import { BotAdminController } from './controllers/bot-admin.controller';
import { QQBotAdapter } from './adapters/qq-bot.adapter';
import { LarkBotAdapter } from './adapters/lark-bot.adapter';
// TODO: 微信公众号适配器（已注释，使用 OneBots）
// import { WeChatBotAdapter } from './adapters/wechat-bot.adapter';
import { WeComAiBotAdapter } from './adapters/wecom-aibot.adapter';
// TODO: 企业微信应用消息适配器（已隐藏，使用智能机器人长连接模式）
// import { WeComAppBotAdapter } from './adapters/wecom-app-bot.adapter';
// TODO: 待实现微信个人号适配器
// import { WeChatPersonalBotAdapter } from './adapters/wechat-personal-bot.adapter';
import { ChatModule } from '../chat/chat.module';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../../common/database/database.module';
import { SharedModule } from '../../common/services/shared.module';
import { MessageRepository } from '../../common/database/message.repository';
import { KnowledgeBaseRepository } from '../../common/database/knowledge-base.repository';
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
    LarkBotAdapter, // 注册飞书适配器
    // TODO: 微信公众号适配器（已注释，使用 OneBots）
    // WeChatBotAdapter, // 注册微信公众号适配器
    WeComAiBotAdapter, // 注册企业微信智能机器人适配器（WebSocket 长连接）
    // WeComAppBotAdapter, // 企业微信应用消息适配器（已隐藏）
    // TODO: 待实现微信个人号适配器
    // WeChatPersonalBotAdapter, // 注册微信个人号适配器
    MessageRepository, // 提供 MessageRepository
    KnowledgeBaseRepository, // 提供 KnowledgeBaseRepository
    PrismaService, // 提供 PrismaService
    // 未来扩展: WeChatBotAdapter, DiscordBotAdapter
  ],
  exports: [BotInstanceManager], // 导出供其他模块使用
})
export class BotGatewayModule {}
