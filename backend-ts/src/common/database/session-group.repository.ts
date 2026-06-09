import { Injectable } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

@Injectable()
export class SessionGroupRepository {
  constructor(private prisma: PrismaService) { }

  /**
   * 根据用户ID获取所有分组，按sortOrder升序排列
   */
  async findByUserId(userId: string) {
    return this.prisma.sessionGroup.findMany({
      where: { userId },
      orderBy: { sortOrder: "asc" },
    });
  }

  /**
   * 根据ID获取分组详情
   */
  async findById(id: string) {
    return this.prisma.sessionGroup.findUnique({
      where: { id },
    });
  }

  /**
   * 创建新分组
   */
  async create(data: { name: string; userId: string; sortOrder?: number }) {
    return this.prisma.sessionGroup.create({
      data: {
        name: data.name,
        userId: data.userId,
        sortOrder: data.sortOrder ?? 0,
      },
    });
  }

  /**
   * 更新分组信息
   */
  async update(id: string, data: { name?: string; sortOrder?: number }) {
    return this.prisma.sessionGroup.update({
      where: { id },
      data,
    });
  }

  /**
   * 删除分组
   * 注意：删除分组时，关联的session会自动将groupId设为null（onDelete: SetNull）
   */
  async deleteById(id: string) {
    return this.prisma.sessionGroup.delete({
      where: { id },
    });
  }

  /**
   * 获取用户最大的sortOrder值
   */
  async getMaxSortOrder(userId: string): Promise<number> {
    const result = await this.prisma.sessionGroup.findFirst({
      where: { userId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    return result?.sortOrder ?? 0;
  }

  /**
   * 批量更新分组排序
   */
  async batchUpdateSortOrder(updates: { id: string; sortOrder: number }[]) {
    const transactions = updates.map((item) =>
      this.prisma.sessionGroup.update({
        where: { id: item.id },
        data: { sortOrder: item.sortOrder },
      }),
    );
    return this.prisma.$transaction(transactions);
  }
}
