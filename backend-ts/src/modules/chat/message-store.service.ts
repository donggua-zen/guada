import { Injectable, Logger } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";
import { MessageRepository } from "../../common/database/message.repository";
import { MessageContentRepository } from "../../common/database/message-content.repository";
import { UploadPathService } from "../../common/services/upload-path.service";
import { MessageRecord, MessagePart } from "../llm-core/types/llm.types";
import { IMessageStore, MessageLoadParams } from "./interfaces";

/**
 * 消息存储服务
 *
 * 负责会话消息的持久化加载、内容转换和存储操作。
 * 核心职责包括：
 * - 从数据库加载历史消息并转换为 LLM 所需的 MessageRecord 格式
 * - 处理多模态内容（图片、文本附件）的格式转换
 * - 管理消息内容的持久化存储和再生模式下的消息树操作
 * - 注入知识库引用信息等上下文增强数据
 *
 * 设计原则：
 * - 职责分离：仅负责数据的加载和格式转换，不处理压缩逻辑（由 CompressionEngine 负责）
 * - 内存层裁剪：基于压缩游标在内存中裁剪已压缩的内容，避免修改数据库原文
 */
@Injectable()
export class MessageStoreService implements IMessageStore {
  private readonly logger = new Logger(MessageStoreService.name);

  constructor(
    private messageRepo: MessageRepository,
    private contentRepo: MessageContentRepository,
    private uploadPathService: UploadPathService,
  ) { }

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
      lastCompactedMessageId, // 使用传入的参数而非从 state 读取
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
    // 这是一种内存层操作，数据库中的原始消息保持不变，确保数据完整性和可追溯性
    // 未来可考虑将此逻辑下推到数据库查询层以提升性能
    if (lastCompactedContentId) {
      const idx = context.findIndex(m => m.contentId === lastCompactedContentId);
      if (idx !== -1) {
        context.splice(0, idx + 1);
      }
    }

    // 调试日志：打印加载后的消息内容，过长内容将进行截断处理
    // context.forEach((msg, index) => {
    //   const contentPreview = typeof msg.content === 'string'
    //     ? (msg.content.length > 200 ? `${msg.content.substring(0, 200)}...` : msg.content)
    //     : JSON.stringify(msg.content);
    //   this.logger.debug(`Message [${index}] Role: ${msg.role}, ContentId: ${msg.contentId}, Content: ${contentPreview}`);
    // });

    // 注意：不再在此处应用裁剪覆盖层和摘要注入，这些职责已移至 CompressionEngine.preprocess() 方法
    // 这种设计保持了存储层的纯粹性，避免跨层耦合

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
        // 构建元数据对象，提取关键的性能和状态信息
        const metadata: any = {
          modelName: record.metadata?.modelName || "",
          finishReason: record.metadata?.finishReason || "",
        };

        // 条件性地添加可选元数据字段，避免存储 null 或 undefined 值
        if (record.metadata?.error) {
          metadata.error = record.metadata?.error;
        }

        // 思维链耗时仅在存在时记录，用于性能分析和优化
        if (record.metadata?.thinkingDurationMs !== null && record.metadata?.thinkingDurationMs !== undefined) {
          metadata.thinkingDurationMs = record.metadata?.thinkingDurationMs;
        }

        // Token 使用量统计，用于成本核算和配额管理
        if (record.metadata?.usage) {
          metadata.usage = record.metadata?.usage;
        }

        // 工具调用信息和 ID，用于追踪函数执行流程
        if (record.toolCalls) {
          metadata.toolCalls = record.toolCalls;
        }

        if (record.toolCallId) {
          metadata.toolCallId = record.toolCallId;
        }

        await this.contentRepo.create({
          id: record.contentId,
          messageId: record.messageId || '',
          turnsId: record.turnsId || '',
          role: record.role,
          content: typeof record.content === 'string' ? record.content : "",
          reasoningContent: record.reasoningContent,
          metadata,
        });
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
   * 该方法采用消息树结构管理对话分支，支持同一用户消息的多版本助手回复。
   *
   * @param sessionId 会话 ID
   * @param parentId 父消息 ID（通常是用户消息）
   * @param regenerationMode 再生模式标识（"overwrite" 或其他）
   * @param turnsId 当前对话轮次 ID
   * @param existingAssistantMessageId 已存在的助手消息 ID（可选）
   * @returns 目标助手消息的 ID
   */
  async prepareAssistantResponse(
    sessionId: string,
    parentId: string,
    regenerationMode: string,
    turnsId: string,
    existingAssistantMessageId?: string,
  ): Promise<string> {
    let targetMessageId = existingAssistantMessageId;

    // overwrite 模式：清除旧的回复分支，创建全新的助手消息记录
    if (regenerationMode === "overwrite" || !regenerationMode) {
      await this.messageRepo.deleteByParentId(parentId);
      const msg = await this.messageRepo.create({
        sessionId,
        role: "assistant",
        parentId,
        currentTurnsId: turnsId,
      });
      targetMessageId = msg.id;
    } else if (targetMessageId) {
      // 非覆盖模式且未提供现有消息 ID 时，更新或创建消息记录
      await this.messageRepo.update(targetMessageId, { currentTurnsId: turnsId });
    }
    return targetMessageId;
  }

