import { Injectable, Logger } from '@nestjs/common';
import { IToolProvider, ToolCallRequest, ToolCallResponse } from '../interfaces/tool-provider.interface';
import { buildOpenAITool, SimpleToolDef } from '../utils/tool-builder';

@Injectable()
export class TimeToolProvider implements IToolProvider {
    private readonly logger = new Logger(TimeToolProvider.name);
    public readonly namespace = 'time';

    constructor() { }

    private readonly toolsConfig: SimpleToolDef[] = [
        // 时间工具不提供实际的函数调用，只提供提示词注入
        // 这里定义一个虚拟工具，但不会被实际执行
    ];

    async getToolsNamespaced(enabledTools: Record<string, any> | boolean, injectParams: Record<string, any>): Promise<any[]> {
        // 时间工具不需要返回任何可调用工具，因为它只是注入提示词
        return [];
    }

    async executeWithNamespace(request: ToolCallRequest, injectParams?: Record<string, any>): Promise<ToolCallResponse> {
        // 时间工具不执行任何实际操作
        this.logger.warn(`尝试执行时间工具 ${request.name}，但该工具仅提供提示词注入`);

        return {
            toolCallId: request.id,
            role: 'tool',
            name: request.name,
            content: '时间工具仅用于提示词注入，不支持直接调用',
            isError: true,
        };
    }

    async getPrompt(injectParams?: Record<string, any>): Promise<string> {
        try {
            const now = new Date();
            const currentTime = now.toLocaleString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            });

            const promptParts: string[] = [];

            promptParts.push('【当前时间信息】');
            promptParts.push(`当前时间是：${currentTime}`);
            promptParts.push('');
            promptParts.push('请注意：在与用户对话时，如果需要提及时间相关信息，请使用上述提供的准确时间。');
            promptParts.push('例如：当用户询问"现在几点了？"或"今天是什么日期？"时，请基于以上时间信息作答。');

            return promptParts.join('\n');
        } catch (error: any) {
            this.logger.error(`获取时间提示词失败：${error.message}`);
            return ''; // 出错时返回空字符串，不影响对话
        }
    }
}