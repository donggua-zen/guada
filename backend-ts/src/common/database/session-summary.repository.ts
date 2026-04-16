import { Injectable } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

@Injectable()
export class SessionSummaryRepository {
  constructor(private prisma: PrismaService) { }

  /**
   * 创建新的会话摘要记录
   */
  async create(data: {
    sessionId: string;
    summaryContent: string;
    lastCompressedMessageId?: string;
  }) {
    return this.prisma.sessionSummary.create({
      data,
    });
  }

  /**
   * 获取会话最新的摘要记录
   */
  async findLatestBySessionId(sessionId: string) {
    return this.prisma.sessionSummary.findFirst({
      where: { sessionId },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * 获取会话的所有摘要记录（按创建时间倒序）
   */
  async findBySessionId(sessionId: string) {
    return this.prisma.sessionSummary.findMany({
      where: { sessionId },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * 根据 ID 获取单个摘要
   */
  async findById(id: string) {
    return this.prisma.sessionSummary.findUnique({
      where: { id },
    });
  }

  /**
   * 更新摘要内容
   */
  async update(id: string, data: { summaryContent?: string; lastCompressedMessageId?: string }) {
    return this.prisma.sessionSummary.update({
      where: { id },
      data,
    });
  }

  /**
   * 删除单个摘要记录
   */
  async delete(id: string) {
    return this.prisma.sessionSummary.delete({
      where: { id },
    });
  }

  /**
   * 删除会话的所有摘要记录（通常在删除会话时级联触发，但也可手动调用）
   */
  async deleteBySessionId(sessionId: string) {
    return this.prisma.sessionSummary.deleteMany({
      where: { sessionId },
    });
  }
}
