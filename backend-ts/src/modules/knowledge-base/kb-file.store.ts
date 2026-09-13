import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import * as chokidar from "chokidar";
import {
  META_DOMAIN_KB,
  MetadataBootstrapGate,
} from "../../common/database/metadata-bootstrap.gate";

/**
 * 知识库元信息文件存储
 *
 * 权威来源：
 *   <KB根>/<kbId>/kb.json            KB 配置（原 knowledge_base 表行）
 *   <KB根>/<kbId>/<itemId>/file.json 文件/文件夹元信息（原 kb_file 表行）
 *   <KB根>/<kbId>/<itemId>/chunks.jsonl 分块正本（已有，KbChunkFileStore）
 *
 * 布局要点：**文件元信息与其分块目录同址** → 删除文件 = 删一个目录，
 * 元信息与分块天然一起走（同"头像进角色目录"的做法），不会留孤儿。
 * 目录/条目 id 保持原 cuid 不变（itemId = 原 kb_file.id）→ 引用零改写。
 *
 * 索引：启动全量扫 kb.json 与各 item 的 file.json 进内存；查询全部内存过滤。
 * watcher 只关心 kb.json / file.json（chunks.jsonl 由写入方管理，不监听）。
 */

export const KB_CONFIG_FILE = "kb.json";
export const KB_ITEM_FILE = "file.json";
export const KB_MIGRATED_MARKER = ".migrated-kb";

/** 知识库配置（= 原 knowledge_base 表行） */
export interface KnowledgeBaseMeta {
  id: string;
  name: string;
  description: string | null;
  embeddingModelId: string;
  chunkMaxSize: number;
  chunkOverlapSize: number;
  chunkMinSize: number;
  isActive: boolean;
  isPublic: boolean;
  metadataConfig: Record<string, any> | null;
  createdAt: string;
  updatedAt: string;
}

/** KB 文件/文件夹元信息（= 原 kb_file 表行） */
export interface KbFileMeta {
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

export interface KbLoadError {
  file: string;
  message: string;
}

/** KB 数据根（与 KbChunkFileStore 一致的解析规则） */
export function resolveKbDir(): string {
  return process.env.KB_DATA_DIR
    ? path.resolve(process.env.KB_DATA_DIR)
    : process.env.USERDATA_DIR
      ? path.join(process.env.USERDATA_DIR, "data", "kb")
      : path.resolve(process.cwd(), "data", "kb");
}

function toKbRow(meta: KnowledgeBaseMeta): Record<string, any> {
  return {
    ...meta,
    createdAt: new Date(meta.createdAt),
    updatedAt: new Date(meta.updatedAt),
  };
}

function toFileRow(meta: KbFileMeta): Record<string, any> {
  return {
    ...meta,
    uploadedAt: new Date(meta.uploadedAt),
    processedAt: meta.processedAt ? new Date(meta.processedAt) : null,
  };
}

function toISO(value: any, fallback?: string): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? (fallback ?? null) : d.toISOString();
}

@Injectable()
export class KbFileStore implements OnModuleDestroy {
  private readonly logger = new Logger(KbFileStore.name);
  private readonly rootDir: string;

  /** kbId → 配置 */
  private kbIndex = new Map<string, KnowledgeBaseMeta>();
  /** fileId → 文件元信息 */
  private fileIndex = new Map<string, KbFileMeta>();
  private loadErrors = new Map<string, KbLoadError>();

  private watcher: chokidar.FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private ready: Promise<void> | null = null;
  private writeChains = new Map<string, Promise<unknown>>();

  constructor(private readonly gate: MetadataBootstrapGate) {
    this.rootDir = resolveKbDir();
  }

  getRootDir(): string {
    return this.rootDir;
  }

  getKbDir(kbId: string): string {
    return path.join(this.rootDir, kbId);
  }

  /** 条目目录（file.json 与 chunks.jsonl 同址） */
  getItemDir(kbId: string, itemId: string): string {
    return path.join(this.rootDir, kbId, itemId);
  }

  getKbConfigPath(kbId: string): string {
    return path.join(this.getKbDir(kbId), KB_CONFIG_FILE);
  }

  getItemMetaPath(kbId: string, itemId: string): string {
    return path.join(this.getItemDir(kbId, itemId), KB_ITEM_FILE);
  }

