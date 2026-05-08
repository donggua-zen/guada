import { Injectable, Logger } from "@nestjs/common";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import * as iconv from "iconv-lite";
import {
  IToolProvider,
  ToolCallRequest,
  ToolCallResponse,
  ToolProviderMetadata,
} from "../interfaces/tool-provider.interface";
import { InternalToolDefinition } from "../../llm-core/types/llm.types";
import { WorkspaceService } from "../../../common/services/workspace.service";

const execAsync = promisify(exec);

@Injectable()
export class ShellToolProvider implements IToolProvider {
  private readonly logger = new Logger(ShellToolProvider.name);
  public readonly namespace = "shell";

  private readonly toolsConfig: InternalToolDefinition[] = [
    {
      name: "execute_command",
      description: "执行系统 shell 命令并返回输出结果。仅用于本地测试环境，请谨慎使用。命令执行可能耗时较长，请耐心等待结果。",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "要执行的 shell 命令",
          },
          working_directory: {
            type: "string",
            description: "可选的工作目录路径，默认为当前目录",
          },
          encoding: {
            type: "string",
            description: "命令输出的编码格式。Windows 中文环境建议使用 'gbk' 或 'gb2312'；Linux/macOS 通常使用 'utf-8'。如果不指定，系统将自动检测并尝试解码。",
            enum: ["utf-8", "gbk", "gb2312", "gb18030", "big5", "latin1"],
          },
        },
        required: ["command"],
      },
    },
    {
      name: "read_file",
      description: "读取指定路径的文本文件内容。适合查看配置文件、日志或代码，二进制文件可能无法正确显示。",
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
        },
        required: ["file_path"],
      },
    },
    {
      name: "list_directory",
      description: "列出指定目录下的文件和子目录。recursive=true 时会递归列出所有子目录，可能返回大量信息。",
      parameters: {
        type: "object",
        properties: {
          directory_path: {
            type: "string",
            description: "要列出的目录路径（绝对路径或相对路径）",
          },
          recursive: {
            type: "boolean",
            description: "是否递归列出子目录内容，默认为 false",
            default: false,
          },
        },
        required: ["directory_path"],
      },
    },
    {
      name: "write_file",
      description: "将内容全量写入指定文件（覆盖模式），如果文件不存在则创建。会清空原有内容，请谨慎使用。",
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
      name: "replace_in_file",
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
  ];

  constructor(private workspaceService: WorkspaceService) { }

  async getTools(enabled?: boolean | string[]): Promise<any[]> {
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
      execute_command: this.handleExecuteCommand.bind(this),
      read_file: this.handleReadFile.bind(this),
      list_directory: this.handleListDirectory.bind(this),
      write_file: this.handleWriteFile.bind(this),
      replace_in_file: this.handleReplaceInFile.bind(this),
    };

    const handler = handlers[request.name];

    if (!handler) {
      throw new Error(`未知工具：${request.name}`);
    }

    return await handler(request.arguments, context);
  }

  async getPrompt(context?: Record<string, any>): Promise<string> {
    try {
      const promptParts: string[] = [];

      // 注入工作目录提示
      if (context?.session_id) {
        try {
          const workspaceDir = this.workspaceService.getWorkspaceDir(context.session_id);
          promptParts.push("**当前会话工作目录**：");
          promptParts.push(`\`${workspaceDir}\``);
          promptParts.push("");
          promptParts.push("**重要说明**：");
          promptParts.push("1. 你编写的所有脚本、临时文件、生成的数据等都应该存放在上述工作目录中。");
          promptParts.push("2. **默认路径规则**：所有文件操作工具（读取、写入、列出目录等）在处理相对路径时，都会自动以该工作目录为基准。除非用户明确指定了其他绝对路径，否则请始终使用相对路径。");
          promptParts.push("3. 在执行命令时，如果没有指定 `working_directory`，系统将自动把工作目录设置为上述路径。");
          promptParts.push("");
        } catch (error: any) {
          this.logger.warn(`Failed to inject workspace info for session ${context.session_id}: ${error.message}`);
        }
      }

      // 注入操作系统信息
      const platform = process.platform;
      const osName = this.getOSName(platform);
      promptParts.push(`**当前系统**：${osName} (\`${platform}\`)`);
      promptParts.push("");

      promptParts.push("**重要提醒**：");
      promptParts.push("1. 这些工具极其危险，如果需要删除或者修改文件务必征得用户同意");
      promptParts.push("2. 执行命令时请注意安全性，避免执行危险操作");
      promptParts.push("3. 读取大文件时可能需要较长时间，建议先确认文件大小");
      promptParts.push("4. 路径可以是绝对路径或相对路径，建议使用绝对路径以避免歧义");

      return promptParts.join("\n");
    } catch (error: any) {
      this.logger.error(`获取 Shell 工具提示词失败：${error.message}`);
      return "";
    }
  }

  /**
   * 获取操作系统名称
   */
  private getOSName(platform: string): string {
    switch (platform) {
      case 'win32':
        return 'Windows';
      case 'darwin':
        return 'macOS';
      case 'linux':
        return 'Linux';
      default:
        return platform;
    }
  }

  getMetadata(): ToolProviderMetadata {
    return {
      namespace: this.namespace,
      displayName: "Shell 工具",
      description: "允许 AI 执行系统命令、读取文件和列出目录（仅用于本地测试）",
      isMcp: false,
    };
  }

  /**
   * 执行 Shell 命令
   */
  private async handleExecuteCommand(args: any, context?: Record<string, any>): Promise<string> {
    const { command, working_directory, encoding } = args;

    // 验证命令参数
    if (!command || typeof command !== "string") {
      throw new Error("命令不能为空");
    }

    try {
      this.logger.log(`执行命令: ${command}, 工作目录: ${working_directory || "当前目录"}, 编码: ${encoding || "自动检测"}`);

      const options: any = {
        timeout: 60000 * 2, // 2分钟超时
        maxBuffer: 1024 * 1024 * 10, // 10MB 最大输出
        encoding: "buffer", // 使用 buffer 接收原始字节数据，避免编码问题
      };

      if (working_directory) {
        options.cwd = working_directory;
      } else if (context?.session_id) {
        // 如果没有指定工作目录但有会话 ID，使用会话工作目录
        try {
          options.cwd = this.workspaceService.getWorkspaceDir(context.session_id);
        } catch (error: any) {
          this.logger.warn(`Failed to set CWD for session ${context.session_id}: ${error.message}`);
        }
      }

      const { stdout, stderr } = await execAsync(command, options);

      // 将 Buffer 转换为字符串
      const stdoutStr = this.decodeBuffer(stdout, encoding);
      const stderrStr = this.decodeBuffer(stderr, encoding);

      // 构建返回结果
      return JSON.stringify({
        stdout: stdoutStr.trim(),
        stderr: stderrStr.trim(),
        exitCode: 0,
      });
    } catch (error: any) {
      this.logger.error(`执行命令失败：${error.message}`);

      // 即使失败也返回 JSON，确保 AI 能获取到 stdout 中的任何潜在信息
      const exitCode = error.code === 'ETIMEDOUT' || error.killed ? -1 : (error.status || 1);
      
      // 处理错误中的 buffer 数据
      const stdoutStr = error.stdout ? this.decodeBuffer(error.stdout, encoding) : '';
      const stderrStr = error.stderr ? this.decodeBuffer(error.stderr, encoding) : error.message;
      
      return JSON.stringify({
        stdout: stdoutStr.trim(),
        stderr: String(stderrStr).trim(),
        exitCode: exitCode,
      });
    }
  }

  /**
   * 解码 Buffer 为字符串
   * @param buffer 原始数据
   * @param encoding 指定编码（可选），如果不提供则根据操作系统自动选择
   */
  private decodeBuffer(buffer: Buffer | string, encoding?: string): string {
    if (typeof buffer === 'string') {
      return buffer;
    }

    if (!buffer || buffer.length === 0) {
      return '';
    }

    try {
      // 如果 AI 指定了编码，直接使用
      if (encoding) {
        return iconv.decode(buffer, encoding);
      }

      // 否则根据操作系统自动选择编码
      const isWindows = process.platform === 'win32';
      const defaultEncoding = isWindows ? 'gbk' : 'utf-8';
      
      return iconv.decode(buffer, defaultEncoding);
    } catch (error: any) {
      this.logger.warn(`解码失败 (${encoding || 'auto'}): ${error.message}，使用 latin1 编码`);
      // 解码失败时使用 latin1 编码，保证所有字节都能被表示
      return buffer.toString('latin1');
    }
  }

  /**
   * 解析文件路径：如果是相对路径且有 session_id，则基于会话工作目录解析
   */
  private resolvePath(filePath: string, context?: Record<string, any>): string {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }

    // 如果存在 session_id，则相对于会话工作目录解析
    if (context?.session_id) {
      try {
        const workspaceDir = this.workspaceService.getWorkspaceDir(context.session_id);
        return path.join(workspaceDir, filePath);
      } catch (error: any) {
        this.logger.warn(`Failed to resolve path for session ${context.session_id}: ${error.message}`);
      }
    }

    // 否则使用系统默认解析（相对于进程启动目录）
    return path.resolve(filePath);
  }

  /**
   * 读取文件内容
   */
  private async handleReadFile(args: any, context?: Record<string, any>): Promise<string> {
    const { file_path, encoding = "utf-8" } = args;

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

      // 检查文件大小（限制为 1MB）
      const maxSize = 1024 * 1024; // 1MB
      if (stats.size > maxSize) {
        throw new Error(`文件过大（${(stats.size / 1024 / 1024).toFixed(2)}MB），超过限制（1MB）`);
      }

      // 读取文件内容
      const content = await fs.readFile(resolvedPath, { encoding: encoding as BufferEncoding });

      return content;
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
    const { directory_path, recursive = false } = args;

    // 验证目录路径
    if (!directory_path || typeof directory_path !== "string") {
      throw new Error("目录路径不能为空");
    }

    try {
      // 解析路径
      const resolvedPath = this.resolvePath(directory_path, context);
      this.logger.log(`列出目录: ${directory_path} -> ${resolvedPath}, 递归: ${recursive}`);

      // 检查是否为目录
      const stats = await fs.stat(resolvedPath);
      if (!stats.isDirectory()) {
        throw new Error(`${resolvedPath} 不是一个目录`);
      }

      // 读取目录内容
      let entries: string[];
      if (recursive) {
        entries = await this.readDirectoryRecursive(resolvedPath);
      } else {
        const dirents = await fs.readdir(resolvedPath, { withFileTypes: true });
        entries = dirents.map((entry) => {
          const prefix = entry.isDirectory() ? "[DIR]" : "[FILE]";
          return `${prefix} ${entry.name}`;
        });
      }

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
   * 递归读取目录内容
   */
  private async readDirectoryRecursive(dirPath: string, prefix: string = ""): Promise<string[]> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const results: string[] = [];

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const entryPrefix = `${prefix}${entry.isDirectory() ? "📁" : "📄"} ${entry.name}`;
      results.push(entryPrefix);

      // 如果是目录且不是隐藏目录，递归读取
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        try {
          const subEntries = await this.readDirectoryRecursive(fullPath, `${prefix}  `);
          results.push(...subEntries);
        } catch (error: any) {
          // 忽略权限错误等，继续处理其他条目
          this.logger.warn(`无法访问子目录 ${fullPath}: ${error.message}`);
        }
      }
    }

    return results;
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
}
