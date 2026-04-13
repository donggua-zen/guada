import { Injectable } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

@Injectable()
export class MessageContentRepository {
  constructor(private prisma: PrismaService) {}

  /**
   * 获取 Prisma 客户端实例（用于事务操作）
   */
  getPrismaClient() {
    return this.prisma;
  }

  /**
   * 根据 ID 获取消息内容
   */
  async findById(contentId: string) {
    return this.prisma.messageContent.findUnique({
      where: { id: contentId },
    });
  }

  /**
   * 根据消息 ID 获取所有内容版本
   */
  async findByMessageId(messageId: string) {
    return this.prisma.messageContent.findMany({
      where: { messageId },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * 创建新的消息内容版本
   */
  async create(data: {
    messageId: string;
    turnsId: string; // 添加 turnsId（与 Python 后端一致）
    role?: string; // 添加 role（与 Python 后端一致）
    content: string;
    reasoningContent?: string;
    metaData?: Record<string, any>;
    additionalKwargs?: Record<string, any>;
  }) {
    return this.prisma.messageContent.create({
      data,
    });
  }

  /**
   * 更新消息内容
   */
  async update(contentId: string, data: any) {
    return this.prisma.messageContent.update({
      where: { id: contentId },
      data,
    });
  }

  /**
   * 删除消息内容
   */
  async delete(contentId: string) {
    return this.prisma.messageContent.delete({
      where: { id: contentId },
    });
  }

  /**
   * 根据消息 ID 删除所有内容版本
   */
  async deleteByMessageId(messageId: string) {
    return this.prisma.messageContent.deleteMany({
      where: { messageId },
    });
  }
}
