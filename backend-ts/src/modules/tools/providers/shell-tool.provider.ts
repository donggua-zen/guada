import { Injectable, Logger } from "@nestjs/common";
import { spawn, ChildProcess, exec } from "child_process";
import * as iconv from "iconv-lite";
import {
  IToolProvider,
  ToolCallRequest,
  ToolProviderMetadata,
  ToolDisplayInfo,
} from "../interfaces/tool-provider.interface";
import { InternalToolDefinition } from "../../llm-core/types/llm.types";

/**
 * 终端会话状态
 */
interface TerminalSession {
  /** 进程实例 */
  process: ChildProcess;
  /** 标准输出缓冲区 */
  stdoutBuffer: Buffer;
  /** 标准错误缓冲区 */
  stderrBuffer: Buffer;
  /** 进程启动时间戳 */
  startTime: number;
  /** 最后访问时间戳 */
  lastAccessTime: number;
  /** 是否仍在运行 */
  isRunning: boolean;
  /** 执行的命令 */
  command: string;
  /** 工作目录 */
  workingDirectory: string;
  /** 退出码（进程结束后设置） */
  exitCode: number | null;
  /** 是否已返回后台提示 */
  backgroundNotified: boolean;
}

/**
 * 终止 spawn 创建的进程
 * Windows 使用 taskkill 终止进程树，Unix-like 先 SIGTERM 再 SIGKILL
 */
function killProcess(
  childProcess: ChildProcess,
  isWindows: boolean,
  command: string,
  logger: Logger,
): void {
  if (isWindows) {
    try {
      const pid = childProcess.pid;
      if (pid) {
        exec(`taskkill /F /T /PID ${pid}`, (killError) => {
          if (killError) {
            logger.warn(`Failed to kill process ${pid}: ${killError.message}`);
          } else {
            logger.log(`Successfully killed process tree for PID ${pid}`);
          }
        });
      }
    } catch (error: any) {
      logger.error(`Error killing Windows process: ${error.message}`);
    }
  } else {
    childProcess.kill("SIGTERM");
    setTimeout(() => {
      if (!childProcess.killed) {
        logger.warn(`Force killing shell process: ${command}`);
        childProcess.kill("SIGKILL");
      }
    }, 2000);
  }
}

@Injectable()
export class ShellToolProvider implements IToolProvider {
  private readonly logger = new Logger(ShellToolProvider.name);
  public readonly namespace = "shell";

  /** 会话级终端管理：sessionId -> TerminalSession */
  private readonly sessions = new Map<string, TerminalSession>();

  /** 后台运行超时时间（毫秒） */
  private readonly BACKGROUND_TIMEOUT_MS = 30000;
  /** 缓冲区最大大小（字节） */
  private readonly MAX_BUFFER_SIZE = 1024 * 1024;
  /** 单条输出截断长度 */
  private readonly MAX_OUTPUT_LENGTH = 4000;

