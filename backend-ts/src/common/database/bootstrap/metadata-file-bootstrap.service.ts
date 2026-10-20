import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import { Injectable, Logger } from "@nestjs/common";
import type Database from "better-sqlite3";
import { PrismaService } from "../prisma.service";
import {
  META_DOMAIN_BOTS,
  META_DOMAIN_MCP,
  META_DOMAIN_SESSIONS,
  MetadataBootstrapGate,
} from "../metadata-bootstrap.gate";
import {
  importSessionMetaRows,
  isMetaDbMigrated,
  markMetaDbMigrated,
  openMetaDb,
  META_DB_FILE,
  SessionGroupMeta,
} from "../../../modules/chat/session-meta.store";
import { resolveSessionsBasePath } from "../../utils/session-path.util";
import { BOTS_MIGRATED_MARKER, BotFileInstance, BotFileStore } from "../../../modules/bot-gateway/bot-file.store";
import {
  MCP_MIGRATED_MARKER,
  McpFileStore,
  McpServerRow,
} from "../../../modules/mcp-servers/mcp-file.store";
import { sessionRowToMeta, toISO } from "./session-meta-mapping";

/** 会话元信息转换的人工可见标志（真值在 `_meta.db` 的 `_bootstrap` 表；仅提示，不参与判断） */
export const SESSIONS_MIGRATED_MARKER = ".migrated-sessions";

/**
 * ⚠️ 迁移脚手架（临时代码）：预计两个版本后随 Prisma/主库整体移除，
 * 由 MigrationBootstrapService 编排调用。
 *
 * 会话/机器人/知识库/MCP 服务器元信息 DB → 本地存储一次性转换
 *
 * 四域各自独立门控、独立重试：
 *   <sessions根>/_meta.db 的 _bootstrap 表   session + session_group（库删即重转）
 *   <bots根>/.migrated-bots                  bot_instance
 *   <KB根>/.migrated-kb                      knowledge_base + kb_file
 *   <MCP根>/.migrated-mcp                    mcp_server
 *
 * 会话元数据**直接写 SQLite（`_meta.db`），不经 meta.json 中间层**：文件版从未上线，
 * 客户侧只有主库数据，保留文件往返只会引入两份真相与回滚歧义（2026-09-20 决定）。
 *
 * 四个域的 id 全部保持原 cuid 不变（目录名/主键即 id）→ 无需重键、零引用改写
 * （MCP 的 id 还被智能体设置里的 `mcp_<id>` 工具包过滤引用），因此不存在智能体迁移
 * 那种"引用改写失败"的风险面，只需保证：
 * 1. 转换完成前 FileStore 不得读索引（由 MetadataBootstrapGate 门控）
 * 2. 转换失败不落标记，下次启动重试（写入幂等：INSERT OR REPLACE）
 * 3. 已存在的行不覆盖（门控在库内，转换过一次即跳过）
 *
 * 顺序约束：必须最后执行——智能体/供应商的 rekey 改写完 DB 引用后，这里写出的
 * 会话元数据 / bot yaml / kb.json 才是归一化后的 id（此前分散在各模块时导出先于
 * rekey，跳版升级会导出旧引用且永不自愈）。
 *
 * 无需 DB migration：四域迁完后对 DB 只读不写，外键不会触发。
 */
@Injectable()
export class MetadataFileBootstrapService {
  private readonly logger = new Logger(MetadataFileBootstrapService.name);

