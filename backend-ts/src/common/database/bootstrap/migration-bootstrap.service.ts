import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { MigrationRunner } from "../migration-runner.service";
import { AgentFileBootstrapService } from "./agent-file-bootstrap.service";
import { ProviderBootstrapService } from "./provider-bootstrap.service";
import { AccountBootstrapService } from "./account-bootstrap.service";
import { MetadataFileBootstrapService } from "./metadata-file-bootstrap.service";
import { KbMigrationBootstrapService } from "./kb-migration-bootstrap.service";
import { SessionMessageMigrationBootstrapService } from "./session-message-migration-bootstrap.service";

/**
 * ⚠️ 迁移脚手架编排器（临时代码）：预计两个版本后随 Prisma/主库整体移除，
 * 移除清单见 docs/design/metadata-file-format.md「脚手架移除清单」。
 *
 * 主库 → 本地文件的启动期一次性迁移，全部集中在此显式编排。
 * 顺序是正确性的一部分，不能靠 Nest 模块初始化顺序碰运气——历史上三个 bug
 * 都源于此：
 * 1. 元信息导出（读 session.agentId/modelId 等）必须晚于智能体/供应商 rekey，
 *    否则跳版升级写出的会话元数据/yaml/kb.json 永久带旧 cuid 引用；
 * 2. 供应商 rekey 改写 AGENT.md frontmatter 必须晚于智能体导入（文件需已存在）；
 * 3. 0003/0004 解除外键的 DB 迁移必须先于一切 rekey 写（否则 update 撞外键）。
 *
 * 每步独立 marker、失败不阻塞后续步骤（各域下次启动自行重试，幂等）。
 */
@Injectable()
export class MigrationBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(MigrationBootstrapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly migrationRunner: MigrationRunner,
    private readonly agentBootstrap: AgentFileBootstrapService,
    private readonly providerBootstrap: ProviderBootstrapService,
    private readonly accountBootstrap: AccountBootstrapService,
    private readonly metadataBootstrap: MetadataFileBootstrapService,
    private readonly kbBootstrap: KbMigrationBootstrapService,
    private readonly sessionMessageBootstrap: SessionMessageMigrationBootstrapService,
  ) {}

  async onModuleInit(): Promise<void> {
    // 0. 连接与结构就绪：不依赖模块内 provider 的 hook 顺序，显式执行（均幂等）
    await this.prisma.$connect();
    await this.migrationRunner.run();

    // 1. 智能体导入 + rekey：先有 agents/<slug>/AGENT.md 与 .rekey.json
    await this.step("agent", () => this.agentBootstrap.run());

    // 2. 供应商导入 + 模型引用 rekey（AGENT.md 已存在，frontmatter 改写生效）
    await this.step("provider", () => this.providerBootstrap.run());

    // 3. 账户导入（保留密码）
    await this.step("account", () => this.accountBootstrap.run());

    // 4. 会话/机器人/MCP 元信息导出：此刻 DB 引用已全部归一化，导出即正确
    await this.step("metadata", () => this.metadataBootstrap.run());

    // 4.1 知识库：三源（冻结主库 / 旧 file.json 形态 / 旧全局向量库）→ 每库 kb.db。
    //     独立成步是因为它要合并多源并搬原件，且必须晚于 rekey（embeddingModelId 是复合引用）。
    await this.step("kb", () => this.kbBootstrap.run());

    // 4.2 会话消息：DB message/message_content/session_context_state → JSONL 事件
    //     （占用锚点 + 压缩括号 + meta 骨架修复）。必须先于 sessionStore.initialize()——
    //     索引预热/heal 抢先跑会给无 meta 的目录补 title=null 骨架（侧栏空行 + 丢绑定）。
    await this.step("session-messages", () => this.sessionMessageBootstrap.run());

    // 5. 门控已放行。各域 FileStore 的索引预热由其所属域模块的 onModuleInit 负责
    //    （ChatModule/BotGatewayModule/McpServersModule——它们在本模块之后初始化，
    //    恰好在 gate 放行之后；预热归属 store 的生命周期所有者）。
  }

  /** 单步执行：失败记日志不抛出（各域自带 marker 重试语义），不阻塞后续步骤 */
  private async step(name: string, run: () => Promise<unknown>): Promise<void> {
    try {
      await run();
    } catch (err) {
      this.logger.error(`迁移步骤 ${name} 失败（下次启动重试）: ${String(err)}`);
    }
  }
}
