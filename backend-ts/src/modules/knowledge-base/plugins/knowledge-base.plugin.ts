import { z } from "zod";
import { Logger, Injectable } from "@nestjs/common";
import * as path from "path";
import { PluginBase } from "../../plugins/base-plugin";
import { PluginContext } from "../../plugins/types/plugin.types";
import { PrismaService } from "../../../common/database/prisma.service";
import { KnowledgeBaseRepository } from "../../../common/database/knowledge-base.repository";
import { KBFileRepository } from "../../../common/database/kb-file.repository";
import { KBChunkRepository } from "../../../common/database/kb-chunk.repository";
import { VectorDbService } from "../../../common/vector-db/vector-db.service";
import { EmbeddingService } from "../embedding.service";
import { KbFileService } from "../kb-file.service";
import { PluginApi } from "../../plugins/api/plugin-api";

@Injectable()
export class KnowledgeBasePlugin extends PluginBase {
  private readonly logger = new Logger(KnowledgeBasePlugin.name);
  manifest = {
    id: "knowledge_base",
    name: "知识库",
    description: "知识库检索与管理工具集",
    version: "1.0.0",
    category: "core" as const,
  };

  constructor(
    private prisma: PrismaService,
    private kbRepo: KnowledgeBaseRepository,
    private fileRepo: KBFileRepository,
    private chunkRepo: KBChunkRepository,
    private vectorDbService: VectorDbService,
    private embeddingService: EmbeddingService,
    private kbFileService: KbFileService,
  ) {
    super();
  }

