import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/database/prisma.service";

/**
 * 知识库分块仓储（仅保留未迁移存量的兼容读取）
 *
 * 分块正本已改为 `<KB根>/<kbId>/<fileId>/chunks.jsonl`（KbChunkFileStore）。
 * 主库 `kb_chunk` 表已冻结停写，本类只剩一个用途：当某文件的 JSONL 缺失时
 * 兜底读出老数据（见 kb-chunk-file.store.ts 的 readChunksFromDb）——
 * 尚未跑过 migrate-kb-chunks 的安装仍依赖它，因此不能删。
 */
@Injectable()
export class KBChunkRepository {
  constructor(private prisma: PrismaService) {}

  async findByFileId(fileId: string, skip: number = 0, limit: number = 10) {
    return this.prisma.kBChunk.findMany({
      where: { fileId },
      orderBy: { chunkIndex: "asc" },
      skip,
      take: limit,
    });
  }
}
