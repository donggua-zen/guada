import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { UploadModule } from "./common/upload/upload.module";
import { SharedModule } from "./common/services/shared.module";
import { WorkspaceModule } from "./common/workspace/workspace.module";
import { ChatModule } from "./modules/chat/chat.module";
import { ModelsModule } from "./modules/models/models.module";
import { AuthModule } from "./modules/auth/auth.module";
import { AgentsModule } from "./modules/agents/agents.module";
import { FilesModule } from "./modules/files/files.module";
import { McpServersModule } from "./modules/mcp-servers/mcp-servers.module";
import { SettingsModule } from "./modules/settings/settings.module";
import { PolicyModule } from "./modules/policy/policy.module";
import { UsersModule } from "./modules/users/users.module";
import { ToolsModule } from "./modules/tools/tools.module";
import { KnowledgeBaseModule } from "./modules/knowledge-base/knowledge-base.module";
import { SearchModule } from "./common/search/search.module";
import { McpClientModule } from "./common/mcp/mcp-client.module";
import { BotGatewayModule } from "./modules/bot-gateway/bot-gateway.module";
import { SkillsModule } from './modules/skills/skills.module';
import { LlmCoreModule } from './modules/llm-core/providers.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';
import { SubAgentModule } from './modules/sub-agent/sub-agent.module';
import { WorkflowModule } from './modules/workflow/workflow.module';
import { ShellModule } from './modules/shell/shell.module';
import { CommandsModule } from './modules/commands/commands.module';
import { BridgeModule } from './modules/bridge/bridge.module';
import { RuntimeModule } from './modules/runtime/runtime.module';
import { GitModule } from './modules/git/git.module';
import { TerminalModule } from './modules/terminal/terminal.module';
import { PersistenceModule } from './common/persistence/persistence.module';
import { HealthModule } from './modules/health/health.module';
import { UsageModule } from './modules/usage/usage.module';
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
    // ⚠️ 持久化机制层必须位于其余域模块之前：迁移脚手架在此完成 DB→文件导出
    // 并放行 MetadataBootstrapGate，域模块的 onModuleInit（AgentSeedService
    // 补种、各 store 索引预热）依赖该顺序。
    // 例外：LlmCoreModule 排在本模块之前（@Global 基座，被几乎所有域依赖）。
    // Nest 的模块钩子跨模块串行 await，故它的 ProviderFileStore 预热必然早于这里的
    // 迁移导出；store 以「预热 + 门控放行后重扫」兜底（providers 域），不依赖数组顺序。
    PersistenceModule,
    UsageModule, // Token 用量统计（@Global；LLMService 经全局导出注入 UsageService）
    SharedModule, // 全局共享服务（UploadPathService, UrlService）
    WorkspaceModule, // 全局 WorkspaceProvider 抽象层
    UploadModule, // 全局上传路径模块
    SearchModule, // 会话内容搜索（JSONL 实时批扫描，无索引库）
    McpClientModule, // MCP 客户端模块（全局）
    SkillsModule, // Skills 集成框架模块
    ChatModule,
    ModelsModule,
    AuthModule,
    AgentsModule,
    FilesModule,
    McpServersModule,
    SettingsModule,
    PolicyModule, // 命令策略规则（policy.yaml 的读写 API）
    UsersModule,
    ToolsModule,
    KnowledgeBaseModule,
    BotGatewayModule, // 机器人网关模块
    SchedulerModule,  // 定时任务模块
    SubAgentModule,   // 子 Agent 模块
    WorkflowModule,   // Workflow 子代理编排模块
    ShellModule,      // Shell 命令行模块
    CommandsModule,   // 命令提供者注册 & 聚合接口
    BridgeModule,     // Electron ↔ Backend 通信桥（全局）
    RuntimeModule,    // 运行态广播（keep-awake 忙碌状态 → Electron）
    GitModule,        // Git 源码管理模块
    TerminalModule,   // 终端模块（后端 PTY + WebSocket）
    HealthModule,      // 健康检查端点（Electron 看门狗探测用）
  ],
})
export class AppModule {}
