import { Injectable } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

@Injectable()
export class ModelRepository {
  constructor(private prisma: PrismaService) {}

  /**
   * 获取 Prisma 客户端实例（用于事务操作）
   */
  getPrismaClient() {
    return this.prisma;
  }

  async getProvidersWithModels(userId: string) {
    return this.prisma.modelProvider.findMany({
      where: { userId },
      include: { models: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async getProviderById(id: string) {
    return this.prisma.modelProvider.findUnique({
      where: { id },
    });
  }

  async createProvider(data: any) {
    return this.prisma.modelProvider.create({ data });
  }

  async updateProvider(id: string, data: any) {
    return this.prisma.modelProvider.update({
      where: { id },
      data,
    });
  }

  async deleteProvider(id: string) {
    // Prisma Schema 中已配置 onDelete: Cascade，会自动删除关联的 Model
    return this.prisma.modelProvider.delete({
      where: { id },
    });
  }

  async createModel(data: any) {
    return this.prisma.model.create({ data });
  }

  async updateModel(id: string, data: any) {
    return this.prisma.model.update({
      where: { id },
      data,
    });
  }

  async deleteModel(id: string) {
    return this.prisma.model.delete({
      where: { id },
    });
  }

  async findById(id: string) {
    return this.prisma.model.findUnique({
      where: { id },
      include: { provider: true },
    });
  }

  /**
   * 批量创建模型（用于事务中）
   */
  async createModelsInTransaction(tx: any, modelsData: any[]) {
    const createdModels = [];
    for (const modelData of modelsData) {
      const model = await tx.model.create({ data: modelData });
      createdModels.push(model);
    }
    return createdModels;
  }
}
