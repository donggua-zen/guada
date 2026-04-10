import { Injectable, Logger } from '@nestjs/common';
import { IToolProvider, ToolCallRequest, ToolCallResponse } from '../interfaces/tool-provider.interface';
import { PrismaService } from '../../../common/database/prisma.service';
import { InternalToolDefinition } from '../../chat/types/llm.types';

@Injectable()
export class MemoryToolProvider implements IToolProvider {
    private readonly logger = new Logger(MemoryToolProvider.name);
    public readonly namespace = 'memory';

    constructor(private prisma: PrismaService) { }

    private readonly toolsConfig: InternalToolDefinition[] = [
        // {
        //     name: 'long_term__view',
        //     description: '查看长期记忆（支持按类型筛选：factual 或 soul）',
        //     parameters: {
        //         type: 'object',
        //         properties: {
        //             memory_type: {
        //                 type: 'string',
        //                 enum: ['factual', 'soul'],
        //                 description: '长期记忆类型'
        //             },
        //         },
        //         required: ['memory_type'],
        //     },
        // },
        {
            name: 'memory__long_term__edit',
            description: 'Upsert 长期记忆（按类型编辑或自动创建）',
            parameters: {
                type: 'object',
                properties: {
                    memory_type: {
                        type: 'string',
                        enum: ['factual', 'soul'],
                        description: '长期记忆类型'
                    },
                    content: { type: 'string', description: '记忆内容' },
                    write_mode: {
                        type: 'string',
                        enum: ['append', 'overwrite'],
                        description: '写入模式：追加或覆盖'
                    },
                },
                required: ['memory_type', 'content'],
            },
        },
    ];

    async getToolsNamespaced(enabledTools: Record<string, any> | boolean, injectParams: Record<string, any>): Promise<any[]> {
        if (enabledTools === false) return [];
        // 直接返回扁平化的工具定义，由 adapter 进行转换
        return this.toolsConfig;
    }

    async executeWithNamespace(request: ToolCallRequest, injectParams?: Record<string, any>): Promise<ToolCallResponse> {
        // 1. 统一剥离命名空间前缀
        const coreName = request.name.replace(`${this.namespace}__`, '');

        // 2. 建立工具名到处理函数的映射
        const handlers: Record<string, (args: any, params?: Record<string, any>) => Promise<string>> = {
            'long_term__view': this.handleLongTermView.bind(this),
            'long_term__edit': this.handleLongTermEdit.bind(this),
        };

        const handler = handlers[coreName];

        try {
            if (!handler) {
                throw new Error(`未知工具：${request.name}`);
            }
            const content = await handler(request.arguments, injectParams);

            return {
                toolCallId: request.id,
                role: 'tool',
                name: request.name,
                content,
                isError: false,
            };
        } catch (error: any) {
            this.logger.error(`Error executing Memory tool ${coreName}`, error);
            return {
                toolCallId: request.id,
                role: 'tool',
                name: request.name,
                content: `Error: ${error.message}`,
                isError: true,
            };
        }
    }

