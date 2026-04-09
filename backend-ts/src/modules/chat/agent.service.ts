import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { SessionRepository } from '../../common/database/session.repository';
import { MessageRepository } from '../../common/database/message.repository';
import { MessageContentRepository } from '../../common/database/message-content.repository';
import { CharacterRepository } from '../../common/database/character.repository';
import { LLMService } from './llm.service';
import { ToolOrchestrator } from '../tools/tool-orchestrator.service';
import { MemoryManagerService } from './memory.service';
import { MessageRecord, LLMResponseChunk } from './types/llm.types';

/**
 * 思考时间信息（简单数据容器）
 * 
 * 用于保存消息内容的思考开始和结束时间，避免依赖 MessageContent 的临时属性。
 * 这样可以确保即使 messageContent 是重新查询的，思考时间信息也不会丢失。
 */
class ThinkingTimeInfo {
    thinkingStartedAt: Date | null = null;
    thinkingFinishedAt: Date | null = null;
}

@Injectable()
export class AgentService {
    private readonly logger = new Logger(AgentService.name);

    constructor(
        private sessionRepo: SessionRepository,
        private messageRepo: MessageRepository,
        private contentRepo: MessageContentRepository,
        private characterRepo: CharacterRepository,
        private toolOrchestrator: ToolOrchestrator,
        private memoryManager: MemoryManagerService,
        private llmService: LLMService,
    ) { }

