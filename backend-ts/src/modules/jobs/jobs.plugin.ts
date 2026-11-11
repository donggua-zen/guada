import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { PluginBase } from "../plugins/base-plugin";
import { PluginApi } from "../plugins/api/plugin-api";
import { RolePluginConfig } from "../plugins/types/plugin.types";
import { isToolkitAllowedByRoleConfig } from "../plugins/utils/role-toolkit-filter";
import { JobRegistryService } from "./job-registry.service";
import type { JobId, JobSnapshot } from "./job.types";
import { JOB_READ_DEFAULT_MAX_BYTES, isByteLogJobKind } from "./job.types";
import langZh from "./jobs.lang.zh.json";
import langEn from "./jobs.lang.en.json";

/** job_read 的 wait_ms 上限（缺省/0 = 不阻塞，由调用方显式给出等待时长） */
const WAIT_MAX_MS = 10 * 60_000;

/** 字节数的人类可读形式，只用于给模型的提示文案 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/**
 * 后台作业的唯一模型工具集：job_read / job_list / job_stop / job_send。
 *
 * 一切后台工作（shell / remote / subagent / workflow / scheduler）结算后都持有
 * 稳定 jobId；发起工具（run_command / subagent_spawn）前台返回结果、后台返回 jobId。
 * 这四个动词覆盖后台交互的全部需求：读、列、停、发输入。
 */
@Injectable()
export class JobsPlugin extends PluginBase {
  private readonly logger = new Logger(JobsPlugin.name);

  manifest = {
    id: "jobs",
    name: "%jobs.name%",
    description: "%jobs.description%",
    version: "1.1.0",
    category: "core" as const,
  };

  constructor(private readonly registry: JobRegistryService) {
    super();
  }

