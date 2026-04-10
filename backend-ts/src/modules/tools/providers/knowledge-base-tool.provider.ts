import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import { KnowledgeBaseRepository } from '../../../common/database/knowledge-base.repository';
import { KBFileRepository } from '../../../common/database/kb-file.repository';
import { KBChunkRepository } from '../../../common/database/kb-chunk.repository';
import { VectorDbService } from '../../../common/vector-db/vector-db.service';
import { EmbeddingService } from '../../knowledge-base/embedding.service';
import { IToolProvider, ToolCallRequest, ToolCallResponse } from '../interfaces/tool-provider.interface';
import { InternalToolDefinition } from '../../chat/types/llm.types';

@Injectable()
export class KnowledgeBaseToolProvider implements IToolProvider {
    private readonly logger = new Logger(KnowledgeBaseToolProvider.name);
    namespace = 'knowledge_base';

    constructor(
        private prisma: PrismaService,
        private kbRepo: KnowledgeBaseRepository,
        private fileRepo: KBFileRepository,
        private chunkRepo: KBChunkRepository,
        private vectorDbService: VectorDbService,
        private embeddingService: EmbeddingService,
    ) { }

    private readonly toolsConfig: InternalToolDefinition[] = [
        {
            name: 'knowledge_base__search',
            description: '在知识库中搜索相关内容',
            parameters: {
                type: 'object',
                properties: {
                    knowledge_base_id: {
                        type: 'string',
                        description: '知识库 ID',
                    },
                    query: {
                        type: 'string',
                        description: '查询文本',
                    },
                    top_k: {
                        type: 'number',
                        description: '返回结果数量（默认5）',
                        default: 5,
                    },
                    filter_file_id: {
                        type: 'string',
                        description: '可选，按文件 ID 过滤',
                    },
                },
                required: ['knowledge_base_id', 'query'],
            },
        },
        {
            name: 'knowledge_base__list_files',
            description: '列出知识库中的所有文件',
            parameters: {
                type: 'object',
                properties: {
                    knowledge_base_id: {
                        type: 'string',
                        description: '知识库 ID',
                    },
                    skip: {
                        type: 'number',
                        description: '跳过数量（默认0）',
                        default: 0,
                    },
                    limit: {
                        type: 'number',
                        description: '返回数量限制（默认50）',
                        default: 50,
                    },
                },
                required: ['knowledge_base_id'],
            },
        },
        {
            name: 'knowledge_base__get_chunks',
            description: '获取文件的分块内容',
            parameters: {
                type: 'object',
                properties: {
                    file_id: {
                        type: 'string',
                        description: '文件 ID',
                    },
                    skip: {
                        type: 'number',
                        description: '跳过的分块数（默认0）',
                        default: 0,
                    },
                    limit: {
                        type: 'number',
                        description: '返回的最大分块数（默认10）',
                        default: 10,
                    },
                },
                required: ['file_id'],
            },
        },
    ];

    async getToolsNamespaced(enabledTools: Record<string, any> | boolean, injectParams: Record<string, any>): Promise<any[]> {
        // 直接返回扁平化的工具定义，由 adapter 进行转换
        return this.toolsConfig;
    }

    async executeWithNamespace(request: ToolCallRequest, injectParams: any): Promise<ToolCallResponse> {
        // 1. 统一剥离命名空间前缀，获取核心工具名
        const coreName = request.name.replace(`${this.namespace}__`, '');
        
        // 2. 建立工具名到处理函数的映射
        const handlers: Record<string, (args: any, params: any) => Promise<ToolCallResponse>> = {
            'search': this.handleSearch.bind(this),
            'list_files': this.handleListFiles.bind(this),
            'get_chunks': this.handleGetChunks.bind(this),
        };

        const handler = handlers[coreName];

        try {
            if (!handler) {
                throw new Error(`未知工具：${request.name}`);
            }
            return await handler(request.arguments, injectParams);
        } catch (error: any) {
            this.logger.error(`工具执行失败 [${request.name}]：${error.message}`);
            return {
                toolCallId: request.id,
                role: 'tool',
                name: request.name,
                content: `工具执行失败：${error.message}`,
            };
        }
    }

