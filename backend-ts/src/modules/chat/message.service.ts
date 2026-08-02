import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";
import { MessageRepository } from "../../common/database/message.repository";
import { MessageContentRepository } from "../../common/database/message-content.repository";
import { KnowledgeBaseRepository } from "../../common/database/knowledge-base.repository";
import { createPaginatedResponse } from "../../common/types/pagination";
import { randomUUID } from "crypto";
import { UrlService } from "../../common/services/url.service";
import { FileService } from "../files/file.service";
import { UploadPathService } from "../../common/services/upload-path.service";
import { FileRepository } from "../../common/database/file.repository";
import { createHash } from "crypto";
import { MessageRecord, MessagePart } from "../llm-core/types/llm.types";
import { MessageLoadParams } from "./interfaces";

@Injectable()
export class MessageService {
  private readonly logger = new Logger(MessageService.name);

  constructor(
    private messageRepo: MessageRepository,
    private contentRepo: MessageContentRepository,
    private kbRepo: KnowledgeBaseRepository,
    private urlService: UrlService,
    private fileService: FileService,
    private uploadPathService: UploadPathService,
    private fileRepo: FileRepository,
  ) {}

  /**
   * 过滤 metadata 中的 systemPayload，避免无意义的响应式追踪和传输
   */
  private stripSystemPayload(
    metadata: Record<string, any>,
  ): Record<string, any> {
    const { systemPayload, runMode, systemReminder, ...rest } = metadata;
    return rest;
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
      const visibleContents = (msg.contents || []).filter(
        (content: any) =>
          content.role !== "tool" && !content.metadata?.hidden,
      );

      // Convert file URLs to absolute paths within each content
      const contentsWithUrls = visibleContents.map((content: any) => {
        if (content.files?.length > 0) {
          content.files = content.files.map((file: any) => ({
            ...file,
            url: this.urlService.toResourceAbsoluteUrl(file.url || ""),
            previewUrl: this.urlService.toResourceAbsoluteUrl(
              file.previewUrl || "",
            ),
          }));
        }
        return this.stripToolCallDetails(content);
      });

      return {
        ...msg,
        contents: contentsWithUrls,
        metadata: msg.metadata
          ? this.stripSystemPayload(msg.metadata as Record<string, any>)
          : undefined,
      };
    });

    // 返回统一的分页格式
    return createPaginatedResponse(formattedMessages, formattedMessages.length);
  }

  /**
   * 剥离工具调用的执行结果，减少传输数据量
   *
   * 处理逻辑：
   * - tool 消息：清空 content（工具执行结果），保留 metadata.toolCallId 用于关联
   * - toolCallsResponse：清空 content（如果后端已聚合）
   */
  private stripToolCallDetails(content: any): any {
    const result = { ...content };

    if (content.metadata) {
      const metadata = { ...content.metadata };

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
          },
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
  async addUserMessage(
    sessionId: string,
    content: string,
    files: string[] = [],
    replaceMessageId: string | undefined,
    knowledgeBaseIds: string[] | undefined,
    metadata?: Record<string, any>,
    preGenAssistantId?: string,
  ) {
    const turnsId = randomUUID();
    // 提前处理知识库引用逻辑，不占用事务
    let contentMetadata: any = null;
    if (knowledgeBaseIds && knowledgeBaseIds.length > 0) {
      // 使用批量查询提升效率（替代多次单独查询）
      const kbs = await this.kbRepo.findByIds(knowledgeBaseIds);
      const kbMetadata = kbs.map((kb) => ({
        id: kb.id,
        name: kb.name,
        description: kb.description,
      }));
      contentMetadata = { referencedKbs: kbMetadata };
    }
    const prisma = this.contentRepo.getPrismaClient();
    const messageId = await prisma.$transaction(async (tx) => {
      let messageId: string;
      if (replaceMessageId) {
        const existingMessage = await tx.message.findFirst({
          where: { id: replaceMessageId },
        });
        if (!existingMessage || existingMessage.sessionId !== sessionId) {
          throw new HttpException("Message not found", HttpStatus.NOT_FOUND);
        }

        // 1. 删除旧消息的所有内容版本（File.contentId onDelete: SetNull 自动解绑）
        await tx.message.deleteMany({
          where: { parentId: replaceMessageId },
        });

        // 2. 删除旧消息本身
        await tx.message.delete({
          where: { id: replaceMessageId },
        });
      }
      // 3. 创建全新的消息（而不是创建新版本）
      const newMessage = await tx.message.create({
        data: {
          sessionId,
          role: "user",
          parentId: undefined,
          currentVersionId: preGenAssistantId,
          metadata: metadata || undefined,
        },
      });

      messageId = newMessage.id;

      // 4. 创建消息内容
      const newContent = await tx.messageContent.create({
        data: {
          messageId,
          turnsId, // 使用相同的 turnsId
          role: "user", // 添加 role
          content,
          metadata: contentMetadata || undefined, // 存储知识库引用信息
        },
      });

      // 5. 更新文件关联到 contentId（如果有文件）
      if (files && files.length > 0) {
        await tx.file.updateMany({
          where: { id: { in: files } },
          data: { contentId: newContent.id },
        });
      }

      return messageId;
    });

    // 获取完整的消息对象（包含文件信息）
    const completeMessage = await this.messageRepo.findById(messageId, {
      withFiles: true,
      withContents: true,
    });

    if (completeMessage) {
      // 转换 contents 中 files 的 URL 为绝对路径
      if (completeMessage.contents) {
        for (const content of completeMessage.contents) {
          if (content.files && content.files.length > 0) {
            content.files = content.files.map((file) => ({
              ...file,
              url: this.urlService.toResourceAbsoluteUrl(file.url || ""),
              previewUrl: this.urlService.toResourceAbsoluteUrl(
                file.previewUrl || "",
              ),
            }));
          }
        }
      }
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
    const message = await this.messageRepo.findById(messageId, {
      withContents: true,
    });

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
      // 转换 contents 中 files 的 URL 为绝对路径
      if (updatedMessage.contents) {
        for (const content of updatedMessage.contents) {
          if (content.files && content.files.length > 0) {
            content.files = content.files.map((file: any) => ({
              ...file,
              url: this.urlService.toResourceAbsoluteUrl(file.url || ""),
              previewUrl: this.urlService.toResourceAbsoluteUrl(
                file.previewUrl || "",
              ),
            }));
          }
        }
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
    //  删除所有消息（级联删除内容）
    await this.messageRepo.deleteBySessionId(sessionId);

    return { success: true };
  }

  /**
   * 批量导入消息
   */
  async importMessages(sessionId: string, messages: any[], userId: string) {
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

  // ============================================================================
  // 以下方法来自合并前的 MessageStoreService —— 纯数据存取 + LLM 格式转换
  // ============================================================================

  /**
   * 加载会话历史消息
   *
   * 从数据库中检索指定会话的最近消息，并将其转换为 LLM 可识别的 MessageRecord 格式。
   * 该方法支持多模态内容（图片、文本附件）的自动转换，以及基于压缩游标的增量加载。
   *
   * 加载流程：
   * - 从数据库查询原始消息（包含内容和文件信息）
   * - 反转消息顺序并逐条转换为标准格式
   * - 根据压缩检查点裁剪已压缩的内容部分
   * - 返回纯净的对话历史（不含摘要和裁剪覆盖层，由上层负责处理）
   *
   * @param params 加载参数，包含会话 ID、最大消息数、压缩游标等信息
   * @returns 转换后的消息记录数组，按时间正序排列
   */
  async loadMessages(params: MessageLoadParams): Promise<MessageRecord[]> {
    const {
      sessionId,
      userMessageId,
      maxMessages = undefined,
      supportsImageInput = false,
      keepReasoningContent = false,
      lastCompactedMessageId,
      lastCompactedContentId,
    } = params;

    // 从数据库加载原始消息（不包含压缩状态处理），传入压缩游标实现增量加载
    const rawMessages = await this.messageRepo.findRecentBySessionId(
      sessionId,
      maxMessages,
      userMessageId,
      lastCompactedMessageId,
      { withFiles: true, withContents: true, onlyCurrentContent: true },
    );

    const context: MessageRecord[] = [];
    const lastMessage = rawMessages[0];
    // 反转消息列表以按时间正序处理，同时保留最后一条消息的标识用于特殊处理
    for (const msg of rawMessages.reverse()) {
      const transformed = await this.transformContentStructure(
        msg,
        msg.id === lastMessage?.id,
        supportsImageInput,
        keepReasoningContent,
      );
      if (transformed.length > 0) {
        context.push(...transformed);
      }
    }

    // 根据压缩检查点中的 Content ID 裁剪已压缩的内容部分
    if (lastCompactedContentId) {
      const idx = context.findIndex(
        (m) => m.contentId === lastCompactedContentId,
      );
      if (idx !== -1) {
        context.splice(0, idx + 1);
      }
    }

    return context;
  }

  /**
   * 持久化消息内容记录
   *
   * 将新的消息内容写入数据库，支持助手回复、工具调用结果等多种角色类型。
   * 该方法会提取消息中的元数据（模型名称、完成原因、Token 使用量、思维链耗时等）并一并存储。
   *
   * @param records 待持久化的消息记录数组
   * @returns 成功持久化的消息记录数组
   * @throws 若数据库写入失败则抛出异常
   */
  async persistContent(records: MessageRecord[]): Promise<MessageRecord[]> {
    try {
      if (!records || records.length === 0) return [];

      for (const record of records) {
        const metadata: any = {
          ...(record.metadata || {}),
          modelName: record.metadata?.modelName || "",
          finishReason: record.metadata?.finishReason || "",
        };

        if (record.toolCalls) {
          metadata.toolCalls = record.toolCalls;
        }
        if (record.toolCallId) {
          metadata.toolCallId = record.toolCallId;
        }

        let dbContent = "";
        let pendingImages: MessagePart[] = [];

        if (typeof record.content === "string") {
          dbContent = record.content;
        } else if (Array.isArray(record.content)) {
          // MessagePart[] — extract images → File records (after content), merge text → string
          const textParts: string[] = [];
          pendingImages = [];

          for (const part of record.content) {
            if (part.type === "text" && part.text) {
              textParts.push(part.text);
            } else if (part.type === "image_url" && part.image_url?.url) {
              pendingImages.push(part);
            }
          }

          dbContent = textParts.join("\n");
        }

        // Create MessageContent first (File records need contentId FK)
        await this.contentRepo.create({
          id: record.contentId,
          messageId: record.messageId || "",
          turnsId: "",
          role: record.role,
          content: dbContent,
          reasoningContent: record.reasoningContent,
          metadata,
        });

        // Now create File records with valid contentId
        if (pendingImages.length > 0) {
          for (const img of pendingImages) {
            const match = img.image_url!.url.match(
              /^data:(.+?);base64,(.+)$/,
            );
            if (!match) continue;

            const mimeType = match[1];
            const base64Data = match[2];
            const ext = mimeType.split("/")[1] || "png";
            const fileId = randomUUID();

            await this.fileRepo.create({
              id: fileId,
              fileName: `tool_image_${fileId}.${ext}`,
              displayName: "tool_image",
              fileSize: Buffer.byteLength(base64Data, "base64"),
              fileType: "image",
              fileExtension: ext,
              content: base64Data,
              url: null,
              contentHash: createHash("md5").update(base64Data).digest("hex"),
              contentId: record.contentId || null,
              fileMetadata: { mimeType, source: "tool" },
            });
          }
        }
      }

      return records;
    } catch (error) {
      this.logger.error("Failed to create content", error);
      throw error;
    }
  }

  /**
   * 准备助手回复的消息容器
   *
   * 根据再生模式创建或更新助手消息的记录。支持三种场景：
   * - overwrite 模式：删除父消息下的所有子消息，创建全新的助手消息（用于重新生成）
   * - 普通模式：若提供了现有消息 ID 则更新其轮次 ID，否则创建新消息
   *
   * @param sessionId 会话 ID
   * @param parentId 父消息 ID（通常是用户消息）
   * @param regenerationMode 再生模式标识（"overwrite" 或其他）
   * @param turnsId 当前对话轮次 ID
   * @param existingAssistantMessageId 已存在的助手消息 ID（可选）
   * @returns 目标助手消息的 ID
   */
  async addAssistantMessageVersion(
    sessionId: string,
    userMessageId: string,
    preGenAssistantId?: string,
  ): Promise<string> {
    const msg = await this.messageRepo.create({
      id: preGenAssistantId,
      sessionId,
      role: "assistant",
      parentId: userMessageId,
    });
    // 无论何种模式，创建新版本后更新用户消息的 currentVersionId
    await this.messageRepo.update(userMessageId, { currentVersionId: msg.id });
    return msg.id;
  }

  /**
   * 转换消息内容结构
   *
   * 将数据库中的原始消息格式转换为 LLM 所需的 MessageRecord 格式。
   * 该方法根据消息角色（user/assistant/tool）采用不同的转换策略：
   * - assistant/tool：展开多个内容版本，提取工具调用信息
   * - user：组装文本、图片和附件为多模态消息格式，注入知识库引用信息
   */
  public async transformContentStructure(
    msg: any,
    isNewUserMessage: boolean,
    supportsImageInput: boolean = true,
    keepReasoningContent: boolean = false,
  ): Promise<MessageRecord[]> {
    if (msg.role === "assistant") {
      const transformed: MessageRecord[] = [];

      for (const content of msg.contents || []) {
        const metadata = content.metadata || {};

        const baseMsg: MessageRecord = {
          messageId: msg.id,
          contentId: content.id,
          turnsId: content.turnsId,
          role: content.role,
          content: content.content || "",
          metadata: { ...metadata },
        };

        // Hidden user message with images injected under an assistant Message
        // (content.role is "user" but msg.role is "assistant")
        // Files are associated at content level via File.contentId
        if (content.role === "user" && metadata.hidden && content.files?.length > 0) {
          const imageFiles = content.files.filter((f: any) => f.fileType === "image");
          if (imageFiles.length > 0) {
            const textParts: MessagePart[] = [
              { type: "text", text: content.content || "" },
            ];
            for (const file of imageFiles) {
              const imagePart = await this.transformImageFile(
                file,
                supportsImageInput,
              );
              if (imagePart) textParts.push(imagePart);
            }
            baseMsg.content = textParts;
          }
        }

        if (keepReasoningContent) {
          baseMsg.reasoningContent = content.reasoningContent;
        }
        if (metadata.toolCalls) {
          baseMsg.toolCalls = metadata.toolCalls;
        }
        if (metadata.toolCallId) {
          baseMsg.toolCallId = metadata.toolCallId;
        }
        transformed.push(baseMsg);
      }
      return transformed;
    } else {
      const activeContent = msg.contents?.[0];
      if (!activeContent)
        return [
          {
            messageId: msg.id,
            contentId: undefined,
            role: "user",
            content: "",
            metadata: {},
          },
        ];

      let userContent = activeContent.content || "";

      const meta = msg.metadata;
      if (meta && typeof meta === "object" && meta.parseResult?.content) {
        userContent = meta.parseResult.content;
      } else if (
        meta &&
        typeof meta === "object" &&
        meta.type &&
        meta.type !== "client"
      ) {
        userContent = this.wrapSystemReminder(meta, userContent);
      }

      // 系统提示注入（仅 LLM 路径经过 transformContentStructure，UI 不经过）
      if (meta?.systemReminder) {
        const reminder = `<system-reminder>${meta.systemReminder}</system-reminder>`;
        userContent = `${reminder}\n\n${userContent}`;
      }

      const textParts: MessagePart[] = [{ type: "text", text: userContent }];

      let metadata = {};

      // 透传 runMode（供后续 addUserMessage 模式检测使用）
      if (meta?.runMode) {
        metadata["runMode"] = meta.runMode;
      }

      const kbInfo = this.appendKbReferenceInfo(activeContent);
      if (kbInfo) {
        textParts.push({ type: "text", text: kbInfo });
        metadata["referencedKbs"] = kbInfo;
      }

      if (activeContent.files && Array.isArray(activeContent.files)) {
        for (let index = 0; index < activeContent.files.length; index++) {
          const file = activeContent.files[index];
          if (file.fileType === "image") {
            const imagePart = await this.transformImageFile(
              file,
              supportsImageInput,
            );
            if (imagePart) textParts.push(imagePart);
          } else if (file.fileType === "text") {
            const textPart = this.transformTextFile(file, index);
            if (textPart) textParts.push(textPart);
          }
        }
      }

      return [
        {
          messageId: msg.id,
          contentId: msg.contents?.[0].id,
          turnsId: activeContent.turnsId,
          role: "user",
          content: textParts.length === 1 ? textParts[0].text : textParts,
          metadata: metadata,
        },
      ];
    }
  }

  /**
   * 追加知识库引用信息到用户消息
   */
  private appendKbReferenceInfo(activeContent: any): string | null {
    try {
      const referencedKbs = activeContent.metadata?.referencedKbs;
      if (
        !referencedKbs ||
        !Array.isArray(referencedKbs) ||
        referencedKbs.length === 0
      ) {
        return null;
      }

      const lines = ["[referenced knowledge bases]\n"];
      referencedKbs.forEach((kb: any) => {
        const name = kb.name || "未知";
        const id = kb.id || "unknown";
        const desc = kb.description || "";
        let line = `- name：${name}, id: ${id}`;
        if (desc) line += `, description：${desc}`;
        lines.push(line);
      });

      return "\n" + lines.join("\n");
    } catch (error) {
      this.logger.error("Failed to append KB reference info", error);
      return null;
    }
  }

  /**
   * 转换图片文件为 Base64 格式
   */
  private async transformImageFile(
    file: any,
    supportsImageInput: boolean,
  ): Promise<any | null> {
    if (!supportsImageInput) {
      return { type: "text", text: `[图片ID：${file.id}]` };
    }

    // Tool image: base64 stored in File.content (no physical file on disk)
    if (file.content) {
      const mimeType = file.fileMetadata?.mimeType || "image/png";
      const dataUri = `data:${mimeType};base64,${file.content}`;
      return { type: "image_url", image_url: { url: dataUri } };
    }

    // Expired tool image: content was cleared by cleanup, no url fallback
    if (!file.url) {
      return { type: "text", text: "[图片已过期]" };
    }

    try {
      const physicalPath = this.uploadPathService.toPhysicalPath(file.url);
      if (!fs.existsSync(physicalPath)) {
        this.logger.warn(`Image file not found at path: ${physicalPath}`);
        return null;
      }

      const imageBuffer = await fs.promises.readFile(physicalPath);
      const base64Data = imageBuffer.toString("base64");

      const ext = path.extname(physicalPath).toLowerCase();
      let mimeType = "image/jpeg";
      switch (ext) {
        case ".png":
          mimeType = "image/png";
          break;
        case ".gif":
          mimeType = "image/gif";
          break;
        case ".webp":
          mimeType = "image/webp";
          break;
        case ".bmp":
          mimeType = "image/bmp";
          break;
        case ".tiff":
        case ".tif":
          mimeType = "image/tiff";
          break;
      }

      const dataUri = `data:${mimeType};base64,${base64Data}`;

      return {
        type: "image_url",
        image_url: { url: dataUri },
      };
    } catch (error: any) {
      this.logger.error(`Failed to transform image file: ${error.message}`);
      return null;
    }
  }

  /**
   * 转换文本文件为结构化文本块
   */
  private transformTextFile(file: any, index: number): any | null {
    const fileName = file.fileName || "unknown";
    const content = file.content || "";
    const fileText =
      `\n\n<ATTACHMENT_FILE>\n` +
      `<FILE_INDEX>File ${index}</FILE_INDEX>\n` +
      `<FILE_NAME>${fileName}</FILE_NAME>\n` +
      `<FILE_CONTENT>\n${content}\n</FILE_CONTENT>\n` +
      `</ATTACHMENT_FILE>\n`;

    return { type: "text", text: fileText };
  }

  /**
   * 将系统消息 metadata 包装为 XML 格式
   */
  private wrapSystemReminder(meta: any, userContent: string): string {
    const systemPayload = meta.systemPayload;
    if (Array.isArray(systemPayload) && systemPayload.length > 0) {
      const payloadXml = systemPayload
        .map((payload: any) => {
          const entries = Object.entries(payload)
            .map(([key, value]) => `<${key}>${value}</${key}>`)
            .join("");
          return `<payload>${entries}</payload>`;
        })
        .join("");
      return `<system-reminder note="This message is automatically triggered by the system" type="${meta.type}">${payloadXml}</system-reminder>`;
    }

    const { type, ...rest } = meta;
    const tags = Object.entries(rest)
      .map(([key, value]) => `<${key}>${value}</${key}>`)
      .join("");
    return `<system-reminder note="This message is automatically triggered by the system" type="${type}">${tags}<content>${userContent}</content></system-reminder>`;
  }
}
