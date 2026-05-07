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
      onlyCurrentContent?: boolean;
    },
  ) {
    const {
      withFiles = false,
      withContents = true,
      onlyCurrentContent = false,
    } = options || {};

    return this.prisma.message.findMany({
      where: { sessionId },
      include: {
        ...(withFiles && { files: true }),
        ...(withContents && {
          contents: {
            orderBy: { createdAt: "asc" },
            // Prisma 不支持在 include 中直接过滤关联数据
            // 如果需要 onlyCurrentContent，需要在查询后过滤
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
    },
  ) {
    const {
      withFiles = false,
      withContents = true,
      onlyCurrentContent = false,
    } = options || {};
    const where: any = { sessionId };

    // 获取晚于afterMessageId的消息(不含)
    if (afterMessageId) {
      where.id = { gt: afterMessageId };
    }

    if (beforeMessageId) {
      // 获取截止到beforeMessageId的消息(含)
      where.id = { ...where.id, lte: beforeMessageId } as any;
    }

    const messages = await this.prisma.message.findMany({
      where,
      ...(limit != null && { take: limit }),
      orderBy: { id: "desc" }, // 基于 ID 倒序（CUID 时间有序）
      include: {
        ...(withFiles && { files: true }),
        ...(withContents && {
          contents: {
            orderBy: { createdAt: "asc" },
          },
        }),
      },
    });

    // 如果需要仅当前轮次内容，在应用层过滤（Prisma 不支持 nested filtering）
    if (onlyCurrentContent) {
      return messages.map((message) => {
        if (message.contents && message.currentTurnsId) {
          return {
            ...message,
            contents: message.contents.filter(
              (content) => content.turnsId === message.currentTurnsId,
            ),
          };
        }
        return message;
      });
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
      onlyCurrentContent?: boolean;
    },
  ) {
    const {
      withFiles = false,
      withContents = true,
      onlyCurrentContent = false,
    } = options || {};

    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: {
        ...(withFiles && { files: true }),
        ...(withContents && {
          contents: {
            orderBy: { createdAt: "asc" },
          },
        }),
        session: true,
      },
    });

    // 如果需要仅当前轮次内容，在应用层过滤
    if (
      message &&
      onlyCurrentContent &&
      message.contents &&
      message.currentTurnsId
    ) {
      return {
        ...message,
        contents: message.contents.filter(
          (content) => content.turnsId === message.currentTurnsId,
        ),
      };
    }

    return message;
  }

  /**
   * 根据 ID 获取消息及其当前内容版本（便捷方法）
   * 与 Python 后端 get_message(message_id, only_current_content=True) 一致
   */
  async findByIdWithCurrentContent(messageId: string) {
    return this.findById(messageId, {
      withFiles: false,
      withContents: true,
      onlyCurrentContent: true,
    });
  }

  /**
   * 创建新消息
   */
  async create(data: {
    sessionId: string;
    role: string;
    parentId?: string;
    currentTurnsId?: string; // 添加 currentTurnsId（与 Python 后端一致）
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