  async initialize(): Promise<void> {
    this.ready ??= this.doInitialize();
    return this.ready;
  }

  private async doInitialize(): Promise<void> {
    // 迁移导出未完成时不得读索引
    await this.gate.wait(META_DOMAIN_KB);
    await fsp.mkdir(this.rootDir, { recursive: true });
    await this.loadAll();
    this.startWatcher();
  }

  /**
   * 外部批量写入（迁移导出）后强制重载。
   * 不经过 initialize()：导出引导在门控放行前调用，等待门控会自锁。
   */
  async reload(): Promise<void> {
    await this.loadAll();
  }

  // ============ 索引加载 ============

  private async loadAll(): Promise<void> {
    const started = Date.now();
    let kbDirs: fs.Dirent[];
    try {
      kbDirs = await fsp.readdir(this.rootDir, { withFileTypes: true });
    } catch {
      return;
    }

    const nextKb = new Map<string, KnowledgeBaseMeta>();
    const nextFile = new Map<string, KbFileMeta>();
    const nextErrors = new Map<string, KbLoadError>();
    let skipped = 0;

    for (const kbEntry of kbDirs) {
      if (!kbEntry.isDirectory() || kbEntry.name.startsWith(".")) continue;
      const kbId = kbEntry.name;

      // kb.json
      try {
        const raw = await fsp.readFile(this.getKbConfigPath(kbId), "utf8");
        nextKb.set(kbId, this.parseKb(raw, kbId));
      } catch (err: any) {
        if (err?.code === "ENOENT") skipped += 1;
        else {
          nextErrors.set(`kb:${kbId}`, {
            file: `${kbId}/${KB_CONFIG_FILE}`,
            message: err?.message || String(err),
          });
          this.logger.warn(
            `Invalid kb.json "${kbId}" (isolated): ${err?.message || err}`,
          );
        }
      }

      // <itemId>/file.json
      let items: fs.Dirent[];
      try {
        items = await fsp.readdir(this.getKbDir(kbId), { withFileTypes: true });
      } catch {
        continue;
      }
      for (const item of items) {
        if (!item.isDirectory() || item.name.startsWith(".")) continue;
        const fileId = item.name;
        try {
          const raw = await fsp.readFile(
            this.getItemMetaPath(kbId, fileId),
            "utf8",
          );
          nextFile.set(fileId, this.parseFile(raw, fileId, kbId));
        } catch (err: any) {
          if (err?.code === "ENOENT") {
            // 无 file.json 的目录：可能是仅存分块的旧目录，跳过（不视为删除）
            skipped += 1;
            continue;
          }
          nextErrors.set(`file:${fileId}`, {
            file: `${kbId}/${fileId}/${KB_ITEM_FILE}`,
            message: err?.message || String(err),
          });
          this.logger.warn(
            `Invalid file.json "${fileId}" (isolated): ${err?.message || err}`,
          );
        }
      }
    }

    this.kbIndex = nextKb;
    this.fileIndex = nextFile;
    this.loadErrors = nextErrors;

    this.logger.log(
      `KB index built: ${nextKb.size} kb(s), ${nextFile.size} item(s) in ${Date.now() - started}ms` +
        (nextErrors.size ? `, ${nextErrors.size} invalid` : "") +
        (skipped ? `, ${skipped} skipped` : ""),
    );
  }

