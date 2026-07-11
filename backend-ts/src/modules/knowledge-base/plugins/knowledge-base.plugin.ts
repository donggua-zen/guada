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
    const kbKit = api.registerToolKit({
      id: "knowledge_base",
      name: "Knowledge Base",
      loadMode: "lazy",
      activator: "Use this toolkit to search knowledge base content when the user asks questions related to the knowledge base",
      handler: (ctx) => ({
        loadMode: ctx?.session?.sessionType === "bot" ? "eager" : ("lazy" as const),
      }),
    });

    kbKit.registerTool({
      name: "kb_search",
      description: "Search for relevant content in the knowledge base",
      inputSchema: z.object({
        knowledge_base_id: z.string().describe("Knowledge base ID"),
        query: z.string().describe("Search keyword or question"),
        top_k: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Number of results to return, default 5"),
        filter_file_id: z
          .string()
          .optional()
          .describe("Filter search scope by file ID"),
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

        return {
          query,
          results: formattedResults,
          total: formattedResults.length,
        };
      },
      display: { action: "搜索知识库", argsKey: "query", icon: "search" },
    });

    kbKit.registerTool({
      name: "kb_list_files",

      description: "List all files in the knowledge base",
      inputSchema: z.object({
        knowledge_base_id: z.string().describe("Knowledge base ID"),
        skip: z.number().int().min(0).optional().describe("Number of items to skip, default 0"),
        limit: z.number().int().min(1).optional().describe("Number of items to return, default 50"),
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
        return {
          files: formattedFiles,
          total,
          skip,
          limit,
        };
      },
      display: { action: "列出知识库文件", icon: "search" },
    });

    kbKit.registerTool({
      name: "kb_get_chunks",

      description: "Get the chunked content of a file",
      inputSchema: z.object({
        file_id: z.string().describe("File ID"),
        skip: z.number().int().min(0).optional().describe("Number of chunks to skip, default 0"),
        limit: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Number of chunks to return, default 10"),
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
        return {
          file_id,
          chunks: formattedChunks,
          total: chunks.length,
        };
      },
      display: { action: "获取文件分块", argsKey: "file_id", icon: "search" },
    });

    kbKit.registerTool({
      name: "kb_add_document",

      description:
        "Add a text file at the specified path to the knowledge base, automatically performing chunking, vectorization, and storage",
      inputSchema: z.object({
        knowledge_base_id: z.string().describe("Knowledge base ID"),
        source_file_path: z
          .string()
          .describe("Source file path, can be an absolute path or a path relative to the working directory"),
        target_path: z.string().describe("Target storage path in the knowledge base, including the file name"),
      }),
      execute: async (args, ctx) => {
        const { knowledge_base_id, source_file_path, target_path } = args;
        const userId = ctx?.session.userId;
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

          return {
            success: true,
            message: "文档已提交处理，将在后台自动完成分块和向量化",
            file_id: fileRecord.id,
            file_name: fileRecord.displayName,
            knowledge_base_id,
            target_path: fileRecord.relativePath,
            status: fileRecord.processingStatus,
          };
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

    // 知识库使用说明提示词（对应原 getPrompt 的详细说明），绑定到知识库工具包
    kbKit.registerPrompt({
      frequency: "REGULAR",

      description: "知识库工具使用说明",
      content: (context: PluginContext) => {
        const sessionType = context?.session.sessionType;
        const isWebSession = !sessionType || sessionType === "web";
        const parts: string[] = [];

        parts.push(`# Knowledge Base Tool Instructions

You have the following knowledge base management tools available. You can proactively call them to query and utilize knowledge base content:

### 1. Knowledge Base Semantic Search (kb_search)
**Purpose**: Perform vector similarity search in the knowledge base to find the most relevant content

**When to use**:
- When the user asks questions related to the knowledge base
- When you need to find information on a specific topic
- When you want to verify whether relevant information exists in the knowledge base

### 2. Knowledge Base File List (kb_list_files)
**Purpose**: Get the metadata list of all uploaded files in the knowledge base

**When to use**:
- When the user wants to know what files are in the knowledge base
- When you need to check the processing status of files
- When you need to obtain a file ID for further operations

### 3. Knowledge Base File Chunk Details (kb_get_chunks)
**Purpose**: Get the specific chunk content of a file (supports pagination)

**When to use**:
- When the user wants to view the specific content of a file
- When you need to check chunk quality
- When you want to dive deeper into file details`);

        if (isWebSession) {
          parts.push(`### 4. Add Document to Knowledge Base (kb_add_document)
**Purpose**: Add a text file at the specified path to the knowledge base

**When to use**:
- When the user provides a file path and asks to save its content to the knowledge base
- When you need to add local documents (e.g., .txt, .md files) to the knowledge base
- When the user says something like "add this file to the knowledge base"

**Usage Suggestions**:
1. **Search first, then view**: Use \`kb_search\` first to find relevant content, then use \`kb_get_chunks\` to view the full chunks if necessary
2. **Pagination**: When using \`kb_get_chunks\`, each call returns at most 10 chunks. Use the \`limit\` and \`skip\` parameters for pagination
3. **Error Handling**: If an error is returned, check whether the parameters are correct and whether the knowledge base/file exists
4. **Path Specification**: target_path should include the full relative path and file name. The system will automatically create the corresponding folder structure`);
        } else {
          parts.push(`**Usage Suggestions**:
1. **Search first, then view**: Use \`kb_search\` first to find relevant content, then use \`kb_get_chunks\` to view the full chunks if necessary
2. **Pagination**: When using \`kb_get_chunks\`, each call returns at most 10 chunks. Use the \`limit\` and \`skip\` parameters for pagination
3. **Error Handling**: If an error is returned, check whether the parameters are correct and whether the knowledge base/file exists`);
        }

        return parts.join("\n");
      },
    });
  }
}
