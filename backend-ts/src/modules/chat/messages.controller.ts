import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { MessageService } from "./message.service";

@Controller()
@UseGuards(AuthGuard)
export class MessagesController {
  constructor(private readonly messageService: MessageService) {}

  /**
   * 获取会话的消息列表（支持分页加载）
   *
   * 分页参数：
   * - limit: 限制返回消息数量
   * - beforeMessageId: 加载此 ID 之前（更早）的消息
   * - afterMessageId: 加载此 ID 之后（更新）的消息
   */
  @Get("sessions/:sessionId/messages")
  async getMessages(
    @Param("sessionId") sessionId: string,
    @CurrentUser() user: any,
    @Query("limit") limit?: string,
    @Query("beforeMessageId") beforeMessageId?: string,
    @Query("afterMessageId") afterMessageId?: string,
  ) {
    return this.messageService.getMessages(sessionId, user.id, {
      limit: limit ? parseInt(limit, 10) : undefined,
      beforeMessageId,
      afterMessageId,
    });
  }

  /**
   * 添加新消息到会话
   */
  @Post("sessions/:sessionId/messages")
  async addMessage(
    @Param("sessionId") sessionId: string,
    @Body()
    body: {
      content: string;
      role?: string;
      files?: any[];
      replaceMessageId?: string; // 驼峰式
      knowledgeBaseIds?: string[];
      source?: Record<string, any>;
    },
    @CurrentUser() user: any,
  ) {
    return this.messageService.addMessage(
      sessionId,
      body.role || "user",
      body.content,
      body.files || [],
      body.replaceMessageId, // 驼峰式
      body.knowledgeBaseIds,
      user.id,
      body.source,
    );
  }

  /**
   * 更新消息
   */
  @Put("messages/:messageId")
  async updateMessage(
    @Param("messageId") messageId: string,
    @Body() body: any,
    @CurrentUser() user: any,
  ) {
    return this.messageService.updateMessage(messageId, body, user.id);
  }

  /**
   * 删除单个消息
   */
  @Delete("messages/:messageId")
  async deleteMessage(
    @Param("messageId") messageId: string,
    @CurrentUser() user: any,
  ) {
    return this.messageService.deleteMessage(messageId, user.id);
  }

  /**
   * 清空会话的所有消息
   */
  @Delete("sessions/:sessionId/messages")
  async clearSessionMessages(
    @Param("sessionId") sessionId: string,
    @CurrentUser() user: any,
  ) {
    return this.messageService.deleteMessagesBySessionId(sessionId, user.id);
  }

  /**
   * 设置消息的当前活动内容版本
   */
  @Put("message-content/:contentId/active")
  async updateMessageActiveContent(
    @Param("contentId") contentId: string,
    @Body() body: { message_id: string },
    @CurrentUser() user: any,
  ) {
    return this.messageService.setMessageCurrentContent(
      body.message_id,
      contentId,
      user.id,
    );
  }

  /**
   * 获取消息内容的工具调用详情（完整参数和结果）
   *
   * 用于懒加载：前端列表仅展示摘要，点击弹窗时通过此接口获取完整数据。
   */
  @Get("message-content/:contentId/tool-details")
  async getMessageContentToolDetails(
    @Param("contentId") contentId: string,
    @CurrentUser() user: any,
  ) {
    return this.messageService.getMessageContentToolDetails(
      contentId,
      user.id,
    );
  }

  /**
   * 批量导入消息
   */
  @Post("sessions/:sessionId/messages/import")
  async importMessages(
    @Param("sessionId") sessionId: string,
    @Body() messages: any[],
    @CurrentUser() user: any,
  ) {
    return this.messageService.importMessages(sessionId, messages, user.id);
  }
}