  async onLoad(api: PluginApi): Promise<void> {
    api.registerNls("zh", langZh);
    api.registerNls("en", langEn);
    const kit = api.registerToolKit({
      id: "jobs",
      name: "%jobs.name%",
      description: "%jobs.toolkitDescription%",
      // 自治理：后台作业是 shell / sub_agent / workflow 等生产者的基础设施。
      // 通用智能体层开关（全部禁用 / 新插件默认 / 逐包 deny）一律不作用于本包，
      // 是否可用只由两件事决定：生产者可用性（requiresAnyKits）与本包自己的 handler。
      // 通用「能力包」网格不展示本包（见前端 DEDICATED_PLUGIN_IDS）。
      governance: "self",
      // 消费方跟随生产者：模型可发起的后台作业生产者（shell / subagent / workflow）
      // 全部被关闭时，job 工具族成为空壳——依赖缺失整包隐藏（scheduler 无 AI 入口不计入）。
      requiresAnyKits: ["shell:shell", "sub_agent:subagent", "workflow:workflow"],
      // 保留显式条目通道（手改 AGENT.md 的 settings.plugins.jobs 仍可逐会话关闭）；
      // 忽略 __strategy/__default 是自治理包的既定语义。
      handler: (ctx) => {
        const entry = (ctx.pluginsConfig as RolePluginConfig | undefined)?.jobs;
        return {
          loadMode: isToolkitAllowedByRoleConfig(entry, "jobs")
            ? ("eager" as const)
            : ("none" as const),
        };
      },
    });

    kit.registerTool({
      name: "job_read",
      description: `Read a background job's output.

- Each call returns the output that arrived since your last read (the first call returns the tail). No parameters needed for paging.
- If more than one read's worth (64 KB) is waiting, the earliest part is skipped and only the newest 64 KB is returned; the note tells you how much was skipped. The complete log file is always available at the path in the response.
- If nothing new arrived since your last read, the body is "(no new output since last read)" — that is not an error.
- wait_ms blocks up to that many milliseconds for a terminal status (omit or 0 = return immediately; max 10min). A timed-out wait returns [status: running] and leaves the job alive.
- Reading a terminal job marks it observed and suppresses the completion notice; reading a running job is only a snapshot.
- Every response ends with [status: ...].`,
      inputSchema: z.object({
        job_id: z.string().describe("Job id returned by the tool that started the background work."),
        wait_ms: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe(
            "Block up to this many milliseconds for a terminal status (omit or 0 = return immediately; max 10min).",
          ),
      }),
      execute: async (args, ctx, signal) => {
        const sessionId = ctx?.session.sessionId || "";
        if (!sessionId) throw new Error("No active session for job_read");
        if (!args.job_id) throw new Error("job_id is required");
        const jobId = args.job_id as JobId;

        const waitMs = Math.min(args.wait_ms ?? 0, WAIT_MAX_MS);
        if (waitMs > 0) {
          await this.registry.wait(jobId, sessionId, waitMs, signal);
        }

        const result = await this.registry.readIncremental(jobId, sessionId);
        return this.renderOutput(result.output, result.job, result.incremental);
      },
      display: {
        actionType: "process",
        text: { executing: "%job_read.executing%", completed: "%job_read.completed%" },
        argsKey: "job_id",
        icon: "terminal",
      },
      readOnly: true,
      exemptFromLargeResult: true,
    });

    kit.registerTool({
      name: "job_list",
      description:
        "List this session's background jobs (running and recently finished) with their ids, kinds, statuses, and log paths.",
      inputSchema: z.object({}),
      execute: (_args, ctx) => {
        const sessionId = ctx?.session.sessionId || "";
        if (!sessionId) throw new Error("No active session for job_list");
        const jobs = this.registry.list(sessionId);
        if (jobs.length === 0) return "(no background jobs)";
        return jobs.map((job) => this.renderListLine(job)).join("\n");
      },
      display: {
        actionType: "process",
        text: { executing: "%job_list.executing%", completed: "%job_list.completed%" },
        icon: "terminal",
      },
      readOnly: true,
    });

    kit.registerTool({
      name: "job_stop",
      description:
        "Request cancellation of a running background job by job id. Returns immediately; the job settles as killed once its work actually stops.",
      inputSchema: z.object({
        job_id: z.string().describe("Job id returned by the tool that started the background work."),
        reason: z.string().optional().describe("Optional short reason forwarded to the job."),
      }),
      execute: (args, ctx) => {
        const sessionId = ctx?.session.sessionId || "";
        if (!sessionId) throw new Error("No active session for job_stop");
        if (!args.job_id) throw new Error("job_id is required");
        const jobId = args.job_id as JobId;
        const outcome = this.registry.kill(jobId, sessionId, args.reason);
        const job = this.registry.get(jobId, sessionId);
        if (!job) {
          return `job ${args.job_id} is no longer available`;
        }
        return outcome === "already-finished"
          ? `job ${job.id} had already finished [status: ${this.statusText(job)}]`
          : `requested cancellation of job ${job.id}; status will settle as the work stops`;
      },
      display: {
        actionType: "process",
        text: { executing: "%job_stop.executing%", completed: "%job_stop.completed%" },
        argsKey: "job_id",
        icon: "terminal",
      },
      dangerLevel: "high",
    });

    kit.registerTool({
      name: "job_send",
      description: `Send input to a running background job.

- Shell / remote-shell / pty jobs: \`input\` is written to the process's stdin **verbatim** — include a trailing "\\n" yourself when the program expects a line (most interactive prompts wait for Enter).
- stdin here is a pipe, not a terminal: "\\x04" (Ctrl-D) does not produce EOF and "\\x03" (Ctrl-C) does not raise SIGINT — use job_stop to end an interactive program.
- Sub-agent jobs: the input is delivered as a follow-up message; a finished sub-agent resumes automatically. Blocks until the sub-agent's reply for this turn is ready.
- Other job kinds do not accept input and fail with a clear error.`,
      inputSchema: z.object({
        job_id: z.string().describe("Job id returned by the tool that started the background work."),
        input: z
          .string()
          .describe('Exact text to deliver (add "\\n" yourself for keyboard-style input).'),
      }),
      execute: async (args, ctx) => {
        const sessionId = ctx?.session.sessionId || "";
        if (!sessionId) throw new Error("No active session for job_send");
        if (!args.job_id) throw new Error("job_id is required");
        if (args.input === undefined || args.input === null) {
          throw new Error("input is required");
        }
        const jobId = args.job_id as JobId;
        const job = this.registry.get(jobId, sessionId);
        if (!job) {
          return `job ${args.job_id} is no longer available`;
        }
        await this.registry.send(jobId, sessionId, args.input);
        // 回执按真实写入字节数（UTF-8）：中文/emoji 的字符数与字节数不等。
        const bytes = Buffer.byteLength(args.input, "utf8");
        const hint = this.needsNewlineHint(job, args.input)
          ? `\n[note: no trailing newline was sent — most interactive programs wait for Enter; include "\\n" in input if it should run]`
          : "";
        return `sent ${bytes} bytes to job ${job.id}${hint}`;
      },
      display: {
        actionType: "process",
        text: { executing: "%job_send.executing%", completed: "%job_send.completed%" },
        argsKey: "job_id",
        icon: "terminal",
      },
    });

    kit.registerPrompt({
      frequency: "STATIC",
      description: "Background job usage instructions",
      content: `# Background Job Usage

- Tools that start background work return a stable **job id**. Track it.
- The system notifies you in-session when a job finishes; do not busy-poll or sleep on it.
- job_list shows this session's jobs; job_read returns the output since your last read (pass wait_ms only when genuinely blocked); job_send feeds input verbatim — include "\n" yourself for keyboard-style input (shell stdin, or a follow-up message that resumes a sub-agent); job_stop cancels work that no longer matters. job_read keeps only the newest 64 KB when more is waiting — the note says how much was skipped, and the full log is at the given path.
- Before giving a final answer, collect every still-relevant job with job_read, and job_stop the ones that are no longer needed.`,
    });
  }

