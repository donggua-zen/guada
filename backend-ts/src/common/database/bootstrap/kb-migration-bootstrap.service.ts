import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import Database from "better-sqlite3";
import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import {
  META_DOMAIN_KB,
  MetadataBootstrapGate,
} from "../metadata-bootstrap.gate";
import {
  KB_DB_FILE,
  migrateKbDatabase,
} from "../../../modules/knowledge-base/kb-schema";
import { KbDatabaseService } from "../../../modules/knowledge-base/kb-database.service";
import {
  KB_CONFIG_FILE,
  KbMetaStore,
  KnowledgeBaseMeta,
} from "../../../modules/knowledge-base/kb-meta.store";
import { KBFileRepository, KbDbAccess } from "../../../modules/knowledge-base/kb-file.repository";
import { KBChunkRepository } from "../../../modules/knowledge-base/kb-chunk.repository";

/** 迁移标记（放在 KB 根下；沿用旧标记名则已迁移的安装会被跳过，故换新名） */
export const KB_SQLITE_MIGRATED_MARKER = ".migrated-kb-sqlite";

/** 备份目录名（库目录整体 rename 到这里，可反向回滚） */
export const KB_PRE_SQLITE_DIR = ".pre-sqlite";

/** 全局向量库（旧形态）文件名 */
const LEGACY_VECTOR_DB = "vector_db.sqlite";

/**
 * 读冻结表字段：同时接受 Prisma 的 camelCase 形状与原始 SQLite 行的 snake_case 形状。
 *
 * 迁移脚手架读的是"安装时还在库里的旧数据"，来源可能是 Prisma 客户端，也可能是
 * 直接 open 的 sqlite 行（运维脚本/离线校验）。只认一种形状的后果是**静默丢数据**：
 * `row.knowledgeBaseId` 在 snake_case 下是 undefined，条目会被整条跳过而不报错。
 */
function pick<T = any>(row: Record<string, any>, camel: string, snake: string): T {
  if (row[camel] !== undefined && row[camel] !== null) return row[camel];
  return row[snake];
}

interface LegacyKbFileMeta {
  id: string;
  knowledgeBaseId: string;
  fileName: string;
  displayName: string;
  fileSize: number;
  fileType: string;
  fileExtension: string;
  contentHash: string;
  filePath: string | null;
  relativePath: string | null;
  parentFolderId: string | null;
  isDirectory: boolean;
  processingStatus: string;
  progressPercentage: number;
  currentStep: string | null;
  errorMessage: string | null;
  totalChunks: number;
  totalTokens: number;
  uploadedAt: string;
  processedAt: string | null;
}

/**
 * 知识库迁移导入器（脚手架，与 MigrationBootstrapService 同生命周期）
 *
 * 把三种历史形态导入「每库一个自包含目录」：
 *   S1  frozen 主库 `knowledge_base` / `kb_file` / `kb_chunk`（跳版本升级的安装）
 *   S2  旧文件形态 `kb.json` + `<itemId>/file.json` + `<itemId>/chunks.jsonl`
 *   S3  全局 `vector_db.sqlite` 的 `kb_<kbId>` 表（向量）
 *
 * 目标：
 *   `<kbRoot>/<kbId>/kb.json`                 KB 配置
 *   `<kbRoot>/<kbId>/kb.db`                   条目 + 分块 + 向量 + FTS
 *   `<kbRoot>/<kbId>/raw/<itemId>/<文件名>`   原件（**移动**进来，不额外占盘）
 *
 * 切换可回滚：先在 `<kbId>.new` 建好新形态并校验，再
 * `rename <kbId> → .pre-sqlite/<kbId>`、`rename <kbId>.new → <kbId>`。
 *
 * 原件处理的边界（按约定）：只搬**有元信息引用**的文件；共享上传目录里无人引用的
 * 文件一律只列清单报告、不删除（那是用户的字节）。
 */
@Injectable()
export class KbMigrationBootstrapService {
  private readonly logger = new Logger(KbMigrationBootstrapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gate: MetadataBootstrapGate,
    private readonly databases: KbDatabaseService,
    private readonly kbMetaStore: KbMetaStore,
    private readonly fileRepo: KBFileRepository,
    private readonly chunkRepo: KBChunkRepository,
  ) {}

