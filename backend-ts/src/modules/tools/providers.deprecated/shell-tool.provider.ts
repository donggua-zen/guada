import { Injectable, Logger } from "@nestjs/common";
import { spawn, ChildProcess, exec } from "child_process";
import * as iconv from "iconv-lite";
import {
  IToolProvider,
  ToolCallRequest,
  ToolProviderMetadata,
  ToolDisplayInfo,
  ToolDefinition,
} from "../interfaces/tool-provider.interface";

/**
 * Shell 命令行工具提供者
 *
 * 提供系统命令执行能力，支持 120 秒超时和编码自动检测。
 * 设计原则：
 * - 单工具，无状态，不维护后台进程
 * - 命令等结果返回，超时即 kill
 * - 耗时操作通过 shell 重定向自行处理
 */
@Injectable()
export class ShellToolProvider implements IToolProvider {
  private readonly logger = new Logger(ShellToolProvider.name);
  public readonly pluginId = "shell";

  /** 120 秒超时 */
  private readonly CMD_TIMEOUT_MS = 120_000;
  /** 单条输出截断长度 */
  private readonly MAX_OUTPUT_LENGTH = 8000;

  private readonly toolsConfig: ToolDefinition[] = [
    {
      name: "execute",
      description: `执行系统命令并返回输出结果。
命令超时时间为 120 秒，超时后进程被终止，返回已收集的部分输出。
如需运行持续超过 120 秒的后台任务（如启动服务、监听端口等），
请在命令中自行使用系统工具将进程脱离当前控制台：
  Windows: mshta vbscript:CreateObject("WScript.Shell").Run("cmd /c start_command",0,false)(window.close)
  Unix:    nohup command > /dev/null 2>&1 &
注意：此类后台进程脱离后无法被超时机制终止，需要自行管理。`,
        parameters: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "要执行的系统命令",
            },
            encoding: {
              type: "string",
              description:
                "命令输出的编码格式。Windows 中文环境建议使用 'gbk'；Unix 默认 'utf-8'。不指定则自动检测。",
              enum: ["utf-8", "gbk", "gb2312", "gb18030", "big5", "latin1"],
            },
          },
          required: ["command"],
        },
    },
  ];

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
    if (request.name !== "execute") {
      throw new Error(`未知工具：${request.name}`);
    }

    return this.handleExecute(request.arguments, context, abortSignal);
  }

  async getPrompt(context?: Record<string, any>): Promise<string> {
    const isWindows = process.platform === "win32";

    return [
      "# Shell 命令行工具",
      "",
      `**当前系统**：${isWindows ? "Windows" : process.platform === "darwin" ? "macOS" : "Linux"}`,
      "",
      "## 执行行为",
      "- 命令执行后最多等待 **120 秒**，超时后进程将被终止",
      "- 超时或完成时返回输出内容（最多 8000 字符）",
      "",
      "## 后台任务",
      "如需运行持续超过 120 秒的任务（启动服务、监听端口等），",
      "需要在命令中将进程脱离当前控制台：",
      "",
      isWindows
        ? '- Windows：`mshta vbscript:CreateObject("WScript.Shell").Run("cmd /c 你的命令",0,false)(window.close)`'
        : '- Unix：`nohup 你的命令 > /dev/null 2>&1 &`',
      "",
      "注意：脱离后的进程不会被超时机制终止，请自行管理。",
      "",
      "## 安全提醒",
      "1. 删除或修改文件前务必确认操作安全",
      "2. 执行前先预览目标路径",
    ].join("\n");
  }

  async getBriefDescription(context?: Record<string, any>): Promise<string> {
    return "Shell 命令行执行工具，用于运行系统命令";
  }

  getMetadata(context?: Record<string, any>): ToolProviderMetadata {
    return {
      pluginId: this.pluginId,
      displayName: "Shell",
      description: "系统命令执行工具",
      isMcp: false,
      type: "core",
      promptFrequency: "STATIC",
    };
  }

  formatDisplayMessage(
    toolName: string,
    args: Record<string, any>,
    isExecuting: boolean,
  ): ToolDisplayInfo {
    const cmd = args.command;
    return {
      action: isExecuting ? "正在执行命令" : "已执行命令",
      args: cmd?.length > 60 ? cmd.substring(0, 60) + "..." : cmd,
      toolName: toolName,
    };
  }

  /**
   * 执行系统命令。
   *
   * stdout/stderr 分别通过 pipe 收集，进程退出或超时后统一返回。
   * 超时后先用 taskkill / SIGTERM 终止进程，再返回已收集的输出。
   */
  private async handleExecute(
    args: any,
    context?: Record<string, any>,
    abortSignal?: AbortSignal,
  ): Promise<string> {
    const command: string = args.command;
    if (!command || typeof command !== "string") {
      throw new Error("命令不能为空");
    }

    const encoding = args.encoding as string | undefined;
    const isWindows = process.platform === "win32";
    const shell = isWindows ? "cmd" : "sh";
    const shellFlag = isWindows ? "/c" : "-c";
    const cwd = context?.session.workspacePath || process.cwd();

    if (abortSignal?.aborted) {
      throw new Error("Request was aborted");
    }

    this.logger.log(`执行命令: ${command}, 工作目录: ${cwd}`);

    return new Promise<string>((resolve, reject) => {
      let stdoutBuffer = Buffer.alloc(0);
      let stderrBuffer = Buffer.alloc(0);
      let timedOut = false;
      let processExited = false;

      const childProcess: ChildProcess = spawn(shell, [shellFlag, command], { cwd });

      const timeoutId = setTimeout(() => {
        if (processExited) return;
        timedOut = true;
        this.logger.log(`命令超时 (${this.CMD_TIMEOUT_MS}ms): ${command}`);
        this.killProcess(childProcess, isWindows, command);
      }, this.CMD_TIMEOUT_MS);

      childProcess.stdout?.on("data", (chunk: Buffer) => {
        stdoutBuffer = Buffer.concat([stdoutBuffer, chunk]);
      });

      childProcess.stderr?.on("data", (chunk: Buffer) => {
        stderrBuffer = Buffer.concat([stderrBuffer, chunk]);
      });

      childProcess.on("close", (code) => {
        processExited = true;
        clearTimeout(timeoutId);

        if (timedOut) {
          const stdoutStr = this.decodeBuffer(stdoutBuffer, encoding);
          const stderrStr = this.decodeBuffer(stderrBuffer, encoding);
          resolve(JSON.stringify({
            status: "timeout",
            message: `命令执行超过 ${this.CMD_TIMEOUT_MS / 1000} 秒，进程已终止`,
            stdout: this.truncate(stdoutStr),
            stderr: this.truncate(stderrStr),
            exitCode: null,
          }));
          return;
        }

        const stdoutStr = this.decodeBuffer(stdoutBuffer, encoding);
        const stderrStr = this.decodeBuffer(stderrBuffer, encoding);
        resolve(JSON.stringify({
          status: "completed",
          exitCode: code ?? 0,
          stdout: this.truncate(stdoutStr),
          stderr: this.truncate(stderrStr),
        }));
      });

      childProcess.on("error", (err) => {
        processExited = true;
        clearTimeout(timeoutId);
        this.logger.error(`命令执行失败: ${err.message}`);
        resolve(JSON.stringify({
          status: "error",
          exitCode: 1,
          stderr: err.message,
        }));
      });

      if (abortSignal) {
        if (abortSignal.aborted) {
          clearTimeout(timeoutId);
          this.killProcess(childProcess, isWindows, command);
          reject(new Error("Request was aborted"));
          return;
        }
        abortSignal.addEventListener("abort", () => {
          clearTimeout(timeoutId);
          this.killProcess(childProcess, isWindows, command);
          reject(new Error("Request was aborted"));
        }, { once: true });
      }
    });
  }

  /** 截断过长的字符串，保留末尾 MAX_OUTPUT_LENGTH 字符 */
  private truncate(str: string): string {
    if (str.length <= this.MAX_OUTPUT_LENGTH) return str;
    return `...（前 ${str.length - this.MAX_OUTPUT_LENGTH} 字符已截断）\n${str.slice(-this.MAX_OUTPUT_LENGTH)}`;
  }

  /**
   * 解码 Buffer 为字符串。
   *
   * 优先使用指定的编码；未指定时 Windows 默认 gbk、Unix 默认 utf-8。
   * 解码失败时降级为 latin1（保证所有字节可表示）。
   */
  private decodeBuffer(buffer: Buffer, encoding?: string): string {
    if (!buffer || buffer.length === 0) return "";
    try {
      if (encoding) return iconv.decode(buffer, encoding);
      const isWindows = process.platform === "win32";
      return iconv.decode(buffer, isWindows ? "gbk" : "utf-8");
    } catch {
      return buffer.toString("latin1");
    }
  }

  /**
   * 终止进程。
   *
   * Windows 使用 taskkill /F /T 递归终止进程树；
   * Unix 先发 SIGTERM，2 秒后未退出则发 SIGKILL。
   */
  private killProcess(
    childProcess: ChildProcess,
    isWindows: boolean,
    command: string,
  ): void {
    if (isWindows) {
      try {
        const pid = childProcess.pid;
        if (pid) {
          exec(`taskkill /F /T /PID ${pid}`, (err) => {
            if (err) this.logger.warn(`taskkill 失败: ${err.message}`);
          });
        }
      } catch (error: any) {
        this.logger.error(`终止进程失败: ${error.message}`);
      }
    } else {
      childProcess.kill("SIGTERM");
      setTimeout(() => {
        if (!childProcess.killed) childProcess.kill("SIGKILL");
      }, 2000);
    }
  }
}
