import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { PluginBase } from "../plugins/base-plugin";
import { PluginApi } from "../plugins/api/plugin-api";
import { JobRegistryService } from "./job-registry.service";
import type { JobId, JobSnapshot } from "./job.types";

const WAIT_DEFAULT_MS = 30_000;
const WAIT_MAX_MS = 10 * 60_000;

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
    name: "Background Jobs",
    description: "List, read, feed input to, and cancel background jobs by stable job id.",
    version: "1.1.0",
    category: "core" as const,
  };

  constructor(private readonly registry: JobRegistryService) {
    super();
  }

  async onLoad(api: PluginApi): Promise<void> {
    const kit = api.registerToolKit({
      id: "jobs",
      name: "Background Jobs",
      description: "Manage long-running background work by job id.",
      activator:
        "Track and interact with background jobs started by tools such as run_command or subagent_spawn.",
      // 消费方跟随生产者：模型可发起的后台作业生产者（shell / subagent / workflow）
      // 全部被关闭时，job 工具族成为空壳——依赖缺失整包隐藏（scheduler 无 AI 入口不计入）。
      requiresAnyKits: ["shell:shell", "sub_agent:subagent", "workflow:workflow"],
    });

    kit.registerTool({
      name: "job_read",
      description: `Read a background job's output.

- Each call returns the output that arrived since your last read (the first call returns the tail). No parameters needed for paging.
- If the output is truncated, read the log file (path is included) with the read tool for the full content.
- wait=true blocks until terminal status or timeout_ms (default 30s, max 10min). A timed-out wait returns [status: running] and leaves the job alive.
- Reading a terminal job marks it observed and suppresses the completion notice; reading a running job is only a snapshot.
- Every response ends with [status: ...].`,
      inputSchema: z.object({
        job_id: z.string().describe("Job id returned by the tool that started the background work."),
        wait: z
          .boolean()
          .optional()
          .describe("Block until the job reaches a terminal status or timeout_ms expires."),
        timeout_ms: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Max wait in milliseconds (only meaningful with wait=true). Default 30s, max 10min."),
      }),
      execute: async (args, ctx, signal) => {
        const sessionId = ctx?.session.sessionId || "";
        if (!sessionId) throw new Error("No active session for job_read");
        if (!args.job_id) throw new Error("job_id is required");
        const jobId = args.job_id as JobId;

        if (args.wait === true) {
          const timeout = Math.min(args.timeout_ms ?? WAIT_DEFAULT_MS, WAIT_MAX_MS);
          await this.registry.wait(jobId, sessionId, timeout, signal);
        }

        const result = await this.registry.readIncremental(jobId, sessionId);
        return this.renderOutput(result.output, result.job);
      },
      display: {
        actionType: "process",
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
        argsKey: "job_id",
        icon: "terminal",
      },
      dangerLevel: "high",
    });

    kit.registerTool({
      name: "job_send",
      description: `Send input to a running background job.

- Shell / remote-shell jobs: the input is written to the process's stdin (a trailing newline is appended unless append_newline=false).
- Sub-agent jobs: the input is delivered as a follow-up message; a finished sub-agent resumes automatically. Blocks until the sub-agent's reply for this turn is ready.
- Other job kinds do not accept input and fail with a clear error.`,
      inputSchema: z.object({
        job_id: z.string().describe("Job id returned by the tool that started the background work."),
        input: z.string().describe("Input to deliver to the job."),
        append_newline: z
          .boolean()
          .optional()
          .describe("Shell jobs only: append a trailing newline (default true). Set false to write raw bytes."),
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
        await this.registry.send(jobId, sessionId, args.input, args.append_newline !== false);
        return `sent ${args.input.length} bytes to job ${job.id}`;
      },
      display: {
        actionType: "process",
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
- job_list shows this session's jobs; job_read returns the output since your last read (wait=true only when genuinely blocked); job_send feeds input (shell stdin, or a follow-up message that resumes a sub-agent); job_stop cancels work that no longer matters. Truncated output: read the log file with the read tool.
- Before giving a final answer, collect every still-relevant job with job_read, and job_stop the ones that are no longer needed.`,
    });
  }

  private renderOutput(
    output: { text: string; truncated: boolean },
    job: JobSnapshot,
  ): { content: string; meta: Record<string, any> } {
    const body = output.text.length > 0 ? output.text : "(no output)";
    const exit =
      job.exitCode !== undefined && job.exitCode !== null
        ? `, exit code: ${job.exitCode}`
        : "";
    const log = job.logFilePath ? `\nLog file: ${job.logFilePath}` : "";
    // 截断指引与 run_command 前台同款：有日志文件就读文件，没有（内存文本类）就说只剩部分
    const truncatedNote = output.truncated
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
        truncated: output.truncated,
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