  async run(): Promise<void> {
    // 设置注入完成后再报告生效的存储根（顺序由编排器保证）
    this.kbMetaStore.reportRoot();
    const rootDir = this.databases.getRootDir();
    await fsp.mkdir(rootDir, { recursive: true });
    const marker = path.join(rootDir, KB_SQLITE_MIGRATED_MARKER);

    if (fs.existsSync(marker)) {
      this.gate.complete(META_DOMAIN_KB);
      return;
    }

    try {
      const result = await this.importAll(rootDir);
      await fsp.writeFile(
        marker,
        JSON.stringify(
          { migratedAt: new Date().toISOString(), ...result },
          null,
          2,
        ),
        "utf8",
      );
      this.logger.log(
        `知识库已迁移到每库 SQLite：${result.kbs} 个库、${result.items} 个条目、` +
          `${result.chunks} 条分块、${result.vectors} 条向量、${result.rawMoved} 个原件入库` +
          (result.orphanUploads.length
            ? `；另有 ${result.orphanUploads.length} 个无人引用的上传文件（未删除，清单见 marker）`
            : ""),
      );
      if (result.orphanUploads.length > 0) {
        const listPath = path.join(rootDir, "orphan-uploads.txt");
        await fsp.writeFile(listPath, result.orphanUploads.join("\n"), "utf8");
        this.logger.warn(`无人引用的上传文件清单：${listPath}`);
      }
      this.gate.complete(META_DOMAIN_KB);
    } catch (err) {
      // 失败放行门控（否则启动期所有 KB 读都被拖住），但不落 marker → 下次启动重试
      this.logger.error(`知识库迁移失败（下次启动重试）: ${String(err)}`);
      this.gate.complete(META_DOMAIN_KB);
    }
  }

  /** 三源合并导入：先备齐数据，再逐库落地 */
  private async importAll(rootDir: string): Promise<{
    kbs: number;
    items: number;
    chunks: number;
    vectors: number;
    rawMoved: number;
    orphanUploads: string[];
  }> {
    const sources = await this.collectSources();
    const stats = {
      kbs: 0,
      items: 0,
      chunks: 0,
      vectors: 0,
      rawMoved: 0,
      orphanUploads: [] as string[],
    };

    for (const [kbId, kb] of sources.kbs) {
      const kbDir = path.join(rootDir, kbId);
      const stagingDir = path.join(rootDir, `${kbId}.new`);

      // 逐库幂等判断必须基于**内容**而非"文件存在"。
      //
      // 反例（真实踩过）：运行中的开发版被重启打断，KbFileService 的启动对账
      // 已经建出一个空的 kb.db（只有表、没有行）；此时若按"kb.db 存在就跳过"，
      // 这个库会被永久当成已完成，用户的条目再也不会被导入。
      // 所以要求：既有 kb.db，又没有旧 file.json，**且库里确实已有条目**。
      const alreadyMigrated = await this.isAlreadyMigrated(kbDir, kbId);
      if (alreadyMigrated) {
        this.logger.log(`库 ${kbId} 已是 kb.db 形态且含数据，跳过`);
        continue;
      }

      await fsp.rm(stagingDir, { recursive: true, force: true });
      await fsp.mkdir(stagingDir, { recursive: true });

      // 1. kb.json
      await fsp.writeFile(
        path.join(stagingDir, KB_CONFIG_FILE),
        JSON.stringify(kb, null, 2),
        "utf8",
      );

      // 2. 条目 + 分块 + 向量：把 staging 目录临时当成库根，直接走正式仓储
      const stagingDbPath = path.join(stagingDir, KB_DB_FILE);
      const db = new Database(stagingDbPath);
      try {
        db.pragma("journal_mode = WAL");
        db.pragma("busy_timeout = 5000");
        const staging = await this.createStagingRepositories(
          kbId,
          db,
          stagingDir,
        );
        stats.chunks += await this.importItems(
          kbId,
          stagingDir,
          sources,
          staging.fileRepo,
          staging.chunkRepo,
          stats,
        );
      } finally {
        try {
          db.pragma("wal_checkpoint(TRUNCATE)");
        } catch {
          /* 忽略 */
        }
        db.close();
      }

      // 3. 原子切换（先备份旧目录，再让 staging 就位）
      const backupRoot = path.join(rootDir, KB_PRE_SQLITE_DIR);
      await fsp.mkdir(backupRoot, { recursive: true });
      const backupDir = path.join(backupRoot, kbId);
      if (fs.existsSync(kbDir)) {
        await fsp.rm(backupDir, { recursive: true, force: true });
        await fsp.rename(kbDir, backupDir);
      }
      await fsp.rename(stagingDir, kbDir);
      stats.kbs += 1;
    }

    // 4. 四、用户没人引用的上传文件：只报告
    stats.orphanUploads = await this.reportUnreferencedUploads(sources.referencedUploads);

    // 5. 旧全局向量库改名保留（可回滚），不删除
    await this.retireLegacyVectorDb();

    this.databases.invalidateKbList();
    return stats;
  }

