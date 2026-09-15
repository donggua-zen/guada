/**
 * 重新嵌入知识库分块（不重新解析/OCR）
 *
 * 用途：
 * 1. 迁移时向量缺失（旧向量库没有对应行）→ 补齐
 * 2. 向量库损坏 → 从分块正文重建
 * 3. 换了嵌入模型但想保留分块（注意：换模型应走知识库设置里的"向量模型"，那条路会重新解析）
 *
 * 只读 `chunk.content`（正文正本），重算 `chunk.embedding`，不触碰 raw/ 原件。
 *
 * 用法：
 *   pnpm kb:reembed                    # 全部知识库
 *   pnpm kb:reembed -- --kb <kbId>      # 指定库
 *   pnpm kb:reembed -- --batch 16       # 嵌入批大小（默认沿用 EmbeddingService 的 10）
 */
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { AppModule } from "../app.module";
import { KbDatabaseService } from "../modules/knowledge-base/kb-database.service";
import { KbMetaStore } from "../modules/knowledge-base/kb-meta.store";
import { KBChunkRepository } from "../common/database/kb-chunk.repository";
import { ProviderFileStore } from "../modules/llm-core/provider-file.store";
import { EmbeddingService } from "../modules/knowledge-base/embedding.service";

/** 取出需要重嵌入的分块（按条目分组，保持 chunk_index 顺序） */
interface PendingChunk {
  id: string;
  content: string;
}

async function main(): Promise<void> {
  const logger = new Logger("KbReembed");
  const args = process.argv.slice(2);
  const kbFilter = readArg(args, "--kb");

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn", "log"],
  });

  try {
    const databases = app.get(KbDatabaseService);
    const metaStore = app.get(KbMetaStore);
    const chunkRepo = app.get(KBChunkRepository);
    const providerStore = app.get(ProviderFileStore);
    const embeddingService = app.get(EmbeddingService);

    await databases.ready();
    const kbIds = kbFilter
      ? [kbFilter]
      : (await metaStore.listKbMetas()).map((kb) => kb.id);

    if (kbIds.length === 0) {
      logger.log("没有需要处理的知识库");
      return;
    }

    let totalDone = 0;
    let totalEmbedded = 0;

    for (const kbId of kbIds) {
      const kb = await metaStore.getKbMeta(kbId);
      if (!kb) {
        logger.warn(`跳过不存在的知识库：${kbId}`);
        continue;
      }
      const model = providerStore.findModel(kb.embeddingModelId);
      if (!model) {
        logger.error(
          `跳过 ${kb.name || kbId}：向量模型不存在（${kb.embeddingModelId}）`,
        );
        continue;
      }

      const db = await databases.getDb(kbId);
      const rows = db
        .prepare(
          `SELECT id, item_id, content, embedding FROM chunk ORDER BY item_id, chunk_index`,
        )
        .all() as Array<{
        id: string;
        item_id: string;
        content: string;
        embedding: Buffer | null;
      }>;

      const pending = rows.filter((r) => !r.embedding || r.embedding.length === 0);
      logger.log(
        `${kb.name || kbId}：${rows.length} 条分块，其中 ${pending.length} 条缺向量`,
      );
      if (pending.length === 0) continue;

      // 按条目分组批量嵌入（同一条目的分块一起过，便于将来按条目切换策略）
      const byItem = new Map<string, PendingChunk[]>();
      for (const row of pending) {
        const list = byItem.get(row.item_id) ?? [];
        list.push({ id: row.id, content: row.content });
        byItem.set(row.item_id, list);
      }

      for (const [itemId, chunks] of byItem) {
        const ids = chunks.map((c) => c.id);
        const contents = chunks.map((c) => c.content);
        try {
          const vectors = await embeddingService.getEmbeddings(
            contents,
            model.provider.apiUrl || "",
            model.provider.apiKey || "",
            model.modelName,
          );
          const written = await chunkRepo.updateEmbeddings(kbId, ids, vectors);
          totalEmbedded += written;
          totalDone += 1;
          logger.log(
            `  条目 ${itemId}：补写 ${written}/${ids.length} 条向量`,
          );
        } catch (err: any) {
          logger.error(`  条目 ${itemId} 重嵌入失败：${err?.message || err}`);
        }
      }
    }

    logger.log(
      `完成：处理 ${totalDone} 个条目、补写 ${totalEmbedded} 条向量（未重新解析/OCR）`,
    );
  } finally {
    await app.close();
  }
}

function readArg(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : null;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
