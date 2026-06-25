import { Injectable, Logger } from "@nestjs/common";
import { spawn, ChildProcess, exec } from "child_process";
import * as iconv from "iconv-lite";
import { PluginBase } from "../plugins/base-plugin";
import { PluginContext } from "../plugins/types/plugin.types";
import { PluginApi, ToolResult } from "../plugins/api/plugin-api";
import { z } from "zod";
import { ProcessManagerService } from "./process-manager.service";

@Injectable()
export class ShellPlugin extends PluginBase {
  private readonly logger = new Logger(ShellPlugin.name);
  private readonly CMD_TIMEOUT_MS = 120_000;
  /** 自动转入后台的阈值（1分钟） */
  private readonly BACKGROUND_THRESHOLD_MS = 60_000;
  private readonly MAX_OUTPUT_LENGTH = 8000;
  /** 返回给 AI 的最大行数 */
  private readonly MAX_OUTPUT_LINES = 50;

  constructor(private readonly processManager: ProcessManagerService) {
    super();
  }

  manifest = {
    id: "shell",
    name: "Shell 命令行",
    description: "执行系统命令和管理后台进程",
    version: "1.1.0",
    category: "core" as const,
  };

  async onLoad(api: PluginApi) {
    // ── execute 工具 ──
    api.registerTool({
      name: "execute",
      description: `执行系统命令并返回输出结果。
命令执行超过 1 分钟会自动转入后台运行（返回 processId）。
如需立即转入后台，设置 "background": true 即可。

后台进程可通过 process 工具管理：
- process({"action": "poll", "processId": "..."}) 获取自上次轮询后的新输出
- process({"action": "kill", "processId": "..."}) 终止进程
- process({"action": "modify_silent_monitoring", "processId": "...", "silentMinutes": N}) 设置静默超时通知

进程执行结束或发生异常时，系统会自动发送通知。`,
      inputSchema: z.object({
        command: z
          .string()
          .describe(
            "要执行的系统命令，如 ls -la、echo hello、node script.js 等",
          ),
        encoding: z
          .string()
          .optional()
          .describe(
            "命令输出的编码格式。Windows 中文环境建议使用 'gbk'；Unix 默认 'utf-8'。不指定则自动检测",
          )
          .refine(
            (v) =>
              !v ||
              ["utf-8", "gbk", "gb2312", "gb18030", "big5", "latin1"].includes(
                v,
              ),
            { message: "不支持的编码格式" },
          ),
        background: z
          .boolean()
          .optional()
          .describe(
            "是否立即以后台模式运行，默认为 false。设为 true 则立刻返回进程 ID，不等待执行结束",
          ),
      }),
      execute: async (args, ctx, abortSignal) => {
        const command: string = args.command;
        if (!command || typeof command !== "string")
          throw new Error("命令不能为空");
        const encoding = args.encoding as string | undefined;
        const background = args.background === true;
        const isWindows = process.platform === "win32";
        const shell = isWindows ? "cmd" : "sh";
        const shellFlag = isWindows ? "/c" : "-c";
        const cwd = ctx?.workspacePath || process.cwd();

        if (abortSignal?.aborted) throw new Error("Request was aborted");
        this.logger.log(
          `执行命令: ${command}, 工作目录: ${cwd}, background: ${background}`,
        );

        // ── 显式后台模式：立即转入后台 ──
        if (background) {
          const childProcess = spawn(shell, [shellFlag, command], { cwd });
          const result = this.processManager.background(
            childProcess,
            command,
            cwd,
            encoding,
            ctx?.sessionId || "",
            ctx?.userId || "",
          );
          return {
            status: "backgrounded",
            processId: result.processId,
            stdout: result.stdout,
            stderr: result.stderr,
            logPath: result.logPath,
            message: `进程已转入后台运行，ID: ${result.processId}。可使用 process 工具进行管理。`,
          };
        }

        // ── 前台模式：等待执行，超时自动转入后台 ──
        return new Promise<ToolResult>((resolve) => {
          let stdoutBuffer = Buffer.alloc(0);
          let stderrBuffer = Buffer.alloc(0);
          let timedOut = false;
          let processExited = false;
          let autoBackgrounded = false;

          const childProcess: ChildProcess = spawn(
            shell,
            [shellFlag, command],
            { cwd },
          );

          // 自动转入后台定时器（1 分钟）
          const backgroundTimer = setTimeout(() => {
            if (processExited || autoBackgrounded) return;
            autoBackgrounded = true;
            this.logger.log(
              `命令执行超过 ${this.BACKGROUND_THRESHOLD_MS / 1000}s，自动转入后台: ${command}`,
            );

            const stdoutStr = this.decodeBuffer(stdoutBuffer, encoding);
            const stderrStr = this.decodeBuffer(stderrBuffer, encoding);
            const stdoutLines = stdoutStr
              .split("\n")
              .filter((l: string) => l.length > 0);
            const stderrLines = stderrStr
              .split("\n")
              .filter((l: string) => l.length > 0);

            const result = this.processManager.background(
              childProcess,
              command,
              cwd,
              encoding,
              ctx?.sessionId || "",
              ctx?.userId || "",
              stdoutLines,
              stderrLines,
            );

            resolve({
              status: "backgrounded",
              processId: result.processId,
              stdout: stdoutLines.slice(-this.MAX_OUTPUT_LINES),
              stderr: stderrLines.slice(-this.MAX_OUTPUT_LINES),
              logPath: result.logPath,
              message: `命令执行超过 ${this.BACKGROUND_THRESHOLD_MS / 1000} 秒，已自动转入后台运行，ID: ${result.processId}。可使用 process 工具进行管理。`,
            });
          }, this.BACKGROUND_THRESHOLD_MS);

          childProcess.stdout?.on("data", (chunk: Buffer) => {
            stdoutBuffer = Buffer.concat([stdoutBuffer, chunk]);
          });
          childProcess.stderr?.on("data", (chunk: Buffer) => {
            stderrBuffer = Buffer.concat([stderrBuffer, chunk]);
          });
          childProcess.on("close", (code) => {
            if (autoBackgrounded) return; // 已转入后台，不再处理
            processExited = true;
            clearTimeout(backgroundTimer);
            const stdoutStr = this.decodeBuffer(stdoutBuffer, encoding);
            const stderrStr = this.decodeBuffer(stderrBuffer, encoding);
            resolve({
              status: "completed",
              exitCode: code ?? 0,
              stdout: this.truncate(stdoutStr),
              stderr: this.truncate(stderrStr),
            });
          });
          childProcess.on("error", (err) => {
            if (autoBackgrounded) return;
            processExited = true;
            clearTimeout(backgroundTimer);
            resolve({
              status: "error",
              exitCode: 1,
              stderr: err.message,
            });
          });

          if (abortSignal) {
            const onAbort = () => {
              if (autoBackgrounded) return;
              clearTimeout(backgroundTimer);
              this.killProcess(childProcess, isWindows);
              resolve({
                status: "error",
                exitCode: 1,
                stderr: "Request was aborted",
              });
            };
            if (abortSignal.aborted) {
              onAbort();
              return;
            }
            abortSignal.addEventListener("abort", onAbort, { once: true });
          }
        });
      },
      display: { action: "执行命令", argsKey: "command", icon: "shell" },
      dangerLevel: "critical",
    });

    // ── process 管理工具 ──
    api.registerTool({
      name: "process",
      description: `管理后台进程。支持三个操作：
1. poll: 轮询进程状态和自上次 poll 以来的新输出（最多 50 行），不重复
2. kill: 终止后台进程
3. modify_silent_monitoring: 修改静默监控时间（分钟），0=关闭监控

进程执行结束或静默超时时，系统会自动发送通知。`,
      inputSchema: z.object({
        action: z.enum(["kill", "poll", "modify_silent_monitoring"]),
        processId: z.string().describe("后台进程 ID"),
        timeout: z
          .number()
          .optional()
          .describe("poll 阻塞等待时间（秒，最小 30s）")
          .default(30),
        silentMinutes: z
          .number()
          .optional()
          .describe(
            "静默监控时间（分钟），0=关闭监控。仅 modify_silent_monitoring 使用",
          ),
      }),
      execute: async (args, ctx) => {
        const { action, processId } = args;

        switch (action) {
          case "kill": {
            const status = this.processManager.kill(processId);
            if (status === null) {
              return {
                status: "error",
                message: `进程 ${processId} 不存在或已结束`,
              };
            }
            return {
              status: "killed",
              processId,
              message: `进程 ${processId} 已终止（状态: ${status}）`,
            };
          }

          case "poll": {
            const timeoutMs = (args.timeout || 0) * 1000;
            const result = await this.processManager.poll(
              processId, timeoutMs, ctx?.sessionId,
            );
            if (result === null) {
              return {
                status: "error",
                message: `进程 ${processId} 不存在`,
              };
            }
            return {
              status: result.status,
              processId: result.processId,
              exitCode: result.exitCode,
              newStdout: result.newStdout,
              newStderr: result.newStderr,
              stdoutLineCount: result.newStdout.length,
              stderrLineCount: result.newStderr.length,
              logPath: result.logPath,
            };
          }

          case "modify_silent_monitoring": {
            const minutes = args.silentMinutes ?? 0;
            const entry = this.processManager.updateSilentMonitoring(
              processId,
              minutes,
            );
            if (entry === null) {
              return {
                status: "error",
                message: `进程 ${processId} 不存在`,
              };
            }
            const msg =
              minutes > 0
                ? `静默监控已开启，${minutes} 分钟无输出将收到通知`
                : "静默监控已关闭";
            return {
              status: "ok",
              processId,
              silentMonitoringMinutes: minutes,
              message: msg,
            };
          }

          default:
            return {
              status: "error",
              message: `未知操作: ${action}`,
            };
        }
      },
      display: { action: "管理进程", argsKey: "action", icon: "terminal" },
      dangerLevel: "high",
    });

    // ── Prompt ──
    api.registerPrompt({
      frequency: "STATIC",
      description: "Shell 工具使用说明和安全提醒",
      content: () => {
        const isWindows = process.platform === "win32";
        return [
          "# Shell 命令行工具",
          "",
          `**当前系统**：${isWindows ? "Windows" : process.platform === "darwin" ? "macOS" : "Linux"}`,
          "",
          "## 执行行为",
          "- 命令默认前台执行，等待完成后返回输出（最多 8000 字符）",
          '- 设置 `"background": true` 可将命令立即转入后台运行，返回进程 ID',
          "- 前台命令执行超过 **1 分钟** 也会自动转入后台模式执行",
          "",
          "## 后台进程管理",
          "使用 **process** 工具管理后台进程：",
          "- `poll` — 获取自上次轮询以来的新输出（最多 50 行），支持阻塞等待新数据",
          "- `kill` — 终止指定进程",
          "- `modify_silent_monitoring` — 设置静默超时通知（N 分钟无输出时自动通知）",
          "",
          "## 系统通知",
          "- 后台进程执行结束、异常退出或静默超时，会自动收到系统通知",
          "- 完整输出日志保存在本地文件系统中",
          "- 如果你在执行其他任务可以通过poll顺带查看进度，切勿循环轮询等待，因为系统会主动通知",
          "- 已经通过poll查收的消息不会再次被系统通知（如进程退出事件）",
          "",
          "## 安全提醒",
          "1. 删除或修改文件前务必确认操作安全",
          "2. 执行前先预览目标路径",
        ].join("\n");
      },
    });
  }

  private truncate(str: string): string {
    if (str.length <= this.MAX_OUTPUT_LENGTH) return str;
    return `...（前 ${str.length - this.MAX_OUTPUT_LENGTH} 字符已截断）\n${str.slice(-this.MAX_OUTPUT_LENGTH)}`;
  }

  private decodeBuffer(buffer: Buffer, encoding?: string): string {
    if (!buffer || buffer.length === 0) return "";
    try {
      if (encoding) return iconv.decode(buffer, encoding);
      return iconv.decode(
        buffer,
        process.platform === "win32" ? "gbk" : "utf-8",
      );
    } catch {
      return buffer.toString("latin1");
    }
  }

  private killProcess(childProcess: ChildProcess, isWindows: boolean): void {
    if (isWindows) {
      const pid = childProcess.pid;
      if (pid) exec(`taskkill /F /T /PID ${pid}`, () => {});
    } else {
      childProcess.kill("SIGTERM");
      setTimeout(() => {
        if (!childProcess.killed) childProcess.kill("SIGKILL");
      }, 2000);
    }
  }
}