  /**
   * 回执里的"没带换行"提醒。
   *
   * job_send 现在纯透传（不再替你补换行），最容易踩的坑是"输入进了管道、程序在等回车，
   * 工具却只回 sent N bytes"——静默失败。这里把该情形在回执里点出来，模型下一步能自纠。
   * 控制字符（ESC / Ctrl-D 等）本身就是"故意不带换行"的信号，不提醒。
   */
  private needsNewlineHint(job: JobSnapshot, input: string): boolean {
    if (!isByteLogJobKind(job.kind)) return false;
    if (input.endsWith("\n")) return false;
    return !/[\x00-\x08\x0b-\x1f]/.test(input);
  }

  private renderOutput(
    output: { text: string; truncated: boolean; droppedBytes?: number },
    job: JobSnapshot,
    incremental: boolean,
  ): { content: string; meta: Record<string, any> } {
    const dropped = output.droppedBytes ?? 0;
    // 续读没拿到新内容时，说清"上次之后没有新增"，不要含糊成 "(no output)"
    const body = output.text.length > 0
      ? output.text
      : incremental
        ? "(no new output since last read)"
        : "(no output)";
    const exit =
      job.exitCode !== undefined && job.exitCode !== null
        ? `, exit code: ${job.exitCode}`
        : "";
    const log = job.logFilePath ? `\nLog file: ${job.logFilePath}` : "";
    // 超过单次上限时丢的是最早的一段，只保留最新的；说清丢了多少、完整内容在哪
    const truncatedNote = dropped > 0
      ? job.logFilePath
        ? `\n[Note: ${formatBytes(dropped)} of output was skipped (only the latest ${formatBytes(JOB_READ_DEFAULT_MAX_BYTES)} is shown). The complete log is saved at: ${job.logFilePath}. Read it with the read tool for full content.]`
        : `\n[Note: ${formatBytes(dropped)} of output was skipped; only the latest part is shown.]`
      : output.truncated
        ? job.logFilePath
          ? `\n[Note: Output was truncated. The complete log is saved at: ${job.logFilePath}. Read it with the read tool for full content.]`
          : `\n[Note: Output was truncated; only part of it is shown.]`
        : "";
    const statusLine = `[status: ${job.status}${exit}]`;

    return {
      content: `${body}${truncatedNote}\n${statusLine}${log}`,
      meta: {
        card: "terminal",
        backgrounded: job.status === "running",
        jobId: job.id,
        jobStatus: job.status,
        handle: job.handle,
        truncated: output.truncated || dropped > 0,
        ...(dropped > 0 ? { droppedBytes: dropped } : {}),
        ...(job.logFilePath ? { logFilePath: job.logFilePath } : {}),
      },
    };
  }

  private renderListLine(job: JobSnapshot): string {
    const exit =
      job.exitCode !== undefined && job.exitCode !== null
        ? `, exit code ${job.exitCode}`
        : "";
    const handle = job.handle ? `, handle ${job.handle}` : "";
    const log = job.logFilePath ? ` (log: ${job.logFilePath})` : "";
    return `- ${job.id} [${job.kind}, ${job.status}${exit}${handle}] ${job.label}${log}`;
  }

  private statusText(job: JobSnapshot): string {
    const exit =
      job.exitCode !== undefined && job.exitCode !== null
        ? `, exit code: ${job.exitCode}`
        : "";
    return `${job.status}${exit}`;
  }
}
