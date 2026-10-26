import { Injectable, Logger, Optional } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { ChatRunnerService } from "../chat/chat-runner.service";
import type { QueueSource } from "../chat/chat-runner.service";
import { JobRegistryService } from "./job-registry.service";
import type { JobId, JobSettledEvent, JobSnapshot } from "./job.types";
import type { RolePluginConfig } from "../plugins/types/plugin.types";

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
 * - 会话运行中 → 不投递，只置挂起标记（不在回合中间插用户消息）；
 * - 会话空闲 → 立即投递（enqueue 后立即 processQueue，近似"投递即消费"）；
 * - 回合正常收尾 → 把挂起通知一次投出（批量由队列的同 source.kind 合并承接）；
 * - 回合开始 → 挂起标记作废（"会话再运行就不投递"，模型可 job_list 自行发现）；
 * - user_cancel / error 收尾 → 不投递（与 processQueue 同一道 NORMAL_FINISH 门）。
 *
 * 注意 shell / remote-shell 的回合内完成通常走不到这里：它们的输出由 turn.stopping
 * 续跑钩子（shell.plugin.handleTurnStopping）在进程层收割，收割时已 markReported。
 * 本服务覆盖的是 subagent 等没有进程层收割路径的 kind（详见 job.types.ts 头注释）。
 *
 * 去重：投递成功（enqueueMessage 返回）那一刻才 markReported，且用 inFlight 防并发双投。
 * 入队失败时保持 reported=false 并挂回待投递队列，下一回合正常收尾会重试——
 * 通知正文刻意只带状态和读取入口，不带完整输出，模型用 job_read 取输出。
 */
@Injectable()
export class JobNotifierService {
  private readonly logger = new Logger(JobNotifierService.name);
  /** 正在投递中的 job：settle 直投与回合收尾 drain 可能同时命中同一条 */
  private readonly inFlight = new Set<JobId>();

  constructor(
    private readonly chatRunner: ChatRunnerService,
    private readonly registry: JobRegistryService,
    /**
     * 通知正文里的 "Use job_read" 指引依赖 job 工具族可见。
     * 决议用静态路径（无 session），@Optional 兼容未注入 PluginManager 的测试场景。
     */
    @Optional()
    private readonly pluginManager?: {
      resolvePlugins: (
        session?: unknown,
        roleCfg?: RolePluginConfig,
        skipHandler?: boolean,
      ) => Promise<
        Array<{
          plugin: { id: string };
          enabledToolKits: Array<{ id: string; loadMode: string }>;
        }>
      >;
    },
    /** 取会话/智能体的 plugins 配置（loadRolePluginConfig 用）；@Optional 兼容纯单测 */
    @Optional()
    private readonly sessionService?: {
      getSessionById: (
        sessionId: string,
      ) => Promise<{ settings?: any; agent?: { settings?: any } } | null>;
    },
  ) {}

  @OnEvent("job.settled")
  async handleJobSettled(event: JobSettledEvent): Promise<void> {
    if (this.registry.isShuttingDown()) return;
    // notify 的默认值已在 JobRegistryService.start 按 kind 归一化
    // （workflow / scheduler 默认静默，其余默认通知，显式传入优先）。
    // 这里只信事件里的布尔值，不再按 kind 二次判断——避免"哪些 kind 不通知"两处维护。
    if (!event.notify) return;
    if (event.job.reported) return;

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
   * 顺序：判重（reported / inFlight）→ 构建正文 → enqueueMessage **成功后**才 markReported。
   * 旧实现是"先 markReported 再入队"，入队抛错就永久丢失通知（reported 已置位，
   * 任何后续 drain/重连都不会再投）。现在失败保持 reported=false 并挂回待投递队列，
   * 下一次回合正常收尾（handleTurnFinished）会重试。
   * markReported 仍是"结果已通告"的唯一真相：子 Agent 的 onReported 据此清 completed/自动冻结。
   */
  private async deliver(job: JobSnapshot): Promise<void> {
    if (job.reported || this.inFlight.has(job.id)) return;
    this.inFlight.add(job.id);
    try {
      // 先构建正文（内部要 await 判定 job 工具族可见性），避免拿着半成品入队
      const notice = await this.buildNotice(job);
      await this.chatRunner.enqueueMessage({
        sessionId: job.sessionId,
        blocks: [
          {
            type: "text",
            text: `<system_reminder>\n${notice}\n</system_reminder>`,
          },
        ],
        source: this.buildSource(job),
      });
      this.registry.markReported(job.id);
    } catch (error: any) {
      // 通知失败不能让执行器结算流程抛错；挂回待投递队列，正常收尾时重试。
      this.logger.error(
        `投递作业完成通知失败 (${job.id}): ${error?.message ?? error}`,
      );
      this.registry.markNoticePending(job.id);
    } finally {
      this.inFlight.delete(job.id);
    }
  }

  /**
   * job 工具族是否对该会话可见（决定通知正文要不要带 "Use job_read" 指引）。
   * 与会话初始化同一决议入口，skipHandler 走静态路径；任何失败按可见处理
   * （正文多一句指引无害，漏掉读取入口才有害）。
   */
  private async isJobsToolkitVisible(sessionId: string): Promise<boolean> {
    if (!this.pluginManager) return true;
    try {
      const roleCfg = await this.loadRolePluginConfig(sessionId);
      const resolved = await this.pluginManager.resolvePlugins(
        undefined,
        roleCfg,
        true,
      );
      const jobs = resolved.find((r) => r.plugin.id === "jobs");
      const kit = jobs?.enabledToolKits.find((k) => k.id === "jobs");
      return !kit || kit.loadMode !== "none";
    } catch {
      return true;
    }
  }

  /** 会话 plugins 配置优先，回退智能体配置（与 JsonlSessionContext.buildEffectiveSettings 同语义） */
  private async loadRolePluginConfig(
    sessionId: string,
  ): Promise<RolePluginConfig | undefined> {
    const session = await this.sessionService?.getSessionById(sessionId);
    const sessionPlugins = (session as any)?.settings?.plugins;
    return (
      sessionPlugins ?? (session as any)?.agent?.settings?.plugins ?? undefined
    );
  }  private async buildNotice(job: JobSnapshot): Promise<string> {
    const exit =
      job.exitCode !== undefined && job.exitCode !== null
        ? `, exit code ${job.exitCode}`
        : "";
    const detail = job.detail ? ` (${job.detail})` : "";
    const handle = job.handle ? `, handle: ${job.handle}` : "";
    const log = job.logFilePath ? `\nLog file: ${job.logFilePath}` : "";
    const readHint = (await this.isJobsToolkitVisible(job.sessionId))
      ? `\nUse job_read ${job.id} to read the output.`
      : "";
    return `Background job ${job.id} (${job.kind}: ${job.label}${handle}) finished [status: ${job.status}${exit}]${detail}.${readHint}${log}`;
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