    async getPrompt(injectParams?: Record<string, any>): Promise<string> {
        try {
            const promptParts: string[] = [];

            promptParts.push('【知识库工具使用说明】');

            const toolInstructions = `
你拥有以下知识库管理工具，可以主动调用它们来查询和利用知识库内容：

### 1. 知识库语义搜索 (knowledge_base__search)
**用途**: 在知识库中进行向量相似度搜索，找到最相关的内容

**何时使用**:
- 用户询问与知识库相关的问题时
- 需要查找特定主题的资料时
- 想要验证知识库中是否有相关信息时

### 2. 知识库文件列表 (knowledge_base__list_files)
**用途**: 获取知识库下所有已上传文件的元数据列表

**何时使用**:
- 用户想了解知识库里有哪些文件时
- 需要查看文件的处理状态时
- 想要获取文件 ID 以便进一步操作时

### 3. 知识库文件分块详情 (knowledge_base__get_chunks)
**用途**: 获取指定文件的特定分块内容（支持分页）

**何时使用**:
- 用户想查看某个文件的具体内容时
- 需要检查分块质量时
- 想要深入了解文件细节时

**使用建议**:
1. **先搜索再查看**: 先用 \`search\` 找到相关内容，如有必要再用 \`get_chunks\` 查看完整分块
2. **注意分页**: 使用 \`get_chunks\` 时，每次最多获取 10 个分块，可通过调整 \`chunk_index\` 实现分页
3. **权限验证**: 所有工具都会自动验证用户权限，确保只能访问自己的知识库
4. **错误处理**: 如果返回错误信息，请检查参数是否正确、知识库/文件是否存在
`;
            promptParts.push(toolInstructions);

            return promptParts.join('\n');
        } catch (error: any) {
            this.logger.error(`获取知识库提示词失败：${error.message}`);
            return ''; // 出错时返回空字符串，不影响对话
        }
    }

    private async handleSearch(args: any, injectParams: any): Promise<ToolCallResponse> {
        const { knowledge_base_id, query, top_k = 5, filter_file_id } = args;
        const userId = injectParams.user_id;

        // 验证知识库权限
        const kb = await this.kbRepo.findById(knowledge_base_id);
        if (!kb) {
            throw new Error('知识库不存在');
        }
        if (kb.userId !== userId) {
            throw new Error('无权访问该知识库');
        }

        // 获取向量模型配置
        const model = await this.prisma.model.findUnique({
            where: { id: kb.embeddingModelId },
            include: { provider: true },
        });

        if (!model) {
            throw new Error(`向量模型不存在：${kb.embeddingModelId}`);
        }

        // 构建过滤条件
        const filterOptions = filter_file_id ? { documentId: filter_file_id } : undefined;

        // 获取查询文本的向量
        const queryEmbedding = await this.embeddingService.getEmbedding(
            query,
            model.provider.apiUrl || '',
            model.provider.apiKey || '',
            model.modelName,
        );

        // 执行混合搜索
        const tableId = `kb_${knowledge_base_id}`;
        const results = await this.vectorDbService.searchChunksHybrid(
            tableId,
            queryEmbedding,
            query,
            top_k,
            0.6,
            0.4,
            filterOptions,
        );

        // 格式化结果
        const formattedResults = results.map((result: any) => ({
            content: result.content,
            metadata: result.metadata,
            file_name: result.metadata?.file_name,
        }));

        return {
            toolCallId: 'search_result',
            role: 'tool',
            name: 'knowledge_base__search',
            content: JSON.stringify({
                query,
                results: formattedResults,
                total: formattedResults.length,
            }),
        };
    }

    private async handleListFiles(args: any, injectParams: any): Promise<ToolCallResponse> {
        const { knowledge_base_id, skip = 0, limit = 50 } = args;
        const userId = injectParams.user_id;

        // 验证知识库权限
        const kb = await this.kbRepo.findById(knowledge_base_id);
        if (!kb) {
            throw new Error('知识库不存在');
        }
        if (kb.userId !== userId) {
            throw new Error('无权访问该知识库');
        }

        // 获取文件列表
        const { items, total } = await this.fileRepo.findByKnowledgeBaseId(
            knowledge_base_id,
            skip,
            limit,
        );

        // 格式化结果
        const formattedFiles = items.map((file: any) => ({
            id: file.id,
            file_name: file.displayName,
            file_size: Number(file.fileSize),
            file_type: file.fileType,
            processing_status: file.processingStatus,
            progress_percentage: file.progressPercentage,
            total_chunks: file.totalChunks,
            uploaded_at: file.uploadedAt.toISOString(),
        }));

        return {
            toolCallId: 'list_files_result',
            role: 'tool',
            name: 'knowledge_base__list_files',
            content: JSON.stringify({
                files: formattedFiles,
                total,
                skip,
                limit,
            }),
        };
    }

    private async handleGetChunks(args: any, injectParams: any): Promise<ToolCallResponse> {
        const { file_id, skip = 0, limit = 10 } = args;

        // 获取文件
        const file = await this.fileRepo.findById(file_id);
        if (!file) {
            throw new Error('文件不存在');
        }

        // 检查文件处理状态
        if (file.processingStatus !== 'completed') {
            throw new Error(`文件尚未处理完成，当前状态：${file.processingStatus}`);
        }

        // 获取文件的分块列表
        const chunks = await this.chunkRepo.findByFileId(file_id, skip, limit);

        // 转换为字典格式
        const formattedChunks = chunks.map((chunk: any) => ({
            id: chunk.id,
            content: chunk.content,
            chunk_index: chunk.chunkIndex,
            token_count: chunk.tokenCount,
            metadata: chunk.metadata || null,
        }));

        return {
            toolCallId: 'get_chunks_result',
            role: 'tool',
            name: 'knowledge_base__get_chunks',
            content: JSON.stringify({
                file_id,
                chunks: formattedChunks,
                total: chunks.length,
            }),
        };
    }
}
