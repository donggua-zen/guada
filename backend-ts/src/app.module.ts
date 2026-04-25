import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { UploadModule } from "./common/upload/upload.module";
import { SharedModule } from "./common/services/shared.module";
import { LlmCoreModule } from "./modules/llm-core/llm-core.module";
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    SharedModule, // 全局共享服务（UploadPathService, UrlService）
    UploadModule, // 全局上传路径模块
    VectorDbModule, // 向量数据库模块
    McpClientModule, // MCP 客户端模块（全局）
    LlmCoreModule, // LLM 核心模块（全局）
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
  ],
})
export class AppModule {}