  /**
   * staging 目录的临时 KbDbAccess：让迁移导入复用**正式的仓储实现**。
   *
   * 复用而不是另写一套 INSERT，是为了保证「迁移出来的库」与「新建的库」结构
   * 逐字节一致——迁移路径一旦与运行路径分叉，就会长期带病且无测试覆盖。
   */
  private createStagingAccess(
    db: Database.Database,
    rootDir: string,
  ): KbDbAccess {
    return {
      getDb: async () => db,
      ready: async () => {
        /* staging 无需门控 */
      },
      getRootDir: () => rootDir,
      exists: async () => true,
      listKbIds: async () => [],
      invalidateKbList: () => {
        /* staging 不参与列表缓存 */
      },
    };
  }

  private async createStagingRepositories(
    kbId: string,
    db: Database.Database,
    stagingDir: string,
  ): Promise<{ fileRepo: KBFileRepository; chunkRepo: KBChunkRepository }> {
    migrateKbDatabase(db, kbId);
    const access = this.createStagingAccess(db, stagingDir);
    return {
      fileRepo: new KBFileRepository(access),
      chunkRepo: new KBChunkRepository(access),
    };
  }

  /** 导入某库的全部条目与分块，返回分块数 */
  private async importItems(
    kbId: string,
    stagingDir: string,
    sources: Awaited<ReturnType<KbIntegrationSources["collect"]>>,
    fileRepo: KBFileRepository,
    chunkRepo: KBChunkRepository,
    stats: { items: number; vectors: number; rawMoved: number },
  ): Promise<number> {
    const items = sources.itemsByKb.get(kbId) ?? [];
    let chunkCount = 0;

    for (const item of items) {
      // 原件搬入库内（移动，不额外占盘）
      let rawName: string | null = null;
      const sourcePath = item.filePath;
      let missingSource = false;
      if (sourcePath && fs.existsSync(sourcePath)) {
        rawName = await this.moveRawInto(item, kbId, stagingDir, sourcePath);
        if (rawName) stats.rawMoved += 1;
        else missingSource = true; // 搬运失败（如权限），保留原位
      } else if (sourcePath) {
        missingSource = true;
      }

      // 原件缺失有两种来源，都要**显式可查**而不是静默丢弃：
      // 1. 冻结 DB 的历史残留行（文件早被删，file.json 也没有）
      // 2. 搬运失败
      // 处理方式：仍建条目，但标记 failed 并写明原因 —— 用户在界面上看得见、
      // 可以自行删除；悄悄跳过反而会让人以为数据"迁移丢了"。
      const staleRow = missingSource && !item.isDirectory;
      if (staleRow) {
        this.logger.warn(
          `原件缺失，条目以 failed 状态导入（可在界面删除）：${item.displayName}`,
        );
      }

      await fileRepo.create(kbId, {
        id: item.id,
        fileName: item.fileName,
        displayName: item.displayName,
        fileSize: item.fileSize,
        fileType: item.fileType,
        fileExtension: item.fileExtension,
        contentHash: item.contentHash,
        rawName,
        sourcePath: sourcePath ?? null,
        relativePath: item.relativePath,
        parentFolderId: item.parentFolderId,
        isDirectory: item.isDirectory,
        processingStatus: staleRow ? "failed" : item.processingStatus,
        progressPercentage: staleRow ? 0 : item.progressPercentage,
        currentStep: staleRow ? "迁移时未找到原件" : item.currentStep,
        errorMessage: staleRow
          ? `迁移时未找到原件${sourcePath ? `：${sourcePath}` : ""}`
          : item.errorMessage,
        totalChunks: item.totalChunks,
        totalTokens: item.totalTokens,
        uploadedAt: item.uploadedAt,
        processedAt: item.processedAt,
      });
      stats.items += 1;

      if (item.isDirectory) continue;
      if (staleRow) continue; // 没有原件，分块也必然无从谈起

      const rows = sources.chunksByItem.get(item.id) ?? [];
      if (rows.length === 0) continue;
      chunkCount += await chunkRepo.replaceChunks(kbId, item.id, rows);
    }
    return chunkCount;
  }

