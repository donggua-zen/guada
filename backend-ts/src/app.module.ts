import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { DatabaseModule } from "./common/database/database.module";
import { UploadModule } from "./common/upload/upload.module";
import { SharedModule } from "./common/services/shared.module";
import { WorkspaceModule } from "./common/workspace/workspace.module";
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
import { WorkspaceConnectionsModule } from "./modules/workspace/workspace.module";
import { VectorDbModule } from "./common/vector-db";
import { SearchModule } from "./common/search/search.module";
import { McpClientModule } from "./common/mcp/mcp-client.module";
import { BotGatewayModule } from "./modules/bot-gateway/bot-gateway.module";
import { SkillsModule } from './modules/skills/skills.module';
import { LlmCoreModule } from './modules/llm-core/providers.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';
import { SubAgentModule } from './modules/sub-agent/sub-agent.module';
import { ShellModule } from './modules/shell/shell.module';
import { CommandsModule } from './modules/commands/commands.module';
import { BridgeModule } from './modules/bridge/bridge.module';

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
    WorkspaceModule, // 全局 WorkspaceProvider 抽象层
    UploadModule, // 全局上传路径模块
    VectorDbModule, // 向量数据库模块
    SearchModule, // 全文搜索索引模块（FTS5，独立 DB）
    McpClientModule, // MCP 客户端模块（全局）
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
    WorkspaceConnectionsModule, // 远程工作目录连接管理
    BotGatewayModule, // 机器人网关模块
    SchedulerModule,  // 定时任务模块
    SubAgentModule,   // 子 Agent 模块
    ShellModule,      // Shell 命令行模块
    CommandsModule,   // 命令提供者注册 & 聚合接口
    BridgeModule,     // Electron ↔ Backend 通信桥（全局）
  ],
})
export class AppModule {}
