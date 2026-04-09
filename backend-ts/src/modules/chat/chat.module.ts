import { Module, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { SessionRepository } from '../../common/database/session.repository';
import { MessageRepository } from '../../common/database/message.repository';
import { MessageContentRepository } from '../../common/database/message-content.repository';
import { CharacterRepository } from '../../common/database/character.repository';
import { KnowledgeBaseRepository } from '../../common/database/knowledge-base.repository';
import { ModelRepository } from '../../common/database/model.repository';
import { GlobalSettingRepository } from '../../common/database/global-setting.repository';
import { AgentService } from './agent.service';
import { LLMService } from './llm.service';
import { OpenAIAdapter } from './adapters/openai.adapter';
import { GeminiAdapter } from './adapters/gemini.adapter';
import { MemoryManagerService } from './memory.service';
import { ToolOrchestrator } from '../tools/tool-orchestrator.service';
import { ChatController } from './chat.controller';
import { MessagesController } from './messages.controller';
import { SessionsController } from './sessions.controller';
import { MessageService } from './message.service';
import { SessionService } from './session.service';
import { AuthModule } from '../auth/auth.module';
import { ToolsModule } from '../tools/tools.module';

@Module({
  imports: [AuthModule, ToolsModule],
  controllers: [ChatController, MessagesController, SessionsController],
  providers: [
    AgentService, 
    LLMService,
    OpenAIAdapter,
    GeminiAdapter,
    MemoryManagerService,
    MessageService,
    SessionService,
    SessionRepository, 
    MessageRepository,
    MessageContentRepository, 
    CharacterRepository,
    KnowledgeBaseRepository,
    ModelRepository,
    GlobalSettingRepository,
    PrismaService
  ],
  exports: [AgentService],
})
export class ChatModule implements OnModuleInit {
  constructor(
    private toolOrchestrator: ToolOrchestrator, // 从 ToolsModule 注入
  ) {}

  onModuleInit() {
    // KnowledgeBaseToolProvider 已在 ToolsModule 中注册，无需再次添加
  }
}
