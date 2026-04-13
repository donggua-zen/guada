import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/database/prisma.service";

@Injectable()
export class KBFileRepository {
  constructor(private prisma: PrismaService) {}

  async findById(id: string) {
    return this.prisma.kBFile.findUnique({
      where: { id },
    });
  }

  async findByKnowledgeBaseId(
    kbId: string,
    skip: number = 0,
    limit: number = 50,
  ) {
    const [items, total] = await Promise.all([
      this.prisma.kBFile.findMany({
        where: { knowledgeBaseId: kbId },
        orderBy: { uploadedAt: "desc" },
        skip,
        take: limit,
      }),
      this.prisma.kBFile.count({
        where: { knowledgeBaseId: kbId },
      }),
    ]);
    return { items, total };
  }

  async create(data: any) {
    return this.prisma.kBFile.create({
      data,
    });
  }

  async update(id: string, data: any) {
    return this.prisma.kBFile.update({
      where: { id },
      data,
    });
  }

  async updateProcessingStatus(
    id: string,
    status: string,
    progress?: number,
    currentStep?: string,
    errorMessage?: string | null,
    totalChunks?: number,
    totalTokens?: number,
  ) {
    const updateData: any = {
      processingStatus: status,
    };

    if (progress !== undefined) updateData.progressPercentage = progress;
    if (currentStep !== undefined) updateData.currentStep = currentStep;
    if (errorMessage !== undefined) updateData.errorMessage = errorMessage;
    if (totalChunks !== undefined) updateData.totalChunks = totalChunks;
    if (totalTokens !== undefined) updateData.totalTokens = totalTokens;

    if (status === "completed") {
      updateData.processedAt = new Date();
    }

    return this.prisma.kBFile.update({
      where: { id },
      data: updateData,
    });
  }

  async delete(id: string) {
    return this.prisma.kBFile.delete({
      where: { id },
    });
  }

  async findByIds(ids: string[]) {
    return this.prisma.kBFile.findMany({
      where: {
        id: { in: ids },
      },
    });
  }

  async countByKnowledgeBaseId(kbId: string) {
    return this.prisma.kBFile.count({
      where: { knowledgeBaseId: kbId },
    });
  }

  async findByStatus(statuses: string[]) {
    return this.prisma.kBFile.findMany({
      where: {
        processingStatus: { in: statuses },
      },
    });
  }
}
