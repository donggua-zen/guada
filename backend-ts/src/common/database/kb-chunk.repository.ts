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
