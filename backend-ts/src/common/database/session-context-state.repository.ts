import { Injectable } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

export interface PruningMetadata {
  contentId: string;
  messageId?: string;
  originalLength: number;
  prunedLength: number;
  prunedContent?: string;
}

// 压缩统计信息（便于扩展）
export interface CompressionStats {
  beforeTokenCount?: number;      // 压缩前的 Token 数
  afterTokenCount?: number;       // 压缩后的 Token 数
  beforeMessageCount?: number;    // 压缩前的消息数
  afterMessageCount?: number;     // 压缩后的消息数
  // 未来可以添加更多字段，如：
  // compressionDuration?: number; // 压缩耗时（毫秒）
  // strategyDetails?: any;        // 策略详情
}

export interface CompressionState {
  summaryContent?: string | null;
  lastCompactedMessageId?: string | null;
  lastCompactedContentId?: string | null;
  lastPrunedContentId?: string | null;
  pruningMetadata?: Record<string, PruningMetadata> | null;
  cleaningStrategy?: string | null;
  compressionStats?: CompressionStats | null; // 压缩统计信息（JSON格式）
}

@Injectable()
export class SessionContextStateRepository {
  constructor(private prisma: PrismaService) { }

  /**
   * 获取会话的最新压缩状态（返回最新的记录）
   */
  async findBySessionId(sessionId: string): Promise<CompressionState | null> {
    const state = await this.prisma.sessionContextState.findFirst({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
    });
    
    if (!state) return null;
    
    return {
      summaryContent: state.summaryContent,
      lastCompactedMessageId: state.lastCompactedMessageId,
      lastCompactedContentId: state.lastCompactedContentId,
      lastPrunedContentId: state.lastPrunedContentId,
      pruningMetadata: state.pruningMetadata ? (state.pruningMetadata as unknown as Record<string, PruningMetadata>) : null,
      cleaningStrategy: state.cleaningStrategy,
      compressionStats: state.compressionStats ? (state.compressionStats as unknown as CompressionStats) : null,
    };
  }

  /**
   * 获取会话的所有压缩状态历史记录（按时间倒序）
   */
  async findAllBySessionId(sessionId: string): Promise<any[]> {
    return this.prisma.sessionContextState.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * 创建新的压缩状态记录（每次压缩都保存新记录）
   */
  async create(sessionId: string, data: CompressionState): Promise<void> {
    await this.prisma.sessionContextState.create({
      data: {
        sessionId,
        summaryContent: data.summaryContent,
        lastCompactedMessageId: data.lastCompactedMessageId,
        lastCompactedContentId: data.lastCompactedContentId,
        lastPrunedContentId: data.lastPrunedContentId,
        pruningMetadata: data.pruningMetadata as any,
        cleaningStrategy: data.cleaningStrategy,
        compressionStats: data.compressionStats as any, // 保存压缩统计信息
      },
    });
  }

  /**
   * 根据 ID 获取压缩状态记录
   */
  async findById(id: string): Promise<any | null> {
    return this.prisma.sessionContextState.findUnique({
      where: { id },
    });
  }

  /**
   * 更新压缩状态记录
   */
  async update(id: string, data: Partial<CompressionState>): Promise<any> {
    return this.prisma.sessionContextState.update({
      where: { id },
      data: {
        summaryContent: data.summaryContent,
        lastCompactedMessageId: data.lastCompactedMessageId,
        lastCompactedContentId: data.lastCompactedContentId,
        lastPrunedContentId: data.lastPrunedContentId,
        pruningMetadata: data.pruningMetadata as any,
        cleaningStrategy: data.cleaningStrategy,
        compressionStats: data.compressionStats as any, // 保存压缩统计信息
      },
    });
  }

  /**
   * 删除指定的压缩状态记录
   */
  async delete(id: string): Promise<any> {
    return this.prisma.sessionContextState.delete({
      where: { id },
    });
  }

  /**
   * 删除会话的所有压缩状态记录
   */
  async deleteBySessionId(sessionId: string): Promise<void> {
    await this.prisma.sessionContextState.deleteMany({
      where: { sessionId },
    });
  }
}
