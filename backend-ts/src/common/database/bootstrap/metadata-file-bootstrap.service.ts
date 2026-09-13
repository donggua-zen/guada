import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import {
  META_DOMAIN_BOTS,
  META_DOMAIN_KB,
  META_DOMAIN_MCP,
  META_DOMAIN_SESSIONS,
  MetadataBootstrapGate,
} from "../metadata-bootstrap.gate";
import {
  SESSIONS_MIGRATED_MARKER,
  SessionFileStore,
  SessionGroupMeta,
  SessionMeta,
} from "../../../modules/chat/session-file.store";
import { BOTS_MIGRATED_MARKER, BotFileInstance, BotFileStore } from "../../../modules/bot-gateway/bot-file.store";
import {
  KB_MIGRATED_MARKER,
  KbFileMeta,
  KbFileStore,
  KnowledgeBaseMeta,
} from "../../../modules/knowledge-base/kb-file.store";
import {
  MCP_MIGRATED_MARKER,
  McpFileStore,
  McpServerRow,
} from "../../../modules/mcp-servers/mcp-file.store";

/**
 * ⚠️ 迁移脚手架（临时代码）：预计两个版本后随 Prisma/主库整体移除，
 * 由 MigrationBootstrapService 编排调用，移除清单见 docs/design/metadata-file-format.md。
 *
 * 会话/机器人/知识库/MCP 服务器元信息 DB → 文件一次性导出
 *
 * 四域各自独立 marker、独立重试：
 *   <sessions根>/.migrated-sessions   session + session_group
 *   <bots根>/.migrated-bots           bot_instance
 *   <KB根>/.migrated-kb               knowledge_base + kb_file
 *   <MCP根>/.migrated-mcp             mcp_server
 *
 * 四个域的 id 全部保持原 cuid 不变（文件名/目录名即 id）→ 无需重键、零引用改写
 * （MCP 的 id 还被角色设置里的 `mcp_<id>` 工具包过滤引用），因此不存在角色迁移
 * 那种"引用改写失败"的风险面，只需保证：
 * 1. 导出完成前 FileStore 不得读索引（由 MetadataBootstrapGate 门控）
 * 2. 导出失败不落 marker，下次启动重试
 * 3. 已存在文件不覆盖（用户手改过的内容保留）
 *
 * 顺序约束：必须最后执行——角色/供应商的 rekey 改写完 DB 引用后，这里导出的
 * meta.json / bot yaml / kb.json 才是归一化后的 id（此前分散在各模块时导出先于
 * rekey，跳版升级会导出旧引用且永不自愈）。
 *
 * 无需 DB migration：四域迁完后对 DB 只读不写，外键不会触发。
 */
@Injectable()
export class MetadataFileBootstrapService {
  private readonly logger = new Logger(MetadataFileBootstrapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gate: MetadataBootstrapGate,
    private readonly sessionStore: SessionFileStore,
    private readonly botStore: BotFileStore,
    private readonly kbStore: KbFileStore,
    private readonly mcpStore: McpFileStore,
  ) {}

  async run(): Promise<void> {
    await this.runDomain(META_DOMAIN_SESSIONS, () => this.exportSessions());
    await this.runDomain(META_DOMAIN_BOTS, () => this.exportBots());
    await this.runDomain(META_DOMAIN_KB, () => this.exportKnowledgeBase());
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

  // ============ sessions ============

  private async exportSessions(): Promise<{ ok: boolean; marker: string }> {
    const dir = this.sessionStore.getDirectory();
    await fsp.mkdir(dir, { recursive: true });
    const marker = path.join(dir, SESSIONS_MIGRATED_MARKER);
    if (await this.markerExists(marker)) {
      return { ok: true, marker };
    }

    let rows: Array<Record<string, any>>;
    let groups: Array<Record<string, any>>;
    try {
      rows = await this.prisma.session.findMany();
      groups = await this.prisma.sessionGroup.findMany();
    } catch (err) {
      this.logger.warn(`DB unreadable, skip session export: ${String(err)}`);
      return { ok: false, marker };
    }

    let written = 0;
    for (const row of rows) {
      const meta = this.sessionRowToMeta(row);
      const metaPath = this.sessionStore.getMetaPath(meta.id);
      // 已存在则保留（可能是用户手改或上次部分导出）——只补缺失
      if (fs.existsSync(metaPath)) continue;
      await this.sessionStore.writeMetaDirect(meta);
      written += 1;
    }

    const groupMetas: SessionGroupMeta[] = groups.map((g) => ({
      id: String(g.id),
      name: String(g.name ?? ""),
      sortOrder: Number(g.sortOrder ?? 0),
      createdAt: this.toISO(g.createdAt) ?? new Date().toISOString(),
      updatedAt: this.toISO(g.updatedAt) ?? new Date().toISOString(),
    }));
    const existingGroups = await this.sessionStore.readGroups();
    if (existingGroups.length === 0 && groupMetas.length > 0) {
      await this.sessionStore.writeGroups(groupMetas);
    }

    this.logger.log(
      `Session meta migrated from DB: ${written} new, ${rows.length - written} kept, ` +
        `${groupMetas.length} group(s)`,
    );
    await this.sessionStore.reload();
    return { ok: true, marker };
  }

  private sessionRowToMeta(row: Record<string, any>): SessionMeta {
    const now = new Date().toISOString();
    return {
      id: String(row.id),
      title: row.title ?? null,
      avatarUrl: row.avatarUrl ?? null,
      description: row.description ?? null,
      modelId: row.modelId ?? null,
      characterId: row.characterId ?? null,
      groupId: row.groupId ?? null,
      settings:
        row.settings && typeof row.settings === "object" ? row.settings : null,
      sessionType: row.sessionType ?? "web",
      archived: row.archived === true,
      botId: row.botId ?? null,
      platform: row.platform ?? null,
      externalId: row.externalId ?? null,
      workspacePath: row.workspacePath ?? null,
      parentId: row.parentId ?? null,
      closedAt: this.toISO(row.closedAt),
      closeReason: row.closeReason ?? null,
      createdAt: this.toISO(row.createdAt) ?? now,
      updatedAt: this.toISO(row.updatedAt) ?? now,
      lastActiveAt: this.toISO(row.lastActiveAt),
    };
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
      defaultCharacterId: String(row.defaultCharacterId ?? ""),
      defaultModelId: row.defaultModelId ?? null,
      defaultThinkingEffort: row.defaultThinkingEffort ?? null,
      status: String(row.status ?? "stopped"),
      lastStartedAt: this.toISO(row.lastStartedAt),
      lastError: row.lastError ?? null,
      additionalKwargs:
        row.additionalKwargs && typeof row.additionalKwargs === "object"
          ? row.additionalKwargs
          : null,
      createdAt: this.toISO(row.createdAt) ?? now,
      updatedAt: this.toISO(row.updatedAt) ?? now,
    };
  }

