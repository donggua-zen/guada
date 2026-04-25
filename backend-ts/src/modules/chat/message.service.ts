import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";
import { MessageRepository } from "../../common/database/message.repository";
import { MessageContentRepository } from "../../common/database/message-content.repository";
import { SessionRepository } from "../../common/database/session.repository";
import { KnowledgeBaseRepository } from "../../common/database/knowledge-base.repository";
import { createPaginatedResponse } from "../../common/types/pagination";
import { v4 as uuidv4 } from "uuid";
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

  /**
   * 获取会话的消息列表
   */
  async getMessages(sessionId: string) {
    // 验证会话存在
    const session = await this.sessionRepo.findById(sessionId);
    if (!session) {
      throw new HttpException("Session not found", HttpStatus.NOT_FOUND);
    }

    const messages = await this.messageRepo.findBySessionId(sessionId, {
      withContents: true,
      withFiles: true,
    });

    // 格式化返回数据
    const formattedMessages = messages.map((msg) => {
      // 转换文件 URL 为绝对路径
      const filesWithAbsoluteUrls = msg.files?.map((file) => ({
        ...file,
        url: this.urlService.toUploadAbsoluteUrl(file.url || ""),
        previewUrl: this.urlService.toUploadAbsoluteUrl(file.previewUrl || ""),
      })) || [];

      return {
        ...msg,
        files: filesWithAbsoluteUrls,
        contents: msg.contents.map((content) => ({
          ...content,
          metaData: content.metaData || null,
          additionalKwargs: content.additionalKwargs || null,
        })),
      };
    });

    // 返回统一的分页格式
    return createPaginatedResponse(formattedMessages, formattedMessages.length);
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
    replaceMessageId?: string,
    knowledgeBaseIds?: string[],
  ) {
    // 验证会话存在
    const session = await this.sessionRepo.findById(sessionId);
    if (!session) {
      throw new HttpException("Session not found", HttpStatus.NOT_FOUND);
    }

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
      turnsId = uuidv4();

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
            },
          });

          messageId = newMessage.id;
        });

        // 5. 事务成功后，清理所有 messageId 为 NULL 的孤儿文件（异步执行，不阻塞响应）
        // 这些文件包括：本次编辑解绑但未重新关联的文件 + 历史遗留的孤儿文件
        this.cleanupOrphanMessageFiles().catch(error => {
          this.logger.error(`清理孤儿文件失败: ${error.message}`);
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
      turnsId = uuidv4(); // 生成轮次 ID
      const message = await this.messageRepo.create({
        sessionId,
        role,
        parentId: undefined,
        currentTurnsId: turnsId, // 设置当前轮次 ID
      });
      messageId = message.id;
    }

    // 处理知识库引用逻辑
    let additionalKwargs: any = null;
    if (knowledgeBaseIds && knowledgeBaseIds.length > 0) {
      // 使用批量查询提升效率（替代多次单独查询）
      const kbs = await this.kbRepo.findByIds(knowledgeBaseIds);
      const kbMetadata = kbs.map((kb) => ({
        id: kb.id,
        name: kb.name,
        description: kb.description,
      }));
      additionalKwargs = { referencedKbs: kbMetadata };
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
            additionalKwargs, // 存储知识库引用信息
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
          url: this.urlService.toUploadAbsoluteUrl(file.url || ""),
          previewUrl: this.urlService.toUploadAbsoluteUrl(file.previewUrl || ""),
        }));
      }

      // // 格式化内容字段
      // completeMessage.contents.forEach((content) => {
      //   content.metaData = content.metaData || null;
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
   * 2. MessageContent 表字段：content, reasoningContent, metaData, additionalKwargs
   *
   * @param messageId 消息 ID
   * @param data 包含要更新的字段的对象
   * @returns 更新后的消息对象
   */
  async updateMessage(messageId: string, data: any) {
    // 获取消息及其当前内容版本（与 Python 后端一致）
    const message =
      await this.messageRepo.findByIdWithCurrentContent(messageId);
    if (!message) {
      throw new HttpException("Message not found", HttpStatus.NOT_FOUND);
    }

    // 分离消息字段和内容字段（与 Python 后端逻辑一致）
    const messageFields: any = {};
    const contentFields: any = {};

    // 定义 Message 表的字段
    const messageTableFields = ["role", "currentTurnsId"];

    // 定义 MessageContent 表的字段
    const contentTableFields = [
      "content",
      "reasoningContent",
      "metaData",
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
          url: this.urlService.toUploadAbsoluteUrl(file.url || ""),
          previewUrl: this.urlService.toUploadAbsoluteUrl(file.previewUrl || ""),
        }));
      }

      // 格式化返回数据
      updatedMessage.contents.forEach((content) => {
        content.metaData = content.metaData || null;
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
  async deleteMessage(messageId: string) {
    const message = await this.messageRepo.findById(messageId);
    if (!message) {
      throw new HttpException("Message not found", HttpStatus.NOT_FOUND);
    }

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
  async deleteMessagesBySessionId(sessionId: string) {
    const session = await this.sessionRepo.findById(sessionId);
    if (!session) {
      throw new HttpException("Session not found", HttpStatus.NOT_FOUND);
    }

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
  async setMessageCurrentContent(messageId: string, contentId: string) {
    const message = await this.messageRepo.findById(messageId);
    if (!message) {
      throw new HttpException("Message not found", HttpStatus.NOT_FOUND);
    }

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
  async importMessages(sessionId: string, messages: any[]) {
    const session = await this.sessionRepo.findById(sessionId);
    if (!session) {
      throw new HttpException("Session not found", HttpStatus.NOT_FOUND);
    }

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
  private async cleanupOrphanMessageFiles(): Promise<void> {
    try {
      const prisma = this.contentRepo.getPrismaClient();
      
      // 查询所有 messageId 为 NULL 的文件
      const orphanFiles = await prisma.file.findMany({
        where: {
          messageId: null,
        },
        select: {
          id: true,
        },
      });

      if (orphanFiles.length === 0) {
        return; // 没有孤儿文件，直接返回
      }

      this.logger.log(`检测到 ${orphanFiles.length} 个孤儿文件，开始清理...`);

      // 异步并行删除所有孤儿文件
      const deletePromises = orphanFiles.map(file => 
        this.fileService.deleteFile(file.id)
      );

      const results = await Promise.allSettled(deletePromises);
      const successCount = results.filter(r => r.status === 'fulfilled' && r.value).length;
      const failCount = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value)).length;

      this.logger.log(`成功清理 ${successCount}/${orphanFiles.length} 个孤儿文件，${failCount} 个失败`);
    } catch (error: any) {
      this.logger.error(`清理孤儿文件失败: ${error.message}`);
    }
  }
}