  /** 把源文件移到 `<staging>/raw/<itemId>/<原文件名>` */
  private async moveRawInto(
    item: LegacyKbFileMeta,
    kbId: string,
    stagingDir: string,
    sourcePath: string,
  ): Promise<string | null> {
    const targetDir = path.join(stagingDir, "raw", item.id);
    await fsp.mkdir(targetDir, { recursive: true });
    const base = path.basename(sourcePath);
    const safe = base.replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, "_") || "file";
    const target = path.join(targetDir, safe);
    try {
      await fsp.rename(sourcePath, target);
      return safe;
    } catch {
      // 跨盘符 rename 会失败 → 退回复制 + 删除
      try {
        await fsp.copyFile(sourcePath, target);
        await fsp.unlink(sourcePath);
        return safe;
      } catch (err: any) {
        this.logger.warn(
          `原件搬入库内失败，保留原位：${sourcePath} → ${target}: ${err?.message || err}`,
        );
        return null;
      }
    }
  }

  /**
   * 该库是否已完成迁移：有 kb.db、无旧 file.json、且库里已有条目行。
   *
   * 「已有条目行」是关键：只有被真正导入过（或用户新建过）的库才算完成，
   * 空库（如被中断的启动期对账建出的）仍需重新导入。
   */
  private async isAlreadyMigrated(
    kbDir: string,
    kbId: string,
  ): Promise<boolean> {
    const dbPath = path.join(kbDir, KB_DB_FILE);
    if (!fs.existsSync(dbPath)) return false;
    if (await this.hasLegacyFileJson(kbDir)) return false;

    let db: Database.Database | null = null;
    try {
      db = new Database(dbPath, { readonly: true });
      const row = db.prepare(`SELECT COUNT(*) c FROM item`).get() as {
        c: number;
      };
      return row.c > 0;
    } catch (err: any) {
      // 读不开就当未迁移，交给下面的导入流程重建（有 .pre-sqlite 备份兜底）
      this.logger.warn(
        `库 ${kbId} 的 kb.db 无法读取，将重新导入：${err?.message || err}`,
      );
      return false;
    } finally {
      try {
        db?.close();
      } catch {
        /* 忽略 */
      }
    }
  }

  /** 该库目录下是否还有旧形态的 `<itemId>/file.json` */
  private async hasLegacyFileJson(kbDir: string): Promise<boolean> {
    let entries: import("fs").Dirent[];
    try {
      entries = await fsp.readdir(kbDir, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      if (entry.name === "raw") continue;
      try {
        await fsp.access(path.join(kbDir, entry.name, "file.json"));
        return true;
      } catch {
        /* 该目录没有 file.json */
      }
    }
    return false;
  }

  /** 共享上传目录里无人引用的文件（只报告） */
  private async reportUnreferencedUploads(
    referenced: Set<string>,
  ): Promise<string[]> {
    const uploadRoot = process.env.UPLOAD_ROOT_DIR;
    if (!uploadRoot) return [];
    const kbUploadDir = path.resolve(uploadRoot, "knowledge-base");
    if (!fs.existsSync(kbUploadDir)) return [];

    const orphans: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries: import("fs").Dirent[];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (!referenced.has(path.resolve(full))) orphans.push(full);
      }
    };
    await walk(kbUploadDir);
    if (orphans.length > 0) {
      this.logger.warn(
        `共享上传目录下有 ${orphans.length} 个文件没有任何元信息引用（**未删除**）：` +
          orphans.slice(0, 5).join(", ") +
          (orphans.length > 5 ? " …" : ""),
      );
    }
    return orphans;
  }

  /** 旧全局向量库改名保留（不删除，便于回滚） */
  private async retireLegacyVectorDb(): Promise<void> {
    const legacyPath = process.env.VECTOR_DB_PATH
      ? path.resolve(process.env.VECTOR_DB_PATH)
      : path.join(process.cwd(), "data", LEGACY_VECTOR_DB);
    if (!fs.existsSync(legacyPath)) return;
    const retired = `${legacyPath}.pre-sqlite`;
    if (fs.existsSync(retired)) return;
    try {
      await fsp.rename(legacyPath, retired);
      // -wal/-shm 一并改名，避免残留
      for (const suffix of ["-wal", "-shm"]) {
        if (fs.existsSync(`${legacyPath}${suffix}`)) {
          await fsp.rename(`${legacyPath}${suffix}`, `${retired}${suffix}`);
        }
      }
      this.logger.log(
        `旧全局向量库已改名保留（可回滚，确认无误后可手动删除）：${retired}`,
      );
    } catch (err: any) {
      this.logger.warn(`旧向量库改名失败：${err?.message || err}`);
    }
  }

  private async collectSources() {
    return new KbIntegrationSources(
      this.prisma,
      this.databases,
      this.logger,
    ).collect();
  }
}