    async *completions(
        sessionId: string,
        messageId: string,
        regenerationMode: string = 'overwrite',  // 再生模式：'overwrite' | 'multi_version' | 'append'
        assistantMessageId?: string,  // 现有助手消息 ID（用于 multi_version 模式）
        abortSignal?: AbortSignal,  // 中断信号（用于客户端断开连接时中止 LLM 请求）
    ) {
        const session = await this.sessionRepo.findById(sessionId);
        if (!session) throw new Error('Session not found');

        await this.sessionRepo.updateLastActiveAt(sessionId);

        // 1. 合并设置与构建上下文
        const mergedSettings = this.mergeSettings(session);
        const historyMessages = await this.memoryManager.getConversationMessages(
            sessionId,
            messageId,
            mergedSettings.maxMemoryLength || 20
        );
        this.logger.log(historyMessages);
        // 2. 构建工具执行上下文（与 Python 后端保持一致）
        const toolContext = {
            inject_params: { session_id: sessionId, user_id: session.userId },
            provider_configs: {
                mcp: { enabled_tools: true },
                local: { enabled_tools: true },
                memory: { enabled_tools: true },
                knowledge_base: { enabled_tools: historyMessages[historyMessages.length - 1]?.metadata?.referencedKbs ? true : false },
            },
            getProviderConfig: (ns: string) => {
                return toolContext.provider_configs[ns];
            },
        };

        // 3. 准备提示词和工具
        const systemPrompt = await this._buildSystemPrompt(mergedSettings, toolContext);
        const finalSystemPrompt = this.replaceVariables(systemPrompt || 'You are a helpful assistant.');
        const messages = [{ role: 'system', content: finalSystemPrompt }, ...historyMessages];
        const tools = await this.toolOrchestrator.getAllTools(toolContext);

        // 3. 处理再生模式（与 Python 后端保持一致）
        let assistantMessage: any;

        if (regenerationMode === 'overwrite' || regenerationMode === null) {
            // overwrite 模式：删除旧的助手消息，创建全新的
            this.logger.log(`Regeneration mode: overwrite, deleting old assistant messages for parent ${messageId}`);

            // 删除原有的助手消息（级联删除其内容）
            await this.messageRepo.deleteByParentId(messageId);

            // 创建新的助手消息
            assistantMessage = await this.messageRepo.create({
                sessionId,
                role: 'assistant',
                parentId: messageId,
            });

            this.logger.log(`Created new assistant message: ${assistantMessage.id}`);
        } else {
            // multi_version/append 模式：复用现有的助手消息
            if (!assistantMessageId) {
                throw new Error('assistantMessageId is required for non-overwrite regeneration mode');
            }

            this.logger.log(`Regeneration mode: ${regenerationMode}, reusing assistant message ${assistantMessageId}`);

            assistantMessage = await this.messageRepo.findById(assistantMessageId);
            if (!assistantMessage) {
                throw new Error(`Assistant message ${assistantMessageId} not found`);
            }
        }

        // 3. 多轮工具调用循环
        let needToContinue = true;
        const chatTurns: MessageRecord[] = [];
        const llm = this.llmService;

        // 防止无限循环的安全机制
        let iterationCount = 0;
        const MAX_ITERATIONS = 10;  // 最多 10 次迭代

        // 生成 turns_id（与 Python 后端保持一致）
        const turnsId = this.generateTurnsId();



        while (needToContinue) {
            iterationCount++;

            // 安全检查：超过最大迭代次数
            if (iterationCount > MAX_ITERATIONS) {
                this.logger.warn(`Agent loop exceeded maximum iterations (${MAX_ITERATIONS}), stopping...`);
                break;
            }

            this.logger.debug(`Agent iteration ${iterationCount}/${MAX_ITERATIONS}`);

            // 为当前轮次创建思考时间信息对象
            const currentTurnThinkingInfo = new ThinkingTimeInfo();

            // 每轮循环创建新的 MessageContent（与 Python 后端保持一致）
            const messageContent = await this.contentRepo.create({
                messageId: assistantMessage.id,
                turnsId: turnsId,  // 同一轮对话使用相同的 turnsId
                role: 'assistant',
                content: '',
                reasoningContent: null,
                metaData: { modelName: session.model?.modelName },
                additionalKwargs: {},
            });

            // 更新助手消息的 currentTurnsId
            await this.messageRepo.update(assistantMessage.id, {
                currentTurnsId: turnsId,
            });

            // Yield create 事件（每轮都发送，通知前端新的 contentId）
            yield {
                type: 'create',
                messageId: assistantMessage.id,
                turnsId: turnsId,
                contentId: messageContent.id,  // 每次迭代的 contentId 不同
                modelName: session.model?.modelName,
            };

            // 用于跟踪当前轮次的完整数据（包括错误信息）
            let currentChunk: MessageRecord = { role: 'assistant', content: '' };

            let streamError: Error | null = null;  // 记录流式过程中的错误

            try {
                const stream = llm.completions({
                    model: session.model?.modelName || 'gpt-3.5-turbo',
                    messages: [...messages, ...chatTurns],
                    tools,
                    temperature: mergedSettings.modelTemperature,
                    topP: mergedSettings.modelTopP,
                    frequencyPenalty: mergedSettings.modelFrequencyPenalty,  // 新增
                    maxTokens: session.model?.maxOutputTokens,  // 新增：从模型配置获取
                    modelConfig: session.model,  // 传递模型配置（包含供应商信息）
                    stream: true, // 显式开启流式
                    thinkingEnabled: mergedSettings.thinkingEnabled || false, // 显式传递思考模式开关
                    abortSignal,  // 传递中断信号
                });

                for await (const chunk of stream as AsyncGenerator<LLMResponseChunk>) {
                    // 增量累加逻辑（使用驼峰式命名）
                    if (chunk.content) currentChunk.content += chunk.content;
                    if (chunk.reasoningContent) {
                        // 记录思考开始时间（第一次收到 reasoning_content 时）
                        if (!currentTurnThinkingInfo.thinkingStartedAt) {
                            currentTurnThinkingInfo.thinkingStartedAt = new Date();
                            this.logger.debug('Thinking started');
                        }

                        if (currentChunk.reasoningContent === undefined) {
                            currentChunk.reasoningContent = chunk.reasoningContent;
                        } else
                            currentChunk.reasoningContent += chunk.reasoningContent;
                    }
                    if (chunk.toolCalls) {
                        // 记录思考结束时间（第一次收到 tool_calls 时）
                        this.recordThinkingFinished(currentTurnThinkingInfo, 'first tool_calls chunk');

                        this.accumulateToolCalls(currentChunk, chunk.toolCalls);
                        this.logger.log(`Accumulated ${chunk.toolCalls.length} tool calls`);
                    }

                    if (chunk.content) {
                        // 记录思考结束时间（第一次收到 content 时）
                        this.recordThinkingFinished(currentTurnThinkingInfo, 'first content chunk');
                    }

                    // 累加 usage 和 finishReason（用于最后保存到数据库）
                    if (chunk.usage) {
                        currentChunk.usage = chunk.usage;
                    }
                    if (chunk.finishReason) {
                        currentChunk.finishReason = chunk.finishReason;
                    }

                    // 实时 Yield 给前端（过滤空 chunk）
                    // 只有在有实际内容、推理内容、工具调用、结束原因或 usage 时才 yield
                    if (
                        chunk.content ||
                        chunk.reasoningContent ||
                        chunk.toolCalls ||
                        chunk.finishReason ||
                        chunk.usage
                    ) {
                        // 更严谨的类型判断：确保 msg 不为 null
                        let eventType: string;
                        let msg: string | null = null;

                        if (chunk.finishReason) {
                            eventType = 'finish';
                        } else if (chunk.reasoningContent) {
                            eventType = 'think';
                            msg = chunk.reasoningContent;
                        } else if (chunk.content) {
                            eventType = 'text';
                            msg = chunk.content;
                        } else if (chunk.toolCalls) {
                            eventType = 'tool_call';
                        } else if (chunk.usage) {
                            // 只有 usage 没有内容的情况，跳过不发送
                            continue;
                        } else {
                            // 其他未知情况，跳过
                            continue;
                        }

                        yield {
                            type: eventType,
                            msg,  // 确保 msg 有值或是 null（finish/tool_call 时）
                            toolCalls: chunk.toolCalls,
                            finishReason: chunk.finishReason,
                            usage: chunk.usage,
                        };
                    }

                    // 处理结束原因
                    if (chunk.finishReason === 'tool_calls') {
                        // 兜底：如果直到 finish 都没有记录结束时间（只有思考没有内容），在此记录
                        this.recordThinkingFinished(currentTurnThinkingInfo, 'finish_reason (fallback)');

                        this.logger.log('Tool calls:', currentChunk.toolCalls);
                        const toolResponses = await this.toolOrchestrator.executeBatch(
                            currentChunk.toolCalls.map((tc: any) => ({

                                id: tc.id,
                                name: tc.name,
                                arguments: JSON.parse(tc.arguments) || {},
                            })),
                            toolContext  // 传递完整的工具执行上下文
                        );

                        // Yield tool_calls_response 事件（与 Python 后端保持一致）
                        yield {
                            type: 'tool_calls_response',
                            toolCallsResponse: toolResponses.map(tr => ({
                                role: tr.role,
                                name: tr.name,
                                content: tr.content,
                                toolCallId: tr.toolCallId,
                            })),
                            usage: chunk.usage,
                        };

                        chatTurns.push(currentChunk);
                        chatTurns.push(...toolResponses.map(tr => ({
                            role: tr.role as any,
                            name: tr.name,
                            content: tr.content,
                            toolCallId: tr.toolCallId,
                        })));

                        currentChunk.toolCallsResponse = toolResponses.map(tr => ({
                            role: tr.role,
                            name: tr.name,
                            content: tr.content,
                            toolCallId: tr.toolCallId,
                        }));

                    } else if (chunk.finishReason) {
                        needToContinue = false;
                    }
                }
            } catch (error) {
                // 捕获流式过程中的异常（包括 AbortError、APIError 等）
                streamError = error instanceof Error ? error : new Error(String(error));
                this.logger.error(`Stream error in iteration ${iterationCount}:`, streamError);

                // 根据错误类型设置 finishReason 和 error 信息
                if (streamError.name === 'AbortError' || streamError.message.includes('abort')) {
                    // 用户主动中止（客户端断开连接）
                    currentChunk.finishReason = 'user_abort';
                    currentChunk.error = 'User aborted the request';
                    this.logger.debug('User stopped generation (AbortError)');

                    // 优化：记录思考结束时间
                    this.recordThinkingFinished(currentTurnThinkingInfo, 'user abort');
                } else if (streamError.message.includes('timed out') || streamError.message.includes('timeout')) {
                    // 超时错误
                    currentChunk.finishReason = 'timeout';
                    currentChunk.error = streamError.message;
                    this.logger.warn('LLM request timed out');

                    // 记录思考结束时间
                    this.recordThinkingFinished(currentTurnThinkingInfo, 'timeout');
                } else {
                    // 其他 API 错误或运行时错误
                    currentChunk.finishReason = 'error';
                    currentChunk.error = streamError.message;
                    this.logger.error(`LLM API error: ${streamError.message}`);

                    // 记录思考结束时间
                    this.recordThinkingFinished(currentTurnThinkingInfo, 'api error');

                    // 向前端发送错误事件
                    yield {
                        type: 'finish',
                        finishReason: 'error',
                        error: streamError.message,
                        usage: currentChunk.usage,
                    };

                }
                // 发生错误时停止继续迭代
                needToContinue = false;
            } finally {
                // 无论成功、失败还是中止，都要保存当前已生成的内容
                // 计算思考时长并保存到数据库
                const thinkingDurationMs = this.calculateThinkingDuration(currentTurnThinkingInfo);

                // 更新已存在的消息内容（而不是创建新的）
                // 注意：即使发生错误，也要保存已生成的部分内容
                await this.updateMessageContent(
                    messageContent.id,
                    currentChunk,
                    session.model?.modelName,
                    thinkingDurationMs  // 传入思考时长
                );

                this.logger.debug(`Iteration ${iterationCount} cleanup completed. Finish reason: ${currentChunk.finishReason}`);
            }

            if (!needToContinue) {
                chatTurns.push(currentChunk);
            }
        }
    }

