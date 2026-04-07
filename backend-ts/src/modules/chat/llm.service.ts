import { Injectable, Logger } from '@nestjs/common';
import { OpenAI, APIError } from 'openai';
import { MessageRecord } from './memory.service';

@Injectable()
export class LLMService {
    private readonly logger = new Logger(LLMService.name);

    /**
     * 创建 OpenAI 客户端（支持自定义配置）
     */
    private createClient(modelConfig?: any) {
        // 如果提供了模型配置，使用它；否则使用环境变量
        const baseURL = modelConfig?.provider?.apiUrl
            || process.env.OPENAI_BASE_URL
            || 'https://api.openai.com/v1';

        const apiKey = modelConfig?.provider?.apiKey
            || process.env.OPENAI_API_KEY
            || 'sk-placeholder';

        // 详细日志，便于调试
        this.logger.debug(`Using model provider: ${modelConfig?.provider?.name || 'default'}`);
        this.logger.debug(`Base URL: ${baseURL}`);
        this.logger.debug(`API Key: ${apiKey ? '***' + apiKey.slice(-4) : 'NOT SET'}`);
        this.logger.debug(`API Key length: ${apiKey?.length || 0}`);

        return new OpenAI({
            baseURL,
            apiKey,
        });
    }

    /**
     * 统一的补全执行核心方法
     */
    private async *executeCompletion(params: {
        model: string;
        messages: MessageRecord[];
        temperature?: number;
        top_p?: number;
        frequency_penalty?: number;
        tools?: any[];
        thinking?: boolean;
        max_tokens?: number;
        modelConfig?: any;
        stream: boolean;
        abortSignal?: AbortSignal;  // 新增：中断信号
    }) {
        const client = this.createClient(params.modelConfig);

        // 过滤消息字段，只保留 role, content, reasoning_content
        const filterMessages = params.messages.map(msg => {
            const filtered: any = {
                role: msg.role,
                content: msg.content || '',
            };

            if (msg.reasoningContent !== undefined) {
                filtered.reasoning_content = msg.reasoningContent;
            }

            if (msg.toolCallId !== undefined) {
                filtered.tool_call_id = msg.toolCallId;
            }

            if (msg.toolCalls !== undefined) {
                filtered.tool_calls = []
                let index = 0;
                for (const toolCall of msg.toolCalls) {
                    filtered.tool_calls.push({
                        id: toolCall.id,
                        index: index++,
                        type: 'function',
                        function: {
                            name: toolCall.name,
                            arguments: toolCall.arguments,
                        },
                    });
                }
            }

            return filtered;
        });

        // this.logger.debug('=== LLM Request Messages ===');
        // this.logger.debug(filterMessages);

        // 构建请求参数
        const requestParams: any = {
            model: params.model,
            messages: filterMessages,
            stream: params.stream,
            timeout: 60000,
        };

        if (params.temperature !== undefined) requestParams.temperature = params.temperature;
        if (params.top_p !== undefined) requestParams.top_p = params.top_p;
        if (params.frequency_penalty !== undefined) requestParams.frequency_penalty = params.frequency_penalty;
        if (params.max_tokens !== undefined) requestParams.max_tokens = params.max_tokens;

        if (params.tools && params.tools.length > 0) {
            requestParams.tools = params.tools;
            requestParams.tool_choice = 'auto';
        }

        if (params.thinking) {
            // 某些模型不支持 enable_thinking，如果报错可以尝试注释掉这一行
            requestParams.enable_thinking = params.thinking;
        }

        // 打印请求参数（便于调试）
        this.logger.debug('=== LLM Request Parameters ===');
        this.logger.debug(`Model: ${params.model}`);
        this.logger.debug(`Temperature: ${params.temperature}`);
        this.logger.debug(`Top P: ${params.top_p}`);
        this.logger.debug(`Frequency Penalty: ${params.frequency_penalty}`);
        this.logger.debug(`Max Tokens: ${params.max_tokens}`);
        this.logger.debug(`Thinking: ${params.thinking}`);
        this.logger.debug(`Tools: ${params.tools?.length || 0} tools`);
        this.logger.debug(`Messages (${params.messages.length}):`);
        filterMessages.forEach((msg, index) => {
            this.logger.debug(`  [${index}] role=${msg.role}, content_length=${msg.content?.length || 0}`);
            if (msg.content && msg.content.length < 200) {
                this.logger.debug(`       content="${msg.content}"`);
            }
        });
        this.logger.debug('================================');

        let response: any = null;

        try {
            response = await client.chat.completions.create(
                requestParams,  // 第一个参数：请求体
                {
                    signal: params.abortSignal,  // 第二个参数：请求选项（包含中断信号）
                }
            );

            if (params.stream) {
                for await (const chunk of response) {
                    const choice = chunk.choices?.[0];
                    if (!choice) continue;

                    const delta = choice.delta;
                    const responseChunk: any = {
                        content: delta?.content || null,
                        reasoningContent: (delta as any)?.reasoning_content || null,
                        finishReason: choice.finish_reason || null,
                        toolCalls: undefined,
                        usage: null,
                    };

                    if ((chunk as any).usage) {
                        responseChunk.usage = {
                            promptTokens: (chunk as any).usage.prompt_tokens,
                            completionTokens: (chunk as any).usage.completion_tokens,
                            totalTokens: (chunk as any).usage.total_tokens,
                        };
                    }

                    if (delta?.tool_calls && delta.tool_calls.length > 0) {
                        responseChunk.toolCalls = delta.tool_calls.map((tc: any) => ({
                            id: tc.id,
                            index: tc.index,
                            type: 'function',
                            name: tc.function?.name,
                            arguments: tc.function?.arguments,
                        }));
                    }

                    if (
                        responseChunk.content ||
                        responseChunk.reasoningContent ||
                        responseChunk.finishReason ||
                        responseChunk.toolCalls ||
                        responseChunk.usage
                    ) {
                        yield responseChunk;
                    }
                }
            } else {
                const choice = response.choices?.[0];
                if (!choice || !choice.message) {
                    throw new Error('Invalid response from LLM API');
                }

                const message = choice.message;
                const result: any = {
                    content: message.content || null,
                    reasoningContent: (message as any).reasoning_content || null,
                    finishReason: choice.finish_reason || null,
                    additionalKwargs: {},
                    usage: null,
                };

                if (response.usage) {
                    result.usage = {
                        promptTokens: response.usage.prompt_tokens,
                        completionTokens: response.usage.completion_tokens,
                        totalTokens: response.usage.total_tokens,
                    };
                }

                if (message.tool_calls && message.tool_calls.length > 0) {
                    result.additionalKwargs.toolCalls = message.tool_calls.map((tc: any) => ({
                        id: tc.id,
                        index: tc.index,
                        type: tc.type || 'function',
                        name: tc.function?.name,
                        arguments: tc.function?.arguments,
                    }));
                }

                yield result;
            }
        } catch (error) {
            this.logger.error(`LLM API error (${params.stream ? 'stream' : 'non-stream'}):`, error);

            if (error instanceof APIError) {
                throw new Error(`LLM API Error: ${error.status} - ${error.message}`);
            } else if (error instanceof Error) {
                if (error.name === 'AbortError') {
                    throw new Error('LLM request timed out (60s)');
                }
                throw error;
            } else {
                throw new Error('Unknown LLM error occurred');
            }
        } finally {
            if (response && typeof response.close === 'function') {
                try {
                    await response.close();
                } catch (e) {
                    this.logger.warn('Failed to close LLM response:', e);
                }
            }
        }
    }

