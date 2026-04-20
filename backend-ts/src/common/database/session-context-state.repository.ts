import { Injectable } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

@Injectable()
export class SessionContextStateRepository {
  constructor(private prisma: PrismaService) { }

  /**
   * 创建新的会话上下文状态记录
   */
  async create(data: {
    sessionId: string;
    summaryContent?: string | null;
    lastCompressedMessageId?: string;
    cleaningStrategy?: string;
    lastCleanedMessageId?: string;
  }) {
    return this.prisma.sessionContextState.create({
      data,
    });
  }

  /**
   * 获取会话最新的上下文状态记录
   */
  async findLatestBySessionId(sessionId: string) {
    return this.prisma.sessionContextState.findFirst({
      where: { sessionId },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * 获取会话的所有上下文状态记录（按创建时间倒序）
   */
  async findBySessionId(sessionId: string) {
    return this.prisma.sessionContextState.findMany({
      where: { sessionId },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * 根据 ID 获取单个上下文状态
   */
  async findById(id: string) {
    return this.prisma.sessionContextState.findUnique({
      where: { id },
    });
  }

  /**
   * 更新上下文状态内容
   */
  async update(id: string, data: { summaryContent?: string; lastCompressedMessageId?: string; cleaningStrategy?: string; lastCleanedMessageId?: string }) {
    return this.prisma.sessionContextState.update({
      where: { id },
      data,
    });
  }

  /**
   * 删除单个上下文状态记录
   */
  async delete(id: string) {
    return this.prisma.sessionContextState.delete({
      where: { id },
    });
  }

  /**
   * 删除会话的所有上下文状态记录（通常在删除会话时级联触发，但也可手动调用）
   */
  async deleteBySessionId(sessionId: string) {
    return this.prisma.sessionContextState.deleteMany({
      where: { sessionId },
    });
  }
}
