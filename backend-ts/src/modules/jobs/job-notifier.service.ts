import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { ChatRunnerService } from "../chat/chat-runner.service";
import type { QueueSource } from "../chat/chat-runner.service";
import { JobRegistryService } from "./job-registry.service";
import type { JobSettledEvent, JobSnapshot } from "./job.types";

/** 回合收尾事件（ChatRunner finally 发出；normalFinish 与 processQueue 同一道门） */
interface TurnFinishedEvent {
  sessionId: string;
  sessionType?: string;
  reason?: string;
  normalFinish: boolean;
}

/** 流状态事件（ChatRunner startStream/stop 路径发出） */
interface StreamStatusEvent {
  sessionId: string;
  payload?: {
    status?: string;
    reason?: string;
    sessionType?: string;
  };
}

/**
 * 后台作业完成通知的唯一投递点。
 *
 * 投递时机（对齐 zcode 的"投递时判定"思路）：
 * - 会话运行中 → 不投递，只置挂起标记；本轮由 turn.stopping drain 或模型 job_read 负责；
 * - 会话空闲 → 立即投递（enqueue 后立即 processQueue，近似"投递即消费"）；
 * - 回合正常收尾 → 把挂起通知一次投出（批量由队列的同 source.kind 合并承接）；
 * - 回合开始 → 挂起标记作废（"会话再运行就不投递"，模型可 job_list 自行发现）；
 * - user_cancel / error 收尾 → 不投递（与 processQueue 同一道 NORMAL_FINISH 门）。
 *
 * 去重不再依赖 isValid/onConsumed 闭包：投递那一刻即 markReported——
 * 完成通知的"已交付"语义在投递时成立，子 Agent 清理/冻结与 drain 跳过都以此为准。
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

    // 会话在跑：本轮自己会 drain/read，通知先挂起
    if (this.chatRunner.hasActiveStream(event.job.sessionId)) {
      this.registry.markNoticePending(event.job.id);
      return;
    }
    await this.deliver(event.job);
  }

  /** 回合开始：挂起通知作废（"只要会话再运行就不投递"）。 */
  @OnEvent("stream.status_changed")
  handleStreamStatusChanged(event: StreamStatusEvent): void {
    if (event.payload?.status !== "running") return;
    this.registry.clearPendingNotices(event.sessionId);
  }

  /** 回合正常收尾：投出本轮挂起的通知（含 drain 未消费的）。 */
  @OnEvent("chat.turn_finished")
  async handleTurnFinished(event: TurnFinishedEvent): Promise<void> {
    if (!event.normalFinish) return;
    if (this.registry.isShuttingDown()) return;

    const pending = this.registry.takePendingNotices(event.sessionId);
    for (const job of pending) {
      await this.deliver(job);
    }
  }

  /**
   * 投递一条完成通知。
   *
   * 先 markReported：通知发出即视为"结果已通告"——
   * 子 Agent 的 onReported 据此清 completed/自动冻结；shell/remote 的
   * turn.stopping drain 据此跳过已通告输出，避免同一份输出被注入两次。
   * 不传 isValid/onConsumed：投递只在空闲（或回合正常收尾）发生，近似原子消费。
   */
  private async deliver(job: JobSnapshot): Promise<void> {
    this.registry.markReported(job.id);
    try {
      await this.chatRunner.enqueueMessage({
        sessionId: job.sessionId,
        blocks: [
          {
            type: "text",
            text: `<system_reminder>\n${this.buildNotice(job)}\n</system_reminder>`,
          },
        ],
        source: this.buildSource(job),
      });
    } catch (error: any) {
      // 通知失败不能让执行器结算流程抛错；日志留证，job 仍可在 TTL 内读取。
      this.logger.error(
        `投递作业完成通知失败 (${job.id}): ${error?.message ?? error}`,
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
