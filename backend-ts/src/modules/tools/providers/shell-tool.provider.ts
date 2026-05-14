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
      execute_command: this.handleExecuteCommand.bind(this),
    };

    const handler = handlers[request.name];

    if (!handler) {
      throw new Error(`未知工具：${request.name}`);
    }

    const result = await handler(request.arguments, context);
    
    // 通知工作目录变更（Shell 命令可能会修改文件系统）
    if (context?.sessionId) {
      this.workspaceService.notifyWorkspaceChange(context.sessionId);
    }
    
    return result;
  }

  async getPrompt(context?: Record<string, any>): Promise<string> {
    try {
      const promptParts: string[] = [];
      promptParts.push("# Shell 命令行工具使用说明");

      // 注入操作系统信息
      const platform = process.platform;
      const osName = this.getOSName(platform);
      promptParts.push(`**当前系统**：${osName} (\`${platform}\`)`);
      promptParts.push("");

      promptParts.push("**重要提醒**：");
      promptParts.push("1. 这些工具极其危险，如果需要删除或者修改文件务必征得用户同意");
      promptParts.push("2. 执行命令时请注意安全性，避免执行危险操作");
      promptParts.push("3. 命令输出可能包含大量信息，建议先确认命令的影响范围");

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

  async getBriefDescription(context?: Record<string, any>): Promise<string> {
    return "Shell 命令行执行工具，用于运行系统命令。仅在明确需要时激活使用";
  }

  getMetadata(context?: Record<string, any>): ToolProviderMetadata {
    return {
      namespace: this.namespace,
      displayName: "Shell 命令行工具",
      description: "系统命令执行工具",
      isMcp: false,
      // loadMode: "lazy",
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
      } else if (context?.sessionId) {
        // 如果没有指定工作目录但有会话 ID，使用会话工作目录
        try {
          options.cwd = this.workspaceService.getWorkspaceDir(context.sessionId);
        } catch (error: any) {
          this.logger.warn(`Failed to set CWD for session ${context.sessionId}: ${error.message}`);
        }
      }

      const { stdout, stderr } = await execAsync(command, options);

      // 将 Buffer 转换为字符串
      const stdoutStr = this.decodeBuffer(stdout, encoding);
      const stderrStr = this.decodeBuffer(stderr, encoding);

      // 构建返回结果
      const result = {
        stdout: stdoutStr.trim(),
        stderr: stderrStr.trim(),
        exitCode: 0,
      };

      return this.truncateOutput(result);
    } catch (error: any) {
      this.logger.error(`执行命令失败：${error.message}`);

      // 即使失败也返回 JSON，确保 AI 能获取到 stdout 中的任何潜在信息
      const exitCode = error.code === 'ETIMEDOUT' || error.killed ? -1 : (error.status || 1);

      // 处理错误中的 buffer 数据
      const stdoutStr = error.stdout ? this.decodeBuffer(error.stdout, encoding) : '';
      const stderrStr = error.stderr ? this.decodeBuffer(error.stderr, encoding) : error.message;

      const result = {
        stdout: stdoutStr.trim(),
        stderr: String(stderrStr).trim(),
        exitCode: exitCode,
      };

      return this.truncateOutput(result);
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
   * 截断过长的输出内容
   * @param result 命令执行结果对象
   * @returns 截断后的 JSON 字符串
   */
  private truncateOutput(result: { stdout: string; stderr: string; exitCode: number }): string {
    const MAX_LENGTH = 4000;
    const combinedOutput = result.stdout + result.stderr;

    // 如果总长度不超过限制，直接返回
    if (combinedOutput.length <= MAX_LENGTH) {
      return JSON.stringify(result);
    }

    // 计算需要截断的字符数
    const truncatedLength = combinedOutput.length - MAX_LENGTH;

    // 保留结尾部分
    const truncatedCombined = combinedOutput.slice(-MAX_LENGTH);

    // 简单地将截断后的内容分配给 stdout（保持 stderr 不变）
    const truncatedResult = {
      stdout: truncatedCombined,
      stderr: result.stderr,
      exitCode: result.exitCode,
      _truncated: true,
      _truncatedInfo: `输出已被截断，省略了前 ${truncatedLength} 个字符。如需查看完整输出，请调整命令或使用其他工具。`
    };

    return JSON.stringify(truncatedResult);
  }
}
