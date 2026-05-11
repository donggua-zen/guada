import { Injectable, Logger, Inject } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";
import { PrismaService } from "../../../common/database/prisma.service";
import { KnowledgeBaseRepository } from "../../../common/database/knowledge-base.repository";
import { KBFileRepository } from "../../../common/database/kb-file.repository";
import { KBChunkRepository } from "../../../common/database/kb-chunk.repository";
import { VectorDbService } from "../../../common/vector-db/vector-db.service";
import { EmbeddingService } from "../../knowledge-base/embedding.service";
import { KbFileService } from "../../knowledge-base/kb-file.service";
import {
  IToolProvider,
  ToolCallRequest,
  ToolCallResponse,
  ToolProviderMetadata,
} from "../interfaces/tool-provider.interface";
import { InternalToolDefinition } from "../../llm-core/types/llm.types";

@Injectable()
export class KnowledgeBaseToolProvider implements IToolProvider {
  private readonly logger = new Logger(KnowledgeBaseToolProvider.name);
  namespace = "knowledge_base";

  constructor(
    private prisma: PrismaService,
    private kbRepo: KnowledgeBaseRepository,
    private fileRepo: KBFileRepository,
    private chunkRepo: KBChunkRepository,
    private vectorDbService: VectorDbService,
    private embeddingService: EmbeddingService,
    private kbFileService: KbFileService,
  ) { }

  private readonly toolsConfig: InternalToolDefinition[] = [
    {
      name: "search",
      description: "在知识库中搜索相关内容",
      parameters: {
        type: "object",
        properties: {
          knowledge_base_id: {
            type: "string",
            description: "知识库 ID",
          },
          query: {
            type: "string",
            description: "查询文本",
          },
          top_k: {
            type: "number",
            description: "返回结果数量（默认5）",
            default: 5,
          },
          filter_file_id: {
            type: "string",
            description: "可选，按文件 ID 过滤",
          },
        },
        required: ["knowledge_base_id", "query"],
      },
    },
    {
      name: "list_files",
      description: "列出知识库中的所有文件",
      parameters: {
        type: "object",
        properties: {
          knowledge_base_id: {
            type: "string",
            description: "知识库 ID",
          },
          skip: {
            type: "number",
            description: "跳过数量（默认0）",
            default: 0,
          },
          limit: {
            type: "number",
            description: "返回数量限制（默认50）",
            default: 50,
          },
        },
        required: ["knowledge_base_id"],
      },
    },
    {
      name: "get_chunks",
      description: "获取文件的分块内容",
      parameters: {
        type: "object",
        properties: {
          file_id: {
            type: "string",
            description: "文件 ID",
          },
          skip: {
            type: "number",
            description: "跳过的分块数（默认0）",
            default: 0,
          },
          limit: {
            type: "number",
            description: "返回的最大分块数（默认10）",
            default: 10,
          },
        },
        required: ["file_id"],
      },
    },
    {
      name: "add_document",
      description: "将指定路径的文本文件添加到知识库中，自动完成分块、向量化和存储",
      parameters: {
        type: "object",
        properties: {
          knowledge_base_id: {
            type: "string",
            description: "目标知识库 ID（必填）",
          },
          source_file_path: {
            type: "string",
            description: "源文件的绝对路径或相对路径（必填），包含文件名",
          },
          target_path: {
            type: "string",
            description: "目标知识库中的相对路径（必填），包含文件名，例如：\"docs/api/guide.md\"",
          },
        },
        required: ["knowledge_base_id", "source_file_path", "target_path"],
      },
    },
  ];

  async getTools(enabled?: boolean | string[], context?: Record<string, any>): Promise<any[]> {
    if (enabled === false) return [];

    // 检查 sessionType，非 web 会话时排除 add_document 工具
    const sessionType = context?.sessionType;
    let availableTools = this.toolsConfig;

    if (sessionType && sessionType !== 'web') {
      // 非 web 会话时，移除 add_document 工具
      availableTools = this.toolsConfig.filter(tool => tool.name !== 'add_document');
    }

    // 如果是数组，只返回数组中指定的工具
    if (Array.isArray(enabled)) {
      return availableTools.filter(tool => enabled.includes(tool.name));
    }

    // true 或未指定：返回所有可用工具
    return availableTools;
  }

  async execute(request: ToolCallRequest, context?: Record<string, any>): Promise<string> {
    const handlers: Record<
      string,
      (args: any, injectParams?: Record<string, any>) => Promise<string>
    > = {
      search: this.handleSearch.bind(this),
      list_files: this.handleListFiles.bind(this),
      get_chunks: this.handleGetChunks.bind(this),
      add_document: this.handleAddDocument.bind(this),
    };

    const handler = handlers[request.name];

    try {
      if (!handler) {
        throw new Error(`未知工具：${request.name}`);
      }
      return await handler(request.arguments, context);
    } catch (error: any) {
      this.logger.error(`工具执行失败 [${request.name}]：${error.message}`);
      throw error; // 抛出异常，由 ToolOrchestrator 捕获
    }
  }

