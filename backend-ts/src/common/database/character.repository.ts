import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/database/prisma.service";

@Injectable()
export class CharacterRepository {
  constructor(private prisma: PrismaService) { }

  async findById(id: string) {
    return this.prisma.character.findUnique({
      where: { id },
      include: { model: true },
    });
  }

  async findByUserId(userId: string, skip: number = 0, limit: number = 20, groupId?: string) {
    const where: any = { userId };
    if (groupId) {
      where.groupId = groupId;
    }

    const [items, total] = await Promise.all([
      this.prisma.character.findMany({
        where,
        orderBy: { createdAt: "asc" },
        skip,
        take: limit,
        include: { model: true, group: true },
      }),
      this.prisma.character.count({
        where,
      }),
    ]);
    return { items, total };
  }

  async findPublic(skip: number = 0, limit: number = 20) {
    const [items, total] = await Promise.all([
      this.prisma.character.findMany({
        where: { isPublic: true },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: { model: true, user: { select: { nickname: true } } },
      }),
      this.prisma.character.count({
        where: { isPublic: true },
      }),
    ]);
    return { items, total };
  }

  async create(data: any) {
    return this.prisma.character.create({ data });
  }

  async update(id: string, data: any) {
    return this.prisma.character.update({
      where: { id },
      data,
    });
  }

  async delete(id: string) {
    return this.prisma.character.delete({
      where: { id },
    });
  }

  async updateManyByGroupId(groupId: string, newGroupId: string | null) {
    return this.prisma.character.updateMany({
      where: { groupId },
      data: { groupId: newGroupId },
    });
  }
}