  // 脚手架自持构造 store（不经 DI）：本模块不得反向 import 域模块——那会把
  // 域模块的初始化提到迁移转换之前（AgentSeedService 等在 init 期读写
  // store，会造成空目录补种）。会话元数据直接写库（openMetaDb 助手），
  // bot/mcp 的直写方法不走 initialize 门控，可安全地在 gate 放行前落盘。
  private readonly botStore: BotFileStore;
  private readonly mcpStore: McpFileStore;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gate: MetadataBootstrapGate,
  ) {
    this.botStore = new BotFileStore(gate);
    this.mcpStore = new McpFileStore(gate);
  }

  async run(): Promise<void> {
    await this.runDomain(META_DOMAIN_SESSIONS, () => this.importSessions());
    await this.runDomain(META_DOMAIN_BOTS, () => this.exportBots());
    await this.runDomain(META_DOMAIN_MCP, () => this.exportMcpServers());
  }

  /**
   * 单域执行：已完成直接放行；否则导出，成功落 marker 并放行，失败放行但不落 marker
   * （下次启动重试）。无论结果如何都放行门控，避免超时兜底拖慢启动。
   */
  private async runDomain(
    domain: string,
    run: () => Promise<{ ok: boolean; marker: string }>,
  ): Promise<void> {
    try {
      const { ok, marker } = await run();
      if (ok) {
        await this.writeMarker(marker);
        this.gate.complete(domain);
        return;
      }
      this.logger.warn(
        `${domain} 元信息导出未完成（下次启动重试）；文件副作用保留，重跑幂等`,
      );
    } catch (err) {
      this.logger.error(`${domain} 元信息导出异常: ${String(err)}`);
    }
    this.gate.complete(domain);
  }

  private async markerExists(marker: string): Promise<boolean> {
    try {
      await fsp.access(marker);
      return true;
    } catch {
      return false;
    }
  }

  // ============ sessions（直接写 _meta.db，不经文件） ============

  /**
   * 会话 + 分组元信息：冻结主库 → `_meta.db`。
   *
   * 幂等门控在库内（`_bootstrap.migrated_from_db_at`）：删掉 `_meta.db` 即视为未转换、
   * 下次启动自动从主库重转（这是唯一的"重新转换"入口，无需人工清理 marker 文件）。
   * 库外的 `.migrated-sessions` 文件仅作人工可见标志，不参与判断。
   */
  private async importSessions(): Promise<{ ok: boolean; marker: string }> {
    const dir = resolveSessionsBasePath();
    const marker = path.join(dir, SESSIONS_MIGRATED_MARKER);
    let db: Database.Database | null = null;
    try {
      db = openMetaDb(dir);
      if (isMetaDbMigrated(db)) return { ok: true, marker };

      let rows: Array<Record<string, any>>;
      let groups: Array<Record<string, any>>;
      try {
        rows = await this.prisma.session.findMany();
        groups = await this.prisma.sessionGroup.findMany();
      } catch (err) {
        this.logger.warn(`DB unreadable, skip session meta import: ${String(err)}`);
        return { ok: false, marker };
      }

      const groupMetas: SessionGroupMeta[] = groups.map((g) => ({
        id: String(g.id),
        name: String(g.name ?? ""),
        sortOrder: Number(g.sortOrder ?? 0),
        icon: null,
        createdAt: toISO(g.createdAt) ?? new Date().toISOString(),
        updatedAt: toISO(g.updatedAt) ?? new Date().toISOString(),
      }));

      const handle = db;
      importSessionMetaRows(
        handle,
        rows.map((row) => sessionRowToMeta(row)),
        groupMetas,
      );
      markMetaDbMigrated(handle);

      this.logger.log(
        `Session meta imported into ${META_DB_FILE}: ${rows.length} session(s), ` +
          `${groupMetas.length} group(s)`,
      );
      await this.writeMarker(marker);
      return { ok: true, marker };
    } catch (err) {
      this.logger.error(`session 元信息转换异常: ${String(err)}`);
      return { ok: false, marker };
    } finally {
      db?.close();
    }
  }

  // ============ bots ============

  private async exportBots(): Promise<{ ok: boolean; marker: string }> {
    const dir = this.botStore.getDirectory();
    await fsp.mkdir(dir, { recursive: true });
    const marker = path.join(dir, BOTS_MIGRATED_MARKER);
    if (await this.markerExists(marker)) {
      return { ok: true, marker };
    }

    let rows: Array<Record<string, any>>;
    try {
      rows = await this.prisma.botInstance.findMany();
    } catch (err) {
      this.logger.warn(`DB unreadable, skip bot export: ${String(err)}`);
      return { ok: false, marker };
    }

    let written = 0;
    for (const row of rows) {
      const id = String(row.id);
      if (fs.existsSync(path.join(dir, `${id}.yaml`))) continue;
      const instance = this.botRowToInstance(row);
      await this.botStore.writeInstanceDirect(instance);
      written += 1;
    }

    this.logger.log(
      `Bot instances migrated from DB: ${written} new, ${rows.length - written} kept`,
    );
    await this.botStore.reload();
    return { ok: true, marker };
  }

  private botRowToInstance(row: Record<string, any>): BotFileInstance {
    const now = new Date().toISOString();
    return {
      id: String(row.id),
      platform: String(row.platform ?? ""),
      name: String(row.name ?? ""),
      enabled: row.enabled !== false,
      platformConfig:
        row.platformConfig && typeof row.platformConfig === "object"
          ? row.platformConfig
          : null,
      reconnectEnabled: row.reconnectEnabled !== false,
      maxRetries: Number(row.maxRetries ?? 5),
      retryInterval: Number(row.retryInterval ?? 5000),
      defaultAgentId: String(row.defaultCharacterId ?? ""),
      defaultModelId: row.defaultModelId ?? null,
      defaultThinkingEffort: row.defaultThinkingEffort ?? null,
      status: String(row.status ?? "stopped"),
      lastStartedAt: toISO(row.lastStartedAt),
      lastError: row.lastError ?? null,
      additionalKwargs:
        row.additionalKwargs && typeof row.additionalKwargs === "object"
          ? row.additionalKwargs
          : null,
      createdAt: toISO(row.createdAt) ?? now,
      updatedAt: toISO(row.updatedAt) ?? now,
    };
  }

  // ============ MCP 服务器 ============

  private async exportMcpServers(): Promise<{ ok: boolean; marker: string }> {
    const dir = this.mcpStore.getDirectory();
    await fsp.mkdir(dir, { recursive: true });
    const marker = path.join(dir, MCP_MIGRATED_MARKER);
    if (await this.markerExists(marker)) {
      return { ok: true, marker };
    }

    let rows: Array<Record<string, any>>;
    try {
      rows = await this.prisma.mcpServer.findMany();
    } catch (err) {
      this.logger.warn(`DB unreadable, skip MCP export: ${String(err)}`);
      return { ok: false, marker };
    }

    let written = 0;
    let cachedTools = 0;
    for (const row of rows) {
      const id = String(row.id);
      // 已存在则保留（可能是用户手改或上次部分导出）——只补缺失
      if (fs.existsSync(path.join(dir, `${id}.yaml`))) continue;
      const server = this.mcpRowToServer(row);
      await this.mcpStore.writeDirect(server);
      if (server.tools && Object.keys(server.tools).length > 0) {
        cachedTools += 1;
      }
      written += 1;
    }

    this.logger.log(
      `MCP servers migrated from DB: ${written} new, ${rows.length - written} kept, ` +
        `${cachedTools} with cached tools`,
    );
    await this.mcpStore.reload();
    return { ok: true, marker };
  }

  private mcpRowToServer(row: Record<string, any>): McpServerRow {
    const now = new Date().toISOString();
    return {
      id: String(row.id),
      name: String(row.name ?? ""),
      url: row.url ?? null,
      type: row.type ?? null,
      description: row.description ?? null,
      headers:
        row.headers && typeof row.headers === "object" ? row.headers : null,
      command: row.command ?? null,
      args: Array.isArray(row.args) ? row.args : null,
      env:
        row.env && typeof row.env === "object"
          ? this.toStringMap(row.env)
          : null,
      cwd: row.cwd ?? null,
      // 原 mcp_server 表没有超时列：迁移后一律为空，由用户按需在管理页补填
      timeoutMs: null,
      enabled: row.enabled !== false,
      tools:
        row.tools && typeof row.tools === "object" && !Array.isArray(row.tools)
          ? row.tools
          : null,
      createdAt: toISO(row.createdAt) ?? now,
      updatedAt: toISO(row.updatedAt) ?? now,
    };
  }

  /** env 的值统一转字符串（DB JSON 里可能是数字/布尔） */
  private toStringMap(value: Record<string, any>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, val] of Object.entries(value)) {
      if (val === null || val === undefined) continue;
      out[key] = typeof val === "string" ? val : String(val);
    }
    return out;
  }

  // ============ 工具 ============

  private async writeMarker(markerPath: string): Promise<void> {
    await fsp.mkdir(path.dirname(markerPath), { recursive: true });
    await fsp.writeFile(
      markerPath,
      `migrated at ${new Date().toISOString()}\n`,
      "utf8",
    );
  }
}
