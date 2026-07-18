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
        children: {
          orderBy: { createdAt: "asc" },
        },
      },
    });
  }

  /**
   * 获取用户会话列表，支持按分组筛选
   * 默认排除已归档会话
   * @param groupId undefined-全部, null-未分组, string-指定分组
   * @param includeArchived 是否包含已归档会话，默认 false
   * @param keyword 关键词搜索（标题模糊匹配）
   */
  async findByUserId(
    userId: string,
    skip: number = 0,
    limit: number = 20,
    groupId?: string | null,
    keyword?: string,
    includeArchived: boolean = false,
  ) {
    const where: any = {
      userId,
      sessionType: 'web',
    };

    // 默认排除已归档会话
    if (!includeArchived) {
      where.archived = false;
    }

    // 分组筛选：null表示未分组，undefined表示全部
    if (groupId === null) {
      where.groupId = null;
    } else if (groupId !== undefined) {
      where.groupId = groupId;
    }

    // 关键词搜索：按标题模糊匹配（SQLite 天然不区分大小写）
    if (keyword) {
      where.title = { contains: keyword };
    }

    const [items, total] = await Promise.all([
      this.prisma.session.findMany({
        where,
        orderBy: [{ lastActiveAt: "desc" }],
        skip,
        take: limit,
        include: { character: true },
      }),
      this.prisma.session.count({ where }),
    ]);
    return { items, total };
  }

  /**
   * 获取用户已归档的会话列表
   */
  async findArchivedByUserId(
    userId: string,
    skip: number = 0,
    limit: number = 50,
  ) {
    const where: any = {
      userId,
      sessionType: 'web',
      archived: true,
    };

    const [items, total] = await Promise.all([
      this.prisma.session.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }],
        skip,
        take: limit,
        include: { character: true },
      }),
      this.prisma.session.count({ where }),
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
   * 查找指定父会话下的所有子会话
   */
  async findByParentId(parentSessionId: string) {
    return this.prisma.session.findMany({
      where: { parentId: parentSessionId },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * 统计指定父会话下的子会话数量
   */
  async countByParentId(parentSessionId: string) {
    return this.prisma.session.count({
      where: { parentId: parentSessionId },
    });
  }

  /**
   * 级联删除指定父会话下的所有子会话
   */
  async deleteByParentId(parentSessionId: string) {
    return this.prisma.session.deleteMany({
      where: { parentId: parentSessionId },
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