    /**
     * 流式补全接口
     */
    completions(params: {
        model: string;
        messages: MessageRecord[];
        temperature?: number;
        top_p?: number;
        frequency_penalty?: number;
        tools?: any[];
        thinking?: boolean;
        max_tokens?: number;
        modelConfig?: any;
        stream: true;
        abortSignal?: AbortSignal;  // 新增：中断信号
    }): AsyncGenerator<any, void, unknown>;

    /**
     * 非流式补全接口
     */
    completions(params: {
        model: string;
        messages: MessageRecord[];
        temperature?: number;
        top_p?: number;
        frequency_penalty?: number;
        tools?: any[];
        thinking?: boolean;
        max_tokens?: number;
        modelConfig?: any;
        stream?: false;
        abortSignal?: AbortSignal;  // 新增：中断信号
    }): Promise<any>;

    /**
     * 统一的补全执行方法（支持流式和非流式）
     */
    completions(params: {
        model: string;
        messages: MessageRecord[];
        temperature?: number;
        top_p?: number;
        frequency_penalty?: number;
        tools?: any[];
        thinking?: boolean;
        max_tokens?: number;
        modelConfig?: any;
        stream?: boolean;
        abortSignal?: AbortSignal;  // 新增：中断信号
    }): Promise<any> | AsyncGenerator<any, void, unknown> {
        const isStream = params.stream === true;
        const iterator = this.executeCompletion({ ...params, stream: isStream });

        if (isStream) {
            // 返回异步生成器以支持流式处理
            return (async function* () {
                for await (const chunk of iterator) {
                    yield chunk;
                }
            })() as AsyncGenerator<any, void, unknown>;
        } else {
            // 非流式：等待结果并返回
            return (async () => {
                const result = await iterator.next();
                return result.value;
            })();
        }
    }
}