  /**
   * 为再生场景创建新的内容记录
   *
   * 当用户对同一条助手回复进行再生成时，创建一个新的内容版本而非覆盖原有内容。
   * 这种设计保留了历史回复版本，支持用户在不同版本间切换对比。
   *
   * @param messageId 关联的消息 ID
   * @param turnsId 对话轮次 ID
   * @param modelName 使用的模型名称（可选）
   * @returns 新创建的内容记录 ID
   */
  async createRegenerationContent(
    messageId: string,
    turnsId: string,
    modelName?: string,
  ): Promise<string> {
    const content = await this.contentRepo.create({
      messageId,
      turnsId,
      role: "assistant",
      content: "",
      reasoningContent: null,
      metadata: { modelName },
      additionalKwargs: {},
    });
    return content.id;
  }

  /**
   * 创建内容记录（通用方法）
   *
   * 为指定的消息创建一个新的内容版本，通常用于流式输出过程中的内容初始化。
   * 与 createRegenerationContent 类似，但语义上更通用，可用于各种内容创建场景。
   *
   * @param messageId 关联的消息 ID
   * @param turnsId 对话轮次 ID
   * @param modelName 使用的模型名称（可选）
   * @returns 新创建的内容记录 ID
   */
  async createContentRecord(
    messageId: string,
    turnsId: string,
    modelName?: string,
  ): Promise<string> {
    const content = await this.contentRepo.create({
      messageId,
      turnsId,
      role: "assistant",
      content: "",
      reasoningContent: null,
      metadata: { modelName },
      additionalKwargs: {},
    });
    return content.id;
  }

  /**
   * 删除指定父消息下的所有子消息
   *
   * 用于清理再生产生的废弃分支或执行会话删除操作。
   *
   * @param parentId 父消息 ID
   */
  async deleteMessagesByParentId(parentId: string): Promise<void> {
    await this.messageRepo.deleteByParentId(parentId);
  }

  /**
   * 判断轮次中是否包含工具调用
   *
   * 检查消息列表中是否存在带有 toolCalls 的助手消息，用于决定是否保留 reasoning content。
   *
   * @param turnMessages 待检查的消息列表
   * @returns 是否包含工具调用
   */
  private turnHasToolCalls(turnMessages: MessageRecord[]): boolean {
    return turnMessages.some(
      (msg) => msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0,
    );
  }

