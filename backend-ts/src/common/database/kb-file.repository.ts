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

  /**
   * 按父文件夹ID查询文件列表(支持懒加载)
   */
  async findByParentFolderId(
    kbId: string,
    parentFolderId: string | null,
    skip: number = 0,
    limit: number = 50,
  ) {
    const [items, total] = await Promise.all([
      this.prisma.kBFile.findMany({
        where: {
          knowledgeBaseId: kbId,
          parentFolderId: parentFolderId,  // null表示根目录
        },
        orderBy: [
          { isDirectory: "desc" },  // 文件夹优先
          { displayName: "asc" },   // 按名称排序
        ],
        skip,
        take: limit,
      }),
      this.prisma.kBFile.count({
        where: {
          knowledgeBaseId: kbId,
          parentFolderId: parentFolderId,
        },
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

  /**
   * 根据路径和父ID查找文件或文件夹
   */
  async findByPathAndParent(
    kbId: string,
    name: string,
    parentFolderId: string | null,
  ) {
    return this.prisma.kBFile.findFirst({
      where: {
        knowledgeBaseId: kbId,
        displayName: name,
        parentFolderId: parentFolderId,
        isDirectory: true,
      },
    });
  }

  /**
   * 查找指定父文件夹下的所有子项
   */
  async findChildren(
    parentFolderId: string,
    skip: number = 0,
    limit: number = 50,
  ) {
    const [items, total] = await Promise.all([
      this.prisma.kBFile.findMany({
        where: { parentFolderId },
        orderBy: [
          { isDirectory: "desc" }, // 文件夹优先
          { displayName: "asc" },
        ],
        skip,
        take: limit,
      }),
      this.prisma.kBFile.count({
        where: { parentFolderId },
      }),
    ]);
    return { items, total };
  }

  /**
   * 获取根级别文件/文件夹(parentFolderId 为 NULL)
   */
  async findRootItems(
    kbId: string,
    skip: number = 0,
    limit: number = 50,
  ) {
    const [items, total] = await Promise.all([
      this.prisma.kBFile.findMany({
        where: {
          knowledgeBaseId: kbId,
          parentFolderId: null,
        },
        orderBy: [
          { isDirectory: "desc" },
          { displayName: "asc" },
        ],
        skip,
        take: limit,
      }),
      this.prisma.kBFile.count({
        where: {
          knowledgeBaseId: kbId,
          parentFolderId: null,
        },
      }),
    ]);
    return { items, total };
  }

  /**
   * 通过相对路径查找文件或文件夹
   * @param kbId 知识库ID
   * @param relativePath 相对路径 (例如: "docs/api")
   * @param isDirectory 是否只查找目录
   */
  async findByRelativePath(
    kbId: string,
    relativePath: string,
    isDirectory: boolean = false,
  ) {
    const where: any = {
      knowledgeBaseId: kbId,
      relativePath: relativePath,
    };
    
    if (isDirectory) {
      where.isDirectory = true;
    }
    
    return this.prisma.kBFile.findFirst({
      where,
    });
  }
}