/** 迁移源集合（从三种历史形态读取，供导入使用） */
class KbIntegrationSources {
  constructor(
    private readonly prisma: PrismaService,
    private readonly databases: KbDatabaseService,
    private readonly logger: Logger,
  ) {}

  async collect(): Promise<{
    kbs: Map<string, KnowledgeBaseMeta>;
    itemsByKb: Map<string, LegacyKbFileMeta[]>;
    chunksByItem: Map<string, any[]>;
    referencedUploads: Set<string>;
  }> {
    const kbs = new Map<string, KnowledgeBaseMeta>();
    const itemsByKb = new Map<string, LegacyKbFileMeta[]>();
    const chunksByItem = new Map<string, any[]>();
    const referencedUploads = new Set<string>();

    // S1: frozen 主库（三张表独立采集，单表失败不影响其它表）
    await this.collectFromDb(kbs, itemsByKb, chunksByItem, referencedUploads);
    // S2: 旧文件形态（在当前根 + .new 之外的目录）
    await this.collectFromFiles(kbs, itemsByKb, chunksByItem, referencedUploads);
    // S3: 全局向量库（补向量）
    const vectors = await this.collectVectors();
    await this.attachVectors(chunksByItem, vectors);

    return { kbs, itemsByKb, chunksByItem, referencedUploads };
  }

