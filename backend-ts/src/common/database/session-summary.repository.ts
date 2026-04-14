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
   * 删除会话的所有摘要记录（通常在删除会话时级联触发，但也可手动调用）
   */
  async deleteBySessionId(sessionId: string) {
    return this.prisma.sessionSummary.deleteMany({
      where: { sessionId },
    });
  }
}
