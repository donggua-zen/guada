import { Injectable, Logger } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { KBChunkRepository } from "../../common/database/kb-chunk.repository";

/**
 * KBChunk JSONL 文件行格式（分段正本，与主库 KBChunk 字段对齐）
 * fileId / knowledgeBaseId 由目录路径（<root>/<kbId>/<fileId>/chunks.jsonl）隐含
 */
export interface KbChunkFileRow {
  id: string; // chunk_{idx}_{fileId}
  vectorId: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  embeddingDimensions: number | null;
  metadata: {
    fileId: string;
    knowledgeBaseId: string;
    fileName: string;
    overlapLength?: number;
    strategy?: string;
  } | null;
  createdAt: string; // ISO 时间串
}

/**
 * 对外视图：与原 KBChunk 仓储返回结构一致，保证 API 形状不变
 */
export interface KbChunkView {
  id: string;
  fileId: string;
  knowledgeBaseId: string;
  content: string;
  chunkIndex: number;
  vectorId: string;
  embeddingDimensions: number | null;
  tokenCount: number;
  metadata: any;
  createdAt: string;
}

/**
 * 知识库分块文件存储（分段正本）
 *
 * 存储布局：<root>/<kbId>/<fileId>/chunks.jsonl，整文件原子写（temp + rename）。
 * 分层：原始文件（uploads）→ chunks.jsonl（分段正本）→ vector_db.sqlite（派生索引，可重建）。
 * 主库 kb_chunk 表停止读写（读取仅在 JSONL 缺失时 fallback 兼容未迁移存量）。
 */
@Injectable()
export class KbChunkFileStore {
  private readonly logger = new Logger(KbChunkFileStore.name);
  private readonly rootDir: string;
  private readonly fallbackWarned = new Set<string>();

  constructor(private chunkRepo: KBChunkRepository) {
    this.rootDir = process.env.KB_DATA_DIR
      ? path.resolve(process.env.KB_DATA_DIR)
      : process.env.USERDATA_DIR
        ? path.join(process.env.USERDATA_DIR, "data", "kb")
        : path.resolve(process.cwd(), "data", "kb");
  }

  getRootDir(): string {
    return this.rootDir;
  }

  private getChunkFilePath(kbId: string, fileId: string): string {
    return path.join(this.rootDir, kbId, fileId, "chunks.jsonl");
  }

  /**
   * 整文件原子写入分块正本（temp + rename，对齐项目原子写惯例）
   */
  async writeChunks(
    kbId: string,
    fileId: string,
    rows: KbChunkFileRow[],
  ): Promise<number> {
    const filePath = this.getChunkFilePath(kbId, fileId);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.tmp`;
    const body = rows.length
      ? rows.map((row) => JSON.stringify(row)).join("\n") + "\n"
      : "";
    await fs.promises.writeFile(tmpPath, body, "utf-8");
    await fs.promises.rename(tmpPath, filePath);
    return rows.length;
  }

  /**
   * 按 skip/limit 分页读取分块（JSONL 按行切片）。
   * JSONL 文件不存在时 fallback 读主库 kb_chunk（兼容未迁移存量）。
   */
  async readChunks(
    kbId: string,
    fileId: string,
    skip: number = 0,
    limit: number = 10,
  ): Promise<KbChunkView[]> {
    const filePath = this.getChunkFilePath(kbId, fileId);
    if (!fs.existsSync(filePath)) {
      return this.readChunksFromDb(kbId, fileId, skip, limit);
    }
    return this.readChunksFromFile(filePath, kbId, fileId, skip, limit);
  }

  private async readChunksFromFile(
    filePath: string,
    kbId: string,
    fileId: string,
    skip: number,
    limit: number,
  ): Promise<KbChunkView[]> {
    const out: KbChunkView[] = [];
    const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    let lineIndex = 0;
    for await (const line of rl) {
      if (!line.trim()) continue;
      if (lineIndex >= skip && out.length < limit) {
        try {
          out.push(this.rowToView(JSON.parse(line), kbId, fileId));
        } catch (error: any) {
          this.logger.warn(
            `解析分块行失败（已跳过）: ${filePath} 第 ${lineIndex + 1} 行: ${error.message}`,
          );
        }
      }
      lineIndex++;
    }
    return out;
  }

  /**
   * 兼容路径：主库 kb_chunk 仍保留存量数据，迁移完成前供旧文件读取
   */
  private async readChunksFromDb(
    kbId: string,
    fileId: string,
    skip: number,
    limit: number,
  ): Promise<KbChunkView[]> {
    if (!this.fallbackWarned.has(fileId)) {
      this.fallbackWarned.add(fileId);
      this.logger.warn(
        `文件 ${fileId} 无分块 JSONL，fallback 读取主库 kb_chunk（建议运行 migrate-kb-chunks.ts 完成迁移）`,
      );
    }
    const chunks = await this.chunkRepo.findByFileId(fileId, skip, limit);
    return chunks.map((chunk) => ({
      id: chunk.id,
      fileId: chunk.fileId,
      knowledgeBaseId: chunk.knowledgeBaseId,
      content: chunk.content,
      chunkIndex: chunk.chunkIndex,
      vectorId: chunk.vectorId ?? `chunk_${chunk.chunkIndex}_${fileId}`,
      embeddingDimensions: chunk.embeddingDimensions,
      tokenCount: chunk.tokenCount,
      metadata: chunk.metadata ?? null,
      createdAt: chunk.createdAt.toISOString(),
    }));
  }

  private rowToView(row: KbChunkFileRow, kbId: string, fileId: string): KbChunkView {
    return {
      id: row.id,
      fileId,
      knowledgeBaseId: kbId,
      content: row.content,
      chunkIndex: row.chunkIndex,
      vectorId: row.vectorId ?? `chunk_${row.chunkIndex}_${fileId}`,
      embeddingDimensions: row.embeddingDimensions ?? null,
      tokenCount: row.tokenCount,
      metadata: row.metadata ?? null,
      createdAt: row.createdAt,
    };
  }

  /**
   * 删除单个文件的分块目录（容错：目录可能不存在）
   */
  async deleteChunks(kbId: string, fileId: string): Promise<void> {
    const dir = path.dirname(this.getChunkFilePath(kbId, fileId));
    try {
      await fs.promises.rm(dir, { recursive: true, force: true });
    } catch (error: any) {
      this.logger.warn(
        `删除分块目录失败: ${dir}: ${error.message}`,
      );
    }
  }

  /**
   * 删除整个知识库的分块目录
   */
  async deleteKbDir(kbId: string): Promise<void> {
    const dir = path.join(this.rootDir, kbId);
    try {
      await fs.promises.rm(dir, { recursive: true, force: true });
    } catch (error: any) {
      this.logger.warn(`删除知识库分块目录失败: ${dir}: ${error.message}`);
    }
  }

  /**
   * 列出本地已落盘的知识库 ID（孤儿目录清理用）
   */
  async listKbIds(): Promise<string[]> {
    try {
      const entries = await fs.promises.readdir(this.rootDir, {
        withFileTypes: true,
      });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }
  }

  /**
   * 列出某知识库下本地已落盘的文件 ID（孤儿目录清理用）
   */
  async listFileIds(kbId: string): Promise<string[]> {
    try {
      const entries = await fs.promises.readdir(path.join(this.rootDir, kbId), {
        withFileTypes: true,
      });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }
  }
}
