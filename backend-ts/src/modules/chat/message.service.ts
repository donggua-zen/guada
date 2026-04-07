import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { MessageRepository } from '../../common/database/message.repository';
import { MessageContentRepository } from '../../common/database/message-content.repository';
import { SessionRepository } from '../../common/database/session.repository';
import { KnowledgeBaseRepository } from '../../common/database/knowledge-base.repository';
import { createPaginatedResponse } from '../../common/types/pagination';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class MessageService {
    private readonly logger = new Logger(MessageService.name);

    constructor(
        private messageRepo: MessageRepository,
        private contentRepo: MessageContentRepository,
        private sessionRepo: SessionRepository,
        private kbRepo: KnowledgeBaseRepository,
    ) { }

    /**
     * 获取会话的消息列表
     */
    async getMessages(sessionId: string) {
        // 验证会话存在
        const session = await this.sessionRepo.findById(sessionId);
        if (!session) {
            throw new HttpException('Session not found', HttpStatus.NOT_FOUND);
        }

        const messages = await this.messageRepo.findBySessionId(sessionId);

        // 格式化返回数据
        const formattedMessages = messages.map(msg => ({
            ...msg,
            contents: msg.contents.map(content => ({
                ...content,
                metaData: content.metaData || null,
                additionalKwargs: content.additionalKwargs || null,
            })),
        }));

        // 返回统一的分页格式
        return createPaginatedResponse(formattedMessages, formattedMessages.length);
    }

    /**
     * 添加新消息（支持多版本）
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
            throw new HttpException('Session not found', HttpStatus.NOT_FOUND);
        }

        let messageId: string;
        let turnsId: string;

        // ✅ 如果是替换模式：完全删除旧消息，然后创建新消息（与 Python 后端保持一致）
        if (replaceMessageId) {
            const existingMessage = await this.messageRepo.findById(replaceMessageId);
            if (!existingMessage) {
                throw new HttpException('Message not found', HttpStatus.NOT_FOUND);
            }

            // 检查权限：确保消息属于该会话
            if (existingMessage.sessionId !== sessionId) {
                throw new HttpException('Message does not belong to this session', HttpStatus.FORBIDDEN);
            }

            // ✅ 完全删除旧消息及其所有内容版本
            await this.deleteMessageInternal(replaceMessageId);

            // ✅ 创建全新的消息（而不是创建新版本）
            turnsId = uuidv4();  // ✅ 生成新的轮次 ID
            const newMessage = await this.messageRepo.create({
                sessionId,
                role,
                parentId: existingMessage.parentId,  // 继承原消息的 parent_id
                currentTurnsId: turnsId,  // ✅ 设置当前轮次 ID
            });

            messageId = newMessage.id;
        } else {
            // 创建新消息
            turnsId = uuidv4();  // ✅ 生成轮次 ID
            const message = await this.messageRepo.create({
                sessionId,
                role,
                parentId: undefined,
                currentTurnsId: turnsId,  // ✅ 设置当前轮次 ID
            });
            messageId = message.id;
        }

        // 处理知识库引用逻辑
        let additionalKwargs: any = null;
        if (knowledgeBaseIds && knowledgeBaseIds.length > 0) {
            const kbs = await Promise.all(
                knowledgeBaseIds.map(id => this.kbRepo.findById(id))
            );
            const kbMetadata = kbs.filter(kb => kb).map(kb => ({
                id: kb!.id,
                name: kb!.name,
                description: kb!.description,
            }));
            additionalKwargs = { referencedKbs: kbMetadata };
        }

        // 创建消息内容
        await this.contentRepo.create({
            messageId,
            turnsId,  // ✅ 使用相同的 turnsId
            role,  // ✅ 添加 role
            content,
            additionalKwargs, // ✅ 存储知识库引用信息
        });

        let message = await this.messageRepo.findById(messageId);
        this.logger.log(message);
        message.contents.forEach(content => {
            content.metaData = content.metaData || null;
            content.additionalKwargs = content.additionalKwargs || null;
        });
        return message;
    }

    /**
     * 更新消息
     */
    async updateMessage(messageId: string, data: any) {
        const message = await this.messageRepo.findById(messageId);
        if (!message) {
            throw new HttpException('Message not found', HttpStatus.NOT_FOUND);
        }

        // 只允许更新特定字段
        const allowedFields = ['role'];
        const updateData: any = {};

        for (const key of allowedFields) {
            if (data[key] !== undefined) {
                updateData[key] = data[key];
            }
        }

        return this.messageRepo.update(messageId, updateData);
    }

    /**
     * 删除消息（内部实现）
     */
    private async deleteMessageInternal(messageId: string) {
        await this.messageRepo.deleteByParentId(messageId);

        // 先删除所有内容版本
        await this.contentRepo.deleteByMessageId(messageId);
        // 再删除消息本身
        await this.messageRepo.delete(messageId);

    }

    /**
     * 删除消息
     */
    async deleteMessage(messageId: string) {
        const message = await this.messageRepo.findById(messageId);
        if (!message) {
            throw new HttpException('Message not found', HttpStatus.NOT_FOUND);
        }

        // 执行删除
        await this.deleteMessageInternal(messageId);

        // ✅ 级联删除：如果删除的是用户消息，同步删除其关联的 AI 回复（与 Python 后端一致）
        if (message.role === 'user') {
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
            throw new HttpException('Session not found', HttpStatus.NOT_FOUND);
        }

        // 删除所有消息（级联删除内容）
        await this.messageRepo.deleteBySessionId(sessionId);

        return { success: true };
    }

    /**
     * 设置消息的当前活动内容版本
     */
    async setMessageCurrentContent(messageId: string, contentId: string) {
        const message = await this.messageRepo.findById(messageId);
        if (!message) {
            throw new HttpException('Message not found', HttpStatus.NOT_FOUND);
        }

        const content = await this.contentRepo.findById(contentId);
        if (!content) {
            throw new HttpException('Content version not found', HttpStatus.NOT_FOUND);
        }

        // 验证内容属于该消息
        if (content.messageId !== messageId) {
            throw new HttpException('Content does not belong to this message', HttpStatus.FORBIDDEN);
        }

        // ✅ Python 后端通过查询最后一个 content 来获取当前内容，不需要单独设置
        return { success: true };
    }

    /**
     * 批量导入消息
     */
    async importMessages(sessionId: string, messages: any[]) {
        const session = await this.sessionRepo.findById(sessionId);
        if (!session) {
            throw new HttpException('Session not found', HttpStatus.NOT_FOUND);
        }

        // 验证消息格式并转换
        const formattedMessages = messages.map(msg => ({
            sessionId,
            role: msg.role || 'user',
            content: msg.content || '',
            parentId: msg.parent_id || null,
            createdAt: msg.created_at ? new Date(msg.created_at) : new Date(),
        }));

        // 批量创建消息
        const result = await this.messageRepo.importMessages(formattedMessages);

        return { success: true, count: result.count };
    }
}