  private async collectFromDb(
    kbs: Map<string, KnowledgeBaseMeta>,
    itemsByKb: Map<string, LegacyKbFileMeta[]>,
    chunksByItem: Map<string, any[]>,
    referencedUploads: Set<string>,
  ): Promise<void> {
    // 逐表独立 try：任何一张表读失败都只损失该表的数据，
    // 不能像之前那样一个异常吞掉整批条目（真实事故：kb_chunk 的排序字段写错，
    // 导致 kb_file 的 4 条里只导入了 3 条，且日志只留一句"跳过该来源"）。
    let kbRows: Array<Record<string, any>> = [];
    let fileRows: Array<Record<string, any>> = [];
    let chunkRows: Array<Record<string, any>> = [];

    try {
      kbRows = await this.prisma.knowledgeBase.findMany();
    } catch (err) {
      this.logger.warn(`读取 knowledge_base 失败：${String(err)}`);
    }

    try {
      fileRows = await this.prisma.kBFile.findMany();
    } catch (err) {
      this.logger.warn(`读取 kb_file 失败：${String(err)}`);
    }

    try {
      chunkRows = await this.prisma.kBChunk.findMany({
        orderBy: { chunkIndex: "asc" },
      });
    } catch (err) {
      // 分块表读不到不致命（正文可从旧 chunks.jsonl 来源补齐），但必须显式告警
      this.logger.warn(
        `读取 kb_chunk 失败（该表分块将改由旧文件来源补齐）：${String(err)}`,
      );
    }

    if (kbRows.length === 0 && fileRows.length === 0 && chunkRows.length === 0) {
      this.logger.log("来源 S1（冻结主库）：无数据");
      return;
    }

    for (const row of kbRows) {
      const id = String(row.id);
      if (kbs.has(id)) continue;
      kbs.set(id, {
        id,
        name: String(row.name ?? ""),
        description: pick(row, "description", "description") ?? null,
        embeddingModelId: String(
          pick(row, "embeddingModelId", "embedding_model_id") ?? "",
        ),
        chunkMaxSize: Number(pick(row, "chunkMaxSize", "chunk_max_size") ?? 1000),
        chunkOverlapSize: Number(
          pick(row, "chunkOverlapSize", "chunk_overlap_size") ?? 100,
        ),
        chunkMinSize: Number(pick(row, "chunkMinSize", "chunk_min_size") ?? 50),
        isActive: pick(row, "isActive", "is_active") !== false,
        isPublic: pick(row, "isPublic", "is_public") === true,
        metadataConfig: (() => {
          const value = pick(row, "metadataConfig", "metadata_config");
          return value && typeof value === "object" ? value : null;
        })(),
        createdAt: this.toISO(pick(row, "createdAt", "created_at")),
        updatedAt: this.toISO(pick(row, "updatedAt", "updated_at")),
      });
    }

    for (const row of fileRows) {
      const kbId = String(pick(row, "knowledgeBaseId", "knowledge_base_id") ?? "");
      if (!kbId) continue;
      const meta = this.dbFileRowToMeta(row, kbId);
      if (meta.filePath) referencedUploads.add(path.resolve(meta.filePath));
      const list = itemsByKb.get(kbId) ?? [];
      if (!list.some((m) => m.id === meta.id)) list.push(meta);
      itemsByKb.set(kbId, list);
    }

    for (const row of chunkRows) {
      const fileId = String(pick(row, "fileId", "file_id") ?? "");
      if (!fileId) continue;
      const list = chunksByItem.get(fileId) ?? [];
      list.push({
        id: String(row.id),
        vectorId: pick(row, "vectorId", "vector_id") ?? String(row.id),
        chunkIndex: Number(pick(row, "chunkIndex", "chunk_index") ?? list.length),
        content: String(row.content ?? ""),
        tokenCount: Number(pick(row, "tokenCount", "token_count") ?? 0),
        embedding: null,
        embeddingDimensions:
          pick(row, "embeddingDimensions", "embedding_dimensions") ?? null,
        metadata: pick(row, "metadata", "metadata") ?? null,
        createdAt: this.toISO(pick(row, "createdAt", "created_at")),
      });
      chunksByItem.set(fileId, list);
    }

    this.logger.log(
      `来源 S1（冻结主库）：${kbRows.length} 库、${fileRows.length} 条目、${chunkRows.length} 分块`,
    );
  }

