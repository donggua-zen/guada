import { Injectable, Logger } from '@nestjs/common';
import { OpenAIAdapter } from './adapters/openai.adapter';
import { GeminiAdapter } from './adapters/gemini.adapter';
import { LLMAdapter } from './adapters/base.adapter';
import { LLMCompletionParams } from './types/llm.types';

@Injectable()
export class LLMService {
    private readonly logger = new Logger(LLMService.name);
    private adapters: Map<string, LLMAdapter> = new Map();

    constructor(
        private openAIAdapter: OpenAIAdapter,
        private geminiAdapter: GeminiAdapter
    ) {
        // 注册适配器
        this.adapters.set('openai', openAIAdapter);
        this.adapters.set('openai-response', openAIAdapter);
        this.adapters.set('gemini', geminiAdapter);
    }

    /**
     * 统一的补全执行方法（支持流式和非流式）
     */
    completions(params: LLMCompletionParams): Promise<any> | AsyncGenerator<any, void, unknown> {
        const protocol = params.modelConfig?.provider?.protocol || 'openai';
        const adapter = this.adapters.get(protocol);

        if (!adapter) {
            throw new Error(`Unsupported protocol: ${protocol}`);
        }

        const isStream = params.stream === true;
        const iterator = adapter.chatCompletion({
            ...params,
            providerConfig: params.modelConfig?.provider,
        });

        if (isStream) {
            return iterator as AsyncGenerator<any, void, unknown>;
        } else {
            return (async () => {
                const result = await (iterator as AsyncIterator<any>).next();
                return result.value;
            })();
        }
    }
}