  // ============ knowledge base ============

  private async exportKnowledgeBase(): Promise<{ ok: boolean; marker: string }> {
    const dir = this.kbStore.getRootDir();
    await fsp.mkdir(dir, { recursive: true });
    const marker = path.join(dir, KB_MIGRATED_MARKER);
    if (await this.markerExists(marker)) {
      return { ok: true, marker };
    }

    let kbRows: Array<Record<string, any>>;
    let fileRows: Array<Record<string, any>>;
    try {
      kbRows = await this.prisma.knowledgeBase.findMany();
      fileRows = await this.prisma.kBFile.findMany();
    } catch (err) {
      this.logger.warn(`DB unreadable, skip KB export: ${String(err)}`);
      return { ok: false, marker };
    }

    let kbWritten = 0;
    for (const row of kbRows) {
      const id = String(row.id);
      if (fs.existsSync(this.kbStore.getKbConfigPath(id))) continue;
      await this.kbStore.writeKbDirect(this.kbRowToMeta(row));
      kbWritten += 1;
    }

    let fileWritten = 0;
    for (const row of fileRows) {
      const id = String(row.id);
      const kbId = String(row.knowledgeBaseId ?? "");
      if (!kbId) continue;
      if (fs.existsSync(this.kbStore.getItemMetaPath(kbId, id))) continue;
      await this.kbStore.writeFileDirect(this.kbFileRowToMeta(row, kbId));
      fileWritten += 1;
    }

    this.logger.log(
      `Knowledge base migrated from DB: ${kbWritten} kb(s) new, ` +
        `${fileWritten} item(s) new`,
    );
    await this.kbStore.reload();
    return { ok: true, marker };
  }

  private kbRowToMeta(row: Record<string, any>): KnowledgeBaseMeta {
    const now = new Date().toISOString();
    return {
      id: String(row.id),
      name: String(row.name ?? ""),
      description: row.description ?? null,
      embeddingModelId: String(row.embeddingModelId ?? ""),
      chunkMaxSize: Number(row.chunkMaxSize ?? 1000),
      chunkOverlapSize: Number(row.chunkOverlapSize ?? 100),
      chunkMinSize: Number(row.chunkMinSize ?? 50),
      isActive: row.isActive !== false,
      isPublic: row.isPublic === true,
      metadataConfig:
        row.metadataConfig && typeof row.metadataConfig === "object"
          ? row.metadataConfig
          : null,
      createdAt: this.toISO(row.createdAt) ?? now,
      updatedAt: this.toISO(row.updatedAt) ?? now,
    };
  }

  private kbFileRowToMeta(
    row: Record<string, any>,
    kbId: string,
  ): KbFileMeta {
    const now = new Date().toISOString();
    return {
      id: String(row.id),
      knowledgeBaseId: kbId,
      fileName: String(row.fileName ?? ""),
      displayName: String(row.displayName ?? row.fileName ?? ""),
      fileSize: Number(row.fileSize ?? 0),
      fileType: String(row.fileType ?? ""),
      fileExtension: String(row.fileExtension ?? ""),
      contentHash: String(row.contentHash ?? ""),
      filePath: row.filePath ?? null,
      relativePath: row.relativePath ?? null,
      parentFolderId: row.parentFolderId ?? null,
      isDirectory: row.isDirectory === true,
      processingStatus: String(row.processingStatus ?? "pending"),
      progressPercentage: Number(row.progressPercentage ?? 0),
      currentStep: row.currentStep ?? null,
      errorMessage: row.errorMessage ?? null,
      totalChunks: Number(row.totalChunks ?? 0),
      totalTokens: Number(row.totalTokens ?? 0),
      uploadedAt: this.toISO(row.uploadedAt) ?? now,
      processedAt: this.toISO(row.processedAt),
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
      enabled: row.enabled !== false,
      tools:
        row.tools && typeof row.tools === "object" && !Array.isArray(row.tools)
          ? row.tools
          : null,
      createdAt: this.toISO(row.createdAt) ?? now,
      updatedAt: this.toISO(row.updatedAt) ?? now,
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

  private toISO(value: any): string | null {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value.toISOString();
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  private async writeMarker(markerPath: string): Promise<void> {
    await fsp.mkdir(path.dirname(markerPath), { recursive: true });
    await fsp.writeFile(
      markerPath,
      `migrated at ${new Date().toISOString()}\n`,
      "utf8",
    );
  }
}
