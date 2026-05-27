import { Injectable, Logger } from "@nestjs/common";
import { exec, ChildProcess } from "child_process";
import * as iconv from "iconv-lite";
import {
  IToolProvider,
  ToolCallRequest,
  ToolProviderMetadata,
  ToolDisplayInfo,
} from "../interfaces/tool-provider.interface";
import { InternalToolDefinition } from "../../llm-core/types/llm.types";

@Injectable()
export class ShellToolProvider implements IToolProvider {
  private readonly logger = new Logger(ShellToolProvider.name);
  public readonly namespace = "shell";

  private readonly toolsConfig: InternalToolDefinition[] = [
    {
      name: "execute_command",
      description: "执行系统 shell 命令并返回输出结果。超出2分钟会自动中止。命令执行可能耗时较长，请耐心等待结果。",
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

  constructor() { }

  async getTools(enabled?: boolean | string[], context?: Record<string, any>): Promise<any[]> {
    if (enabled === false) return [];

    // 如果是数组，只返回数组中指定的工具
    if (Array.isArray(enabled)) {
      return this.toolsConfig.filter(tool => enabled.includes(tool.name));
    }

    // true 或未指定：返回所有工具
    return this.toolsConfig;
  }

  async execute(request: ToolCallRequest, context?: Record<string, any>, abortSignal?: AbortSignal): Promise<string> {
    const handlers: Record<
      string,
      (args: any, ctx?: Record<string, any>, signal?: AbortSignal) => Promise<string>
    > = {
      execute_command: this.handleExecuteCommand.bind(this),
    };

    const handler = handlers[request.name];

    if (!handler) {
      throw new Error(`未知工具：${request.name}`);
    }

    return await handler(request.arguments, context, abortSignal);
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
   * 生成 Shell 工具的展示文案
   */
  formatDisplayMessage(toolName: string, args: Record<string, any>, isStreaming: boolean): ToolDisplayInfo {
    const prefix = isStreaming ? '正在' : '已';

    let action: string;
    let cmdArgs: string | undefined;

    if (toolName === 'execute_command') {
      const cmd = args.command;
      if (cmd) {
        action = `${prefix}执行命令`;
        // 提取命令的前50个字符作为参数摘要
        cmdArgs = cmd.length > 50 ? cmd.substring(0, 250) + '...' : cmd;
      } else {
        action = `${prefix}执行命令`;
      }
    } else {
      action = `${prefix}执行 Shell 操作`;
    }

    return {
      action,
      args: cmdArgs,
      toolName: `shell__${toolName}`
    };
  }

  /**
   * 执行 Shell 命令
   */
  private async handleExecuteCommand(args: any, context?: Record<string, any>, abortSignal?: AbortSignal): Promise<string> {
    const { command, working_directory, encoding } = args;

    // 验证命令参数
    if (!command || typeof command !== "string") {
      throw new Error("命令不能为空");
    }

    // 检查是否已中止
    if (abortSignal?.aborted) {
      this.logger.warn(`Shell command aborted before execution: ${command}`);
      throw new Error('Request was aborted');
    }

    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      this.logger.log(`执行命令: ${command}, 工作目录: ${working_directory || "当前目录"}, 编码: ${encoding || "自动检测"}`);

      const options: any = {
        timeout: 60000 * 2, // 2分钟超时
        maxBuffer: 1024 * 1024 * 10, // 10MB 最大输出
        encoding: "buffer", // 使用 buffer 接收原始字节数据，避免编码问题
      };

      if (working_directory) {
        options.cwd = working_directory;
      } else if (context?.workspacePath) {
        // 使用注入的工作路径
        options.cwd = context.workspacePath;
      }

      let abortHandler: (() => void) | null = null;
      let wasAborted = false; // 标记是否被主动中止

      const childProcess: ChildProcess = exec(command, options, async (error, stdout, stderr) => {
        // 清理事件监听器，防止命令执行完成后仍响应 abort 信号
        if (abortSignal && abortHandler) {
          abortSignal.removeEventListener('abort', abortHandler);
          abortHandler = null;
        }

        if (error) {
          // 如果是被中止的，直接拒绝
          if (wasAborted || error.killed || error.signal === 'SIGTERM' || error.signal === 'SIGKILL') {
            this.logger.warn(`Shell command killed due to abort: ${command}`);
            reject(new Error('Request was aborted (maybe timeout)'));
            return;
          }

          this.logger.error(`执行命令失败：${error.message}`);

          // 即使失败也返回 JSON，确保 AI 能获取到 stdout 中的任何潜在信息
          const exitCode = (error as any).code === 'ETIMEDOUT' || error.killed ? -1 : ((error as any).code || 1);

          // 处理错误中的 buffer 数据 - 优先使用回调参数中的 stdout/stderr
          const stdoutStr = stdout ? this.decodeBuffer(stdout, encoding) : '';
          const stderrStr = stderr ? this.decodeBuffer(stderr, encoding) : (error.message || '');

          const duration = Date.now() - startTime;
          const result = {
            stdout: stdoutStr.trim(),
            stderr: String(stderrStr).trim(),
            exitCode: exitCode,
            durationMs: duration,
          };

          resolve(this.truncateOutput(result));
        } else {
          // 将 Buffer 转换为字符串
          const stdoutStr = this.decodeBuffer(stdout, encoding);
          const stderrStr = this.decodeBuffer(stderr, encoding);

          // 构建返回结果
          const duration = Date.now() - startTime;
          const result = {
            stdout: stdoutStr.trim(),
            stderr: stderrStr.trim(),
            exitCode: 0,
            durationMs: duration,
          };

          resolve(this.truncateOutput(result));
        }
      });

      // 监听 abortSignal
      if (abortSignal) {
        abortHandler = () => {
          this.logger.warn(`Shell command aborted by signal: ${command}`);

          // 设置中止标记，让 exec 回调知道这是主动中止
          wasAborted = true;

          // 根据操作系统选择终止策略
          const isWindows = process.platform === 'win32';

          if (isWindows) {
            // Windows: 使用 taskkill 强制终止进程树
            try {
              const pid = childProcess.pid;
              if (pid) {
                // 使用 taskkill /F /T 强制终止进程及其子进程
                exec(`taskkill /F /T /PID ${pid}`, (killError) => {
                  if (killError) {
                    this.logger.warn(`Failed to kill process ${pid}: ${killError.message}`);
                  } else {
                    this.logger.log(`Successfully killed process tree for PID ${pid}`);
                  }
                });
              }
            } catch (error: any) {
              this.logger.error(`Error killing Windows process: ${error.message}`);
            }
          } else {
            // Unix-like: 先 SIGTERM，再 SIGKILL
            childProcess.kill('SIGTERM');

            setTimeout(() => {
              if (!childProcess.killed) {
                this.logger.warn(`Force killing shell process: ${command}`);
                childProcess.kill('SIGKILL');
              }
            }, 2000);
          }

          reject(new Error('Request was aborted'));
        };

        if (abortSignal.aborted) {
          abortHandler();
        } else {
          abortSignal.addEventListener('abort', abortHandler, { once: true });
        }
      }
    });
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
