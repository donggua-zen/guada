import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { DatabaseModule } from "./common/database/database.module";
import { UploadModule } from "./common/upload/upload.module";
import { SharedModule } from "./common/services/shared.module";
import { ChatModule } from "./modules/chat/chat.module";
import { ModelsModule } from "./modules/models/models.module";
import { AuthModule } from "./modules/auth/auth.module";
import { CharactersModule } from "./modules/characters/characters.module";
import { FilesModule } from "./modules/files/files.module";
import { McpServersModule } from "./modules/mcp-servers/mcp-servers.module";
import { SettingsModule } from "./modules/settings/settings.module";
import { UsersModule } from "./modules/users/users.module";
import { ToolsModule } from "./modules/tools/tools.module";
import { KnowledgeBaseModule } from "./modules/knowledge-base/knowledge-base.module";
import { VectorDbModule } from "./common/vector-db";
import { McpClientModule } from "./common/mcp/mcp-client.module";
import { BotGatewayModule } from "./modules/bot-gateway/bot-gateway.module";
import { SkillsModule } from './modules/skills/skills.module';
import { LlmCoreModule } from './modules/llm-core/providers.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';
import { SubAgentModule } from './modules/sub-agent/sub-agent.module';
import { TeamModule } from './modules/team/team.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    EventEmitterModule.forRoot({
      // 全局事件发射器，供模块间解耦通信
      wildcard: false,
      delimiter: '.',
      maxListeners: 20,
    }),
    LlmCoreModule, // LLM 核心模块（全局）
    DatabaseModule, // 全局数据库模块（包含 PrismaService 和 Repositories）
    SharedModule, // 全局共享服务（UploadPathService, UrlService）
    UploadModule, // 全局上传路径模块
    VectorDbModule, // 向量数据库模块
    McpClientModule, // MCP 客户端模块（全局）
    LlmCoreModule, // LLM 核心模块（全局）
    SkillsModule, // Skills 集成框架模块
    ChatModule,
    ModelsModule,
    AuthModule,
    CharactersModule,
    FilesModule,
    McpServersModule,
    SettingsModule,
    UsersModule,
    ToolsModule,
    KnowledgeBaseModule,
    BotGatewayModule, // 机器人网关模块
    SchedulerModule,  // 定时任务模块
    SubAgentModule,   // 子 Agent 模块
    TeamModule,       // 团队/专家团模块
  ],
})
export class AppModule {}