  /** S2：旧的 `kb.json` + `<itemId>/file.json` + `<itemId>/chunks.jsonl` 形态 */
  private async collectFromFiles(
    kbs: Map<string, KnowledgeBaseMeta>,
    itemsByKb: Map<string, LegacyKbFileMeta[]>,
    chunksByItem: Map<string, any[]>,
    referencedUploads: Set<string>,
  ): Promise<void> {
    const root = this.databases.getRootDir();
    let entries: import("fs").Dirent[];
    try {
      entries = await fsp.readdir(root, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      // 跳过迁移残留的 staging 目录
      if (entry.name.endsWith(".new")) continue;
      const kbId = entry.name;
      const kbDir = path.join(root, kbId);
      const configPath = path.join(kbDir, KB_CONFIG_FILE);
      try {
        const raw = await fsp.readFile(configPath, "utf8");
        const doc = JSON.parse(raw);
        if (!kbs.has(kbId)) {
          kbs.set(kbId, {
            id: kbId,
            name: String(doc.name ?? kbId),
            description: doc.description ?? null,
            embeddingModelId: String(doc.embeddingModelId ?? ""),
            chunkMaxSize: Number(doc.chunkMaxSize ?? 1000),
            chunkOverlapSize: Number(doc.chunkOverlapSize ?? 100),
            chunkMinSize: Number(doc.chunkMinSize ?? 50),
            isActive: doc.isActive !== false,
            isPublic: doc.isPublic === true,
            metadataConfig:
              doc.metadataConfig && typeof doc.metadataConfig === "object"
                ? doc.metadataConfig
                : null,
            createdAt: this.toISO(doc.createdAt),
            updatedAt: this.toISO(doc.updatedAt),
          });
        }
      } catch {
        continue; // 不是知识库目录
      }

      const itemDirs = await fsp.readdir(kbDir, { withFileTypes: true });
      for (const itemEntry of itemDirs) {
        if (!itemEntry.isDirectory() || itemEntry.name.startsWith(".")) continue;
        const itemId = itemEntry.name;
        const itemDir = path.join(kbDir, itemId);

        // file.json（旧形态；若已是 kb.db 形态则没有它，跳过）
        try {
          const raw = await fsp.readFile(
            path.join(itemDir, "file.json"),
            "utf8",
          );
          const doc = JSON.parse(raw);
          const meta: LegacyKbFileMeta = {
            id: itemId,
            knowledgeBaseId: kbId,
            fileName: String(doc.fileName ?? itemId),
            displayName: String(doc.displayName ?? doc.fileName ?? itemId),
            fileSize: Number(doc.fileSize ?? 0),
            fileType: String(doc.fileType ?? ""),
            fileExtension: String(doc.fileExtension ?? ""),
            contentHash: String(doc.contentHash ?? ""),
            filePath: doc.filePath ?? null,
            relativePath: doc.relativePath ?? null,
            parentFolderId: doc.parentFolderId ?? null,
            isDirectory: doc.isDirectory === true,
            processingStatus: String(doc.processingStatus ?? "pending"),
            progressPercentage: Number(doc.progressPercentage ?? 0),
            currentStep: doc.currentStep ?? null,
            errorMessage: doc.errorMessage ?? null,
            totalChunks: Number(doc.totalChunks ?? 0),
            totalTokens: Number(doc.totalTokens ?? 0),
            uploadedAt: this.toISO(doc.uploadedAt),
            processedAt: doc.processedAt ? this.toISO(doc.processedAt) : null,
          };
          if (meta.filePath) {
            referencedUploads.add(path.resolve(meta.filePath));
          }
          const list = itemsByKb.get(kbId) ?? [];
          if (!list.some((m) => m.id === meta.id)) list.push(meta);
          itemsByKb.set(kbId, list);
        } catch {
          /* 该目录没有 file.json */
        }

        // chunks.jsonl
        const chunkPath = path.join(itemDir, "chunks.jsonl");
        if (!fs.existsSync(chunkPath) || chunksByItem.has(itemId)) continue;
        const rows: any[] = [];
        const content = await fsp.readFile(chunkPath, "utf8");
        for (const line of content.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const doc = JSON.parse(trimmed);
            rows.push({
              id: String(doc.id),
              vectorId: doc.vectorId ?? String(doc.id),
              chunkIndex: Number(doc.chunkIndex ?? rows.length),
              content: String(doc.content ?? ""),
              tokenCount: Number(doc.tokenCount ?? 0),
              embedding: null,
              embeddingDimensions: doc.embeddingDimensions ?? null,
              metadata: doc.metadata ?? null,
              createdAt: this.toISO(doc.createdAt),
            });
          } catch {
            /* 跳过坏行 */
          }
        }
        if (rows.length > 0) chunksByItem.set(itemId, rows);
      }
    }
  }

