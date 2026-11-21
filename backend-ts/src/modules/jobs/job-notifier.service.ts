import { Injectable, Logger, Optional } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { wrapSystemReminder } from "../../common/utils/system-reminder.util";
import type {
  Message,
  MessageSource,
} from "../../common/types/conversation.types";
import { ChatRunnerService } from "../chat/chat-runner.service";
import type { QueueSource } from "../chat/chat-runner.service";
import { HOOKS, type StepHandoffPayload } from "../chat/types/hooks.contract";
import { JobRegistryService } from "./job-registry.service";
import { isByteLogJobKind, JOB_NOTICE_MAX_BYTES } from "./job.types";
import type { JobId, JobSettledEvent, JobSnapshot } from "./job.types";
import type { RolePluginConfig } from "../plugins/types/plugin.types";

/** 回合收尾事件（ChatRunner finally 发出；normalFinish 与 processQueue 同一道门） */
interface TurnFinishedEvent {
  sessionId: string;
  sessionType?: string;
  reason?: string;
  normalFinish: boolean;
}

/**
 * 后台作业完成通知的唯一投递点。
 *
 * 投递时机（投递时判定，不抢占正在运行的回合）：
 * - 会话运行中 → 不打断回合，只置挂起标记；
 * - 会话空闲 → 立即投递（enqueue 后立即 processQueue，近似"投递即消费"）；
 * - 工具边界（STEP_HANDOFF）→ 挂起通知落库为回合内 user 消息，在下一次 LLM
 *   请求边界自动送达（不结束当前回合）；
 * - 回合正常收尾 → 仍未投出的挂起通知批量投出（以新回合送达）；
 * - user_cancel / error 收尾 → 不在该收尾投递；挂起通知留给下一次边界/收尾机会
 *   （不再在回合开始时作废——通知不能丢，只会在下一机会送达）。
 *
 * 通知正文：内存文本类 kind（subagent 等）直接带最终输出（尾部切片，上限
 * JOB_NOTICE_MAX_BYTES），模型无需二次 job_read；shell / remote-shell / pty 的输出有
 * 专用的进程层收割通道（turn.stopping / poll），正文保持状态 + 读取入口，
 * 避免与收割路径重复投递同一份输出。
 *
 * 去重：投递成功（落库 / enqueueMessage 返回）那一刻才 markReported，且用 inFlight
 * 防并发双投。失败时保持 reported=false 并挂回待投递队列，下一次边界或回合收尾重试。
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

  /**
   * 工具边界注入（HOOKS.STEP_HANDOFF，parallel 订阅者：只做副作用，返回 undefined）。
   *
   * 会话忙碌期间挂起的通知，在下一次 LLM 请求派发前落库——engine 在钩子后重读
   * getHistory()，落库消息自然进入本次请求。
   * 不返回 handoff 决策：注入不打断当前回合；若同一边界恰好有队列 inject 交接，
   * 已落库的通知会在新回合首个请求送达，不丢。
   *
   * 逐条构建（单条失败挂回、不影响其他）→ 一次性 appendMessages → 成功后统一
   * markReported（落库失败则全部挂回，reported 未置位，回合收尾重试）→
   * 逐条发 user_message 实时事件（projector 按 messageId 幂等；失败不影响投递，
   * 刷新/重放可见）。
   */
  @OnEvent(HOOKS.STEP_HANDOFF)
  async handleStepHandoffBoundary(payload: StepHandoffPayload): Promise<void> {
    if (payload.abortSignal?.aborted) return;
    if (this.registry.isShuttingDown()) return;
    const sessionId = payload.sessionContext.sessionId;
    const pending = this.registry.takePendingNotices(sessionId);
    if (pending.length === 0) return;

    const built: Array<{ job: JobSnapshot; message: Message }> = [];
    for (const job of pending) {
      // shell / remote-shell / pty 的输出由进程层收割通道（turn.stopping）交付，
      // 边界不代投：挂回 pending，保持既有收尾兜底语义。
      if (isByteLogJobKind(job.kind)) {
        this.registry.markNoticePending(job.id);
        continue;
      }
      if (job.reported || this.inFlight.has(job.id)) continue;
      this.inFlight.add(job.id);
      try {
        const notice = await this.buildNotice(job);
        built.push({
          job,
          message: {
            id: payload.sessionContext.generateMessageId(),
            role: "user",
            kind: "user",
            source: this.buildMessageSource(job),
            metadata: {},
            content: [{ type: "text", text: wrapSystemReminder(notice) }],
          },
        });
      } catch (error: any) {
        this.logger.error(
          `边界注入构建作业完成通知失败 (${job.id}): ${error?.message ?? error}`,
        );
        this.registry.markNoticePending(job.id);
      } finally {
        this.inFlight.delete(job.id);
      }
    }
    if (built.length === 0) return;

    try {
      await payload.sessionContext.appendMessages(built.map((b) => b.message));
    } catch (error: any) {
      // 落库失败：reported 未置位，全部挂回待投递队列，回合收尾重试。
      this.logger.error(
        `边界注入落库失败 (session=${sessionId}): ${error?.message ?? error}`,
      );
      for (const { job } of built) this.registry.markNoticePending(job.id);
      return;
    }
    for (const { job } of built) this.registry.markReported(job.id);

    // 实时广播：turnId 归属当前回合（与落库的回合括号一致，刷新重放同位）。
    // 广播失败只影响本窗口的实时展示，不影响模型可见性与重放。
    for (const { message } of built) {
      try {
        await payload.sessionContext.publishStream({
          type: "user_message",
          messageId: message.id,
          turnId: payload.turnId ?? message.id,
          userMessage: message,
        });
      } catch (error: any) {
        this.logger.warn(
          `边界注入实时广播失败 (${message.id}): ${error?.message ?? error}`,
        );
      }
    }
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
   * markReported 仍是"结果已通告"的唯一真相：子 Agent 的 onReported 据此清 completed/补记运行结束。
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
            text: wrapSystemReminder(notice),
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
  }

  private async buildNotice(job: JobSnapshot): Promise<string> {
    const exit =
      job.exitCode !== undefined && job.exitCode !== null
        ? `, exit code ${job.exitCode}`
        : "";
    const detail = job.detail ? ` (${job.detail})` : "";
    const handle = job.handle ? `, handle: ${job.handle}` : "";
    const log = job.logFilePath ? `\nLog file: ${job.logFilePath}` : "";
    const head = `Background job ${job.id} (${job.kind}: ${job.label}${handle}) finished [status: ${job.status}${exit}]${detail}.`;

    if (isByteLogJobKind(job.kind)) {
      // shell / remote-shell / pty 的输出走进程层收割通道（turn.stopping / poll），
      // 正文带全文会在下一回合收尾重复投递同一份输出——保持状态 + 读取入口。
      const readHint = (await this.isJobsToolkitVisible(job.sessionId))
        ? `\nUse job_read ${job.id} to read the output.`
        : "";
      return `${head}${readHint}${log}`;
    }

    // 内存文本类（subagent 等）：最终输出随通知直达模型（尾部切片），
    // 免去二次 job_read。读取失败降级为纯状态通知——读失败绝不能变成通知丢失。
    let outputSection = "";
    let outputTruncated = false;
    try {
      const { output } = await this.registry.read(
        job.id,
        job.sessionId,
        { maxBytes: JOB_NOTICE_MAX_BYTES },
        { markReported: false },
      );
      const text = (output.text ?? "").trim();
      if (text) {
        outputTruncated = output.truncated === true;
        outputSection = `\n--- output ---\n${text}\n--- end of output ---`;
      }
    } catch (error: any) {
      this.logger.warn(
        `通知读取作业输出失败，降级为纯状态 (${job.id}): ${error?.message ?? error}`,
      );
    }
    const jobsVisible = await this.isJobsToolkitVisible(job.sessionId);
    let readHint = "";
    if (jobsVisible) {
      if (!outputSection) {
        readHint = `\nUse job_read ${job.id} to read the output.`;
      } else if (outputTruncated) {
        readHint = `\nUse job_read ${job.id} to read earlier output beyond this tail.`;
      }
    }
    return `${head}${outputSection}${readHint}${log}`;
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

  /**
   * 边界注入落库用的严格 MessageSource（与 buildSource 的 QueueSource 分开：
   * MessageSource 的 subSessionId / processId 必填，落库形状必须满足 replayer 契约）。
   */
  private buildMessageSource(job: JobSnapshot): MessageSource {
    if (job.kind === "subagent") {
      return {
        kind: "sub_agent",
        subSessionId: job.handle ?? job.id,
        agentName: job.label,
        jobId: job.id,
      };
    }
    return {
      kind: "process_monitor",
      processId: job.handle ?? job.id,
      jobId: job.id,
    };
  }
}