  private readonly toolsConfig: InternalToolDefinition[] = [
    {
      name: "execute_command",
      description:
        "执行系统 shell 命令并返回输出结果。如果命令在30秒内完成，返回完整输出；如果超过30秒，命令会自动转入后台运行，此时返回后台运行提示。后续可使用 check_terminal_output 查看输出。启动新命令会自动结束同一会话的旧的控制台。",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "要执行的 shell 命令",
          },
          encoding: {
            type: "string",
            description:
              "命令输出的编码格式。Windows 中文环境建议使用 'gbk' 或 'gb2312'；Linux/macOS 通常使用 'utf-8'。如果不指定，系统将自动检测并尝试解码。",
            enum: ["utf-8", "gbk", "gb2312", "gb18030", "big5", "latin1"],
          },
        },
        required: ["command"],
      },
    },
    {
      name: "close_terminal",
      description:
        "关闭当前会话正在后台运行的控制台终端。如果控制台仍在运行，会强制终止进程。",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    {
      name: "check_terminal_output",
      description:
        "检查当前会话后台控制台的最新输出。每次读取后会自动清空已读缓冲区。",
      parameters: {
        type: "object",
        properties: {
          wait_seconds: {
            type: "number",
            description:
              "等待多少秒后再检查输出，避免频繁查询。最小值为 30 秒，最大值为 120 秒。",
          },
          encoding: {
            type: "string",
            description: "命令输出的编码格式。",
            enum: ["utf-8", "gbk", "gb2312", "gb18030", "big5", "latin1"],
          },
        },
        required: [],
      },
    },
  ];

  constructor() {}

  async getTools(
    enabled?: boolean | string[],
    context?: Record<string, any>,
  ): Promise<any[]> {
    if (enabled === false) return [];

    // 如果是数组，只返回数组中指定的工具
    if (Array.isArray(enabled)) {
      return this.toolsConfig.filter((tool) => enabled.includes(tool.name));
    }

    // true 或未指定：返回所有工具
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
      execute_command: this.handleExecuteCommand.bind(this),
      close_terminal: this.handleCloseTerminal.bind(this),
      check_terminal_output: this.handleCheckTerminalOutput.bind(this),
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
      promptParts.push("## 执行行为");
      promptParts.push("1. 命令执行后，如果 30 秒内完成，直接返回完整输出结果");
      promptParts.push(
        "2. 如果超过 30 秒仍未完成，命令会自动转入后台运行，此时返回后台运行提示",
      );
      promptParts.push(
        "3. 后台运行期间，使用 `check_terminal_output` 工具查看最新输出",
      );
      promptParts.push("4. 同一会话启动新命令时，会自动结束旧的后台控制台");
      promptParts.push("5. 可使用 `close_terminal` 手动终止后台运行的控制台");
      promptParts.push("");

      promptParts.push("**重要提醒**：");
      promptParts.push(
        "1. 这些工具极其危险，如果需要删除或者修改文件务必征得用户同意",
      );
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
      case "win32":
        return "Windows";
      case "darwin":
        return "macOS";
      case "linux":
        return "Linux";
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
      type: "core",
      // loadMode: "lazy",
    };
  }

  /**
   * 生成 Shell 工具的展示文案
   */
  formatDisplayMessage(
    toolName: string,
    args: Record<string, any>,
    isStreaming: boolean,
  ): ToolDisplayInfo {
    const prefix = isStreaming ? "正在" : "已";

    let action: string;
    let cmdArgs: string | undefined;

    if (toolName === "execute_command") {
      const cmd = args.command;
      if (cmd) {
        action = `${prefix}执行命令`;
        // 提取命令的前50个字符作为参数摘要
        cmdArgs = cmd.length > 50 ? cmd.substring(0, 250) + "..." : cmd;
      } else {
        action = `${prefix}执行命令`;
      }
    } else if (toolName === "close_terminal") {
      action = `${prefix}关闭终端`;
    } else if (toolName === "check_terminal_output") {
      action = `${prefix}等待终端输出`;
    } else {
      action = `${prefix}执行 Shell 操作`;
    }

    return {
      action,
      args: cmdArgs,
      toolName: `shell__${toolName}`,
    };
  }

  /**
   * 结束指定会话的终端进程并清理资源
   */
  private killSessionTerminal(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    const isWindows = process.platform === "win32";
    killProcess(session.process, isWindows, session.command, this.logger);
    this.sessions.delete(sessionId);
    this.logger.log(`已结束会话 ${sessionId} 的终端进程: ${session.command}`);
  }

  /**
   * 安全地追加数据到缓冲区，防止内存溢出
   */
  private appendBuffer(existing: Buffer, chunk: Buffer): Buffer {
    const newSize = existing.length + chunk.length;
    if (newSize > this.MAX_BUFFER_SIZE) {
      // 如果超过最大限制，保留后半部分
      const keepSize = Math.floor(this.MAX_BUFFER_SIZE / 2);
      const trimmed = existing.subarray(-keepSize);
      this.logger.warn(`终端输出缓冲区超限，已截断前半部分`);
      return Buffer.concat([trimmed, chunk]);
    }
    return Buffer.concat([existing, chunk]);
  }

  /**
   * 执行 Shell 命令（支持 30 秒后台运行模式）
   */
  private async handleExecuteCommand(
    args: any,
    context?: Record<string, any>,
    abortSignal?: AbortSignal,
  ): Promise<string> {
    const { command, encoding } = args;
    const sessionId = context?.sessionId as string | undefined;

    // 验证命令参数
    if (!command || typeof command !== "string") {
      throw new Error("命令不能为空");
    }

    // 检查是否已中止
    if (abortSignal?.aborted) {
      this.logger.warn(`Shell command aborted before execution: ${command}`);
      throw new Error("Request was aborted");
    }

    // 会话级控制台管理：启动新命令前结束旧的
    if (sessionId) {
      this.killSessionTerminal(sessionId);
    }

    const startTime = Date.now();
    const isWindows = process.platform === "win32";
    const shell = isWindows ? "cmd" : "sh";
    const shellFlag = isWindows ? "/c" : "-c";
    const cwd = context?.workspacePath || process.cwd();

    this.logger.log(
      `执行命令: ${command}, 工作目录: ${cwd}, 编码: ${encoding || "自动检测"}, 会话: ${sessionId || "无"}`,
    );

    return new Promise((resolve, reject) => {
      // 收集输出数据
      let stdoutBuffer = Buffer.alloc(0);
      let stderrBuffer = Buffer.alloc(0);
      let wasAborted = false;
      let abortHandler: (() => void) | null = null;
      let backgroundTimeoutId: NodeJS.Timeout | null = null;
      let processExited = false;

      // 创建 spawn 进程
      const childProcess: ChildProcess = spawn(shell, [shellFlag, command], {
        cwd,
      });

      // 注册终端会话（如果存在 sessionId）
      let terminalSession: TerminalSession | null = null;
      if (sessionId) {
        terminalSession = {
          process: childProcess,
          stdoutBuffer: Buffer.alloc(0),
          stderrBuffer: Buffer.alloc(0),
          startTime,
          lastAccessTime: startTime,
          isRunning: true,
          command,
          workingDirectory: cwd,
          exitCode: null,
          backgroundNotified: false,
        };
        this.sessions.set(sessionId, terminalSession);
      }

      // 30 秒后台运行超时
      backgroundTimeoutId = setTimeout(() => {
        if (processExited || wasAborted) {
          return;
        }

        this.logger.log(`命令超过 30 秒，转入后台运行: ${command}`);

        if (terminalSession) {
          terminalSession.backgroundNotified = true;
          terminalSession.lastAccessTime = Date.now();
        }

        // 返回后台运行提示，包含当前已收集的输出
        const stdoutStr = this.decodeBuffer(stdoutBuffer, encoding);
        const stderrStr = this.decodeBuffer(stderrBuffer, encoding);
        const result = {
          status: "background",
          message: "命令执行时间超过 30 秒，已转入后台运行。",
          hint: "请使用 check_terminal_output 工具查看输出进度，或使用 close_terminal 终止进程。",
        };
        resolve(
          this.truncateOutput({
            ...result,
            stdout: stdoutStr.trim(),
            stderr: stderrStr.trim(),
            exitCode: 0,
          }),
        );
      }, this.BACKGROUND_TIMEOUT_MS);

      // 监听 stdout 数据
      childProcess.stdout?.on("data", (chunk: any) => {
        const buf: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        stdoutBuffer = Buffer.concat([stdoutBuffer, buf]);
        if (terminalSession) {
          terminalSession.stdoutBuffer = this.appendBuffer(
            terminalSession.stdoutBuffer,
            buf,
          );
        }
      });

      // 监听 stderr 数据
      childProcess.stderr?.on("data", (chunk: any) => {
        const buf: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        stderrBuffer = Buffer.concat([stderrBuffer, buf]);
        if (terminalSession) {
          terminalSession.stderrBuffer = this.appendBuffer(
            terminalSession.stderrBuffer,
            buf,
          );
        }
      });

      // 进程关闭事件
      childProcess.on("close", (code, signal) => {
        processExited = true;

        if (backgroundTimeoutId) {
          clearTimeout(backgroundTimeoutId);
          backgroundTimeoutId = null;
        }
        if (abortSignal && abortHandler) {
          abortSignal.removeEventListener("abort", abortHandler);
          abortHandler = null;
        }

        if (terminalSession) {
          terminalSession.isRunning = false;
          terminalSession.exitCode = code ?? (signal ? -1 : 0);
        }

        // 如果已经返回了后台提示，不再 resolve
        if (terminalSession?.backgroundNotified) {
          this.logger.log(`后台命令已结束: ${command}, exitCode: ${code}`);
          return;
        }

        // 如果被主动中止
        if (wasAborted) {
          this.logger.warn(`Shell command killed due to abort: ${command}`);
          if (sessionId) {
            this.sessions.delete(sessionId);
          }
          reject(new Error("Request was aborted"));
          return;
        }

        const duration = Date.now() - startTime;

        // 解码输出
        const stdoutStr = this.decodeBuffer(stdoutBuffer, encoding);
        const stderrStr = this.decodeBuffer(stderrBuffer, encoding);

        // 构建返回结果
        const result = {
          stdout: stdoutStr.trim(),
          stderr: stderrStr.trim(),
          exitCode: code ?? (signal ? -1 : 0),
          durationMs: duration,
        };

        // 清理会话
        if (sessionId) {
          this.sessions.delete(sessionId);
        }

        resolve(this.truncateOutput(result));
      });

      // 进程错误事件
      childProcess.on("error", (error) => {
        processExited = true;

        if (backgroundTimeoutId) {
          clearTimeout(backgroundTimeoutId);
          backgroundTimeoutId = null;
        }
        if (abortSignal && abortHandler) {
          abortSignal.removeEventListener("abort", abortHandler);
          abortHandler = null;
        }

        this.logger.error(`执行命令失败：${error.message}`);

        // 如果已经返回了后台提示，不再处理
        if (terminalSession?.backgroundNotified) {
          if (sessionId) {
            this.sessions.delete(sessionId);
          }
          return;
        }

        const duration = Date.now() - startTime;
        const result = {
          stdout: this.decodeBuffer(stdoutBuffer, encoding).trim(),
          stderr: `${this.decodeBuffer(stderrBuffer, encoding).trim()}\n${error.message}`,
          exitCode: 1,
          durationMs: duration,
        };

        if (sessionId) {
          this.sessions.delete(sessionId);
        }

        resolve(this.truncateOutput(result));
      });

      // 监听 abortSignal
      if (abortSignal) {
        abortHandler = () => {
          this.logger.warn(`Shell command aborted by signal: ${command}`);
          wasAborted = true;

          if (backgroundTimeoutId) {
            clearTimeout(backgroundTimeoutId);
            backgroundTimeoutId = null;
          }

          killProcess(childProcess, isWindows, command, this.logger);

          if (sessionId) {
            this.sessions.delete(sessionId);
          }

          reject(new Error("Request was aborted"));
        };

        if (abortSignal.aborted) {
          abortHandler();
        } else {
          abortSignal.addEventListener("abort", abortHandler, { once: true });
        }
      }
    });
  }

  /**
   * 关闭当前会话的终端
   */
  private async handleCloseTerminal(
    args: any,
    context?: Record<string, any>,
  ): Promise<string> {
    const sessionId = context?.sessionId as string | undefined;

    if (!sessionId) {
      throw new Error("无法获取会话 ID，无法关闭终端");
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      return JSON.stringify({
        success: true,
        message: "当前会话没有正在运行的终端",
        sessionId,
      });
    }

    this.killSessionTerminal(sessionId);

    return JSON.stringify({
      success: true,
      message: "终端已关闭",
      command: session.command,
    });
  }

  /**
   * 检查当前会话终端的输出
   */
  private async handleCheckTerminalOutput(
    args: any,
    context?: Record<string, any>,
    abortSignal?: AbortSignal,
  ): Promise<string> {
    const sessionId = context?.sessionId as string | undefined;

    if (!sessionId) {
      throw new Error("无法获取会话 ID，无法检查终端输出");
    }

    // 检查是否已中止
    if (abortSignal?.aborted) {
      this.logger.warn(
        `check_terminal_output aborted before execution, session: ${sessionId}`,
      );
      throw new Error("Request was aborted");
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      return JSON.stringify({
        success: true,
        message: "当前会话没有正在运行的终端",
      });
    }

    // 处理等待时间，最小 30 秒，最大 120 秒
    const MIN_WAIT_SECONDS = 30;
    const MAX_WAIT_SECONDS = 120;
    let waitSeconds = args?.wait_seconds ?? 0;
    if (waitSeconds < MIN_WAIT_SECONDS) {
      waitSeconds = MIN_WAIT_SECONDS;
    }
    if (waitSeconds > MAX_WAIT_SECONDS) {
      waitSeconds = MAX_WAIT_SECONDS;
    }

    const actualWaitSeconds = waitSeconds;

    if (waitSeconds > 0) {
      this.logger.log(
        `check_terminal_output 等待 ${waitSeconds} 秒后检查输出，会话: ${sessionId}`,
      );
      await this.delayWithAbortSignal(waitSeconds * 1000, abortSignal);
    }

    // 等待后再次检查是否已中止
    if (abortSignal?.aborted) {
      this.logger.warn(
        `check_terminal_output aborted after wait, session: ${sessionId}`,
      );
      throw new Error("Request was aborted");
    }

    session.lastAccessTime = Date.now();

    const encoding = args?.encoding as string | undefined;
    let stdoutStr = this.decodeBuffer(session.stdoutBuffer, encoding);
    let stderrStr = this.decodeBuffer(session.stderrBuffer, encoding);

    // 进程仍在运行时清空缓冲区，已结束的进程保留缓冲区供后续检查
    if (session.isRunning) {
      session.stdoutBuffer = Buffer.alloc(0);
      session.stderrBuffer = Buffer.alloc(0);
    }

    // 使用统一的截断方法处理输出
    const checkResult = {
      stdout: stdoutStr.trim(),
      stderr: stderrStr.trim(),
      exitCode: session.isRunning ? 0 : (session.exitCode ?? 0),
    };
    const truncatedOutput = JSON.parse(this.truncateOutput(checkResult));
    stdoutStr = truncatedOutput.stdout;
    stderrStr = truncatedOutput.stderr;
    const truncatedInfo = truncatedOutput._truncatedInfo as string | undefined;

    // 如果进程已结束，返回最终结果并清理会话
    if (!session.isRunning) {
      const result: any = {
        success: true,
        isRunning: false,
        exitCode: session.exitCode,
        stdout: stdoutStr.trim(),
        stderr: stderrStr.trim(),
        actualWaitSeconds,
      };
      if (truncatedInfo) {
        result._truncatedInfo = truncatedInfo;
      }
      this.sessions.delete(sessionId);
      return JSON.stringify(result);
    }

    // 进程仍在运行，返回当前输出
    const result: any = {
      success: true,
      isRunning: true,
      stdout: stdoutStr.trim(),
      stderr: stderrStr.trim(),
      actualWaitSeconds,
    };

    if (truncatedInfo) {
      result._truncatedInfo = truncatedInfo;
    }

    return JSON.stringify(result);
  }

  /**
   * 支持 abortSignal 的延迟等待
   */
  private delayWithAbortSignal(
    ms: number,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        resolve();
      }, ms);

      if (abortSignal) {
        const abortHandler = () => {
          clearTimeout(timeoutId);
          reject(new Error("Request was aborted"));
        };

        if (abortSignal.aborted) {
          abortHandler();
        } else {
          abortSignal.addEventListener("abort", abortHandler, { once: true });
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
    if (typeof buffer === "string") {
      return buffer;
    }

    if (!buffer || buffer.length === 0) {
      return "";
    }

    try {
      // 如果 AI 指定了编码，直接使用
      if (encoding) {
        return iconv.decode(buffer, encoding);
      }

      // 否则根据操作系统自动选择编码
      const isWindows = process.platform === "win32";
      const defaultEncoding = isWindows ? "gbk" : "utf-8";

      return iconv.decode(buffer, defaultEncoding);
    } catch (error: any) {
      this.logger.warn(
        `解码失败 (${encoding || "auto"}): ${error.message}，使用 latin1 编码`,
      );
      // 解码失败时使用 latin1 编码，保证所有字节都能被表示
      return buffer.toString("latin1");
    }
  }

  /**
   * 截断过长的输出内容（stdout 和 stderr 独立截断）
   * @param result 命令执行结果对象
   * @returns 截断后的 JSON 字符串
   */
  private truncateOutput(result: {
    stdout: string;
    stderr: string;
    exitCode: number;
    durationMs?: number;
  }): string {
    const MAX_LENGTH = this.MAX_OUTPUT_LENGTH;
    let truncatedInfo: string | undefined;
    let stdout = result.stdout;
    let stderr = result.stderr;

    // stdout 和 stderr 独立截断
    if (stdout.length > MAX_LENGTH) {
      const omitted = stdout.length - MAX_LENGTH;
      stdout = stdout.slice(-MAX_LENGTH);
      truncatedInfo = `stdout 已截断，仅保留末尾 ${MAX_LENGTH} 字符。`;
    }

    if (stderr.length > MAX_LENGTH) {
      const omitted = stderr.length - MAX_LENGTH;
      stderr = stderr.slice(-MAX_LENGTH);
      const stderrInfo = `stderr 已截断，仅保留末尾 ${MAX_LENGTH} 字符。`;
      truncatedInfo = truncatedInfo
        ? `${truncatedInfo} ${stderrInfo}`
        : stderrInfo;
    }

    const truncatedResult: any = {
      ...result,
      stdout,
      stderr,
    };

    if (truncatedInfo) {
      truncatedResult._truncatedInfo = truncatedInfo;
    }

    return JSON.stringify(truncatedResult);
  }
}
