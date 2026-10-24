import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { ChatRunnerService } from "../chat/chat-runner.service";
import type { QueueSource } from "../chat/chat-runner.service";
import { JobRegistryService } from "./job-registry.service";
import type { JobSettledEvent, JobSnapshot } from "./job.types";

/**
 * 后台作业完成通知的唯一投递点。
 *
 * 执行器结算 job 后只发 `job.settled`；这里负责：
 * - 跳过执行器明确要求静默（notify:false）和已读（reported）的作业；
 * - 把通知映射回现有 source（shell/remote/pty → process_monitor，subagent → sub_agent），
 *   保证前端渲染不变；
 * - 用 Registry 快照存在性 + reported 做 isValid 去重。
 *
 * 通知正文刻意只带状态和读取入口，不带完整输出——模型用 job_read 取输出。
 */
@Injectable()
export class JobNotifierService {
  private readonly logger = new Logger(JobNotifierService.name);

  constructor(
    private readonly chatRunner: ChatRunnerService,
    private readonly registry: JobRegistryService,
  ) {}

  @OnEvent("job.settled")
  async handleJobSettled(event: JobSettledEvent): Promise<void> {
    if (this.registry.isShuttingDown()) return;
    if (!event.notify) return;
    if (event.job.reported) return;
    if (event.job.kind === "workflow" || event.job.kind === "scheduler") {
      // 这两类的结果已经由工具返回值/会话回合交付，不再额外唤醒一回合。
      return;
    }

    try {
      await this.chatRunner.enqueueMessage({
        sessionId: event.job.sessionId,
        blocks: [
          {
            type: "text",
            text: `<system_reminder>\n${this.buildNotice(event.job)}\n</system_reminder>`,
          },
        ],
        source: this.buildSource(event.job),
        isValid: () => {
          const current = this.registry.get(event.job.id, event.job.sessionId);
          return !!current && !current.reported;
        },
        onConsumed: () => {
          this.registry.markReported(event.job.id);
        },
      });
    } catch (error: any) {
      // 通知失败不能让执行器结算流程抛错；日志留证，job 仍可在 TTL 内读取。
      this.logger.error(
        `投递作业完成通知失败 (${event.job.id}): ${error?.message ?? error}`,
      );
    }
  }

  private buildNotice(job: JobSnapshot): string {
    const exit =
      job.exitCode !== undefined && job.exitCode !== null
        ? `, exit code ${job.exitCode}`
        : "";
    const detail = job.detail ? ` (${job.detail})` : "";
    const handle = job.handle ? `, handle: ${job.handle}` : "";
    const log = job.logFilePath ? `\nLog file: ${job.logFilePath}` : "";
    return `Background job ${job.id} (${job.kind}: ${job.label}${handle}) finished [status: ${job.status}${exit}]${detail}.\nUse job_read ${job.id} to read the output.${log}`;
  }

  private buildSource(job: JobSnapshot): QueueSource {
    if (job.kind === "subagent") {
      return {
        kind: "sub_agent",
        subSessionId: job.handle,
        agentName: job.label,
        jobId: job.id,
      };
    }
    // shell / remote-shell / pty 沿用 process_monitor：前端已有渲染分支。
    return {
      kind: "process_monitor",
      processId: job.handle,
      jobId: job.id,
      event: job.status,
      exitCode: job.exitCode,
    };
  }
}
