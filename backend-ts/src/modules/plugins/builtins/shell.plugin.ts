import { Injectable, Logger } from "@nestjs/common";
import { spawn, ChildProcess, exec } from "child_process";
import * as iconv from "iconv-lite";
import { PluginBase } from "../base-plugin";
import { PluginContext } from "../types/plugin.types";
import { PluginApi, ToolResult } from "../api/plugin-api";
import { z } from "zod";

@Injectable()
export class ShellPlugin extends PluginBase {
  private readonly logger = new Logger(ShellPlugin.name);
  private readonly CMD_TIMEOUT_MS = 120_000;
  private readonly MAX_OUTPUT_LENGTH = 8000;

  manifest = {
    id: "shell",
    name: "Shell 命令行",
    description: "执行系统命令",
    version: "1.0.0",
    category: "core" as const,
  };

  async onLoad(api: PluginApi) {
    api.registerTool({
      name: "execute",
      description: `执行系统命令并返回输出结果。
命令超时时间为 120 秒，超时后进程被终止，返回已收集的部分输出。
如需运行持续超过 120 秒的后台任务（如启动服务、监听端口等），
请在命令中自行使用系统工具将进程脱离当前控制台：
  Windows: mshta vbscript:CreateObject("WScript.Shell").Run("cmd /c start_command",0,false)(window.close)
  Unix:    nohup command > /dev/null 2>&1 &
注意：此类后台进程脱离后无法被超时机制终止，需要自行管理。`,
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
            (v) => !v || ["utf-8", "gbk", "gb2312", "gb18030", "big5", "latin1"].includes(v),
            { message: "不支持的编码格式" },
          ),
      }),
      execute: async (args, ctx, abortSignal) => {
        const command: string = args.command;
        if (!command || typeof command !== "string")
          throw new Error("命令不能为空");
        const encoding = args.encoding;
        const isWindows = process.platform === "win32";
        const shell = isWindows ? "cmd" : "sh";
        const shellFlag = isWindows ? "/c" : "-c";
        const cwd = ctx?.workspacePath || process.cwd();

        if (abortSignal?.aborted) throw new Error("Request was aborted");
        this.logger.log(`执行命令: ${command}, 工作目录: ${cwd}`);

        return new Promise<ToolResult>((resolve, reject) => {
          let stdoutBuffer = Buffer.alloc(0);
          let stderrBuffer = Buffer.alloc(0);
          let timedOut = false;
          let processExited = false;

          const childProcess: ChildProcess = spawn(
            shell,
            [shellFlag, command],
            { cwd },
          );

          const timeoutId = setTimeout(() => {
            if (processExited) return;
            timedOut = true;
            this.killProcess(childProcess, isWindows);
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
            const stdoutStr = this.decodeBuffer(stdoutBuffer, encoding);
            const stderrStr = this.decodeBuffer(stderrBuffer, encoding);
            if (timedOut) {
              resolve({
                status: "timeout",
                stdout: this.truncate(stdoutStr),
                stderr: this.truncate(stderrStr),
              });
            } else {
              resolve({
                status: "completed",
                exitCode: code ?? 0,
                stdout: this.truncate(stdoutStr),
                stderr: this.truncate(stderrStr),
              });
            }
          });
          childProcess.on("error", (err) => {
            processExited = true;
            clearTimeout(timeoutId);
            resolve({
              status: "error",
              exitCode: 1,
              stderr: err.message,
            });
          });

          if (abortSignal) {
            const onAbort = () => {
              clearTimeout(timeoutId);
              this.killProcess(childProcess, isWindows);
              reject(new Error("Request was aborted"));
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

    api.registerPrompt({
      frequency: "STATIC",
      description: "Shell 工具使用说明和安全提醒",
      content: () => {
        const isWindows = process.platform === "win32";
        return [
          "# Shell 命令行工具",
          "",
          `**当前系统**：${isWindows ? "Windows" : process.platform === "darwin" ? "macOS" : "Linux"}`,
          "## 执行行为",
          "- 命令执行后最多等待 **120 秒**，超时后进程将被终止",
          "- 超时或完成时返回输出内容（最多 8000 字符）",
          "## 后台任务",
          "如需运行超过 120 秒的任务，需要在命令中将进程脱离当前控制台",
          isWindows
            ? '- Windows：`mshta vbscript:...Run("cmd /c 你的命令",0,false)(window.close)`'
            : "- Unix：`nohup 你的命令 > /dev/null 2>&1 &`",
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
