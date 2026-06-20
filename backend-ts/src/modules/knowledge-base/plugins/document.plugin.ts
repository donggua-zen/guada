import { Logger, Injectable } from "@nestjs/common";
import * as fs from "fs/promises";
import * as path from "path";
import { z } from "zod";
import { PluginBase } from "../../plugins/base-plugin";
import { PluginContext } from "../../plugins/types/plugin.types";
import { FileParserService } from "../file-parser.service";
import { WorkspaceService } from "../../../common/services/workspace.service";
import { PluginApi } from "../../plugins/api/plugin-api";

@Injectable()
export class DocumentPlugin extends PluginBase {
  private readonly logger = new Logger(DocumentPlugin.name);

  manifest = {
    id: "document",
    name: "文档解析工具",
    description: "PDF 和 Word 文档文本提取工具",
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
          ctx?.workspacePath,
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
          totalChars > max_chars ? content.substring(0, max_chars) : content;
        return JSON.stringify({
          file_path: resolvedPath,
          file_name: path.basename(resolvedPath),
          content: truncated,
          total_chars: totalChars,
          returned_chars: truncated.length,
          is_truncated: totalChars > max_chars,
        });
      },
      display: { action: "解析文档", argsKey: "file_path", icon: "read" },
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
              ctx?.workspacePath,
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
            const content = result.text?.substring(0, max_chars_per_file) || "";
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
      display: { action: "批量解析文档", icon: "read" },
    });

    api.registerPrompt({
      frequency: "REGULAR",
      description: "文档解析工具使用说明",
      content: [
        "# 文档解析工具使用说明",
        "",
        "**支持格式**：PDF (.pdf)、Word (.docx)、Excel (.xlsx, .xls)",
        "",
        "**使用建议**：",
        "1. 当用户上传或提及 PDF/Word 文件时，优先使用此工具提取文本内容",
        "2. 提取的文本可直接用于分析、总结、问答等后续处理",
        "3. 如果文档内容过长，可通过 max_chars 参数控制返回长度",
        "",
        "**路径规则**：",
        "- 相对路径以当前工作目录为基准",
        "- 支持绝对路径",
      ].join("\n"),
    });
  }
}