  /** S3：全局向量库的 `kb_<kbId>` 表 → chunkId → 向量 */
  private async collectVectors(): Promise<Map<string, number[]>> {
    const out = new Map<string, number[]>();
    const legacyPath = process.env.VECTOR_DB_PATH
      ? path.resolve(process.env.VECTOR_DB_PATH)
      : path.join(process.cwd(), "data", `${LEGACY_VECTOR_DB}`);
    if (!fs.existsSync(legacyPath)) return out;

    let db: Database.Database | null = null;
    try {
      db = new Database(legacyPath, { readonly: true });
      const tables = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'kb/_%' ESCAPE '/'`,
        )
        .all() as Array<{ name: string }>;
      for (const { name } of tables) {
        if (name.endsWith("_fts")) continue;
        const rows = db
          .prepare(`SELECT id, embedding FROM "${name}" WHERE embedding IS NOT NULL`)
          .all() as Array<{ id: string; embedding: Buffer }>;
        for (const row of rows) {
          const floats = new Float32Array(
            row.embedding.buffer,
            row.embedding.byteOffset,
            Math.floor(row.embedding.byteLength / 4),
          );
          out.set(row.id, Array.from(floats));
        }
      }
      this.logger.log(`来源 S3（旧向量库）：${out.size} 条向量`);
    } catch (err) {
      this.logger.warn(`读取旧向量库失败，跳过该来源：${String(err)}`);
    } finally {
      try {
        db?.close();
      } catch {
        /* 忽略 */
      }
    }
    return out;
  }

  /** 把向量贴到分块行上（按 chunk id 对齐，缺向量则留 NULL，不自动重嵌入） */
  private async attachVectors(
    chunksByItem: Map<string, any[]>,
    vectors: Map<string, number[]>,
  ): Promise<void> {
    if (vectors.size === 0) return;
    let attached = 0;
    for (const rows of chunksByItem.values()) {
      for (const row of rows) {
        const vector = vectors.get(row.id);
        if (vector) {
          row.embedding = vector;
          row.embeddingDimensions = vector.length;
          attached += 1;
        }
      }
    }
    this.logger.log(`向量对齐：${attached} 条分块拿到向量`);
    const missing = [...chunksByItem.values()]
      .flat()
      .filter((r) => !r.embedding).length;
    if (missing > 0) {
      this.logger.warn(
        `有 ${missing} 条分块没有向量（语义检索暂不覆盖这些分块）。` +
          `如需补齐请运行：pnpm kb:reembed（只重新嵌入，不重新解析/OCR）`,
      );
    }
  }

  private dbFileRowToMeta(
    row: Record<string, any>,
    kbId: string,
  ): LegacyKbFileMeta {
    const fileName = String(pick(row, "fileName", "file_name") ?? "");
    return {
      id: String(row.id),
      knowledgeBaseId: kbId,
      fileName,
      displayName: String(
        pick(row, "displayName", "display_name") ?? fileName,
      ),
      fileSize: Number(pick(row, "fileSize", "file_size") ?? 0),
      fileType: String(pick(row, "fileType", "file_type") ?? ""),
      fileExtension: String(pick(row, "fileExtension", "file_extension") ?? ""),
      contentHash: String(pick(row, "contentHash", "content_hash") ?? ""),
      filePath: pick(row, "filePath", "file_path") ?? null,
      relativePath: pick(row, "relativePath", "relative_path") ?? null,
      parentFolderId: pick(row, "parentFolderId", "parent_folder_id") ?? null,
      // SQLite 存 0/1，Prisma 存 boolean —— 两种都要认
      isDirectory:
        pick(row, "isDirectory", "is_directory") === true ||
        pick(row, "isDirectory", "is_directory") === 1,
      processingStatus: String(
        pick(row, "processingStatus", "processing_status") ?? "pending",
      ),
      progressPercentage: Number(
        pick(row, "progressPercentage", "progress_percentage") ?? 0,
      ),
      currentStep: pick(row, "currentStep", "current_step") ?? null,
      errorMessage: pick(row, "errorMessage", "error_message") ?? null,
      totalChunks: Number(pick(row, "totalChunks", "total_chunks") ?? 0),
      totalTokens: Number(pick(row, "totalTokens", "total_tokens") ?? 0),
      uploadedAt: this.toISO(pick(row, "uploadedAt", "uploaded_at")),
      processedAt: pick(row, "processedAt", "processed_at")
        ? this.toISO(pick(row, "processedAt", "processed_at"))
        : null,
    };
  }

  private toISO(value: any): string {
    if (value instanceof Date) return value.toISOString();
    const d = new Date(value);
    return Number.isNaN(d.getTime())
      ? new Date().toISOString()
      : d.toISOString();
  }
}