    /**
     * 生成 turns_id（使用 UUID v4，与 Python 后端的 ulid 类似）
     */
    private generateTurnsId(): string {
        return uuidv4();
    }

    /**
     * 累加工具调用参数（处理流式分片）
     */
    private accumulateToolCalls(target: any, deltaCalls: any[]) {
        if (!target.toolCalls) target.toolCalls = [];
        for (const delta of deltaCalls) {
            const index = delta.index;
            if (!target.toolCalls[index]) {
                target.toolCalls[index] = { id: delta.id, name: delta.name || '', arguments: delta.arguments || '' };
            }

            const tc = target.toolCalls[index];
            if (delta?.arguments) tc.arguments += delta.arguments;
        }
    }

    /**
     * 构建完整的系统提示词（包含工具注入）
     * 
     * @param mergedSettings 合并后的设置
     * @param context 工具执行上下文
     * @returns 完整的系统提示词
     */
    private async _buildSystemPrompt(
        mergedSettings: any,
        context: any,
    ): Promise<string> {
        // 1. 基础系统提示词
        let systemPrompt = mergedSettings.systemPrompt || '';

        // 2. 获取所有工具的提示词注入
        const toolPrompts: string[] = [];

        // 从 ToolOrchestrator 获取所有 Provider 的提示词
        const prompts = await this.toolOrchestrator.getAllToolPrompts(context);
        if (prompts) {
            toolPrompts.push(prompts);
        }

        // 3. 合并提示词
        if (toolPrompts.length > 0) {
            systemPrompt += '\n\n' + toolPrompts.join('\n\n');
        }

        this.logger.debug(`Built system prompt with ${toolPrompts.length} tool injections`);
        return systemPrompt;
    }

