import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { spawn } from "child_process";
import * as path from "path";
import * as fs from "fs/promises";
import { PluginBase } from "../plugins/base-plugin";
import { PluginApi } from "../plugins/api/plugin-api";
import { z } from "zod";
import { ProcessManagerService } from "./process-manager.service";
import { PluginContext } from "../plugins/types/plugin.types";
import { StreamFinishedEvent } from "../../common/events/stream.events";

@Injectable()
export class ShellPlugin extends PluginBase {
  private readonly logger = new Logger(ShellPlugin.name);
  /** 自动转入后台的阈值（1分钟） */
  private readonly BACKGROUND_THRESHOLD_MS = 60_000;

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
      name: "terminal",
      description: `执行系统命令并返回输出结果,命令执行超过 1 分钟会自动转入后台运行,"background": true立即转入后台`,
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
        const cwd = ctx?.session.workspacePath || process.cwd();

        if (abortSignal?.aborted) throw new Error("Request was aborted");
        this.logger.log(
          `执行命令: ${command}, 工作目录: ${cwd}, background: ${background}`,
        );

        // 统一启动进程并转入后台管理（所有 stdout/stderr 由 ProcessManager 接管）
        const childProcess = spawn(shell, [shellFlag, command], { cwd });
        const result = this.processManager.background(
          childProcess,
          command,
          cwd,
          encoding,
          ctx?.session.sessionId || "",
          ctx?.session.userId || "",
          { notify: ctx?.session.sessionType !== "sub_agent" },
        );

        // 纯后台模式：立即返回
        if (background) {
          return {
            success: true,
            processId: result.processId,
            output: result.output,
            message: `进程已转入后台运行，ID: ${result.processId}。可使用 process 工具进行管理。`,
          };
        }

        // 前台模式：内部 poll 等待结果，支持 abortSignal
        if (abortSignal?.aborted) {
          this.processManager.kill(result.processId);
          return { success: false, message: "请求已被中止" };
        }
        const onAbort = () => this.processManager.kill(result.processId);
        abortSignal?.addEventListener("abort", onAbort, { once: true });

