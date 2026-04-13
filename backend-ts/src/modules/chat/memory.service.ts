import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { MessageRepository } from '../../common/database/message.repository';
import { UploadPathService } from '../../common/services/upload-path.service';
import { MessageRecord, MessagePart } from './types/llm.types';

@Injectable()
export class MemoryManagerService {
    private readonly logger = new Logger(MemoryManagerService.name);

    constructor(
        private messageRepo: MessageRepository,
        private uploadPathService: UploadPathService,
    ) { }

    /**
     * 获取对话历史消息
     * @param sessionId 会话 ID
     * @param userMessageId 可选的用户消息 ID，如果提供则只获取到此消息为止的历史
     * @param maxMessages 最大消息数量，默认为 200
     * @param skipToolCalls 是否跳过包含工具调用的轮次
     */
    async getConversationMessages(
        sessionId: string,
        userMessageId?: string,
        maxMessages: number = 200,
        skipToolCalls: boolean = false,
    ): Promise<MessageRecord[]> {
        // 1. 数据库层直接获取最近的 N 条消息（多取一些以补偿过滤损失）
        const messages = await this.messageRepo.findRecentBySessionId(
            sessionId,
            maxMessages,
            userMessageId,
            { withFiles: true, withContents: true, onlyCurrentContent: true },
        );

        // 2. 内存中处理复杂的结构转换和过滤
        const context: MessageRecord[] = [];
        let isFirstUserMessage = true;

        // 数据库返回的是倒序（最新在前），处理时需要反转回正序
        const lastMessage = messages[0];
        for (const msg of messages.reverse()) {
            const transformed = this.transformContentStructure(msg, skipToolCalls, msg.id === lastMessage.id);
            if (transformed.length > 0) {
                context.push(...transformed);
                if (msg.role === 'user') isFirstUserMessage = false;
            }
        }

        return context;
    }

    /**
     * 获取最近的对话消息用于总结任务
     *
     * 获取最近的 3 条消息（不含系统消息），用于生成会话标题或其他总结任务。
     * 返回的消息按时间正序排列（从旧到新）。
     *
     * @param sessionId 会话 ID
     * @param skipToolCalls 是否跳过包含工具调用的轮次。默认为 true（总结任务通常不需要工具调用细节）
     * @returns 最多 3 条消息（不含系统消息），按时间正序排列（从旧到新）
     */
    async getRecentMessagesForSummary(
        sessionId: string,
        skipToolCalls: boolean = true,
    ): Promise<MessageRecord[]> {
        // 参数验证
        if (!sessionId || typeof sessionId !== 'string') {
            throw new Error(`无效的 session_id: ${sessionId}`);
        }

        // 复用现有方法获取最近的消息（不指定 end_message_id，默认获取到最新消息）
        const allMessages = await this.getConversationMessages(
            sessionId,
            undefined, // 不指定，获取最新消息
            3, // 限制 3 条
            skipToolCalls,
        );

        // 过滤掉系统消息（理论上不应该有，因为 getConversationMessages 不再返回系统消息）
        const nonSystemMessages = allMessages.filter((msg) => msg.role !== 'system');

        // getConversationMessages 返回的是倒序（最新在前），需要反转成正序（从旧到新）
        nonSystemMessages.reverse();

        // 只取最新的 3 条（已经是正序：从旧到新）
        return nonSystemMessages.slice(0, 3);
    }