  async onLoad(api: PluginApi) {
    api.registerToolSet({
      name: "knowledge_base",
      loadMode: "eager",
      handler: (ctx) => ({
        loadMode: ctx?.sessionType === "bot" ? "eager" : "lazy",
      }),
    });

    api.registerTool({
      name: "kb_search",
      toolSet: "knowledge_base",
      description: "在知识库中搜索相关内容",
      inputSchema: z.object({
        knowledge_base_id: z.string().describe("知识库 ID"),
        query: z.string().describe("搜索关键词或问题"),
        top_k: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("返回结果数量，默认 5"),
        filter_file_id: z
          .string()
          .optional()
          .describe("按文件 ID 过滤搜索范围"),
      }),
      execute: async (args, ctx) => {
        const { knowledge_base_id, query, top_k = 5, filter_file_id } = args;
        const kb = await this.kbRepo.findById(knowledge_base_id);
        if (!kb) throw new Error("知识库不存在");

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
      },
      display: { action: "搜索知识库", argsKey: "query", icon: "search" },
    });

    api.registerTool({
      name: "kb_list_files",
      toolSet: "knowledge_base",
      description: "列出知识库中的所有文件",
      inputSchema: z.object({
        knowledge_base_id: z.string().describe("知识库 ID"),
        skip: z.number().int().min(0).optional().describe("跳过数量，默认 0"),
        limit: z.number().int().min(1).optional().describe("返回数量，默认 50"),
      }),
      execute: async (args, ctx) => {
        const { knowledge_base_id, skip = 0, limit = 50 } = args;
        const kb = await this.kbRepo.findById(knowledge_base_id);
        if (!kb) throw new Error("知识库不存在");
        const { items: files, total } = await this.fileRepo.findByKnowledgeBaseId(
          knowledge_base_id,
          skip,
          limit,
        );
        const formattedFiles = files.map((f: any) => ({
          id: f.id,
          file_name: f.displayName,
          file_size: Number(f.fileSize),
          file_type: f.fileType,
          processing_status: f.processingStatus,
          progress_percentage: f.progressPercentage,
          total_chunks: f.totalChunks,
          uploaded_at: f.uploadedAt.toISOString(),
        }));
        return JSON.stringify({
          files: formattedFiles,
          total,
          skip,
          limit,
        });
      },
      display: { action: "列出知识库文件", icon: "search" },
    });

    api.registerTool({
      name: "kb_get_chunks",
      toolSet: "knowledge_base",
      description: "获取文件的分块内容",
      inputSchema: z.object({
        file_id: z.string().describe("文件 ID"),
        skip: z.number().int().min(0).optional().describe("跳过分块数，默认 0"),
        limit: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("返回分块数，默认 10"),
      }),
      execute: async (args, ctx) => {
        const { file_id, skip = 0, limit = 10 } = args;
        const file = await this.fileRepo.findById(file_id);
        if (!file) throw new Error("文件不存在");

        // 检查文件处理状态
        if (file.processingStatus !== "completed") {
          throw new Error(`文件尚未处理完成，当前状态：${file.processingStatus}`);
        }

        const chunks = await this.chunkRepo.findByFileId(file_id, skip, limit);
        const formattedChunks = chunks.map((c: any) => ({
          id: c.id,
          content: c.content,
          chunk_index: c.chunkIndex,
          token_count: c.tokenCount,
          metadata: c.metadata || null,
        }));
        return JSON.stringify({
          file_id,
          chunks: formattedChunks,
          total: chunks.length,
        });
      },
      display: { action: "获取文件分块", argsKey: "file_id", icon: "search" },
    });

    api.registerTool({
      name: "kb_add_document",
      toolSet: "knowledge_base",
      description:
        "将指定路径的文本文件添加到知识库中，自动完成分块、向量化和存储",
      inputSchema: z.object({
        knowledge_base_id: z.string().describe("知识库 ID"),
        source_file_path: z
          .string()
          .describe("源文件路径，可以是绝对路径或相对工作目录的路径"),
        target_path: z.string().describe("知识库内的目标存储路径，包含文件名"),
      }),
      execute: async (args, ctx) => {
        const { knowledge_base_id, source_file_path, target_path } = args;
        const userId = ctx?.userId;
        if (!userId) throw new Error("无法获取用户身份，操作被拒绝");

        // 解析源文件路径（支持相对路径和绝对路径）
        let resolvedSourcePath = source_file_path;
        if (!path.isAbsolute(source_file_path)) {
          resolvedSourcePath = path.resolve(process.cwd(), source_file_path);
        }

        try {
          const fileRecord = await this.kbFileService.addTextDocument(
            knowledge_base_id,
            userId,
            resolvedSourcePath,
            target_path,
          );

          return JSON.stringify({
            success: true,
            message: "文档已提交处理，将在后台自动完成分块和向量化",
            file_id: fileRecord.id,
            file_name: fileRecord.displayName,
            knowledge_base_id,
            target_path: fileRecord.relativePath,
            status: fileRecord.processingStatus,
          });
        } catch (error: any) {
          this.logger.error(`添加文档失败：${error.message}`);
          throw new Error(`添加文档失败：${error.message}`);
        }
      },
      display: {
        action: "添加文档到知识库",
        argsKey: "source_file_path",
        icon: "edit",
      },
      dangerLevel: "high",
    });

    // 知识库使用说明提示词（对应原 getPrompt 的详细说明），绑定到 kb_search 工具集
    api.registerPrompt({
      frequency: "REGULAR",
      toolSet: "knowledge_base",
      description: "知识库工具使用说明",
      content: (context: PluginContext) => {
        const sessionType = context?.sessionType;
        const isWebSession = !sessionType || sessionType === "web";
        const parts: string[] = [];

        parts.push(`# 知识库工具使用说明

你拥有以下知识库管理工具，可以主动调用它们来查询和利用知识库内容：

### 1. 知识库语义搜索 (kb_search)
**用途**: 在知识库中进行向量相似度搜索，找到最相关的内容

**何时使用**:
- 用户询问与知识库相关的问题时
- 需要查找特定主题的资料时
- 想要验证知识库中是否有相关信息时

### 2. 知识库文件列表 (kb_list_files)
**用途**: 获取知识库下所有已上传文件的元数据列表

**何时使用**:
- 用户想了解知识库里有哪些文件时
- 需要查看文件的处理状态时
- 想要获取文件 ID 以便进一步操作时

### 3. 知识库文件分块详情 (kb_get_chunks)
**用途**: 获取指定文件的特定分块内容（支持分页）

**何时使用**:
- 用户想查看某个文件的具体内容时
- 需要检查分块质量时
- 想要深入了解文件细节时`);

        if (isWebSession) {
          parts.push(`### 4. 添加文档到知识库 (kb_add_document)
**用途**: 将指定路径的文本文件添加到知识库中

**何时使用**:
- 用户提供了文件路径，要求将其内容保存到知识库时
- 需要将本地文档（如 .txt, .md 文件）添加到知识库时
- 用户说"把这个文件加入知识库"等意图时

**使用建议**:
1. **先搜索再查看**: 先用 \`kb_search\` 找到相关内容，如有必要再用 \`kb_get_chunks\` 查看完整分块
2. **注意分页**: 使用 \`kb_get_chunks\` 时，每次最多获取 10 个分块，可通过调整 \`limit\` 和 \`skip\` 实现分页
3. **错误处理**: 如果返回错误信息，请检查参数是否正确、知识库/文件是否存在
4. **路径规范**: target_path 应包含完整的相对路径和文件名，系统会自动创建对应的文件夹结构`);
        } else {
          parts.push(`**使用建议**:
1. **先搜索再查看**: 先用 \`kb_search\` 找到相关内容，如有必要再用 \`kb_get_chunks\` 查看完整分块
2. **注意分页**: 使用 \`kb_get_chunks\` 时，每次最多获取 10 个分块，可通过调整 \`limit\` 和 \`skip\` 实现分页
3. **错误处理**: 如果返回错误信息，请检查参数是否正确、知识库/文件是否存在`);
        }

        return parts.join("\n");
      },
    });
  }
}