    /**
     * 替换系统提示词中的变量
     */
    private replaceVariables(prompt: string): string {
        return prompt.replace('{time}', new Date().toISOString());
    }

    /**
     * 记录思考结束时间
     * 
     * @param currentTurnThinkingInfo 当前轮次的思考时间信息对象
     * @param reason 记录原因（用于日志）
     */
    private recordThinkingFinished(
        currentTurnThinkingInfo: ThinkingTimeInfo,
        reason: string
    ): void {
        if (
            currentTurnThinkingInfo.thinkingStartedAt &&
            !currentTurnThinkingInfo.thinkingFinishedAt
        ) {
            currentTurnThinkingInfo.thinkingFinishedAt = new Date();
            this.logger.debug(`Thinking finished at ${reason}`);
        }
    }

    /**
     * 计算思考时长（毫秒）
     * 
     * @param currentTurnThinkingInfo 当前轮次的思考时间信息对象
     * @returns 思考时长（毫秒），如果时间不完整则返回 null
     */
    private calculateThinkingDuration(currentTurnThinkingInfo: ThinkingTimeInfo): number | null {
        if (
            currentTurnThinkingInfo.thinkingStartedAt &&
            currentTurnThinkingInfo.thinkingFinishedAt
        ) {
            const durationMs = Math.floor(
                (currentTurnThinkingInfo.thinkingFinishedAt.getTime() -
                    currentTurnThinkingInfo.thinkingStartedAt.getTime())
            );
            this.logger.log(`Thinking duration calculated: ${durationMs}ms`);
            return durationMs;
        } else {
            this.logger.warn(
                `Thinking timestamps incomplete. ` +
                `Has start: ${currentTurnThinkingInfo.thinkingStartedAt !== null}, ` +
                `Has finish: ${currentTurnThinkingInfo.thinkingFinishedAt !== null}`
            );
            return null;
        }
    }