    /**
     * 转换消息内容结构为模型可识别的格式
     */
    private transformContentStructure(msg: any, skipToolCalls: boolean, isNewUserMessage: boolean): MessageRecord[] {
        if (msg.role === 'assistant') {
            const turns: MessageRecord[] = [];

            for (const content of msg.contents || []) {
                const additionalKwargs = content.additionalKwargs || {};
                const toolCalls = additionalKwargs.tool_calls;

                // 如果跳过工具调用且当前轮次包含工具调用，则跳过整个轮次
                if (skipToolCalls && toolCalls) continue;

                const baseMsg: MessageRecord = {
                    role: 'assistant',
                    content: content.content || '',
                };


                baseMsg.toolCalls = toolCalls;


                turns.push(baseMsg);

                // 处理工具响应
                if (!skipToolCalls && additionalKwargs.tool_calls_response) {
                    turns.push(...additionalKwargs.tool_calls_response.map((res: any) => ({
                        role: 'tool',
                        ...res,
                    })));
                }
            }
            return turns;
        } else {
            // 处理用户消息
            const activeContent = msg.contents?.[0];
            if (!activeContent) return [{ role: 'user', content: '' }];

            const textParts: MessagePart[] = [{ type: 'text', text: activeContent.content || '' }];

            // 追加知识库引用信息
            let metadata = {}
            if (isNewUserMessage) {
                const kbInfo = this.appendKbReferenceInfo(activeContent);
                if (kbInfo) {
                    textParts.push({ type: 'text', text: kbInfo });
                    metadata['referencedKbs'] = kbInfo
                }
            }

            // 处理附件文件
            if (msg.files && Array.isArray(msg.files)) {
                msg.files.forEach((file: any, index: number) => {
                    if (file.fileType === 'image') {
                        const imagePart = this.transformImageFile(file);
                        if (imagePart) textParts.push(imagePart);
                    } else if (file.fileType === 'text') {
                        const textPart = this.transformTextFile(file, index);
                        if (textPart) textParts.push(textPart);
                    }
                });
            }

            return [{
                role: 'user',
                content: textParts.length === 1 ? textParts[0].text : textParts,
                metadata: metadata
            }];
        }
    }

    /**
     * 追加知识库引用信息
     */
    private appendKbReferenceInfo(activeContent: any): string | null {
        try {
            const referencedKbs = activeContent.additionalKwargs?.referencedKbs;
            if (!referencedKbs || !Array.isArray(referencedKbs) || referencedKbs.length === 0) {
                return null;
            }

            const lines = ['【当前引用的知识库】'];
            referencedKbs.forEach((kb: any) => {
                const name = kb.name || '未知';
                const id = kb.id || 'unknown';
                const desc = kb.description || '';
                let line = `- 名称：${name}, ID: ${id}`;
                if (desc) line += `, 简介：${desc}`;
                lines.push(line);
            });

            return '\n' + lines.join('\n');
        } catch (error) {
            this.logger.error('Failed to append KB reference info', error);
            return null;
        }
    }

    /**
     * 转换图片文件
     */
    private transformImageFile(file: any): any | null {
        if (!file.url) return null;

        try {
            // 1. 从 URL 还原物理路径
            const physicalPath = this.uploadPathService.getPathFromWebUrl(file.url);
            if (!physicalPath || !fs.existsSync(physicalPath)) {
                this.logger.warn(`Image file not found at path: ${physicalPath}`);
                return null;
            }

            // 2. 读取文件内容并转换为 Base64
            const imageBuffer = fs.readFileSync(physicalPath);
            const base64Data = imageBuffer.toString('base64');

            // 3. 推断 MIME 类型
            const ext = path.extname(physicalPath).toLowerCase();
            let mimeType = 'image/jpeg'; // 默认类型
            switch (ext) {
                case '.png':
                    mimeType = 'image/png';
                    break;
                case '.gif':
                    mimeType = 'image/gif';
                    break;
                case '.webp':
                    mimeType = 'image/webp';
                    break;
                case '.bmp':
                    mimeType = 'image/bmp';
                    break;
                case '.tiff':
                case '.tif':
                    mimeType = 'image/tiff';
                    break;
            }

            // 4. 构造 Data URI
            const dataUri = `data:${mimeType};base64,${base64Data}`;

            return {
                type: 'image_url',
                image_url: { url: dataUri },
            };
        } catch (error: any) {
            this.logger.error(`Failed to transform image file: ${error.message}`);
            return null;
        }
    }

    /**
     * 转换文本文件
     */
    private transformTextFile(file: any, index: number): any | null {
        const fileName = file.fileName || 'unknown';
        const content = file.content || '';
        const fileText = `\n\n<ATTACHMENT_FILE>\n` +
            `<FILE_INDEX>File ${index}</FILE_INDEX>\n` +
            `<FILE_NAME>${fileName}</FILE_NAME>\n` +
            `<FILE_CONTENT>\n${content}\n</FILE_CONTENT>\n` +
            `</ATTACHMENT_FILE>\n`;

        return { type: 'text', text: fileText };
    }
}
