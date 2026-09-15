import { Inject, Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "crypto";
import type Database from "better-sqlite3";
import {
  KbDatabaseService,
  assertValidKbId,
} from "../../modules/knowledge-base/kb-database.service";

/**
 * 条目 id 前缀（与 DB 时代 cuid 并存：存量 id 保持原值不动）
 */
export const KB_ITEM_ID_PREFIX = "kbf-";

/**
 * 仓储需要的最小数据库访问面（KbDatabaseService 实现它）。
 *
 * 抽成接口而不是直接依赖具体服务，是为了让迁移导入器能用「指向 staging 目录」
 * 的临时实现复用同一套 SQL——迁移路径与运行路径共用代码，才不会长期分叉带病。
 */
export interface KbDbAccess {
  getDb(kbId: string): Promise<Database.Database>;
  ready(): Promise<void>;
  getRootDir(): string;
  exists(kbId: string): Promise<boolean>;
  listKbIds(): Promise<string[]>;
  invalidateKbList(): void;
}

/** 条目元信息（= 原 kb_file 表行；knowledgeBaseId 由所在库隐含，读取时补回） */
export interface KbItemRow extends Record<string, any> {
  id: string;
  knowledgeBaseId: string;
  fileName: string;
  displayName: string;
  fileSize: number;
  fileType: string;
  fileExtension: string;
  contentHash: string;
  /** raw/<itemId>/ 内的文件名（库内原件副本；无原件时为 null） */
  rawName: string | null;
  /** 上传时原件的来源路径（仅作"重新摄取"提示，可空） */
  sourcePath: string | null;
  relativePath: string | null;
  parentFolderId: string | null;
  isDirectory: boolean;
  processingStatus: string;
  progressPercentage: number;
  currentStep: string | null;
  errorMessage: string | null;
  totalChunks: number;
  totalTokens: number;
  uploadedAt: Date;
  processedAt: Date | null;
}

/** 库内原始行（DB 形状） */
interface ItemDbRow {
  id: string;
  file_name: string;
  display_name: string;
  file_size: number;
  file_type: string;
  file_extension: string;
  content_hash: string;
  raw_name: string | null;
  source_path: string | null;
  relative_path: string | null;
  parent_folder_id: string | null;
  is_directory: number;
  processing_status: string;
  progress_percentage: number;
  current_step: string | null;
  error_message: string | null;
  total_chunks: number;
  total_tokens: number;
  uploaded_at: string;
  processed_at: string | null;
}

/**
 * KB 条目仓储（每库一个 SQLite）
 *
 * 权威来源 = `<KB根>/<kbId>/kb.db` 的 `item` 表。类名保留 `KBFileRepository`，
 * 以便既有调用方与 DI 装配零改动。
 *
 * 与原 Prisma/文件版的关键差别：**点查询需要 kbId**（库即作用域，不再有全局 id 空间）。
 * 跨库方法（findByStatus / listItems 省略 kbId）保留：启动期对账确实需要跨库视图。
 *
 * 排序语义与原实现保持一致：
 * - 平铺列表：uploadedAt 降序 → id 升序（ISO 串字典序 = 时间序，交给 SQL）
 * - 目录树：文件夹优先 → displayName（`localeCompare`）→ id（留在 JS 里，
 *   因为 SQLite 默认 BINARY collation 与 `localeCompare` 对中文/大小写结果不同）
 */
@Injectable()
export class KBFileRepository {
  private readonly logger = new Logger(KBFileRepository.name);

  constructor(
    // 显式 token：形参类型是接口（KbDbAccess），运行期被擦除，Nest 会解析成 Object 而失败。
    // 生产装配注入 KbDatabaseService；迁移导入器自行构造时传 staging 实现。
    @Inject(KbDatabaseService) private readonly databases: KbDbAccess,
  ) {}

  // ============ 读取 ============

  async findById(kbId: string, id: string): Promise<KbItemRow | null> {
    const db = await this.databases.getDb(kbId);
    const row = db
      .prepare(`SELECT * FROM item WHERE id = ?`)
      .get(id) as ItemDbRow | undefined;
    return row ? this.toRow(row, kbId) : null;
  }

  /** 批量取条目（保持入参顺序，跳过不存在的 id） */
  async findByIds(kbId: string, ids: string[]): Promise<KbItemRow[]> {
    if (!ids || ids.length === 0) return [];
    const db = await this.databases.getDb(kbId);
    const out: KbItemRow[] = [];
    // 保持入参顺序（与原实现一致），并跳过不存在的 id
    for (const id of ids) {
      const row = db
        .prepare(`SELECT * FROM item WHERE id = ?`)
        .get(id) as ItemDbRow | undefined;
      if (row) out.push(this.toRow(row, kbId));
    }
    return out;
  }

  async findByKnowledgeBaseId(
    kbId: string,
    skip: number = 0,
    limit: number = 50,
  ): Promise<{ items: KbItemRow[]; total: number }> {
    const db = await this.databases.getDb(kbId);
    const total = (
      db.prepare(`SELECT COUNT(*) c FROM item`).get() as { c: number }
    ).c;
    const rows = db
      .prepare(
        `SELECT * FROM item ORDER BY uploaded_at DESC, id ASC LIMIT ? OFFSET ?`,
      )
      .all(limit, skip) as ItemDbRow[];
    return { items: rows.map((r) => this.toRow(r, kbId)), total };
  }

  async findByParentFolderId(
    kbId: string,
    parentFolderId: string | null,
    skip: number = 0,
    limit: number = 50,
  ): Promise<{ items: KbItemRow[]; total: number }> {
    return this.queryChildren(kbId, parentFolderId, skip, limit);
  }

  async findChildren(
    kbId: string,
    parentFolderId: string,
    skip: number = 0,
    limit: number = 50,
  ): Promise<{ items: KbItemRow[]; total: number }> {
    return this.queryChildren(kbId, parentFolderId, skip, limit);
  }

  /** 目录内直系子项：文件夹优先 → 名称 → id（JS 排序，保证与旧行为逐字节一致） */
  private async queryChildren(
    kbId: string,
    parentFolderId: string | null,
    skip: number,
    limit: number,
  ): Promise<{ items: KbItemRow[]; total: number }> {
    const db = await this.databases.getDb(kbId);
    const rows = (
      parentFolderId === null
        ? db.prepare(`SELECT * FROM item WHERE parent_folder_id IS NULL`).all()
        : db
            .prepare(`SELECT * FROM item WHERE parent_folder_id = ?`)
            .all(parentFolderId)
    ) as ItemDbRow[];
    const sorted = this.sortTree(rows.map((r) => this.toRow(r, kbId)));
    return { items: sorted.slice(skip, skip + limit), total: sorted.length };
  }

  private sortTree(items: KbItemRow[]): KbItemRow[] {
    return [...items].sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      const byName = (a.displayName ?? "").localeCompare(b.displayName ?? "");
      return byName !== 0 ? byName : a.id.localeCompare(b.id);
    });
  }

  async findByRelativePath(
    kbId: string,
    relativePath: string,
    isDirectory: boolean = false,
  ): Promise<KbItemRow | null> {
    const db = await this.databases.getDb(kbId);
    const row = (
      isDirectory
        ? db
            .prepare(
              `SELECT * FROM item WHERE relative_path = ? AND is_directory = 1 LIMIT 1`,
            )
            .get(relativePath)
        : db
            .prepare(`SELECT * FROM item WHERE relative_path = ? LIMIT 1`)
            .get(relativePath)
    ) as ItemDbRow | undefined;
    return row ? this.toRow(row, kbId) : null;
  }

  async findByPathAndParent(
    kbId: string,
    name: string,
    parentFolderId: string | null,
    isDirectory?: boolean,
  ): Promise<KbItemRow | null> {
    const db = await this.databases.getDb(kbId);
    const conditions = [`display_name = ?`];
    const params: any[] = [name];
    if (parentFolderId === null) conditions.push(`parent_folder_id IS NULL`);
    else {
      conditions.push(`parent_folder_id = ?`);
      params.push(parentFolderId);
    }
    if (isDirectory !== undefined) {
      conditions.push(`is_directory = ?`);
      params.push(isDirectory ? 1 : 0);
    }
    const row = db
      .prepare(`SELECT * FROM item WHERE ${conditions.join(" AND ")} LIMIT 1`)
      .get(...params) as ItemDbRow | undefined;
    return row ? this.toRow(row, kbId) : null;
  }

  async findByContentHash(
    kbId: string,
    contentHash: string,
  ): Promise<KbItemRow | null> {
    const db = await this.databases.getDb(kbId);
    const row = db
      .prepare(`SELECT * FROM item WHERE content_hash = ? LIMIT 1`)
      .get(contentHash) as ItemDbRow | undefined;
    return row ? this.toRow(row, kbId) : null;
  }

  async countByKnowledgeBaseId(kbId: string): Promise<number> {
    const db = await this.databases.getDb(kbId);
    return (db.prepare(`SELECT COUNT(*) c FROM item`).get() as { c: number }).c;
  }

  /** 根级条目（parentFolderId 为 NULL） */
  async findRootItems(
    kbId: string,
    skip: number = 0,
    limit: number = 50,
  ): Promise<{ items: KbItemRow[]; total: number }> {
    return this.queryChildren(kbId, null, skip, limit);
  }

  /**
   * 按处理状态查询。
   * @param kbId 省略则跨全部知识库（启动期对账用），给出则只查该库
   */
  async findByStatus(statuses: string[], kbId?: string): Promise<KbItemRow[]> {
    const out: KbItemRow[] = [];
    if (statuses.length === 0) return out;
    const placeholders = statuses.map(() => "?").join(",");
    const targets = kbId ? [kbId] : await this.listKbIds();
    for (const id of targets) {
      if (!(await this.kbExists(id))) continue;
      const db = await this.databases.getDb(id);
      const rows = db
        .prepare(
          `SELECT * FROM item WHERE processing_status IN (${placeholders})`,
        )
        .all(...statuses) as ItemDbRow[];
      for (const row of rows) out.push(this.toRow(row, id));
    }
    return out;
  }

  /**
   * 列出条目元信息（返回元信息行，供上层组合）。
   * @param kbId 限定知识库；省略则跨全部知识库（孤儿扫描用）
   * @param isDirectory true=只查文件夹, false=只查文件, undefined=都查
   */
  async listItems(
    kbId?: string,
    isDirectory?: boolean,
  ): Promise<KbItemRow[]> {
    const out: KbItemRow[] = [];
    const targets = kbId ? [kbId] : await this.listKbIds();
    for (const id of targets) {
      if (!(await this.kbExists(id))) continue;
      const db = await this.databases.getDb(id);
      const sql =
        isDirectory === undefined
          ? `SELECT * FROM item`
          : `SELECT * FROM item WHERE is_directory = ?`;
      const rows = (
        isDirectory === undefined
          ? db.prepare(sql).all()
          : db.prepare(sql).all(isDirectory ? 1 : 0)
      ) as ItemDbRow[];
      for (const row of rows) out.push(this.toRow(row, id));
    }
    return out;
  }

  // ============ 写入 ============

  /**
   * 新建条目。
   *
   * id 缺省时生成 `kbf-<uuid v4>`——旧实现 `String(data.id)` 在缺 id 时得到字面量
   * `"undefined"`，导致所有新建条目共用一个 file.json 互相覆盖（活跃路径上的真故障）。
   */
  async create(kbId: string, data: Record<string, any>): Promise<KbItemRow> {
    const id = this.resolveId(data.id);
    const now = new Date().toISOString();
    const row: ItemDbRow = {
      id,
      file_name: data.fileName ?? data.rawName ?? id,
      display_name: data.displayName ?? data.fileName ?? id,
      file_size: Number(data.fileSize ?? 0) || 0,
      file_type: data.fileType ?? "",
      file_extension: data.fileExtension ?? "",
      content_hash: data.contentHash ?? "",
      raw_name: data.rawName ?? null,
      source_path: data.sourcePath ?? null,
      relative_path: data.relativePath ?? null,
      parent_folder_id: data.parentFolderId ?? null,
      is_directory: data.isDirectory === true ? 1 : 0,
      processing_status: data.processingStatus ?? "pending",
      progress_percentage: Number(data.progressPercentage ?? 0) || 0,
      current_step: data.currentStep ?? null,
      error_message: data.errorMessage ?? null,
      total_chunks: Number(data.totalChunks ?? 0) || 0,
      total_tokens: Number(data.totalTokens ?? 0) || 0,
      uploaded_at: this.toISO(data.uploadedAt) ?? now,
      processed_at: this.toISO(data.processedAt),
    };

    const db = await this.databases.getDb(kbId);
    db.prepare(
      `INSERT INTO item (
        id, file_name, display_name, file_size, file_type, file_extension, content_hash,
        raw_name, source_path, relative_path, parent_folder_id, is_directory,
        processing_status, progress_percentage, current_step, error_message,
        total_chunks, total_tokens, uploaded_at, processed_at
      ) VALUES (
        @id, @file_name, @display_name, @file_size, @file_type, @file_extension, @content_hash,
        @raw_name, @source_path, @relative_path, @parent_folder_id, @is_directory,
        @processing_status, @progress_percentage, @current_step, @error_message,
        @total_chunks, @total_tokens, @uploaded_at, @processed_at
      )`,
    ).run(row);
    return this.toRow(row, kbId);
  }

  /** 生成或校验 id（生成后做唯一性兜底） */
  private resolveId(rawId: any): string {
    if (rawId === undefined || rawId === null || String(rawId) === "") {
      return `${KB_ITEM_ID_PREFIX}${randomUUID()}`;
    }
    const id = String(rawId);
    assertValidKbId(id);
    return id;
  }

  /**
   * 分部更新（只写给出的字段）。
   * @returns 更新后的行；id 不存在时返回 null
   */
  async update(
    kbId: string,
    id: string,
    data: Record<string, any>,
  ): Promise<KbItemRow | null> {
    const db = await this.databases.getDb(kbId);
    const current = db
      .prepare(`SELECT * FROM item WHERE id = ?`)
      .get(id) as ItemDbRow | undefined;
    if (!current) return null;

    const patch: Record<string, any> = {};
    const map: Record<string, string> = {
      fileName: "file_name",
      displayName: "display_name",
      fileSize: "file_size",
      fileType: "file_type",
      fileExtension: "file_extension",
      contentHash: "content_hash",
      rawName: "raw_name",
      sourcePath: "source_path",
      relativePath: "relative_path",
      parentFolderId: "parent_folder_id",
      isDirectory: "is_directory",
      processingStatus: "processing_status",
      progressPercentage: "progress_percentage",
      currentStep: "current_step",
      errorMessage: "error_message",
      totalChunks: "total_chunks",
      totalTokens: "total_tokens",
      uploadedAt: "uploaded_at",
      processedAt: "processed_at",
    };
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;
      const column = map[key];
      if (!column) continue;
      if (key === "isDirectory") patch[column] = value === true ? 1 : 0;
      else if (key === "uploadedAt" || key === "processedAt") {
        patch[column] = this.toISO(value);
      } else patch[column] = value;
    }
    if (Object.keys(patch).length === 0) return this.toRow(current, kbId);

    const assignments = Object.keys(patch)
      .map((c) => `${c} = @${c}`)
      .join(", ");
    db.prepare(`UPDATE item SET ${assignments} WHERE id = @id`).run({
      ...patch,
      id,
    });
    const updated = db
      .prepare(`SELECT * FROM item WHERE id = ?`)
      .get(id) as ItemDbRow;
    return this.toRow(updated, kbId);
  }

  /**
   * 更新处理状态（对齐原 KBFileRepository.updateProcessingStatus 的字段语义）
   */
  async updateProcessingStatus(
    kbId: string,
    id: string,
    status: string,
    progress?: number,
    currentStep?: string,
    errorMessage?: string | null,
    totalChunks?: number,
    totalTokens?: number,
  ): Promise<KbItemRow | null> {
    const patch: Record<string, any> = { processingStatus: status };
    if (progress !== undefined) patch.progressPercentage = progress;
    if (currentStep !== undefined) patch.currentStep = currentStep;
    if (errorMessage !== undefined) patch.errorMessage = errorMessage;
    if (totalChunks !== undefined) patch.totalChunks = totalChunks;
    if (totalTokens !== undefined) patch.totalTokens = totalTokens;
    if (status === "completed") patch.processedAt = new Date().toISOString();
    return this.update(kbId, id, patch);
  }

  /** 删除条目行（原件目录与分块由上层一并清理） */
  async delete(kbId: string, id: string): Promise<boolean> {
    const db = await this.databases.getDb(kbId);
    const info = db.prepare(`DELETE FROM item WHERE id = ?`).run(id);
    return info.changes > 0;
  }

  /**
   * 前缀级联重写 relativePath（文件夹改名/移动）——**单条 UPDATE**。
   *
   * 替代原实现「逐个子项整写 file.json」：原实现 N 个子项 = N+1 次原子写 + 触发一次
   * 全量重扫，千级条目下用户点一下改名要等数秒。
   *
   * 用 `substr` 比较而非 `LIKE`：`%`/`_` 在路径里是合法字符，LIKE 需要额外转义。
   */
  async rewriteRelativePathPrefix(
    kbId: string,
    prefix: string,
    nextPrefix: string,
  ): Promise<number> {
    const db = await this.databases.getDb(kbId);
    const info = db
      .prepare(
        `UPDATE item
            SET relative_path = @next || substr(relative_path, length(@prefix) + 1)
          WHERE substr(relative_path, 1, length(@prefix)) = @prefix`,
      )
      .run({ prefix, next: nextPrefix });
    return info.changes;
  }

  // ============ 库级辅助 ============

  /** 库目录下所有条目 id（删除整个库前收集 raw 目录用） */
  async listItemIds(kbId: string): Promise<string[]> {
    if (!(await this.kbExists(kbId))) return [];
    const db = await this.databases.getDb(kbId);
    return (
      db.prepare(`SELECT id FROM item`).all() as Array<{ id: string }>
    ).map((r) => r.id);
  }

  /** 知识库根下已落盘的库 id（目录含 kb.json 者） */
  async listKbIds(): Promise<string[]> {
    return this.databases.listKbIds();
  }

  async kbExists(kbId: string): Promise<boolean> {
    if (!kbId || /[\\/:*?"<>|]/.test(kbId) || kbId.startsWith(".")) return false;
    return this.databases.exists(kbId);
  }

  // ============ 行转换 ============

  private toRow(row: ItemDbRow, kbId: string): KbItemRow {
    return {
      id: row.id,
      knowledgeBaseId: kbId,
      fileName: row.file_name,
      displayName: row.display_name,
      fileSize: row.file_size,
      fileType: row.file_type,
      fileExtension: row.file_extension,
      contentHash: row.content_hash,
      rawName: row.raw_name,
      sourcePath: row.source_path,
      relativePath: row.relative_path,
      parentFolderId: row.parent_folder_id,
      isDirectory: row.is_directory === 1,
      processingStatus: row.processing_status,
      progressPercentage: row.progress_percentage,
      currentStep: row.current_step,
      errorMessage: row.error_message,
      totalChunks: row.total_chunks,
      totalTokens: row.total_tokens,
      uploadedAt: new Date(row.uploaded_at),
      processedAt: row.processed_at ? new Date(row.processed_at) : null,
    };
  }

  private toISO(value: any): string | null {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value.toISOString();
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
}
