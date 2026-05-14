import { Injectable, Logger } from "@nestjs/common";
import * as fs from "fs/promises";
import * as path from "path";
import {
  IToolProvider,
  ToolCallRequest,
  ToolCallResponse,
  ToolProviderMetadata,
} from "../interfaces/tool-provider.interface";
import { InternalToolDefinition } from "../../llm-core/types/llm.types";
import { WorkspaceService } from "../../../common/services/workspace.service";

@Injectable()
export class FileToolProvider implements IToolProvider {
  private readonly logger = new Logger(FileToolProvider.name);
  public readonly namespace = "file";

  private readonly toolsConfig: InternalToolDefinition[] = [
    {
      name: "read",
      description: "读取指定路径的文本文件内容。支持分页读取大文件，通过参数精确控制读取范围。适合查看配置文件、日志或代码。",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "要读取的文件路径（绝对路径或相对路径）",
          },
          encoding: {
            type: "string",
            description: "文件编码，默认为 utf-8",
            default: "utf-8",
          },
          offset: {
            type: "number",
            description: "起始行号（从 0 开始），用于分页读取。默认为 0（从头开始）",
            default: 0,
          },
          skip_chars: {
            type: "number",
            description: "在起始行内跳过的字符数，用于继续读取超长行。默认为 0",
            default: 0,
          },
          limit: {
            type: "number",
            description: "最大读取行数，默认 500 行，最大不超过 500 行",
            default: 500,
          },
        },
        required: ["file_path"],
      },
    },
    {
      name: "list",
      description: "列出指定目录下的文件和子目录。max_depth 控制递归深度（1-3），默认为 1（仅当前目录）。单个目录超过 200 个文件时会显示省略提醒。",
      parameters: {
        type: "object",
        properties: {
          directory_path: {
            type: "string",
            description: "要列出的目录路径（绝对路径或相对路径）",
          },
          max_depth: {
            type: "number",
            description: "递归深度，范围 1-3。1=仅当前目录，2=包含一级子目录，3=包含两级子目录",
            default: 1,
          },
        },
        required: ["directory_path"],
      },
    },
    {
      name: "write",
      description: "将内容全量写入指定文件，如果文件/目录不存会自动创建。",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "目标文件路径（绝对路径或相对路径）",
          },
          content: {
            type: "string",
            description: "要写入的文件内容",
          },
          encoding: {
            type: "string",
            description: "文件编码，默认为 utf-8",
            default: "utf-8",
          },
        },
        required: ["file_path", "content"],
      },
    },
    {
      name: "replace",
      description: "在文件中查找并替换指定文本。expected_count 用于验证匹配次数：设为 -1 或 0 表示替换所有匹配项；设为正整数则必须严格匹配该次数，否则报错。",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "目标文件路径（绝对路径或相对路径）",
          },
          search_text: {
            type: "string",
            description: "需要被替换的原始文本",
          },
          replace_text: {
            type: "string",
            description: "用于替换的新文本",
          },
          expected_count: {
            type: "number",
            description: "预期匹配并替换的次数。默认为 1；设为 -1 或 0 表示替换所有匹配项；设为正整数则必须严格匹配该次数",
            default: 1,
          },
          encoding: {
            type: "string",
            description: "文件编码，默认为 utf-8",
            default: "utf-8",
          },
        },
        required: ["file_path", "search_text", "replace_text"],
      },
    },
    {
      name: "delete",
      description: "删除文件或目录。删除目录时会递归删除所有内容。此操作不可恢复，请谨慎使用！",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "要删除的文件或目录路径（绝对路径或相对路径）",
          },
        },
        required: ["path"],
      },
    },
    {
      name: "grep_file",
      description: "使用正则表达式搜索文件内容。返回匹配的行及其行号。适合查找特定模式或关键词。",
      parameters: {
        type: "object",
        properties: {
          regex: {
            type: "string",
            description: "正则表达式模式",
          },
          path: {
            type: "string",
            description: "要搜索的文件路径（绝对路径或相对路径）",
          },
          case_sensitive: {
            type: "boolean",
            description: "是否区分大小写，默认 false（不区分）",
            default: false,
          },
          max_matches: {
            type: "number",
            description: "最大返回匹配数，默认 100",
            default: 100,
          },
        },
        required: ["regex", "path"],
      },
    },
  ];

  constructor(private workspaceService: WorkspaceService) { }

  async getTools(enabled?: boolean | string[], context?: Record<string, any>): Promise<any[]> {
    if (enabled === false) return [];

    // 如果是数组，只返回数组中指定的工具
    if (Array.isArray(enabled)) {
      return this.toolsConfig.filter(tool => enabled.includes(tool.name));
    }

    // true 或未指定：返回所有工具
    return this.toolsConfig;
  }

  async execute(request: ToolCallRequest, context?: Record<string, any>): Promise<string> {
    const handlers: Record<
      string,
      (args: any, ctx?: Record<string, any>) => Promise<string>
    > = {
      read: this.handleReadFile.bind(this),
      list: this.handleListDirectory.bind(this),
      write: this.handleWriteFile.bind(this),
      replace: this.handleReplaceInFile.bind(this),
      delete: this.handleDelete.bind(this),
      grep_file: this.handleGrepFile.bind(this),
    };

    const handler = handlers[request.name];

    if (!handler) {
      throw new Error(`未知工具：${request.name}`);
    }

    const result = await handler(request.arguments, context);
    
    // 通知工作目录变更（写操作才需要通知）
    if (context?.sessionId && ['write', 'replace', 'delete'].includes(request.name)) {
      this.workspaceService.notifyWorkspaceChange(context.sessionId);
    }
    
    return result;
  }

  async getPrompt(context?: Record<string, any>): Promise<string> {

    const promptParts: string[] = [];
    promptParts.push("# 文件操作工具使用说明");

    // 注入工作目录提示
    if (context?.sessionId) {
      const workspaceDir = this.workspaceService.getWorkspaceDir(context.sessionId);
      promptParts.push("**当前会话工作目录**：");
      promptParts.push(`\`${workspaceDir}\``);
      promptParts.push("");
      promptParts.push("**重要说明**：");
      promptParts.push("1. 你编写的所有脚本、临时文件、生成的数据等都应该存放在上述工作目录中。");
      promptParts.push("2. **默认路径规则**：所有文件操作工具在处理相对路径时，都会自动以该工作目录为基准。除非用户明确指定了其他绝对路径，否则请始终使用相对路径。");
      promptParts.push("");
    }

    promptParts.push("**重要提醒**：");
    promptParts.push("1. 这些工具极其危险，如果需要删除或者修改文件务必征得用户同意");
    promptParts.push("2. 写入文件会覆盖原有内容，请谨慎使用");
    promptParts.push("3. 读取大文件时可能需要较长时间，建议先确认文件大小");
    promptParts.push("4. 对于超大文件，请使用分页读取功能，避免一次性加载过多内容");

    return promptParts.join("\n");

  }

  async getBriefDescription(context?: Record<string, any>): Promise<string> {
    return "文件读写工具，用于读取、写入、列出文件和目录。仅在明确需要时激活使用";
  }

  getMetadata(context?: Record<string, any>): ToolProviderMetadata {
    return {
      namespace: this.namespace,
      displayName: "文件操作工具",
      description: "文件系统读写与目录浏览工具",
      isMcp: false,
      loadMode: "lazy",
    };
  }

  /**
   * 解析文件路径：委托给 WorkspaceService
   */
  private resolvePath(filePath: string, context?: Record<string, any>): string {
    return this.workspaceService.resolveFilePath(filePath, context?.sessionId);
  }

  /**
   * 验证写入路径是否安全
   */
  private validateWritePath(filePath: string, context?: Record<string, any>): void {
    const resolvedPath = this.resolvePath(filePath, context);

    // 检查是否为安全工作路径（需要传入 sessionId）
    this.workspaceService.validateWritePath(resolvedPath, context?.sessionId);
  }

  /**
   * 读取文件内容（支持按行+字符混合分页读取）
   */
  private async handleReadFile(args: any, context?: Record<string, any>): Promise<string> {
    const { file_path, encoding = "utf-8", offset = 0, skip_chars = 0, limit = 50000 } = args;

    // 验证文件路径
    if (!file_path || typeof file_path !== "string") {
      throw new Error("文件路径不能为空");
    }

    try {
      // 解析路径
      const resolvedPath = this.resolvePath(file_path, context);
      this.logger.log(`读取文件: ${file_path} -> ${resolvedPath}`);

      // 检查文件是否存在
      const stats = await fs.stat(resolvedPath);
      if (!stats.isFile()) {
        throw new Error(`${resolvedPath} 不是一个文件`);
      }

      // 检查文件大小（限制为 10MB）
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (stats.size > maxSize) {
        throw new Error(`文件过大（${(stats.size / 1024 / 1024).toFixed(2)}MB），超过限制（10MB）。请使用 offset 参数分页读取。`);
      }

      // 读取文件内容
      const content = await fs.readFile(resolvedPath, { encoding: encoding as BufferEncoding });

      // 按行分割
      const lines = content.split('\n');
      const totalLines = lines.length;

      // 强制限制最大读取行数为 500
      const MAX_LINES = 500;
      // 强制限制最大字节数为 20KB
      const MAX_BYTES = 20 * 1024;

      const actualLimit = Math.min(limit === -1 ? MAX_LINES : limit, MAX_LINES);

      // 处理起始行
      const startLine = Math.max(0, Math.min(offset, totalLines));

      // 构建结果
      let selectedContent = '';
      let currentChars = 0;
      let endLine = startLine;
      let remainingSkipChars = skip_chars;

      // 逐行读取，直到达到行数或字节限制
      for (let i = startLine; i < totalLines; i++) {
        // 如果已经达到行数限制，停止
        if (i - startLine >= actualLimit) {
          endLine = i;
          break;
        }

        let line = lines[i];

        // 如果是起始行且有 skip_chars，跳过指定字符
        if (i === startLine && remainingSkipChars > 0) {
          line = line.substring(remainingSkipChars);
        }

        // 计算添加这行后的总字符数（包括换行符）
        const lineWithNewline = line + (i < totalLines - 1 ? '\n' : '');

        // 如果加上这行会超出字节限制
        if (currentChars + lineWithNewline.length > MAX_BYTES) {
          // 只取剩余可用的字符
          const availableChars = MAX_BYTES - currentChars;
          if (availableChars > 0) {
            selectedContent += lineWithNewline.substring(0, availableChars);
            currentChars += availableChars;
          }
          endLine = i;
          break;
        }

        // 添加整行
        selectedContent += lineWithNewline;
        currentChars += lineWithNewline.length;
        endLine = i;
      }

      // 移除末尾可能的换行符（如果是因为字节限制截断的）
      if (currentChars >= MAX_BYTES && selectedContent.endsWith('\n')) {
        selectedContent = selectedContent.slice(0, -1);
      }

      // 判断是否还有更多内容
      const hasMoreLines = endLine < totalLines - 1 || (endLine - startLine) >= actualLimit;
      const hasMoreCharsInCurrentLine = !hasMoreLines &&
        endLine < totalLines &&
        lines[endLine].length > (selectedContent.split('\n').pop()?.length || 0);
      const hasMore = hasMoreLines || hasMoreCharsInCurrentLine || currentChars >= MAX_BYTES;

      // 构建返回结果
      const result = {
        content: selectedContent,
        file_path: resolvedPath,
        chars_read: selectedContent.length,
        total_chars: content.length,
        lines_info: {
          start_line: startLine,
          end_line: endLine,
          total_lines: totalLines,
          lines_read: endLine - startLine,
          skip_chars_in_start_line: skip_chars,
        },
        has_more: hasMore,
        next_offset: hasMore ? endLine : undefined,
        next_skip_chars: hasMore && currentChars >= MAX_BYTES ?
          (lines[endLine]?.length - (selectedContent.split('\n').pop()?.length || 0)) : 0,
      };

      return JSON.stringify(result);
    } catch (error: any) {
      this.logger.error(`读取文件失败：${error.message}`);

      if (error.code === "ENOENT") {
        throw new Error(`文件不存在 - ${file_path}`);
      } else if (error.code === "EACCES") {
        throw new Error(`没有权限读取文件 - ${file_path}`);
      }

      throw error;
    }
  }

  /**
   * 列出目录内容
   */
  private async handleListDirectory(args: any, context?: Record<string, any>): Promise<string> {
    const { directory_path, max_depth = 1 } = args;

    // 验证目录路径
    if (!directory_path || typeof directory_path !== "string") {
      throw new Error("目录路径不能为空");
    }

    // 验证递归深度
    const depth = Math.max(1, Math.min(3, max_depth));

    try {
      // 解析路径
      const resolvedPath = this.resolvePath(directory_path, context);
      this.logger.log(`列出目录: ${directory_path} -> ${resolvedPath}, 递归深度: ${depth}`);

      // 检查是否为目录
      const stats = await fs.stat(resolvedPath);
      if (!stats.isDirectory()) {
        throw new Error(`${resolvedPath} 不是一个目录`);
      }

      // 读取目录内容
      const entries = await this.readDirectoryWithDepth(resolvedPath, depth);

      if (entries.length === 0) {
        return `目录为空：${resolvedPath}`;
      }

      const resultParts: string[] = [
        `目录内容（${resolvedPath}）：`,
        "",
        ...entries,
      ];

      return resultParts.join("\n");
    } catch (error: any) {
      this.logger.error(`列出目录失败：${error.message}`);

      if (error.code === "ENOENT") {
        throw new Error(`目录不存在 - ${directory_path}`);
      } else if (error.code === "EACCES") {
        throw new Error(`没有权限访问目录 - ${directory_path}`);
      }

      throw error;
    }
  }

  /**
   * 根据深度读取目录内容
   */
  private async readDirectoryWithDepth(dirPath: string, maxDepth: number): Promise<string[]> {
    const results: string[] = [];
    await this.readDirectoryRecursive(dirPath, "", 1, maxDepth, results);
    return results;
  }

  /**
   * 递归读取目录内容（带深度控制和文件数量限制）
   */
  private async readDirectoryRecursive(
    dirPath: string,
    prefix: string,
    currentDepth: number,
    maxDepth: number,
    results: string[],
  ): Promise<void> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    // 检查文件数量是否超过限制
    const MAX_FILES_PER_DIR = 200;
    if (entries.length > MAX_FILES_PER_DIR) {
      const entryPrefix = `${prefix} (${entries.length} 个条目，显示前 ${MAX_FILES_PER_DIR} 个)`;
      results.push(entryPrefix);
    } else {
      const entryPrefix = `${prefix}`;
      results.push(entryPrefix);
    }

    // 只处理前 200 个条目
    const limitedEntries = entries.slice(0, 200);

    for (const entry of limitedEntries) {
      const isDirectory = entry.isDirectory();
      const entryName = isDirectory ? `[DIR] ${entry.name}` : `[FILE] ${entry.name}`;
      const entryPrefix = `${prefix}  ${entryName}`;
      results.push(entryPrefix);

      // 如果是目录且未达到最大深度，递归读取
      if (isDirectory && currentDepth < maxDepth && !entry.name.startsWith(".")) {
        try {
          const fullPath = path.join(dirPath, entry.name);
          await this.readDirectoryRecursive(fullPath, `${prefix}  `, currentDepth + 1, maxDepth, results);
        } catch (error: any) {
          // 忽略权限错误等，继续处理其他条目
          this.logger.warn(`无法访问子目录 ${path.join(dirPath, entry.name)}: ${error.message}`);
        }
      }
    }

    // 如果有省略的条目，添加提示
    if (entries.length > MAX_FILES_PER_DIR) {
      results.push(`${prefix}  ... 还有 ${entries.length - MAX_FILES_PER_DIR} 个条目未显示`);
    }
  }

  /**
   * 全量写入文件（覆盖模式）
   */
  private async handleWriteFile(args: any, context?: Record<string, any>): Promise<string> {
    const { file_path, content, encoding = "utf-8" } = args;

    // 验证参数
    if (!file_path || typeof file_path !== "string") {
      throw new Error("文件路径不能为空");
    }

    if (content === undefined || content === null || typeof content !== "string") {
      throw new Error("文件内容不能为空");
    }

    try {
      // 解析路径
      const resolvedPath = this.resolvePath(file_path, context);

      // 验证写入路径安全性
      this.validateWritePath(file_path, context);

      this.logger.log(`写入文件: ${file_path} -> ${resolvedPath}`);

      // 确保父目录存在，如不存在则创建
      const dirPath = path.dirname(resolvedPath);
      try {
        await fs.access(dirPath);
      } catch (error: any) {
        if (error.code === "ENOENT") {
          this.logger.log(`创建目录: ${dirPath}`);
          await fs.mkdir(dirPath, { recursive: true });
        } else {
          throw error;
        }
      }

      // 写入文件（覆盖模式）
      await fs.writeFile(resolvedPath, content, { encoding: encoding as BufferEncoding });

      return `文件写入成功：${resolvedPath}\n文件大小：${Buffer.byteLength(content, encoding as BufferEncoding)} 字节`;
    } catch (error: any) {
      this.logger.error(`写入文件失败：${error.message}`);

      if (error.code === "EACCES") {
        throw new Error(`没有权限写入文件 - ${file_path}`);
      } else if (error.code === "ENOSPC") {
        throw new Error("磁盘空间不足");
      }

      throw error;
    }
  }

  /**
   * 在文件中查找并替换文本
   */
  private async handleReplaceInFile(args: any, context?: Record<string, any>): Promise<string> {
    const { file_path, search_text, replace_text, expected_count = 1, encoding = "utf-8" } = args;

    // 验证参数
    if (!file_path || typeof file_path !== "string") {
      throw new Error("文件路径不能为空");
    }

    if (!search_text || typeof search_text !== "string") {
      throw new Error("搜索文本不能为空");
    }

    if (replace_text === undefined || replace_text === null || typeof replace_text !== "string") {
      throw new Error("替换文本不能为空");
    }

    try {
      // 解析路径
      const resolvedPath = this.resolvePath(file_path, context);

      // 验证写入路径安全性
      this.validateWritePath(file_path, context);

      this.logger.log(`替换文件内容: ${file_path} -> ${resolvedPath}, 搜索: "${search_text}", 替换为: "${replace_text}", 预期次数: ${expected_count}`);

      // 检查文件是否存在且为文件
      const stats = await fs.stat(resolvedPath);
      if (!stats.isFile()) {
        throw new Error(`${resolvedPath} 不是一个文件`);
      }

      // 读取文件内容
      const originalContent = await fs.readFile(resolvedPath, { encoding: encoding as BufferEncoding });

      // 标准化换行符：将 \r\n 和 \r 都转换为 \n，便于跨平台匹配
      const normalizedOriginal = originalContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const normalizedSearch = search_text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const normalizedReplace = replace_text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

      // 统计匹配次数（使用标准化后的内容）
      let matchCount = 0;
      let startIndex = 0;
      while (true) {
        const index = normalizedOriginal.indexOf(normalizedSearch, startIndex);
        if (index === -1) break;
        matchCount++;
        startIndex = index + normalizedSearch.length;
      }

      // 验证匹配次数
      if (matchCount === 0) {
        throw new Error(`未找到匹配的文本 "${search_text}"`);
      }

      // 如果设置了具体的期望次数（非 -1 或 0），则验证是否匹配
      if (expected_count > 0 && matchCount !== expected_count) {
        throw new Error(`实际匹配 ${matchCount} 次，但预期匹配 ${expected_count} 次`);
      }

      // 执行替换（使用标准化后的内容）
      let newNormalizedContent: string;
      if (expected_count === -1 || expected_count === 0) {
        // 替换所有匹配项
        newNormalizedContent = normalizedOriginal.split(normalizedSearch).join(normalizedReplace);
      } else {
        // 替换所有匹配项（因为已经验证了匹配次数符合预期）
        newNormalizedContent = normalizedOriginal.split(normalizedSearch).join(normalizedReplace);
      }

      // 保持原始文件的换行符风格
      // 检测原始文件使用的换行符类型
      const hasCRLF = originalContent.includes('\r\n');

      let finalContent: string;
      if (hasCRLF) {
        // 如果原文件使用 \r\n，则将结果转换回 \r\n
        finalContent = newNormalizedContent.replace(/\n/g, '\r\n');
      } else {
        // 否则保持 \n
        finalContent = newNormalizedContent;
      }

      // 写回文件
      await fs.writeFile(resolvedPath, finalContent, { encoding: encoding as BufferEncoding });

      const replacedCount = matchCount;
      return `替换成功：${resolvedPath}\n匹配次数：${matchCount}\n已替换：${replacedCount} 处`;
    } catch (error: any) {
      this.logger.error(`替换文件内容失败：${error.message}`);

      if (error.code === "ENOENT") {
        throw new Error(`文件不存在 - ${file_path}`);
      } else if (error.code === "EACCES") {
        throw new Error(`没有权限读写文件 - ${file_path}`);
      }

      throw error;
    }
  }

  /**
   * 删除文件或目录
   */
  private async handleDelete(args: any, context?: Record<string, any>): Promise<string> {
    const { path: targetPath } = args;

    // 验证路径参数
    if (!targetPath || typeof targetPath !== "string") {
      throw new Error("路径不能为空");
    }

    try {
      // 解析路径
      const resolvedPath = this.resolvePath(targetPath, context);

      // 验证写入路径安全性（删除也视为写操作）
      this.validateWritePath(targetPath, context);

      this.logger.log(`删除文件/目录: ${targetPath} -> ${resolvedPath}`);

      // 检查路径是否存在
      const stats = await fs.stat(resolvedPath);

      if (stats.isFile()) {
        // 删除文件
        await fs.unlink(resolvedPath);
        return `文件已删除：${resolvedPath}`;
      } else if (stats.isDirectory()) {
        // 递归删除目录
        await fs.rm(resolvedPath, { recursive: true, force: true });
        return `目录已删除：${resolvedPath}`;
      } else {
        throw new Error(`${resolvedPath} 不是有效的文件或目录`);
      }
    } catch (error: any) {
      this.logger.error(`删除失败：${error.message}`);

      if (error.code === "ENOENT") {
        throw new Error(`文件或目录不存在 - ${targetPath}`);
      } else if (error.code === "EACCES") {
        throw new Error(`没有权限删除 - ${targetPath}`);
      }

      throw error;
    }
  }

  /**
   * 使用正则表达式搜索文件内容
   */
  private async handleGrepFile(args: any, context?: Record<string, any>): Promise<string> {
    const { regex, path: filePath, case_sensitive = false, max_matches = 100 } = args;

    // 验证参数
    if (!regex || typeof regex !== "string") {
      throw new Error("正则表达式不能为空");
    }

    if (!filePath || typeof filePath !== "string") {
      throw new Error("文件路径不能为空");
    }

    try {
      // 解析路径
      const resolvedPath = this.resolvePath(filePath, context);
      this.logger.log(`搜索文件: ${filePath} -> ${resolvedPath}, 正则: ${regex}`);

      // 检查文件是否存在
      const stats = await fs.stat(resolvedPath);
      if (!stats.isFile()) {
        throw new Error(`${resolvedPath} 不是一个文件`);
      }

      // 检查文件大小（限制为 10MB）
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (stats.size > maxSize) {
        throw new Error(`文件过大（${(stats.size / 1024 / 1024).toFixed(2)}MB），超过限制（10MB）`);
      }

      // 读取文件内容
      const content = await fs.readFile(resolvedPath, { encoding: "utf-8" });
      const lines = content.split('\n');

      // 创建正则表达式
      const flags = case_sensitive ? 'g' : 'gi';
      let pattern: RegExp;
      try {
        pattern = new RegExp(regex, flags);
      } catch (error: any) {
        throw new Error(`无效的正则表达式: ${error.message}`);
      }

      // 搜索匹配
      const matches: Array<{
        segment: string;
        line: number;
        char_offset?: number;
      }> = [];

      const CONTEXT_CHARS = 50; // 前后各50字符
      const MAX_SEGMENT_LENGTH = 1000; // 单个片段最大长度
      const MAX_MATCHES = 200; // 最大匹配数

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineSegments: Array<{ start: number; end: number }> = [];

        // 查找所有匹配位置
        let match;
        const searchPattern = new RegExp(regex, case_sensitive ? 'g' : 'gi');
        
        while ((match = searchPattern.exec(line)) !== null) {
          const matchStart = match.index;
          const matchEnd = matchStart + match[0].length;

          // 计算上下文范围
          const segmentStart = Math.max(0, matchStart - CONTEXT_CHARS);
          const segmentEnd = Math.min(line.length, matchEnd + CONTEXT_CHARS);

          lineSegments.push({ start: segmentStart, end: segmentEnd });

          // 防止无限循环（零宽度匹配）
          if (match[0].length === 0) {
            searchPattern.lastIndex++;
          }
        }

        // 如果有匹配，合并重叠的片段
        if (lineSegments.length > 0) {
          // 按起始位置排序
          lineSegments.sort((a, b) => a.start - b.start);

          // 合并重叠片段
          const mergedSegments: Array<{ start: number; end: number }> = [lineSegments[0]];
          for (let j = 1; j < lineSegments.length; j++) {
            const current = lineSegments[j];
            const last = mergedSegments[mergedSegments.length - 1];

            if (current.start <= last.end) {
              // 重叠，合并
              last.end = Math.max(last.end, current.end);
            } else {
              // 不重叠，添加新片段
              mergedSegments.push(current);
            }
          }

          // 提取片段内容，确保不超过最大长度
          for (const segment of mergedSegments) {
            let content = line.substring(segment.start, segment.end);
            
            // 如果片段过长，截断
            if (content.length > MAX_SEGMENT_LENGTH) {
              content = content.substring(0, MAX_SEGMENT_LENGTH);
            }

            // 添加省略标记
            const prefix = segment.start > 0 ? '...' : '';
            const suffix = segment.end < line.length ? '...' : '';
            const finalContent = `${prefix}${content}${suffix}`;

            // 构建匹配项（扁平化）
            const matchItem: any = {
              segment: finalContent,
              line: i + 1,
            };

            // 只有当偏移不为 0 时才添加 char_offset
            if (segment.start > 0) {
              matchItem.char_offset = segment.start;
            }

            matches.push(matchItem);

            // 如果达到最大匹配数，停止
            if (matches.length >= MAX_MATCHES) {
              break;
            }
          }

          // 如果已经达到最大匹配数，退出外层循环
          if (matches.length >= MAX_MATCHES) {
            break;
          }
        }
      }

      // 构建返回结果
      if (matches.length === 0) {
        return JSON.stringify({
          file_path: resolvedPath,
          regex: regex,
          matches_count: 0,
          matches: [],
          message: "未找到匹配内容",
        });
      }

      const result = {
        file_path: resolvedPath,
        regex: regex,
        matches_count: matches.length,
        total_lines: lines.length,
        has_more: matches.length >= MAX_MATCHES,
        matches: matches,
      };

      return JSON.stringify(result);
    } catch (error: any) {
      this.logger.error(`搜索文件失败：${error.message}`);

      if (error.code === "ENOENT") {
        throw new Error(`文件不存在 - ${filePath}`);
      } else if (error.code === "EACCES") {
        throw new Error(`没有权限读取文件 - ${filePath}`);
      }

      throw error;
    }
  }
}
