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
        where: {
          userId,
          sessionType: { not: 'bot' }
        },
        orderBy: [{ lastActiveAt: "desc" }],
        skip,
        take: limit,
        include: { character: true },
      }),
      this.prisma.session.count({
        where: {
          userId,
          sessionType: { not: 'bot' }
        }
      }),
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

  /**
   * 查询 Bot 专属会话列表（sessionType='bot'）
   */
  async findBotSessions(userId: string, skip: number = 0, limit: number = 20) {
    const [items, total] = await Promise.all([
      this.prisma.session.findMany({
        where: {
          userId,
          sessionType: 'bot'
        },
        orderBy: [{ lastActiveAt: "desc" }],
        skip,
        take: limit,
        include: {
          character: true,
          model: {
            include: {
              provider: true,
            },
          },
        },
      }),
      this.prisma.session.count({
        where: {
          userId,
          sessionType: 'bot'
        }
      }),
    ]);
    return { items, total };
  }

  /**
   * 根据 botId 和 externalId 查找 Bot 会话
   * 
   * 注意：Bot 会话的 characterId 和 modelId 都为 null，这两个字段由调用方动态挂载
   */
  async findByBotAndExternalId(
    botId: string,
    externalId: string,
  ) {
    return this.prisma.session.findFirst({
      where: {
        botId,
        externalId,
        sessionType: 'bot',
      },
      include: {
        // 不 include character 和 model，因为都为 null，由调用方动态挂载
      },
    });
  }
}