    async getPrompt(injectParams?: Record<string, any>): Promise<string> {
        try {
            // 从注入参数中获取 session_id
            const sessionId = injectParams?.session_id || 'unknown';

            // 获取所有长期记忆（不限制数量）
            const longTermMemories = await this.getLongTermMemories(sessionId);

            const promptParts: string[] = [];

            // ========== 第一部分：长期记忆注入 ==========
            if (longTermMemories.length > 0) {
                promptParts.push('【重要记忆】');

                // 按类型分组展示
                const factualMemories = longTermMemories.filter(m => m.memoryType === 'factual');
                const soulMemories = longTermMemories.filter(m => m.memoryType === 'soul');

                promptParts.push('\n### 事实性记忆 (FACTUAL)');
                promptParts.push('这些是核心事实知识库，包括用户偏好、重要决策、项目状态等关键信息：');
                if (factualMemories.length > 0) {
                    factualMemories.forEach((memory, index) => {
                        promptParts.push(`${index + 1}. ${memory.content}`);
                    });
                } else {
                    promptParts.push('目前没有事实性记忆');
                }

                promptParts.push('\n### 人格定义 (SOUL)');
                promptParts.push('这些定义了 AI 的角色定位、语言风格和行为规则：');
                if (soulMemories.length > 0) {
                    soulMemories.forEach((memory, index) => {
                        promptParts.push(`${index + 1}. ${memory.content}`);
                    });
                } else {
                    promptParts.push('目前没有人格定义记忆');
                }
            }

            // ========== 第二部分：工具使用说明 ==========
            promptParts.push('\n【记忆工具使用说明】');
            const toolInstructions = `
你拥有以下记忆管理工具，可以主动调用它们来编辑长期记忆：

### 1. 编辑长期记忆 (memory__long_term__edit)
**用途**: 添加、更新或删除长期记忆

**何时使用**:
- 用户提供了新的个人信息或偏好时
- 需要更新过时的事实信息时
- 需要调整 AI 的行为规则或角色设定时

**使用建议**:
1. **选择合适的写入模式**: 如果需要保留原有信息，使用 'append'；如果需要完全替换，使用 'overwrite'
2. **保持记忆简洁**: 记忆内容应该简洁明了，便于后续检索和使用
3. **及时更新**: 当发现记忆内容过时或不准确时，应及时更新
4. **结构化保存**: 记忆内容应该结构化保存
`;
            promptParts.push(toolInstructions);

            return promptParts.join('\n');
        } catch (error: any) {
            this.logger.error(`获取记忆提示词失败：${error.message}`);
            return ''; // 出错时返回空字符串，不影响对话
        }
    }

    private async getLongTermMemories(sessionId: string): Promise<any[]> {
        try {
            const memories = await this.prisma.memory.findMany({
                where: {
                    sessionId,
                    category: 'long_term',
                },
                orderBy: [
                    { importance: 'desc' },
                    { createdAt: 'desc' },
                ],
            });

            return memories.map(memory => ({
                id: memory.id,
                content: memory.content,
                memoryType: memory.memoryType,
                importance: memory.importance,
                createdAt: memory.createdAt,
            }));
        } catch (error: any) {
            this.logger.error(`获取长期记忆失败：${error.message}`);
            return [];
        }
    }

    private async handleLongTermView(args: any, injectParams?: Record<string, any>): Promise<string> {
        const sessionId = injectParams?.session_id;
        if (!sessionId) return '❌ 错误：缺少 session_id 注入参数';

        const memories = await this.prisma.memory.findMany({
            where: {
                sessionId,
                category: 'long_term',
                memoryType: args.memory_type,
            },
            orderBy: [{ importance: 'desc' }, { createdAt: 'desc' }],
        });

        if (memories.length === 0) {
            return `❌ 未找到${args.memory_type}类型的长期记忆`;
        }

        return memories.map((m, i) => `${i + 1}. ${m.content}`).join('\n');
    }

    private async handleLongTermEdit(args: any, injectParams?: Record<string, any>): Promise<string> {
        const sessionId = injectParams?.session_id;
        if (!sessionId) return '❌ 错误：缺少 session_id 注入参数';

        const existing = await this.prisma.memory.findFirst({
            where: {
                sessionId,
                category: 'long_term',
                memoryType: args.memory_type,
            },
        });

        const writeMode = args.write_mode || 'append';
        let finalContent = args.content;

        if (existing && writeMode === 'append') {
            finalContent = `${existing.content}\n${args.content}`;
            await this.prisma.memory.update({
                where: { id: existing.id },
                data: { content: finalContent },
            });
        } else {
            // 先查询是否存在
            const existing = await this.prisma.memory.findFirst({
                where: {
                    sessionId,
                    category: 'long_term',
                    memoryType: args.memory_type,
                },
            });

            if (existing) {
                await this.prisma.memory.update({
                    where: { id: existing.id },
                    data: { content: finalContent },
                });
            } else {
                await this.prisma.memory.create({
                    data: {
                        sessionId,
                        category: 'long_term',
                        memoryType: args.memory_type,
                        content: finalContent,
                        importance: 5,
                    },
                });
            }
        }

        return `✓ 长期记忆已${writeMode === 'append' ? '追加' : '覆盖'}`;
    }
}
