import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { MessageRepository } from "../../common/database/message.repository";
import { MessageContentRepository } from "../../common/database/message-content.repository";
import { SessionRepository } from "../../common/database/session.repository";
import { KnowledgeBaseRepository } from "../../common/database/knowledge-base.repository";
import { createPaginatedResponse } from "../../common/types/pagination";
import { randomUUID } from "crypto";
import { FileRepository } from "../../common/database/file.repository";
import { UrlService } from "../../common/services/url.service";
import { FileService } from "../files/file.service";

@Injectable()
export class MessageService {
  private readonly logger = new Logger(MessageService.name);

  constructor(
    private messageRepo: MessageRepository,
    private contentRepo: MessageContentRepository,
    private sessionRepo: SessionRepository,
    private kbRepo: KnowledgeBaseRepository,
    private fileRepo: FileRepository,
    private urlService: UrlService,
    private fileService: FileService,
  ) { }

  private async assertSessionOwner(sessionId: string, userId: string) {
    const session = await this.sessionRepo.findById(sessionId);
    if (!session || session.userId !== userId) {
      throw new HttpException("Session not found", HttpStatus.NOT_FOUND);
    }
    return session;
  }

  private assertMessageOwner(message: any, userId: string) {
    if (!message || message.session?.userId !== userId) {
      throw new HttpException("Message not found", HttpStatus.NOT_FOUND);
    }
  }

  private async assertFilesBelongToSession(
    fileIds: string[],
    sessionId: string,
    userId: string,
  ) {
    const ids = [...new Set(fileIds.filter(Boolean))];
    if (ids.length === 0) return;

    const files = await this.contentRepo.getPrismaClient().file.findMany({
      where: { id: { in: ids } },
      select: { id: true, sessionId: true, uploadUserId: true },
    });

    const allowed = files.filter(
      (file) =>
        file.sessionId === sessionId &&
        (!file.uploadUserId || file.uploadUserId === userId),
    );
    if (allowed.length !== ids.length) {
      throw new HttpException("File not found", HttpStatus.NOT_FOUND);
    }
  }

  /**
   * 获取会话的消息列表
   *
   * 注意：为了优化传输性能，返回的消息内容中会清空工具调用的详细参数和结果。
   * 如需查看完整内容，请使用 getMessageContentToolDetails 接口。
   *
   * 支持分页加载：
   * - limit: 限制返回消息数量（用于首次加载最近 N 条）
   * - beforeMessageId: 加载此 ID 之前（更早）的消息
   * - afterMessageId: 加载此 ID 之后（更新）的消息
   */
  async getMessages(
    sessionId: string,
    userId: string,
    options?: {
      limit?: number;
      beforeMessageId?: string;
      afterMessageId?: string;
    },
  ) {
    await this.assertSessionOwner(sessionId, userId);

    let messages: any[];

    // 如果有分页参数，使用 findRecentBySessionId（基于 ID 的游标分页）
    if (options?.limit || options?.beforeMessageId || options?.afterMessageId) {
      messages = await this.messageRepo.findRecentBySessionId(
        sessionId,
        options.limit,
        options.beforeMessageId,
        options.afterMessageId,
        {
          withContents: true,
          withFiles: true,
          // 加载更多历史消息时不包含边界，避免重复
          includeBoundary: !options.beforeMessageId,
        },
      );
      // findRecentBySessionId 按 ID 倒序返回（新->旧），需要反转回正序（旧->新）
      messages = messages.reverse();
    } else {
      // 无分页参数时保持原有行为，返回全部消息
      messages = await this.messageRepo.findBySessionId(sessionId, {
        withContents: true,
        withFiles: true,
      });
    }

    // 格式化返回数据
    const formattedMessages = messages.map((msg) => {
      // 转换文件 URL 为绝对路径
      const filesWithAbsoluteUrls = msg.files?.map((file) => ({
        ...file,
        url: this.urlService.toResourceAbsoluteUrl(file.url || ""),
        previewUrl: this.urlService.toResourceAbsoluteUrl(file.previewUrl || ""),
      })) || [];

      return {
        ...msg,
        files: filesWithAbsoluteUrls,
        contents: msg.contents
          .filter((content) => content.role !== "tool")
          .map((content) => this.stripToolCallDetails(content)),
      };
    });

    // 返回统一的分页格式
    return createPaginatedResponse(formattedMessages, formattedMessages.length);
  }