    /**
     * 更新消息内容到数据库（在流式输出完成后调用）
     */
    private async updateMessageContent(
        contentId: string,
        chunk: any,
        modelName?: string,
        thinkingDurationMs?: number | null  // 新增参数：思考时长
    ) {
        try {
            // 构建 meta_data，添加思考时长、usage 和错误信息
            const metaData: any = {
                modelName: modelName,  // 驼峰式
                finishReason: chunk.finishReason  // 驼峰式
            };

            // 如果有错误信息，保存到 meta_data（与 Python 后端保持一致）
            if (chunk.error) {
                metaData.error = chunk.error;
                this.logger.warn(`Error saved to metaData: ${chunk.error}`);
            }

            // 如果有思考时长，保存到 meta_data
            if (thinkingDurationMs !== null && thinkingDurationMs !== undefined) {
                metaData.thinkingDurationMs = thinkingDurationMs;
                this.logger.log(`Thinking duration saved to metaData: ${thinkingDurationMs}ms`);
            }

            // 如果有 usage 信息，保存到 meta_data
            if (chunk.usage) {
                metaData.usage = chunk.usage;
                this.logger.log(
                    `Tokens saved: prompt=${chunk.usage.promptTokens}, ` +
                    `completion=${chunk.usage.completionTokens}, ` +
                    `total=${chunk.usage.totalTokens}`
                );
            }

            // 更新已存在的消息内容
            await this.contentRepo.update(contentId, {
                content: chunk.content || '',
                reasoningContent: chunk.reasoningContent,
                metaData,
                additionalKwargs: chunk.toolCalls ? {
                    'toolCalls': chunk.toolCalls || {},
                    'toolCallsResponse': chunk.toolCallsResponse || {},
                } : undefined,
            });

            this.logger.log(`Message content updated: ${contentId}, finishReason: ${chunk.finishReason}`);
        } catch (error) {
            this.logger.error('Failed to update message content', error);
            // 注意：即使保存失败，也不应该抛出异常，避免影响上层逻辑
        }
    }

    /**
     * 合并会话与角色设置：会话设置优先，未设置的字段从角色继承
     */
    private mergeSettings(session: any) {
        const sessionSettings = session.settings || {};
        const characterSettings = session.character?.settings || {};

        return {
            ...characterSettings,
            ...sessionSettings,
            maxMemoryLength: sessionSettings.maxMemoryLength ?? characterSettings.maxMemoryLength ?? 20,
            systemPrompt: sessionSettings.systemPrompt ?? characterSettings.systemPrompt,
            modelTemperature: sessionSettings.modelTemperature ?? characterSettings.modelTemperature,
            modelTopP: sessionSettings.modelTopP ?? characterSettings.modelTopP,
        };
    }
}
