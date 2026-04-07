import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';

@Injectable()
export class KnowledgeBaseRepository {
  constructor(private prisma: PrismaService) {}

  async findById(id: string) {
    return this.prisma.knowledgeBase.findUnique({
      where: { id },
      include: { embeddingModel: true },
    });
  }

  async findByUserId(userId: string, skip: number = 0, limit: number = 20) {
    const [items, total] = await Promise.all([
      this.prisma.knowledgeBase.findMany({
        where: { userId, isActive: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { embeddingModel: true },
      }),
      this.prisma.knowledgeBase.count({
        where: { userId, isActive: true },
      }),
    ]);
    return { items, total };
  }

  async create(data: any) {
    return this.prisma.knowledgeBase.create({
      data,
      include: { embeddingModel: true },
    });
  }

  async update(id: string, data: any) {
    return this.prisma.knowledgeBase.update({
      where: { id },
      data,
      include: { embeddingModel: true },
    });
  }

  async delete(id: string) {
    return this.prisma.knowledgeBase.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async countByUserId(userId: string) {
    return this.prisma.knowledgeBase.count({
      where: { userId, isActive: true },
    });
  }
}