  /**
   * 转换消息内容结构
   *
   * 将数据库中的原始消息格式转换为 LLM 所需的 MessageRecord 格式。
   * 该方法根据消息角色（user/assistant/tool）采用不同的转换策略：
   * - assistant/tool：展开多个内容版本，提取工具调用信息
   * - user：组装文本、图片和附件为多模态消息格式，注入知识库引用信息
   *
   * @param msg 数据库中的原始消息对象
   * @param isNewUserMessage 是否为最新的用户消息（用于决定是否注入 KB 引用）
   * @param supportsImageInput 是否支持图片输入（影响图片处理方式）
   * @param keepReasoningContent 是否保留思维链内容（针对 DeepSeek-V4 等模型）
   * @returns 转换后的消息记录数组
   */
  private async transformContentStructure(
    msg: any,
    isNewUserMessage: boolean,
    supportsImageInput: boolean = true,
    keepReasoningContent: boolean = false,
  ): Promise<MessageRecord[]> {
    if (msg.role === "assistant") {
      const transformed: MessageRecord[] = [];

      // 遍历助手消息的所有内容版本（支持多版本并存）
      for (const content of msg.contents || []) {
        const metadata = content.metadata || {};

        // 构建基础消息记录，复制元数据以保留模型信息和完成状态
        const baseMsg: MessageRecord = {
          messageId: msg.id,
          contentId: content.id,
          role: content.role,
          content: content.content || "",
          metadata: { ...metadata } // 复制 metadata 以保留 modelName、finishReason 等信息
        };

        // 根据配置决定是否保留思维链内容，避免不必要的 Token 消耗
        if (keepReasoningContent) {
          baseMsg.reasoningContent = content.reasoningContent;
        }
        // 提取工具调用信息，用于后续的函数执行和上下文构建
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
      // 用户消息处理：组装多模态内容（文本 + 图片 + 附件）
      const activeContent = msg.contents?.[0];
      if (!activeContent) return [{ messageId: msg.id, contentId: undefined, role: "user", content: "", metadata: {} }];

      const textParts: MessagePart[] = [
        { type: "text", text: activeContent.content || "" },
      ];

      let metadata = {};
      // 仅为最新的用户消息注入知识库引用信息，避免历史消息重复携带冗余数据
      if (isNewUserMessage) {
        const kbInfo = this.appendKbReferenceInfo(activeContent);
        if (kbInfo) {
          textParts.push({ type: "text", text: kbInfo });
          metadata["referencedKbs"] = kbInfo;
        }
      }

      // 处理附加的文件（图片和文本），转换为 LLM 可识别的格式
      if (msg.files && Array.isArray(msg.files)) {
        for (let index = 0; index < msg.files.length; index++) {
          const file = msg.files[index];
          if (file.fileType === "image") {
            const imagePart = await this.transformImageFile(file, supportsImageInput);
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
          role: "user",
          content: textParts.length === 1 ? textParts[0].text : textParts,
          metadata: metadata,
        },
      ];
    }
  }

  /**
   * 追加知识库引用信息到用户消息
   *
   * 当用户消息触发了知识库检索时，将引用的知识库元数据格式化后附加到消息内容中。
   * 这帮助模型理解回答的依据来源，提升回复的可信度和准确性。
   *
   * @param activeContent 活动的内容记录，包含 referencedKbs 元数据
   * @returns 格式化后的知识库引用文本，若无引用则返回 null
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

      const lines = ["【当前引用的知识库】"];
      // 遍历引用的知识库，格式化为易读的列表形式
      referencedKbs.forEach((kb: any) => {
        const name = kb.name || "未知";
        const id = kb.id || "unknown";
        const desc = kb.description || "";
        // 构建单行描述，包含名称、ID 和简介（若有）
        let line = `- 名称：${name}, ID: ${id}`;
        if (desc) line += `, 简介：${desc}`;
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
   *
   * 将存储在服务器上的图片文件读取并转换为 Data URI 格式，以便嵌入到多模态消息中。
   * 若不支持图片输入，则降级为纯文本占位符。
   *
   * 支持的图片格式：JPEG、PNG、GIF、WebP、BMP、TIFF。
   *
   * @param file 文件记录对象，包含 url 和 fileType 等信息
   * @param supportsImageInput 是否支持图片输入
   * @returns 转换后的图片部分对象，若失败则返回 null
   */
  private async transformImageFile(file: any, supportsImageInput: boolean): Promise<any | null> {
    if (!supportsImageInput) {
      // 降级处理：当模型不支持图片时，用文本占位符替代
      return { type: "text", text: `[图片ID：${file.id}]` };
    }

    if (!file.url) return null;

    try {
      // 将 URL 转换为物理路径并验证文件存在性
      const physicalPath = this.uploadPathService.toPhysicalPath(file.url);
      if (!fs.existsSync(physicalPath)) {
        this.logger.warn(`Image file not found at path: ${physicalPath}`);
        return null;
      }

      // 异步读取图片文件并转换为 Base64 编码，避免阻塞事件循环
      const imageBuffer = await fs.promises.readFile(physicalPath);
      const base64Data = imageBuffer.toString("base64");

      // 根据文件扩展名确定 MIME 类型，确保正确的图片格式标识
      const ext = path.extname(physicalPath).toLowerCase();
      let mimeType = "image/jpeg";
      // 映射常见图片格式到对应的 MIME 类型
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

      // 返回符合 OpenAI 多模态 API 规范的图片部分对象
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
   *
   * 将上传的文本文件（如 PDF、Word、TXT 等）的内容包装为 XML 风格的标记格式，
   * 便于模型识别文件边界和元数据。
   *
   * @param file 文件记录对象，包含 fileName 和 content
   * @param index 文件在消息中的索引位置
   * @returns 格式化后的文本部分对象
   */
  private transformTextFile(file: any, index: number): any | null {
    const fileName = file.fileName || "unknown";
    const content = file.content || "";
    // 使用 XML 风格的标签封装文件内容，增强可读性和结构化程度
    const fileText =
      `\n\n<ATTACHMENT_FILE>\n` +
      `<FILE_INDEX>File ${index}</FILE_INDEX>\n` +
      `<FILE_NAME>${fileName}</FILE_NAME>\n` +
      `<FILE_CONTENT>\n${content}\n</FILE_CONTENT>\n` +
      `</ATTACHMENT_FILE>\n`;

    return { type: "text", text: fileText };
  }
}
