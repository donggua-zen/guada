import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
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
   * 获取会话的消息列表
   */
  @Get("sessions/:sessionId/messages")
  async getMessages(
    @Param("sessionId") sessionId: string,
    @CurrentUser() user: any,
  ) {
    return this.messageService.getMessages(sessionId);
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
    return this.messageService.updateMessage(messageId, body);
  }

  /**
   * 删除单个消息
   */
  @Delete("messages/:messageId")
  async deleteMessage(
    @Param("messageId") messageId: string,
    @CurrentUser() user: any,
  ) {
    return this.messageService.deleteMessage(messageId);
  }

  /**
   * 清空会话的所有消息
   */
  @Delete("sessions/:sessionId/messages")
  async clearSessionMessages(
    @Param("sessionId") sessionId: string,
    @CurrentUser() user: any,
  ) {
    return this.messageService.deleteMessagesBySessionId(sessionId);
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
    return this.messageService.importMessages(sessionId, messages);
  }
}
