import { Injectable } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

@Injectable()
export class SessionRepository {
  constructor(private prisma: PrismaService) { }

  async findById(id: string) {
    return this.prisma.session.findUnique({
      where: { id },
      include: {
        character: true,
        model: {
          include: {
            provider: true, // 包含供应商信息
          },
        },
      },
    });
  }

  async findByUserId(userId: string, skip: number = 0, limit: number = 20) {
    const [items, total] = await Promise.all([
      this.prisma.session.findMany({
        where: { userId },
        orderBy: [{ lastActiveAt: "desc" }],
        skip,
        take: limit,
        include: { character: true },
      }),
      this.prisma.session.count({ where: { userId } }),
    ]);
    return { items, total };
  }

  async create(data: any) {
    data.lastActiveAt = new Date();
    return this.prisma.session.create({
      data,
    });
  }

  async update(id: string, data: any) {
    return this.prisma.session.update({
      where: { id },
      data,
    });
  }

  async deleteById(id: string) {
    return this.prisma.session.delete({
      where: { id },
    });
  }

  async updateLastActiveAt(id: string) {
    return this.prisma.session.update({
      where: { id },
      data: { lastActiveAt: new Date() },
    });
  }
}
