import { Injectable, Logger } from "@nestjs/common";
import * as fs from "fs/promises";
import * as path from "path";
import {
  IToolProvider,
  ToolCallRequest,
  ToolProviderMetadata,
  ToolDisplayInfo,
} from "../interfaces/tool-provider.interface";
import { InternalToolDefinition } from "../../llm-core/types/llm.types";
import { FileParserService } from "../../knowledge-base/file-parser.service";
import { WorkspaceService } from "../../../common/services/workspace.service";

/**
 * 文档解析工具提供者
 *
 * 复用知识库的 FileParserService，为 AI 提供 PDF、Word 等文档的文本提取能力。
 * 采用懒加载模式（loadMode: lazy），仅在需要时通过 tool_load 激活。
 */
@Injectable()
export class DocumentToolProvider implements IToolProvider {
  private readonly logger = new Logger(DocumentToolProvider.name);
  public readonly namespace = "document";

  private readonly toolsConfig: InternalToolDefinition[] = [
    {
      name: "parse",
      description:
        "解析 PDF、Word 或 Excel 文档，提取其中的纯文本内容。支持 .pdf、.docx、.xlsx 和 .xls 格式。当用户需要阅读、分析、总结或提取文档内容时使用此工具。",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "要解析的文档路径（绝对路径或相对路径），支持 .pdf、.docx、.xlsx 和 .xls 格式",
          },
          max_chars: {
            type: "number",
            description: "最大返回字符数，默认 20000。如果文档内容超过此限制，将截断并提示剩余内容",
            default: 20000,
          },
        },
        required: ["file_path"],
      },
    },
    {
      name: "batch_parse",
      description:
        "批量解析多个 PDF 或 Word 文档，返回每个文件的文本内容摘要。适用于需要同时处理多个文档的场景。",
      parameters: {
        type: "object",
        properties: {
          file_paths: {
            type: "array",
            items: { type: "string" },
            description: "要解析的文档路径列表（绝对路径或相对路径），支持 .pdf、.docx、.xlsx 和 .xls 格式",
          },
          max_chars_per_file: {
            type: "number",
            description: "每个文件最大返回字符数，默认 10000",
            default: 10000,
          },
        },
        required: ["file_paths"],
      },
    },
  ];

  constructor(
    private fileParserService: FileParserService,
    private workspaceService: WorkspaceService,
  ) {}

  async getTools(
    enabled?: boolean | string[],
    context?: Record<string, any>,
  ): Promise<any[]> {
    if (enabled === false) return [];

    if (Array.isArray(enabled)) {
      return this.toolsConfig.filter((tool) => enabled.includes(tool.name));
    }

    return this.toolsConfig;
  }

  async execute(
    request: ToolCallRequest,
    context?: Record<string, any>,
    abortSignal?: AbortSignal,
  ): Promise<string> {
    const handlers: Record<
      string,
      (
        args: any,
        ctx?: Record<string, any>,
        signal?: AbortSignal,
      ) => Promise<string>
    > = {
      parse: this.handleParse.bind(this),
      batch_parse: this.handleBatchParse.bind(this),
    };

    const handler = handlers[request.name];

    if (!handler) {
      throw new Error(`未知工具：${request.name}`);
    }

    return await handler(request.arguments, context, abortSignal);
  }

  async getPrompt(context?: Record<string, any>): Promise<string> {
    const promptParts: string[] = [];
    promptParts.push("# 文档解析工具使用说明");
    promptParts.push("");
    promptParts.push("**支持格式**：PDF (.pdf)、Word (.docx)、Excel (.xlsx, .xls)");
    promptParts.push("");
    promptParts.push("**使用建议**：");
    promptParts.push("1. 当用户上传或提及 PDF/Word 文件时，优先使用此工具提取文本内容");
    promptParts.push("2. 提取的文本可直接用于分析、总结、问答等后续处理");
    promptParts.push("3. 如果文档内容过长，可通过 max_chars 参数控制返回长度");
    promptParts.push("4. 对于扫描件 PDF，如果解析结果为空，可能是图片型 PDF，需要提示用户");
    promptParts.push("");
    promptParts.push("**路径规则**：");
    promptParts.push("- 相对路径以当前工作目录为基准");
    promptParts.push("- 支持绝对路径");

    return promptParts.join("\n");
  }

  async getBriefDescription(context?: Record<string, any>): Promise<string> {
    return "文档解析工具，支持从 PDF 和 Word 文件中提取纯文本内容";
  }

  getMetadata(context?: Record<string, any>): ToolProviderMetadata {
    return {
      namespace: this.namespace,
      displayName: "文档解析工具",
      description: "PDF 和 Word 文档文本提取工具",
      isMcp: false,
      loadMode: "lazy",
      type: "extended",
    };
  }

  /**
   * 生成文档工具的展示文案
   */
  formatDisplayMessage(
    toolName: string,
    args: Record<string, any>,
    isStreaming: boolean,
  ): ToolDisplayInfo {
    const prefix = isStreaming ? "正在" : "已";
    const fileName = args.file_path
      ? path.basename(args.file_path)
      : args.file_paths?.length
        ? `${args.file_paths.length} 个文件`
        : undefined;

    let action: string;
    switch (toolName) {
      case "parse":
        action = `${prefix}解析文档`;
        break;
      case "batch_parse":
        action = `${prefix}批量解析文档`;
        break;
      default:
        action = `${prefix}处理文档`;
    }

    return {
      action,
      args: fileName,
      toolName: `document__${toolName}`,
      toolType: this.namespace,
    };
  }

  /**
   * 解析单个文档
   */
  private async handleParse(
    args: any,
    context?: Record<string, any>,
    abortSignal?: AbortSignal,
  ): Promise<string> {
    const { file_path, max_chars = 20000 } = args;

    if (!file_path || typeof file_path !== "string") {
      throw new Error("文件路径不能为空");
    }

    if (abortSignal?.aborted) {
      throw new Error("Request was aborted");
    }

    // 解析路径
    const resolvedPath = this.workspaceService.resolveFilePath(
      file_path,
      context?.workspacePath,
    );

    this.logger.log(`解析文档: ${file_path} -> ${resolvedPath}`);

    // 检查文件是否存在
    try {
      const stats = await fs.stat(resolvedPath);
      if (!stats.isFile()) {
        throw new Error(`${resolvedPath} 不是一个文件`);
      }
    } catch (error: any) {
      if (error.code === "ENOENT") {
        throw new Error(`文件不存在 - ${file_path}`);
      }
      throw error;
    }

    // 检查扩展名
    const ext = path.extname(resolvedPath).replace(/^\./, "").toLowerCase();
    if (!["pdf", "docx", "xlsx", "xls"].includes(ext)) {
      throw new Error(`不支持的文件格式：.${ext}，仅支持 .pdf、.docx、.xlsx 和 .xls`);
    }

    if (abortSignal?.aborted) {
      throw new Error("Request was aborted");
    }

    try {
      // 复用 FileParserService 解析文件
      const result = await this.fileParserService.parseFile(resolvedPath);
      const content = result.text;

      if (abortSignal?.aborted) {
        throw new Error("Request was aborted");
      }

      // 处理空内容
      if (!content || content.trim().length === 0) {
        return JSON.stringify({
          file_path: resolvedPath,
          file_name: path.basename(resolvedPath),
          content: "",
          total_chars: 0,
          warning: "文档内容为空，可能是扫描件、图片型 PDF 或加密文档",
        });
      }

      // 截断处理
      const totalChars = content.length;
      let truncatedContent = content;
      let isTruncated = false;

      if (totalChars > max_chars) {
        truncatedContent = content.substring(0, max_chars);
        isTruncated = true;
        this.logger.warn(
          `文档内容过长 (${totalChars} 字符)，已截断至 ${max_chars} 字符`,
        );
      }

      return JSON.stringify({
        file_path: resolvedPath,
        file_name: path.basename(resolvedPath),
        content: truncatedContent,
        total_chars: totalChars,
        returned_chars: truncatedContent.length,
        is_truncated: isTruncated,
        ...(isTruncated && {
          warning: `内容已截断，原始文档共 ${totalChars} 字符。如需继续阅读，请调整 max_chars 参数或分段请求`,
        }),
      });
    } catch (error: any) {
      this.logger.error(`解析文档失败：${error.message}`);

      // 区分已知错误和未知错误
      if (error.message.includes("PDF 文件解析失败")) {
        throw new Error(`PDF 解析失败：${error.message}。可能是加密文件、扫描件或格式不兼容`);
      } else if (error.message.includes("Word 文件解析失败")) {
        throw new Error(`Word 解析失败：${error.message}`);
      }

      throw new Error(`文档解析失败：${error.message}`);
    }
  }

  /**
   * 批量解析多个文档
   */
  private async handleBatchParse(
    args: any,
    context?: Record<string, any>,
    abortSignal?: AbortSignal,
  ): Promise<string> {
    const { file_paths, max_chars_per_file = 10000 } = args;

    if (!Array.isArray(file_paths) || file_paths.length === 0) {
      throw new Error("文件路径列表不能为空");
    }

    if (file_paths.length > 10) {
      throw new Error("批量解析最多支持 10 个文件");
    }

    const results: Array<{
      file_path: string;
      file_name: string;
      success: boolean;
      content?: string;
      total_chars?: number;
      returned_chars?: number;
      is_truncated?: boolean;
      error?: string;
    }> = [];

    for (const filePath of file_paths) {
      if (abortSignal?.aborted) {
        throw new Error("Request was aborted");
      }

      try {
        const singleResult = await this.handleParse(
          { file_path: filePath, max_chars: max_chars_per_file },
          context,
          abortSignal,
        );
        const parsed = JSON.parse(singleResult);
        results.push({
          file_path: parsed.file_path,
          file_name: parsed.file_name,
          success: true,
          content: parsed.content,
          total_chars: parsed.total_chars,
          returned_chars: parsed.returned_chars,
          is_truncated: parsed.is_truncated,
        });
      } catch (error: any) {
        results.push({
          file_path: filePath,
          file_name: path.basename(filePath),
          success: false,
          error: error.message,
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.length - successCount;

    return JSON.stringify({
      total_files: file_paths.length,
      success_count: successCount,
      fail_count: failCount,
      results,
    });
  }
}