  /**
   * 剥离工具调用的详细参数和结果，减少传输数据量
   *
   * 保留展示所需的 metadata.displayMessage 等信息，仅清空大体积数据。
   *
   * 处理逻辑：
   * - assistant 消息：清空 metadata.toolCalls 中的 arguments
   * - tool 消息：清空 content（工具执行结果），保留 metadata.toolCallId 用于关联
   */
  private stripToolCallDetails(content: any): any {
    const result = { ...content };

    // 处理 assistant 消息的 toolCalls
    if (content.metadata) {
      const metadata = { ...content.metadata };

      // 清空 toolCalls 中的 arguments（保留展示信息如 displayMessage）
      if (metadata.toolCalls && Array.isArray(metadata.toolCalls)) {
        metadata.toolCalls = metadata.toolCalls.map((tc: any) => ({
          ...tc,
          arguments: undefined,
          args: undefined,
        }));
      }

      // 清空 toolCallsResponse 中的 content（如果后端已聚合）
      if (
        metadata.toolCallsResponse &&
        Array.isArray(metadata.toolCallsResponse)
      ) {
        metadata.toolCallsResponse = metadata.toolCallsResponse.map(
          (tr: any) => {
            if (tr && typeof tr === "object") {
              return { ...tr, content: undefined };
            }
            return tr;
          }
        );
      }

      result.metadata = metadata;
    }

    // 处理 tool 角色的消息内容（工具执行结果）
    if (content.role === "tool" && content.content) {
      result.content = "";
    }

    return result;
  }

  /**
   * 获取消息内容的工具调用详情（完整参数和结果）
   *
   * 用于懒加载：前端列表仅展示摘要，点击弹窗时通过此接口获取完整数据。
   *
   * 返回数据包括：
   * - toolCalls: assistant 消息中的工具调用参数
   * - toolCallsResponse: 聚合后的工具响应结果（从关联的 tool 角色消息中提取）
   */
  async getMessageContentToolDetails(
    contentId: string,
    userId: string,
  ): Promise<{ toolCalls: any[]; toolCallsResponse: any[] } | null> {
    const content = await this.contentRepo.findById(contentId);
    if (!content) {
      throw new HttpException(
        "Content version not found",
        HttpStatus.NOT_FOUND,
      );
    }

    // 验证消息所有权
    const message = await this.messageRepo.findById(content.messageId);
    this.assertMessageOwner(message, userId);

    const metadata = (content.metadata || {}) as Record<string, any>;
    const toolCalls = metadata.toolCalls || [];

    // 从同消息下的 tool 角色内容中提取响应结果
    const allContents = await this.contentRepo.findByMessageId(
      content.messageId,
    );
    const toolResponseMap = new Map<string, any>();
    for (const tc of allContents) {
      const tcMetadata = tc.metadata as Record<string, any>;
      if (tc.role === "tool" && tcMetadata?.toolCallId) {
        toolResponseMap.set(tcMetadata.toolCallId, {
          content: tc.content,
          ...tcMetadata,
        });
      }
    }

    // 按 toolCalls 顺序聚合同步的响应
    const toolCallsResponse = toolCalls.map((tc: any) => {
      const toolCallId = tc.id;
      if (toolCallId && toolResponseMap.has(toolCallId)) {
        return toolResponseMap.get(toolCallId);
      }
      return null;
    });

    return {
      toolCalls,
      toolCallsResponse,
    };
  }