        try {
          const pollResult = await this.processManager.poll(
            result.processId,
            this.BACKGROUND_THRESHOLD_MS,
            ctx?.session.sessionId,
          )!;

          // 进程在 1 分钟内结束了 → 返回结果
          if (pollResult.status !== "running") {
            return {
              success: true,
              processStatus: pollResult.status,
              exitCode: pollResult.exitCode,
              output: pollResult.output,
              lineCount: pollResult.output
                ? pollResult.output.split("\n").length
                : 0,
              message: `命令执行完毕，退出码: ${pollResult.exitCode}`,
            };
          }

          // 1 分钟超时，进程还在跑 → 返回 backgrounded（含已收集的输出）
          return {
            success: true,
            processId: result.processId,
            output: pollResult.output,
            lineCount: pollResult.output
              ? pollResult.output.split("\n").length
              : 0,
            message: `命令执行超过 ${this.BACKGROUND_THRESHOLD_MS / 1000} 秒，已自动转入后台运行,可使用 process 工具进行管理。`,
          };
        } finally {
          abortSignal?.removeEventListener("abort", onAbort);
        }
      },
      display: { action: "执行命令", argsKey: "command", icon: "shell" },
      dangerLevel: "critical",
    });

    // ── process 管理工具 ──
    api.registerTool({
      name: "process",
      description: `管理后台进程`,
      inputSchema: z.object({
        action: z.enum([
          "kill",
          "poll",
          "modify_progress_monitoring",
          "dump_log",
          "write",
        ]),
        processId: z.string().describe("后台进程 ID"),
        params: z
          .record(z.string(), z.any())
          .optional()
          .describe(
            "各操作的附加参数，统一放入此对象中。详见工具描述和系统提示",
          ),
      }),
      execute: async (args, ctx) => {
        const {
          action,
          processId,
          params = {},
        } = args as {
          action: string;
          processId: string;
          params?: Record<string, any>;
        };

        switch (action) {
          case "kill": {
            const status = this.processManager.kill(processId);
            if (status === null) {
              return {
                success: false,
                message: `进程 ${processId} 不存在或已结束`,
              };
            }
            return {
              success: true,
              processId,
              processStatus: status,
              message: `进程 ${processId} 已终止（状态: ${status}）`,
            };
          }

          case "poll": {
            const timeoutMs = (params.timeout || 0) * 1000;
            const result = await this.processManager.poll(
              processId,
              timeoutMs,
              ctx?.session.sessionId,
            );
            if (result === null) {
              return { success: false, message: `进程 ${processId} 不存在` };
            }
            return {
              success: true,
              processId,
              processStatus: result.status,
              exitCode: result.exitCode,
              output: result.output,
              lineCount: result.output ? result.output.split("\n").length : 0,
            };
          }

          case "modify_progress_monitoring": {
            const minutes = params.intervalMinutes ?? 30;
            const entry = this.processManager.updateProgressMonitoring(
              processId,
              minutes,
            );
            if (entry === null) {
              return { success: false, message: `进程 ${processId} 不存在` };
            }
            const actualMinutes = entry.progressIntervalMinutes;
            const msg =
              actualMinutes > 0
                ? `进度通知已开启，每 ${actualMinutes} 分钟报告一次。可根据需要调整频率，若无需持续监控请设置 0 关闭提醒。`
                : "进度通知已关闭";
            return {
              success: true,
              processId,
              progressIntervalMinutes: actualMinutes,
              message: msg,
            };
          }

          case "dump_log": {
            const entry = this.processManager.getRawEntry(processId);
            if (!entry) {
              return { success: false, message: `进程 ${processId} 不存在` };
            }
            if (!entry.fullLog && !entry.output) {
              return {
                success: true,
                processId,
                message: `进程 ${processId} 无输出日志`,
              };
            }

            const targetPath =
              params.file_path ||
              path.join(".guada", "process", "exports", `${processId}.log`);
            const cwd = ctx?.session.workspacePath || process.cwd();
            const resolved = path.resolve(cwd, targetPath);

            // 安全检查：确保导出路径在工作目录内
            const workspaceNorm = cwd.replace(/\\/g, "/").replace(/\/$/, "");
            const resolvedNorm = resolved.replace(/\\/g, "/");
            if (
              !resolvedNorm.startsWith(workspaceNorm + "/") &&
              resolvedNorm !== workspaceNorm
            ) {
              return {
                success: false,
                message: `导出路径不在工作目录内: ${resolved}`,
              };
            }

            await fs.mkdir(path.dirname(resolved), { recursive: true });
            await fs.writeFile(resolved, entry.fullLog || "", "utf-8");

            // 已导出到磁盘，立即释放内存缓冲区
            this.processManager.removeProcess(processId);

            return {
              success: true,
              processId,
              message: `日志已导出到 ${resolved}，共 ${(entry.fullLog || "").length} 字符`,
              file_path: resolved,
            };
          }

          case "write": {
            const input = params.input;
            if (!input || typeof input !== "string") {
              return { success: false, message: "params.input 不能为空" };
            }

            const entry = this.processManager.getRawEntry(processId);
            if (!entry) {
              return { success: false, message: `进程 ${processId} 不存在` };
            }
            if (entry.status !== "running") {
              return {
                success: false,
                message: `进程 ${processId} 已结束，无法写入`,
              };
            }

            if (!entry.childProcess.stdin) {
              return {
                success: false,
                message: `进程 ${processId} 的 stdin 不可用`,
              };
            }

            const appendNewline = params.appendNewline !== false;
            const textToWrite = appendNewline ? input + "\n" : input;

            entry.childProcess.stdin.write(textToWrite);

            return {
              success: true,
              processId,
              message: `已向进程 ${processId} 写入 ${textToWrite.length} 字符`,
              input: input,
            };
          }

          default:
            return { success: false, message: `未知操作: ${action}` };
        }
      },
      display: { action: "管理进程", argsKey: "action", icon: "terminal" },
      dangerLevel: "high",
    });

    // ── Prompt ──
    api.registerPrompt({
      frequency: "STATIC",
      description: "Shell 工具使用说明和安全提醒",
      content: (ctx: PluginContext) => {
        const isWindows = process.platform === "win32";
        const isNotSubAgent = ctx?.session?.sessionType !== "sub_agent";
        return `# 命令行工具使用说明
          
**当前系统**：${isWindows ? "Windows" : process.platform === "darwin" ? "macOS" : "Linux"}
          
## 命令执行
- 使用 \`terminal\` 命令执行command命令
- 命令默认前台执行，等待完成后返回输出（最多 8000 字符）
- 前台命令执行超过 **1 分钟** 会自动转入后台模式执行
- processId一般是shell壳的进程ID，不是命令本身进程ID
## 后台进程管理
- 使用 **process** 工具管理后台进程，附加参数统一放入 params 对象中：
- **kill** — 终止进程，无需 params：
  \`{"action":"kill","processId":"xxx"}\`
- **poll** — 查看新输出，可选 params.timeout（秒，最小 30）：
   \`{"action":"poll","processId":"xxx","params":{"timeout":30}}\`
${
  isNotSubAgent
    ? `
- **modify_progress_monitoring** — 设置系统自动监控报告间隔，intervalMinutes（分钟，0=关闭，默认30）：
    \`{"action":"modify_progress_monitoring","processId":"xxx","params":{"intervalMinutes":30}}\`
- 默认已经开启，设置 0 关闭。非0值不得低于15分钟`
    : ""
}
- **dump_log** — 导出完整日志，可选 params.file_path：
  \`{"action":"dump_log","processId":"xxx","params":{"file_path":"logs/my.log"}}\`
- **write** — 向进程 stdin 写入输入，必填 params.input，可选 params.appendNewline（默认 true）：
    \`{"action":"write","processId":"xxx","params":{"input":"y"}}\`
## 后台任务最佳实践
- 优先使用前台任务执行以获取初期输出判断是否正常启动
- 优先使用process(action=kill,processId=...)杀死进程          
 ${
   isNotSubAgent
     ? `
- 转入后台后可并行其他工作，或结束本轮对话等待系统通知
- 后台进程执行结束会自动收到系统通知,无需持续轮询
- 已经通过poll查收的消息不会再次被系统通知
- 长时间任务（预期>30分钟）利用进度通知（已默认开启）及时了解任务进度,短时间任务不必特意关闭监控（利用默认30分钟间隔做兜底）`
     : `- 结束对话后，会自动终止所有后台进程，务必使用POLL等待进程结束`
 }`;
      },
    });
  }

  /**
   * 子 Agent 流结束时，自动杀死该会话下的所有后台进程
   */
  @OnEvent("stream.finished")
  handleStreamFinished(event: StreamFinishedEvent): void {
    if (event.payload.sessionType !== "sub_agent") return;

    const processes = this.processManager.listBySession(event.sessionId);
    for (const proc of processes) {
      if (proc.status !== "running") continue;
      this.processManager.kill(proc.id);
      this.logger.log(`子 Agent 流结束，自动终止后台进程: ${proc.id}`);
    }
  }
}
