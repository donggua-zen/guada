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
   * 使用基于 ID 的游标分页，确保精准性和高效性。
   *
   * 为避免 SQLite 参数限制（SQLITE_MAX_VARIABLE_NUMBER=999），嵌套关系
   * （contents、files）通过分批查询加载，而非 Prisma 嵌套 include。
   */
  private static readonly BATCH_SIZE = 100;

  async findRecentBySessionId(
    sessionId: string,
    limit?: number,
    beforeMessageId?: string,
    afterMessageId?: string,
    options?: {
      withFiles?: boolean;
      withContents?: boolean;
      onlyCurrentContent?: boolean;
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

    if (afterMessageId) {
      where.id = { gt: afterMessageId };
    }

    if (beforeMessageId) {
      const boundaryOp = includeBoundary ? 'lte' : 'lt';
      where.id = { ...where.id, [boundaryOp]: beforeMessageId } as any;
    }

    const BATCH = MessageRepository.BATCH_SIZE;

    // Phase 1: 分批查 messages（无 include）
    const allMessages: any[] = [];
    let cursor: string | undefined = undefined;
    let remaining = limit;

    while (true) {
      const take = remaining != null ? Math.min(BATCH, remaining) : BATCH;
      const batch = await this.prisma.message.findMany({
        where,
        take,
        ...(cursor && { skip: 1, cursor: { id: cursor } }),
        orderBy: { id: "desc" },
      });
      if (batch.length === 0) break;
      allMessages.push(...batch);
      if (remaining != null) remaining -= batch.length;
      cursor = batch[batch.length - 1].id;
      if (batch.length < take) break;
    }

    if (allMessages.length === 0) return [];

    // Phase 2: onlyCurrentContent 过滤（确定活跃消息集合，后续只查这些消息的 contents）
    let targetMessages = allMessages;
    if (onlyCurrentContent) {
      const activeVersionIds = new Set<string>();
      for (const msg of allMessages) {
        if (msg.role === "user" && msg.currentVersionId) {
          activeVersionIds.add(msg.currentVersionId);
        }
      }
      targetMessages = allMessages.filter(
        (msg) => msg.role === "user" || activeVersionIds.has(msg.id),
      );
    }

    // Phase 3: 分批查 contents（仅活跃消息）
    if (withContents && targetMessages.length > 0) {
      const contentsByMessageId = new Map<string, any[]>();
      for (let i = 0; i < targetMessages.length; i += BATCH) {
        const messageIds = targetMessages
          .slice(i, i + BATCH)
          .map((m) => m.id);
        const contents = await this.prisma.messageContent.findMany({
          where: { messageId: { in: messageIds } },
          orderBy: { createdAt: "asc" },
        });
        for (const c of contents) {
          if (!contentsByMessageId.has(c.messageId)) {
            contentsByMessageId.set(c.messageId, []);
          }
          contentsByMessageId.get(c.messageId)!.push(c);
        }
      }

      // Phase 4: 分批查 files（仅 user 消息的 contents）
      if (withFiles) {
        const userMessageIdSet = new Set(
          targetMessages.filter((m) => m.role === "user").map((m) => m.id),
        );
        const userContentIds: string[] = [];
        for (const [msgId, contents] of contentsByMessageId) {
          if (userMessageIdSet.has(msgId)) {
            for (const c of contents) userContentIds.push(c.id);
          }
        }

        const filesByContentId = new Map<string, any[]>();
        for (let i = 0; i < userContentIds.length; i += BATCH) {
          const batchIds = userContentIds.slice(i, i + BATCH);
          const files = await this.prisma.file.findMany({
            where: { contentId: { in: batchIds } },
            orderBy: { createdAt: "asc" },
          });
          for (const f of files) {
            if (!f.contentId) continue;
            if (!filesByContentId.has(f.contentId)) {
              filesByContentId.set(f.contentId, []);
            }
            filesByContentId.get(f.contentId)!.push(f);
          }
        }

        for (const [, contents] of contentsByMessageId) {
          for (const c of contents) {
            (c as any).files = filesByContentId.get(c.id) || [];
          }
        }
      }

      // 合并 contents 到 messages
      for (const msg of targetMessages) {
        (msg as any).contents = contentsByMessageId.get(msg.id) || [];
      }
    }

    return targetMessages;
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
   * 原子累加 totalDurationMs 并合并结束信息到 metadata（raw SQL，兼容 BetterSqlite3）
   */
  async finalizeMessage(
    messageId: string,
    durationMs: number,
    finishMeta: Record<string, any>,
  ): Promise<void> {
    const existing = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { metadata: true },
    });
    const currentMeta = (existing?.metadata as Record<string, any>) || {};
    const mergedMeta = JSON.stringify({ ...currentMeta, ...finishMeta });
    await this.prisma.$executeRaw`
      UPDATE message
      SET total_duration_ms = COALESCE(total_duration_ms, 0) + ${durationMs},
          meta_data = ${mergedMeta}::TEXT
      WHERE id = ${messageId}
    `;
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
