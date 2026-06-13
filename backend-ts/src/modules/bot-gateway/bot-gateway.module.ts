import { Module, OnModuleInit } from '@nestjs/common';
import { BotInstanceManager } from './services/bot-instance-manager.service';
import { BotAdapterFactory } from './services/bot-adapter.factory';
import { BotOrchestrator } from './services/bot-orchestrator.service';
import { SessionMapperService } from './services/session-mapper.service';
import { BotAdminService } from './services/bot-admin.service';
import { TempFileManager } from './services/temp-file-manager.service';
import { PlatformUtilsService } from './services/platform-utils.service';
import { BotAdminController } from './controllers/bot-admin.controller';
// 适配器不再作为提供者，由工厂直接创建
import { ChatModule } from '../chat/chat.module';
import { AuthModule } from '../auth/auth.module';
import { SharedModule } from '../../common/services/shared.module';
import { ToolsModule } from '../tools/tools.module';
import { ToolOrchestrator } from '../tools/tool-orchestrator.service';
import { SessionManagementToolProvider } from './tools/session-management-tool.provider';


@Module({
  imports: [
    ChatModule, // 引入 AgentService
    AuthModule, // 引入 AuthGuard (需要 JwtService)
    SharedModule, // 引入 SettingsStorage
    ToolsModule,
  ],
  controllers: [BotAdminController],
  providers: [
    BotInstanceManager,
    BotAdapterFactory,
    BotOrchestrator,
    SessionMapperService,
    BotAdminService, // 新增
    TempFileManager, // 临时文件管理器
    PlatformUtilsService, // 平台工具服务
    SessionManagementToolProvider,
    // 适配器不再作为提供者，由工厂直接创建实例

  ],
  exports: [BotInstanceManager], // 导出供其他模块使用
})
export class BotGatewayModule implements OnModuleInit {
  constructor(
    private readonly toolOrchestrator: ToolOrchestrator,
    private readonly sessionMgmtProvider: SessionManagementToolProvider,
  ) {}

  onModuleInit() {
    this.toolOrchestrator.addProvider(this.sessionMgmtProvider);
  }
}
