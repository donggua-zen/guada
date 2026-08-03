import { Injectable } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

@Injectable()
export class MessageRepository {
  constructor(private prisma: PrismaService) { }

  /**
   * 获取会话的消息列表（按创建时间排序）
   */
  async findBySessionId(
    sessionId: string,
    options?: {
      withFiles?: boolean;
      withContents?: boolean;
    },
  ) {
    const {
      withFiles = false,
      withContents = true,
    } = options || {};

    return this.prisma.message.findMany({
      where: { sessionId },
      include: {
        ...(withContents && {
          contents: {
            orderBy: { createdAt: "asc" },
            ...(withFiles && { include: { files: { orderBy: { createdAt: "asc" } } } }),
          },
        }),
      },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * 获取会话最近的消息（用于记忆管理）
   * 使用基于 ID 的游标分页，确保精准性和高效性
   */
  async findRecentBySessionId(
    sessionId: string,
    limit?: number,
    beforeMessageId?: string,
    afterMessageId?: string,
    options?: {
      withFiles?: boolean;
      withContents?: boolean;
      onlyCurrentContent?: boolean;
      // 是否包含边界消息（beforeMessageId 那条），默认包含以兼容旧逻辑
      includeBoundary?: boolean;
    },
  ) {
    const {
      withFiles = false,
      withContents = true,
      onlyCurrentContent = false,
      includeBoundary = true,
    } = options || {};
    const where: any = { sessionId };

    // 获取晚于afterMessageId的消息(不含)
    if (afterMessageId) {
      where.id = { gt: afterMessageId };
    }

    if (beforeMessageId) {
      // 获取早于 beforeMessageId 的消息，默认包含边界以兼容旧逻辑
      const boundaryOp = includeBoundary ? 'lte' : 'lt';
      where.id = { ...where.id, [boundaryOp]: beforeMessageId } as any;
    }

    const messages = await this.prisma.message.findMany({
      where,
      ...(limit != null && { take: limit }),
      orderBy: { id: "desc" }, // 基于 ID 倒序（CUID 时间有序）
      include: {
        ...(withContents && {
          contents: {
            orderBy: { createdAt: "asc" },
            ...(withFiles && { include: { files: { orderBy: { createdAt: "asc" } } } }),
          },
        }),
      },
    });

    // 新模型：仅保留活跃版本的 assistant 消息
    if (onlyCurrentContent) {
      // 收集所有用户消息的 currentVersionId
      const activeVersionIds = new Set<string>();
      for (const msg of messages) {
        if (msg.role === "user" && msg.currentVersionId) {
          activeVersionIds.add(msg.currentVersionId);
        }
      }
      // 过滤：只保留用户消息和活跃版本的 assistant 消息
      return messages.filter(
        (msg) => msg.role === "user" || activeVersionIds.has(msg.id),
      );
    }

    return messages;
  }

  /**
   * 根据 ID 获取消息详情
   */
  async findById(
    messageId: string,
    options?: {
      withFiles?: boolean;
      withContents?: boolean;
    },
  ) {
    const {
      withFiles = false,
      withContents = true,
    } = options || {};

    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: {
        ...(withContents && {
          contents: {
            orderBy: { createdAt: "asc" },
            ...(withFiles && { include: { files: { orderBy: { createdAt: "asc" } } } }),
          },
        }),
        session: true,
      },
    });

    return message;
  }

  /**
   * 创建新消息
   */
  async create(data: {
    id?: string;
    sessionId: string;
    role: string;
    parentId?: string;
    currentTurnsId?: string;
    metadata?: Record<string, any>;
  }) {
    return this.prisma.message.create({
      data,
    });
  }

  /**
   * 更新消息
   */
  async update(messageId: string, data: any) {
    return this.prisma.message.update({
      where: { id: messageId },
      data,
    });
  }

  /**
   * 删除消息
   */
  async delete(messageId: string) {
    return this.prisma.message.delete({
      where: { id: messageId },
    });
  }

  /**
   * 根据父消息 ID 删除所有子消息（用于再生模式）
   */
  async deleteByParentId(parentId: string) {
    return this.prisma.message.deleteMany({
      where: { parentId },
    });
  }

  /**
   * 删除会话的所有消息
   */
  async deleteBySessionId(sessionId: string) {
    return this.prisma.message.deleteMany({
      where: { sessionId },
    });
  }

  /**
   * 批量导入消息
   */
  async importMessages(messages: any[]) {
    return this.prisma.message.createMany({
      data: messages,
    });
  }
}
