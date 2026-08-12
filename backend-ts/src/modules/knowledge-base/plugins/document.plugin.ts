import { Logger, Injectable } from "@nestjs/common";
import * as fs from "fs/promises";
import * as path from "path";
import { z } from "zod";
import { PluginBase } from "../../plugins/base-plugin";
import { PluginContext } from "../../plugins/types/plugin.types";
import { FileParserService } from "../file-parser.service";
import { WorkspaceService } from "../../../common/services/workspace.service";
import { PluginApi } from "../../plugins/api/plugin-api";
import { safeTruncate } from "../../../common/utils/string.utils";
import langZh from "./document.lang.zh.json";
import langEn from "./document.lang.en.json";

@Injectable()
export class DocumentPlugin extends PluginBase {
  private readonly logger = new Logger(DocumentPlugin.name);

  manifest = {
    id: "document",
    name: "%document.name%",
    description: "%document.description%",
    version: "1.0.0",
    category: "extended" as const,
  };

  constructor(
    private fileParserService: FileParserService,
    private workspaceService: WorkspaceService,
  ) {
    super();
  }

  async onLoad(api: PluginApi) {
    api.registerNls("zh", langZh);
    api.registerNls("en", langEn);
    api.registerTool({
      name: "doc_parse",
      description:
        "解析 PDF、Word 或 Excel 文档，提取其中的纯文本内容。支持 .pdf、.docx、.xlsx 和 .xls 格式。",
      inputSchema: z.object({
        file_path: z.string(),
        max_chars: z.number().optional(),
      }),
      execute: async (args, ctx, abortSignal) => {
        const { file_path, max_chars = 20000 } = args;
        if (!file_path) throw new Error("文件路径不能为空");
        const resolvedPath = this.workspaceService.resolveFilePath(
          file_path,
          ctx?.session.workspacePath,
        );
        this.logger.log(`解析文档: ${file_path} -> ${resolvedPath}`);
        const stats = await fs.stat(resolvedPath);
        if (!stats.isFile()) throw new Error(`${resolvedPath} 不是一个文件`);
        const ext = path.extname(resolvedPath).replace(/^\./, "").toLowerCase();
        if (!["pdf", "docx", "xlsx", "xls"].includes(ext))
          throw new Error(`不支持的文件格式：.${ext}`);
        const result = await this.fileParserService.parseFile(resolvedPath);
        const content = result.text;
        if (!content?.trim())
          return JSON.stringify({
            file_path: resolvedPath,
            content: "",
            total_chars: 0,
            warning: "文档内容为空",
          });
        const totalChars = content.length;
        const truncated =
          totalChars > max_chars ? safeTruncate(content, max_chars) : content;
        return JSON.stringify({
          file_path: resolvedPath,
          file_name: path.basename(resolvedPath),
          content: truncated,
          total_chars: totalChars,
          returned_chars: truncated.length,
          is_truncated: totalChars > max_chars,
        });
      },
      display: {
        actionType: "doc_parse",
        text: { executing: "%doc_parse.executing%", completed: "%doc_parse.completed%" },
        aggregate: { executing: "%doc_parse.aggregate.executing%", completed: "%doc_parse.aggregate.completed%" },
        argsKey: "file_path",
        icon: "read",
      },
    });

    api.registerTool({
      name: "doc_batch_parse",
      description:
        "批量解析多个 PDF 或 Word 文档，返回每个文件的文本内容摘要。",
      inputSchema: z.object({
        file_paths: z.array(z.string()),
        max_chars_per_file: z.number().optional(),
      }),
      execute: async (args, ctx, abortSignal) => {
        const { file_paths, max_chars_per_file = 10000 } = args;
        if (!Array.isArray(file_paths) || file_paths.length === 0)
          throw new Error("文件路径列表不能为空");
        if (file_paths.length > 10)
          throw new Error("批量解析最多支持 10 个文件");
        const results: any[] = [];
        for (const fp of file_paths) {
          try {
            const resolvedPath = this.workspaceService.resolveFilePath(
              fp,
              ctx?.session.workspacePath,
            );
            const ext = path
              .extname(resolvedPath)
              .replace(/^\./, "")
              .toLowerCase();
            if (!["pdf", "docx", "xlsx", "xls"].includes(ext))
              throw new Error(`不支持的文件格式：.${ext}`);
            const stats = await fs.stat(resolvedPath);
            if (!stats.isFile())
              throw new Error(`${resolvedPath} 不是一个文件`);
            const result = await this.fileParserService.parseFile(resolvedPath);
            const content = result.text ? safeTruncate(result.text, max_chars_per_file) : "";
            results.push({
              file_path: resolvedPath,
              file_name: path.basename(resolvedPath),
              success: true,
              content,
              total_chars: result.text?.length || 0,
            });
          } catch (e: any) {
            results.push({
              file_path: fp,
              file_name: path.basename(fp),
              success: false,
              error: e.message,
            });
          }
        }
        return JSON.stringify({
          total_files: file_paths.length,
          success_count: results.filter((r) => r.success).length,
          fail_count: results.filter((r) => !r.success).length,
          results,
        });
      },
      display: {
        actionType: "doc_batch_parse",
        text: { executing: "%doc_batch_parse.executing%", completed: "%doc_batch_parse.completed%" },
        aggregate: { executing: "%doc_batch_parse.aggregate.executing%", completed: "%doc_batch_parse.aggregate.completed%" },
        icon: "read",
      },
    });

    api.registerPrompt({
      frequency: "REGULAR",
      description: "文档解析工具使用说明",
      content: [
        "# Document Parsing Tool Instructions",
        "",
        "**Supported Formats**: PDF (.pdf), Word (.docx), Excel (.xlsx, .xls)",
        "",
        "**Usage Suggestions**:",
        "1. When a user uploads or mentions a PDF/Word file, prioritize using this tool to extract text content",
        "2. The extracted text can be directly used for analysis, summarization, Q&A, and other downstream processing",
        "3. If the document is too long, use the max_chars parameter to control the returned length",
        "",
        "**Path Rules**:",
        "- Relative paths are resolved against the current working directory",
        "- Absolute paths are also supported",
      ].join("\n"),
    });
  }
}