  /**
   * 添加新消息（支持多版本）
   * 使用事务确保所有数据库操作的原子性
   */
  async addMessage(
    sessionId: string,
    role: string,
    content: string,
    files: any[] = [],
    replaceMessageId: string | undefined,
    knowledgeBaseIds: string[] | undefined,
    userId: string,
    source?: Record<string, any>,
  ) {
    if (!userId) {
      throw new HttpException("Unauthorized", HttpStatus.UNAUTHORIZED);
    }
    await this.assertSessionOwner(sessionId, userId);
    await this.assertFilesBelongToSession(files, sessionId, userId);

    let messageId: string;
    let turnsId: string;

    // 如果是替换模式：完全删除旧消息，然后创建新消息（与 Python 后端保持一致）
    if (replaceMessageId) {
      const existingMessage = await this.messageRepo.findById(replaceMessageId);
      if (!existingMessage) {
        throw new HttpException("Message not found", HttpStatus.NOT_FOUND);
      }

      // 检查权限：确保消息属于该会话
      if (existingMessage.sessionId !== sessionId) {
        throw new HttpException(
          "Message does not belong to this session",
          HttpStatus.FORBIDDEN,
        );
      }

      // 生成新的轮次 ID
      turnsId = randomUUID();

      // 使用事务确保删除和创建的原子性
      try {
        const prisma = this.contentRepo.getPrismaClient();
        await prisma.$transaction(async (tx) => {
          // 1. 解绑旧消息关联的文件（将 messageId 设置为 null）
          await tx.file.updateMany({
            where: { messageId: replaceMessageId },
            data: { messageId: null },
          });

          // 2. 删除旧消息的所有内容版本

          await tx.message.deleteMany({
            where: { parentId: replaceMessageId },
          });

          await tx.messageContent.deleteMany({
            where: { messageId: replaceMessageId },
          });

          // 3. 删除旧消息本身
          await tx.message.delete({
            where: { id: replaceMessageId },
          });

          // 4. 创建全新的消息（而不是创建新版本）
          const newMessage = await tx.message.create({
            data: {
              sessionId,
              role,
              parentId: existingMessage.parentId, // 继承原消息的 parent_id
              currentTurnsId: turnsId, // 设置当前轮次 ID
              metadata: source || undefined,
            } as any,
          });

          messageId = newMessage.id;
        });

        // 5. 事务成功后，在后台异步清理所有 messageId 为 NULL 的孤儿文件
        // 这些文件包括：本次编辑解绑但未重新关联的文件 + 历史遗留的孤儿文件
        // 使用 setImmediate 延迟执行，避免阻塞当前请求响应，同时给数据库一些时间释放锁
        setImmediate(() => {
          this.logger.debug('开始后台清理孤儿文件...');
          this.fileService.cleanupOrphanFiles().catch(error => {
            this.logger.error(`清理孤儿文件失败: ${error.message}`, error.stack);
          });
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        this.logger.error(
          `Transaction failed when replacing message: ${errorMessage}`,
        );
        throw new HttpException(
          "Failed to replace message",
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    } else {
      // 创建新消息
      turnsId = randomUUID(); // 生成轮次 ID
      const message = await this.messageRepo.create({
        sessionId,
        role,
        parentId: undefined,
        currentTurnsId: turnsId, // 设置当前轮次 ID
        metadata: source || undefined,
      });
      messageId = message.id;
    }

    // 处理知识库引用逻辑
    let metadata: any = null;
    if (knowledgeBaseIds && knowledgeBaseIds.length > 0) {
      // 使用批量查询提升效率（替代多次单独查询）
      const kbs = await this.kbRepo.findByIds(knowledgeBaseIds);
      const kbMetadata = kbs.map((kb) => ({
        id: kb.id,
        name: kb.name,
        description: kb.description,
      }));
      metadata = { referencedKbs: kbMetadata };
    }

    // 使用事务确保消息内容和文件更新的原子性
    try {
      const prisma = this.contentRepo.getPrismaClient();
      await prisma.$transaction(async (tx) => {
        // 1. 创建消息内容
        await tx.messageContent.create({
          data: {
            messageId,
            turnsId, // 使用相同的 turnsId
            role, // 添加 role
            content,
            metadata, // 存储知识库引用信息
          },
        });

        // 2. 更新文件关联（如果有文件）
        if (files && files.length > 0) {
          await tx.file.updateMany({
            where: { id: { in: files } },
            data: { messageId },
          });
        }
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(
        `Transaction failed when creating message content: ${errorMessage}`,
      );
      // 如果事务失败，需要清理已创建的消息记录
      try {
        await this.messageRepo.delete(messageId);
      } catch (cleanupError) {
        const cleanupErrorMessage =
          cleanupError instanceof Error
            ? cleanupError.message
            : "Unknown error";
        this.logger.error(
          `Failed to cleanup message after transaction failure: ${cleanupErrorMessage}`,
        );
      }
      throw new HttpException(
        "Failed to create message content",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // 获取完整的消息对象（包含文件信息）
    const completeMessage = await this.messageRepo.findById(messageId, {
      withFiles: true,
      withContents: true,
    });

    if (completeMessage) {
      // 转换文件 URL 为绝对路径
      if (completeMessage.files && completeMessage.files.length > 0) {
        completeMessage.files = completeMessage.files.map((file) => ({
          ...file,
          url: this.urlService.toResourceAbsoluteUrl(file.url || ""),
          previewUrl: this.urlService.toResourceAbsoluteUrl(file.previewUrl || ""),
        }));
      }

      // // 格式化内容字段
      // completeMessage.contents.forEach((content) => {
      //   content.metadata = content.metadata || null;
      //   content.additionalKwargs = content.additionalKwargs || null;
      // });
    }

    return completeMessage;
  }

  /**
   * 更新消息（与 Python 后端保持一致）
   *
   * 支持更新两类字段：
   * 1. Message 表字段：role, currentTurnsId
   * 2. MessageContent 表字段：content, reasoningContent, metadata, additionalKwargs
   *
   * @param messageId 消息 ID
   * @param data 包含要更新的字段的对象
   * @returns 更新后的消息对象
   */
  async updateMessage(messageId: string, data: any, userId: string) {
    // 获取消息及其当前内容版本（与 Python 后端一致）
    const message =
      await this.messageRepo.findByIdWithCurrentContent(messageId);
    this.assertMessageOwner(message, userId);

    // 分离消息字段和内容字段（与 Python 后端逻辑一致）
    const messageFields: any = {};
    const contentFields: any = {};

    // 定义 Message 表的字段
    const messageTableFields = ["role", "currentTurnsId"];

    // 定义 MessageContent 表的字段
    const contentTableFields = [
      "content",
      "reasoningContent",
      "metadata",
      "additionalKwargs",
    ];

    for (const [key, value] of Object.entries(data)) {
      if (messageTableFields.includes(key)) {
        // Message 表字段
        messageFields[key] = value;
      } else if (contentTableFields.includes(key)) {
        // MessageContent 表字段
        contentFields[key] = value;
      } else {
        this.logger.warn(`Unknown field '${key}' ignored in updateMessage`);
      }
    }

    // 更新 Message 表字段
    if (Object.keys(messageFields).length > 0) {
      await this.messageRepo.update(messageId, messageFields);
      this.logger.debug(
        `Updated message fields: ${Object.keys(messageFields).join(", ")}`,
      );
    }

    // 更新 MessageContent 表字段（更新当前内容版本）
    if (Object.keys(contentFields).length > 0) {
      // 获取当前内容版本（与 Python 后端 message.contents[-1] 一致）
      const currentContent =
        message.contents && message.contents.length > 0
          ? message.contents[message.contents.length - 1]
          : null;

      if (!currentContent) {
        this.logger.error(`No content found for message ${messageId}`);
        throw new HttpException(
          "Message content not found",
          HttpStatus.NOT_FOUND,
        );
      }

      // 更新当前内容版本
      await this.contentRepo.update(currentContent.id, contentFields);
      this.logger.debug(
        `Updated content fields: ${Object.keys(contentFields).join(", ")}`,
      );
    }

    // 返回更新后的完整消息（包含最新的内容和文件）
    const updatedMessage = await this.messageRepo.findById(messageId, {
      withFiles: true,
      withContents: true,
    });

    if (updatedMessage) {
      // 转换文件 URL 为绝对路径
      if (updatedMessage.files && updatedMessage.files.length > 0) {
        updatedMessage.files = updatedMessage.files.map((file) => ({
          ...file,
          url: this.urlService.toResourceAbsoluteUrl(file.url || ""),
          previewUrl: this.urlService.toResourceAbsoluteUrl(file.previewUrl || ""),
        }));
      }

      // 格式化返回数据
      updatedMessage.contents.forEach((content) => {
        content.metadata = content.metadata || null;
        content.additionalKwargs = content.additionalKwargs || null;
      });
    }

    return updatedMessage;
  }

  /**
   * 删除消息（内部实现）
   */
  private async deleteMessageInternal(messageId: string) {
    // 1. 先删除该消息关联的所有物理文件
    await this.fileService.deleteFilesByMessageId(messageId);

    // 2. 删除子消息
    await this.messageRepo.deleteByParentId(messageId);

    // 3. 先删除所有内容版本
    await this.contentRepo.deleteByMessageId(messageId);

    // 4. 再删除消息本身
    await this.messageRepo.delete(messageId);
  }

  /**
   * 删除消息
   */
  async deleteMessage(messageId: string, userId: string) {
    const message = await this.messageRepo.findById(messageId);
    this.assertMessageOwner(message, userId);

    // 执行删除
    await this.deleteMessageInternal(messageId);

    // 级联删除：如果删除的是用户消息，同步删除其关联的 AI 回复（与 Python 后端一致）
    if (message.role === "user") {
      await this.messageRepo.deleteByParentId(messageId);
    }

    return { success: true };
  }

  /**
   * 清空会话的所有消息
   */
  async deleteMessagesBySessionId(sessionId: string, userId: string) {
    await this.assertSessionOwner(sessionId, userId);

    // 1. 先获取该会话下的所有消息 ID
    const messages = await this.messageRepo.findBySessionId(sessionId, {
      withFiles: false,
      withContents: false,
    });

    // 2. 删除所有消息关联的物理文件（并行执行）
    const fileDeletePromises = messages.map(msg =>
      this.fileService.deleteFilesByMessageId(msg.id)
    );
    await Promise.all(fileDeletePromises);

    // 3. 删除所有消息（级联删除内容）
    await this.messageRepo.deleteBySessionId(sessionId);

    return { success: true };
  }

  /**
   * 设置消息的当前活动内容版本
   */
  async setMessageCurrentContent(
    messageId: string,
    contentId: string,
    userId: string,
  ) {
    const message = await this.messageRepo.findById(messageId);
    this.assertMessageOwner(message, userId);

    const content = await this.contentRepo.findById(contentId);
    if (!content) {
      throw new HttpException(
        "Content version not found",
        HttpStatus.NOT_FOUND,
      );
    }

    // 验证内容属于该消息
    if (content.messageId !== messageId) {
      throw new HttpException(
        "Content does not belong to this message",
        HttpStatus.FORBIDDEN,
      );
    }

    // Python 后端通过查询最后一个 content 来获取当前内容，不需要单独设置
    return { success: true };
  }

  /**
   * 批量导入消息
   */
  async importMessages(sessionId: string, messages: any[], userId: string) {
    await this.assertSessionOwner(sessionId, userId);

    // 验证消息格式并转换
    const formattedMessages = messages.map((msg) => ({
      sessionId,
      role: msg.role || "user",
      content: msg.content || "",
      parentId: msg.parent_id || null,
      createdAt: msg.created_at ? new Date(msg.created_at) : new Date(),
    }));

    // 批量创建消息
    const result = await this.messageRepo.importMessages(formattedMessages);

    return { success: true, count: result.count };
  }

  /**
   * 清理所有 messageId 为 NULL 的孤儿文件
   * 在编辑消息后调用，异步执行，不阻塞响应
   */
}