  async getPrompt(context?: Record<string, any>): Promise<string> {
    try {
      const promptParts: string[] = [];

      promptParts.push("# 知识库工具使用说明");

      // 检查 sessionType，非 web 会话时不包含添加文档功能
      const sessionType = context?.sessionType;
      const isWebSession = !sessionType || sessionType === 'web';

      let toolInstructions: string;

      if (isWebSession) {
        // Web 会话：包含所有工具
        toolInstructions = `
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

### 4. 添加文档到知识库 (knowledge_base__add_document)
**用途**: 将指定路径的文本文件添加到知识库中

**何时使用**:
- 用户提供了文件路径，要求将其内容保存到知识库时
- 需要将本地文档（如 .txt, .md 文件）添加到知识库时
- 用户说“把这个文件加入知识库”等意图时

**使用建议**:
1. **先搜索再查看**: 先用 \`search\` 找到相关内容，如有必要再用 \`get_chunks\` 查看完整分块
2. **注意分页**: 使用 \`get_chunks\` 时，每次最多获取 10 个分块，可通过调整 \`chunk_index\` 实现分页
3. **错误处理**: 如果返回错误信息，请检查参数是否正确、知识库/文件是否存在
4. **路径规范**: target_path 应包含完整的相对路径和文件名，系统会自动创建对应的文件夹结构
`;
      } else {
        // 非 Web 会话：仅包含查询工具
        toolInstructions = `
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
3. **错误处理**: 如果返回错误信息，请检查参数是否正确、知识库/文件是否存在
`;
      }

      promptParts.push(toolInstructions);

      return promptParts.join("\n");
    } catch (error: any) {
      this.logger.error(`获取知识库提示词失败：${error.message}`);
      return ""; // 出错时返回空字符串，不影响对话
    }
  }

  private async handleSearch(
    args: any,
    injectParams: any,
  ): Promise<string> {
    const { knowledge_base_id, query, top_k = 5, filter_file_id } = args;

    // 验证知识库是否存在
    const kb = await this.kbRepo.findById(knowledge_base_id);
    if (!kb) {
      throw new Error("知识库不存在");
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
    const filterOptions = filter_file_id
      ? { documentId: filter_file_id }
      : undefined;

    // 获取查询文本的向量
    const queryEmbedding = await this.embeddingService.getEmbedding(
      query,
      model.provider.apiUrl || "",
      model.provider.apiKey || "",
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

    return JSON.stringify({
      query,
      results: formattedResults,
      total: formattedResults.length,
    });
  }

  private async handleListFiles(
    args: any,
    injectParams: any,
  ): Promise<string> {
    const { knowledge_base_id, skip = 0, limit = 50 } = args;

    // 验证知识库是否存在
    const kb = await this.kbRepo.findById(knowledge_base_id);
    if (!kb) {
      throw new Error("知识库不存在");
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

    return JSON.stringify({
      files: formattedFiles,
      total,
      skip,
      limit,
    });
  }

  private async handleGetChunks(
    args: any,
    injectParams: any,
  ): Promise<string> {
    const { file_id, skip = 0, limit = 10 } = args;

    // 获取文件
    const file = await this.fileRepo.findById(file_id);
    if (!file) {
      throw new Error("文件不存在");
    }

    // 检查文件处理状态
    if (file.processingStatus !== "completed") {
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

    return JSON.stringify({
      file_id,
      chunks: formattedChunks,
      total: chunks.length,
    });
  }

  private async handleAddDocument(
    args: any,
    injectParams: any,
  ): Promise<string> {
    const {
      knowledge_base_id,
      source_file_path,
      target_path
    } = args;

    // 验证参数
    if (!knowledge_base_id || !source_file_path || !target_path) {
      throw new Error("缺少必要参数：knowledge_base_id、source_file_path、target_path");
    }

    // 从 injectParams 获取 user_id（由 ToolOrchestrator 注入）
    const userId = injectParams?.userId;
    if (!userId) {
      throw new Error("无法获取用户身份，操作被拒绝");
    }

    try {
      // 解析源文件路径（支持相对路径和绝对路径）
      let resolvedSourcePath = source_file_path;
      if (!path.isAbsolute(source_file_path)) {
        // 如果是相对路径，相对于当前工作目录
        resolvedSourcePath = path.resolve(process.cwd(), source_file_path);
      }

      // 调用 KbFileService 处理文本文档添加
      const fileRecord = await this.kbFileService.addTextDocument(
        knowledge_base_id,
        userId,
        resolvedSourcePath,
        target_path,
      );

      // 返回成功结果
      return JSON.stringify({
        success: true,
        message: "文档已提交处理，将在后台自动完成分块和向量化",
        file_id: fileRecord.id,
        file_name: fileRecord.displayName,
        knowledge_base_id: knowledge_base_id,
        target_path: fileRecord.relativePath,
        status: fileRecord.processingStatus,
      });

    } catch (error: any) {
      this.logger.error(`添加文档失败：${error.message}`);
      throw new Error(`添加文档失败：${error.message}`);
    }
  }

  async getBriefDescription(context?: Record<string, any>): Promise<string> {
    return "知识库检索与管理工具，支持语义搜索、文件浏览和内容查询。若用户提供了知识库信息，除非明确要求，否则仅限于使用此工具集回答。";
  }

  getMetadata(context?: Record<string, any>): ToolProviderMetadata {
    return {
      namespace: this.namespace,
      displayName: "知识库",
      description: "知识库检索与管理工具集",
      isMcp: false,
      loadMode: context?.sessionType === "web" ? "lazy" : "eager",
    };
  }
}
