/**
 * 数据迁移脚本：主库 kb_chunk → 本地 JSONL 分块正本（data/kb/<kbId>/<fileId>/chunks.jsonl）
 *
 * 用途：把存量分块数据从主库导出为 JSONL 正本，使分段内容脱离主库。
 * 注意：只读 DB、只写 JSONL，**不删除原数据库数据**（可回滚/重新迁移）。
 *
 * 用法：
 *   npx ts-node src/scripts/migrate-kb-chunks.ts                  # 迁移全部
 *   npx ts-node src/scripts/migrate-kb-chunks.ts --kb=<kbId>      # 只迁移指定知识库
 *   npx ts-node src/scripts/migrate-kb-chunks.ts --force          # 目标 JSONL 已存在时覆盖重写
 *
 * 幂等性：目标 chunks.jsonl 已存在的文件默认跳过；--force 时覆盖重写。
 */

// 在 Electron 生产环境中确保加载正确的原生模块
if (process.env.NODE_MODULES_PATH) {
  const Module = require("module");
  Module.globalPaths.unshift(process.env.NODE_MODULES_PATH);
}

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import type { KbChunkFileRow } from "../modules/knowledge-base/kb-chunk-file.store";

const databaseUrl = process.env.DATABASE_URL || "file:./data/ai_chat.db";
const adapter = new PrismaBetterSqlite3({ url: databaseUrl });
const prisma = new PrismaClient({ adapter });

function resolveKbRootDir(): string {
  if (process.env.KB_DATA_DIR) return path.resolve(process.env.KB_DATA_DIR);
  if (process.env.USERDATA_DIR)
    return path.join(process.env.USERDATA_DIR, "data", "kb");
  return path.resolve(process.cwd(), "data", "kb");
}

function parseArgs(): { kb?: string; force: boolean } {
  const args = process.argv.slice(2);
  const kbArg = args.find((a) => a.startsWith("--kb="));
  return {
    kb: kbArg ? kbArg.split("=")[1] : undefined,
    force: args.includes("--force"),
  };
}

interface KbChunkDbRow {
  id: string;
  fileId: string;
  knowledgeBaseId: string;
  content: string;
  chunkIndex: number;
  vectorId: string | null;
  embeddingDimensions: number | null;
  tokenCount: number | null;
  metadata: any;
  createdAt: Date;
}

function toFileRow(chunk: KbChunkDbRow, fileName: string | null): KbChunkFileRow {
  const meta = (chunk.metadata && typeof chunk.metadata === "object")
    ? chunk.metadata
    : {};
  return {
    id: chunk.id,
    vectorId: chunk.vectorId ?? `chunk_${chunk.chunkIndex}_${chunk.fileId}`,
    chunkIndex: chunk.chunkIndex,
    content: chunk.content,
    tokenCount: chunk.tokenCount ?? 0,
    embeddingDimensions: chunk.embeddingDimensions,
    metadata: {
      fileId: chunk.fileId,
      knowledgeBaseId: chunk.knowledgeBaseId,
      fileName: meta.fileName ?? fileName ?? "",
      overlapLength: meta.overlapLength,
      strategy: meta.strategy,
    },
    createdAt: chunk.createdAt.toISOString(),
  };
}

async function migrateFile(
  kbId: string,
  fileId: string,
  fileName: string | null,
  force: boolean,
): Promise<{ result: "migrated" | "skipped" | "empty"; count: number }> {
  const chunks = (await prisma.kBChunk.findMany({
    where: { fileId },
    orderBy: { chunkIndex: "asc" },
  })) as KbChunkDbRow[];

  if (chunks.length === 0) return { result: "empty", count: 0 };

  const dir = path.join(resolveKbRootDir(), kbId, fileId);
  const filePath = path.join(dir, "chunks.jsonl");

  if (fs.existsSync(filePath) && !force) return { result: "skipped", count: 0 };

  await fs.promises.mkdir(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  const body =
    chunks.map((c) => JSON.stringify(toFileRow(c, fileName))).join("\n") + "\n";
  await fs.promises.writeFile(tmpPath, body, "utf-8");
  await fs.promises.rename(tmpPath, filePath);
  return { result: "migrated", count: chunks.length };
}

async function main() {
  const { kb: kbFilter, force } = parseArgs();
  console.log(`主库：${databaseUrl}`);
  console.log(`分块正本根目录：${resolveKbRootDir()}`);

  const kbWhere = kbFilter ? { id: kbFilter } : {};
  const knowledgeBases = await prisma.knowledgeBase.findMany({
    where: kbWhere,
    select: { id: true, name: true },
  });

  if (knowledgeBases.length === 0) {
    console.log("没有可迁移的知识库");
    return;
  }
  console.log(`共 ${knowledgeBases.length} 个知识库待处理\n`);

  let totalMigrated = 0;
  let totalSkipped = 0;
  let totalEmpty = 0;
  let totalChunks = 0;

  for (const kb of knowledgeBases) {
    const files = await prisma.kBFile.findMany({
      where: { knowledgeBaseId: kb.id, isDirectory: false },
      select: { id: true, displayName: true },
    });

    let kbMigrated = 0;
    let kbSkipped = 0;
    let kbChunks = 0;

    for (const file of files) {
      const { result, count } = await migrateFile(
        kb.id,
        file.id,
        file.displayName,
        force,
      );
      if (result === "migrated") {
        kbChunks += count;
        kbMigrated++;
      } else if (result === "skipped") {
        kbSkipped++;
      }
    }

    console.log(
      `知识库 ${kb.name} (${kb.id})：迁移 ${kbMigrated} 个文件 / ${kbChunks} 个分块，跳过（已存在）${kbSkipped} 个`,
    );
    totalMigrated += kbMigrated;
    totalSkipped += kbSkipped;
    totalChunks += kbChunks;
  }

  console.log(`\n迁移完成：${totalMigrated} 个文件 / ${totalChunks} 个分块写入 JSONL，${totalSkipped} 个已存在跳过`);
  console.log("主库 kb_chunk 数据未删除（可回滚/重新迁移，--force 覆盖重写）");
}

main()
  .catch((error) => {
    console.error("迁移失败：", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
