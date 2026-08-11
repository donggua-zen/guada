import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/database/prisma.service";

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

  async create(data: any) {
    return this.prisma.kBChunk.create({
      data,
    });
  }

  /**
   * 批量创建分块记录（单次 INSERT，避免逐条写入的性能开销）
   *
   * @param items 分块数据列表
   * @returns 实际创建的数量
   */
  async createMany(items: any[]): Promise<number> {
    if (!items || items.length === 0) {
      return 0;
    }
    const result = await this.prisma.kBChunk.createMany({
      data: items,
    });
    return result.count;
  }

  async deleteByFileId(fileId: string) {
    const result = await this.prisma.kBChunk.deleteMany({
      where: { fileId },
    });
    return result.count;
  }

  async countByFileId(fileId: string) {
    return this.prisma.kBChunk.count({
      where: { fileId },
    });
  }
}
