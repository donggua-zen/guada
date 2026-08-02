import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/database/prisma.service";

@Injectable()
export class FileRepository {
  constructor(private prisma: PrismaService) {}

  async create(data: any) {
    return this.prisma.file.create({ data });
  }

  async findById(id: string) {
    return this.prisma.file.findUnique({ where: { id } });
  }

  async findBySessionId(sessionId: string) {
    return this.prisma.file.findMany({
      where: { sessionId },
      orderBy: { createdAt: "desc" },
    });
  }

  async update(id: string, data: any) {
    return this.prisma.file.update({ where: { id }, data });
  }

  async updateMany(ids: string[], data: any) {
    return this.prisma.file.updateMany({ where: { id: { in: ids } }, data });
  }

  /**
   * Clear content (base64) for tool-generated images that have expired.
   * Keeps the File record itself (for metadata/audit) but removes the bulky base64 data.
   */
  async clearExpiredToolImages(cutoff: Date): Promise<number> {
    const result = await this.prisma.file.updateMany({
      where: {
        fileType: "image",
        url: null,
        content: { not: null },
        createdAt: { lt: cutoff },
      },
      data: { content: null },
    });
    return result.count;
  }
}
