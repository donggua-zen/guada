import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { MigrationRunner } from "../migration-runner.service";
import { CharacterFileBootstrapService } from "./character-file-bootstrap.service";
import { ProviderBootstrapService } from "./provider-bootstrap.service";
import { AccountBootstrapService } from "./account-bootstrap.service";
import { MetadataFileBootstrapService } from "./metadata-file-bootstrap.service";
import { SessionFileStore } from "../../../modules/chat/session-file.store";
import { BotFileStore } from "../../../modules/bot-gateway/bot-file.store";
import { KbFileStore } from "../../../modules/knowledge-base/kb-file.store";
import { McpFileStore } from "../../../modules/mcp-servers/mcp-file.store";

/**
 * ⚠️ 迁移脚手架编排器（临时代码）：预计两个版本后随 Prisma/主库整体移除，
 * 移除清单见 docs/design/metadata-file-format.md「脚手架移除清单」。
 *
 * 主库 → 本地文件的启动期一次性迁移，全部集中在此显式编排。
 * 顺序是正确性的一部分，不能靠 Nest 模块初始化顺序碰运气——历史上三个 bug
 * 都源于此：
 * 1. 元信息导出（读 session.characterId/modelId 等）必须晚于角色/供应商 rekey，
 *    否则跳版升级导出的 meta.json/yaml/kb.json 永久带旧 cuid 引用；
 * 2. 供应商 rekey 改写 AGENT.md frontmatter 必须晚于角色导入（文件需已存在）；
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
    private readonly characterBootstrap: CharacterFileBootstrapService,
    private readonly providerBootstrap: ProviderBootstrapService,
    private readonly accountBootstrap: AccountBootstrapService,
    private readonly metadataBootstrap: MetadataFileBootstrapService,
    private readonly sessionStore: SessionFileStore,
    private readonly botStore: BotFileStore,
    private readonly kbStore: KbFileStore,
    private readonly mcpStore: McpFileStore,
  ) {}

  async onModuleInit(): Promise<void> {
    // 0. 连接与结构就绪：不依赖模块内 provider 的 hook 顺序，显式执行（均幂等）
    await this.prisma.$connect();
    await this.migrationRunner.run();

    // 1. 角色导入 + rekey：先有 agents/<slug>/AGENT.md 与 .rekey.json
    await this.step("character", () => this.characterBootstrap.run());

    // 2. 供应商导入 + 模型引用 rekey（AGENT.md 已存在，frontmatter 改写生效）
    await this.step("provider", () => this.providerBootstrap.run());

    // 3. 账户导入（保留密码）
    await this.step("account", () => this.accountBootstrap.run());

    // 4. 元信息导出（sessions/bots/kb/mcp）：此刻 DB 引用已全部归一化，导出即正确
    await this.step("metadata", () => this.metadataBootstrap.run());

    // 5. 门控已放行，主动预热索引：把冷启动的文件扫描成本放在启动期，
    //    既避免首个用户请求承担，也让冷加载耗时在启动日志里可见
    await this.sessionStore.initialize();
    await this.botStore.initialize();
    await this.kbStore.initialize();
    await this.mcpStore.initialize();
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