  private parseKb(raw: string, fallbackId: string): KnowledgeBaseMeta {
    const doc = JSON.parse(raw);
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
      throw new Error("kb.json 必须是对象");
    }
    const r = doc as Record<string, any>;
    const now = new Date().toISOString();
    return {
      id: fallbackId,
      name: this.str(r.name) ?? fallbackId,
      description: this.str(r.description),
      embeddingModelId: this.str(r.embeddingModelId) ?? "",
      chunkMaxSize: this.num(r.chunkMaxSize, 1000),
      chunkOverlapSize: this.num(r.chunkOverlapSize, 100),
      chunkMinSize: this.num(r.chunkMinSize, 50),
      isActive: r.isActive !== false,
      isPublic: r.isPublic === true,
      metadataConfig: this.obj(r.metadataConfig),
      createdAt: toISO(r.createdAt, now)!,
      updatedAt: toISO(r.updatedAt, now)!,
    };
  }

  private parseFile(
    raw: string,
    fallbackId: string,
    kbId: string,
  ): KbFileMeta {
    const doc = JSON.parse(raw);
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
      throw new Error("file.json 必须是对象");
    }
    const r = doc as Record<string, any>;
    const now = new Date().toISOString();
    return {
      id: fallbackId,
      knowledgeBaseId: this.str(r.knowledgeBaseId) ?? kbId,
      fileName: this.str(r.fileName) ?? fallbackId,
      displayName: this.str(r.displayName) ?? this.str(r.fileName) ?? fallbackId,
      fileSize: this.num(r.fileSize, 0),
      fileType: this.str(r.fileType) ?? "",
      fileExtension: this.str(r.fileExtension) ?? "",
      contentHash: this.str(r.contentHash) ?? "",
      filePath: this.str(r.filePath),
      relativePath: this.str(r.relativePath),
      parentFolderId: this.str(r.parentFolderId),
      isDirectory: r.isDirectory === true,
      processingStatus: this.str(r.processingStatus) ?? "pending",
      progressPercentage: this.num(r.progressPercentage, 0),
      currentStep: this.str(r.currentStep),
      errorMessage: this.str(r.errorMessage),
      totalChunks: this.num(r.totalChunks, 0),
      totalTokens: this.num(r.totalTokens, 0),
      uploadedAt: toISO(r.uploadedAt, now)!,
      processedAt: toISO(r.processedAt),
    };
  }

  private str(value: any): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
  }

  private num(value: any, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  }

  private obj(value: any): Record<string, any> | null {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, any>)
      : null;
  }

  // ============ 读取 API（内存索引） ============

  listLoadErrors(): KbLoadError[] {
    return Array.from(this.loadErrors.values());
  }

  getKb(id: string): Record<string, any> | undefined {
    const meta = this.kbIndex.get(id);
    return meta ? toKbRow(meta) : undefined;
  }

  getKbMeta(id: string): KnowledgeBaseMeta | undefined {
    return this.kbIndex.get(id);
  }

  listKbs(): Record<string, any>[] {
    return Array.from(this.kbIndex.values())
      .sort((a, b) =>
        b.createdAt === a.createdAt
          ? a.id.localeCompare(b.id)
          : b.createdAt.localeCompare(a.createdAt),
      )
      .map(toKbRow);
  }

  getFile(id: string): Record<string, any> | undefined {
    const meta = this.fileIndex.get(id);
    return meta ? toFileRow(meta) : undefined;
  }

  getFileMeta(id: string): KbFileMeta | undefined {
    return this.fileIndex.get(id);
  }

  /** 内存过滤查询（返回 raw meta，供上层组合分页） */
  queryFiles(predicate: (m: KbFileMeta) => boolean): KbFileMeta[] {
    const out: KbFileMeta[] = [];
    for (const meta of this.fileIndex.values()) {
      if (predicate(meta)) out.push(meta);
    }
    return out;
  }

  /** 目录内直系子项（替代 findByParentFolderId），按文件名排序 */
  childrenOf(kbId: string, parentFolderId: string | null): Record<string, any>[] {
    return this.fileIndexByKb(kbId)
      .filter((m) => m.parentFolderId === parentFolderId)
      .sort((a, b) => a.fileName.localeCompare(b.fileName))
      .map(toFileRow);
  }

  private fileIndexByKb(kbId: string): KbFileMeta[] {
    return this.queryFiles((m) => m.knowledgeBaseId === kbId);
  }

  // ============ 写入 API ============

  async createKb(data: Record<string, any>): Promise<Record<string, any>> {
    await this.initialize();
    const id = String(data.id);
    const now = new Date().toISOString();
    const meta: KnowledgeBaseMeta = {
      id,
      name: data.name ?? id,
      description: data.description ?? null,
      embeddingModelId: data.embeddingModelId ?? "",
      chunkMaxSize: data.chunkMaxSize ?? 1000,
      chunkOverlapSize: data.chunkOverlapSize ?? 100,
      chunkMinSize: data.chunkMinSize ?? 50,
      isActive: data.isActive !== false,
      isPublic: data.isPublic === true,
      metadataConfig: data.metadataConfig ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await this.withLock(`kb:${id}`, async () => {
      await this.writeKbFile(meta);
      this.kbIndex.set(id, meta);
    });
    return toKbRow(meta);
  }

  async updateKb(
    id: string,
    data: Record<string, any>,
  ): Promise<Record<string, any> | undefined> {
    await this.initialize();
    if (!this.kbIndex.has(id)) return undefined;
    return this.withLock(`kb:${id}`, async () => {
      const merged = { ...this.kbIndex.get(id)! } as any;
      for (const [k, v] of Object.entries(data)) {
        if (v === undefined) continue;
        if (k === "createdAt") merged.createdAt = toISO(v) ?? merged.createdAt;
        else if (k in merged) merged[k] = v;
      }
      merged.updatedAt = new Date().toISOString();
      await this.writeKbFile(merged);
      this.kbIndex.set(id, merged);
      return toKbRow(merged);
    });
  }

  /** 删除 KB 配置（kb.json；整目录由上层清理） */
  async deleteKb(id: string): Promise<boolean> {
    await this.initialize();
    const existed = this.kbIndex.has(id);
    await this.withLock(`kb:${id}`, async () => {
      await fsp
        .unlink(this.getKbConfigPath(id))
        .catch(() => undefined);
      this.kbIndex.delete(id);
    });
    return existed;
  }

  async createFile(data: Record<string, any>): Promise<Record<string, any>> {
    await this.initialize();
    const id = String(data.id);
    const kbId = String(data.knowledgeBaseId);
    const now = new Date().toISOString();
    const meta: KbFileMeta = {
      id,
      knowledgeBaseId: kbId,
      fileName: data.fileName ?? id,
      displayName: data.displayName ?? data.fileName ?? id,
      fileSize: data.fileSize ?? 0,
      fileType: data.fileType ?? "",
      fileExtension: data.fileExtension ?? "",
      contentHash: data.contentHash ?? "",
      filePath: data.filePath ?? null,
      relativePath: data.relativePath ?? null,
      parentFolderId: data.parentFolderId ?? null,
      isDirectory: data.isDirectory === true,
      processingStatus: data.processingStatus ?? "pending",
      progressPercentage: data.progressPercentage ?? 0,
      currentStep: data.currentStep ?? null,
      errorMessage: data.errorMessage ?? null,
      totalChunks: data.totalChunks ?? 0,
      totalTokens: data.totalTokens ?? 0,
      uploadedAt: toISO(data.uploadedAt) ?? now,
      processedAt: toISO(data.processedAt),
    };
    await this.withLock(id, async () => {
      await this.writeItemFile(meta);
      this.fileIndex.set(id, meta);
    });
    return toFileRow(meta);
  }

  async updateFile(
    id: string,
    data: Record<string, any>,
  ): Promise<Record<string, any> | undefined> {
    await this.initialize();
    const current = this.fileIndex.get(id);
    if (!current) return undefined;
    return this.withLock(id, async () => {
      const merged = { ...this.fileIndex.get(id)! } as any;
      for (const [k, v] of Object.entries(data)) {
        if (v === undefined) continue;
        if (k === "uploadedAt" || k === "processedAt") {
          merged[k] = toISO(v);
        } else if (k in merged) {
          merged[k] = v;
        }
      }
      await this.writeItemFile(merged);
      this.fileIndex.set(id, merged);
      return toFileRow(merged);
    });
  }

  /** 删除条目元信息（file.json；分块目录由上层一并删除） */
  async deleteFile(id: string): Promise<boolean> {
    await this.initialize();
    const meta = this.fileIndex.get(id);
    if (!meta) return false;
    await this.withLock(id, async () => {
      await fsp.unlink(this.getItemMetaPath(meta.knowledgeBaseId, id)).catch(
        () => undefined,
      );
      this.fileIndex.delete(id);
    });
    return true;
  }

  /**
   * 前缀级联重写（替代原 `$transaction + $executeRawUnsafe` 的文件夹改名/移动）。
   *
   * 把 `prefix` 开头的 relativePath 重写为 `nextPrefix` + 余量。只改路径、
   * 不动 parentFolderId —— 改名与移动都不改变子项与其父文件夹之间的指向
   * （移动时子项仍挂在被移动的文件夹下，只是整体换了前缀）。
   * 逐文件写、可重入；返回受影响条数。
   */
  async rewriteRelativePathPrefix(
    kbId: string,
    prefix: string,
    nextPrefix: string,
  ): Promise<number> {
    await this.initialize();
    const targets = this.queryFiles(
      (m) =>
        m.knowledgeBaseId === kbId &&
        typeof m.relativePath === "string" &&
        m.relativePath.startsWith(prefix),
    );
    let changed = 0;
    for (const meta of targets) {
      const rest = (meta.relativePath ?? "").substring(prefix.length);
      const patch: Record<string, any> = {
        relativePath: `${nextPrefix}${rest}`,
      };
      await this.updateFile(meta.id, patch);
      changed += 1;
    }
    return changed;
  }

  /** 由外部（迁移导出）直接写入 */
  async writeKbDirect(meta: KnowledgeBaseMeta): Promise<void> {
    await this.withLock(`kb:${meta.id}`, async () => {
      await this.writeKbFile(meta);
      this.kbIndex.set(meta.id, meta);
    });
  }

  async writeFileDirect(meta: KbFileMeta): Promise<void> {
    await this.withLock(meta.id, async () => {
      await this.writeItemFile(meta);
      this.fileIndex.set(meta.id, meta);
    });
  }

  // ============ 内部 ============

  private async writeKbFile(meta: KnowledgeBaseMeta): Promise<void> {
    const dir = this.getKbDir(meta.id);
    await fsp.mkdir(dir, { recursive: true });
    await this.atomicWrite(
      path.join(dir, KB_CONFIG_FILE),
      JSON.stringify(meta, null, 2),
    );
  }

  private async writeItemFile(meta: KbFileMeta): Promise<void> {
    const dir = this.getItemDir(meta.knowledgeBaseId, meta.id);
    await fsp.mkdir(dir, { recursive: true });
    await this.atomicWrite(
      path.join(dir, KB_ITEM_FILE),
      JSON.stringify(meta, null, 2),
    );
  }

  private async withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.writeChains.get(id) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    const tracked = run.then(
      () => undefined,
      () => undefined,
    );
    this.writeChains.set(id, tracked);
    try {
      return await run;
    } finally {
      if (this.writeChains.get(id) === tracked) this.writeChains.delete(id);
    }
  }

  private async atomicWrite(filePath: string, content: string): Promise<void> {
    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await fsp.writeFile(tmpPath, content, "utf8");
    let lastErr: any;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        try {
          await fsp.unlink(filePath);
        } catch {
          /* 目标不存在 */
        }
        await fsp.rename(tmpPath, filePath);
        return;
      } catch (err: any) {
        lastErr = err;
        if (
          err?.code !== "EPERM" &&
          err?.code !== "EBUSY" &&
          err?.code !== "EACCES"
        ) {
          break;
        }
        await new Promise((r) => setTimeout(r, 20 * (attempt + 1)));
      }
    }
    await fsp.unlink(tmpPath).catch(() => undefined);
    throw lastErr;
  }

  private startWatcher(): void {
    if (this.watcher) return;
    try {
      this.watcher = chokidar.watch(this.rootDir, {
        ignoreInitial: true,
        ignorePermissionErrors: true,
        persistent: true,
        depth: 2,
        // 只关心 kb.json / file.json；chunks.jsonl 由写入方管理，监听会造成事件风暴
        ignored: (target: string) => {
          const name = path.basename(target);
          if (name.startsWith(".")) return true;
          if (name === "chunks.jsonl" || name.endsWith(".tmp")) return true;
          return false;
        },
      });
      const reload = () => this.scheduleReload();
      this.watcher.on("add", reload);
      this.watcher.on("change", reload);
      this.watcher.on("unlink", reload);
      this.watcher.on("error", (err) =>
        this.logger.error(`KB watcher error: ${String(err)}`),
      );
    } catch (err) {
      this.logger.warn(`Failed to start KB watcher: ${String(err)}`);
    }
  }

  private scheduleReload(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.loadAll().catch((err) =>
        this.logger.error(`KB reload failed: ${String(err)}`),
      );
    }, 300);
  }

  onModuleDestroy(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    void this.watcher?.close();
  }
}
